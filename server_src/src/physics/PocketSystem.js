import { PHYSICS, TABLE } from '../config.js';
import { buildPockets, geometryFor, pocketEntered, pocketShelfInfo } from '../table/TableGeometry.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

export class PocketSystem{
  constructor(table=TABLE){this.setTable(table);}
  setTable(table){this.table=table||TABLE;this.geometry=geometryFor(this.table);this.pockets=buildPockets(this.table);}

  #shelfAssist(ball,dt){
    const p=pocketShelfInfo(ball,this.table,this.geometry);if(!p)return null;
    // Only assist once the centre has actually crossed the mouth line. Before
    // that, cushion/jaw geometry remains fully responsible for acceptance or rejection.
    if(p.depth<=0)return p;
    const outward=ball.velocity.x*p.dirX+ball.velocity.y*p.dirZ;
    if(outward<-0.08)return p; // ball is genuinely escaping the shelf; do not magnetise it back.

    // Tangential motion loses energy on the shelf/liner while a weak downward
    // bias carries a legitimately-entered ball toward the drop. This produces a
    // smooth 8-Ball-Pool-like pocket finish without teleporting near misses.
    const tx=-p.dirZ,tz=p.dirX;
    const tangent=ball.velocity.x*tx+ball.velocity.y*tz;
    const damp=1-Math.exp(-PHYSICS.pocketShelfDamping*dt);
    ball.velocity.x-=tx*tangent*damp;
    ball.velocity.y-=tz*tangent*damp;

    const depth01=clamp(p.depth/Math.max(p.shelf,.001),0,1.25);
    const pull=PHYSICS.pocketShelfPull*(0.30+0.70*depth01);
    ball.velocity.x+=p.dirX*pull*dt;
    ball.velocity.y+=p.dirZ*pull*dt;

    const lateralNorm=clamp(p.lateral/Math.max(p.captureHalf,.001),-1.5,1.5);
    ball.velocity.x+=tx*(-lateralNorm*PHYSICS.pocketLateralPull)*dt;
    ball.velocity.y+=tz*(-lateralNorm*PHYSICS.pocketLateralPull)*dt;
    ball.motionState='sliding';ball.wake();
    return p;
  }

  update(ball,dt){
    if(ball.potted){ball.fall+=dt;return true;}
    const shelf=this.#shelfAssist(ball,dt);
    if(pocketEntered(ball,this.table,this.geometry)){
      const p=shelf||pocketShelfInfo(ball,this.table,this.geometry);
      ball.potted=true;ball.velocity.set(0,0);ball.angularVelocity[0]=ball.angularVelocity[1]=ball.angularVelocity[2]=0;ball.sleeping=true;ball.fall=0;
      if(p)ball.pocketDrop={startX:ball.position.x,startZ:ball.position.y,targetX:p.targetX,targetZ:p.targetZ,type:p.type};
      return true;
    }
    return false;
  }
}
