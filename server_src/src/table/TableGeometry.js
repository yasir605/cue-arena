import { TABLE } from '../config.js';

const SQRT2=Math.SQRT2,DEG=Math.PI/180;
const isPoolTable=t=>Math.abs((t?.length||0)-2.54)<.02 && Math.abs((t?.width||0)-1.27)<.02;

export function geometryFor(table=TABLE){
  const R=table.ballRadius,pool=isPoolTable(table);
  const cornerMouth=Math.max(table.cornerPocketOpening,R*3.0);
  const middleMouth=Math.max(table.middlePocketOpening,R*3.1);
  // Corner mouth is measured from pointed lip to pointed lip. With symmetric
  // lips on perpendicular rails the rail inset is mouth / sqrt(2).
  const cornerLipInset=cornerMouth/SQRT2;
  const middleHalf=middleMouth/2;
  const cornerAngle=(table.cornerPocketCutAngle??(pool?38:33))*DEG;
  const middleAngle=(table.middlePocketCutAngle??(pool?76:68))*DEG;
  const cornerShelf=Math.max(table.cornerPocketShelf??R*1.15,R*.72);
  const middleShelf=Math.max(table.middlePocketShelf??R*.35,R*.18);
  const cornerJawLength=Math.max(R*1.72,cornerLipInset*.62);
  const middleJawLength=Math.max(R*1.55,middleHalf*.70);
  // v5.1: explicit physical depth of the pocket/jaw envelope. Earlier builds
  // referenced geometry.jawDepth without ever defining it, disabling the
  // extreme-escape guard and allowing grounded balls to leave the table.
  const jawDepth=Math.max(R*2.75,cornerJawLength*.92,middleJawLength*.92,cornerShelf+R*1.15);
  return Object.freeze({
    pool,
    cornerMouth,middleMouth,middleHalf,cornerLipInset,
    cornerAngle,middleAngle,cornerShelf,middleShelf,jawDepth,
    // Facing lengths stop before opposite jaws cross. The pocket liner takes
    // over behind them, just as it does on a real table.
    cornerJawLength,
    middleJawLength,
    guardMargin:Math.max(0.0014,R*.05),
    captureMargin:Math.max(.0010,R*.035),
  });
}

function makeSegment(ax,az,bx,bz,kind='cushion'){
  const dx=bx-ax,dz=bz-az,len=Math.hypot(dx,dz)||1;
  let nx=-dz/len,nz=dx/len,mx=(ax+bx)/2,mz=(az+bz)/2;
  if(nx*(-mx)+nz*(-mz)<0){nx=-nx;nz=-nz;}
  return Object.freeze({ax,az,bx,bz,dx,dz,lenSq:dx*dx+dz*dz,len,nx,nz,kind});
}

export function buildCushionSegments(table=TABLE){
  const hx=table.width/2,hz=table.length/2,g=geometryFor(table),a=g.cornerLipInset,m=g.middleHalf,s=[];
  s.push(
    makeSegment(-hx,-hz+a,-hx,-m,'straight'),makeSegment(-hx,m,-hx,hz-a,'straight'),
    makeSegment(hx,-hz+a,hx,-m,'straight'),makeSegment(hx,m,hx,hz-a,'straight'),
    makeSegment(-hx+a,-hz,hx-a,-hz,'straight'),makeSegment(-hx+a,hz,hx-a,hz,'straight')
  );

  // Side-pocket facings. Their directions use the WPA-style cut angle for
  // pool and a slightly rounder profile for snooker.
  const sm=Math.sin(g.middleAngle),cm=Math.cos(g.middleAngle),Lm=g.middleJawLength;
  for(const sx of [-1,1]){
    s.push(
      makeSegment(sx*hx,-m,sx*hx+sx*sm*Lm,-m+cm*Lm,'middleJaw'),
      makeSegment(sx*hx,m,sx*hx+sx*sm*Lm,m-cm*Lm,'middleJaw')
    );
  }

  // Corner-pocket facings. The two lips are separated by the requested mouth
  // width; each facing then turns outward by the configured cut angle.
  const cc=Math.cos(g.cornerAngle),sc=Math.sin(g.cornerAngle),Lc=g.cornerJawLength;
  for(const sx of [-1,1])for(const sz of [-1,1]){
    const hLip={x:sx*(hx-a),z:sz*hz};
    const vLip={x:sx*hx,z:sz*(hz-a)};
    s.push(
      makeSegment(hLip.x,hLip.z,hLip.x+sx*cc*Lc,hLip.z+sz*sc*Lc,'cornerJaw'),
      makeSegment(vLip.x,vLip.z,vLip.x+sx*sc*Lc,vLip.z+sz*cc*Lc,'cornerJaw')
    );
  }
  return Object.freeze(s);
}

export function buildPockets(table=TABLE){
  const hx=table.width/2,hz=table.length/2,g=geometryFor(table),a=g.cornerLipInset;
  // Corner target centres continue the ray through the actual mouth midpoint.
  // This keeps the visual pocket and clean-pot aiming axis aligned even though
  // the table is rectangular rather than square.
  const corner=(sx,sz,name)=>{const mx=sx*(hx-a/2),mz=sz*(hz-a/2),n=Math.hypot(mx,mz)||1,ext=g.cornerShelf+table.ballRadius*.85;return Object.freeze({name,type:'corner',sx,sz,x:mx+mx/n*ext,z:mz+mz/n*ext});};
  const mo=g.middleShelf+table.ballRadius*.95;
  return Object.freeze([
    corner(-1,-1,'Baulk left'),corner(1,-1,'Baulk right'),
    Object.freeze({name:'Middle left',type:'middle',sx:-1,sz:0,x:-hx-mo,z:0}),
    Object.freeze({name:'Middle right',type:'middle',sx:1,sz:0,x:hx+mo,z:0}),
    corner(-1,1,'Black left'),corner(1,1,'Black right')
  ]);
}

// Returns the pocket shelf coordinates for a ball centre. Depth is zero at the
// mouth line and positive into the pocket. Lateral is measured along the mouth.
export function pocketShelfInfo(ball,table=TABLE,geom=geometryFor(table)){
  const x=ball.position.x,z=ball.position.y,R=ball.radius,hx=table.width/2,hz=table.length/2;
  let best=null;
  for(const sx of [-1,1]){
    const depth=sx*x-hx,lateral=z;
    const half=geom.middleHalf;
    const captureHalf=Math.max(R*.62,half-R*(geom.pool?.40:.30));
    if(depth>-R*.45 && Math.abs(lateral)<half+R*.35){
      const score=Math.max(0,-depth)+Math.abs(lateral)*.15;
      if(!best||score<best.score)best={type:'middle',sx,sz:0,depth,lateral,half,captureHalf,shelf:geom.middleShelf,dirX:sx,dirZ:0,targetX:sx*(hx+geom.middleShelf+R*.70),targetZ:0,score};
    }
  }
  const a=geom.cornerLipInset;
  for(const sx of [-1,1])for(const sz of [-1,1]){
    const u=sx*x-hx,v=sz*z-hz;
    // Mouth line passes through (-a,0) and (0,-a): u + v + a = 0.
    const depth=(u+v+a)/SQRT2,lateral=(u-v)/SQRT2;
    const half=geom.cornerMouth/2;
    const captureHalf=Math.max(R*.54,half-R*(geom.pool?.46:.34));
    if(depth>-R*.50 && Math.abs(lateral)<half+R*.42 && u>-a-R*.35 && v>-a-R*.35){
      const score=Math.max(0,-depth)+Math.abs(lateral)*.12;
      if(!best||score<best.score)best={type:'corner',sx,sz,depth,lateral,half,captureHalf,shelf:geom.cornerShelf,dirX:sx/SQRT2,dirZ:sz/SQRT2,targetX:sx*(hx+(geom.cornerShelf+R*.78)/SQRT2),targetZ:sz*(hz+(geom.cornerShelf+R*.78)/SQRT2),score};
    }
  }
  return best;
}

export function pocketLaneAtSide(x,z,r,table=TABLE,geom=geometryFor(table)){
  const hx=table.width/2,hz=table.length/2,ax=Math.abs(x),az=Math.abs(z);
  return {
    xOpen: az<=geom.middleHalf+r*.32 || az>=hz-geom.cornerLipInset-r*.30,
    zOpen: ax>=hx-geom.cornerLipInset-r*.30,
  };
}

export function isPocketApproach(x,z,r,table=TABLE,geom=geometryFor(table),extra=0){
  const hx=table.width/2,hz=table.length/2,ax=Math.abs(x),az=Math.abs(z);
  const side=Math.abs(z)<=geom.middleHalf+r*.42+extra && ax>=hx-r-extra;
  const corner=(ax>=hx-geom.cornerLipInset-r*.42-extra && az>=hz-geom.cornerLipInset-r*.42-extra);
  return side||corner;
}

export function pocketEntered(ball,table=TABLE,geom=geometryFor(table)){
  const p=pocketShelfInfo(ball,table,geom);if(!p)return false;
  // A ball must travel across the mouth and onto the shelf before it can drop.
  // This is what allows jaw rattles, rejections and slow hanging balls.
  return p.depth>=p.shelf && Math.abs(p.lateral)<=p.captureHalf;
}

export function nearestPocketForPoint(x,z,table=TABLE){let best=null,dist=Infinity;for(const p of buildPockets(table)){const d=Math.hypot(x-p.x,z-p.z);if(d<dist){dist=d;best=p;}}return best;}
export const POCKET_GEOMETRY=geometryFor(TABLE);
export const CUSHION_SEGMENTS=buildCushionSegments(TABLE);
export const POCKETS=buildPockets(TABLE);
