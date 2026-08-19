(function(){
'use strict';
const __modules=Object.create(null),__cache=Object.create(null);

__modules["src/main.js"]=function(require,module,exports){
const { PhysicsWorld } = require("src/physics/PhysicsWorld.js");
const { createStandardBalls, D_AREA } = require("src/game/SnookerSetup.js");
const { createEightBallBalls, createNineBallBalls } = require("src/game/PoolSetup.js");
const { TABLE } = require("src/config.js");
const { CueController } = require("src/game/CueController.js");
const { InputController } = require("src/input/InputController.js");
const { Renderer2D } = require("src/render/Renderer2D.js");
const { AudioEngine } = require("src/audio/AudioEngine.js");
const { MatchController } = require("src/gameplay/MatchController.js");
const { PoolMatchController } = require("src/gameplay/PoolMatchController.js");
const { AIController } = require("src/ai/AIController.js");
const { OnlineClient } = require("src/network/OnlineClient.js");
const $=s=>document.querySelector(s),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const canvas=$('#game'),world=new PhysicsWorld();
let gameMode='snooker',cueBall=createStandardBalls(world),cue=new CueController(world,cueBall),view=new Renderer2D(canvas,world,cue),audio=new AudioEngine();
cue.angle=0;cue.power=.45;view.setGameMode(gameMode);
let aiMode=true,aiDifficulty='medium',match=null,ai=null,lastAITurn=false,humanCue={spinX:0,spinY:0,power:.45},statusTimer=0,shotClock=0,wasMoving=false,breakRails=[[],[]],lastHUDTurn=0,cueScratchLatched=false,cueRecoveryHoldUntil=0;
let onlineMode=false,onlineReady=false,onlineSeat=null,onlineAnimating=false,onlinePendingShot=false,onlineRoomCode='',onlineLastSnapshot=null,onlineShotSeq=0;
const online=new OnlineClient({onStatus:s=>updateNetworkBadge(s),onMessage:handleOnlineMessage,onClose:()=>{if(onlineMode){onlineReady=false;onlineAnimating=false;showStatus('CONNECTION LOST',2200,'foul');renderHUD();}}});

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
  if(!quiet){renderHUD();view.render();}
}
function startOnlineShot(msg){
  applyOnlineSnapshot(msg.start,{quiet:true});onlinePendingShot=false;onlineAnimating=true;
  const sh=msg.shot||{};cue.angle=+sh.angle||0;cue.power=clamp(+sh.power||.45,.02,1);cue.spinX=clamp(+sh.spinX||0,-1,1);cue.spinY=clamp(+sh.spinY||0,-1,1);syncSpinUI();
  if(!match.beginShot()){onlineAnimating=false;showStatus('ONLINE SHOT SYNC ERROR',1500,'foul');return;}
  shotClock=performance.now();const P=cue.power;const ok=view.playCueStroke(P,()=>{audio.cueStrike(P);haptic(12);if(!cue.strike(P))match.cancelShot();});
  if(ok===false){match.cancelShot();onlineAnimating=false;}
  renderHUD();
}
function onlineResultMessage(result){if(!result)return;const text=result.reason?`FOUL · ${result.reason}`:result.win!=null?'RACK WON':'';if(text)showStatus(text,result.foul?2200:1600,result.foul?'foul':'normal');}
function handleOnlineMessage(msg){
  if(msg.type==='error'||msg.type==='action_rejected'){onlinePendingShot=false;showStatus(msg.message||'ONLINE ACTION REJECTED',1800,'foul');if(onlineLastSnapshot)applyOnlineSnapshot(onlineLastSnapshot);return;}
  if(msg.type==='room_joined'){
    onlineMode=true;aiMode=false;onlineSeat=msg.seat;onlineRoomCode=msg.code||'';onlineReady=!!msg.snapshot?.ready;$('#matchMode').value='online';$('#onlineCodeDisplay').textContent=onlineRoomCode;$('#onlineWaiting').textContent=onlineReady?'FRIEND CONNECTED':'WAITING FOR FRIEND…';applyOnlineSnapshot(msg.snapshot);$('#onlinePanel').classList.add('open');$('#modeHub').classList.add('show');updateNetworkBadge(onlineReady?'LIVE':'WAITING');return;
  }
  if(msg.type==='room_waiting'){onlineReady=false;$('#onlineWaiting').textContent=`ROOM ${msg.code||onlineRoomCode} · WAITING FOR FRIEND…`;updateNetworkBadge('WAITING');renderHUD();return;}
  if(msg.type==='room_ready'){
    onlineMode=true;onlineReady=true;onlineRoomCode=msg.code||onlineRoomCode;applyOnlineSnapshot(msg.snapshot);$('#onlinePanel').classList.remove('open');$('#modeHub').classList.remove('show');updateNetworkBadge('LIVE');showVersus();showStatus(onlineSeat===match.turn?'YOUR BREAK':'FRIEND BREAK',1000);return;
  }
  if(msg.type==='peer_left'){onlineReady=false;onlineAnimating=false;onlinePendingShot=false;if(msg.snapshot)applyOnlineSnapshot(msg.snapshot);showStatus('FRIEND DISCONNECTED',2500,'foul');$('#onlinePanel').classList.add('open');$('#onlineWaiting').textContent='FRIEND DISCONNECTED · ROOM STILL OPEN';return;}
  if(msg.type==='shot_start'){startOnlineShot(msg);return;}
  if(msg.type==='state_sync'){
    onlineAnimating=false;onlinePendingShot=false;applyOnlineSnapshot(msg.snapshot);if(msg.reason==='shot_result')onlineResultMessage(msg.result);if(msg.reason==='cue_placed')showStatus(onlineSeat===match.turn?'CUE BALL PLACED':'FRIEND PLACED CUE BALL',800);return;
  }
  if(msg.type==='rematch_vote')showStatus('REMATCH VOTE RECEIVED',900);
}
async function createOnlineRoom(){const name=($('#onlineName').value||'Player 1').trim();const mode=$('#onlineGameMode').value;$('#onlineWaiting').textContent='CREATING ROOM…';try{await online.createRoom({mode,name});}catch(e){showStatus('COULD NOT CONNECT TO SERVER',1800,'foul');$('#onlineWaiting').textContent='CONNECTION FAILED';}}
async function joinOnlineRoom(){const name=($('#onlineName').value||'Player').trim(),code=($('#onlineJoinCode').value||'').trim().toUpperCase();if(code.length<4){showStatus('ENTER ROOM CODE',1000,'foul');return;}$('#onlineWaiting').textContent='JOINING ROOM…';try{await online.joinRoom({code,name});}catch(e){showStatus('COULD NOT CONNECT TO SERVER',1800,'foul');$('#onlineWaiting').textContent='CONNECTION FAILED';}}
function leaveOnline(){online.leave();onlineMode=false;onlineReady=false;onlineAnimating=false;onlinePendingShot=false;onlineSeat=null;onlineRoomCode='';$('#onlinePanel').classList.remove('open');$('#matchMode').value='ai';aiMode=true;startMode(gameMode,{showHub:true});updateNetworkBadge('OFFLINE');}

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
  $('#turnLabel').textContent=state.stage==='over'?'RACK OVER':state.players[state.turn].name;$('#powerControl').classList.toggle('disabled',!canHumanAim());$('#aimWheel').classList.toggle('disabled',!canHumanAim());$('#spinBtn').disabled=!canHumanAim();
  const bih=$('#ballInHand'),bihReady=isBallInHand()&&!match.shotActive&&world.allStopped()&&!onlineAnimating;bih.classList.toggle('show',bihReady);bih.classList.toggle('ai-owned',bihReady&&!humanTurn);bih.textContent=!humanTurn?(onlineMode?'OPPONENT BALL IN HAND':'AI BALL IN HAND'):(match?.ballInHandAnywhere?'BALL IN HAND · DRAG / TAP WHITE':'BALL IN HAND · DRAG / TAP IN D');document.body.classList.toggle('ball-in-hand-human',bihReady&&humanTurn);document.body.classList.toggle('ai-turn',!humanTurn);document.body.classList.toggle('shot-active',state.shotActive||onlineAnimating);document.body.classList.toggle('online-match',onlineMode);document.body.dataset.mode=gameMode;
  view.setBallInHand(isBallInHand()&&humanTurn);view.setBallOn(state.ballOn);$('#modeBadge').textContent=onlineMode?`ONLINE · ${onlineRoomCode}`:(aiMode?`VS AI · ${aiDifficulty.toUpperCase()}`:'LOCAL 2P');updateNetworkBadge(onlineMode?(onlineReady?'LIVE':'WAITING'):'OFFLINE');
}

function wireMatch(){
  match.onStateChange=renderHUD;match.onMessage=text=>{const foul=/FOUL|EARLY 8/.test(text);showStatus(text,foul?2300:1500,foul?'foul':'normal');if(foul){audio.foul();haptic([25,25,45]);}else if(/WINS/.test(text))audio.frameWin();else audio.score(1);};
  match.onFrameEnd=({winner})=>{showStatus(`${winner.name.toUpperCase()} WINS`,3800,'win');audio.frameWin();haptic([45,45,75]);};
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
function startMode(mode,{showHub=false}={}){gameMode=['snooker','8ball','9ball'].includes(mode)?mode:'snooker';cueScratchLatched=false;cueRecoveryHoldUntil=0;cueBall=rackBalls();cue.setCueBall(cueBall);cue.angle=0;cue.spinX=cue.spinY=0;cue.power=humanCue.power||.45;view.setGameMode(gameMode);breakRails=[[],[]];lastHUDTurn=0;buildMatch();syncSpinUI();resetPowerControl();$('#gameMode').value=gameMode;renderHUD();if(showHub)$('#modeHub').classList.add('show');else $('#modeHub').classList.remove('show');showVersus();view.render();}
function resetRack(){if(onlineMode){showStatus('ONLINE RACK IS SERVER CONTROLLED',1200);return;}startMode(gameMode);}

function attemptStrike(){audio.unlock();if(onlineMode){if(!humanOwnsTurn()){showStatus('WAIT FOR YOUR TURN',900);return false;}if(isBallInHand()){showStatus('PLACE THE CUE BALL',1200,'foul');return false;}if(!canHumanAim())return false;onlinePendingShot=true;const clientShotId=`${Date.now().toString(36)}-${++onlineShotSeq}`;if(!online.shot({angle:cue.angle,power:cue.power,spinX:cue.spinX,spinY:cue.spinY,clientShotId})){onlinePendingShot=false;showStatus('NOT CONNECTED',1200,'foul');return false;}showStatus('SHOT SENT',650);renderHUD();return true;}if(ai?.isAITurn(match)){showStatus('WAIT FOR YOUR TURN',900);return false;}if(isBallInHand()){showStatus('PLACE THE CUE BALL',1200,'foul');return false;}if(!canHumanAim())return false;if(!match.beginShot())return false;shotClock=performance.now();const P=cue.power;const started=view.playCueStroke(P,()=>{audio.cueStrike(P);haptic(12);if(!cue.strike(P))match.cancelShot();});if(started===false){match.cancelShot();return false;}return true;}
function executeAIShot(plan){if(!ai?.isAITurn(match)||match.shotActive||view.isStrokeAnimating())return false;cue.angle=plan.angle;cue.power=plan.power;cue.spinX=plan.spinX||0;cue.spinY=plan.spinY||0;syncSpinUI();if(!match.beginShot())return false;shotClock=performance.now();const P=cue.power;return view.playCueStroke(P,()=>{audio.cueStrike(P);if(!cue.strike(P))match.cancelShot();})!==false;}
function handleAIDecision(evt){view.setAIThinking(evt.type==='thinking'||evt.type==='searching');$('#aiState').textContent=evt.type==='plan'?(evt.plan.decision||'READY'):evt.type.toUpperCase();}

new InputController(canvas,cue,view,{canAim:canHumanAim,ballInHand:()=>isBallInHand()&&humanOwnsTurn()&&!onlineAnimating&&!match?.shotActive&&world.allStopped(),onPlacementCommitted:()=>{renderHUD();view.render();showStatus(onlineMode?'PLACING CUE BALL…':'CUE BALL PLACED',700);}},attemptStrike,placeCueFromPoint,moveCueFromPoint);
function dPlacementFromPoint(p){const dx=p.x-D_AREA.centerX,dz=p.z-D_AREA.baulkZ;if(p.z>D_AREA.baulkZ-.001||dx*dx+dz*dz>D_AREA.radius*D_AREA.radius)return null;const usable=D_AREA.radius-TABLE.ballRadius*.65,nx=clamp(dx/usable,-1,1),half=Math.sqrt(Math.max(.0001,D_AREA.radius*D_AREA.radius-dx*dx)),depth=clamp((D_AREA.baulkZ-p.z)/half,.04,.96);return{nx,depth};}
function moveCueFromPoint(p){if(!isBallInHand())return{ok:false,reason:'Cue ball is not in hand.'};if(match.ballInHandAnywhere)return match.previewCueAnywhere?.(p.x,p.z)||{ok:false,reason:'Placement unavailable.'};const d=dPlacementFromPoint(p);if(!d)return{ok:false,reason:'PLACE INSIDE THE D'};return match.previewCueInD?.(d.nx,d.depth)||{ok:false,reason:'Placement unavailable.'};}
function placeCueFromPoint(p){if(!isBallInHand())return{ok:false,reason:'Cue ball is not in hand.'};if(onlineMode){if(!humanOwnsTurn())return{ok:false,reason:'Not your ball-in-hand.'};let test;if(match.ballInHandAnywhere)test=match.previewCueAnywhere?.(p.x,p.z);else{const d=dPlacementFromPoint(p);test=d?match.previewCueInD?.(d.nx,d.depth):{ok:false,reason:'PLACE INSIDE THE D'};}if(!test?.ok){showStatus(test?.reason||'POSITION BLOCKED',1100,'foul');return test||{ok:false};}online.placeCue({x:p.x,z:p.z});return{ok:true,position:test.position,pending:true};}let r;if(match.ballInHandAnywhere)r=match.placeCueAnywhere(p.x,p.z);else{const d=dPlacementFromPoint(p);r=d?match.placeCueInD(d.nx,d.depth):{ok:false,reason:'PLACE INSIDE THE D'};}if(!r?.ok)showStatus(r?.reason||'POSITION BLOCKED',1100,'foul');return r;}

// Pull/release power bar.
const powerControl=$('#powerControl'),powerFill=$('#powerFill'),powerKnob=$('#powerKnob'),powerValue=$('#powerValue');let pulling=false,powerPid=null,pulledPower=0;
function setPowerVisual(v){v=clamp(v,0,1);pulledPower=v;if(pulling)cue.power=Math.max(.02,v);const pct=Math.round(v*100);powerFill.style.height=`${pct}%`;powerKnob.style.top=`${pct}%`;powerValue.textContent=pct;view.setPullback(v);}function resetPowerControl(){setPowerVisual(0);view.setPullback(0);}function powerFromEvent(e){const r=$('#powerTrack').getBoundingClientRect();return clamp((e.clientY-r.top)/r.height,0,1);}
powerControl.addEventListener('pointerdown',e=>{if(!canHumanAim())return;audio.unlock();pulling=true;powerPid=e.pointerId;powerControl.setPointerCapture?.(e.pointerId);setPowerVisual(powerFromEvent(e));});powerControl.addEventListener('pointermove',e=>{if(pulling&&e.pointerId===powerPid)setPowerVisual(powerFromEvent(e));});function releasePower(){if(!pulling)return;pulling=false;cue.power=clamp(pulledPower,.02,1);humanCue.power=cue.power;view.setPullback(0);if(pulledPower>.04&&canHumanAim())attemptStrike();setTimeout(resetPowerControl,75);}powerControl.addEventListener('pointerup',releasePower);powerControl.addEventListener('pointercancel',()=>{pulling=false;resetPowerControl();});

// Fine aim wheel: screen-right drag rotates the cue screen-right (not inverted).
const aimWheel=$('#aimWheel'),aimDisc=$('#aimWheelDisc'),aimNeedle=$('#aimWheelNeedle');let wheelDrag=false,wheelPid=null,lastX=0,wheelVisual=0;function wheelReset(){wheelVisual=0;aimNeedle.style.transform='translateX(-50%) rotate(0deg)';}
aimDisc.addEventListener('pointerdown',e=>{if(!canHumanAim())return;wheelDrag=true;wheelPid=e.pointerId;lastX=e.clientX;aimDisc.setPointerCapture?.(e.pointerId);});aimDisc.addEventListener('pointermove',e=>{if(!wheelDrag||e.pointerId!==wheelPid||!canHumanAim())return;const dx=e.clientX-lastX;lastX=e.clientX;cue.angle-=dx*.00042;wheelVisual=clamp(wheelVisual+dx*.65,-35,35);aimNeedle.style.transform=`translateX(-50%) rotate(${wheelVisual}deg)`;});function wheelEnd(){wheelDrag=false;wheelPid=null;wheelReset();}aimDisc.addEventListener('pointerup',wheelEnd);aimDisc.addEventListener('pointercancel',wheelEnd);

// Spin.
const spinPanel=$('#spinPanel'),spinPad=$('#spinPad'),spinDot=$('#spinDot');function setSpinOpen(v){spinPanel.classList.toggle('open',!!v);$('#spinBtn').classList.toggle('active',!!v);}$('#spinBtn').addEventListener('click',()=>{if(!canHumanAim())return;audio.ui();setSpinOpen(!spinPanel.classList.contains('open'));setMenu(false);});function syncSpinUI(){spinDot.style.left=`${50+cue.spinX*39}%`;spinDot.style.top=`${50-cue.spinY*39}%`;$('#spinMiniDot').style.transform=`translate(${cue.spinX*11}px,${-cue.spinY*11}px)`;$('#spinText').textContent=Math.hypot(cue.spinX,cue.spinY)<.05?'CENTER':`${cue.spinY>=0?'FOLLOW':'DRAW'} · SIDE ${Math.round(cue.spinX*100)}`;}function spinEvent(e){const r=spinPad.getBoundingClientRect();let x=(e.clientX-r.left)/r.width*2-1,y=1-(e.clientY-r.top)/r.height*2,l=Math.hypot(x,y);if(l>1){x/=l;y/=l;}cue.spinX=humanCue.spinX=x;cue.spinY=humanCue.spinY=y;syncSpinUI();}spinPad.addEventListener('pointerdown',e=>{spinPad.setPointerCapture?.(e.pointerId);spinEvent(e);});spinPad.addEventListener('pointermove',e=>{if(e.buttons)spinEvent(e);});$('#spinCenter').addEventListener('click',()=>{cue.spinX=cue.spinY=humanCue.spinX=humanCue.spinY=0;syncSpinUI();});

// Menu / mode hub / fullscreen.
const menu=$('#menuPanel'),scrim=$('#scrim');function setMenu(v){menu.classList.toggle('open',!!v);scrim.classList.toggle('show',!!v);if(v)setSpinOpen(false);}$('#menuBtn').addEventListener('click',()=>setMenu(true));$('#menuClose').addEventListener('click',()=>setMenu(false));scrim.addEventListener('click',()=>setMenu(false));$('#restart').addEventListener('click',()=>{setMenu(false);if(onlineMode){online.rematch();showStatus('REMATCH REQUESTED',900);return;}resetRack();});$('#gameMode').addEventListener('change',e=>{setMenu(false);startMode(e.target.value);});$('#matchMode').addEventListener('change',e=>{if(e.target.value==='online'){$('#onlinePanel').classList.add('open');$('#modeHub').classList.add('show');return;}if(onlineMode){online.leave();onlineMode=false;onlineReady=false;onlineSeat=null;onlineRoomCode='';}aiMode=e.target.value==='ai';resetRack();});$('#aiDifficulty').addEventListener('change',e=>{aiDifficulty=e.target.value;resetRack();});$('#powerSide').addEventListener('change',e=>document.body.classList.toggle('power-right',e.target.value==='right'));$('#aimWheelEnabled').addEventListener('change',e=>aimWheel.classList.toggle('hidden-control',!e.target.checked));$('#soundEnabled').addEventListener('change',e=>audio.setEnabled(e.target.checked));$('#soundVolume').addEventListener('input',e=>audio.setVolume(+e.target.value/100));
async function toggleFullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen?.();else await document.documentElement.requestFullscreen?.();}catch(_){showStatus('FULLSCREEN BLOCKED — PRESS F11',1500);}}$('#fullscreenBtn').addEventListener('click',toggleFullscreen);
for(const card of document.querySelectorAll('.mode-card'))card.addEventListener('click',async()=>{audio.unlock();if(onlineMode){online.leave();onlineMode=false;onlineReady=false;onlineSeat=null;onlineRoomCode='';$('#matchMode').value='ai';aiMode=true;}startMode(card.dataset.mode);if($('#autoFullscreen').checked&&!document.fullscreenElement){try{await document.documentElement.requestFullscreen?.();}catch(_){showStatus('PRESS F11 FOR FULLSCREEN',1300);}}});
$('#onlineOpenBtn').addEventListener('click',()=>{$('#onlinePanel').classList.add('open');});$('#onlineClose').addEventListener('click',()=>$('#onlinePanel').classList.remove('open'));$('#onlineCreate').addEventListener('click',createOnlineRoom);$('#onlineJoin').addEventListener('click',joinOnlineRoom);$('#onlineLeave').addEventListener('click',leaveOnline);$('#onlineCopy').addEventListener('click',async()=>{if(!onlineRoomCode)return;try{await navigator.clipboard.writeText(onlineRoomCode);showStatus('ROOM CODE COPIED',800);}catch(_){showStatus(`ROOM ${onlineRoomCode}`,1300);}});$('#onlineJoinCode').addEventListener('input',e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5));
canvas.addEventListener('pointerdown',()=>setSpinOpen(false),{passive:true});window.addEventListener('keydown',e=>{if(e.key==='Escape'){setSpinOpen(false);setMenu(false);$('#onlinePanel').classList.remove('open');}if(e.key==='F2')$('#modeHub').classList.add('show');});for(const b of document.querySelectorAll('button'))b.addEventListener('pointerdown',()=>audio.unlock(),{passive:true});

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
    moveCueAt:(x,z)=>moveCueFromPoint({x,z})
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

let last=performance.now();function loop(now){const dt=(now-last)/1000;last=now;world.update(dt);audio.updateRolling(world);const moving=!world.allStopped();
  // Independent safety net: a latched physical scratch must always own a
  // visible protected cue body, even before rules finish adjudicating.
  if(cueScratchLatched&&match?.shotActive&&!isBallInHand())match.stageCueScratch?.();
  if(match.shotActive&&!moving&&!view.isStrokeAnimating()&&(wasMoving||now-shotClock>600)){if(!onlineMode)finalizeSettledShot(now);}wasMoving=moving;if(isBallInHand()&&!moving){match.ensureCueBallInHandVisible?.();const liveCue=match.cueBall?.();if(liveCue){liveCue.potted=false;liveCue.offTable=false;liveCue.inHand=true;if(cue.cueBall!==liveCue)cue.setCueBall(liveCue);}}if(!onlineMode&&now>=cueRecoveryHoldUntil)ai.tick(now,match);view.render();requestAnimationFrame(loop);}requestAnimationFrame(loop);

};

__modules["src/physics/PhysicsWorld.js"]=function(require,module,exports){
const { PHYSICS, TABLE } = require("src/config.js");
const { applyCloth, contactSlip } = require("src/physics/SpinPhysics.js");
const { solveBallBall } = require("src/physics/CollisionSolver.js");
const { CushionSystem } = require("src/physics/CushionSystem.js");
const { PocketSystem } = require("src/physics/PocketSystem.js");
class PhysicsWorld {
  constructor(){
    this.balls=[];this.accumulator=0;this.table=TABLE;this.cushions=new CushionSystem(this.table);this.pockets=new PocketSystem(this.table);this.time=0;
    this.onCollision=null;this.onCushion=null;this.onPocket=null;this.onOffTable=null;
    this.lastStepStats={substeps:1,pairChecks:0,cushionChecks:0,activeBalls:0};
    this.totalSteps=0;
  }
  setTable(table){this.table=table||TABLE;this.cushions.setTable(this.table);this.pockets.setTable(this.table);}
  addBall(b){this.balls.push(b);return b;}
  clear(){this.balls.length=0;this.accumulator=0;this.time=0;this.totalSteps=0;}
  allStopped(){for(const b of this.balls)if(!b.potted&&!b.inHand&&!b.sleeping)return false;return true;}
  movingCount(){let n=0;for(const b of this.balls)if(!b.potted&&!b.inHand&&!b.sleeping)n++;return n;}

  update(realDt){
    this.accumulator+=Math.min(realDt,0.05);
    let n=0;
    while(this.accumulator>=PHYSICS.fixedDt&&n<12){this.step(PHYSICS.fixedDt);this.accumulator-=PHYSICS.fixedDt;n++;}
    if(n===12&&this.accumulator>PHYSICS.fixedDt*4)this.accumulator=PHYSICS.fixedDt*2;
  }

  step(dt){
    let maxSpeedSq=0,minR=Infinity,active=0;
    for(const b of this.balls){
      if(b.potted||b.inHand)continue;if(!b.sleeping)active++;
      const s2=b.speedSq();if(s2>maxSpeedSq)maxSpeedSq=s2;if(b.radius<minR)minR=b.radius;
    }
    const maxSpeed=Math.sqrt(maxSpeedSq);
    // Use relative travel (two balls can approach each other) rather than single-ball
    // travel when choosing substeps. This closes high-speed ball/ball and rail
    // tunnelling gaps without changing the fixed 120 Hz game clock.
    const needed=minR<Infinity?Math.ceil((maxSpeed*2*dt)/(minR*0.42)):1;
    const substeps=Math.max(1,Math.min(PHYSICS.maxSubsteps,needed));
    const stats={substeps,pairChecks:0,cushionChecks:0,activeBalls:active};
    const h=dt/substeps;for(let s=0;s<substeps;s++)this.#substep(h,stats);
    this.lastStepStats=stats;this.time+=dt;this.totalSteps++;
  }

  #substep(dt,stats){
    const balls=this.balls;
    for(let i=0;i<balls.length;i++){
      const b=balls[i];
      if(b.potted){this.pockets.update(b,dt);continue;}
      if(b.inHand){b.velocity.set(0,0);b.angularVelocity[0]=b.angularVelocity[1]=b.angularVelocity[2]=0;b.sleeping=true;b.motionState='rest';continue;}
      // Keep a zero-allocation previous centre for swept cushion tests. Even a
      // sleeping ball may be woken by a ball/ball collision later this substep.
      b._prevStepX=b.position.x;b._prevStepZ=b.position.y;
      if(b.sleeping)continue;
      applyCloth(b,dt);
      b.position.x+=b.velocity.x*dt;b.position.y+=b.velocity.y*dt;
      b.integrateOrientation(dt);
    }

    for(let pass=0;pass<3;pass++){
      for(let i=0;i<balls.length;i++){
        const a=balls[i];if(a.potted||a.inHand)continue;
        for(let j=i+1;j<balls.length;j++){
          const b=balls[j];if(b.potted||b.inHand||(a.sleeping&&b.sleeping))continue;
          stats.pairChecks++;const beforeA=a.lastCollision,beforeB=b.lastCollision;
          if(solveBallBall(a,b)&&this.onCollision&&(a.lastCollision!==beforeA||b.lastCollision!==beforeB))this.onCollision(a,b);
        }
      }
      for(let i=0;i<balls.length;i++){
        const b=balls[i];if(b.potted||b.inHand||b.sleeping)continue;
        stats.cushionChecks++;const before=b.lastCollision;
        const px=pass===0?b._prevStepX:NaN,pz=pass===0?b._prevStepZ:NaN;
        if(this.cushions.solve(b,px,pz)&&this.onCushion&&b.lastCollision!==before)this.onCushion(b,b.lastCollision);
      }
    }

    const settleSpeedSq=PHYSICS.settleSpeed*PHYSICS.settleSpeed;
    for(let i=0;i<balls.length;i++){
      const b=balls[i];if(b.potted||b.inHand)continue;
      if(this.pockets.update(b,dt)){if(this.onPocket)this.onPocket(b);continue;}
      const T=this.table||TABLE;const offX=Math.abs(b.position.x)>T.width/2+0.22;
      const offZ=Math.abs(b.position.y)>T.length/2+0.22;
      if(offX||offZ){
        b.offTable=true;b.potted=true;b.velocity.set(0,0);b.angularVelocity[0]=b.angularVelocity[1]=b.angularVelocity[2]=0;b.sleeping=true;b.motionState='rest';
        if(this.onOffTable)this.onOffTable(b);continue;
      }
      if(b.sleeping)continue;
      const slip=contactSlip(b);b.slipSpeed=slip.speed;
      // Residual vertical-axis side spin does not move the centre of an ideal
      // sphere and must not delay the next turn. Rest is therefore based on
      // translational speed plus cloth-contact slip.
      if(b.speedSq()<settleSpeedSq && slip.speed<PHYSICS.settleSlipSpeed){
        b.sleepTimer+=dt;
        if(b.sleepTimer>=PHYSICS.settleDelay){
          b.velocity.set(0,0);b.angularVelocity[0]=b.angularVelocity[1]=b.angularVelocity[2]=0;
          b.sleeping=true;b.motionState='rest';b.slipSpeed=0;
        }
      }else b.sleepTimer=0;
    }
  }
}

Object.assign(exports,{PhysicsWorld});

};

__modules["src/config.js"]=function(require,module,exports){
const TABLE = {
  length: 3.569,
  width: 1.778,
  cushionHeight: 0.038,
  railWidth: 0.115,
  ballRadius: 0.02625,
  ballMass: 0.142,
  // v4.6.2: slightly more forgiving snooker mouths. The opening is now
  // visibly and physically wider than one 52.5 mm ball while preserving
  // tighter snooker geometry than the pool table.
  cornerPocketOpening: 0.094,
  middlePocketOpening: 0.100,
  // Snooker pockets use more rounded jaws than American pool. These values
  // are intentionally conservative because the snooker table is not governed
  // by the WPA pool-table cut-angle specification.
  cornerPocketCutAngle: 33,
  middlePocketCutAngle: 68,
  cornerPocketShelf: 0.027,
  middlePocketShelf: 0.008,
};

const POOL_TABLE = Object.freeze({
  length: 2.54,
  width: 1.27,
  cushionHeight: 0.037,
  railWidth: 0.105,
  ballRadius: 0.028575,
  ballMass: 0.17,
  // WPA recommended mouth widths: 4.5 in corner, 5 in side.
  cornerPocketOpening: 0.1143,
  middlePocketOpening: 0.127,
  // WPA horizontal cut angles are 142° corner / 104° side. The collision
  // geometry uses their deflection from a straight cushion (38° / 76°).
  cornerPocketCutAngle: 38,
  middlePocketCutAngle: 76,
  // Shelf is represented in top-down physics as the distance the ball centre
  // must travel beyond the mouth before the drop region is reached.
  cornerPocketShelf: 0.036,
  middlePocketShelf: 0.007,
});

// Physics calibration for the 2D simulator. Values are expressed in SI units
// (metres, seconds, kilograms) and are shared by live play, AI and aim preview.
const PHYSICS = {
  fixedDt: 1 / 120,
  maxSubsteps: 12,
  gravity: 9.81,

  ballRestitution: 0.94,
  ballFriction: 0.045,

  cushionRestitution: 0.82,
  cushionRestitutionFast: 0.85,
  cushionFriction: 0.17,

  slideFriction: 0.205,
  rollingResistance: 0.0105,
  lowSpeedResistanceBoost: 0.018,
  lowSpeedResistanceRange: 0.13,
  viscousRollingDrag: 0.012,
  slipToRollSpeed: 0.006,

  spinDecayMoving: 0.52,
  spinDecaySlow: 2.8,

  settleSpeed: 0.0045,
  settleSlipSpeed: 0.0065,
  settleDelay: 0.16,
  hardStopSpeed: 0.0018,

  penetrationSlop: 0.00012,
  positionCorrection: 0.78,

  // Pocket shelf behaviour. These are deliberately weak: jaws and cushion
  // geometry decide whether the ball enters; the shelf only removes the
  // artificial pinball-like bounce once the centre is already through the mouth.
  pocketShelfDamping: 5.2,
  pocketShelfPull: 0.62,
  pocketLateralPull: 0.48,
};

const CUE_PHYSICS = {
  maxCueSpeed: 7.0,
  maxTipOffset: 0.72,
  maxSquirtDegrees: 1.8,
  extremeSpinSpeedLoss: 0.10,
};

Object.assign(exports,{TABLE,POOL_TABLE,PHYSICS,CUE_PHYSICS});

};

__modules["src/physics/SpinPhysics.js"]=function(require,module,exports){
const { PHYSICS } = require("src/config.js");
const SPHERE_SLIP_FACTOR = 3.5; // 1 + mR^2/I for I = 2/5 mR^2

function contactSlip(ball){
  const R=ball.radius,v=ball.velocity,w=ball.angularVelocity;
  const x=v.x+w[2]*R;
  const z=v.y-w[0]*R;
  return {x,z,speed:Math.hypot(x,z)};
}

function smooth01(x){x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);}

// Cloth contact model:
// 1) kinetic sliding friction acts opposite contact-point slip;
// 2) the exact final partial impulse lands on the rolling constraint instead
//    of crossing it and oscillating around zero slip;
// 3) once rolling, a calibrated rolling resistance and small viscous term slow
//    the centre smoothly, with stronger nap/contact loss only near rest.
function applyCloth(ball, dt) {
  if (ball.potted || ball.sleeping) return;
  const R=ball.radius,v=ball.velocity,w=ball.angularVelocity;

  let slipX=v.x+w[2]*R;
  let slipZ=v.y-w[0]*R;
  let slipSpeed=Math.hypot(slipX,slipZ);
  ball.slipSpeed=slipSpeed;

  if(slipSpeed>PHYSICS.slipToRollSpeed){
    ball.motionState='sliding';
    const invSlip=1/slipSpeed;
    const maxDv=PHYSICS.slideFriction*PHYSICS.gravity*dt;
    // A translational velocity change dV changes contact slip by 3.5*dV for
    // a solid sphere.  This exact cap prevents overshoot of the rolling state.
    const dv=Math.min(maxDv,slipSpeed/SPHERE_SLIP_FACTOR);
    const dvx=-slipX*invSlip*dv;
    const dvz=-slipZ*invSlip*dv;
    v.x+=dvx;v.y+=dvz;

    const Jx=ball.mass*dvx,Jz=ball.mass*dvz;
    w[0]+=(-R*Jz)*ball.invInertia;
    w[2]+=( R*Jx)*ball.invInertia;

    // Re-evaluate after the impulse.  If we reached no-slip, project exactly
    // onto pure rolling to remove numerical micro-slip.
    slipX=v.x+w[2]*R;slipZ=v.y-w[0]*R;slipSpeed=Math.hypot(slipX,slipZ);
    if(slipSpeed<=PHYSICS.slipToRollSpeed*1.05){
      w[0]=v.y/R;w[2]=-v.x/R;ball.slipSpeed=0;ball.motionState='rolling';
    }else ball.slipSpeed=slipSpeed;
  }else{
    ball.motionState='rolling';ball.slipSpeed=0;
    // Enforce the rolling constraint before applying rolling resistance.
    w[0]=v.y/R;w[2]=-v.x/R;

    const speed=Math.hypot(v.x,v.y);
    if(speed>0){
      const low=smooth01(1-speed/PHYSICS.lowSpeedResistanceRange);
      const mu=PHYSICS.rollingResistance+PHYSICS.lowSpeedResistanceBoost*low;
      const decel=(mu*PHYSICS.gravity + PHYSICS.viscousRollingDrag*speed)*dt;
      const ns=Math.max(0,speed-decel);
      if(ns<=PHYSICS.hardStopSpeed){v.x=0;v.y=0;w[0]=0;w[2]=0;}
      else {const k=ns/speed;v.x*=k;v.y*=k;w[0]=v.y/R;w[2]=-v.x/R;}
    }
  }

  const speed=Math.hypot(v.x,v.y);
  const spinDecay=speed<PHYSICS.lowSpeedResistanceRange?PHYSICS.spinDecaySlow:PHYSICS.spinDecayMoving;
  w[1]*=Math.exp(-spinDecay*dt);
  if(Math.abs(w[1])<0.015)w[1]=0;
}

Object.assign(exports,{contactSlip,applyCloth});

};

__modules["src/physics/CollisionSolver.js"]=function(require,module,exports){
const { PHYSICS } = require("src/config.js");
function solveBallBall(a,b) {
  if (a.potted || b.potted) return false;
  const dx=b.position.x-a.position.x, dz=b.position.y-a.position.y;
  const minDist=a.radius+b.radius;
  if(Math.abs(dx)>=minDist || Math.abs(dz)>=minDist) return false;
  const distSq=dx*dx+dz*dz;
  if(distSq>=minDist*minDist) return false;

  let dist=Math.sqrt(Math.max(distSq,1e-14));
  let nx,nz;
  if(dist<1e-7){ nx=1; nz=0; dist=minDist; }
  else { const invD=1/dist; nx=dx*invD; nz=dz*invD; }
  const tx=-nz,tz=nx;

  const penetration=minDist-dist;
  const invMassSum=a.invMass+b.invMass;
  const corr=Math.max(0,penetration-PHYSICS.penetrationSlop)*PHYSICS.positionCorrection/invMassSum;
  a.position.x-=nx*corr*a.invMass; a.position.y-=nz*corr*a.invMass;
  b.position.x+=nx*corr*b.invMass; b.position.y+=nz*corr*b.invMass;

  const rvx=b.velocity.x-a.velocity.x, rvz=b.velocity.y-a.velocity.y;
  const vn=rvx*nx+rvz*nz;
  if(vn<0){
    const jn=-(1+PHYSICS.ballRestitution)*vn/invMassSum;
    const inx=nx*jn, inz=nz*jn;
    a.velocity.x-=inx*a.invMass; a.velocity.y-=inz*a.invMass;
    b.velocity.x+=inx*b.invMass; b.velocity.y+=inz*b.invMass;

    // In-plane contact friction / throw. Side spin changes tangential contact
    // speed and therefore the small cut-induced / spin-induced throw impulse.
    const raX=nx*a.radius, raZ=nz*a.radius;
    const rbX=-nx*b.radius, rbZ=-nz*b.radius;
    const vaSpinX=a.angularVelocity[1]*raZ;
    const vaSpinZ=-a.angularVelocity[1]*raX;
    const vbSpinX=b.angularVelocity[1]*rbZ;
    const vbSpinZ=-b.angularVelocity[1]*rbX;
    const vt=(b.velocity.x+vbSpinX-a.velocity.x-vaSpinX)*tx+
             (b.velocity.y+vbSpinZ-a.velocity.y-vaSpinZ)*tz;
    const denomT=invMassSum+(a.radius*a.radius)*a.invInertia+(b.radius*b.radius)*b.invInertia;
    let jt=-vt/denomT;
    const maxJt=PHYSICS.ballFriction*Math.abs(jn);
    jt=Math.max(-maxJt,Math.min(maxJt,jt));
    const itx=tx*jt, itz=tz*jt;
    a.velocity.x-=itx*a.invMass; a.velocity.y-=itz*a.invMass;
    b.velocity.x+=itx*b.invMass; b.velocity.y+=itz*b.invMass;
    a.angularVelocity[1]+=(-a.radius*jt)*a.invInertia;
    b.angularVelocity[1]+=(-b.radius*jt)*b.invInertia;

    a.lastCollision=b.lastCollision=Math.abs(jn);
    a.motionState=b.motionState='sliding';
    a.wake(); b.wake();
  }
  return true;
}

Object.assign(exports,{solveBallBall});

};

__modules["src/physics/CushionSystem.js"]=function(require,module,exports){
const { PHYSICS, TABLE } = require("src/config.js");
const { buildCushionSegments, geometryFor, pocketEntered, pocketLaneAtSide, pocketShelfInfo } = require("src/table/TableGeometry.js");
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

class CushionSystem{
  constructor(table=TABLE){this.setTable(table);}
  setTable(table){this.table=table||TABLE;this.geometry=geometryFor(this.table);this.segments=buildCushionSegments(this.table);}

  #bounce(ball,nx,nz){
    const R=ball.radius,vn=ball.velocity.x*nx+ball.velocity.y*nz;
    if(vn>=0)return false;
    const tx=-nz,tz=nx,vt=ball.velocity.x*tx+ball.velocity.y*tz;
    const contactT=vt+ball.angularVelocity[1]*R,speedIn=-vn;
    const blend=clamp((speedIn-.4)/2.6,0,1);
    const e=PHYSICS.cushionRestitution+(PHYSICS.cushionRestitutionFast-PHYSICS.cushionRestitution)*blend;
    const jn=-(1+e)*vn*ball.mass;
    ball.velocity.x+=nx*jn*ball.invMass;ball.velocity.y+=nz*jn*ball.invMass;
    const denomT=ball.invMass+R*R*ball.invInertia;
    let jt=-contactT/denomT,maxJt=PHYSICS.cushionFriction*Math.abs(jn);
    jt=clamp(jt,-maxJt,maxJt);
    ball.velocity.x+=tx*jt*ball.invMass;ball.velocity.y+=tz*jt*ball.invMass;
    ball.angularVelocity[1]+=R*jt*ball.invInertia;
    ball.lastCollision=Math.abs(jn);ball.motionState='sliding';ball.wake();
    return true;
  }

  #solveSegments(ball){
    let hit=false;const R=ball.radius,R2=R*R;
    for(const sg of this.segments){
      const apx=ball.position.x-sg.ax,apz=ball.position.y-sg.az;
      const u=clamp(sg.lenSq>0?(apx*sg.dx+apz*sg.dz)/sg.lenSq:0,0,1);
      const qx=sg.ax+sg.dx*u,qz=sg.az+sg.dz*u;
      let dx=ball.position.x-qx,dz=ball.position.y-qz,dsq=dx*dx+dz*dz;
      if(dsq>=R2)continue;
      const signed=dx*sg.nx+dz*sg.nz;
      // Cushion faces are one-sided. Balls already through the mouth are never
      // pulled back by the reverse side of a jaw.
      if(signed<-.00125)continue;
      let d=Math.sqrt(Math.max(dsq,1e-12)),nx,nz;
      if(d<1e-6){nx=sg.nx;nz=sg.nz;d=0;}
      else{
        const inv=1/d;nx=dx*inv;nz=dz*inv;
        // At a segment endpoint radial contact is desirable (rounded nose), but
        // never accept a normal that points mostly through the back of the rail.
        if(nx*sg.nx+nz*sg.nz<.08){nx=sg.nx;nz=sg.nz;}
      }
      const pen=R-d;
      ball.position.x+=nx*(pen+.00004);ball.position.y+=nz*(pen+.00004);
      if(this.#bounce(ball,nx,nz))hit=true; else hit=true;
    }
    return hit;
  }

  #boundaryFailsafe(ball){
    // Segment/jaw geometry handles normal play. This guard only catches numerical
    // escapes at joins or at very shallow high-speed contacts. It deliberately
    // opens at real pocket mouths, so it cannot block a legitimate pot.
    if(pocketEntered(ball,this.table,this.geometry))return false;
    const shelf=pocketShelfInfo(ball,this.table,this.geometry);
    if(shelf&&shelf.depth>0&&Math.abs(shelf.lateral)<shelf.half+ball.radius*.18)return false;
    const T=this.table,R=ball.radius,hx=T.width/2,hz=T.length/2;
    const lanes=pocketLaneAtSide(ball.position.x,ball.position.y,R,T,this.geometry);
    const limX=hx-R,limZ=hz-R,eps=this.geometry.guardMargin;
    let hit=false;

    if(ball.position.x>limX+eps&&!lanes.xOpen){ball.position.x=limX;hit=this.#bounce(ball,-1,0)||hit;}
    else if(ball.position.x<-limX-eps&&!lanes.xOpen){ball.position.x=-limX;hit=this.#bounce(ball,1,0)||hit;}
    if(ball.position.y>limZ+eps&&!lanes.zOpen){ball.position.y=limZ;hit=this.#bounce(ball,0,-1)||hit;}
    else if(ball.position.y<-limZ-eps&&!lanes.zOpen){ball.position.y=-limZ;hit=this.#bounce(ball,0,1)||hit;}

    // Extreme escape safeguard. A ball that somehow clears a jaw without
    // entering the defined pocket funnel is returned to the nearest legal edge
    // rather than falling into an invisible void/off-table state.
    const outerX=hx+this.geometry.jawDepth+R*1.4,outerZ=hz+this.geometry.jawDepth+R*1.4;
    if(Math.abs(ball.position.x)>outerX||Math.abs(ball.position.y)>outerZ){
      const ax=Math.abs(ball.position.x)-hx,az=Math.abs(ball.position.y)-hz;
      if(ax>=az){const sx=Math.sign(ball.position.x)||1;ball.position.x=sx*limX;hit=this.#bounce(ball,-sx,0)||true;}
      else{const sz=Math.sign(ball.position.y)||1;ball.position.y=sz*limZ;hit=this.#bounce(ball,0,-sz)||true;}
    }
    return hit;
  }

  solve(ball){
    if(ball.potted)return false;
    const hitSegments=this.#solveSegments(ball);
    const hitGuard=this.#boundaryFailsafe(ball);
    return hitSegments||hitGuard;
  }
}

Object.assign(exports,{CushionSystem});

};

__modules["src/table/TableGeometry.js"]=function(require,module,exports){
const { TABLE } = require("src/config.js");
const SQRT2=Math.SQRT2,DEG=Math.PI/180;
const isPoolTable=t=>Math.abs((t?.length||0)-2.54)<.02 && Math.abs((t?.width||0)-1.27)<.02;

function geometryFor(table=TABLE){
  const R=table.ballRadius,pool=isPoolTable(table);
  const cornerMouth=Math.max(table.cornerPocketOpening,R*3.0);
  const middleMouth=Math.max(table.middlePocketOpening,R*3.1);
  // Corner mouth is measured from pointed lip to pointed lip. With symmetric
  // lips on perpendicular rails the rail inset is mouth / sqrt(2).
  const cornerLipInset=cornerMouth/SQRT2;
  const middleHalf=middleMouth/2;
  const cornerAngle=(table.cornerPocketCutAngle??(pool?38:33))*DEG;
  const middleAngle=(table.middlePocketCutAngle??(pool?76:68))*DEG;
  const cornerShelf=Math.max(table.cornerPocketShelf??R*1.15,R*.72);
  const middleShelf=Math.max(table.middlePocketShelf??R*.35,R*.18);
  return Object.freeze({
    pool,
    cornerMouth,middleMouth,middleHalf,cornerLipInset,
    cornerAngle,middleAngle,cornerShelf,middleShelf,
    // Facing lengths stop before opposite jaws cross. The pocket liner takes
    // over behind them, just as it does on a real table.
    cornerJawLength:Math.max(R*1.72,cornerLipInset*.62),
    middleJawLength:Math.max(R*1.55,middleHalf*.70),
    guardMargin:Math.max(0.0014,R*.05),
    captureMargin:Math.max(.0010,R*.035),
  });
}

function makeSegment(ax,az,bx,bz,kind='cushion'){
  const dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz)||1;
  let nx=-dz/len,nz=dx/len,mx=(ax+bx)/2,mz=(az+bz)/2;
  if(nx*(-mx)+nz*(-mz)<0){nx=-nx;nz=-nz;}
  return Object.freeze({ax,az,bx,bz,dx,dz,lenSq:dx*dx+dz*dz,len,nx,nz,kind});
}

function buildCushionSegments(table=TABLE){
  const hx=table.width/2,hz=table.length/2,g=geometryFor(table),a=g.cornerLipInset,m=g.middleHalf,s=[];
  s.push(
    makeSegment(-hx,-hz+a,-hx,-m,'straight'),makeSegment(-hx,m,-hx,hz-a,'straight'),
    makeSegment(hx,-hz+a,hx,-m,'straight'),makeSegment(hx,m,hx,hz-a,'straight'),
    makeSegment(-hx+a,-hz,hx-a,-hz,'straight'),makeSegment(-hx+a,hz,hx-a,hz,'straight')
  );

  // Side-pocket facings. Their directions use the WPA-style cut angle for
  // pool and a slightly rounder profile for snooker.
  const sm=Math.sin(g.middleAngle),cm=Math.cos(g.middleAngle),Lm=g.middleJawLength;
  for(const sx of [-1,1]){
    s.push(
      makeSegment(sx*hx,-m,sx*hx+sx*sm*Lm,-m+cm*Lm,'middleJaw'),
      makeSegment(sx*hx,m,sx*hx+sx*sm*Lm,m-cm*Lm,'middleJaw')
    );
  }

  // Corner-pocket facings. The two lips are separated by the requested mouth
  // width; each facing then turns outward by the configured cut angle.
  const cc=Math.cos(g.cornerAngle),sc=Math.sin(g.cornerAngle),Lc=g.cornerJawLength;
  for(const sx of [-1,1])for(const sz of [-1,1]){
    const hLip={x:sx*(hx-a),z:sz*hz};
    const vLip={x:sx*hx,z:sz*(hz-a)};
    s.push(
      makeSegment(hLip.x,hLip.z,hLip.x+sx*cc*Lc,hLip.z+sz*sc*Lc,'cornerJaw'),
      makeSegment(vLip.x,vLip.z,vLip.x+sx*sc*Lc,vLip.z+sz*cc*Lc,'cornerJaw')
    );
  }
  return Object.freeze(s);
}

function buildPockets(table=TABLE){
  const hx=table.width/2,hz=table.length/2,g=geometryFor(table),a=g.cornerLipInset;
  // Corner target centres continue the ray through the actual mouth midpoint.
  // This keeps the visual pocket and clean-pot aiming axis aligned even though
  // the table is rectangular rather than square.
  const corner=(sx,sz,name)=>{const mx=sx*(hx-a/2),mz=sz*(hz-a/2),n=Math.hypot(mx,mz)||1,ext=g.cornerShelf+table.ballRadius*.85;return Object.freeze({name,type:'corner',sx,sz,x:mx+mx/n*ext,z:mz+mz/n*ext});};
  const mo=g.middleShelf+table.ballRadius*.95;
  return Object.freeze([
    corner(-1,-1,'Baulk left'),corner(1,-1,'Baulk right'),
    Object.freeze({name:'Middle left',type:'middle',sx:-1,sz:0,x:-hx-mo,z:0}),
    Object.freeze({name:'Middle right',type:'middle',sx:1,sz:0,x:hx+mo,z:0}),
    corner(-1,1,'Black left'),corner(1,1,'Black right')
  ]);
}

// Returns the pocket shelf coordinates for a ball centre. Depth is zero at the
// mouth line and positive into the pocket. Lateral is measured along the mouth.
function pocketShelfInfo(ball,table=TABLE,geom=geometryFor(table)){
  const x=ball.position.x,z=ball.position.y,R=ball.radius,hx=table.width/2,hz=table.length/2;
  let best=null;
  for(const sx of [-1,1]){
    const depth=sx*x-hx,lateral=z;
    const half=geom.middleHalf;
    const captureHalf=Math.max(R*.62,half-R*(geom.pool?.40:.30));
    if(depth>-R*.45 && Math.abs(lateral)<half+R*.35){
      const score=Math.max(0,-depth)+Math.abs(lateral)*.15;
      if(!best||score<best.score)best={type:'middle',sx,sz:0,depth,lateral,half,captureHalf,shelf:geom.middleShelf,dirX:sx,dirZ:0,targetX:sx*(hx+geom.middleShelf+R*.70),targetZ:0,score};
    }
  }
  const a=geom.cornerLipInset;
  for(const sx of [-1,1])for(const sz of [-1,1]){
    const u=sx*x-hx,v=sz*z-hz;
    // Mouth line passes through (-a,0) and (0,-a): u + v + a = 0.
    const depth=(u+v+a)/SQRT2,lateral=(u-v)/SQRT2;
    const half=geom.cornerMouth/2;
    const captureHalf=Math.max(R*.54,half-R*(geom.pool?.46:.34));
    if(depth>-R*.50 && Math.abs(lateral)<half+R*.42 && u>-a-R*.35 && v>-a-R*.35){
      const score=Math.max(0,-depth)+Math.abs(lateral)*.12;
      if(!best||score<best.score)best={type:'corner',sx,sz,depth,lateral,half,captureHalf,shelf:geom.cornerShelf,dirX:sx/SQRT2,dirZ:sz/SQRT2,targetX:sx*(hx+(geom.cornerShelf+R*.78)/SQRT2),targetZ:sz*(hz+(geom.cornerShelf+R*.78)/SQRT2),score};
    }
  }
  return best;
}

function pocketLaneAtSide(x,z,r,table=TABLE,geom=geometryFor(table)){
  const hx=table.width/2,hz=table.length/2,ax=Math.abs(x),az=Math.abs(z);
  return {
    xOpen: az<=geom.middleHalf+r*.32 || az>=hz-geom.cornerLipInset-r*.30,
    zOpen: ax>=hx-geom.cornerLipInset-r*.30,
  };
}

function isPocketApproach(x,z,r,table=TABLE,geom=geometryFor(table),extra=0){
  const hx=table.width/2,hz=table.length/2,ax=Math.abs(x),az=Math.abs(z);
  const side=Math.abs(z)<=geom.middleHalf+r*.42+extra && ax>=hx-r-extra;
  const corner=(ax>=hx-geom.cornerLipInset-r*.42-extra && az>=hz-geom.cornerLipInset-r*.42-extra);
  return side||corner;
}

function pocketEntered(ball,table=TABLE,geom=geometryFor(table)){
  const p=pocketShelfInfo(ball,table,geom);if(!p)return false;
  // A ball must travel across the mouth and onto the shelf before it can drop.
  // This is what allows jaw rattles, rejections and slow hanging balls.
  return p.depth>=p.shelf && Math.abs(p.lateral)<=p.captureHalf;
}

function nearestPocketForPoint(x,z,table=TABLE){let best=null,dist=Infinity;for(const p of buildPockets(table)){const d=Math.hypot(x-p.x,z-p.z);if(d<dist){dist=d;best=p;}}return best;}
const POCKET_GEOMETRY=geometryFor(TABLE);
const CUSHION_SEGMENTS=buildCushionSegments(TABLE);
const POCKETS=buildPockets(TABLE);

Object.assign(exports,{geometryFor,buildCushionSegments,buildPockets,pocketShelfInfo,pocketLaneAtSide,isPocketApproach,pocketEntered,nearestPocketForPoint,POCKET_GEOMETRY,CUSHION_SEGMENTS,POCKETS});

};

__modules["src/physics/PocketSystem.js"]=function(require,module,exports){
const { PHYSICS, TABLE } = require("src/config.js");
const { buildPockets, geometryFor, pocketEntered, pocketShelfInfo } = require("src/table/TableGeometry.js");
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

class PocketSystem{
  constructor(table=TABLE){this.setTable(table);}
  setTable(table){this.table=table||TABLE;this.geometry=geometryFor(this.table);this.pockets=buildPockets(this.table);}

  #shelfAssist(ball,dt){
    const p=pocketShelfInfo(ball,this.table,this.geometry);if(!p)return null;
    // Only assist once the centre has actually crossed the mouth line. Before
    // that, cushion/jaw geometry remains fully responsible for acceptance or rejection.
    if(p.depth<=0)return p;
    const outward=ball.velocity.x*p.dirX+ball.velocity.y*p.dirZ;
    if(outward<-0.08)return p; // ball is genuinely escaping the shelf; do not magnetise it back.

    // Tangential motion loses energy on the shelf/liner while a weak downward
    // bias carries a legitimately-entered ball toward the drop. This produces a
    // smooth 8-Ball-Pool-like pocket finish without teleporting near misses.
    const tx=-p.dirZ,tz=p.dirX;
    const tangent=ball.velocity.x*tx+ball.velocity.y*tz;
    const damp=1-Math.exp(-PHYSICS.pocketShelfDamping*dt);
    ball.velocity.x-=tx*tangent*damp;
    ball.velocity.y-=tz*tangent*damp;

    const depth01=clamp(p.depth/Math.max(p.shelf,.001),0,1.25);
    const pull=PHYSICS.pocketShelfPull*(0.30+0.70*depth01);
    ball.velocity.x+=p.dirX*pull*dt;
    ball.velocity.y+=p.dirZ*pull*dt;

    const lateralNorm=clamp(p.lateral/Math.max(p.captureHalf,.001),-1.5,1.5);
    ball.velocity.x+=tx*(-lateralNorm*PHYSICS.pocketLateralPull)*dt;
    ball.velocity.y+=tz*(-lateralNorm*PHYSICS.pocketLateralPull)*dt;
    ball.motionState='sliding';ball.wake();
    return p;
  }

  update(ball,dt){
    if(ball.potted){ball.fall+=dt;return true;}
    const shelf=this.#shelfAssist(ball,dt);
    if(pocketEntered(ball,this.table,this.geometry)){
      const p=shelf||pocketShelfInfo(ball,this.table,this.geometry);
      ball.potted=true;ball.velocity.set(0,0);ball.angularVelocity[0]=ball.angularVelocity[1]=ball.angularVelocity[2]=0;ball.sleeping=true;ball.fall=0;
      if(p)ball.pocketDrop={startX:ball.position.x,startZ:ball.position.y,targetX:p.targetX,targetZ:p.targetZ,type:p.type};
      return true;
    }
    return false;
  }
}

Object.assign(exports,{PocketSystem});

};

__modules["src/game/SnookerSetup.js"]=function(require,module,exports){
const { Ball } = require("src/physics/Ball.js");
const { TABLE } = require("src/config.js");
const { BALL_VALUES } = require("src/game/BallRegistry.js");
// Phase 1 proportions are intentionally retained so Phase 2 changes gameplay,
// not the already-tested physics/table calibration. These are the canonical
// spots used by the rules/respot system in this build.
const COLOUR_SPOTS = Object.freeze({
  Yellow: Object.freeze({x:-0.292,z:-1.355}),
  Green:  Object.freeze({x: 0.292,z:-1.355}),
  Brown:  Object.freeze({x: 0.000,z:-1.355}),
  Blue:   Object.freeze({x: 0.000,z: 0.000}),
  Pink:   Object.freeze({x: 0.000,z: 0.890}),
  Black:  Object.freeze({x: 0.000,z: 1.490}),
});

const D_AREA = Object.freeze({ centerX:0, baulkZ:-1.355, radius:0.292 });

function decorate(ball,{kind,value,spotName=null}){
  ball.kind=kind;
  ball.value=value;
  ball.spotName=spotName;
  ball.offTable=false;
  return ball;
}

function createStandardBalls(world){
  world.setTable?.(TABLE);
  world.clear();
  const R=TABLE.ballRadius, d=R*2.02;
  const add=(name,color,x,z,meta)=>decorate(
    world.addBall(new Ball({name,color,x,z,radius:R,mass:TABLE.ballMass})), meta
  );
  const cue=add('Cue','white',0,-1.03,{kind:'cue',value:0});

  add('Yellow','#e7ca33',COLOUR_SPOTS.Yellow.x,COLOUR_SPOTS.Yellow.z,{kind:'colour',value:BALL_VALUES.Yellow,spotName:'Yellow'});
  add('Green','#1f9b52',COLOUR_SPOTS.Green.x,COLOUR_SPOTS.Green.z,{kind:'colour',value:BALL_VALUES.Green,spotName:'Green'});
  add('Brown','#8a552f',COLOUR_SPOTS.Brown.x,COLOUR_SPOTS.Brown.z,{kind:'colour',value:BALL_VALUES.Brown,spotName:'Brown'});
  add('Blue','#2476c8',COLOUR_SPOTS.Blue.x,COLOUR_SPOTS.Blue.z,{kind:'colour',value:BALL_VALUES.Blue,spotName:'Blue'});
  add('Pink','#ef91aa',COLOUR_SPOTS.Pink.x,COLOUR_SPOTS.Pink.z,{kind:'colour',value:BALL_VALUES.Pink,spotName:'Pink'});
  add('Black','#111513',COLOUR_SPOTS.Black.x,COLOUR_SPOTS.Black.z,{kind:'colour',value:BALL_VALUES.Black,spotName:'Black'});

  // 15-red triangle, apex toward baulk.
  const apexZ=0.958;
  let idx=1;
  for(let row=0;row<5;row++){
    const z=apexZ+row*(d*Math.sqrt(3)/2);
    for(let col=0;col<=row;col++){
      const x=(col-row/2)*d;
      add(`Red ${idx++}`,'#e52d43',x,z,{kind:'red',value:BALL_VALUES.Red});
    }
  }
  return cue;
}

function findBall(world,name){
  return world.balls.find(b=>b.name===name) || null;
}

Object.assign(exports,{COLOUR_SPOTS,D_AREA,createStandardBalls,findBall});

};

__modules["src/physics/Ball.js"]=function(require,module,exports){
const { Vec2 } = require("src/math/Vec2.js");
const { integrateQuat } = require("src/math/Quat.js");
let NEXT_ID=1;
class Ball {
  constructor({x=0,z=0,radius=0.02625,mass=0.142,color='red',name='ball'}={}){
    this.id=NEXT_ID++;this.name=name;this.color=color;this.radius=radius;this.mass=mass;this.invMass=1/mass;
    this.inertia=0.4*mass*radius*radius;this.invInertia=1/this.inertia;
    this.position=new Vec2(x,z);this.velocity=new Vec2();this.angularVelocity=[0,0,0];this.orientation=[0,0,0,1];
    this.potted=false;this.offTable=false;this.inHand=false;this.fall=0;this.sleeping=true;this.sleepTimer=0;this.lastCollision=0;
    this.kind=null;this.value=0;this.spotName=null;this.offTable=false;
    this.motionState='rest';this.slipSpeed=0;
  }
  wake(){this.sleeping=false;this.sleepTimer=0;if(this.motionState==='rest')this.motionState='rolling';}
  speedSq(){return this.velocity.x*this.velocity.x+this.velocity.y*this.velocity.y;}
  speed(){return Math.sqrt(this.speedSq());}
  angularSpeedSq(){const w=this.angularVelocity;return w[0]*w[0]+w[1]*w[1]+w[2]*w[2];}
  angularSpeed(){return Math.sqrt(this.angularSpeedSq());}
  integrateOrientation(dt){integrateQuat(this.orientation,this.angularVelocity,dt);}
}

Object.assign(exports,{Ball});

};

__modules["src/math/Vec2.js"]=function(require,module,exports){
class Vec2 {
  constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  set(x, y) { this.x = x; this.y = y; return this; }
  clone() { return new Vec2(this.x, this.y); }
  copy(v) { this.x = v.x; this.y = v.y; return this; }
  add(v) { this.x += v.x; this.y += v.y; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; return this; }
  scale(s) { this.x *= s; this.y *= s; return this; }
  addScaled(v, s) { this.x += v.x * s; this.y += v.y * s; return this; }
  dot(v) { return this.x * v.x + this.y * v.y; }
  lenSq() { return this.x * this.x + this.y * this.y; }
  len() { return Math.hypot(this.x, this.y); }
  normalize() { const l = this.len(); if (l > 1e-12) this.scale(1 / l); return this; }
  perp() { return new Vec2(-this.y, this.x); }
  static sub(a,b) { return new Vec2(a.x-b.x, a.y-b.y); }
  static add(a,b) { return new Vec2(a.x+b.x, a.y+b.y); }
}

Object.assign(exports,{Vec2});

};

__modules["src/math/Quat.js"]=function(require,module,exports){
function integrateQuat(q, w, dt) {
  const [x,y,z,s] = q;
  const [wx,wy,wz] = w;
  const hx = 0.5 * dt;
  const nx = x + hx * ( wx*s + wy*z - wz*y );
  const ny = y + hx * (-wx*z + wy*s + wz*x );
  const nz = z + hx * ( wx*y - wy*x + wz*s );
  const ns = s + hx * (-wx*x - wy*y - wz*z );
  const inv = 1 / Math.hypot(nx,ny,nz,ns);
  q[0]=nx*inv; q[1]=ny*inv; q[2]=nz*inv; q[3]=ns*inv;
}

Object.assign(exports,{integrateQuat});

};

__modules["src/game/BallRegistry.js"]=function(require,module,exports){
const BALL_VALUES = Object.freeze({
  Cue: 0,
  Red: 1,
  Yellow: 2,
  Green: 3,
  Brown: 4,
  Blue: 5,
  Pink: 6,
  Black: 7,
});

const COLOUR_ORDER = Object.freeze(['Yellow','Green','Brown','Blue','Pink','Black']);

function isCue(ball){ return !!ball && ball.kind === 'cue'; }
function isRed(ball){ return !!ball && ball.kind === 'red'; }
function isColour(ball){ return !!ball && ball.kind === 'colour'; }
function valueOf(ball){ return ball?.value ?? 0; }
function displayBall(ball){
  if(!ball) return 'NONE';
  return ball.kind === 'red' ? 'RED' : String(ball.name || 'BALL').toUpperCase();
}

Object.assign(exports,{BALL_VALUES,COLOUR_ORDER,isCue,isRed,isColour,valueOf,displayBall});

};

__modules["src/game/PoolSetup.js"]=function(require,module,exports){
const { Ball } = require("src/physics/Ball.js");
const { POOL_TABLE } = require("src/config.js");
const POOL_BALL_RADIUS = POOL_TABLE.ballRadius; // 2.25 in regulation pool ball

const POOL_COLORS = Object.freeze({
  1:'#f2d125',2:'#2f63d8',3:'#df3038',4:'#6d43a7',5:'#f07f24',6:'#24965b',7:'#7f2536',8:'#0b0d12',
  9:'#f2d125',10:'#2f63d8',11:'#df3038',12:'#6d43a7',13:'#f07f24',14:'#24965b',15:'#7f2536'
});

function decorate(ball,{number=0,poolGroup=null}={}){
  ball.kind=number===0?'cue':'pool';
  ball.value=number;
  ball.number=number;
  ball.poolGroup=poolGroup;
  ball.offTable=false;
  return ball;
}

function addPoolBall(world,number,x,z){
  const color=number===0?'#f7f7f4':POOL_COLORS[number];
  const group=number===8?'eight':number===0?'cue':number<=7?'solid':'stripe';
  const name=number===0?'Cue':`Ball ${number}`;
  return decorate(world.addBall(new Ball({name,color,x,z,radius:POOL_BALL_RADIUS,mass:POOL_TABLE.ballMass})),{number,poolGroup:group});
}

function createEightBallBalls(world){
  world.setTable?.(POOL_TABLE);
  world.clear();
  const cue=addPoolBall(world,0,0,-POOL_TABLE.length*0.26);
  const R=POOL_BALL_RADIUS,d=R*2.035,rowZ=d*Math.sqrt(3)/2,apexZ=POOL_TABLE.length*0.205;
  // Fixed legal-looking rack: 8 in center; one solid and one stripe in the rear corners.
  const rack=[
    [1],
    [10,4],
    [3,8,12],
    [14,6,2,11],
    [7,13,15,5,9],
  ];
  for(let row=0;row<rack.length;row++){
    const z=apexZ+row*rowZ;
    for(let col=0;col<rack[row].length;col++){
      const x=(col-row/2)*d;
      addPoolBall(world,rack[row][col],x,z);
    }
  }
  return cue;
}

function createNineBallBalls(world){
  world.setTable?.(POOL_TABLE);
  world.clear();
  const cue=addPoolBall(world,0,0,-POOL_TABLE.length*0.26);
  const R=POOL_BALL_RADIUS,d=R*2.035,rowZ=d*Math.sqrt(3)/2,centerZ=POOL_TABLE.length*0.23;
  // Diamond: 1 on the apex and 9 at the center.
  const rows=[
    {nums:[1],z:centerZ-2*rowZ},
    {nums:[2,3],z:centerZ-rowZ},
    {nums:[4,9,5],z:centerZ},
    {nums:[6,7],z:centerZ+rowZ},
    {nums:[8],z:centerZ+2*rowZ},
  ];
  for(const row of rows){
    const n=row.nums.length;
    for(let i=0;i<n;i++) addPoolBall(world,row.nums[i],(i-(n-1)/2)*d,row.z);
  }
  return cue;
}

function findPoolBall(world,number){
  return world.balls.find(b=>b.number===number)||null;
}

Object.assign(exports,{POOL_BALL_RADIUS,POOL_COLORS,createEightBallBalls,createNineBallBalls,findPoolBall});

};

__modules["src/game/CueController.js"]=function(require,module,exports){
const { Vec2 } = require("src/math/Vec2.js");
const { CUE_PHYSICS } = require("src/config.js");
function cross3(a,b){ return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }

class CueController {
  constructor(world,cueBall){
    this.world=world; this.cueBall=cueBall;
    this.angle=0; this.power=0.45;
    this.spinX=0; this.spinY=0;
    this.maxCueSpeed=CUE_PHYSICS.maxCueSpeed;
  }
  setCueBall(b){ this.cueBall=b; }
  direction(angle=this.angle){ return new Vec2(Math.sin(angle),Math.cos(angle)); }
  canShoot(){ return this.cueBall && !this.cueBall.potted && this.world.allStopped(); }
  shotSpeed(power=this.power){
    const p=Math.max(0,Math.min(1,power));
    // Fine control in the first half, with progressively more acceleration in
    // the upper range.  Extreme tip offsets lose a little translational speed.
    const curve=0.075*p+0.925*Math.pow(p,2.12);
    const offset=Math.min(1,Math.hypot(this.spinX,this.spinY));
    return this.maxCueSpeed*curve*(1-CUE_PHYSICS.extremeSpinSpeedLoss*offset*offset);
  }
  effectiveShotAngle(power=this.power){
    const p=Math.max(0,Math.min(1,power));
    const squirt=(CUE_PHYSICS.maxSquirtDegrees*Math.PI/180)*this.spinX*(0.25+0.75*p*p);
    return this.angle-squirt;
  }
  strike(power=this.power){
    if(!this.canShoot()) return false;
    const b=this.cueBall,p=Math.max(0.015,Math.min(1,power));
    const shotAngle=this.effectiveShotAngle(p),d=this.direction(shotAngle);
    const speed=this.shotSpeed(p),J=b.mass*speed;
    b.velocity.x += d.x*J*b.invMass;b.velocity.y += d.y*J*b.invMass;

    // Contact point on rear hemisphere. Tip offsets create torque directly from
    // r x J; combined side/top/back therefore share the same physical strike.
    const R=b.radius,right={x:d.y,z:-d.x};
    const cap=R*CUE_PHYSICS.maxTipOffset;
    let ox=this.spinX*cap,oy=this.spinY*cap;
    const radial=Math.hypot(ox,oy);if(radial>cap){ox*=cap/radial;oy*=cap/radial;}
    const rear=Math.sqrt(Math.max(R*R-ox*ox-oy*oy,0));
    const r=[-d.x*rear+right.x*ox,oy,-d.y*rear+right.z*ox];
    const impulse=[d.x*J,0,d.y*J];const torqueImpulse=cross3(r,impulse);
    b.angularVelocity[0]+=torqueImpulse[0]*b.invInertia;
    b.angularVelocity[1]+=torqueImpulse[1]*b.invInertia;
    b.angularVelocity[2]+=torqueImpulse[2]*b.invInertia;
    b.motionState='sliding';b.wake();return true;
  }
}

Object.assign(exports,{CueController});

};

__modules["src/input/InputController.js"]=function(require,module,exports){
class InputController {
  constructor(canvas,cue,view,ui,onStrike,onPlaceCue,onMoveCue=null){
    this.canvas=canvas;this.cue=cue;this.view=view;this.ui=ui||{};this.onStrike=onStrike;this.onPlaceCue=onPlaceCue;this.onMoveCue=onMoveCue;
    this.dragging=false;this.placing=false;this.pointerId=null;this.lastX=0;this.lastY=0;this.lastPlacement=null;
    const canAim=()=>this.cue.world.allStopped()&&(this.ui.canAim?.()??true);
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
    canvas.addEventListener('pointerdown',e=>{if(this.ui.ballInHand?.()){e.preventDefault?.();this.dragging=false;this.placing=true;this.pointerId=e.pointerId;canvas.setPointerCapture?.(e.pointerId);this.#movePlacement(e);return;}if(!canAim())return;this.dragging=true;this.pointerId=e.pointerId;this.lastX=e.clientX;this.lastY=e.clientY;canvas.setPointerCapture?.(e.pointerId);this.#aimAtEvent(e,false);});
    canvas.addEventListener('pointermove',e=>{if(this.placing&&e.pointerId===this.pointerId){this.#movePlacement(e);return;}if(!this.dragging||e.pointerId!==this.pointerId||!canAim())return;if(e.shiftKey){const dx=e.clientX-this.lastX;this.cue.angle-=dx*0.00045;}else this.#aimAtEvent(e,true);this.lastX=e.clientX;this.lastY=e.clientY;});
    const end=e=>{if(this.placing&&e.pointerId===this.pointerId){e.preventDefault?.();const p=this.view.screenToWorld(e.clientX,e.clientY),r=this.onPlaceCue?.(p);if(r?.ok===false){const q=this.lastPlacement||p;this.view.setPlacementPreview?.({x:q.x,z:q.z,valid:false});}else{this.lastPlacement=null;this.view.clearPlacementPreview?.();this.ui.onPlacementCommitted?.(r);}}else if(this.dragging&&canAim())this.#aimAtEvent(e,false);this.dragging=false;this.placing=false;this.pointerId=null;this.view.fadeAimPointer?.();try{if(e?.pointerId!=null&&canvas.hasPointerCapture?.(e.pointerId))canvas.releasePointerCapture(e.pointerId);}catch(_){}};
    canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',()=>{this.dragging=false;this.placing=false;this.pointerId=null;this.view.clearPlacementPreview?.();this.view.fadeAimPointer?.();});
    window.addEventListener('keydown',e=>{const tag=document.activeElement?.tagName;if(tag==='INPUT'||tag==='SELECT'||tag==='TEXTAREA')return;if((e.key==='ArrowLeft'||e.key==='a'||e.key==='A')&&canAim()){e.preventDefault();this.cue.angle+=e.shiftKey?.0022:.010;}if((e.key==='ArrowRight'||e.key==='d'||e.key==='D')&&canAim()){e.preventDefault();this.cue.angle-=e.shiftKey?.0022:.010;}if(e.key==='Enter'||e.code==='Space'){e.preventDefault();this.onStrike?.();}});
  }
  #aimAtEvent(e,dragging){const p=this.view.screenToWorld(e.clientX,e.clientY),b=this.cue.cueBall;if(!b||b.potted)return;const dx=p.x-b.position.x,dz=p.z-b.position.y;if(Math.hypot(dx,dz)<b.radius*1.6)return;this.cue.angle=Math.atan2(dx,dz);this.view.setAimPointer?.({x:p.x,z:p.z,dragging:!!dragging});}
  #movePlacement(e){const p=this.view.screenToWorld(e.clientX,e.clientY),r=this.onMoveCue?.(p),q=r?.position||p;if(r?.ok!==false)this.lastPlacement={x:q.x,z:q.z};this.view.setPlacementPreview?.({x:q.x,z:q.z,valid:r?.ok!==false});}
}

Object.assign(exports,{InputController});

};

__modules["src/render/Renderer2D.js"]=function(require,module,exports){
const { TABLE } = require("src/config.js");
const { buildPockets, buildCushionSegments, geometryFor } = require("src/table/TableGeometry.js");
const { COLOUR_SPOTS, D_AREA } = require("src/game/SnookerSetup.js");
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function rr(c,x,y,w,h,r){r=Math.min(r,w/2,h/2);c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}
function rotateVec(q,v){const [x,y,z,w]=q||[0,0,0,1],[vx,vy,vz]=v;const tx=2*(y*vz-z*vy),ty=2*(z*vx-x*vz),tz=2*(x*vy-y*vx);return [vx+w*tx+(y*tz-z*ty),vy+w*ty+(z*tx-x*tz),vz+w*tz+(x*ty-y*tx)];}

class Renderer2D{
  constructor(canvas,world,cue){this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:false});this.world=world;this.cue=cue;this.renderScale=1;this.quality='high';this.stroke=null;this.pullback=0;this.guideMode='full';this.placementPreview=null;this.pocketBursts=[];this.lastLayout=null;this.ballOn='RED';this.ballInHand=false;this.aiThinking=false;this.aimPointer=null;this.gameMode='snooker';this.firstContactValidator=null;this.legalTargetProvider=null;this._tableCache=null;this._cachedPockets=[];this._cachedCushions=[];this._cachedGeom=null;}
  setQuality(q){this.quality=q||'high';}setRenderScale(v){this.renderScale=clamp(+v||1,.72,1);}setAimGuide(){this.guideMode='full';}setBallOn(v){this.ballOn=v||'—';}setBallInHand(v){this.ballInHand=!!v;}setAIThinking(v){this.aiThinking=!!v;}setPullback(v){this.pullback=clamp(v||0,0,1);}setPlacementPreview(p){this.placementPreview=p||null;}clearPlacementPreview(){this.placementPreview=null;}setGameMode(m){this.gameMode=m||'snooker';this._tableCache=null;}setFirstContactValidator(fn){this.firstContactValidator=typeof fn==='function'?fn:null;}setLegalTargetProvider(fn){this.legalTargetProvider=typeof fn==='function'?fn:null;}
  setAimPointer(p){this.aimPointer=p?{...p,t:performance.now(),fade:false}:null;}fadeAimPointer(){if(this.aimPointer){this.aimPointer.fade=true;this.aimPointer.t=performance.now();}}
  cameraLabel(){return 'TOP DOWN 3D';}performanceStats(){return{drawCalls:1,triangles:0,geometries:0,textures:0,pixelRatio:(devicePixelRatio||1)*this.renderScale};}
  notifyPocket(ball){if(!ball)return;this.pocketBursts.push({x:ball.position.x,z:ball.position.y,color:ball.color,t:performance.now()});if(this.pocketBursts.length>8)this.pocketBursts.shift();}
  isStrokeAnimating(){return!!this.stroke;}playCueStroke(power,onImpact){if(this.stroke)return false;this.stroke={start:performance.now(),power:clamp(power,.02,1),onImpact,hit:false};return true;}
  // Advance cue-stroke timing independently from whether the cue is currently
  // visible. A scratch can put the white into ball-in-hand before the visual
  // stroke has finished; tying stroke progression to #guideCue previously left
  // this.stroke alive forever and deadlocked shot finalization/input.
  advanceStroke(now=performance.now()){let off=0;if(this.stroke){const q=clamp((now-this.stroke.start)/300,0,1),P=this.stroke.power;if(q<.5)off=q/.5*(20+44*P);else if(q<.74)off=(1-(q-.5)/.24)*(20+44*P)-8*((q-.5)/.24);else off=-8+(q-.74)/.26*10;if(q>=.68&&!this.stroke.hit){this.stroke.hit=true;this.stroke.onImpact?.();}if(q>=1){this.stroke=null;off=0;}}else off=this.pullback*(22+52*this.pullback);return off;}
  #resize(){const W=Math.max(320,this.canvas.clientWidth||innerWidth),H=Math.max(240,this.canvas.clientHeight||innerHeight),dpr=clamp((devicePixelRatio||1)*this.renderScale,1,2);const w=Math.floor(W*dpr),h=Math.floor(H*dpr);if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}this.ctx.setTransform(dpr,0,0,dpr,0,0);return{w:W,h:H};}
  #layout(w,h){const T=this.world.table||TABLE,compact=h<650,top=compact?53:62,bottom=2,left=compact?54:62,right=compact?54:62,rail=Math.max(22,Math.min(34,h*.039));const aw=w-left-right,ah=h-top-bottom,ratio=T.length/T.width;let tw=Math.min(aw-rail*2,(ah-rail*2)*ratio),th=tw/ratio;if(th+rail*2>ah){th=ah-rail*2;tw=th*ratio;}const cx=left+aw/2,cy=top+ah/2,scale=tw/T.length,cloth={x:cx-tw/2,y:cy-th/2,w:tw,h:th},outer={x:cloth.x-rail,y:cloth.y-rail,w:cloth.w+rail*2,h:cloth.h+rail*2,r:Math.max(14,rail*.55)};return this.lastLayout={w,h,compact,top,left,right,rail,cx,cy,scale,cloth,outer};}
  worldToScreen(x,z){const L=this.lastLayout;return L?{x:L.cx+z*L.scale,y:L.cy-x*L.scale}:{x:0,y:0};}
  screenToWorld(clientX,clientY){const r=this.canvas.getBoundingClientRect(),sx=clientX-r.left,sy=clientY-r.top,L=this.lastLayout||this.#layout(r.width,r.height);return{x:(L.cy-sy)/L.scale,z:(sx-L.cx)/L.scale};}
  #screenDir(d){return{x:d.y,y:-d.x};}
  #tableGeometry(){const T=this.world.table||TABLE;if(this._tableCache!==T){this._tableCache=T;this._cachedPockets=buildPockets(T);this._cachedCushions=buildCushionSegments(T);this._cachedGeom=geometryFor(T);}return{T,pockets:this._cachedPockets,cushions:this._cachedCushions,geom:this._cachedGeom};}
  #rayFirstBall(){const cb=this.cue.cueBall;if(!cb||cb.potted)return null;const d=this.cue.direction(),px=cb.position.x,pz=cb.position.y;let best=null,tBest=Infinity;for(const b of this.world.balls){if(b===cb||b.potted)continue;const ox=px-b.position.x,oz=pz-b.position.y,R=cb.radius+b.radius,B=2*(ox*d.x+oz*d.y),C=ox*ox+oz*oz-R*R,disc=B*B-4*C;if(disc<0)continue;const q=Math.sqrt(disc),t1=(-B-q)/2,t2=(-B+q)/2,t=t1>.001?t1:t2>.001?t2:Infinity;if(t<tBest){tBest=t;best={ball:b,t};}}return best;}
  #rayFirstCushion(){const cb=this.cue.cueBall;if(!cb||cb.potted)return null;const d=this.cue.direction(),px=cb.position.x,pz=cb.position.y,R=cb.radius;let best=null,tBest=Infinity;for(const sg of this.#tableGeometry().cushions){const s0=(px-sg.ax)*sg.nx+(pz-sg.az)*sg.nz,den=d.x*sg.nx+d.y*sg.nz;if(den< -1e-9){const t=(R-s0)/den;if(t>.001&&t<tBest){const ix=px+d.x*t,iz=pz+d.y*t,u=sg.lenSq>0?((ix-sg.ax)*sg.dx+(iz-sg.az)*sg.dz)/sg.lenSq:0;if(u>=0&&u<=1){best={segment:sg,t};tBest=t;}}}for(const [ex,ez] of [[sg.ax,sg.az],[sg.bx,sg.bz]]){const ox=px-ex,oz=pz-ez,B=2*(ox*d.x+oz*d.y),C=ox*ox+oz*oz-R*R,disc=B*B-4*C;if(disc<0)continue;const q=Math.sqrt(disc),t1=(-B-q)/2,t2=(-B+q)/2,t=t1>.001?t1:t2>.001?t2:Infinity;if(t>=tBest||!Number.isFinite(t))continue;const ix=px+d.x*t,iz=pz+d.y*t,nx=(ix-ex)/R,nz=(iz-ez)/R;if(nx*sg.nx+nz*sg.nz<-.12)continue;best={segment:sg,t};tBest=t;}}return best;}
  #rayBounds(x,z,d,r){const T=this.world.table||TABLE,hx=T.width/2-r,hz=T.length/2-r;let t=Infinity;if(Math.abs(d.x)>1e-9)for(const v of [(hx-x)/d.x,(-hx-x)/d.x])if(v>0)t=Math.min(t,v);if(Math.abs(d.y)>1e-9)for(const v of [(hz-z)/d.y,(-hz-z)/d.y])if(v>0)t=Math.min(t,v);return Number.isFinite(t)?t:1;}
  #cueBackClearance(){const cb=this.cue.cueBall;if(!cb)return 1.55;const d=this.cue.direction(),bx=-d.x,bz=-d.y;let best=1.55;for(const b of this.world.balls){if(b===cb||b.potted)continue;const rx=b.position.x-cb.position.x,rz=b.position.y-cb.position.y,t=rx*bx+rz*bz;if(t<=0)continue;const perp=Math.abs(rx*bz-rz*bx),shaftClear=b.radius+.012;if(perp>=shaftClear)continue;const halfChord=Math.sqrt(Math.max(0,shaftClear*shaftClear-perp*perp));const enter=t-halfChord-.010;best=Math.min(best,Math.max(0.004,enter));}return best;}
  #background(c,w,h){const g=c.createRadialGradient(w*.5,h*.2,20,w*.5,h*.42,Math.max(w,h)*.85);g.addColorStop(0,'#173b63');g.addColorStop(.35,'#0b2344');g.addColorStop(1,'#020713');c.fillStyle=g;c.fillRect(0,0,w,h);}
  #table(c,L){
    const {outer,cloth,rail}=L,{T,geom,pockets,cushions}=this.#tableGeometry();
    c.save();
    c.shadowColor='rgba(0,0,0,.78)';c.shadowBlur=30;c.shadowOffsetY=10;
    const wood=c.createLinearGradient(outer.x,outer.y,outer.x,outer.y+outer.h);
    wood.addColorStop(0,'#6f241c');wood.addColorStop(.28,'#421411');wood.addColorStop(.65,'#1c0b0d');wood.addColorStop(1,'#0b0608');
    c.fillStyle=wood;rr(c,outer.x,outer.y,outer.w,outer.h,outer.r);c.fill();c.shadowColor='transparent';
    c.strokeStyle='#c4814d';c.lineWidth=Math.max(2,rail*.09);rr(c,outer.x+2,outer.y+2,outer.w-4,outer.h-4,outer.r-2);c.stroke();
    // Decorative inlay stays on the wooden frame; it is not used as a fake
    // collision rail, so the visible pocket gaps remain truthful.
    c.strokeStyle='rgba(101,228,236,.78)';c.lineWidth=Math.max(2,rail*.075);rr(c,cloth.x-rail*.57,cloth.y-rail*.57,cloth.w+rail*1.14,cloth.h+rail*1.14,rail*.26);c.stroke();
    c.strokeStyle='rgba(246,232,174,.76)';c.lineWidth=Math.max(1,rail*.035);rr(c,cloth.x-rail*.50,cloth.y-rail*.50,cloth.w+rail,cloth.h+rail,rail*.22);c.stroke();

    const pool=this.gameMode!=='snooker',felt=c.createLinearGradient(cloth.x,cloth.y,cloth.x+cloth.w,cloth.y+cloth.h);
    felt.addColorStop(0,pool?'#4a98a5':'#20a16f');felt.addColorStop(.5,pool?'#367f90':'#168a62');felt.addColorStop(1,pool?'#245e70':'#0f6b4e');
    c.fillStyle=felt;c.fillRect(cloth.x,cloth.y,cloth.w,cloth.h);
    const glow=c.createRadialGradient(L.cx,L.cy,0,L.cx,L.cy,cloth.w*.55);glow.addColorStop(0,'rgba(255,255,255,.065)');glow.addColorStop(1,'rgba(0,18,30,.20)');c.fillStyle=glow;c.fillRect(cloth.x,cloth.y,cloth.w,cloth.h);

    c.strokeStyle='rgba(238,249,246,.44)';c.lineWidth=1;
    if(this.gameMode==='snooker'){
      const s=this.worldToScreen(0,D_AREA.baulkZ);c.beginPath();c.moveTo(s.x,cloth.y);c.lineTo(s.x,cloth.y+cloth.h);c.stroke();c.beginPath();c.arc(s.x,s.y,D_AREA.radius*L.scale,Math.PI/2,Math.PI*1.5);c.stroke();
      for(const p of Object.values(COLOUR_SPOTS)){const q=this.worldToScreen(p.x,p.z);c.fillStyle='rgba(240,250,248,.33)';c.beginPath();c.arc(q.x,q.y,1.5,0,Math.PI*2);c.fill();}
    }else{
      const headZ=-T.length*.25,hs=this.worldToScreen(0,headZ),fs=this.worldToScreen(0,T.length*.25);c.beginPath();c.moveTo(hs.x,cloth.y);c.lineTo(hs.x,cloth.y+cloth.h);c.stroke();c.fillStyle='rgba(240,250,248,.48)';c.beginPath();c.arc(fs.x,fs.y,2,0,Math.PI*2);c.fill();
    }

    for(let i=1;i<=7;i++){const x=cloth.x+cloth.w*i/8;c.fillStyle='#f7e6a8';c.save();c.translate(x,cloth.y-rail*.48);c.rotate(Math.PI/4);c.fillRect(-2,-2,4,4);c.restore();c.save();c.translate(x,cloth.y+cloth.h+rail*.48);c.rotate(Math.PI/4);c.fillRect(-2,-2,4,4);c.restore();}

    // Presentation geometry is intentionally NOT the collision geometry.
    // Physics still uses the full hidden jaw segments, but exposing those
    // segments visually produced the hook-like corners seen in v4.6.  The
    // player now sees a continuous cushion profile with clean pocket cut-outs.
    const cushionTone=pool?'#176576':'#0d7556',cushionHi=pool?'rgba(145,237,241,.58)':'rgba(145,237,194,.52)';
    c.lineJoin='round';c.lineCap='round';
    for(const sg of cushions){
      if(sg.kind!=='straight')continue;
      const a=this.worldToScreen(sg.ax,sg.az),b=this.worldToScreen(sg.bx,sg.bz);
      // Dark rubber body gives the rail real depth without showing collision gizmos.
      c.strokeStyle='rgba(0,7,10,.82)';c.lineWidth=Math.max(10,rail*.37);c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();
      // Main cushion face.
      c.strokeStyle=cushionTone;c.lineWidth=Math.max(6.5,rail*.245);c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();
      // Narrow top highlight makes the cushion read as a beveled 3D edge.
      c.strokeStyle=cushionHi;c.lineWidth=Math.max(1.15,rail*.038);c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();
    }

    // Pocket mouths are rendered at the real rail openings, not at the deep
    // physics capture target.  Drawing them last masks the rounded cushion
    // ends and creates a seamless rail -> facing -> recessed-hole transition.
    const hx=T.width/2,hz=T.length/2;
    for(const p of pockets){
      const mouth=p.type==='corner'?geom.cornerMouth:geom.middleMouth;
      let vx=0,vz=0;
      if(p.type==='corner'){
        vx=p.sx*(hx+T.ballRadius*.08);vz=p.sz*(hz+T.ballRadius*.08);
      }else{
        vx=p.sx*(hx+T.ballRadius*.055);vz=0;
      }
      const s=this.worldToScreen(vx,vz),r=Math.max(10,mouth*.50*L.scale),side=p.type==='middle';
      c.save();c.translate(s.x,s.y);
      // Leather/facing surround: restrained and flush with the rail instead of
      // the old bright circular ring.
      c.shadowColor='rgba(0,0,0,.82)';c.shadowBlur=Math.max(9,r*.52);c.shadowOffsetY=Math.max(1,r*.06);
      const leather=c.createRadialGradient(-r*.30,-r*.34,1,0,0,r*1.22);
      leather.addColorStop(0,pool?'#5a2b24':'#4b2a20');leather.addColorStop(.50,'#221113');leather.addColorStop(1,'#07080b');
      c.fillStyle=leather;c.beginPath();c.ellipse(0,0,side?r*1.16:r*1.08,side?r*.82:r*1.02,0,0,Math.PI*2);c.fill();
      // Deep pocket interior.  A small off-centre highlight gives depth but no
      // exposed hardware or collision-line look.
      c.shadowColor='transparent';
      const hole=c.createRadialGradient(-r*.22,-r*.28,1,r*.08,r*.08,r*1.02);
      hole.addColorStop(0,'#111a20');hole.addColorStop(.34,'#050708');hole.addColorStop(1,'#000');
      c.fillStyle=hole;c.beginPath();c.ellipse(0,0,side?r*.94:r*.90,side?r*.63:r*.85,0,0,Math.PI*2);c.fill();
      c.strokeStyle='rgba(179,114,70,.34)';c.lineWidth=Math.max(1,r*.045);c.stroke();
      c.restore();
    }
    c.restore();
  }
  #poolBall(c,b,s,r){const stripe=b.poolGroup==='stripe',base=b.color||'#ddd';c.save();c.fillStyle='rgba(0,0,0,.34)';c.beginPath();c.ellipse(s.x+r*.22,s.y+r*.58,r*.92,r*.34,0,0,Math.PI*2);c.fill();const body=c.createRadialGradient(s.x-r*.35,s.y-r*.42,1,s.x+r*.15,s.y+r*.15,r*1.2);body.addColorStop(0,'#fff');body.addColorStop(.09,'#fff');body.addColorStop(.18,stripe?'#f8f7f0':base);body.addColorStop(.68,stripe?'#e8e6dc':base);body.addColorStop(1,stripe?'#9c9b96':'#10141b');c.fillStyle=body;c.beginPath();c.arc(s.x,s.y,r,0,Math.PI*2);c.fill();if(stripe){c.save();c.beginPath();c.arc(s.x,s.y,r*.94,0,Math.PI*2);c.clip();const ang=2*Math.atan2(b.orientation?.[2]||0,b.orientation?.[3]||1);c.translate(s.x,s.y);c.rotate(ang*.35);const band=c.createLinearGradient(0,-r*.38,0,r*.38);band.addColorStop(0,base);band.addColorStop(.5,base);band.addColorStop(1,'#111');c.fillStyle=band;c.fillRect(-r*1.1,-r*.38,r*2.2,r*.76);c.restore();}
    c.strokeStyle='rgba(0,0,0,.48)';c.lineWidth=Math.max(1,r*.07);c.beginPath();c.arc(s.x,s.y,r,0,Math.PI*2);c.stroke();
    const n=b.number||0;if(n>0){const v=rotateVec(b.orientation||[0,0,0,1],[0,1,0]);if(v[1]>-.15){const vis=clamp((v[1]+.15)/1.15,.18,1),ox=v[2]*r*.47,oy=-v[0]*r*.47;c.save();c.translate(s.x+ox,s.y+oy);c.scale(1,Math.max(.28,vis));c.fillStyle='#f9f8f2';c.beginPath();c.arc(0,0,r*.39,0,Math.PI*2);c.fill();c.strokeStyle='rgba(0,0,0,.25)';c.lineWidth=1;c.stroke();c.fillStyle='#111722';c.font=`900 ${Math.max(7,r*.48)}px Arial`;c.textAlign='center';c.textBaseline='middle';c.fillText(String(n),0,.5);c.restore();}}
    c.fillStyle='rgba(255,255,255,.92)';c.beginPath();c.ellipse(s.x-r*.34,s.y-r*.40,r*.18,r*.10,-.55,0,Math.PI*2);c.fill();c.restore();}
  #snookerBall(c,b,s,r){c.save();c.fillStyle='rgba(0,0,0,.33)';c.beginPath();c.ellipse(s.x+r*.22,s.y+r*.56,r*.92,r*.34,0,0,Math.PI*2);c.fill();const edge=b.name==='Black'?'#000':b.kind==='red'?'#730f1d':b.color,g=c.createRadialGradient(s.x-r*.36,s.y-r*.43,1,s.x+r*.1,s.y+r*.13,r*1.15);g.addColorStop(0,'#fff');g.addColorStop(.1,'#fff');g.addColorStop(.17,b.color);g.addColorStop(.67,b.color);g.addColorStop(1,edge);c.fillStyle=g;c.beginPath();c.arc(s.x,s.y,r,0,Math.PI*2);c.fill();c.strokeStyle='rgba(0,0,0,.45)';c.lineWidth=Math.max(1,r*.07);c.stroke();c.fillStyle='rgba(255,255,255,.9)';c.beginPath();c.ellipse(s.x-r*.35,s.y-r*.4,r*.19,r*.11,-.55,0,Math.PI*2);c.fill();c.restore();}
  #ball(c,b,L,alpha=1,ghost=false,sizeScale=1){const s=this.worldToScreen(b.position.x,b.position.y),r=Math.max(2,b.radius*L.scale*1.08*sizeScale);c.save();c.globalAlpha=alpha;if(ghost){c.strokeStyle='#fff';c.lineWidth=1.5;c.beginPath();c.arc(s.x,s.y,r,0,Math.PI*2);c.stroke();c.restore();return;}if(b.kind==='pool')this.#poolBall(c,b,s,r);else this.#snookerBall(c,b,s,r);c.restore();}
  #balls(c,L){for(const b of this.world.balls){if(!b.potted){this.#ball(c,b,L);if(b.kind==='cue'&&b.inHand){const s=this.worldToScreen(b.position.x,b.position.y),r=Math.max(5,b.radius*L.scale*1.08);c.save();c.strokeStyle='rgba(124,255,206,.78)';c.lineWidth=2;c.beginPath();c.arc(s.x,s.y,r*1.55,0,Math.PI*2);c.stroke();c.restore();}continue;}if(b.pocketDrop&&b.fall<.30){const t=clamp(b.fall/.30,0,1),e=1-Math.pow(1-t,3),q=Object.create(b);q.position={x:b.pocketDrop.startX+(b.pocketDrop.targetX-b.pocketDrop.startX)*e,y:b.pocketDrop.startZ+(b.pocketDrop.targetZ-b.pocketDrop.startZ)*e};this.#ball(c,q,L,1-t*.92,false,1-t*.58);}}if(this.placementPreview&&this.ballInHand){const R=this.cue.cueBall?.radius||TABLE.ballRadius,q={position:{x:this.placementPreview.x,y:this.placementPreview.z},radius:R,color:'white',kind:'cue',name:'Cue'},ok=this.placementPreview.valid!==false;if(!ok)this.#ball(c,q,L,.38);const s=this.worldToScreen(q.position.x,q.position.y);c.strokeStyle=ok?'#71ff9b':'#ff6577';c.lineWidth=2;c.beginPath();c.arc(s.x,s.y,R*L.scale*1.55,0,Math.PI*2);c.stroke();}}
  #targetAssist(c,L){
    if(this.gameMode!=='9ball'||this.ballInHand||this.aiThinking||!this.world.allStopped()||!this.legalTargetProvider)return;
    const targets=this.legalTargetProvider()||[],b=targets[0];if(!b||b.potted||b.offTable)return;
    const s=this.worldToScreen(b.position.x,b.position.y),r=Math.max(8,b.radius*L.scale*1.08),pulse=.5+.5*Math.sin(performance.now()*.0045);
    c.save();c.strokeStyle=`rgba(255,220,92,${.52+pulse*.24})`;c.lineWidth=Math.max(1.6,r*.10);c.beginPath();c.arc(s.x,s.y,r*1.42,0,Math.PI*2);c.stroke();
    c.strokeStyle='rgba(255,255,255,.72)';c.lineWidth=1;c.beginPath();c.arc(s.x,s.y,r*1.72,-.42,.42);c.stroke();c.beginPath();c.arc(s.x,s.y,r*1.72,Math.PI-.42,Math.PI+.42);c.stroke();c.restore();
  }
  #guideCue(c,L,off=0){
    const b=this.cue.cueBall;if(!b||b.potted||!this.world.allStopped()||this.ballInHand||this.aiThinking)return;
    const d=this.cue.direction(),sd=this.#screenDir(d),p=this.worldToScreen(b.position.x,b.position.y),r=b.radius*L.scale;
    const hit=this.#rayFirstBall(),cushionHit=this.#rayFirstCushion(),bound=cushionHit?.t??this.#rayBounds(b.position.x,b.position.y,d,b.radius);
    const ballFirst=!!hit&&hit.t<=bound+.0015,len=ballFirst?hit.t:bound;
    const start={x:p.x+sd.x*r*1.06,y:p.y+sd.y*r*1.06},end={x:p.x+sd.x*len*L.scale,y:p.y+sd.y*len*L.scale};
    c.save();c.lineCap='round';
    c.strokeStyle='rgba(0,12,18,.58)';c.lineWidth=4;c.beginPath();c.moveTo(start.x,start.y);c.lineTo(end.x,end.y);c.stroke();
    c.strokeStyle='rgba(250,253,255,.97)';c.lineWidth=1.65;c.beginPath();c.moveTo(start.x,start.y);c.lineTo(end.x,end.y);c.stroke();

    if(ballFirst){
      const gx=b.position.x+d.x*hit.t,gz=b.position.y+d.y*hit.t,gs=this.worldToScreen(gx,gz),ox=hit.ball.position.x,oz=hit.ball.position.y;
      let nx=ox-gx,nz=oz-gz,n=Math.hypot(nx,nz)||1;nx/=n;nz/=n;
      const legal=this.firstContactValidator?!!this.firstContactValidator(hit.ball):true;
      const os=this.worldToScreen(ox,oz),out=.30,o=this.worldToScreen(ox+nx*out,oz+nz*out);
      // Only legal first-contact balls get object-ball trajectory help.
      // Wrong-group / wrong-number contacts are marked with the foul X only.
      if(legal){c.strokeStyle='rgba(250,253,255,.90)';c.lineWidth=1.65;c.beginPath();c.moveTo(os.x,os.y);c.lineTo(o.x,o.y);c.stroke();}
      c.fillStyle=legal?'rgba(255,255,255,.035)':'rgba(255,45,64,.10)';c.beginPath();c.arc(gs.x,gs.y,r,0,Math.PI*2);c.fill();
      c.strokeStyle=legal?'rgba(250,253,255,.96)':'#ff4055';c.lineWidth=legal?1.65:2.8;c.beginPath();c.arc(gs.x,gs.y,r,0,Math.PI*2);c.stroke();
      if(!legal){
        // Clear incorrect-contact symbol at the ghost-ball collision location,
        // plus a restrained halo around the actual illegal object ball.
        c.strokeStyle='rgba(255,64,85,.88)';c.lineWidth=Math.max(1.6,r*.09);c.beginPath();c.arc(os.x,os.y,r*1.22,0,Math.PI*2);c.stroke();
        const q=Math.max(4.5,r*.42);c.strokeStyle='#ff4055';c.lineWidth=Math.max(2.2,r*.13);c.beginPath();c.moveTo(gs.x-q,gs.y-q);c.lineTo(gs.x+q,gs.y+q);c.moveTo(gs.x+q,gs.y-q);c.lineTo(gs.x-q,gs.y+q);c.stroke();
      }
    }
    c.restore();

    const tipGap=r+7+off,clearWorld=this.#cueBackClearance(),maxCueLen=L.cloth.w*.46,availablePx=Math.max(0,clearWorld*L.scale-tipGap-3),cueLen=Math.min(maxCueLen,availablePx),tipX=p.x-sd.x*tipGap,tipY=p.y-sd.y*tipGap,buttX=tipX-sd.x*cueLen,buttY=tipY-sd.y*cueLen;
    c.save();c.lineCap='round';c.strokeStyle='rgba(0,0,0,.5)';c.lineWidth=10;c.beginPath();c.moveTo(tipX+2,tipY+3);c.lineTo(buttX+2,buttY+3);c.stroke();const g=c.createLinearGradient(tipX,tipY,buttX,buttY);g.addColorStop(0,'#f4e6bb');g.addColorStop(.35,'#e7c57e');g.addColorStop(.37,'#e5ffff');g.addColorStop(.44,'#47dce6');g.addColorStop(.55,'#0a6b8f');g.addColorStop(.64,'#f2c844');g.addColorStop(.75,'#172d76');g.addColorStop(.88,'#2ab7c9');g.addColorStop(1,'#1b2358');c.strokeStyle=g;c.lineWidth=6.2;c.beginPath();c.moveTo(tipX,tipY);c.lineTo(buttX,buttY);c.stroke();c.strokeStyle='#fff1d0';c.lineWidth=6.8;c.beginPath();c.moveTo(tipX,tipY);c.lineTo(tipX-sd.x*7,tipY-sd.y*7);c.stroke();c.restore();
  }
  #aimPointer(c,now){if(!this.aimPointer)return;const age=now-this.aimPointer.t;if(this.aimPointer.fade&&age>260){this.aimPointer=null;return;}const a=this.aimPointer.fade?1-age/260:.75,s=this.worldToScreen(this.aimPointer.x,this.aimPointer.z);c.save();c.globalAlpha=a;c.strokeStyle='#fff';c.lineWidth=1;c.beginPath();c.arc(s.x,s.y,6,0,Math.PI*2);c.stroke();c.restore();}
  #bursts(c,now){this.pocketBursts=this.pocketBursts.filter(p=>now-p.t<420);for(const p of this.pocketBursts){const t=(now-p.t)/420,s=this.worldToScreen(p.x,p.z);c.save();c.globalAlpha=1-t;c.strokeStyle=p.color||'#fff';c.lineWidth=2;c.beginPath();c.arc(s.x,s.y,8+18*t,0,Math.PI*2);c.stroke();c.restore();}}
  #hints(c,L){if(this.ballInHand){c.save();c.fillStyle='rgba(6,32,30,.78)';rr(c,L.cx-42,L.cloth.y+8,84,22,11);c.fill();c.fillStyle='#eaffef';c.font='900 8px Arial';c.textAlign='center';c.fillText('BALL IN HAND',L.cx,L.cloth.y+22);c.restore();}}
  render(){const {w,h}=this.#resize(),c=this.ctx,L=this.#layout(w,h),now=performance.now(),strokeOffset=this.advanceStroke(now);c.clearRect(0,0,w,h);this.#background(c,w,h);this.#table(c,L);this.#guideCue(c,L,strokeOffset);this.#balls(c,L);this.#targetAssist(c,L);this.#aimPointer(c,now);this.#bursts(c,now);this.#hints(c,L);}
}

Object.assign(exports,{Renderer2D});

};

__modules["src/audio/AudioEngine.js"]=function(require,module,exports){
class AudioEngine {
  constructor(){
    this.ctx=null; this.master=null; this.enabled=true; this.volume=0.78; this.unlocked=false;
    this.lastRoll=0; this.lastCollision=0; this.lastCushion=0;
  }
  unlock(){
    if(!this.enabled) return;
    try{
      if(!this.ctx){
        const AC=window.AudioContext||window.webkitAudioContext;
        if(!AC) return;
        this.ctx=new AC();
        this.master=this.ctx.createGain();
        this.master.gain.value=this.volume;
        this.master.connect(this.ctx.destination);
      }
      if(this.ctx.state==='suspended') this.ctx.resume();
      this.unlocked=true;
    }catch(_){ /* audio is an enhancement, never block play */ }
  }
  setVolume(v){ this.volume=Math.max(0,Math.min(1,v)); if(this.master) this.master.gain.setTargetAtTime(this.volume,this.ctx.currentTime,.02); }
  setEnabled(v){ this.enabled=!!v; if(this.master) this.master.gain.value=this.enabled?this.volume:0; }
  #tone({freq=440,duration=.07,gain=.08,type='sine',detune=0,attack=.003}={}){
    if(!this.ctx||!this.master||!this.enabled) return;
    const t=this.ctx.currentTime,o=this.ctx.createOscillator(),g=this.ctx.createGain();
    o.type=type; o.frequency.value=freq; o.detune.value=detune;
    g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(gain,t+attack); g.gain.exponentialRampToValueAtTime(.0001,t+duration);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t+duration+.02);
  }
  #noise({duration=.08,gain=.045,cutoff=2200}={}){
    if(!this.ctx||!this.master||!this.enabled) return;
    const sr=this.ctx.sampleRate, len=Math.max(1,Math.floor(sr*duration)), buf=this.ctx.createBuffer(1,len,sr),d=buf.getChannelData(0);
    for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*(1-i/len);
    const src=this.ctx.createBufferSource(),filter=this.ctx.createBiquadFilter(),g=this.ctx.createGain();
    src.buffer=buf; filter.type='lowpass'; filter.frequency.value=cutoff; g.gain.value=gain;
    src.connect(filter); filter.connect(g); g.connect(this.master); src.start();
  }
  ui(){ this.unlock(); this.#tone({freq:720,duration:.035,gain:.025,type:'sine',detune:(Math.random()-.5)*35}); }
  cueStrike(power=.5){
    this.unlock(); const p=Math.max(.05,Math.min(1,power));
    this.#tone({freq:540-120*p,duration:.045+.035*p,gain:.055+.09*p,type:'triangle',detune:(Math.random()-.5)*18});
    this.#noise({duration:.028+.025*p,gain:.018+.025*p,cutoff:3400});
  }
  ballCollision(impulse=.1){
    if(!this.ctx) return; const now=performance.now(); if(now-this.lastCollision<18) return; this.lastCollision=now;
    const k=Math.max(0,Math.min(1,impulse/.55));
    this.#tone({freq:1050-260*k,duration:.027+.035*k,gain:.025+.085*k,type:'sine',detune:(Math.random()-.5)*70});
    if(k>.46) this.#noise({duration:.022,gain:.012+.018*k,cutoff:5000});
  }
  cushion(impulse=.1){
    if(!this.ctx) return; const now=performance.now(); if(now-this.lastCushion<24) return; this.lastCushion=now;
    const k=Math.max(0,Math.min(1,impulse/.6));
    this.#tone({freq:240-55*k,duration:.055+.035*k,gain:.018+.07*k,type:'triangle',detune:(Math.random()-.5)*40});
    this.#noise({duration:.035+.025*k,gain:.012+.028*k,cutoff:1300});
  }
  pocket(ball){
    this.unlock(); const low=ball?.name==='Cue'?126:150;
    this.#tone({freq:low,duration:.18,gain:.09,type:'sine'});
    this.#tone({freq:low*1.48,duration:.11,gain:.04,type:'triangle',detune:(Math.random()-.5)*30});
    this.#noise({duration:.12,gain:.055,cutoff:900});
  }
  foul(){ this.unlock(); this.#tone({freq:250,duration:.18,gain:.07,type:'sawtooth'}); setTimeout(()=>this.#tone({freq:190,duration:.24,gain:.06,type:'triangle'}),90); }
  score(value=1){ this.unlock(); this.#tone({freq:520+value*34,duration:.12,gain:.055,type:'sine'}); }
  frameWin(){ this.unlock(); [392,494,587,784].forEach((f,i)=>setTimeout(()=>this.#tone({freq:f,duration:.24,gain:.055,type:'sine'}),i*90)); }
  updateRolling(world){
    if(!this.ctx||!this.enabled) return; const now=performance.now(); if(now-this.lastRoll<105) return; this.lastRoll=now;
    let max=0; for(const b of world.balls) if(!b.potted) max=Math.max(max,b.speed());
    if(max>.08){ const k=Math.min(1,max/3.5); this.#noise({duration:.075,gain:.002+.009*k,cutoff:340+620*k}); }
  }
}

Object.assign(exports,{AudioEngine});

};

__modules["src/gameplay/MatchController.js"]=function(require,module,exports){
const { COLOUR_ORDER, isRed, isColour, valueOf, displayBall } = require("src/game/BallRegistry.js");
const { findBall, D_AREA } = require("src/game/SnookerSetup.js");
const { ShotTracker } = require("src/gameplay/ShotTracker.js");
const { RespotManager } = require("src/gameplay/RespotManager.js");
function uniq(arr){ return [...new Set(arr)]; }

class MatchController {
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

Object.assign(exports,{MatchController});

};

__modules["src/gameplay/ShotTracker.js"]=function(require,module,exports){
const { isCue } = require("src/game/BallRegistry.js");
class ShotTracker {
  constructor(){ this.active=false; this.reset(); }
  reset(){
    this.firstHit=null;
    this.potted=[];
    this.offTable=[];
    this.cushions=[];
    this.cuePotted=false;
    this.cueOffTable=false;
    this.context=null;
  }
  begin(context){ this.reset(); this.context={...context}; this.active=true; }
  cancel(){ this.active=false; this.reset(); }
  collision(a,b){
    if(!this.active || this.firstHit) return;
    if(isCue(a) && !isCue(b)) this.firstHit=b;
    else if(isCue(b) && !isCue(a)) this.firstHit=a;
  }
  pocket(ball){
    if(!this.active) return;
    if(isCue(ball)) this.cuePotted=true;
    else if(!this.potted.includes(ball)) this.potted.push(ball);
  }
  cushion(ball){
    if(!this.active || !ball) return;
    if(!this.cushions.includes(ball)) this.cushions.push(ball);
  }
  ballOffTable(ball){
    if(!this.active) return;
    if(isCue(ball)) this.cueOffTable=true;
    else if(!this.offTable.includes(ball)) this.offTable.push(ball);
  }
  report(){
    return {
      context:this.context ? {...this.context} : null,
      firstHit:this.firstHit,
      potted:[...this.potted],
      offTable:[...this.offTable],
      cushions:[...this.cushions],
      cuePotted:this.cuePotted,
      cueOffTable:this.cueOffTable,
    };
  }
  end(){ const r=this.report(); this.active=false; return r; }
}

Object.assign(exports,{ShotTracker});

};

__modules["src/gameplay/RespotManager.js"]=function(require,module,exports){
const { TABLE } = require("src/config.js");
const { COLOUR_ORDER } = require("src/game/BallRegistry.js");
const { COLOUR_SPOTS, D_AREA } = require("src/game/SnookerSetup.js");
class RespotManager {
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

Object.assign(exports,{RespotManager});

};

__modules["src/gameplay/PoolMatchController.js"]=function(require,module,exports){
const { ShotTracker } = require("src/gameplay/ShotTracker.js");
const { POOL_TABLE } = require("src/config.js");
const { POOL_BALL_RADIUS, findPoolBall } = require("src/game/PoolSetup.js");
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

class PoolMatchController {
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

Object.assign(exports,{PoolMatchController});

};

__modules["src/ai/AIController.js"]=function(require,module,exports){
const { PotPlanner } = require("src/ai/PotPlanner.js");
const { SafetyPlanner } = require("src/ai/SafetyPlanner.js");
const AI_DIFFICULTIES=Object.freeze({
  easy:{label:'Easy',searchCount:2,maxCutDeg:55,positionWeight:0.05,aimError:0.024,powerError:0.10,thinkMs:1150,safetyTargets:3,safetyPowerScales:[1.00],attackConfidence:0.72,safetyAwareness:0.72,poorDecision:0.18,frameBudgetMs:3.5},
  medium:{label:'Medium',searchCount:4,maxCutDeg:67,positionWeight:0.30,aimError:0.013,powerError:0.065,thinkMs:850,safetyTargets:5,safetyPowerScales:[0.94,1.06],attackConfidence:0.63,safetyAwareness:0.84,poorDecision:0.08,frameBudgetMs:4.0},
  hard:{label:'Hard',searchCount:7,maxCutDeg:77,positionWeight:0.75,aimError:0.0065,powerError:0.035,thinkMs:650,safetyTargets:7,safetyPowerScales:[0.90,1.00,1.10],attackConfidence:0.53,safetyAwareness:0.93,poorDecision:0.025,frameBudgetMs:4.5},
  expert:{label:'Expert',searchCount:10,maxCutDeg:83,positionWeight:1.00,aimError:0.0032,powerError:0.018,thinkMs:480,safetyTargets:9,safetyPowerScales:[0.88,0.96,1.04,1.12],attackConfidence:0.43,safetyAwareness:0.98,poorDecision:0.008,frameBudgetMs:5.0},
});

const controllerClamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const perfNow=()=>typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
function drain(iterator){let r=iterator.next();while(!r.done)r=iterator.next();return r.value;}

class AIController {
  constructor(world,{enabled=true,playerIndex=1,difficulty='medium',rng=Math.random,onDecision=null,executeShot=null}={}){
    this.world=world;this.enabled=enabled;this.playerIndex=playerIndex;this.difficulty=difficulty in AI_DIFFICULTIES?difficulty:'medium';
    this.rng=rng;this.onDecision=onDecision;this.executeShot=executeShot;
    this.potPlanner=new PotPlanner(world);this.safetyPlanner=new SafetyPlanner(world);
    this.pending=null;this.search=null;this.lastPlan=null;this.lastPlanMs=0;this.cooldownUntil=0;
  }
  profile(){return AI_DIFFICULTIES[this.difficulty];}
  displayName(){return `AI · ${this.profile().label.toUpperCase()}`;}
  setDifficulty(level){if(AI_DIFFICULTIES[level]){this.difficulty=level;this.pending=null;this.search=null;}}
  setEnabled(v){this.enabled=!!v;this.pending=null;this.search=null;}
  isAITurn(match){return this.enabled&&match.turn===this.playerIndex&&match.stage!=='over';}
  reset(){this.pending=null;this.search=null;this.lastPlan=null;this.lastPlanMs=0;this.cooldownUntil=0;}

  chooseDPlacement(match){
    const samples=[{x:0,depth:.70},{x:-.48,depth:.62},{x:.48,depth:.62},{x:-.72,depth:.42},{x:.72,depth:.42},{x:0,depth:.35}];
    for(const s of samples){const p=match.respotter.validDPosition(s.x,s.depth,match.cueBall());if(p.free)return s;}
    return {x:0,depth:.55};
  }

  *planSearch(match){
    const profile=this.profile();
    let plan=yield* this.potPlanner.search(match,this.difficulty,profile);
    const poor=this.rng()<profile.poorDecision;
    const risky=!!plan&&plan.confidence<profile.attackConfidence&&this.rng()<profile.safetyAwareness;
    if(!plan||poor||risky)plan=(yield* this.safetyPlanner.search(match,profile))||plan;
    if(!plan)return null;
    const aimNoise=(this.rng()*2-1)*profile.aimError,powerNoise=(this.rng()*2-1)*profile.powerError;
    plan={...plan,angle:plan.angle+aimNoise,power:controllerClamp(plan.power*(1+powerNoise),0.08,0.95),rawAngle:plan.angle,rawPower:plan.power,difficulty:this.difficulty,error:{aim:aimNoise,power:powerNoise}};
    return plan;
  }

  // Synchronous API is retained for deterministic tests/tools.
  plan(match){
    const t0=perfNow();const plan=drain(this.planSearch(match));this.lastPlanMs=perfNow()-t0;
    if(plan)this.lastPlan=plan;return plan;
  }

  fallbackShot(match){
    const cue=match?.cueBall?.();
    let targets=(typeof match?.legalTargetsFor==='function'?match.legalTargetsFor(match.turn):[]).filter(b=>b&&!b.potted&&!b.offTable);
    if(!targets.length){
      const on=String(match?.state?.()?.ballOn||'').toUpperCase();
      const live=this.world.balls.filter(b=>b!==cue&&!b.potted&&!b.offTable&&!b.inHand);
      if(on==='RED')targets=live.filter(b=>b.kind==='red');
      else if(on==='COLOUR')targets=live.filter(b=>b.kind==='colour');
      else if(on)targets=live.filter(b=>String(b.name||'').toUpperCase()===on||on.includes(String(b.name||'').toUpperCase()));
    }
    if(!cue||!targets.length)return null;
    const live=this.world.balls.filter(b=>b!==cue&&!b.potted&&!b.offTable&&!b.inHand);
    const clearPath=(target)=>{
      const dx=target.position.x-cue.position.x,dz=target.position.y-cue.position.y,L=Math.hypot(dx,dz);
      if(L<1e-6)return false;const ux=dx/L,uz=dz/L;
      for(const b of live){if(b===target)continue;const rx=b.position.x-cue.position.x,rz=b.position.y-cue.position.y,t=rx*ux+rz*uz;if(t<=0||t>=L)continue;const px=rx-ux*t,pz=rz-uz*t,rr=cue.radius+b.radius+.003;if(px*px+pz*pz<rr*rr)return false;}
      return true;
    };
    const ordered=[...targets].sort((a,b)=>Math.hypot(a.position.x-cue.position.x,a.position.y-cue.position.y)-Math.hypot(b.position.x-cue.position.x,b.position.y-cue.position.y));
    const target=ordered.find(clearPath)||ordered[0];
    const dx=target.position.x-cue.position.x,dz=target.position.y-cue.position.y,dist=Math.hypot(dx,dz);
    return{type:'fallback',decision:'SAFE CONTACT',target,angle:Math.atan2(dx,dz),power:controllerClamp(.26+dist/Math.max(.8,(this.world.table?.length||3.5))*.30,.26,.56),spinX:0,spinY:0,confidence:.20,difficulty:this.difficulty,error:{aim:0,power:0}};
  }

  #finishSearch(result,wallNow){
    const search=this.search;this.search=null;
    let plan=result;this.lastPlanMs=search?.computeMs||0;
    if(!plan){plan=this.fallbackShot(search?.match);if(!plan){this.onDecision?.({type:'failed',planningMs:this.lastPlanMs});this.cooldownUntil=wallNow+450;return;}this.onDecision?.({type:'fallback',plan,planningMs:this.lastPlanMs});}
    this.lastPlan=plan;
    this.onDecision?.({type:'plan',plan,planningMs:this.lastPlanMs,wallMs:search?wallNow-search.wallStart:0});
    const ok=this.executeShot?.(plan);
    this.cooldownUntil=wallNow+(ok===false?500:300);
  }

  tick(now,match){
    if(!this.isAITurn(match)){this.pending=null;this.search=null;return;}
    if((match.ballInHandD||match.ballInHandAnywhere)&&!match.shotActive&&this.world.allStopped()){
      if(match.ballInHandAnywhere&&typeof match.placeCueAnywhere==='function'){
        const cue=match.cueBall(),targets=typeof match.legalTargetsFor==='function'?match.legalTargetsFor(match.turn):[];
        const t=targets[0];const z=t?Math.max(-1.1,Math.min(.2,t.position.y-.62)):-.65;
        const placed=match.placeCueAnywhere(0,z);
        if(placed?.ok===false&&cue)match.placeCueAnywhere(cue.position.x,cue.position.y);
      }else{const p=this.chooseDPlacement(match);match.placeCueInD(p.x,p.depth);}
      this.cooldownUntil=now+260;this.pending=null;this.search=null;return;
    }
    if(now<this.cooldownUntil||match.shotActive||!this.world.allStopped())return;

    // Continue a cooperative search. Each candidate still uses the exact same
    // physics simulation, but expensive Expert analysis is spread over frames.
    if(this.search){
      const budget=this.profile().frameBudgetMs||4;
      const sliceStart=perfNow();let r={done:false,value:null};
      do{r=this.search.iterator.next();}while(!r.done&&perfNow()-sliceStart<budget);
      this.search.computeMs+=perfNow()-sliceStart;
      if(r.done)this.#finishSearch(r.value,now);
      return;
    }

    const key=typeof match.stateKey==='function'?match.stateKey():`${match.turn}:${match.stage}:${match.expected}:${match.clearanceIndex}:${match.redsRemaining()}:${match.active.score}:${match.active.break}`;
    if(!this.pending||this.pending.key!==key){
      this.pending={key,fireAt:now+this.profile().thinkMs};
      this.onDecision?.({type:'thinking',difficulty:this.difficulty});return;
    }
    if(now<this.pending.fireAt)return;
    this.pending=null;
    this.search={key,iterator:this.planSearch(match),wallStart:now,computeMs:0,match};
    this.onDecision?.({type:'searching',difficulty:this.difficulty});
  }
}

Object.assign(exports,{AI_DIFFICULTIES,AIController});

};

__modules["src/ai/PotPlanner.js"]=function(require,module,exports){
const { isRed } = require("src/game/BallRegistry.js");
const { ShotAnalyzer } = require("src/ai/ShotAnalyzer.js");
const { ShotSimulator } = require("src/ai/ShotSimulator.js");
const { PositionPlanner } = require("src/ai/PositionPlanner.js");
const potClamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function simulationIsLegal(match,shot,sim){
  if(!sim.valid||sim.cuePotted||sim.firstHit!==shot.targetName)return false;
  if(match.mode==='8ball'||match.mode==='9ball')return true;
  const potted=sim.potted.filter(n=>n!=='Cue');
  if(match.stage==='reds'&&match.expected==='red')return potted.every(name=>match.world.balls.find(b=>b.name===name)?.kind==='red');
  if((match.stage==='reds'&&match.expected==='colour')||match.stage==='finalColour')return potted.every(n=>n===shot.targetName);
  if(match.stage==='colours'||match.stage==='respottedBlack')return potted.every(n=>n===shot.targetName);
  return true;
}

function drain(iterator){let r=iterator.next();while(!r.done)r=iterator.next();return r.value;}

class PotPlanner {
  constructor(world,{simulator=new ShotSimulator()}={}){
    this.world=world;this.analyzer=new ShotAnalyzer(world);this.simulator=simulator;this.position=new PositionPlanner(world);
  }

  *search(match,level='medium',profile={}){
    const raw=this.analyzer.potCandidates(match,{maxCutDeg:profile.maxCutDeg||75});
    if(!raw.length)return null;
    const baseCount=Math.min(raw.length,profile.searchCount||5),bases=raw.slice(0,baseCount);
    let best=null,simulations=0;
    for(const base of bases){
      for(const variant of this.position.spinVariants(level,base)){
        const shot={...base,spinX:variant.spinX,spinY:variant.spinY,power:potClamp(base.power*variant.powerScale,0.16,0.90)};
        const sim=this.simulator.run(this.world,shot);simulations++;
        if(simulationIsLegal(match,shot,sim)&&sim.targetPotted){
          const redsBonus=(match.stage==='reds'&&match.expected==='red')?sim.potted.filter(n=>isRed(this.world.balls.find(b=>b.name===n))).length*2:0;
          const positionScore=this.position.score(match,shot,sim)*(profile.positionWeight??0.45);
          const laterContacts=(sim.cueContacts||[]).filter(n=>n!==shot.targetName);
          const cannonUseful=(level==='hard'||level==='expert')&&laterContacts.some(name=>{
            const b=this.world.balls.find(x=>x.name===name);
            return (match.stage==='reds'&&match.expected==='colour')?b?.kind==='red':b?.kind==='colour';
          });
          const cannonBonus=cannonUseful?(level==='expert'?8:4):0;
          const score=base.geomScore+95+(shot.target.value||1)*5+redsBonus+positionScore+cannonBonus-(sim.time||0)*0.25;
          const candidate={...shot,simulation:sim,score,decision:'POT'};
          if(!best||candidate.score>best.score)best=candidate;
        }
        // Yield after each full same-physics candidate. Browser runtime consumes
        // these cooperatively across frames; synchronous tests simply drain it.
        yield {stage:'pot',simulations,best};
      }
    }
    return best;
  }

  choose(match,level='medium',profile={}){return drain(this.search(match,level,profile));}
}

Object.assign(exports,{PotPlanner});

};

__modules["src/ai/ShotAnalyzer.js"]=function(require,module,exports){
const { TABLE } = require("src/config.js");
const { POCKETS, buildPockets } = require("src/table/TableGeometry.js");
const { COLOUR_ORDER, isRed, isColour } = require("src/game/BallRegistry.js");
const { findBall } = require("src/game/SnookerSetup.js");
const aiClamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const aiDist=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y);
const norm=(x,y)=>{const l=Math.hypot(x,y)||1;return {x:x/l,y:y/l};};
const dot=(a,b)=>a.x*b.x+a.y*b.y;

const AI_POCKETS=Object.freeze(POCKETS.map(p=>Object.freeze({name:p.name,type:p.type,x:p.x,y:p.z})));
function aiPocketsFor(world){return buildPockets(world?.table||TABLE).map(p=>({name:p.name,type:p.type,x:p.x,y:p.z}));}

function legalTargets(match){
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

function nextTargetsAfter(match,target){
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

function pointSegmentDistance(p,a,b){
  const abx=b.x-a.x, aby=b.y-a.y;
  const den=abx*abx+aby*aby;
  if(den<1e-12) return aiDist(p,a);
  const t=aiClamp(((p.x-a.x)*abx+(p.y-a.y)*aby)/den,0,1);
  const q={x:a.x+abx*t,y:a.y+aby*t};
  return aiDist(p,q);
}

function pathClear(world,a,b,{exclude=[],clearance=null}={}){
  if(clearance==null)clearance=(world?.table?.ballRadius||TABLE.ballRadius)*2.03;
  const skip=new Set(exclude.map(v=>typeof v==='object'?v.id:v));
  for(const ball of world.balls){
    if(ball.potted||ball.offTable||skip.has(ball.id)) continue;
    if(pointSegmentDistance(ball.position,a,b)<clearance) return false;
  }
  return true;
}

function angleForDirection(d){ return Math.atan2(d.x,d.y); }

class ShotAnalyzer {
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

Object.assign(exports,{AI_POCKETS,aiPocketsFor,legalTargets,nextTargetsAfter,pointSegmentDistance,pathClear,angleForDirection,ShotAnalyzer});

};

__modules["src/ai/ShotSimulator.js"]=function(require,module,exports){
const { PHYSICS } = require("src/config.js");
const { Ball } = require("src/physics/Ball.js");
const { PhysicsWorld } = require("src/physics/PhysicsWorld.js");
const { CueController } = require("src/game/CueController.js");
// Reusable same-physics simulation sandbox. Phase 4 rebuilt an entire world and
// every ball for every candidate. Phase 5 pools those objects to reduce AI GC
// spikes while keeping the exact live PhysicsWorld/CueController path.
class ShotSimulator {
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

Object.assign(exports,{ShotSimulator});

};

__modules["src/ai/PositionPlanner.js"]=function(require,module,exports){
const { TABLE } = require("src/config.js");
const { nextTargetsAfter, aiPocketsFor, pathClear } = require("src/ai/ShotAnalyzer.js");
const posClamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const posDist=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y);

class PositionPlanner {
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

Object.assign(exports,{PositionPlanner});

};

__modules["src/ai/SafetyPlanner.js"]=function(require,module,exports){
const { TABLE } = require("src/config.js");
const { ShotAnalyzer, legalTargets, pathClear } = require("src/ai/ShotAnalyzer.js");
const { ShotSimulator } = require("src/ai/ShotSimulator.js");
const safetyClamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const safetyDist=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y);
function finalSegmentDistance(p,a,b){const abx=b.x-a.x,aby=b.y-a.y,den=abx*abx+aby*aby;if(den<1e-12)return safetyDist(p,a);const t=safetyClamp(((p.x-a.x)*abx+(p.y-a.y)*aby)/den,0,1);return safetyDist(p,{x:a.x+abx*t,y:a.y+aby*t});}
function snookerCoverScore(sim,targetNames,radius){
  if(!sim?.cueFinal)return 0;let blocked=0,checked=0;
  for(const name of targetNames){
    const target=sim.finalPositions?.[name];if(!target||target.potted)continue;checked++;let isBlocked=false;
    for(const [otherName,p] of Object.entries(sim.finalPositions||{})){
      if(otherName==='Cue'||otherName===name||p.potted)continue;
      if(finalSegmentDistance(p,sim.cueFinal,target)<radius*1.95){isBlocked=true;break;}
    }
    if(isBlocked)blocked++;
  }
  return checked?(blocked/checked)*14:0;
}
function drain(iterator){let r=iterator.next();while(!r.done)r=iterator.next();return r.value;}

class SafetyPlanner {
  constructor(world,{simulator=new ShotSimulator({maxSeconds:4.2})}={}){this.world=world;this.analyzer=new ShotAnalyzer(world);this.simulator=simulator;}

  *search(match,profile={}){
    const cue=match.cueBall(),targets=legalTargets(match);if(!cue||!targets.length)return null;
    const R=cue.radius,offsets=[-1.48*R,1.48*R,0,-0.92*R,0.92*R],geometric=[];
    for(const target of targets){
      for(const offset of offsets){
        const probe=this.analyzer.directHitCandidate(target,{offset,power:0.5});if(!probe)continue;
        if(!pathClear(this.world,cue.position,probe.aim,{exclude:[cue,target],clearance:R*1.90}))continue;
        geometric.push({target,offset,probe,distance:safetyDist(cue.position,target.position)});
      }
    }
    geometric.sort((a,b)=>a.distance-b.distance||Math.abs(b.offset)-Math.abs(a.offset));
    const maxLines=Math.max(4,(profile.safetyTargets||5)*2);let best=null,simulations=0;
    for(const g of geometric.slice(0,maxLines)){
      const base=safetyClamp(0.31+g.distance*0.13,0.32,0.66),scales=profile.safetyPowerScales||[0.90,1.00,1.10];
      for(const scale of scales){
        const power=safetyClamp(base*scale,0.25,0.72),shot=this.analyzer.directHitCandidate(g.target,{offset:g.offset,power});
        const sim=this.simulator.run(this.world,shot,{maxSeconds:4.2});simulations++;
        if(sim.valid&&sim.firstHit===g.target.name&&!sim.cuePotted){
          const targetFinal=sim.finalPositions?.[g.target.name];
          if(sim.cueFinal&&targetFinal){
            const separation=safetyDist(sim.cueFinal,targetFinal);
            const baulk=Math.max(0,(-0.72-sim.cueFinal.y))*15,nearBaulkCushion=sim.cueFinal.y<-1.35?5:0;
            const T=this.world.table||TABLE,cueRail=Math.min(T.width/2-Math.abs(sim.cueFinal.x),T.length/2-Math.abs(sim.cueFinal.y));
            const cushionHide=cueRail<0.11?6:0,accidentalPot=sim.potted.includes(g.target.name)?-8:0;
            const cover=snookerCoverScore(sim,targets.map(t=>t.name),R);
            const score=separation*17+baulk+nearBaulkCushion+cushionHide+cover+accidentalPot-power*3;
            const candidate={...shot,simulation:sim,score,decision:'SAFETY',spinX:0,spinY:power<0.38?0.05:0};
            if(!best||candidate.score>best.score)best=candidate;
          }
        }
        yield {stage:'safety',simulations,best};
      }
    }
    if(best)return best;
    const fallback=geometric[0];
    if(fallback){const power=safetyClamp(0.33+fallback.distance*0.14,0.35,0.68);return {...this.analyzer.directHitCandidate(fallback.target,{offset:fallback.offset,power}),decision:'SAFETY',score:-50};}
    return null;
  }

  choose(match,profile={}){return drain(this.search(match,profile));}
}

Object.assign(exports,{SafetyPlanner});

};

__modules["src/network/OnlineClient.js"]=function(require,module,exports){
class OnlineClient {
  constructor({onStatus,onMessage,onOpen,onClose}={}){
    this.ws=null;this.roomCode='';this.seat=null;this.playerId='';this.connected=false;this.ready=false;this.onStatus=onStatus;this.onMessage=onMessage;this.onOpen=onOpen;this.onClose=onClose;
    this.pending=new Map();this.pingMs=null;this.pingTimer=null;
  }
  url(){
    const p=new URLSearchParams(location.search);const override=p.get('ws');if(override)return override;
    if(location.protocol==='http:'||location.protocol==='https:')return `${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`;
    return 'ws://localhost:10000/ws';
  }
  connect(){
    if(this.ws&&this.ws.readyState<=1)return Promise.resolve();
    this.onStatus?.('CONNECTING');
    return new Promise((resolve,reject)=>{
      const ws=new WebSocket(this.url());this.ws=ws;
      const timer=setTimeout(()=>{try{ws.close();}catch(_){}reject(new Error('Connection timeout'));},8000);
      ws.addEventListener('open',()=>{clearTimeout(timer);this.connected=true;this.onStatus?.('ONLINE');clearInterval(this.pingTimer);this.pingTimer=setInterval(()=>this.send('ping',{t:Date.now()}),20000);this.send('ping',{t:Date.now()});this.onOpen?.();resolve();});
      ws.addEventListener('message',e=>{let msg;try{msg=JSON.parse(e.data);}catch(_){return;}this.#handle(msg);});
      ws.addEventListener('close',()=>{clearTimeout(timer);clearInterval(this.pingTimer);this.pingTimer=null;this.connected=false;this.ready=false;this.onStatus?.('OFFLINE');this.onClose?.();});
      ws.addEventListener('error',()=>{this.onStatus?.('NETWORK ERROR');});
    });
  }
  #handle(msg){
    if(msg.type==='pong'){this.pingMs=Math.max(0,Date.now()-(+msg.t||Date.now()));this.onStatus?.(`LIVE ${this.pingMs}ms`);return;}
    if(msg.type==='room_joined'){this.roomCode=msg.code||'';this.seat=msg.seat;this.playerId=msg.playerId||'';}
    if(msg.type==='room_ready')this.ready=true;
    if(msg.type==='room_waiting')this.ready=false;
    this.onMessage?.(msg);
  }
  send(type,payload={}){if(!this.ws||this.ws.readyState!==WebSocket.OPEN)return false;this.ws.send(JSON.stringify({type,...payload}));return true;}
  async createRoom({mode,name}){await this.connect();this.send('create_room',{mode,name});}
  async joinRoom({code,name}){await this.connect();this.send('join_room',{code:String(code||'').trim().toUpperCase(),name});}
  leave(){this.send('leave_room');this.roomCode='';this.seat=null;this.ready=false;}
  shot({angle,power,spinX,spinY,clientShotId}){return this.send('shot',{angle,power,spinX,spinY,clientShotId});}
  placeCue({x,z,preview=false}){return this.send(preview?'place_preview':'place_cue',{x,z});}
  rematch(){return this.send('rematch');}
}

Object.assign(exports,{OnlineClient});

};

function __require(id){
  if(__cache[id]) return __cache[id].exports;
  const factory=__modules[id];
  if(!factory) throw new Error('Module not bundled: '+id);
  const module={exports:{}};
  __cache[id]=module;
  factory(__require,module,module.exports);
  return module.exports;
}
__require("src/main.js");
window.__SNOOKER_2D_BOOTED__=true;
window.__CUE_ARENA_BOOTED__=true;
})();
