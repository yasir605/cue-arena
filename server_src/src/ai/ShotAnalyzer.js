import { TABLE } from '../config.js';
import { POCKETS, buildPockets } from '../table/TableGeometry.js';
import { COLOUR_ORDER, isRed, isColour } from '../game/BallRegistry.js';
import { findBall } from '../game/SnookerSetup.js';

const aiClamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const aiDist=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y);
const norm=(x,y)=>{const l=Math.hypot(x,y)||1;return {x:x/l,y:y/l};};
const dot=(a,b)=>a.x*b.x+a.y*b.y;

export const AI_POCKETS=Object.freeze(POCKETS.map(p=>Object.freeze({name:p.name,type:p.type,x:p.x,y:p.z})));
export function aiPocketsFor(world){return buildPockets(world?.table||TABLE).map(p=>({name:p.name,type:p.type,x:p.x,y:p.z}));}

export function legalTargets(match){
  if(typeof match.legalTargetsFor==='function') return match.legalTargetsFor(match.turn);
  const active=match.world.balls.filter(b=>!b.potted&&!b.offTable&&b.kind!=='cue');
  if(match.stage==='reds') return match.expected==='red' ? active.filter(isRed) : active.filter(isColour);
  if(match.stage==='finalColour') return active.filter(isColour);
  if(match.stage==='colours'){
    const name=COLOUR_ORDER[match.clearanceIndex];
    return active.filter(b=>b.name===name);
  }
  if(match.stage==='respottedBlack') return active.filter(b=>b.name==='Black');
  return [];
}

export function nextTargetsAfter(match,target){
  if(typeof match.nextTargetsAfter==='function') return match.nextTargetsAfter(target,match.turn);
  const active=match.world.balls.filter(b=>!b.potted&&!b.offTable&&b.kind!=='cue'&&b!==target);
  if(match.stage==='reds' && match.expected==='red') return active.filter(isColour);
  if(match.stage==='reds' && match.expected==='colour') return active.filter(isRed);
  if(match.stage==='finalColour') return active.filter(b=>b.name==='Yellow');
  if(match.stage==='colours'){
    const name=COLOUR_ORDER[match.clearanceIndex+1];
    return name ? active.filter(b=>b.name===name) : [];
  }
  return [];
}

export function pointSegmentDistance(p,a,b){
  const abx=b.x-a.x, aby=b.y-a.y;
  const den=abx*abx+aby*aby;
  if(den<1e-12) return aiDist(p,a);
  const t=aiClamp(((p.x-a.x)*abx+(p.y-a.y)*aby)/den,0,1);
  const q={x:a.x+abx*t,y:a.y+aby*t};
  return aiDist(p,q);
}

export function pathClear(world,a,b,{exclude=[],clearance=null}={}){
  if(clearance==null)clearance=(world?.table?.ballRadius||TABLE.ballRadius)*2.03;
  const skip=new Set(exclude.map(v=>typeof v==='object'?v.id:v));
  for(const ball of world.balls){
    if(ball.potted||ball.offTable||skip.has(ball.id)) continue;
    if(pointSegmentDistance(ball.position,a,b)<clearance) return false;
  }
  return true;
}

export function angleForDirection(d){ return Math.atan2(d.x,d.y); }

export class ShotAnalyzer {
  constructor(world){ this.world=world; }
  legalTargets(match){ return legalTargets(match); }

  potCandidates(match,{maxCutDeg=82}={}){
    const cue=match.cueBall();
    if(!cue||cue.potted) return [];
    const R=cue.radius;
    const out=[];
    for(const target of legalTargets(match)){
      for(const pocket of aiPocketsFor(this.world)){
        const outDir=norm(pocket.x-target.position.x,pocket.y-target.position.y);
        const ghost={x:target.position.x-outDir.x*(R+target.radius)*1.008,y:target.position.y-outDir.y*(R+target.radius)*1.008};
        const cueDir=norm(ghost.x-cue.position.x,ghost.y-cue.position.y);
        const incomingToTarget=norm(target.position.x-cue.position.x,target.position.y-cue.position.y);
        const cut=Math.acos(aiClamp(dot(incomingToTarget,outDir),-1,1));
        const cutDeg=cut*180/Math.PI;
        if(cutDeg>maxCutDeg) continue;
        const T=this.world.table||TABLE,hx=T.width/2-R*1.02, hz=T.length/2-R*1.02;
        if(Math.abs(ghost.x)>hx||Math.abs(ghost.y)>hz) continue;
        if(!pathClear(this.world,cue.position,ghost,{exclude:[cue,target],clearance:R*1.96})) continue;
        if(!pathClear(this.world,target.position,pocket,{exclude:[cue,target],clearance:R*1.94})) continue;

        const cueDistance=aiDist(cue.position,ghost), objectDistance=aiDist(target.position,pocket);
        const pocketTightness=pocket.type==='middle' ? 0.92 : 1;
        const geomScore=100
          - cueDistance*11
          - objectDistance*12
          - Math.pow(cutDeg/82,1.6)*49
          + (target.value||1)*2.7
          + pocketTightness*2;
        const power=aiClamp(0.30+cueDistance*0.085+objectDistance*0.055+(cutDeg/90)*0.10,0.24,0.84);
        const confidence=aiClamp(1-(cutDeg/90)*0.58-(cueDistance/3.8)*0.16-(objectDistance/3.8)*0.18,0.05,0.99);
        out.push({
          intent:'pot',target,targetName:target.name,pocket,pocketName:pocket.name,
          ghost,angle:angleForDirection(cueDir),power,spinX:0,spinY:0,
          cutDeg,cueDistance,objectDistance,confidence,geomScore,
        });
      }
    }
    return out.sort((a,b)=>b.geomScore-a.geomScore);
  }

  directHitCandidate(target,{offset=0,power=0.30}={}){
    const cue=this.world.balls.find(b=>b.kind==='cue'&&!b.potted);
    if(!cue||!target) return null;
    const base=norm(target.position.x-cue.position.x,target.position.y-cue.position.y);
    const perp={x:-base.y,y:base.x};
    const aim={x:target.position.x+perp.x*offset,y:target.position.y+perp.y*offset};
    const d=norm(aim.x-cue.position.x,aim.y-cue.position.y);
    return {intent:'safety',target,targetName:target.name,angle:angleForDirection(d),power,spinX:0,spinY:0,aim};
  }

  nearestLegalTarget(match){
    const cue=match.cueBall();
    return legalTargets(match).sort((a,b)=>aiDist(cue.position,a.position)-aiDist(cue.position,b.position))[0]||null;
  }

  namedBall(name){ return findBall(this.world,name); }
}
