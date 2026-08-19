import { isRed } from '../game/BallRegistry.js';
import { ShotAnalyzer } from './ShotAnalyzer.js';
import { ShotSimulator } from './ShotSimulator.js';
import { PositionPlanner } from './PositionPlanner.js';

const potClamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function simulationIsLegal(match,shot,sim){
  if(!sim.valid||sim.cuePotted||sim.firstHit!==shot.targetName)return false;
  if(match.mode==='8ball'||match.mode==='9ball')return true;
  const potted=sim.potted.filter(n=>n!=='Cue');
  if(match.stage==='reds'&&match.expected==='red')return potted.every(name=>match.world.balls.find(b=>b.name===name)?.kind==='red');
  if((match.stage==='reds'&&match.expected==='colour')||match.stage==='finalColour')return potted.every(n=>n===shot.targetName);
  if(match.stage==='colours'||match.stage==='respottedBlack')return potted.every(n=>n===shot.targetName);
  return true;
}

function drain(iterator){let r=iterator.next();while(!r.done)r=iterator.next();return r.value;}

export class PotPlanner {
  constructor(world,{simulator=new ShotSimulator()}={}){
    this.world=world;this.analyzer=new ShotAnalyzer(world);this.simulator=simulator;this.position=new PositionPlanner(world);
  }

  *search(match,level='medium',profile={}){
    const raw=this.analyzer.potCandidates(match,{maxCutDeg:profile.maxCutDeg||75});
    if(!raw.length)return null;
    const baseCount=Math.min(raw.length,profile.searchCount||5),bases=raw.slice(0,baseCount);
    let best=null,simulations=0;
    for(const base of bases){
      for(const variant of this.position.spinVariants(level,base)){
        const shot={...base,spinX:variant.spinX,spinY:variant.spinY,power:potClamp(base.power*variant.powerScale,0.16,0.90)};
        const sim=this.simulator.run(this.world,shot);simulations++;
        if(simulationIsLegal(match,shot,sim)&&sim.targetPotted){
          const redsBonus=(match.stage==='reds'&&match.expected==='red')?sim.potted.filter(n=>isRed(this.world.balls.find(b=>b.name===n))).length*2:0;
          const positionScore=this.position.score(match,shot,sim)*(profile.positionWeight??0.45);
          const laterContacts=(sim.cueContacts||[]).filter(n=>n!==shot.targetName);
          const cannonUseful=(level==='hard'||level==='expert')&&laterContacts.some(name=>{
            const b=this.world.balls.find(x=>x.name===name);
            return (match.stage==='reds'&&match.expected==='colour')?b?.kind==='red':b?.kind==='colour';
          });
          const cannonBonus=cannonUseful?(level==='expert'?8:4):0;
          const score=base.geomScore+95+(shot.target.value||1)*5+redsBonus+positionScore+cannonBonus-(sim.time||0)*0.25;
          const candidate={...shot,simulation:sim,score,decision:'POT'};
          if(!best||candidate.score>best.score)best=candidate;
        }
        // Yield after each full same-physics candidate. Browser runtime consumes
        // these cooperatively across frames; synchronous tests simply drain it.
        yield {stage:'pot',simulations,best};
      }
    }
    return best;
  }

  choose(match,level='medium',profile={}){return drain(this.search(match,level,profile));}
}
