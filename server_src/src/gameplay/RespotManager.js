import { TABLE } from '../config.js';
import { COLOUR_ORDER } from '../game/BallRegistry.js';
import { COLOUR_SPOTS, D_AREA } from '../game/SnookerSetup.js';

export class RespotManager {
  constructor(world){ this.world=world; }

  isFree(x,z,exclude=null,clearance=0.0008){
    for(const b of this.world.balls){
      if(b===exclude || b.potted || b.offTable) continue;
      const rr=(b.radius + (exclude?.radius ?? TABLE.ballRadius) + clearance);
      const dx=b.position.x-x, dz=b.position.y-z;
      if(dx*dx+dz*dz < rr*rr) return false;
    }
    return true;
  }

  #restore(ball,x,z){
    ball.position.set(x,z);
    ball.velocity.set(0,0);
    ball.angularVelocity=[0,0,0];
    ball.potted=false;
    ball.offTable=false;
    ball.fall=0;
    ball.pocketDrop=null;
    ball.sleeping=true;
    ball.sleepTimer=0;
    ball.motionState='rest';
    ball.slipSpeed=0;
    return {x,z};
  }

  respotColour(ball){
    if(!ball || ball.kind!=='colour') return null;
    const own=COLOUR_SPOTS[ball.name];
    if(own && this.isFree(own.x,own.z,ball)) return this.#restore(ball,own.x,own.z);

    // Snooker-style fallback: highest-value free colour spot first.
    for(const name of [...COLOUR_ORDER].reverse()){
      const p=COLOUR_SPOTS[name];
      if(this.isFree(p.x,p.z,ball)) return this.#restore(ball,p.x,p.z);
    }

    // If every colour spot is occupied, search the ball's own longitudinal
    // spot line in tiny deterministic increments. This avoids overlap and
    // keeps the result stable/replayable.
    if(own){
      const step=TABLE.ballRadius*0.32;
      for(let i=1;i<450;i++){
        for(const sign of [1,-1]){
          const z=own.z+sign*i*step;
          if(Math.abs(z) > TABLE.length/2-TABLE.ballRadius*1.1) continue;
          if(this.isFree(own.x,z,ball)) return this.#restore(ball,own.x,z);
        }
      }
    }
    return null;
  }

  validDPosition(normalizedX=0,depth=0.55,cueBall=null){
    const nx=Math.max(-1,Math.min(1,normalizedX));
    const dep=Math.max(0.04,Math.min(0.96,depth));
    const x=D_AREA.centerX + nx*(D_AREA.radius-TABLE.ballRadius*0.65);
    const halfChord=Math.sqrt(Math.max(0,D_AREA.radius*D_AREA.radius-(x-D_AREA.centerX)**2));
    const z=D_AREA.baulkZ - halfChord*dep;
    return {x,z,free:this.isFree(x,z,cueBall,0.0015)};
  }

  findCueInDPosition(cueBall,normalizedX=0,depth=0.55){
    if(!cueBall) return null;
    const first=this.validDPosition(normalizedX,depth,cueBall);
    if(first.free) return first;

    // Dense deterministic search across the D.  The previous small list of
    // samples could fail on a crowded baulk end and leave the restored cue
    // ball at its old pocket position.  This search guarantees that every
    // practical free patch of the D is considered.
    const depths=[0.55,0.42,0.68,0.30,0.80,0.18,0.90,0.08];
    const xs=[0,0.14,-0.14,0.28,-0.28,0.42,-0.42,0.56,-0.56,0.70,-0.70,0.84,-0.84,0.96,-0.96];
    for(const dep of depths) for(const nx of xs){
      const q=this.validDPosition(nx,dep,cueBall);
      if(q.free) return q;
    }
    // Final fine grid for unusual clusters.
    for(let di=1;di<=18;di++){
      const dep=di/19;
      for(let xi=-18;xi<=18;xi++){
        const nx=xi/19,q=this.validDPosition(nx,dep,cueBall);
        if(q.free) return q;
      }
    }
    return null;
  }

  placeCueInD(cueBall,normalizedX=0,depth=0.55){
    const p=this.findCueInDPosition(cueBall,normalizedX,depth);
    return p ? this.#restore(cueBall,p.x,p.z) : null;
  }
}
