import { PHYSICS } from '../config.js';
import { Ball } from './Ball.js';
import { PhysicsWorld } from './PhysicsWorld.js';
import { CueController } from '../game/CueController.js';

// Cached aim-assist simulator.  It deliberately uses the exact same Ball,
// PhysicsWorld, CueController, cushion and pocket code as live play so spin and
// power previews cannot drift into a separate "fake guide" model.
export class TrajectoryPredictor {
  constructor(){this.world=new PhysicsWorld();this.pool=new Map();this.byName=new Map();}
  #get(src){
    let b=this.pool.get(src.name);
    if(!b){b=new Ball({name:src.name,color:src.color,x:src.position.x,z:src.position.y,radius:src.radius,mass:src.mass});this.pool.set(src.name,b);this.world.addBall(b);}
    return b;
  }
  #reset(source){
    this.byName.clear();this.world.accumulator=0;this.world.time=0;this.world.totalSteps=0;
    const seen=new Set();
    for(const src of source.balls){
      const b=this.#get(src);seen.add(src.name);b.name=src.name;b.color=src.color;b.kind=src.kind;b.value=src.value;b.spotName=src.spotName;
      b.position.x=src.position.x;b.position.y=src.position.y;b.velocity.set(0,0);b.angularVelocity[0]=b.angularVelocity[1]=b.angularVelocity[2]=0;
      b.orientation[0]=src.orientation[0];b.orientation[1]=src.orientation[1];b.orientation[2]=src.orientation[2];b.orientation[3]=src.orientation[3];
      b.potted=!!src.potted;b.offTable=!!src.offTable;b.sleeping=true;b.sleepTimer=0;b.lastCollision=0;b.motionState='rest';b.slipSpeed=0;
      if(!b.potted)this.byName.set(b.name,b);
    }
    for(const [name,b] of this.pool)if(!seen.has(name)){b.potted=true;b.offTable=true;b.sleeping=true;}
  }
  predict(source,shot,{seconds=1.2,sampleEvery=3}={}){
    this.#reset(source);const world=this.world,cue=this.byName.get('Cue');if(!cue)return null;
    let firstHit=null,firstImpactCue=null,firstImpactTarget=null,firstHitSample=-1;
    world.onCollision=(a,b)=>{
      if(firstHit)return;let other=null;
      if(a.name==='Cue'&&b.name!=='Cue')other=b;else if(b.name==='Cue'&&a.name!=='Cue')other=a;
      if(other){firstHit=other;firstImpactCue={x:cue.position.x,z:cue.position.y};firstImpactTarget={x:other.position.x,z:other.position.y};}
    };
    world.onPocket=null;world.onOffTable=null;world.onCushion=null;
    const ctrl=new CueController(world,cue);ctrl.angle=shot.angle;ctrl.power=shot.power;ctrl.spinX=shot.spinX||0;ctrl.spinY=shot.spinY||0;
    if(!ctrl.strike(shot.power))return null;
    const cuePath=[{x:cue.position.x,z:cue.position.y}],objectPath=[];
    let tracked=null;
    const maxSteps=Math.ceil(seconds/PHYSICS.fixedDt);
    for(let i=0;i<maxSteps;i++){
      world.step(PHYSICS.fixedDt);
      if(firstHit&&!tracked){tracked=firstHit;firstHitSample=cuePath.length-1;}
      if(i%sampleEvery===0){
        if(!cue.potted)cuePath.push({x:cue.position.x,z:cue.position.y});
        if(tracked&&!tracked.potted)objectPath.push({x:tracked.position.x,z:tracked.position.y});
      }
      if(i>10&&world.allStopped())break;
    }
    return {cuePath,objectPath,firstHit:firstHit?.name||null,firstHitSample,firstImpactCue,firstImpactTarget};
  }
}
