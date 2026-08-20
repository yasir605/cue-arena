import { PHYSICS } from '../config.js';
import { Ball } from './Ball.js';
import { PhysicsWorld } from './PhysicsWorld.js';
import { CueController } from '../game/CueController.js';

const round=(v,n=5)=>Math.round(v*10**n)/10**n;

// Full deterministic shot preview using the exact live PhysicsWorld and CueController.
// It is local-only and inactive unless explicitly enabled by the hidden hotkey.
export class ProAimPredictor {
  constructor(){
    this.world=new PhysicsWorld();
    this.pool=new Map();
    this.byKey=new Map();
    this.lastSignature='';
    this.lastResult=null;
    this.lastComputeAt=0;
  }
  clear(){this.lastSignature='';this.lastResult=null;this.lastComputeAt=0;}
  #key(src,i){return src.number!=null?`n:${src.number}`:`${src.name||'ball'}:${i}`;}
  #clone(src,key){
    let b=this.pool.get(key);
    if(!b){b=new Ball({name:src.name,color:src.color,x:src.position.x,z:src.position.y,radius:src.radius,mass:src.mass});this.pool.set(key,b);this.world.addBall(b);}
    return b;
  }
  #reset(source){
    this.byKey.clear();
    this.world.setTable(source.table);
    this.world.accumulator=0;this.world.time=0;this.world.totalSteps=0;
    const seen=new Set();
    source.balls.forEach((src,i)=>{
      const key=this.#key(src,i),b=this.#clone(src,key);seen.add(key);
      b.name=src.name;b.color=src.color;b.kind=src.kind;b.value=src.value;b.spotName=src.spotName;b.number=src.number;b.poolGroup=src.poolGroup;
      b.radius=src.radius;b.mass=src.mass;b.invMass=src.invMass;b.inertia=src.inertia;b.invInertia=src.invInertia;
      b.position.x=src.position.x;b.position.y=src.position.y;b.velocity.set(0,0);
      b.angularVelocity[0]=0;b.angularVelocity[1]=0;b.angularVelocity[2]=0;
      if(Array.isArray(src.orientation)&&src.orientation.length===4){for(let q=0;q<4;q++)b.orientation[q]=src.orientation[q];}
      b.potted=!!src.potted;b.offTable=!!src.offTable;b.inHand=false;b.fall=0;b.pocketDrop=null;
      b.sleeping=true;b.sleepTimer=0;b.lastCollision=0;b.motionState='rest';b.slipSpeed=0;
      this.byKey.set(key,b);
    });
    for(const [key,b] of this.pool)if(!seen.has(key)){b.potted=true;b.offTable=true;b.inHand=false;b.sleeping=true;}
  }
  #signature(source,cue){
    const cb=cue.cueBall;
    let s=`${round(source.table?.width||0,4)}|${round(source.table?.length||0,4)}|${round(cue.angle,6)}|${round(cue.power,5)}|${round(cue.spinX,5)}|${round(cue.spinY,5)}|${cb?.name||''}`;
    source.balls.forEach((b,i)=>{s+=`|${this.#key(b,i)}:${round(b.position.x,5)},${round(b.position.y,5)},${b.potted?1:0},${b.offTable?1:0}`;});
    return s;
  }
  predict(source,cue,{maxSeconds=18,sampleEvery=2}={}){
    if(!source?.allStopped?.()||!cue?.cueBall||cue.cueBall.potted||cue.cueBall.inHand)return null;
    const sig=this.#signature(source,cue),now=performance.now();
    if(sig===this.lastSignature&&this.lastResult)return this.lastResult;
    // During a continuously dragged power/aim control, cap expensive exact
    // recomputation while still reacting fast enough to feel live.
    if(this.lastResult&&now-this.lastComputeAt<45)return this.lastResult;
    this.lastComputeAt=now;this.lastSignature=sig;
    this.#reset(source);

    let cueClone=null;
    source.balls.forEach((src,i)=>{if(src===cue.cueBall)cueClone=this.byKey.get(this.#key(src,i));});
    if(!cueClone)return null;

    const tracks=new Map(),meta=new Map(),collisions=[],cushions=[],pockets=[];
    source.balls.forEach((src,i)=>{
      const key=this.#key(src,i);tracks.set(key,[{x:src.position.x,z:src.position.y}]);meta.set(key,{key,name:src.name,color:src.color,kind:src.kind,number:src.number,radius:src.radius});
    });
    const keyOf=b=>{for(const [k,v] of this.byKey)if(v===b)return k;return b.name||'';};
    let simTime=0;
    this.world.onCollision=(a,b)=>{collisions.push({type:'ball',time:simTime,a:keyOf(a),b:keyOf(b),x:(a.position.x+b.position.x)*.5,z:(a.position.y+b.position.y)*.5});};
    this.world.onCushion=(b)=>{cushions.push({type:'cushion',time:simTime,ball:keyOf(b),x:b.position.x,z:b.position.y});};
    this.world.onPocket=(b)=>{pockets.push({type:'pocket',time:simTime,ball:keyOf(b),x:b.position.x,z:b.position.y});};
    this.world.onOffTable=null;

    const ctrl=new CueController(this.world,cueClone);ctrl.angle=cue.angle;ctrl.power=cue.power;ctrl.spinX=cue.spinX||0;ctrl.spinY=cue.spinY||0;
    if(!ctrl.strike(cue.power)){this.lastResult=null;return null;}

    const maxSteps=Math.ceil(maxSeconds/PHYSICS.fixedDt);
    for(let step=0;step<maxSteps;step++){
      this.world.step(PHYSICS.fixedDt);simTime+=PHYSICS.fixedDt;
      if(step%sampleEvery===0){
        for(const [key,b] of this.byKey){
          const arr=tracks.get(key);if(!arr||b.potted)continue;
          const last=arr[arr.length-1],dx=b.position.x-last.x,dz=b.position.y-last.z;
          if(dx*dx+dz*dz>1e-7)arr.push({x:b.position.x,z:b.position.y});
        }
      }
      if(step>12&&this.world.allStopped())break;
    }

    const ends=[];
    for(const [key,b] of this.byKey){
      const arr=tracks.get(key);if(arr&&!b.potted){const last=arr[arr.length-1];if(Math.hypot(b.position.x-last.x,b.position.y-last.z)>.00025)arr.push({x:b.position.x,z:b.position.y});}
      ends.push({key,x:b.position.x,z:b.position.y,potted:!!b.potted,offTable:!!b.offTable});
    }
    this.world.onCollision=this.world.onCushion=this.world.onPocket=this.world.onOffTable=null;
    this.lastResult={tracks:[...tracks.entries()].map(([key,points])=>({...(meta.get(key)||{key}),points})),collisions,cushions,pockets,ends,duration:simTime};
    return this.lastResult;
  }
}
