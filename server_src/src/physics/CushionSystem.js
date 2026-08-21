import { PHYSICS, TABLE } from '../config.js';
import { buildCushionSegments, geometryFor, pocketEntered, pocketLaneAtSide, pocketShelfInfo } from '../table/TableGeometry.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const smooth01=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};

// v5.8: one monotonic cushion law shared by live play, AI, server simulation
// and Pro Aim.  The key quantity is angleRatio = tan(out)/tan(in) for a
// spin-free impact.  It starts a little above 1 at slow speed and approaches
// exactly 1 at high speed, so increasing speed cannot make the rebound angle
// cycle through unrelated regimes.
export function cushionResponseProfile(impactSpeed){
  const lo=PHYSICS.cushionResponseLowSpeed??0.35,hi=Math.max(lo+.001,PHYSICS.cushionResponseHighSpeed??7);
  const speedBlend=smooth01((Math.max(0,impactSpeed)-lo)/(hi-lo));
  const restitution=lerp(PHYSICS.cushionRestitution,PHYSICS.cushionRestitutionFast,speedBlend);
  const angleRatio=lerp(PHYSICS.cushionLowSpeedAngleRatio??1.10,PHYSICS.cushionFastAngleRatio??1,speedBlend);
  // For a no-spin ball: tan(thetaOut)/tan(thetaIn) = tangentialRetention/e.
  const tangentialRetention=clamp(restitution*angleRatio,0,0.97);
  const spinTransfer=lerp(PHYSICS.cushionSpinTransferSlow??0.18,PHYSICS.cushionSpinTransferFast??0.07,speedBlend);
  return {speedBlend,restitution,angleRatio,tangentialRetention,spinTransfer};
}

export class CushionSystem{
  constructor(table=TABLE){this.setTable(table);}
  setTable(table){this.table=table||TABLE;this.geometry=geometryFor(this.table);this.segments=buildCushionSegments(this.table);}

  #bounce(ball,nx,nz){
    const R=ball.radius,vn=ball.velocity.x*nx+ball.velocity.y*nz;
    if(vn>=0)return false;
    const tx=-nz,tz=nx,vt=ball.velocity.x*tx+ball.velocity.y*tz;
    const normalIn=-vn,impactSpeed=Math.hypot(normalIn,vt),profile=cushionResponseProfile(impactSpeed);

    // Normal response: restitution rises smoothly with impact speed and then
    // plateaus.  There are no discontinuous speed bands.
    const dvN=(1+profile.restitution)*normalIn;
    ball.velocity.x+=nx*dvN;ball.velocity.y+=nz*dvN;
    const jn=ball.mass*dvN;

    // Tangential response: target a speed-dependent retention that produces a
    // slightly more open slow rebound and converges to incident==reflected at
    // high speed. Side spin is a bounded correction, strongest on slow shots
    // and progressively weaker at high-speed cushion impacts.
    const sideSurface=ball.angularVelocity[1]*R;
    const maxSpinDelta=impactSpeed*(PHYSICS.cushionSpinDeflectCap??.20);
    const spinDelta=clamp(-sideSurface*profile.spinTransfer,-maxSpinDelta,maxSpinDelta);
    const targetVt=vt*profile.tangentialRetention+spinDelta;
    const wantedDvT=targetVt-vt;
    const maxDvT=PHYSICS.cushionFriction*Math.abs(jn)*ball.invMass;
    const dvT=clamp(wantedDvT,-maxDvT,maxDvT),jt=ball.mass*dvT;
    ball.velocity.x+=tx*dvT;ball.velocity.y+=tz*dvT;
    ball.angularVelocity[1]+=R*jt*ball.invInertia;

    ball.lastCollision=Math.abs(jn);ball.motionState='sliding';ball.wake();
    return true;
  }

  #sweptFaceHit(ball,sg,prevX,prevZ){
    if(!Number.isFinite(prevX)||!Number.isFinite(prevZ))return false;
    const R=ball.radius,cx=ball.position.x,cz=ball.position.y;
    const s0=(prevX-sg.ax)*sg.nx+(prevZ-sg.az)*sg.nz;
    const s1=(cx-sg.ax)*sg.nx+(cz-sg.az)*sg.nz;
    // Centre crossed the one-sided cushion nose plane during this substep.
    if(s0<R||s1>=R-1e-7)return false;
    const den=s0-s1;if(den<=1e-12)return false;
    const f=clamp((s0-R)/den,0,1);
    const hx=prevX+(cx-prevX)*f,hz=prevZ+(cz-prevZ)*f;
    const u=sg.lenSq>0?((hx-sg.ax)*sg.dx+(hz-sg.az)*sg.dz)/sg.lenSq:0;
    if(u<-.0005||u>1.0005)return false;
    ball.position.x=hx+sg.nx*.00004;ball.position.y=hz+sg.nz*.00004;
    return this.#bounce(ball,sg.nx,sg.nz);
  }

  #solveSegments(ball,prevX=NaN,prevZ=NaN){
    let hit=false;const R=ball.radius,R2=R*R;
    for(const sg of this.segments){
      const apx=ball.position.x-sg.ax,apz=ball.position.y-sg.az;
      const u=clamp(sg.lenSq>0?(apx*sg.dx+apz*sg.dz)/sg.lenSq:0,0,1);
      const qx=sg.ax+sg.dx*u,qz=sg.az+sg.dz*u;
      let dx=ball.position.x-qx,dz=ball.position.y-qz,dsq=dx*dx+dz*dz;
      if(dsq>=R2){if(this.#sweptFaceHit(ball,sg,prevX,prevZ)){hit=true;prevX=NaN;prevZ=NaN;}continue;}
      const signed=dx*sg.nx+dz*sg.nz;
      // Cushion faces are one-sided. Balls already through the mouth are never
      // pulled back by the reverse side of a jaw.
      if(signed<-.00125)continue;
      let d=Math.sqrt(Math.max(dsq,1e-12)),nx,nz;
      if(d<1e-6){nx=sg.nx;nz=sg.nz;d=0;}
      else{
        const inv=1/d;nx=dx*inv;nz=dz*inv;
        // At a segment endpoint radial contact is desirable (rounded nose), but
        // never accept a normal that points mostly through the back of the rail.
        if(nx*sg.nx+nz*sg.nz<.08){nx=sg.nx;nz=sg.nz;}
      }
      const pen=R-d;
      ball.position.x+=nx*(pen+.00004);ball.position.y+=nz*(pen+.00004);
      if(this.#bounce(ball,nx,nz))hit=true; else hit=true;
    }
    return hit;
  }

  #boundaryFailsafe(ball){
    // Segment/jaw geometry handles normal play. This guard only catches numerical
    // escapes at joins or at very shallow high-speed contacts. It deliberately
    // opens at real pocket mouths, so it cannot block a legitimate pot.
    if(pocketEntered(ball,this.table,this.geometry))return false;
    const shelf=pocketShelfInfo(ball,this.table,this.geometry);
    if(shelf&&shelf.depth>0&&Math.abs(shelf.lateral)<shelf.half+ball.radius*.18)return false;
    const T=this.table,R=ball.radius,hx=T.width/2,hz=T.length/2;
    const lanes=pocketLaneAtSide(ball.position.x,ball.position.y,R,T,this.geometry);
    const limX=hx-R,limZ=hz-R,eps=this.geometry.guardMargin;
    let hit=false;

    if(ball.position.x>limX+eps&&!lanes.xOpen){ball.position.x=limX;hit=this.#bounce(ball,-1,0)||hit;}
    else if(ball.position.x<-limX-eps&&!lanes.xOpen){ball.position.x=-limX;hit=this.#bounce(ball,1,0)||hit;}
    if(ball.position.y>limZ+eps&&!lanes.zOpen){ball.position.y=limZ;hit=this.#bounce(ball,0,-1)||hit;}
    else if(ball.position.y<-limZ-eps&&!lanes.zOpen){ball.position.y=-limZ;hit=this.#bounce(ball,0,1)||hit;}

    // Extreme escape safeguard. A ball that somehow clears a jaw without
    // entering the defined pocket funnel is returned to the nearest legal edge
    // rather than falling into an invisible void/off-table state.
    const outerX=hx+this.geometry.jawDepth+R*1.4,outerZ=hz+this.geometry.jawDepth+R*1.4;
    if(Math.abs(ball.position.x)>outerX||Math.abs(ball.position.y)>outerZ){
      const ax=Math.abs(ball.position.x)-hx,az=Math.abs(ball.position.y)-hz;
      if(ax>=az){const sx=Math.sign(ball.position.x)||1;ball.position.x=sx*limX;hit=this.#bounce(ball,-sx,0)||true;}
      else{const sz=Math.sign(ball.position.y)||1;ball.position.y=sz*limZ;hit=this.#bounce(ball,0,-sz)||true;}
    }
    return hit;
  }

  forceContain(ball){
    // This simulator has no jump/airborne mechanic, so a grounded ball can
    // never legitimately leave the table. If numerical error gets a centre
    // beyond the pocket/jaw envelope without a valid pocket entry, recover it
    // to the nearest playable edge and reflect the escaping velocity.
    if(ball.potted||pocketEntered(ball,this.table,this.geometry))return false;
    const shelf=pocketShelfInfo(ball,this.table,this.geometry);
    if(shelf&&shelf.depth>0&&Math.abs(shelf.lateral)<shelf.captureHalf+ball.radius*.2)return false;
    const T=this.table,R=ball.radius,hx=T.width/2,hz=T.length/2,limX=hx-R,limZ=hz-R;
    const ex=Math.max(0,Math.abs(ball.position.x)-hx),ez=Math.max(0,Math.abs(ball.position.y)-hz);
    if(ex<=0&&ez<=0)return false;
    if(ex>=ez){const sx=Math.sign(ball.position.x)||1;ball.position.x=sx*limX;this.#bounce(ball,-sx,0);}
    else{const sz=Math.sign(ball.position.y)||1;ball.position.y=sz*limZ;this.#bounce(ball,0,-sz);}
    ball.offTable=false;ball.potted=false;ball.motionState='sliding';ball.wake();return true;
  }

  solve(ball,prevX=NaN,prevZ=NaN){
    if(ball.potted)return false;
    const hitSegments=this.#solveSegments(ball,prevX,prevZ);
    const hitGuard=this.#boundaryFailsafe(ball);
    return hitSegments||hitGuard;
  }
}
