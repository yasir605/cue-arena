import { PHYSICS, TABLE } from '../config.js';
import { buildCushionSegments, geometryFor, pocketEntered, pocketLaneAtSide, pocketShelfInfo } from '../table/TableGeometry.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export class CushionSystem{
  constructor(table=TABLE){this.setTable(table);}
  setTable(table){this.table=table||TABLE;this.geometry=geometryFor(this.table);this.segments=buildCushionSegments(this.table);}

  #bounce(ball,nx,nz){
    const R=ball.radius,vn=ball.velocity.x*nx+ball.velocity.y*nz;
    if(vn>=0)return false;
    const tx=-nz,tz=nx,vt=ball.velocity.x*tx+ball.velocity.y*tz;
    const contactT=vt+ball.angularVelocity[1]*R,speedIn=-vn;
    const blend=clamp((speedIn-.4)/2.6,0,1);
    const e=PHYSICS.cushionRestitution+(PHYSICS.cushionRestitutionFast-PHYSICS.cushionRestitution)*blend;
    const jn=-(1+e)*vn*ball.mass;
    ball.velocity.x+=nx*jn*ball.invMass;ball.velocity.y+=nz*jn*ball.invMass;
    const denomT=ball.invMass+R*R*ball.invInertia;
    let jt=-contactT/denomT,maxJt=PHYSICS.cushionFriction*Math.abs(jn);
    jt=clamp(jt,-maxJt,maxJt);
    ball.velocity.x+=tx*jt*ball.invMass;ball.velocity.y+=tz*jt*ball.invMass;
    ball.angularVelocity[1]+=R*jt*ball.invInertia;
    ball.lastCollision=Math.abs(jn);ball.motionState='sliding';ball.wake();
    return true;
  }

  #solveSegments(ball){
    let hit=false;const R=ball.radius,R2=R*R;
    for(const sg of this.segments){
      const apx=ball.position.x-sg.ax,apz=ball.position.y-sg.az;
      const u=clamp(sg.lenSq>0?(apx*sg.dx+apz*sg.dz)/sg.lenSq:0,0,1);
      const qx=sg.ax+sg.dx*u,qz=sg.az+sg.dz*u;
      let dx=ball.position.x-qx,dz=ball.position.y-qz,dsq=dx*dx+dz*dz;
      if(dsq>=R2)continue;
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

  solve(ball){
    if(ball.potted)return false;
    const hitSegments=this.#solveSegments(ball);
    const hitGuard=this.#boundaryFailsafe(ball);
    return hitSegments||hitGuard;
  }
}
