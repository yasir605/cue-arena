import { ShotTracker } from './ShotTracker.js';
import { POOL_TABLE } from '../config.js';
import { POOL_BALL_RADIUS, findPoolBall } from '../game/PoolSetup.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export class PoolMatchController {
  constructor(world,{mode='8ball',player1='Player 1',player2='Player 2'}={}){
    this.world=world;this.mode=mode==='9ball'?'9ball':'8ball';
    this.tracker=new ShotTracker();
    this.players=[{name:player1,score:0,break:0,group:null},{name:player2,score:0,break:0,group:null}];
    this.onStateChange=null;this.onMessage=null;this.onFrameEnd=null;
    this.resetFrame(false);
  }
  resetFrame(resetScores=true){
    if(resetScores)for(const p of this.players){p.score=0;p.break=0;p.group=null;}
    this.turn=0;this.stage='play';this.expected='pool';this.clearanceIndex=0;this.shotActive=false;this.frameWinner=null;this.lastResult=null;
    this.ballInHandD=false;this.ballInHandAnywhere=false;this.pendingCueScratch=false;this.breakShot=true;this.openTable=this.mode==='8ball';this.tracker.cancel();const cue=this.cueBall?.();if(cue)cue.inHand=false;this.emitState();
  }
  get active(){return this.players[this.turn];} get opponent(){return this.players[1-this.turn];}
  cueBall(){return findPoolBall(this.world,0);}
  activeObjectBalls(){return this.world.balls.filter(b=>b.kind==='pool'&&!b.potted&&!b.offTable);}
  redsRemaining(){return this.activeObjectBalls().length;}
  lowestBall(){return this.activeObjectBalls().filter(b=>b.number>0).sort((a,b)=>a.number-b.number)[0]||null;}
  groupRemaining(index=this.turn){const g=this.players[index].group;if(!g)return 0;return this.activeObjectBalls().filter(b=>b.poolGroup===g).length;}
  legalTargetsFor(index=this.turn){
    const active=this.activeObjectBalls();
    if(this.mode==='9ball'){const low=this.lowestBall();return low?[low]:[];}
    const g=this.players[index].group;
    if(!g||this.openTable)return active.filter(b=>b.number!==8);
    const remaining=active.filter(b=>b.poolGroup===g);
    return remaining.length?remaining:active.filter(b=>b.number===8);
  }
  isLegalFirstHit(ball,index=this.turn){
    if(!ball||ball.potted||ball.offTable)return false;
    return this.legalTargetsFor(index).includes(ball);
  }
  nextTargetsAfter(target,index=this.turn){
    if(this.mode==='9ball')return this.activeObjectBalls().filter(b=>b!==target).sort((a,b)=>a.number-b.number).slice(0,1);
    const active=this.activeObjectBalls().filter(b=>b!==target);const g=this.players[index].group;
    if(!g)return active.filter(b=>b.number!==8);
    const own=active.filter(b=>b.poolGroup===g);return own.length?own:active.filter(b=>b.number===8);
  }
  ballOnText(){
    if(this.stage==='over')return 'RACK OVER';
    if(this.mode==='9ball'){const b=this.lowestBall();return b?String(b.number):'9';}
    if(this.openTable)return 'OPEN';
    const g=this.active.group;
    if(g&&this.groupRemaining(this.turn)===0)return '8 BALL';
    return g==='solid'?'SOLIDS':g==='stripe'?'STRIPES':'OPEN';
  }
  stateKey(){return `${this.mode}:${this.turn}:${this.stage}:${this.ballOnText()}:${this.activeObjectBalls().map(b=>b.number).sort((a,b)=>a-b).join(',')}:${this.players.map(p=>p.group||'-').join('/')}`;}
  // Same first-contact legality used by live foul adjudication, exposed to
  // the renderer so an illegal aim can be marked before the player shoots.
  isLegalFirstContact(ball){
    if(!ball||this.stage==='over')return false;
    return this.legalTargetsFor(this.turn).includes(ball);
  }
  canShoot(){return this.stage!=='over'&&!this.ballInHandAnywhere&&!this.shotActive&&this.world.allStopped();}
  beginShot(){if(!this.canShoot())return false;this.shotActive=true;this.tracker.begin({mode:this.mode,turn:this.turn,breakShot:this.breakShot,openTable:this.openTable,groups:this.players.map(p=>p.group),requiredNumber:this.mode==='9ball'?(this.lowestBall()?.number??null):null});this.emitState();return true;}
  cancelShot(){this.shotActive=false;this.tracker.cancel();this.emitState();}
  recordCollision(a,b){this.tracker.collision(a,b);} recordPocket(b){if(b?.kind==='cue')this.pendingCueScratch=true;this.tracker.pocket(b);} recordCushion(b){this.tracker.cushion(b);} recordOffTable(b){if(b?.kind==='cue')this.pendingCueScratch=true;this.tracker.ballOffTable(b);}
  #switchTurn(){this.active.break=0;this.turn=1-this.turn;this.active.break=0;}
  #resetCueBody(cue,x,z){
    if(!cue)return null;
    cue.position.set(x,z);cue.velocity.set(0,0);cue.angularVelocity[0]=cue.angularVelocity[1]=cue.angularVelocity[2]=0;
    cue.potted=false;cue.offTable=false;cue.inHand=!!this.ballInHandAnywhere;cue.fall=0;cue.pocketDrop=null;cue.sleeping=true;cue.sleepTimer=0;cue.motionState='rest';cue.slipSpeed=0;
    return{x,z};
  }
  #cuePosition(x,z,{clampToTable=true}={}){
    const cue=this.cueBall();if(!cue)return{ok:false,reason:'Cue ball is unavailable.'};
    const T=this.world.table||POOL_TABLE,R=cue.radius||POOL_BALL_RADIUS,hx=T.width/2-R-.0012,hz=T.length/2-R-.0012;
    const px=clampToTable?clamp(x,-hx,hx):x,pz=clampToTable?clamp(z,-hz,hz):z;
    if(Math.abs(px)>hx+.00001||Math.abs(pz)>hz+.00001)return{ok:false,reason:'Outside the playable table.'};
    for(const b of this.world.balls){if(b===cue||b.potted||b.offTable)continue;const rr=R+b.radius+.0014,dx=px-b.position.x,dz=pz-b.position.y;if(dx*dx+dz*dz<rr*rr)return{ok:false,reason:'Position is occupied.'};}
    return{ok:true,x:px,z:pz};
  }
  #findCueSpawn(){
    const T=this.world.table||POOL_TABLE,candidates=[[0,-T.length*.26],[0,-T.length*.20],[0,-T.length*.32],[-T.width*.18,-T.length*.24],[T.width*.18,-T.length*.24],[-T.width*.30,-T.length*.16],[T.width*.30,-T.length*.16],[0,-T.length*.08],[-T.width*.22,-T.length*.06],[T.width*.22,-T.length*.06]];
    for(const [x,z] of candidates){const p=this.#cuePosition(x,z);if(p.ok)return p;}
    for(let zi=0;zi<9;zi++)for(let xi=-5;xi<=5;xi++){const x=xi*(T.width*.07),z=-T.length*.34+zi*(T.length*.075),p=this.#cuePosition(x,z);if(p.ok)return p;}
    return this.#cuePosition(0,0);
  }
  #setBallInHand(){
    this.ballInHandAnywhere=true;const cue=this.cueBall();if(!cue)return;
    // Un-pot first, then choose a free visible spawn. This guarantees the white
    // ball exists on the cloth as soon as the foul is adjudicated.
    cue.potted=false;cue.offTable=false;cue.fall=0;cue.pocketDrop=null;
    const p=this.#findCueSpawn();
    if(p.ok)this.#resetCueBody(cue,p.x,p.z);else this.#resetCueBody(cue,0,-(this.world.table||POOL_TABLE).length*.22);cue.inHand=true;
  }
  ensureCueBallInHandVisible(){
    if(!this.ballInHandAnywhere)return false;const cue=this.cueBall();if(!cue)return false;
    const T=this.world.table||POOL_TABLE,R=cue.radius||POOL_BALL_RADIUS,hx=T.width/2-R,hz=T.length/2-R;
    const invalid=cue.potted||cue.offTable||!Number.isFinite(cue.position.x)||!Number.isFinite(cue.position.y)||Math.abs(cue.position.x)>hx+.002||Math.abs(cue.position.y)>hz+.002;
    if(invalid){cue.potted=false;cue.offTable=false;const p=this.#findCueSpawn();this.#resetCueBody(cue,p.ok?p.x:0,p.ok?p.z:-T.length*.22);}
    cue.inHand=true;return !cue.potted&&!cue.offTable;
  }

  // Hard runtime guarantee after a scratch. Foul scoring/turn changes have
  // already happened before this is called; this only makes the white ball
  // physically present and draggable again. Safe to call repeatedly.
  forceCueBallRecovery(){
    if(!this.ballInHandAnywhere)return false;
    this.#setBallInHand();
    return this.ensureCueBallInHandVisible();
  }

  // v4.6.5: immediately convert a physically scratched cue ball into the
  // protected in-hand body. Foul evidence stays latched in ShotTracker and
  // pendingCueScratch, so adjudication remains correct while the white ball
  // can no longer vanish between systems.
  stageCueScratch(){
    this.pendingCueScratch=true;
    this.#setBallInHand();
    this.emitState();
    return this.ensureCueBallInHandVisible();
  }
  previewCueAnywhere(x,z){
    if(!this.ballInHandAnywhere)return{ok:false,reason:'Cue ball is not in hand.'};
    const p=this.#cuePosition(x,z);if(!p.ok)return p;this.#resetCueBody(this.cueBall(),p.x,p.z);return{ok:true,position:{x:p.x,z:p.z},committed:false};
  }
  placeCueAnywhere(x,z){
    if(!this.ballInHandAnywhere)return{ok:false,reason:'Cue ball is not in hand.'};
    const r=this.previewCueAnywhere(x,z);if(!r.ok)return r;this.ballInHandAnywhere=false;const cue=this.cueBall();if(cue)cue.inHand=false;this.message('BALL IN HAND PLACED');this.emitState();return{ok:true,position:r.position,committed:true};
  }
  #end(winner,reason){this.stage='over';this.frameWinner=winner;this.shotActive=false;this.players[winner].score+=1;this.message(`${this.players[winner].name.toUpperCase()} WINS · ${reason}`);this.emitState();this.onFrameEnd?.({winner:this.players[winner],winnerIndex:winner,reason});}
  #respot(number){const b=findPoolBall(this.world,number);if(!b)return;const foot={x:0,z:POOL_TABLE.length*.24};let z=foot.z;for(let i=0;i<18;i++){let free=true;for(const o of this.world.balls){if(o===b||o.potted||o.offTable)continue;if(Math.hypot(foot.x-o.position.x,z-o.position.y)<b.radius+o.radius+.001){free=false;break;}}if(free)break;z-=b.radius*2.08;}b.position.set(foot.x,z);b.potted=false;b.offTable=false;b.sleeping=true;b.fall=0;b.velocity.set(0,0);b.angularVelocity[0]=b.angularVelocity[1]=b.angularVelocity[2]=0;}
  finishShot(forcedReport=null){
    if(!this.shotActive&&!forcedReport)return null;
    const r=forcedReport||this.tracker.end();this.shotActive=false;
    const cue=this.cueBall(),cueFoul=r.cuePotted||r.cueOffTable||this.pendingCueScratch||!!cue?.potted||!!cue?.offTable,noHit=!r.firstHit;
    const railOrPot=(r.potted?.length||0)>0||(r.cushions?.length||0)>0;
    const breakLegal=(r.potted?.length||0)>0||(r.cushions?.filter(b=>b.kind==='pool').length||0)>=4;
    let wrongFirst=false,foul=false,win=null,reason='';

    if(this.mode==='9ball'){
      const req=r.context?.requiredNumber??null;
      wrongFirst=!!r.firstHit&&req!=null&&r.firstHit.number!==req;
      foul=cueFoul||noHit||wrongFirst||r.offTable.length>0||(!r.context?.breakShot&&!railOrPot)||(r.context?.breakShot&&!breakLegal);
      const ninePotted=r.potted.some(b=>b.number===9);
      if(foul){
        if(ninePotted||r.offTable.some(b=>b.number===9))this.#respot(9);
        this.#switchTurn();this.#setBallInHand();
        reason=cueFoul?'CUE BALL FOUL':noHit?'NO BALL HIT':wrongFirst?`HIT ${r.firstHit.number} FIRST · ${req} REQUIRED`:r.context?.breakShot&&!breakLegal?'ILLEGAL BREAK':!railOrPot?'NO RAIL AFTER CONTACT':'BALL OFF TABLE';
        this.message(`FOUL · ${reason}`);
      }else if(ninePotted){win=this.turn;this.#end(win,'9 BALL');return{foul:false,win,report:r};}
      else if(r.potted.length){this.active.break+=r.potted.length;this.message(`${this.active.name.toUpperCase()} CONTINUES`);}
      else this.#switchTurn();
    }else{
      const openAtStart=r.context?.openTable??this.openTable,g=this.active.group;
      const ownBefore=g?this.world.balls.filter(b=>b.kind==='pool'&&b.poolGroup===g&&(!b.potted||r.potted.includes(b))).length:0;
      const allowedFirst=openAtStart?['solid','stripe']:(ownBefore>0?[g]:['eight']);
      wrongFirst=!!r.firstHit&&!allowedFirst.includes(r.firstHit.poolGroup);
      foul=cueFoul||noHit||wrongFirst||r.offTable.some(b=>b.number!==8)||(!r.context?.breakShot&&!railOrPot)||(r.context?.breakShot&&!breakLegal);
      const eightPotted=r.potted.some(b=>b.number===8)||r.offTable.some(b=>b.number===8);

      if(eightPotted&&r.context?.breakShot){
        this.#respot(8);
        if(foul){this.#switchTurn();this.#setBallInHand();this.message('FOUL · 8 BALL RESPOTTED');}
        else if(r.potted.some(b=>b.number!==8)){this.active.break++;this.message('8 BALL RESPOTTED · TABLE OPEN');}
        else this.#switchTurn();
        this.openTable=true;
      }else if(eightPotted){
        const legalEight=!foul&&!openAtStart&&ownBefore===0&&r.firstHit?.number===8;
        win=legalEight?this.turn:1-this.turn;this.#end(win,legalEight?'8 BALL':'EARLY 8 BALL');return{foul:!legalEight,win,report:r};
      }else if(foul){
        this.#switchTurn();this.#setBallInHand();
        reason=cueFoul?'CUE BALL FOUL':noHit?'NO BALL HIT':wrongFirst?'WRONG GROUP FIRST':r.context?.breakShot&&!breakLegal?'ILLEGAL BREAK':!railOrPot?'NO RAIL AFTER CONTACT':'BALL OFF TABLE';
        this.message(`FOUL · ${reason}`);
      }else{
        // WPA-style: the table remains open after the break. On later legal shots,
        // the first pocketed solid/stripe assigns the two groups.
        if(openAtStart&&!r.context?.breakShot){
          const firstGroupPot=r.potted.find(b=>b.poolGroup==='solid'||b.poolGroup==='stripe');
          if(firstGroupPot){this.active.group=firstGroupPot.poolGroup;this.opponent.group=firstGroupPot.poolGroup==='solid'?'stripe':'solid';this.openTable=false;this.message(`${this.active.name.toUpperCase()} · ${this.active.group.toUpperCase()}`);}
        }
        const ownPots=this.active.group?r.potted.filter(b=>b.poolGroup===this.active.group).length:r.potted.filter(b=>b.number!==8).length;
        if(ownPots>0){this.active.break+=ownPots;this.message(`${this.active.name.toUpperCase()} CONTINUES`);}else this.#switchTurn();
      }
    }
    this.pendingCueScratch=false;this.breakShot=false;this.lastResult={foul,reason,report:r};this.emitState();return this.lastResult;
  }
  message(t){this.onMessage?.(t);}
  emitState(){this.onStateChange?.(this.state());}
  state(){return{mode:this.mode,players:this.players.map(p=>({...p})),turn:this.turn,stage:this.stage,ballOn:this.ballOnText(),redsRemaining:this.activeObjectBalls().length,ballInHandD:false,ballInHandAnywhere:this.ballInHandAnywhere,shotActive:this.shotActive,frameWinner:this.frameWinner,openTable:this.openTable};}
}
