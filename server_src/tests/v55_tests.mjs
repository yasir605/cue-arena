import fs from 'node:fs';
import assert from 'node:assert/strict';
import { PhysicsWorld } from '../src/physics/PhysicsWorld.js';
import { Ball } from '../src/physics/Ball.js';

const world=new PhysicsWorld(),ball=world.addBall(new Ball({x:0,z:0}));
ball.sleeping=false;ball.velocity.set(1,0);world.accumulator=1/240;world.step(1/120);
assert.ok(Number.isFinite(ball._renderPrevX),'fixed-step world must retain previous presentation state');
assert.ok(world.renderAlpha()>=0&&world.renderAlpha()<=1,'render interpolation alpha must be bounded');

const main=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const renderer=fs.readFileSync(new URL('../src/render/Renderer2D.js',import.meta.url),'utf8');
const room=fs.readFileSync(new URL('../gameRoom.js',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../web/styles.css',import.meta.url),'utf8');
assert.match(renderer,/#visualState\(/,'renderer must interpolate visual ball state');
assert.match(renderer,/setNetworkTarget/,'renderer must smooth network targets');
assert.match(renderer,/nlerpQuat/,'ball orientation must interpolate, not snap');
assert.match(main,/updateRemoteAim\(dt\)/,'remote cue rotation/pullback must be display-smoothed');
assert.match(main,/view\.render\(now\)/,'one rAF presentation clock should own frame pacing');
assert.match(room,/sampleEvery=3/,'authoritative stream should sample at 40 Hz');
assert.match(server,/streamHz:40/,'online protocol should advertise 40 Hz stream');
for(const token of ['scorePop','turnEnter','resultIn','versusIn','panelIn'])assert.ok(css.includes(token),`missing ${token} UI motion`);
console.log('PASS v5.5 fixed-step interpolation, network smoothing, cue smoothing, and UI motion contracts');
