import assert from 'node:assert/strict';
import { CushionSystem, cushionResponseProfile } from '../src/physics/CushionSystem.js';
import { TABLE } from '../src/config.js';
import { Ball } from '../src/physics/Ball.js';

const rad=d=>d*Math.PI/180,deg=r=>r*180/Math.PI;
function actualReboundAngle(speed,incidentDeg,sideSurface=0){
  const sys=new CushionSystem(TABLE);
  const sg=sys.segments.find(s=>s.kind==='straight'&&Math.abs(s.nz)>.9)||sys.segments.find(s=>s.kind==='straight');
  assert.ok(sg,'straight cushion segment missing');
  const b=new Ball({x:0,z:0,radius:TABLE.ballRadius,mass:TABLE.ballMass});
  const mx=(sg.ax+sg.bx)/2,mz=(sg.az+sg.bz)/2,R=b.radius,tx=-sg.nz,tz=sg.nx,a=rad(incidentDeg);
  b.position.x=mx+sg.nx*(R-.00008);b.position.y=mz+sg.nz*(R-.00008);
  b.velocity.x=-sg.nx*Math.cos(a)*speed+tx*Math.sin(a)*speed;
  b.velocity.y=-sg.nz*Math.cos(a)*speed+tz*Math.sin(a)*speed;
  b.angularVelocity[1]=sideSurface/R;b.sleeping=false;b.wake();
  assert.equal(sys.solve(b),true,'expected cushion contact');
  const vn=b.velocity.x*sg.nx+b.velocity.y*sg.nz,vt=b.velocity.x*tx+b.velocity.y*tz;
  assert.ok(vn>0,'ball must leave cushion after response');
  return deg(Math.atan2(Math.abs(vt),vn));
}

// The profile itself must be continuous/monotonic: slower shots open slightly,
// faster shots converge toward specular reflection.
let prev=Infinity;
for(const s of [.2,.35,.6,1,2,3.5,5,7,9,11]){
  const p=cushionResponseProfile(s);
  assert.ok(p.angleRatio<=prev+1e-12,`angle ratio increased at speed ${s}`);prev=p.angleRatio;
}
assert.ok(Math.abs(cushionResponseProfile(9).angleRatio-1)<1e-9,'fast cushion ratio must plateau at 1');

for(const incidence of [30,45,60]){
  const speeds=[.5,1,2,3.5,5,7,9],angles=speeds.map(s=>actualReboundAngle(s,incidence));
  for(let i=1;i<angles.length;i++)assert.ok(angles[i]<=angles[i-1]+.08,`${incidence}° rebound must not cycle with speed: ${angles.join(', ')}`);
  assert.ok(angles[0]>angles.at(-1)+1.0,`${incidence}° slow rebound should be measurably more open`);
  assert.ok(Math.abs(angles.at(-1)-incidence)<.65,`${incidence}° high-speed rebound should approach incident angle; got ${angles.at(-1)}`);
}

// Moderate side spin can alter the cushion result, but the effect must remain bounded.
for(const s of [1,3,7]){
  const plain=actualReboundAngle(s,45,0),spin=actualReboundAngle(s,45,.55);
  assert.ok(Math.abs(spin-plain)<9,`side-spin cushion deflection is excessive at ${s} m/s`);
}

// Swept face check: a very fast ball crossing the cushion plane in one call
// must still be reflected instead of tunnelling through.
{
  const sys=new CushionSystem(TABLE),sg=sys.segments.find(s=>s.kind==='straight'&&Math.abs(s.nz)>.9)||sys.segments.find(s=>s.kind==='straight');
  const b=new Ball({x:0,z:0,radius:TABLE.ballRadius,mass:TABLE.ballMass}),R=b.radius;
  const mx=(sg.ax+sg.bx)/2,mz=(sg.az+sg.bz)/2;
  const prevX=mx+sg.nx*(R+.03),prevZ=mz+sg.nz*(R+.03);
  b.position.x=mx+sg.nx*(R-.03);b.position.y=mz+sg.nz*(R-.03);
  b.velocity.x=-sg.nx*10;b.velocity.y=-sg.nz*10;b.sleeping=false;b.wake();
  assert.equal(sys.solve(b,prevX,prevZ),true,'swept high-speed cushion crossing must be caught');
  assert.ok(b.velocity.x*sg.nx+b.velocity.y*sg.nz>0,'swept collision must leave the cushion');
}

console.log('CUE ARENA v5.8 PHYSICS TESTS: PASS');
