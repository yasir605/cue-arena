import assert from 'node:assert/strict';
import { GameRoom } from '../gameRoom.js';

function fake(){return{readyState:1,sent:[],send(s){this.sent.push(JSON.parse(s));}};}

const room=new GameRoom('ABCDE','9ball');
const a=fake(),b=fake();
assert.equal(room.addPlayer(a,'Yasir'),0);
assert.equal(room.addPlayer(b,'Friend'),1);
assert.equal(room.ready(),true);
assert.equal(room.match.players[0].name,'Yasir');
assert.equal(room.match.players[1].name,'Friend');
assert.equal(room.snapshot().balls.length,10,'9-ball snapshot should contain cue + 1..9');
assert.equal(room.simulateShot(1,{angle:0,power:.3,spinX:0,spinY:0}).ok,false,'wrong seat cannot shoot');
const r=room.simulateShot(0,{angle:0,power:.18,spinX:.1,spinY:0,clientShotId:'t1'});
assert.equal(r.ok,true,'current player shot must be accepted');
assert.ok(r.durationMs>=450 && r.durationMs<=9000,'shot duration should be bounded');
assert.equal(r.final.mode,'9ball');
assert.equal(r.final.balls.length,10);
assert.ok(Number.isInteger(r.final.match.turn));

const pool=new GameRoom('FGHJK','8ball');const p0=fake(),p1=fake();pool.addPlayer(p0,'A');pool.addPlayer(p1,'B');
pool.match.ballInHandAnywhere=true;pool.match.ensureCueBallInHandVisible();
const place=pool.placeCue(0,0,-.35);assert.equal(place.ok,true,'server must validate and commit pool ball-in-hand');assert.equal(pool.match.ballInHandAnywhere,false);

const snooker=new GameRoom('LMNPQ','snooker');const s0=fake(),s1=fake();snooker.addPlayer(s0,'A');snooker.addPlayer(s1,'B');
snooker.match.ballInHandD=true;snooker.match.forceCueBallRecovery();
const cue=snooker.match.cueBall();const sp=snooker.placeCue(0,cue.position.x,cue.position.y);assert.equal(sp.ok,true,'server must accept a legal D placement');

console.log('ONLINE SERVER TESTS: PASS');
