import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GameRoom } from '../gameRoom.js';
import { geometryFor } from '../src/table/TableGeometry.js';
import { POOL_TABLE, CUE_PHYSICS } from '../src/config.js';

function fake(){return{readyState:1,sent:[],send(s){this.sent.push(JSON.parse(s));}};}

// Top-end power: requested +30–60%, implemented at +45% while preserving touch shots.
const powerRoom=new GameRoom('PWR51','8ball');
const full=powerRoom.cue.shotSpeed(1),oldFull=CUE_PHYSICS.maxCueSpeed;
assert.ok(full>=oldFull*1.30 && full<=oldFull*1.60,`full power boost should be +30–60% (got ${(full/oldFull-1)*100}%)`);
const soft=powerRoom.cue.shotSpeed(.25);const oldSoft=oldFull*(.075*.25+.925*Math.pow(.25,2.12));
assert.ok(soft/oldSoft<1.02,'soft touch speed should remain almost unchanged');

// Pocket/table escape guard must have a finite physical envelope.
const g=geometryFor(POOL_TABLE);assert.ok(Number.isFinite(g.jawDepth)&&g.jawDepth>POOL_TABLE.ballRadius,'jawDepth must be defined and finite');
const edgeRoom=new GameRoom('EDGE1','8ball');const cb=edgeRoom.cueBall;
cb.position.set(POOL_TABLE.width/2+.30,.34);cb.velocity.set(3.5,0);cb.potted=false;cb.offTable=false;cb.inHand=false;cb.sleeping=false;
edgeRoom.world.step(1/120);
assert.equal(cb.offTable,false,'grounded numerical escape must not become an off-table foul');
assert.equal(cb.potted,false,'grounded numerical escape must be recovered, not deleted');
assert.ok(Math.abs(cb.position.x)<=POOL_TABLE.width/2,'escaped grounded ball should be recovered inside the table');

// Server-authoritative motion stream is generated for every accepted shot.
const room=new GameRoom('LIVE1','9ball');const a=fake(),b=fake();room.addPlayer(a,'A');room.addPlayer(b,'B');
const shot=room.simulateShot(0,{angle:.3,power:.45,spinX:.1,spinY:-.05,clientShotId:'live-1'});
assert.equal(shot.ok,true);assert.ok(Array.isArray(shot.motionFrames)&&shot.motionFrames.length>2,'accepted online shot must produce authoritative motion frames');
assert.ok(shot.motionFrames.every(f=>Number.isFinite(f.tMs)&&Array.isArray(f.balls)),'motion frame format must be valid');

// Production protocol/UI contracts for live opponent aim and match-end navigation.
const server=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
assert.match(server,/opponent_aim/);assert.match(server,/shot_frame/);
const html=fs.readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
for(const id of ['resultPanel','resultTitle','resultRematch','resultLobby','resultView'])assert.ok(html.includes(`id="${id}"`),`missing ${id}`);

console.log('ONLINE v5.1 TESTS: PASS');
