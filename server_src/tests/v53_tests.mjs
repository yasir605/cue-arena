import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GameRoom } from '../gameRoom.js';
import { ProAimPredictor } from '../src/physics/ProAimPredictor.js';

const main=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
assert.match(main,/ShiftLeft/);assert.match(main,/ShiftRight/);assert.match(main,/KeyH/);assert.match(main,/KeyJ/);
assert.match(main,/view\.setProAimEnabled\(proAimEnabled\)/);
const bundled=fs.readFileSync(new URL('../web/game.js',import.meta.url),'utf8');
assert.match(bundled,/ProAimPredictor/);assert.match(bundled,/KeyH/);assert.match(bundled,/KeyJ/);

// The exact predictor must react to cue power, not reuse a stale path.
const room=new GameRoom('P53AA','8ball');
const predictor=new ProAimPredictor();
room.cue.angle=.17;room.cue.spinX=.08;room.cue.spinY=-.12;
room.cue.power=.28;const low=predictor.predict(room.world,room.cue,{maxSeconds:8,sampleEvery:4});
assert.ok(low?.tracks?.length,'low-power prediction missing');
room.cue.power=.86;predictor.lastComputeAt=0;const high=predictor.predict(room.world,room.cue,{maxSeconds:8,sampleEvery:4});
assert.ok(high?.tracks?.length,'high-power prediction missing');
const lowCue=low.ends.find(e=>e.key.includes('Cue')||e.key.includes('cue'))||low.ends[0];
const highCue=high.ends.find(e=>e.key.includes('Cue')||e.key.includes('cue'))||high.ends[0];
const delta=Math.hypot((lowCue?.x||0)-(highCue?.x||0),(lowCue?.z||0)-(highCue?.z||0));
assert.ok(delta>.01 || low.pockets.length!==high.pockets.length || low.collisions.length!==high.collisions.length,'prediction must change when cue power changes');

const renderer=fs.readFileSync(new URL('../src/render/Renderer2D.js',import.meta.url),'utf8');
for(const token of ['arena-carpet','felt-blue','felt-green','rail-brushed','rail-wood','Pocket mouths','Cue shadow'])assert.ok(renderer.includes(token),`premium renderer layer missing: ${token}`);
console.log('PREMIUM v5.3 + PRO AIM TESTS: PASS');
