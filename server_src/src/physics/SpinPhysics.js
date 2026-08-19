import { PHYSICS } from '../config.js';

const SPHERE_SLIP_FACTOR = 3.5; // 1 + mR^2/I for I = 2/5 mR^2

export function contactSlip(ball){
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
export function applyCloth(ball, dt) {
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
