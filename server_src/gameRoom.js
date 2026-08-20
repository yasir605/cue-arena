import { randomUUID } from 'node:crypto';
import { PhysicsWorld } from './src/physics/PhysicsWorld.js';
import { createStandardBalls } from './src/game/SnookerSetup.js';
import { createEightBallBalls,createNineBallBalls } from './src/game/PoolSetup.js';
import { CueController } from './src/game/CueController.js';
import { MatchController } from './src/gameplay/MatchController.js';
import { PoolMatchController } from './src/gameplay/PoolMatchController.js';
import { PHYSICS } from './src/config.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=(v,d=0)=>Number.isFinite(+v)?+v:d;

function makeRack(world,mode){if(mode==='8ball')return createEightBallBalls(world);if(mode==='9ball')return createNineBallBalls(world);return createStandardBalls(world);}

function ballKey(b){return b.number!=null?`n:${b.number}`:`name:${b.name}`;}
function serializeBall(b){return{key:ballKey(b),name:b.name,number:b.number??null,kind:b.kind,poolGroup:b.poolGroup??null,color:b.color,x:b.position.x,z:b.position.y,vx:b.velocity.x,vz:b.velocity.y,w:[...b.angularVelocity],q:[...b.orientation],potted:!!b.potted,offTable:!!b.offTable,inHand:!!b.inHand,sleeping:!!b.sleeping,motionState:b.motionState,fall:b.fall||0};}
function serializeMotionBall(b){return[ballKey(b),b.position.x,b.position.y,b.velocity.x,b.velocity.y,b.orientation[0],b.orientation[1],b.orientation[2],b.orientation[3],b.potted?1:0,b.fall||0,b.inHand?1:0];}

export class GameRoom {
  constructor(code,mode='snooker'){
    this.code=code;this.mode=['snooker','8ball','9ball'].includes(mode)?mode:'snooker';this.players=[null,null];this.world=new PhysicsWorld();this.cueBall=makeRack(this.world,this.mode);this.cue=new CueController(this.world,this.cueBall);this.match=this.mode==='snooker'?new MatchController(this.world):new PoolMatchController(this.world,{mode:this.mode});this.seq=0;this.animating=false;this.animatingUntil=0;this.lastResult=null;this.rematchVotes=new Set();this.#wire();
  }
  #wire(){this.world.onCollision=(a,b)=>this.match.recordCollision(a,b);this.world.onCushion=b=>this.match.recordCushion?.(b);this.world.onPocket=b=>this.match.recordPocket(b);this.world.onOffTable=b=>this.match.recordOffTable(b);}
  setNames(){for(let i=0;i<2;i++)if(this.players[i])this.match.players[i].name=this.players[i].name;}
  ready(){return !!(this.players[0]&&this.players[1]);}
  seatFor(ws){return this.players.findIndex(p=>p?.ws===ws);}
  addPlayer(ws,name){const seat=this.players[0]?this.players[1]? -1:1:0;if(seat<0)return -1;this.players[seat]={ws,name:(String(name||`Player ${seat+1}`).trim().slice(0,18)||`Player ${seat+1}`),id:randomUUID()};this.setNames();return seat;}
  remove(ws){const seat=this.seatFor(ws);if(seat>=0)this.players[seat]=null;return seat;}
  broadcast(msg){const data=JSON.stringify(msg);for(const p of this.players)if(p?.ws?.readyState===1)p.ws.send(data);}
  broadcastExcept(ws,msg){const data=JSON.stringify(msg);for(const p of this.players)if(p?.ws!==ws&&p?.ws?.readyState===1)p.ws.send(data);}
  snapshot(){return{seq:this.seq,code:this.code,mode:this.mode,ready:this.ready(),match:{...this.match.state(),expected:this.match.expected,clearanceIndex:this.match.clearanceIndex,breakShot:this.match.breakShot,openTable:this.match.openTable,players:this.match.players.map(p=>({...p}))},balls:this.world.balls.map(serializeBall)};}
  reset(){this.world.clear();this.cueBall=makeRack(this.world,this.mode);this.cue.setCueBall(this.cueBall);this.match=this.mode==='snooker'?new MatchController(this.world):new PoolMatchController(this.world,{mode:this.mode});this.setNames();this.seq++;this.rematchVotes.clear();this.#wire();return this.snapshot();}
  canSeatAct(seat){return this.ready()&&!this.animating&&seat===this.match.turn&&this.match.stage!=='over';}
  placeCue(seat,x,z){if(!this.canSeatAct(seat))return{ok:false,error:'Not your turn.'};if(!(this.match.ballInHandD||this.match.ballInHandAnywhere))return{ok:false,error:'Cue ball is not in hand.'};let r;if(this.match.ballInHandAnywhere)r=this.match.placeCueAnywhere(finite(x),finite(z));else{
      const D={centerX:0,baulkZ:-1.355,radius:.292};const dx=finite(x)-D.centerX,dz=finite(z)-D.baulkZ;if(finite(z)>D.baulkZ||dx*dx+dz*dz>D.radius*D.radius)return{ok:false,error:'Place inside the D.'};const usable=D.radius-(this.cueBall.radius||.02625)*.65,nx=clamp(dx/usable,-1,1),half=Math.sqrt(Math.max(.0001,D.radius*D.radius-dx*dx)),depth=clamp((D.baulkZ-finite(z))/half,.04,.96);r=this.match.placeCueInD(nx,depth);
    }
    if(r?.ok){this.seq++;return{ok:true,snapshot:this.snapshot()};}return{ok:false,error:r?.reason||'Invalid placement.'};
  }
  simulateShot(seat,shot){
    if(!this.canSeatAct(seat))return{ok:false,error:'Not your turn or table is busy.'};if(this.match.ballInHandD||this.match.ballInHandAnywhere)return{ok:false,error:'Place the cue ball first.'};
    const angle=finite(shot.angle),power=clamp(finite(shot.power,.45),.02,1),spinX=clamp(finite(shot.spinX),-1,1),spinY=clamp(finite(shot.spinY),-1,1);
    const start=this.snapshot();
    if(!this.match.beginShot())return{ok:false,error:'Shot rejected.'};
    this.cue.angle=angle;this.cue.power=power;this.cue.spinX=spinX;this.cue.spinY=spinY;
    if(!this.cue.strike(power)){this.match.cancelShot();return{ok:false,error:'Cue strike failed.'};}
    let steps=0,maxSteps=Math.ceil(18/PHYSICS.fixedDt),everMoving=false;
    const motionFrames=[],sampleEvery=4; // authoritative ~30 Hz motion stream
    while(steps<maxSteps){
      this.world.step(PHYSICS.fixedDt);steps++;
      if(!this.world.allStopped())everMoving=true;
      if(steps%sampleEvery===0)motionFrames.push({tMs:Math.round(steps*PHYSICS.fixedDt*1000),balls:this.world.balls.map(serializeMotionBall)});
      if(everMoving&&this.world.allStopped()&&steps>12)break;
    }
    if(!motionFrames.length||motionFrames.at(-1).tMs<Math.round(steps*PHYSICS.fixedDt*1000))motionFrames.push({tMs:Math.round(steps*PHYSICS.fixedDt*1000),balls:this.world.balls.map(serializeMotionBall)});
    const result=this.match.finishShot();this.match.ensureCueBallInHandVisible?.();this.seq++;const final=this.snapshot();
    const durationMs=clamp(Math.round(steps*PHYSICS.fixedDt*1000),450,9000);this.lastResult={result,final,durationMs,shot:{angle,power,spinX,spinY},clientShotId:shot.clientShotId||null};return{ok:true,start,final,result,durationMs,motionFrames,shot:this.lastResult.shot,clientShotId:this.lastResult.clientShotId};
  }
}
