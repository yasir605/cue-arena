import { Ball } from '../physics/Ball.js';
import { POOL_TABLE } from '../config.js';

export const POOL_BALL_RADIUS = POOL_TABLE.ballRadius; // 2.25 in regulation pool ball

export const POOL_COLORS = Object.freeze({
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

export function createEightBallBalls(world){
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

export function createNineBallBalls(world){
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

export function findPoolBall(world,number){
  return world.balls.find(b=>b.number===number)||null;
}
