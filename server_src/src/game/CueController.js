import { Vec2 } from '../math/Vec2.js';
import { CUE_PHYSICS } from '../config.js';

function cross3(a,b){ return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }

export class CueController {
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
    // Keep delicate shots close to the existing calibration, then progressively
    // add the requested arcade-pool punch in the top end. At 100% this is +45%.
    const topEndBoost=1+(CUE_PHYSICS.fullPowerBoost||0)*Math.pow(p,3.2);
    const offset=Math.min(1,Math.hypot(this.spinX,this.spinY));
    return this.maxCueSpeed*curve*topEndBoost*(1-CUE_PHYSICS.extremeSpinSpeedLoss*offset*offset);
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
