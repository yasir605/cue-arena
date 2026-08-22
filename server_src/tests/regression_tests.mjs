import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GameRoom } from '../gameRoom.js';
import { geometryFor } from '../src/table/TableGeometry.js';
import { POOL_TABLE, CUE_PHYSICS } from '../src/config.js';
import { ProAimPredictor } from '../src/physics/ProAimPredictor.js';
import { PhysicsWorld } from '../src/physics/PhysicsWorld.js';
import { Ball } from '../src/physics/Ball.js';

const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');

// Power / containment / authoritative motion.
{
  const powerRoom=new GameRoom('PWR58','8ball');
  const full=powerRoom.cue.shotSpeed(1),oldFull=CUE_PHYSICS.maxCueSpeed;
  assert.ok(full>=oldFull*1.30&&full<=oldFull*1.60);
  const soft=powerRoom.cue.shotSpeed(.25),oldSoft=oldFull*(.075*.25+.925*Math.pow(.25,2.12));
  assert.ok(soft/oldSoft<1.02);
  const g=geometryFor(POOL_TABLE);assert.ok(Number.isFinite(g.jawDepth)&&g.jawDepth>POOL_TABLE.ballRadius);
  const edgeRoom=new GameRoom('EDGE8','8ball'),cb=edgeRoom.cueBall;
  cb.position.set(POOL_TABLE.width/2+.30,.34);cb.velocity.set(3.5,0);cb.potted=false;cb.offTable=false;cb.inHand=false;cb.sleeping=false;
  edgeRoom.world.step(1/120);assert.equal(cb.offTable,false);assert.equal(cb.potted,false);assert.ok(Math.abs(cb.position.x)<=POOL_TABLE.width/2);
  const room=new GameRoom('LIVE8','9ball');const a={readyState:1,send(){}},b={readyState:1,send(){}};room.addPlayer(a,'A');room.addPlayer(b,'B');
  const shot=room.simulateShot(0,{angle:.3,power:.45,spinX:.1,spinY:-.05,clientShotId:'live-8'});
  assert.equal(shot.ok,true);assert.ok(shot.motionFrames.length>2);assert.ok(shot.motionFrames.every(f=>Number.isFinite(f.tMs)&&Array.isArray(f.balls)));
}

// Pro Aim and premium renderer contracts.
{
  const main=read('../src/main.js'),bundled=read('../web/game.js'),renderer=read('../src/render/Renderer2D.js');
  assert.match(main,/ShiftLeft/);assert.match(main,/ShiftRight/);assert.match(main,/KeyH/);assert.match(main,/KeyJ/);assert.match(main,/view\.setProAimEnabled\(proAimEnabled\)/);
  assert.match(bundled,/ProAimPredictor/);assert.match(bundled,/KeyH/);assert.match(bundled,/KeyJ/);
  const room=new GameRoom('P58AA','8ball'),predictor=new ProAimPredictor();room.cue.angle=.17;room.cue.spinX=.08;room.cue.spinY=-.12;
  room.cue.power=.28;const low=predictor.predict(room.world,room.cue,{maxSeconds:8,sampleEvery:4});
  room.cue.power=.86;predictor.lastComputeAt=0;const high=predictor.predict(room.world,room.cue,{maxSeconds:8,sampleEvery:4});
  assert.ok(low?.tracks?.length&&high?.tracks?.length);
  const lowCue=low.ends.find(e=>/cue/i.test(e.key))||low.ends[0],highCue=high.ends.find(e=>/cue/i.test(e.key))||high.ends[0];
  const delta=Math.hypot((lowCue?.x||0)-(highCue?.x||0),(lowCue?.z||0)-(highCue?.z||0));
  assert.ok(delta>.01||low.pockets.length!==high.pockets.length||low.collisions.length!==high.collisions.length);
  for(const token of ['arena-carpet','felt-blue','felt-green','rail-brushed','rail-wood','Pocket mouths','Cue shadow'])assert.ok(renderer.includes(token),`missing renderer layer ${token}`);
  assert.match(renderer,/effectiveShotAngle\(this\.cue\.power\)/);assert.match(renderer,/#rayFirstBall\(d\)/);assert.match(renderer,/#rayFirstCushion\(d\)/);
}

// Mobile and animation contracts.
{
  const main=read('../src/main.js'),input=read('../src/input/InputController.js'),renderer=read('../src/render/Renderer2D.js'),html=read('../web/index.html'),css=read('../web/styles.css'),room=read('../gameRoom.js'),server=read('../server.js');
  assert.match(html,/id="mobileAimWheel"/);assert.match(main,/MOBILE_DEVICE/);assert.match(main,/mobileAimWheel/);assert.match(main,/bindPrecisionAimWheel/);assert.match(main,/WHEEL_TAP_NUDGE/);assert.match(main,/cue\.angle-=dx\*gain/);
  assert.match(input,/touching the table is NOT an aim command/);assert.match(input,/if\(isTap\)this\.#aimAtEvent/);assert.match(input,/this\.pointerType==='mouse'/);
  assert.match(css,/online-panel\.open\{display:block;overflow-y:auto/);assert.match(css,/body\.mobile-ui \.aim-wheel\{display:none!important\}/);assert.match(css,/body\.mobile-ui \.mobile-aim-wheel\{/);
  assert.match(renderer,/#staticBase\(/);assert.match(renderer,/this\.mobileOptimized\?1\.25:2/);assert.match(main,/The rAF loop owns rendering/);
  const world=new PhysicsWorld(),ball=world.addBall(new Ball({x:0,z:0}));ball.sleeping=false;ball.velocity.set(1,0);world.accumulator=1/240;world.step(1/120);
  assert.ok(Number.isFinite(ball._renderPrevX));assert.ok(world.renderAlpha()>=0&&world.renderAlpha()<=1);
  assert.match(renderer,/#visualState\(/);assert.match(renderer,/setNetworkTarget/);assert.match(renderer,/nlerpQuat/);assert.match(main,/updateRemoteAim\(dt\)/);assert.match(main,/view\.render\(now\)/);
  assert.match(room,/sampleEvery=3/);assert.match(server,/streamHz:40/);for(const token of ['scorePop','turnEnter','resultIn','versusIn','panelIn'])assert.ok(css.includes(token));
}

// Browser-native premium audio and clean-shot contracts.
{
  const audio=read('../src/audio/AudioEngine.js'),main=read('../src/main.js'),html=read('../web/index.html');
  for(const token of ['createDynamicsCompressor','cueStrike(power=.5)','ballCollision(impulse=.1)','cushion(impulse=.1)','pocket(ball)','offTable()','foul()','score(value=1)','turn()','frameWin()','updateRolling(world)'])assert.ok(audio.includes(token),`missing audio contract ${token}`);
  assert.match(html,/id="soundVolume"[^>]*max="420"[^>]*value="420"/);assert.match(audio,/this\.volume=4\.2/);assert.match(audio,/#buildBank\(\)/);assert.match(audio,/createBuffer\(/);
  assert.doesNotMatch(audio,/fetch\(|XMLHttpRequest|new Audio\(/);assert.match(audio,/latencyHint:'interactive'/);assert.match(audio,/oversample='4x'/);
  assert.match(main,/onlineLocalCueAudioId=clientShotId;audio\.cueStrike\(cue\.power\)/);assert.match(main,/if\(!localInstant\)audio\.cueStrike\(P\)/);
  assert.match(audio,/No continuous broadband rolling layer/);assert.doesNotMatch(audio,/src\.loop=true/);
  assert.match(html,/game\.js\?v=5\.8\.1-precision-aim/);assert.match(html,/styles\.css\?v=5\.8\.1-precision-aim/);
}

console.log('CUE ARENA REGRESSION TESTS: PASS');
