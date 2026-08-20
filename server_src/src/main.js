import { PhysicsWorld } from './physics/PhysicsWorld.js';
import { createStandardBalls, D_AREA } from './game/SnookerSetup.js';
import { createEightBallBalls, createNineBallBalls } from './game/PoolSetup.js';
import { TABLE } from './config.js';
import { CueController } from './game/CueController.js';
import { InputController } from './input/InputController.js';
import { Renderer2D } from './render/Renderer2D.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { MatchController } from './gameplay/MatchController.js';
import { PoolMatchController } from './gameplay/PoolMatchController.js';
import { AIController } from './ai/AIController.js';
import { OnlineClient } from './network/OnlineClient.js';

const $=s=>document.querySelector(s),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const canvas=$('#game'),world=new PhysicsWorld();
let gameMode='snooker',cueBall=createStandardBalls(world),cue=new CueController(world,cueBall),view=new Renderer2D(canvas,world,cue),audio=new AudioEngine();
const MOBILE_DEVICE=!!((globalThis.matchMedia?.('(pointer: coarse)')?.matches)||(navigator.maxTouchPoints>0));document.body.classList.toggle('mobile-ui',MOBILE_DEVICE);view.setMobileOptimized?.(MOBILE_DEVICE);view.setQuality(MOBILE_DEVICE?'mobile':'high');view.setRenderScale(MOBILE_DEVICE?.72:1);
cue.angle=0;cue.power=.45;view.setGameMode(gameMode);
let aiMode=true,aiDifficulty='medium',match=null,ai=null,lastAITurn=false,humanCue={spinX:0,spinY:0,power:.45},statusTimer=0,shotClock=0,wasMoving=false,breakRails=[[],[]],lastHUDTurn=0,cueScratchLatched=false,cueRecoveryHoldUntil=0;
let onlineMode=false,onlineReady=false,onlineSeat=null,onlineAnimating=false,onlinePendingShot=false,onlineRoomCode='',onlineLastSnapshot=null,onlineShotSeq=0,onlineStreamActive=false,onlineAimLastSent=0,onlineAimPullback=0;
let onlineLocalCue={angle:0,power:.45,spinX:0,spinY:0};
const online=new OnlineClient({onStatus:s=>updateNetworkBadge(s),onMessage:handleOnlineMessage,onClose:()=>{if(onlineMode){onlineReady=false;onlineAnimating=false;onlineStreamActive=false;showStatus('CONNECTION LOST',2200,'foul');renderHUD();}}});

function isPool(){return gameMode==='8ball'||gameMode==='9ball';}
function isBallInHand(){return !!(match?.ballInHandD||match?.ballInHandAnywhere);}
function humanOwnsTurn(){return onlineMode?onlineReady&&onlineSeat===match?.turn:!ai?.isAITurn(match);}
function canHumanAim(){return !!match&&!onlineAnimating&&!onlinePendingShot&&!match.shotActive&&!view.isStrokeAnimating()&&!isBallInHand()&&match.stage!=='over'&&humanOwnsTurn()&&world.allStopped();}
function updateNetworkBadge(text){const e=$('#networkBadge');if(!e)return;e.textContent=onlineMode?`${text}${onlineRoomCode?' · '+onlineRoomCode:''}`:'OFFLINE';e.classList.toggle('online',onlineMode&&online.connected);}
function showStatus(text,ms=1500,type='normal'){const e=$('#toast');e.textContent=text;e.dataset.type=type;e.classList.add('show');clearTimeout(statusTimer);statusTimer=setTimeout(()=>e.classList.remove('show'),ms);}
function haptic(p){try{navigator.vibrate?.(p);}catch(_){}}
function ballColor(b){return b?.name==='Cue'?'#f7f7f2':b?.color||'#111';}
function renderRail(el,balls){if(!el)return;el.innerHTML='';for(let i=0;i<8;i++){const s=document.createElement('i');s.className='pot-slot';const b=balls[i];if(b){s.classList.add('filled');s.style.background=ballColor(b);if(b.number){s.dataset.number=String(b.number);s.classList.add(b.poolGroup==='stripe'?'stripe':'solid');}}el.appendChild(s);}}
function modeLabel(){return gameMode==='8ball'?'8 BALL':gameMode==='9ball'?'9 BALL':'SNOOKER';}
function showVersus(){const v=$('#versusIntro');const right=onlineMode?(match?.players?.[1]?.name||'FRIEND'):(aiMode?`AI · ${aiDifficulty.toUpperCase()}`:'PLAYER 2');$('#versusText').textContent=`${modeLabel()} · ${(match?.players?.[0]?.name||'PLAYER 1').toUpperCase()} VS ${String(right).toUpperCase()}`;v.classList.add('show');clearTimeout(showVersus.t);showVersus.t=setTimeout(()=>v.classList.remove('show'),700);}

function sendOnlineAim(pullback=onlineAimPullback,force=false){
  if(!onlineMode||!onlineReady||onlineSeat!==match?.turn||onlineAnimating||onlinePendingShot||isBallInHand())return;
  onlineAimPullback=clamp(+pullback||0,0,1);
  onlineLocalCue={angle:cue.angle,power:cue.power,spinX:cue.spinX,spinY:cue.spinY};
  const now=performance.now();if(!force&&now-onlineAimLastSent<32)return;onlineAimLastSent=now;
  online.aim({angle:cue.angle,power:cue.power,spinX:cue.spinX,spinY:cue.spinY,pullback:onlineAimPullback});
}
function restoreLocalOnlineCue(){
  if(!onlineMode||onlineSeat!==match?.turn)return;
  cue.angle=onlineLocalCue.angle;cue.power=onlineLocalCue.power;cue.spinX=onlineLocalCue.spinX;cue.spinY=onlineLocalCue.spinY;onlineAimPullback=0;view.setPullback(0);syncSpinUI?.();
}
function applyOnlineMotionFrame(msg){
  if(!onlineMode||!onlineAnimating||!Array.isArray(msg?.balls))return;
  const byKey=new Map(world.balls.map(b=>[ballSnapshotKey(b),b]));
  for(const row of msg.balls){if(!Array.isArray(row)||row.length<12)continue;const b=byKey.get(row[0]);if(!b)continue;const wasPotted=!!b.potted;b.position.set(+row[1]||0,+row[2]||0);b.velocity.set(+row[3]||0,+row[4]||0);for(let i=0;i<4;i++)b.orientation[i]=+row[5+i]||0;b.potted=!!row[9];b.fall=+row[10]||0;b.inHand=!!row[11];b.sleeping=false;b.motionState='rolling';if(!wasPotted&&b.potted){audio.pocket(b);view.notifyPocket?.(b);}}
  // The rAF loop owns rendering. Rendering here as well caused online mobile
  // clients to draw at ~90 fps (30 Hz network frames + display rAF).
}
function hideResultPanel(){const p=$('#resultPanel');if(p)p.classList.remove('show');const b=$('#resultRematch');if(b){b.disabled=false;b.textContent='REMATCH';}}
function showResultPanel(snapshot=onlineLastSnapshot,reason=''){
  const st=snapshot?.match||match?.state?.();if(!st||st.stage!=='over'||st.frameWinner==null)return;
  const winner=st.frameWinner,me=onlineMode?onlineSeat:null,won=me==null?null:winner===me;
  $('#resultMode').textContent=modeLabel();$('#resultTitle').textContent=won===true?'VICTORY':won===false?'DEFEAT':`${(st.players?.[winner]?.name||`PLAYER ${winner+1}`).toUpperCase()} WINS`;
  $('#resultWinner').textContent=`${st.players?.[winner]?.name||`Player ${winner+1}`} wins${reason?` · ${reason}`:''}`;
  $('#resultScore').textContent=`${st.players?.[0]?.score??0}  —  ${st.players?.[1]?.score??0}`;
  $('#resultRematch').textContent=onlineMode?'REMATCH':'PLAY AGAIN';$('#resultLobby').textContent=onlineMode?'NEW ROOM / MODE':'CHANGE MODE';$('#resultPanel').classList.add('show');
}

function ballSnapshotKey(b){return b?.number!=null?`n:${b.number}`:`name:${b?.name}`;}
function applyOnlineSnapshot(snapshot,{quiet=false}={}){
  if(!snapshot)return;
  onlineLastSnapshot=snapshot;
  if(snapshot.mode&&snapshot.mode!==gameMode){gameMode=snapshot.mode;cueBall=rackBalls();cue.setCueBall(cueBall);view.setGameMode(gameMode);breakRails=[[],[]];lastHUDTurn=0;buildMatch();$('#gameMode').value=gameMode;}
  const byKey=new Map(world.balls.map(b=>[ballSnapshotKey(b),b]));
  for(const sb of snapshot.balls||[]){const b=byKey.get(sb.key);if(!b)continue;b.position.set(+sb.x||0,+sb.z||0);b.velocity.set(+sb.vx||0,+sb.vz||0);if(Array.isArray(sb.w))for(let i=0;i<3;i++)b.angularVelocity[i]=+sb.w[i]||0;if(Array.isArray(sb.q)&&sb.q.length===4)for(let i=0;i<4;i++)b.orientation[i]=+sb.q[i]||0;b.potted=!!sb.potted;b.offTable=!!sb.offTable;b.inHand=!!sb.inHand;b.sleeping=!!sb.sleeping;b.motionState=sb.motionState||'rest';b.fall=+sb.fall||0;b.pocketDrop=null;b.sleepTimer=0;}
  const ms=snapshot.match||{};
  if(Array.isArray(ms.players))match.players=ms.players.map((p,i)=>({...match.players[i],...p}));
  if(Number.isInteger(ms.turn))match.turn=ms.turn;
  if(ms.stage!=null)match.stage=ms.stage;
  if(ms.expected!=null)match.expected=ms.expected;
  if(Number.isInteger(ms.clearanceIndex))match.clearanceIndex=ms.clearanceIndex;
  match.ballInHandD=!!ms.ballInHandD;match.ballInHandAnywhere=!!ms.ballInHandAnywhere;
  if(ms.breakShot!=null)match.breakShot=!!ms.breakShot;if(ms.openTable!=null)match.openTable=!!ms.openTable;
  match.frameWinner=ms.frameWinner??null;match.shotActive=false;match.pendingCueScratch=false;match.tracker?.cancel?.();
  const liveCue=match.cueBall?.();if(liveCue){cueBall=liveCue;cue.setCueBall(liveCue);}
  world.accumulator=0;wasMoving=false;cueScratchLatched=false;
  if(onlineMode&&onlineSeat===match.turn)restoreLocalOnlineCue();
  if(!quiet){renderHUD();view.render();}
}
function startOnlineShot(msg){
  applyOnlineSnapshot(msg.start,{quiet:true});onlinePendingShot=false;onlineAnimating=true;onlineStreamActive=true;view.setPullback(0);onlineAimPullback=0;
  const sh=msg.shot||{};cue.angle=+sh.angle||0;cue.power=clamp(+sh.power||.45,.02,1);cue.spinX=clamp(+sh.spinX||0,-1,1);cue.spinY=clamp(+sh.spinY||0,-1,1);syncSpinUI();
  shotClock=performance.now();const P=cue.power;
  const ok=view.playCueStroke(P,()=>{audio.cueStrike(P);haptic(12);});
  if(ok===false){onlineAnimating=false;onlineStreamActive=false;showStatus('ONLINE SHOT SYNC ERROR',1500,'foul');}
  renderHUD();
}
function onlineResultMessage(result){if(!result)return;const text=result.foul&&result.reason?`FOUL · ${result.reason}`:'';if(text)showStatus(text,2200,'foul');}
function handleOnlineMessage(msg){
  if(msg.type==='error'||msg.type==='action_rejected'){onlinePendingShot=false;showStatus(msg.message||'ONLINE ACTION REJECTED',1800,'foul');if(onlineLastSnapshot)applyOnlineSnapshot(onlineLastSnapshot);return;}
  if(msg.type==='room_joined'){
    onlineMode=true;aiMode=false;onlineSeat=msg.seat;onlineRoomCode=msg.code||'';onlineReady=!!msg.snapshot?.ready;$('#matchMode').value='online';$('#onlineCodeDisplay').textContent=onlineRoomCode;$('#onlineWaiting').textContent=onlineReady?'FRIEND CONNECTED':'WAITING FOR FRIEND…';applyOnlineSnapshot(msg.snapshot);$('#onlinePanel').classList.add('open');$('#modeHub').classList.add('show');updateNetworkBadge(onlineReady?'LIVE':'WAITING');return;
  }
  if(msg.type==='room_waiting'){onlineReady=false;$('#onlineWaiting').textContent=`ROOM ${msg.code||onlineRoomCode} · WAITING FOR FRIEND…`;updateNetworkBadge('WAITING');renderHUD();return;}
  if(msg.type==='room_ready'){
    onlineMode=true;onlineReady=true;onlineRoomCode=msg.code||onlineRoomCode;applyOnlineSnapshot(msg.snapshot);$('#onlinePanel').classList.remove('open');$('#modeHub').classList.remove('show');updateNetworkBadge('LIVE');showVersus();showStatus(onlineSeat===match.turn?'YOUR BREAK':'FRIEND BREAK',1000);return;
  }
  if(msg.type==='peer_left'){onlineReady=false;onlineAnimating=false;onlineStreamActive=false;onlinePendingShot=false;if(msg.snapshot)applyOnlineSnapshot(msg.snapshot);showStatus('FRIEND DISCONNECTED',2500,'foul');$('#onlinePanel').classList.add('open');$('#onlineWaiting').textContent='FRIEND DISCONNECTED · ROOM STILL OPEN';return;}
  if(msg.type==='opponent_aim'){
    if(!onlineMode||msg.seat===onlineSeat||msg.seat!==match?.turn||onlineAnimating)return;
    const a=msg.aim||{};cue.angle=Number.isFinite(+a.angle)?+a.angle:cue.angle;cue.power=clamp(+a.power||.45,.02,1);cue.spinX=clamp(+a.spinX||0,-1,1);cue.spinY=clamp(+a.spinY||0,-1,1);view.setPullback(clamp(+a.pullback||0,0,1));syncSpinUI();view.render();return;
  }
  if(msg.type==='shot_start'){startOnlineShot(msg);return;}
  if(msg.type==='shot_frame'){applyOnlineMotionFrame(msg);return;}
  if(msg.type==='state_sync'){
    onlineAnimating=false;onlineStreamActive=false;onlinePendingShot=false;view.setPullback(0);onlineAimPullback=0;applyOnlineSnapshot(msg.snapshot);
    if(msg.reason==='shot_result'){onlineResultMessage(msg.result);if(msg.snapshot?.match?.stage==='over')showResultPanel(msg.snapshot,msg.result?.reason||'');}
    if(msg.reason==='cue_placed')showStatus(onlineSeat===match.turn?'CUE BALL PLACED':'FRIEND PLACED CUE BALL',800);
    if(msg.reason==='rematch'){hideResultPanel();showVersus();showStatus('REMATCH STARTED',900);}
    return;
  }
  if(msg.type==='rematch_vote'){showStatus(msg.seat===onlineSeat?'REMATCH REQUESTED':'FRIEND WANTS A REMATCH',1200);if(msg.seat===onlineSeat){const b=$('#resultRematch');if(b){b.disabled=true;b.textContent='WAITING FOR FRIEND…';}}}
}
async function createOnlineRoom(){const name=($('#onlineName').value||'Player 1').trim();const mode=$('#onlineGameMode').value;$('#onlineWaiting').textContent='CREATING ROOM…';try{await online.createRoom({mode,name});}catch(e){showStatus('COULD NOT CONNECT TO SERVER',1800,'foul');$('#onlineWaiting').textContent='CONNECTION FAILED';}}
async function joinOnlineRoom(){const name=($('#onlineName').value||'Player').trim(),code=($('#onlineJoinCode').value||'').trim().toUpperCase();if(code.length<4){showStatus('ENTER ROOM CODE',1000,'foul');return;}$('#onlineWaiting').textContent='JOINING ROOM…';try{await online.joinRoom({code,name});}catch(e){showStatus('COULD NOT CONNECT TO SERVER',1800,'foul');$('#onlineWaiting').textContent='CONNECTION FAILED';}}
function leaveOnline(){online.leave();onlineMode=false;onlineReady=false;onlineAnimating=false;onlineStreamActive=false;onlinePendingShot=false;onlineSeat=null;onlineRoomCode='';hideResultPanel();$('#onlinePanel').classList.remove('open');$('#matchMode').value='ai';aiMode=true;startMode(gameMode,{showHub:true});updateNetworkBadge('OFFLINE');}

function renderHUD(state=match?.state?.()){
  if(!state)return;const aiTurn=!onlineMode&&!!ai?.isAITurn(match),humanTurn=humanOwnsTurn();
  if(state.turn!==lastHUDTurn&&state.stage!=='over'){breakRails[state.turn]=[];lastHUDTurn=state.turn;}
  if(aiTurn&&!lastAITurn)humanCue={spinX:cue.spinX,spinY:cue.spinY,power:cue.power};
  if(!aiTurn&&lastAITurn){cue.spinX=humanCue.spinX;cue.spinY=humanCue.spinY;cue.power=humanCue.power;syncSpinUI();}
  lastAITurn=aiTurn;
  $('#p1Name').textContent=state.players[0].name;$('#p2Name').textContent=state.players[1].name;$('#p1Score').textContent=state.players[0].score;$('#p2Score').textContent=state.players[1].score;
  $('#p1Break').textContent=isPool()?(state.players[0].group?state.players[0].group.toUpperCase():`POTS ${state.players[0].break}`):`BREAK ${state.players[0].break}`;
  $('#p2Break').textContent=isPool()?(state.players[1].group?state.players[1].group.toUpperCase():`POTS ${state.players[1].break}`):`BREAK ${state.players[1].break}`;
  renderRail($('#p1Rail'),breakRails[0]);renderRail($('#p2Rail'),breakRails[1]);
  $('#leftPlayer').classList.toggle('active',state.turn===0&&state.stage!=='over');$('#rightPlayer').classList.toggle('active',state.turn===1&&state.stage!=='over');
  $('#modeName').textContent=modeLabel();$('#ballOn').textContent=state.ballOn||'—';
  $('#modeDetail').textContent=gameMode==='snooker'?`${state.redsRemaining} RED${state.redsRemaining===1?'':'S'}`:gameMode==='8ball'?(state.openTable?'OPEN TABLE':'GROUP PLAY'):`${state.redsRemaining} BALLS LIVE`;
  $('#turnLabel').textContent=state.stage==='over'?'RACK OVER':state.players[state.turn].name;$('#powerControl').classList.toggle('disabled',!canHumanAim());$('#aimWheel').classList.toggle('disabled',!canHumanAim());$('#mobileAimWheel')?.classList.toggle('disabled',!canHumanAim());$('#spinBtn').disabled=!canHumanAim();
  const bih=$('#ballInHand'),bihReady=isBallInHand()&&!match.shotActive&&world.allStopped()&&!onlineAnimating;bih.classList.toggle('show',bihReady);bih.classList.toggle('ai-owned',bihReady&&!humanTurn);bih.textContent=!humanTurn?(onlineMode?'OPPONENT BALL IN HAND':'AI BALL IN HAND'):(match?.ballInHandAnywhere?'BALL IN HAND · DRAG / TAP WHITE':'BALL IN HAND · DRAG / TAP IN D');document.body.classList.toggle('ball-in-hand-human',bihReady&&humanTurn);document.body.classList.toggle('ai-turn',!humanTurn);document.body.classList.toggle('shot-active',state.shotActive||onlineAnimating);document.body.classList.toggle('online-match',onlineMode);document.body.dataset.mode=gameMode;
  view.setBallInHand(isBallInHand()&&humanTurn);view.setProAimAllowed(canHumanAim());view.setBallOn(state.ballOn);$('#modeBadge').textContent=onlineMode?`ONLINE · ${onlineRoomCode}`:(aiMode?`VS AI · ${aiDifficulty.toUpperCase()}`:'LOCAL 2P');updateNetworkBadge(onlineMode?(onlineReady?'LIVE':'WAITING'):'OFFLINE');
}

function wireMatch(){
  match.onStateChange=renderHUD;match.onMessage=text=>{const foul=/FOUL|EARLY 8/.test(text);showStatus(text,foul?2300:1500,foul?'foul':'normal');if(foul){audio.foul();haptic([25,25,45]);}else if(/WINS/.test(text))audio.frameWin();else audio.score(1);};
  match.onFrameEnd=({winner,reason})=>{showStatus(`${winner.name.toUpperCase()} WINS`,2600,'win');audio.frameWin();haptic([45,45,75]);if(!onlineMode)setTimeout(()=>showResultPanel({match:match.state()},reason||''),450);};
  world.onCollision=(a,b)=>{match.recordCollision(a,b);audio.ballCollision(Math.max(a.lastCollision,b.lastCollision));};world.onCushion=(b,i)=>{match.recordCushion?.(b);audio.cushion(i||b.lastCollision);};world.onPocket=b=>{
    const cueScratch=b?.kind==='cue'||b?.name==='Cue';
    if(cueScratch)cueScratchLatched=true;
    if(b.name!=='Cue'){breakRails[match.turn].push({name:b.name,color:b.color,number:b.number,poolGroup:b.poolGroup});if(breakRails[match.turn].length>8)breakRails[match.turn].shift();}
    // Record the foul evidence FIRST, then immediately restore the physical
    // cue body into protected in-hand state. The tracker still reports a
    // scratch, but renderer/physics can no longer lose the white ball.
    match.recordPocket(b);
    // Capture the pocket feedback before staging moves the live cue body away
    // from the pocket mouth.
    audio.pocket(b);view.notifyPocket(b);haptic(b.name==='Cue'?30:15);
    if(cueScratch){match.stageCueScratch?.();const liveCue=match.cueBall?.();if(liveCue){liveCue.inHand=true;cue.setCueBall(liveCue);}renderHUD();view.render();}
  };
  world.onOffTable=b=>{const cueScratch=b?.kind==='cue'||b?.name==='Cue';if(cueScratch)cueScratchLatched=true;match.recordOffTable(b);if(cueScratch){match.stageCueScratch?.();const liveCue=match.cueBall?.();if(liveCue){liveCue.inHand=true;cue.setCueBall(liveCue);}renderHUD();view.render();}};
}

function buildMatch(){
  const p2=onlineMode?'Player 2':(aiMode?`AI · ${aiDifficulty.toUpperCase()}`:'Player 2');
  if(gameMode==='snooker')match=new MatchController(world,{player2:p2});
  else match=new PoolMatchController(world,{mode:gameMode,player2:p2});
  ai=new AIController(world,{enabled:!onlineMode&&aiMode,difficulty:aiDifficulty,onDecision:handleAIDecision,executeShot:executeAIShot});lastAITurn=false;
  view.setFirstContactValidator(ball=>match?.isLegalFirstContact?.(ball)??true);
  view.setLegalTargetProvider(()=>match?.legalTargetsFor?.(match.turn)||[]);
  wireMatch();
}
function rackBalls(){if(gameMode==='8ball')return createEightBallBalls(world);if(gameMode==='9ball')return createNineBallBalls(world);return createStandardBalls(world);}
function startMode(mode,{showHub=false}={}){hideResultPanel();gameMode=['snooker','8ball','9ball'].includes(mode)?mode:'snooker';cueScratchLatched=false;cueRecoveryHoldUntil=0;cueBall=rackBalls();cue.setCueBall(cueBall);cue.angle=0;cue.spinX=cue.spinY=0;cue.power=humanCue.power||.45;view.setGameMode(gameMode);breakRails=[[],[]];lastHUDTurn=0;buildMatch();syncSpinUI();resetPowerControl();$('#gameMode').value=gameMode;renderHUD();if(showHub)$('#modeHub').classList.add('show');else $('#modeHub').classList.remove('show');showVersus();view.render();}
function resetRack(){if(onlineMode){showStatus('ONLINE RACK IS SERVER CONTROLLED',1200);return;}startMode(gameMode);}

function attemptStrike(){audio.unlock();if(onlineMode){if(!humanOwnsTurn()){showStatus('WAIT FOR YOUR TURN',900);return false;}if(isBallInHand()){showStatus('PLACE THE CUE BALL',1200,'foul');return false;}if(!canHumanAim())return false;sendOnlineAim(0,true);onlinePendingShot=true;const clientShotId=`${Date.now().toString(36)}-${++onlineShotSeq}`;if(!online.shot({angle:cue.angle,power:cue.power,spinX:cue.spinX,spinY:cue.spinY,clientShotId})){onlinePendingShot=false;showStatus('NOT CONNECTED',1200,'foul');return false;}showStatus('SHOT SENT',650);renderHUD();return true;}if(ai?.isAITurn(match)){showStatus('WAIT FOR YOUR TURN',900);return false;}if(isBallInHand()){showStatus('PLACE THE CUE BALL',1200,'foul');return false;}if(!canHumanAim())return false;if(!match.beginShot())return false;shotClock=performance.now();const P=cue.power;const started=view.playCueStroke(P,()=>{audio.cueStrike(P);haptic(12);if(!cue.strike(P))match.cancelShot();});if(started===false){match.cancelShot();return false;}return true;}
function executeAIShot(plan){if(!ai?.isAITurn(match)||match.shotActive||view.isStrokeAnimating())return false;cue.angle=plan.angle;cue.power=plan.power;cue.spinX=plan.spinX||0;cue.spinY=plan.spinY||0;syncSpinUI();if(!match.beginShot())return false;shotClock=performance.now();const P=cue.power;return view.playCueStroke(P,()=>{audio.cueStrike(P);if(!cue.strike(P))match.cancelShot();})!==false;}
function handleAIDecision(evt){view.setAIThinking(evt.type==='thinking'||evt.type==='searching');$('#aiState').textContent=evt.type==='plan'?(evt.plan.decision||'READY'):evt.type.toUpperCase();}

new InputController(canvas,cue,view,{canAim:canHumanAim,ballInHand:()=>isBallInHand()&&humanOwnsTurn()&&!onlineAnimating&&!match?.shotActive&&world.allStopped(),onAimChanged:()=>sendOnlineAim(onlineAimPullback),onPlacementCommitted:()=>{renderHUD();view.render();showStatus(onlineMode?'PLACING CUE BALL…':'CUE BALL PLACED',700);}},attemptStrike,placeCueFromPoint,moveCueFromPoint);
function dPlacementFromPoint(p){const dx=p.x-D_AREA.centerX,dz=p.z-D_AREA.baulkZ;if(p.z>D_AREA.baulkZ-.001||dx*dx+dz*dz>D_AREA.radius*D_AREA.radius)return null;const usable=D_AREA.radius-TABLE.ballRadius*.65,nx=clamp(dx/usable,-1,1),half=Math.sqrt(Math.max(.0001,D_AREA.radius*D_AREA.radius-dx*dx)),depth=clamp((D_AREA.baulkZ-p.z)/half,.04,.96);return{nx,depth};}
function moveCueFromPoint(p){if(!isBallInHand())return{ok:false,reason:'Cue ball is not in hand.'};if(match.ballInHandAnywhere)return match.previewCueAnywhere?.(p.x,p.z)||{ok:false,reason:'Placement unavailable.'};const d=dPlacementFromPoint(p);if(!d)return{ok:false,reason:'PLACE INSIDE THE D'};return match.previewCueInD?.(d.nx,d.depth)||{ok:false,reason:'Placement unavailable.'};}
function placeCueFromPoint(p){if(!isBallInHand())return{ok:false,reason:'Cue ball is not in hand.'};if(onlineMode){if(!humanOwnsTurn())return{ok:false,reason:'Not your ball-in-hand.'};let test;if(match.ballInHandAnywhere)test=match.previewCueAnywhere?.(p.x,p.z);else{const d=dPlacementFromPoint(p);test=d?match.previewCueInD?.(d.nx,d.depth):{ok:false,reason:'PLACE INSIDE THE D'};}if(!test?.ok){showStatus(test?.reason||'POSITION BLOCKED',1100,'foul');return test||{ok:false};}online.placeCue({x:p.x,z:p.z});return{ok:true,position:test.position,pending:true};}let r;if(match.ballInHandAnywhere)r=match.placeCueAnywhere(p.x,p.z);else{const d=dPlacementFromPoint(p);r=d?match.placeCueInD(d.nx,d.depth):{ok:false,reason:'PLACE INSIDE THE D'};}if(!r?.ok)showStatus(r?.reason||'POSITION BLOCKED',1100,'foul');return r;}

// Pull/release power bar.
const powerControl=$('#powerControl'),powerFill=$('#powerFill'),powerKnob=$('#powerKnob'),powerValue=$('#powerValue');let pulling=false,powerPid=null,pulledPower=0;
function setPowerVisual(v){v=clamp(v,0,1);pulledPower=v;if(pulling){cue.power=Math.max(.02,v);onlineAimPullback=v;sendOnlineAim(v);}const pct=Math.round(v*100);powerFill.style.height=`${pct}%`;powerKnob.style.top=`${pct}%`;powerValue.textContent=pct;view.setPullback(v);}function resetPowerControl(){setPowerVisual(0);view.setPullback(0);}function powerFromEvent(e){const r=$('#powerTrack').getBoundingClientRect();return clamp((e.clientY-r.top)/r.height,0,1);}
powerControl.addEventListener('pointerdown',e=>{if(!canHumanAim())return;audio.unlock();pulling=true;powerPid=e.pointerId;powerControl.setPointerCapture?.(e.pointerId);setPowerVisual(powerFromEvent(e));});powerControl.addEventListener('pointermove',e=>{if(pulling&&e.pointerId===powerPid)setPowerVisual(powerFromEvent(e));});function releasePower(){if(!pulling)return;pulling=false;cue.power=clamp(pulledPower,.02,1);humanCue.power=cue.power;onlineAimPullback=0;view.setPullback(0);sendOnlineAim(0,true);if(pulledPower>.04&&canHumanAim())attemptStrike();setTimeout(resetPowerControl,75);}powerControl.addEventListener('pointerup',releasePower);powerControl.addEventListener('pointercancel',()=>{pulling=false;resetPowerControl();});

// Fine aim controls. Desktop keeps the compact mouse wheel. Coarse-pointer
// devices get a dedicated right-side rotary wheel with much larger touch area.
const aimWheel=$('#aimWheel'),aimDisc=$('#aimWheelDisc'),aimNeedle=$('#aimWheelNeedle'),mobileAimWheel=$('#mobileAimWheel'),mobileAimRotor=$('#mobileAimRotor');let wheelDrag=false,wheelPid=null,lastX=0,wheelVisual=0;function wheelReset(){wheelVisual=0;aimNeedle.style.transform='translateX(-50%) rotate(0deg)';}
aimDisc.addEventListener('pointerdown',e=>{if(MOBILE_DEVICE||!canHumanAim())return;wheelDrag=true;wheelPid=e.pointerId;lastX=e.clientX;aimDisc.setPointerCapture?.(e.pointerId);});aimDisc.addEventListener('pointermove',e=>{if(MOBILE_DEVICE||!wheelDrag||e.pointerId!==wheelPid||!canHumanAim())return;const dx=e.clientX-lastX;lastX=e.clientX;cue.angle-=dx*.00042;sendOnlineAim(onlineAimPullback);wheelVisual=clamp(wheelVisual+dx*.65,-35,35);aimNeedle.style.transform=`translateX(-50%) rotate(${wheelVisual}deg)`;});function wheelEnd(){wheelDrag=false;wheelPid=null;wheelReset();}aimDisc.addEventListener('pointerup',wheelEnd);aimDisc.addEventListener('pointercancel',wheelEnd);
let mobileWheelDrag=false,mobileWheelPid=null,mobileWheelLastAngle=0,mobileWheelVisual=0;const wrapAngle=a=>{while(a>Math.PI)a-=Math.PI*2;while(a< -Math.PI)a+=Math.PI*2;return a;};function mobilePointerAngle(e){const r=mobileAimWheel.getBoundingClientRect(),x=e.clientX-(r.left+r.width*.5),y=e.clientY-(r.top+r.height*.5);return Math.hypot(x,y)<10?null:Math.atan2(y,x);}function mobileWheelReset(){mobileWheelVisual=0;if(mobileAimRotor)mobileAimRotor.style.transform='rotate(0deg)';}
mobileAimWheel?.addEventListener('pointerdown',e=>{if(!MOBILE_DEVICE||!canHumanAim())return;const a=mobilePointerAngle(e);if(a==null)return;e.preventDefault();audio.unlock();mobileWheelDrag=true;mobileWheelPid=e.pointerId;mobileWheelLastAngle=a;mobileAimWheel.setPointerCapture?.(e.pointerId);});
mobileAimWheel?.addEventListener('pointermove',e=>{if(!mobileWheelDrag||e.pointerId!==mobileWheelPid||!canHumanAim())return;const a=mobilePointerAngle(e);if(a==null)return;e.preventDefault();const da=wrapAngle(a-mobileWheelLastAngle);mobileWheelLastAngle=a;cue.angle-=da*.065;mobileWheelVisual+=da*180/Math.PI;if(mobileAimRotor)mobileAimRotor.style.transform=`rotate(${mobileWheelVisual}deg)`;sendOnlineAim(onlineAimPullback);});
function mobileWheelEnd(e){if(e&&mobileWheelPid!=null&&e.pointerId!==mobileWheelPid)return;mobileWheelDrag=false;mobileWheelPid=null;mobileWheelReset();}mobileAimWheel?.addEventListener('pointerup',mobileWheelEnd);mobileAimWheel?.addEventListener('pointercancel',mobileWheelEnd);

// Spin.
const spinPanel=$('#spinPanel'),spinPad=$('#spinPad'),spinDot=$('#spinDot');function setSpinOpen(v){spinPanel.classList.toggle('open',!!v);$('#spinBtn').classList.toggle('active',!!v);}$('#spinBtn').addEventListener('click',()=>{if(!canHumanAim())return;audio.ui();setSpinOpen(!spinPanel.classList.contains('open'));setMenu(false);});function syncSpinUI(){spinDot.style.left=`${50+cue.spinX*39}%`;spinDot.style.top=`${50-cue.spinY*39}%`;$('#spinMiniDot').style.transform=`translate(${cue.spinX*11}px,${-cue.spinY*11}px)`;$('#spinText').textContent=Math.hypot(cue.spinX,cue.spinY)<.05?'CENTER':`${cue.spinY>=0?'FOLLOW':'DRAW'} · SIDE ${Math.round(cue.spinX*100)}`;}function spinEvent(e){const r=spinPad.getBoundingClientRect();let x=(e.clientX-r.left)/r.width*2-1,y=1-(e.clientY-r.top)/r.height*2,l=Math.hypot(x,y);if(l>1){x/=l;y/=l;}cue.spinX=humanCue.spinX=x;cue.spinY=humanCue.spinY=y;syncSpinUI();sendOnlineAim(onlineAimPullback);}spinPad.addEventListener('pointerdown',e=>{spinPad.setPointerCapture?.(e.pointerId);spinEvent(e);});spinPad.addEventListener('pointermove',e=>{if(e.buttons)spinEvent(e);});$('#spinCenter').addEventListener('click',()=>{cue.spinX=cue.spinY=humanCue.spinX=humanCue.spinY=0;syncSpinUI();sendOnlineAim(onlineAimPullback,true);});

// Menu / mode hub / fullscreen.
const menu=$('#menuPanel'),scrim=$('#scrim');function setMenu(v){menu.classList.toggle('open',!!v);scrim.classList.toggle('show',!!v);if(v)setSpinOpen(false);}$('#menuBtn').addEventListener('click',()=>setMenu(true));$('#menuClose').addEventListener('click',()=>setMenu(false));scrim.addEventListener('click',()=>setMenu(false));$('#restart').addEventListener('click',()=>{setMenu(false);if(onlineMode){online.rematch();showStatus('REMATCH REQUESTED',900);return;}resetRack();});$('#gameMode').addEventListener('change',e=>{setMenu(false);startMode(e.target.value);});$('#matchMode').addEventListener('change',e=>{if(e.target.value==='online'){$('#onlinePanel').classList.add('open');$('#modeHub').classList.add('show');return;}if(onlineMode){online.leave();onlineMode=false;onlineReady=false;onlineSeat=null;onlineRoomCode='';}aiMode=e.target.value==='ai';resetRack();});$('#aiDifficulty').addEventListener('change',e=>{aiDifficulty=e.target.value;resetRack();});$('#powerSide').addEventListener('change',e=>document.body.classList.toggle('power-right',e.target.value==='right'));function syncAimControlVisibility(){const enabled=$('#aimWheelEnabled').checked;aimWheel.classList.toggle('hidden-control',MOBILE_DEVICE||!enabled);mobileAimWheel?.classList.toggle('hidden-control',!MOBILE_DEVICE||!enabled);}$('#aimWheelEnabled').addEventListener('change',syncAimControlVisibility);syncAimControlVisibility();$('#soundEnabled').addEventListener('change',e=>audio.setEnabled(e.target.checked));$('#soundVolume').addEventListener('input',e=>audio.setVolume(+e.target.value/100));
async function toggleFullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen?.();else await document.documentElement.requestFullscreen?.();}catch(_){showStatus('FULLSCREEN BLOCKED — PRESS F11',1500);}}$('#fullscreenBtn').addEventListener('click',toggleFullscreen);
for(const card of document.querySelectorAll('.mode-card'))card.addEventListener('click',async()=>{audio.unlock();if(onlineMode){online.leave();onlineMode=false;onlineReady=false;onlineSeat=null;onlineRoomCode='';$('#matchMode').value='ai';aiMode=true;}startMode(card.dataset.mode);if($('#autoFullscreen').checked&&!document.fullscreenElement){try{await document.documentElement.requestFullscreen?.();}catch(_){showStatus('PRESS F11 FOR FULLSCREEN',1300);}}});
$('#onlineOpenBtn').addEventListener('click',()=>{$('#onlinePanel').classList.add('open');});$('#onlineClose').addEventListener('click',()=>$('#onlinePanel').classList.remove('open'));$('#onlineCreate').addEventListener('click',createOnlineRoom);$('#onlineJoin').addEventListener('click',joinOnlineRoom);$('#onlineLeave').addEventListener('click',leaveOnline);$('#onlineCopy').addEventListener('click',async()=>{if(!onlineRoomCode)return;try{await navigator.clipboard.writeText(onlineRoomCode);showStatus('ROOM CODE COPIED',800);}catch(_){showStatus(`ROOM ${onlineRoomCode}`,1300);}});$('#onlineJoinCode').addEventListener('input',e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5));
$('#resultRematch').addEventListener('click',()=>{if(onlineMode){online.rematch();const b=$('#resultRematch');b.disabled=true;b.textContent='WAITING FOR FRIEND…';showStatus('REMATCH REQUESTED',900);}else{hideResultPanel();resetRack();}});
$('#resultLobby').addEventListener('click',()=>{hideResultPanel();if(onlineMode){leaveOnline();$('#onlinePanel').classList.add('open');$('#modeHub').classList.add('show');}else $('#modeHub').classList.add('show');});
$('#resultView').addEventListener('click',hideResultPanel);
canvas.addEventListener('pointerdown',()=>setSpinOpen(false),{passive:true});let proAimEnabled=false,proAimComboLatched=false;const proAimCodes=new Set();function proAimTypingTarget(){const tag=document.activeElement?.tagName;return tag==='INPUT'||tag==='SELECT'||tag==='TEXTAREA';}function setProAimState(v){proAimEnabled=!!v;view.setProAimEnabled(proAimEnabled);document.body.classList.toggle('pro-aim-on',proAimEnabled);$('#proAimDot')?.classList.toggle('show',proAimEnabled);view.render();}function updateProAimCombo(){const shift=proAimCodes.has('ShiftLeft')||proAimCodes.has('ShiftRight'),combo=shift&&proAimCodes.has('KeyH')&&proAimCodes.has('KeyJ');if(combo&&!proAimComboLatched){proAimComboLatched=true;setProAimState(!proAimEnabled);}if(!combo)proAimComboLatched=false;}window.addEventListener('keydown',e=>{if(e.key==='Escape'){setSpinOpen(false);setMenu(false);$('#onlinePanel').classList.remove('open');}if(e.key==='F2')$('#modeHub').classList.add('show');if(proAimTypingTarget())return;if(e.code==='ShiftLeft'||e.code==='ShiftRight'||e.code==='KeyH'||e.code==='KeyJ'){proAimCodes.add(e.code);updateProAimCombo();}});window.addEventListener('keyup',e=>{if(e.code==='ShiftLeft'||e.code==='ShiftRight'||e.code==='KeyH'||e.code==='KeyJ'){proAimCodes.delete(e.code);updateProAimCombo();}});window.addEventListener('blur',()=>{proAimCodes.clear();proAimComboLatched=false;});for(const b of document.querySelectorAll('button'))b.addEventListener('pointerdown',()=>audio.unlock(),{passive:true});

view.setAimGuide('full');syncSpinUI();resetPowerControl();buildMatch();renderHUD();view.render();

// Query-gated browser test hook. It is inert in normal play and exists only so
// the shipped production bundle can be exercised end-to-end in Chromium.
if(new URLSearchParams(location.search).has('debug')){
  window.__cueArenaDebug={
    state:()=>{const c=match?.cueBall?.();return{mode:gameMode,turn:match?.turn,shotActive:!!match?.shotActive,ballInHandD:!!match?.ballInHandD,ballInHandAnywhere:!!match?.ballInHandAnywhere,cue:c?{potted:!!c.potted,offTable:!!c.offTable,inHand:!!c.inHand,x:c.position.x,z:c.position.y}:null};},
    firstShotScratch:()=>{
      if(!match?.beginShot?.())return{ok:false,reason:'beginShot failed',state:window.__cueArenaDebug.state()};
      const c=match.cueBall();c.potted=true;c.sleeping=true;c.velocity.set(0,0);
      world.onPocket?.(c);
      const r=finalizeSettledShot(performance.now());
      return{ok:true,result:r,state:window.__cueArenaDebug.state()};
    },
    selectMode:m=>{startMode(m);return window.__cueArenaDebug.state();},
    setAIMode:v=>{aiMode=!!v;resetRack();return window.__cueArenaDebug.state();},
    cueScreen:()=>{const c=match?.cueBall?.();return c?view.worldToScreen(c.position.x,c.position.y):null;},
    placeCueAt:(x,z)=>placeCueFromPoint({x,z}),
    moveCueAt:(x,z)=>moveCueFromPoint({x,z}),
    proAim:()=>({enabled:proAimEnabled,allowed:canHumanAim(),power:cue.power,spinX:cue.spinX,spinY:cue.spinY})
  };
}

function finalizeSettledShot(now){
  const result=match.finishShot();
  // A real pocket/off-table event is latched independently from the rules
  // report. Once the shot is adjudicated, force the physical white ball back
  // onto the cloth before the next frame or AI action can consume ball-in-hand.
  if(isBallInHand()&&(cueScratchLatched||result?.foul||result?.report?.cuePotted||result?.report?.cueOffTable)){
    match.forceCueBallRecovery?.();
    const liveCue=match.cueBall?.();
    if(isBallInHand()&&liveCue){liveCue.potted=false;liveCue.offTable=false;liveCue.inHand=true;cue.setCueBall(liveCue);match.ensureCueBallInHandVisible?.();}
    cueRecoveryHoldUntil=now+(ai?.isAITurn(match)?520:0);
    cueScratchLatched=false;
    renderHUD();
    view.render();
  }
  return result;
}

let last=performance.now();function loop(now){const dt=(now-last)/1000;last=now;if(!(onlineMode&&onlineAnimating&&onlineStreamActive))world.update(dt);audio.updateRolling(world);const moving=!world.allStopped();
  // Independent safety net: a latched physical scratch must always own a
  // visible protected cue body, even before rules finish adjudicating.
  if(cueScratchLatched&&match?.shotActive&&!isBallInHand())match.stageCueScratch?.();
  if(match.shotActive&&!moving&&!view.isStrokeAnimating()&&(wasMoving||now-shotClock>600)){if(!onlineMode)finalizeSettledShot(now);}wasMoving=moving;if(isBallInHand()&&!moving){match.ensureCueBallInHandVisible?.();const liveCue=match.cueBall?.();if(liveCue){liveCue.potted=false;liveCue.offTable=false;liveCue.inHand=true;if(cue.cueBall!==liveCue)cue.setCueBall(liveCue);}}if(!onlineMode&&now>=cueRecoveryHoldUntil)ai.tick(now,match);view.render();requestAnimationFrame(loop);}requestAnimationFrame(loop);
