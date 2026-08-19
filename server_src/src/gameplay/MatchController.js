import { COLOUR_ORDER, isRed, isColour, valueOf, displayBall } from '../game/BallRegistry.js';
import { findBall, D_AREA } from '../game/SnookerSetup.js';
import { ShotTracker } from './ShotTracker.js';
import { RespotManager } from './RespotManager.js';

function uniq(arr){ return [...new Set(arr)]; }

export class MatchController {
  constructor(world,{player1='Player 1',player2='Player 2'}={}){
    this.world=world;
    this.tracker=new ShotTracker();
    this.respotter=new RespotManager(world);
    this.players=[{name:player1,score:0,break:0},{name:player2,score:0,break:0}];
    this.onStateChange=null;
    this.onMessage=null;
    this.onFrameEnd=null;
    this.resetFrame(false);
  }

  resetFrame(resetScores=true){
    if(resetScores){ for(const p of this.players){p.score=0;p.break=0;} }
    this.turn=0;
    this.stage='reds'; // reds | finalColour | colours | respottedBlack | over
    this.expected='red';
    this.clearanceIndex=0;
    this.ballInHandD=false;
    this.pendingCueScratch=false;
    this.shotActive=false;
    this.frameWinner=null;
    this.lastResult=null;
    this.tracker.cancel();
    const cue=this.cueBall?.();if(cue)cue.inHand=false;
    this.emitState();
  }

  get active(){ return this.players[this.turn]; }
  get opponent(){ return this.players[1-this.turn]; }
  redsRemaining(){ return this.world.balls.filter(b=>b.kind==='red'&&!b.potted&&!b.offTable).length; }
  cueBall(){ return findBall(this.world,'Cue'); }

  isLegalFirstHit(ball){
    return this.#legalFirstHit(this.#context(),ball);
  }

  ballOnText(){
    if(this.stage==='over') return 'FRAME OVER';
    if(this.stage==='respottedBlack') return 'BLACK';
    if(this.stage==='colours') return COLOUR_ORDER[this.clearanceIndex]?.toUpperCase() || '—';
    if(this.stage==='finalColour') return 'COLOUR';
    return this.expected==='red' ? 'RED' : 'COLOUR';
  }

  #context(){
    return {
      stage:this.stage,
      expected:this.expected,
      clearanceIndex:this.clearanceIndex,
      redsAtStart:this.redsRemaining(),
      ballOnText:this.ballOnText(),
      turn:this.turn,
    };
  }

  // Public legality query used by the aim-assist foul hint. It mirrors the
  // exact first-contact rule used when the shot is later adjudicated.
  isLegalFirstContact(ball){
    if(!ball || this.stage==='over') return false;
    return this.#legalFirstHit(this.#context(),ball);
  }

  canShoot(){
    return this.stage!=='over' && !this.ballInHandD && !this.shotActive && this.world.allStopped();
  }

  beginShot(){
    if(!this.canShoot()) return false;
    this.shotActive=true;
    this.tracker.begin(this.#context());
    this.emitState();
    return true;
  }

  cancelShot(){ this.shotActive=false; this.tracker.cancel(); this.emitState(); }
  recordCollision(a,b){ this.tracker.collision(a,b); }
  recordPocket(ball){ if(ball?.kind==='cue') this.pendingCueScratch=true; this.tracker.pocket(ball); }
  recordOffTable(ball){ if(ball?.kind==='cue') this.pendingCueScratch=true; this.tracker.ballOffTable(ball); }

  #requiredName(ctx){
    if(ctx.stage==='colours') return COLOUR_ORDER[ctx.clearanceIndex] || null;
    if(ctx.stage==='respottedBlack') return 'Black';
    return null;
  }

  #legalFirstHit(ctx,first){
    if(!first) return false;
    if(ctx.stage==='reds') return ctx.expected==='red' ? isRed(first) : isColour(first);
    if(ctx.stage==='finalColour') return isColour(first);
    const req=this.#requiredName(ctx);
    return !!req && first.name===req;
  }

  #ballOnValue(ctx,first){
    if(ctx.stage==='colours') return valueOf(findBall(this.world,COLOUR_ORDER[ctx.clearanceIndex]));
    if(ctx.stage==='respottedBlack') return 7;
    if((ctx.stage==='finalColour'||(ctx.stage==='reds'&&ctx.expected==='colour')) && first && isColour(first)) return valueOf(first);
    return 1;
  }

  #illegalPots(ctx,first,potted){
    if(ctx.stage==='reds' && ctx.expected==='red') return potted.filter(b=>!isRed(b));
    if(ctx.stage==='reds' && ctx.expected==='colour' || ctx.stage==='finalColour'){
      const nominated=(first&&isColour(first))?first.name:null;
      return potted.filter(b=>!nominated || b.name!==nominated);
    }
    const req=this.#requiredName(ctx);
    return potted.filter(b=>b.name!==req);
  }

  #foulPenalty(ctx,report,wrongFirst,illegalPots){
    let highest=Math.max(4,this.#ballOnValue(ctx,report.firstHit));
    if(wrongFirst && report.firstHit) highest=Math.max(highest,valueOf(report.firstHit));
    for(const b of [...illegalPots,...report.offTable]) highest=Math.max(highest,valueOf(b));
    return Math.max(4,Math.min(7,highest));
  }

  #switchTurn(){
    this.active.break=0;
    this.turn=1-this.turn;
    this.active.break=0;
  }

  #respotColours(balls){
    for(const b of uniq(balls).filter(isColour)) this.respotter.respotColour(b);
  }

  #resetCueBody(cue,x,z,inHand=this.ballInHandD){
    if(!cue) return null;cue.position.set(x,z);cue.velocity.set(0,0);cue.angularVelocity[0]=cue.angularVelocity[1]=cue.angularVelocity[2]=0;cue.potted=false;cue.offTable=false;cue.inHand=!!inHand;cue.fall=0;cue.pocketDrop=null;cue.sleeping=true;cue.sleepTimer=0;cue.motionState='rest';cue.slipSpeed=0;return {x,z};
  }

  #cueInsideD(cue){
    if(!cue||cue.potted||cue.offTable||!Number.isFinite(cue.position.x)||!Number.isFinite(cue.position.y))return false;
    const dx=cue.position.x-D_AREA.centerX,dz=cue.position.y-D_AREA.baulkZ;
    return cue.position.y<=D_AREA.baulkZ+.0015 && dx*dx+dz*dz<=D_AREA.radius*D_AREA.radius+.0008;
  }

  #prepareCueInD(){
    const cue=this.cueBall();
    this.ballInHandD=true;
    if(!cue)return false;
    cue.potted=false;cue.offTable=false;cue.fall=0;cue.pocketDrop=null;
    const placed=this.respotter.placeCueInD(cue,0,0.55);
    if(placed){this.#resetCueBody(cue,placed.x,placed.z,true);return true;}
    // Absolute last-resort visible point.  A dense D search should make this
    // unreachable in normal play, but never leave the white ball at a pocket.
    const fallback={x:D_AREA.centerX,z:D_AREA.baulkZ-D_AREA.radius*.55};
    this.#resetCueBody(cue,fallback.x,fallback.z,true);
    return true;
  }

  ensureCueBallInHandVisible(){
    if(!this.ballInHandD)return false;const cue=this.cueBall();if(!cue)return false;
    if(!this.#cueInsideD(cue))this.#prepareCueInD();
    return this.#cueInsideD(cue);
  }

  // Runtime-facing hard guarantee used after a physical scratch. This is kept
  // separate from foul scoring: it only repairs the already-awarded in-hand
  // state and never changes turn/points. Re-running it is intentionally safe.
  forceCueBallRecovery(){
    if(!this.ballInHandD)return false;
    return this.#prepareCueInD();
  }

  // v4.6.5: stage the physical white ball immediately when the pocket event
  // happens. The ShotTracker/pendingCueScratch flags preserve the foul even
  // though the live cue body is un-potted for visibility and safety. This
  // removes the fragile gap between pocket animation, shot adjudication, turn
  // switching and later ball-in-hand recovery.
  stageCueScratch(){
    this.pendingCueScratch=true;
    const ok=this.#prepareCueInD();
    if(ok)this.emitState();
    return ok;
  }

  previewCueInD(nx,depth){
    if(!this.ballInHandD) return {ok:false,reason:'Cue ball is not in hand.'};
    const cue=this.cueBall(),p=this.respotter.validDPosition(nx,depth,cue);if(!p.free)return{ok:false,reason:'That D position is occupied.'};
    this.#resetCueBody(cue,p.x,p.z,true);return{ok:true,position:{x:p.x,z:p.z},committed:false};
  }

  placeCueInD(nx,depth){
    if(!this.ballInHandD) return {ok:false,reason:'Cue ball is not in hand.'};
    const preview=this.previewCueInD(nx,depth);if(!preview.ok)return preview;this.ballInHandD=false;const cue=this.cueBall();if(cue)cue.inHand=false;this.message('CUE BALL PLACED IN THE D');this.emitState();return{ok:true,position:preview.position,committed:true};
  }

  finishShot(forcedReport=null){
    if(!this.shotActive && !forcedReport) return null;
    const report=forcedReport || this.tracker.end();
    this.shotActive=false;
    const ctx=report.context || this.#context();
    const wrongFirst=!this.#legalFirstHit(ctx,report.firstHit);
    const illegalPots=this.#illegalPots(ctx,report.firstHit,report.potted);
    const cue=this.cueBall();
    const cueFoul=report.cuePotted||report.cueOffTable||this.pendingCueScratch||!!cue?.potted||!!cue?.offTable;
    const offTableFoul=report.offTable.length>0;
    const foul=wrongFirst||illegalPots.length>0||cueFoul||offTableFoul;

    if(foul){
      const penalty=this.#foulPenalty(ctx,report,wrongFirst,illegalPots);
      const fouler=this.turn;
      this.players[1-fouler].score+=penalty;
      this.players[fouler].break=0;
      this.#respotColours([...report.potted,...report.offTable]);

      // Reds potted/forced off during a foul remain off the table. If that removed
      // the final red, clearance begins; otherwise the incoming player is on a red.
      if(ctx.stage==='finalColour'){
        this.stage='colours'; this.clearanceIndex=0; this.expected='red';
      } else if(ctx.stage==='reds'){
        if(this.redsRemaining()===0){ this.stage='colours'; this.clearanceIndex=0; }
        else { this.stage='reds'; this.expected='red'; }
      } else if(ctx.stage==='respottedBlack'){
        this.#switchTurn();
        this.endFrame(this.players[1-fouler].score>this.players[fouler].score ? 1-fouler : fouler,`Foul on re-spotted black — ${penalty}`);
        this.lastResult={foul:true,penalty,reason:this.#foulReason(report,wrongFirst,illegalPots),report};
        return this.lastResult;
      }

      this.#switchTurn();
      if(cueFoul) this.#prepareCueInD();
      this.pendingCueScratch=false;
      const reason=this.#foulReason(report,wrongFirst,illegalPots);
      this.message(`FOUL — ${penalty} POINT${penalty===1?'':'S'} · ${reason}`);
      this.lastResult={foul:true,penalty,reason,report};
      this.emitState();
      return this.lastResult;
    }

    this.pendingCueScratch=false;
    const legalPots=report.potted;
    let points=0;
    let continueTurn=false;

    if(ctx.stage==='reds' && ctx.expected==='red'){
      const reds=legalPots.filter(isRed);
      points=reds.length;
      if(points>0){
        this.active.score+=points; this.active.break+=points; continueTurn=true;
        if(this.redsRemaining()===0){ this.stage='finalColour'; }
        else { this.stage='reds'; this.expected='colour'; }
      } else {
        this.stage='reds'; this.expected='red';
      }
    } else if((ctx.stage==='reds' && ctx.expected==='colour') || ctx.stage==='finalColour'){
      const colour=legalPots.find(isColour) || null;
      if(colour){
        points=valueOf(colour);
        this.active.score+=points; this.active.break+=points; continueTurn=true;
        this.respotter.respotColour(colour);
      }
      if(ctx.stage==='finalColour'){
        this.stage='colours'; this.clearanceIndex=0;
      } else {
        this.stage='reds'; this.expected='red';
      }
    } else if(ctx.stage==='colours'){
      const req=COLOUR_ORDER[ctx.clearanceIndex];
      const colour=legalPots.find(b=>b.name===req) || null;
      if(colour){
        points=valueOf(colour);
        this.active.score+=points; this.active.break+=points; continueTurn=true;
        this.clearanceIndex++;
        if(this.clearanceIndex>=COLOUR_ORDER.length){
          if(this.players[0].score===this.players[1].score){
            const black=findBall(this.world,'Black');
            this.respotter.respotColour(black);
            this.stage='respottedBlack';
            this.#switchTurn();
            this.#prepareCueInD();
            continueTurn=true; // prevents a second switch below
            this.message('SCORES LEVEL — RE-SPOTTED BLACK');
          } else {
            const winner=this.players[0].score>this.players[1].score?0:1;
            this.endFrame(winner,'Final black potted');
            this.lastResult={foul:false,points,frameOver:true,report};
            return this.lastResult;
          }
        }
      }
    } else if(ctx.stage==='respottedBlack'){
      const black=legalPots.find(b=>b.name==='Black');
      if(black){
        points=7; this.active.score+=7; this.active.break+=7;
        this.endFrame(this.turn,'Re-spotted black potted');
        this.lastResult={foul:false,points,frameOver:true,report};
        return this.lastResult;
      }
    }

    if(points>0) this.message(`${this.active.name.toUpperCase()} +${points} · BREAK ${this.active.break}`);
    else this.message('NO POT');

    if(!continueTurn){
      this.#switchTurn();
      if(this.stage==='reds') this.expected='red';
    }

    this.lastResult={foul:false,points,report};
    this.emitState();
    return this.lastResult;
  }

  #foulReason(report,wrongFirst,illegalPots){
    if(report.cuePotted) return 'CUE BALL POTTED';
    if(report.cueOffTable) return 'CUE BALL OFF TABLE';
    if(!report.firstHit) return 'NO BALL CONTACTED';
    if(wrongFirst) return `WRONG BALL FIRST (${displayBall(report.firstHit)})`;
    if(illegalPots.length) return `ILLEGAL POT (${displayBall(illegalPots[0])})`;
    if(report.offTable.length) return `${displayBall(report.offTable[0])} OFF TABLE`;
    return 'FOUL';
  }

  endFrame(winnerIndex,reason='Frame complete'){
    this.stage='over';
    this.frameWinner=winnerIndex;
    this.ballInHandD=false;
    this.players[0].break=0; this.players[1].break=0;
    const winner=this.players[winnerIndex];
    this.message(`FRAME — ${winner.name.toUpperCase()} WINS ${this.players[0].score}–${this.players[1].score}`);
    this.onFrameEnd?.({winnerIndex,winner,reason,scores:this.players.map(p=>p.score)});
    this.emitState();
  }

  state(){
    return {
      players:this.players.map(p=>({...p})),
      turn:this.turn,
      stage:this.stage,
      ballOn:this.ballOnText(),
      redsRemaining:this.redsRemaining(),
      ballInHandD:this.ballInHandD,
      shotActive:this.shotActive,
      frameWinner:this.frameWinner,
    };
  }
  emitState(){ this.onStateChange?.(this.state()); }
  message(text){ this.onMessage?.(text); }
}
