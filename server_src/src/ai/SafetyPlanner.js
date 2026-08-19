import { TABLE } from '../config.js';
import { ShotAnalyzer, legalTargets, pathClear } from './ShotAnalyzer.js';
import { ShotSimulator } from './ShotSimulator.js';

const safetyClamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const safetyDist=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y);
function finalSegmentDistance(p,a,b){const abx=b.x-a.x,aby=b.y-a.y,den=abx*abx+aby*aby;if(den<1e-12)return safetyDist(p,a);const t=safetyClamp(((p.x-a.x)*abx+(p.y-a.y)*aby)/den,0,1);return safetyDist(p,{x:a.x+abx*t,y:a.y+aby*t});}
function snookerCoverScore(sim,targetNames,radius){
  if(!sim?.cueFinal)return 0;let blocked=0,checked=0;
  for(const name of targetNames){
    const target=sim.finalPositions?.[name];if(!target||target.potted)continue;checked++;let isBlocked=false;
    for(const [otherName,p] of Object.entries(sim.finalPositions||{})){
      if(otherName==='Cue'||otherName===name||p.potted)continue;
      if(finalSegmentDistance(p,sim.cueFinal,target)<radius*1.95){isBlocked=true;break;}
    }
    if(isBlocked)blocked++;
  }
  return checked?(blocked/checked)*14:0;
}
function drain(iterator){let r=iterator.next();while(!r.done)r=iterator.next();return r.value;}

export class SafetyPlanner {
  constructor(world,{simulator=new ShotSimulator({maxSeconds:4.2})}={}){this.world=world;this.analyzer=new ShotAnalyzer(world);this.simulator=simulator;}

  *search(match,profile={}){
    const cue=match.cueBall(),targets=legalTargets(match);if(!cue||!targets.length)return null;
    const R=cue.radius,offsets=[-1.48*R,1.48*R,0,-0.92*R,0.92*R],geometric=[];
    for(const target of targets){
      for(const offset of offsets){
        const probe=this.analyzer.directHitCandidate(target,{offset,power:0.5});if(!probe)continue;
        if(!pathClear(this.world,cue.position,probe.aim,{exclude:[cue,target],clearance:R*1.90}))continue;
        geometric.push({target,offset,probe,distance:safetyDist(cue.position,target.position)});
      }
    }
    geometric.sort((a,b)=>a.distance-b.distance||Math.abs(b.offset)-Math.abs(a.offset));
    const maxLines=Math.max(4,(profile.safetyTargets||5)*2);let best=null,simulations=0;
    for(const g of geometric.slice(0,maxLines)){
      const base=safetyClamp(0.31+g.distance*0.13,0.32,0.66),scales=profile.safetyPowerScales||[0.90,1.00,1.10];
      for(const scale of scales){
        const power=safetyClamp(base*scale,0.25,0.72),shot=this.analyzer.directHitCandidate(g.target,{offset:g.offset,power});
        const sim=this.simulator.run(this.world,shot,{maxSeconds:4.2});simulations++;
        if(sim.valid&&sim.firstHit===g.target.name&&!sim.cuePotted){
          const targetFinal=sim.finalPositions?.[g.target.name];
          if(sim.cueFinal&&targetFinal){
            const separation=safetyDist(sim.cueFinal,targetFinal);
            const baulk=Math.max(0,(-0.72-sim.cueFinal.y))*15,nearBaulkCushion=sim.cueFinal.y<-1.35?5:0;
            const T=this.world.table||TABLE,cueRail=Math.min(T.width/2-Math.abs(sim.cueFinal.x),T.length/2-Math.abs(sim.cueFinal.y));
            const cushionHide=cueRail<0.11?6:0,accidentalPot=sim.potted.includes(g.target.name)?-8:0;
            const cover=snookerCoverScore(sim,targets.map(t=>t.name),R);
            const score=separation*17+baulk+nearBaulkCushion+cushionHide+cover+accidentalPot-power*3;
            const candidate={...shot,simulation:sim,score,decision:'SAFETY',spinX:0,spinY:power<0.38?0.05:0};
            if(!best||candidate.score>best.score)best=candidate;
          }
        }
        yield {stage:'safety',simulations,best};
      }
    }
    if(best)return best;
    const fallback=geometric[0];
    if(fallback){const power=safetyClamp(0.33+fallback.distance*0.14,0.35,0.68);return {...this.analyzer.directHitCandidate(fallback.target,{offset:fallback.offset,power}),decision:'SAFETY',score:-50};}
    return null;
  }

  choose(match,profile={}){return drain(this.search(match,profile));}
}
