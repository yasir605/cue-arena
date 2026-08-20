import { PHYSICS, TABLE } from '../config.js';
import { applyCloth, contactSlip } from './SpinPhysics.js';
import { solveBallBall } from './CollisionSolver.js';
import { CushionSystem } from './CushionSystem.js';
import { PocketSystem } from './PocketSystem.js';

export class PhysicsWorld {
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
        // Normal cue-sport play in this top-down model has no airborne balls.
        // Crossing the outer pocket envelope is therefore a numerical escape,
        // not a legitimate off-table foul. Recover it instead of awarding a foul.
        if(this.cushions.forceContain?.(b))continue;
        b.offTable=false;
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
