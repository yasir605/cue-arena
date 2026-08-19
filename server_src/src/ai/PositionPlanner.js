import { TABLE } from '../config.js';
import { nextTargetsAfter, aiPocketsFor, pathClear } from './ShotAnalyzer.js';

const posClamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const posDist=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y);

export class PositionPlanner {
  constructor(world){ this.world=world; }

  score(match,shot,simulation){
    const cue=simulation?.cueFinal;
    if(!cue||cue.potted) return -180;
    const T=this.world.table||TABLE,hx=T.width/2, hz=T.length/2;
    const railClear=Math.min(hx-Math.abs(cue.x),hz-Math.abs(cue.y));
    let score=posClamp(railClear/0.22,0,1)*9;
    const next=nextTargetsAfter(match,shot.target);
    if(!next.length) return score;

    let best=-Infinity;
    for(const target of next){
      const fp=simulation.finalPositions?.[target.name];
      const targetPos=fp&&!fp.potted?fp:target.position;
      const d=posDist(cue,targetPos);
      let access=34-d*10;
      for(const pocket of aiPocketsFor(this.world)){
        if(pathClear(this.world,target.position,pocket,{exclude:[target],clearance:target.radius*1.95})) access+=1.2;
      }
      if(target.kind==='colour') access+=(target.value||0)*0.8;
      best=Math.max(best,access);
    }
    score+=best;
    return score;
  }

  spinVariants(level,shot){
    if(level==='easy') return [{spinX:0,spinY:0,powerScale:1}];
    if(level==='medium') return [{spinX:0,spinY:0,powerScale:1},{spinX:0,spinY:0.10,powerScale:0.98}];
    const side=Math.sign(Math.sin(shot.angle))*0.06;
    if(level==='hard') return [
      {spinX:0,spinY:0,powerScale:1},
      {spinX:side,spinY:0.20,powerScale:0.98},
      {spinX:-side,spinY:-0.16,powerScale:1.03},
    ];
    return [
      {spinX:0,spinY:0,powerScale:1},
      {spinX:side,spinY:0.25,powerScale:0.96},
      {spinX:-side,spinY:-0.22,powerScale:1.04},
      {spinX:side*1.8,spinY:0.08,powerScale:1.00},
    ];
  }
}
