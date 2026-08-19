import { PHYSICS } from '../config.js';

export function solveBallBall(a,b) {
  if (a.potted || b.potted) return false;
  const dx=b.position.x-a.position.x, dz=b.position.y-a.position.y;
  const minDist=a.radius+b.radius;
  if(Math.abs(dx)>=minDist || Math.abs(dz)>=minDist) return false;
  const distSq=dx*dx+dz*dz;
  if(distSq>=minDist*minDist) return false;

  let dist=Math.sqrt(Math.max(distSq,1e-14));
  let nx,nz;
  if(dist<1e-7){ nx=1; nz=0; dist=minDist; }
  else { const invD=1/dist; nx=dx*invD; nz=dz*invD; }
  const tx=-nz,tz=nx;

  const penetration=minDist-dist;
  const invMassSum=a.invMass+b.invMass;
  const corr=Math.max(0,penetration-PHYSICS.penetrationSlop)*PHYSICS.positionCorrection/invMassSum;
  a.position.x-=nx*corr*a.invMass; a.position.y-=nz*corr*a.invMass;
  b.position.x+=nx*corr*b.invMass; b.position.y+=nz*corr*b.invMass;

  const rvx=b.velocity.x-a.velocity.x, rvz=b.velocity.y-a.velocity.y;
  const vn=rvx*nx+rvz*nz;
  if(vn<0){
    const jn=-(1+PHYSICS.ballRestitution)*vn/invMassSum;
    const inx=nx*jn, inz=nz*jn;
    a.velocity.x-=inx*a.invMass; a.velocity.y-=inz*a.invMass;
    b.velocity.x+=inx*b.invMass; b.velocity.y+=inz*b.invMass;

    // In-plane contact friction / throw. Side spin changes tangential contact
    // speed and therefore the small cut-induced / spin-induced throw impulse.
    const raX=nx*a.radius, raZ=nz*a.radius;
    const rbX=-nx*b.radius, rbZ=-nz*b.radius;
    const vaSpinX=a.angularVelocity[1]*raZ;
    const vaSpinZ=-a.angularVelocity[1]*raX;
    const vbSpinX=b.angularVelocity[1]*rbZ;
    const vbSpinZ=-b.angularVelocity[1]*rbX;
    const vt=(b.velocity.x+vbSpinX-a.velocity.x-vaSpinX)*tx+
             (b.velocity.y+vbSpinZ-a.velocity.y-vaSpinZ)*tz;
    const denomT=invMassSum+(a.radius*a.radius)*a.invInertia+(b.radius*b.radius)*b.invInertia;
    let jt=-vt/denomT;
    const maxJt=PHYSICS.ballFriction*Math.abs(jn);
    jt=Math.max(-maxJt,Math.min(maxJt,jt));
    const itx=tx*jt, itz=tz*jt;
    a.velocity.x-=itx*a.invMass; a.velocity.y-=itz*a.invMass;
    b.velocity.x+=itx*b.invMass; b.velocity.y+=itz*b.invMass;
    a.angularVelocity[1]+=(-a.radius*jt)*a.invInertia;
    b.angularVelocity[1]+=(-b.radius*jt)*b.invInertia;

    a.lastCollision=b.lastCollision=Math.abs(jn);
    a.motionState=b.motionState='sliding';
    a.wake(); b.wake();
  }
  return true;
}
