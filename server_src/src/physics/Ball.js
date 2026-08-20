import { Vec2 } from '../math/Vec2.js';
import { integrateQuat } from '../math/Quat.js';

let NEXT_ID=1;
export class Ball {
  constructor({x=0,z=0,radius=0.02625,mass=0.142,color='red',name='ball'}={}){
    this.id=NEXT_ID++;this.name=name;this.color=color;this.radius=radius;this.mass=mass;this.invMass=1/mass;
    this.inertia=0.4*mass*radius*radius;this.invInertia=1/this.inertia;
    this.position=new Vec2(x,z);this.velocity=new Vec2();this.angularVelocity=[0,0,0];this.orientation=[0,0,0,1];
    this.potted=false;this.offTable=false;this.inHand=false;this.fall=0;this.sleeping=true;this.sleepTimer=0;this.lastCollision=0;
    this.kind=null;this.value=0;this.spotName=null;this.offTable=false;
    this.motionState='rest';this.slipSpeed=0;
    // Presentation interpolation state. Physics remains authoritative at the
    // fixed timestep; the renderer blends from this previous solved state to
    // the current one so 60/90/120/144 Hz displays do not show duplicate steps.
    this._renderPrevX=x;this._renderPrevZ=z;this._renderPrevFall=0;this._renderPrevQ=[0,0,0,1];
  }
  wake(){this.sleeping=false;this.sleepTimer=0;if(this.motionState==='rest')this.motionState='rolling';}
  speedSq(){return this.velocity.x*this.velocity.x+this.velocity.y*this.velocity.y;}
  speed(){return Math.sqrt(this.speedSq());}
  angularSpeedSq(){const w=this.angularVelocity;return w[0]*w[0]+w[1]*w[1]+w[2]*w[2];}
  angularSpeed(){return Math.sqrt(this.angularSpeedSq());}
  integrateOrientation(dt){integrateQuat(this.orientation,this.angularVelocity,dt);}
}
