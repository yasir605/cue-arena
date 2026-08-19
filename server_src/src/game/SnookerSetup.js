import { Ball } from '../physics/Ball.js';
import { TABLE } from '../config.js';
import { BALL_VALUES } from './BallRegistry.js';

// Phase 1 proportions are intentionally retained so Phase 2 changes gameplay,
// not the already-tested physics/table calibration. These are the canonical
// spots used by the rules/respot system in this build.
export const COLOUR_SPOTS = Object.freeze({
  Yellow: Object.freeze({x:-0.292,z:-1.355}),
  Green:  Object.freeze({x: 0.292,z:-1.355}),
  Brown:  Object.freeze({x: 0.000,z:-1.355}),
  Blue:   Object.freeze({x: 0.000,z: 0.000}),
  Pink:   Object.freeze({x: 0.000,z: 0.890}),
  Black:  Object.freeze({x: 0.000,z: 1.490}),
});

export const D_AREA = Object.freeze({ centerX:0, baulkZ:-1.355, radius:0.292 });

function decorate(ball,{kind,value,spotName=null}){
  ball.kind=kind;
  ball.value=value;
  ball.spotName=spotName;
  ball.offTable=false;
  return ball;
}

export function createStandardBalls(world){
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

export function findBall(world,name){
  return world.balls.find(b=>b.name===name) || null;
}
