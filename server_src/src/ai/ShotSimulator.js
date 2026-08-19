import { PHYSICS } from '../config.js';
import { Ball } from '../physics/Ball.js';
import { PhysicsWorld } from '../physics/PhysicsWorld.js';
import { CueController } from '../game/CueController.js';

// Reusable same-physics simulation sandbox. Phase 4 rebuilt an entire world and
// every ball for every candidate. Phase 5 pools those objects to reduce AI GC
// spikes while keeping the exact live PhysicsWorld/CueController path.
export class ShotSimulator {
  constructor({maxSeconds=7.0}={}){
    this.maxSeconds=maxSeconds;
    this.world=new PhysicsWorld();
    this.pool=new Map();
    this.byName=new Map();
  }

  #pooledBall(src){
    let b=this.pool.get(src.name);
    if(!b){
      b=new Ball({name:src.name,color:src.color,x:src.position.x,z:src.position.y,radius:src.radius,mass:src.mass});
      this.pool.set(src.name,b);this.world.addBall(b);
    }
    return b;
  }

  #resetFrom(sourceWorld){
    const world=this.world;world.setTable?.(sourceWorld.table);this.byName.clear();world.accumulator=0;world.time=0;world.totalSteps=0;
    const seen=new Set();
    for(const src of sourceWorld.balls){
      const b=this.#pooledBall(src);seen.add(src.name);
      b.name=src.name;b.color=src.color;b.kind=src.kind;b.value=src.value;b.spotName=src.spotName;b.number=src.number||0;b.poolGroup=src.poolGroup||null;
      b.position.x=src.position.x;b.position.y=src.position.y;b.velocity.x=0;b.velocity.y=0;
      b.angularVelocity[0]=b.angularVelocity[1]=b.angularVelocity[2]=0;
      b.orientation[0]=src.orientation[0];b.orientation[1]=src.orientation[1];b.orientation[2]=src.orientation[2];b.orientation[3]=src.orientation[3];
      b.offTable=!!src.offTable;b.potted=!!src.potted||!!src.offTable;b.sleeping=true;b.sleepTimer=0;b.lastCollision=0;b.fall=src.fall||0;
      if(!b.potted)this.byName.set(b.name,b);
    }
    // Defensive: pooled balls from a different/older layout cannot leak into a simulation.
    for(const [name,b] of this.pool)if(!seen.has(name)){b.potted=true;b.offTable=true;b.sleeping=true;}
  }

  run(sourceWorld,shot,{maxSeconds=this.maxSeconds}={}){
    this.#resetFrom(sourceWorld);
    const world=this.world,byName=this.byName;
    const cue=byName.get('Cue');
    if(!cue)return {valid:false,reason:'NO CUE BALL'};

    let firstHit=null;
    const cueContacts=new Set(),potted=new Set(),offTable=new Set();
    world.onCollision=(a,b)=>{
      let other=null;
      if(a.kind==='cue'&&b.kind!=='cue')other=b;
      else if(b.kind==='cue'&&a.kind!=='cue')other=a;
      if(other){if(!firstHit)firstHit=other.name;cueContacts.add(other.name);}
    };
    world.onPocket=b=>potted.add(b.name);
    world.onOffTable=b=>offTable.add(b.name);

    const ctrl=new CueController(world,cue);
    ctrl.angle=shot.angle;ctrl.power=shot.power;ctrl.spinX=shot.spinX||0;ctrl.spinY=shot.spinY||0;
    if(!ctrl.strike(shot.power))return {valid:false,reason:'STRIKE FAILED'};

    const maxSteps=Math.ceil(maxSeconds/PHYSICS.fixedDt);
    let steps=0;
    for(;steps<maxSteps;steps++){
      world.step(PHYSICS.fixedDt);
      if(steps>8&&world.allStopped())break;
    }
    const cueFinal=byName.get('Cue');
    const finalPositions={};
    for(const [name,b] of byName)finalPositions[name]={x:b.position.x,y:b.position.y,potted:b.potted,offTable:b.offTable};
    const pottedList=[...potted],offTableList=[...offTable],contacts=[...cueContacts];
    return {
      valid:true,firstHit,cueContacts:contacts,potted:pottedList,offTable:offTableList,
      cuePotted:potted.has('Cue')||offTable.has('Cue'),
      targetPotted:shot.targetName?potted.has(shot.targetName):false,
      cueFinal:cueFinal?{x:cueFinal.position.x,y:cueFinal.position.y,potted:cueFinal.potted}:null,
      finalPositions,steps,time:steps*PHYSICS.fixedDt,
    };
  }
}
