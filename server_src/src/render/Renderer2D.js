import { TABLE } from '../config.js';
import { buildPockets, buildCushionSegments, geometryFor } from '../table/TableGeometry.js';
import { COLOUR_SPOTS, D_AREA } from '../game/SnookerSetup.js';
import { ProAimPredictor } from '../physics/ProAimPredictor.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function rr(c,x,y,w,h,r){r=Math.min(r,w/2,h/2);c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}
function rotateVec(q,v){const [x,y,z,w]=q||[0,0,0,1],[vx,vy,vz]=v;const tx=2*(y*vz-z*vy),ty=2*(z*vx-x*vz),tz=2*(x*vy-y*vx);return [vx+w*tx+(y*tz-z*ty),vy+w*ty+(z*tx-x*tz),vz+w*tz+(x*ty-y*tx)];}

export class Renderer2D{
  constructor(canvas,world,cue){this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:false});this.world=world;this.cue=cue;this.renderScale=1;this.quality='high';this.stroke=null;this.pullback=0;this.guideMode='full';this.placementPreview=null;this.pocketBursts=[];this.lastLayout=null;this.ballOn='RED';this.ballInHand=false;this.aiThinking=false;this.aimPointer=null;this.gameMode='snooker';this.firstContactValidator=null;this.legalTargetProvider=null;this._tableCache=null;this._cachedPockets=[];this._cachedCushions=[];this._cachedGeom=null;this.proAimEnabled=false;this.proAimAllowed=true;this.proAimPredictor=new ProAimPredictor();}
  setQuality(q){this.quality=q||'high';}setProAimEnabled(v){this.proAimEnabled=!!v;if(!this.proAimEnabled)this.proAimPredictor.clear();}setProAimAllowed(v){this.proAimAllowed=!!v;}setRenderScale(v){this.renderScale=clamp(+v||1,.72,1);}setAimGuide(){this.guideMode='full';}setBallOn(v){this.ballOn=v||'—';}setBallInHand(v){this.ballInHand=!!v;}setAIThinking(v){this.aiThinking=!!v;}setPullback(v){this.pullback=clamp(v||0,0,1);}setPlacementPreview(p){this.placementPreview=p||null;}clearPlacementPreview(){this.placementPreview=null;}setGameMode(m){this.gameMode=m||'snooker';this._tableCache=null;}setFirstContactValidator(fn){this.firstContactValidator=typeof fn==='function'?fn:null;}setLegalTargetProvider(fn){this.legalTargetProvider=typeof fn==='function'?fn:null;}
  setAimPointer(p){this.aimPointer=p?{...p,t:performance.now(),fade:false}:null;}fadeAimPointer(){if(this.aimPointer){this.aimPointer.fade=true;this.aimPointer.t=performance.now();}}
  cameraLabel(){return 'TOP DOWN 3D';}performanceStats(){return{drawCalls:1,triangles:0,geometries:0,textures:0,pixelRatio:(devicePixelRatio||1)*this.renderScale};}
  notifyPocket(ball){if(!ball)return;this.pocketBursts.push({x:ball.position.x,z:ball.position.y,color:ball.color,t:performance.now()});if(this.pocketBursts.length>8)this.pocketBursts.shift();}
  isStrokeAnimating(){return!!this.stroke;}playCueStroke(power,onImpact){if(this.stroke)return false;this.stroke={start:performance.now(),power:clamp(power,.02,1),onImpact,hit:false};return true;}
  // Advance cue-stroke timing independently from whether the cue is currently
  // visible. A scratch can put the white into ball-in-hand before the visual
  // stroke has finished; tying stroke progression to #guideCue previously left
  // this.stroke alive forever and deadlocked shot finalization/input.
  advanceStroke(now=performance.now()){let off=0;if(this.stroke){const q=clamp((now-this.stroke.start)/300,0,1),P=this.stroke.power;if(q<.5)off=q/.5*(20+44*P);else if(q<.74)off=(1-(q-.5)/.24)*(20+44*P)-8*((q-.5)/.24);else off=-8+(q-.74)/.26*10;if(q>=.68&&!this.stroke.hit){this.stroke.hit=true;this.stroke.onImpact?.();}if(q>=1){this.stroke=null;off=0;}}else off=this.pullback*(22+52*this.pullback);return off;}
  #resize(){const W=Math.max(320,this.canvas.clientWidth||innerWidth),H=Math.max(240,this.canvas.clientHeight||innerHeight),dpr=clamp((devicePixelRatio||1)*this.renderScale,1,2);const w=Math.floor(W*dpr),h=Math.floor(H*dpr);if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}this.ctx.setTransform(dpr,0,0,dpr,0,0);return{w:W,h:H};}
  #layout(w,h){const T=this.world.table||TABLE,compact=h<650,top=compact?53:62,bottom=2,left=compact?54:62,right=compact?54:62,rail=Math.max(22,Math.min(34,h*.039));const aw=w-left-right,ah=h-top-bottom,ratio=T.length/T.width;let tw=Math.min(aw-rail*2,(ah-rail*2)*ratio),th=tw/ratio;if(th+rail*2>ah){th=ah-rail*2;tw=th*ratio;}const cx=left+aw/2,cy=top+ah/2,scale=tw/T.length,cloth={x:cx-tw/2,y:cy-th/2,w:tw,h:th},outer={x:cloth.x-rail,y:cloth.y-rail,w:cloth.w+rail*2,h:cloth.h+rail*2,r:Math.max(14,rail*.55)};return this.lastLayout={w,h,compact,top,left,right,rail,cx,cy,scale,cloth,outer};}
  worldToScreen(x,z){const L=this.lastLayout;return L?{x:L.cx+z*L.scale,y:L.cy-x*L.scale}:{x:0,y:0};}
  screenToWorld(clientX,clientY){const r=this.canvas.getBoundingClientRect(),sx=clientX-r.left,sy=clientY-r.top,L=this.lastLayout||this.#layout(r.width,r.height);return{x:(L.cy-sy)/L.scale,z:(sx-L.cx)/L.scale};}
  #screenDir(d){return{x:d.y,y:-d.x};}
  #tableGeometry(){const T=this.world.table||TABLE;if(this._tableCache!==T){this._tableCache=T;this._cachedPockets=buildPockets(T);this._cachedCushions=buildCushionSegments(T);this._cachedGeom=geometryFor(T);}return{T,pockets:this._cachedPockets,cushions:this._cachedCushions,geom:this._cachedGeom};}
  #rayFirstBall(){const cb=this.cue.cueBall;if(!cb||cb.potted)return null;const d=this.cue.direction(),px=cb.position.x,pz=cb.position.y;let best=null,tBest=Infinity;for(const b of this.world.balls){if(b===cb||b.potted)continue;const ox=px-b.position.x,oz=pz-b.position.y,R=cb.radius+b.radius,B=2*(ox*d.x+oz*d.y),C=ox*ox+oz*oz-R*R,disc=B*B-4*C;if(disc<0)continue;const q=Math.sqrt(disc),t1=(-B-q)/2,t2=(-B+q)/2,t=t1>.001?t1:t2>.001?t2:Infinity;if(t<tBest){tBest=t;best={ball:b,t};}}return best;}
  #rayFirstCushion(){const cb=this.cue.cueBall;if(!cb||cb.potted)return null;const d=this.cue.direction(),px=cb.position.x,pz=cb.position.y,R=cb.radius;let best=null,tBest=Infinity;for(const sg of this.#tableGeometry().cushions){const s0=(px-sg.ax)*sg.nx+(pz-sg.az)*sg.nz,den=d.x*sg.nx+d.y*sg.nz;if(den< -1e-9){const t=(R-s0)/den;if(t>.001&&t<tBest){const ix=px+d.x*t,iz=pz+d.y*t,u=sg.lenSq>0?((ix-sg.ax)*sg.dx+(iz-sg.az)*sg.dz)/sg.lenSq:0;if(u>=0&&u<=1){best={segment:sg,t};tBest=t;}}}for(const [ex,ez] of [[sg.ax,sg.az],[sg.bx,sg.bz]]){const ox=px-ex,oz=pz-ez,B=2*(ox*d.x+oz*d.y),C=ox*ox+oz*oz-R*R,disc=B*B-4*C;if(disc<0)continue;const q=Math.sqrt(disc),t1=(-B-q)/2,t2=(-B+q)/2,t=t1>.001?t1:t2>.001?t2:Infinity;if(t>=tBest||!Number.isFinite(t))continue;const ix=px+d.x*t,iz=pz+d.y*t,nx=(ix-ex)/R,nz=(iz-ez)/R;if(nx*sg.nx+nz*sg.nz<-.12)continue;best={segment:sg,t};tBest=t;}}return best;}
  #rayBounds(x,z,d,r){const T=this.world.table||TABLE,hx=T.width/2-r,hz=T.length/2-r;let t=Infinity;if(Math.abs(d.x)>1e-9)for(const v of [(hx-x)/d.x,(-hx-x)/d.x])if(v>0)t=Math.min(t,v);if(Math.abs(d.y)>1e-9)for(const v of [(hz-z)/d.y,(-hz-z)/d.y])if(v>0)t=Math.min(t,v);return Number.isFinite(t)?t:1;}
  #cueBackClearance(){const cb=this.cue.cueBall;if(!cb)return 1.55;const d=this.cue.direction(),bx=-d.x,bz=-d.y;let best=1.55;for(const b of this.world.balls){if(b===cb||b.potted)continue;const rx=b.position.x-cb.position.x,rz=b.position.y-cb.position.y,t=rx*bx+rz*bz;if(t<=0)continue;const perp=Math.abs(rx*bz-rz*bx),shaftClear=b.radius+.012;if(perp>=shaftClear)continue;const halfChord=Math.sqrt(Math.max(0,shaftClear*shaftClear-perp*perp));const enter=t-halfChord-.010;best=Math.min(best,Math.max(0.004,enter));}return best;}
  #background(c,w,h){
    const g=c.createLinearGradient(0,0,0,h);g.addColorStop(0,'#0b4385');g.addColorStop(.30,'#082c63');g.addColorStop(.67,'#061a3d');g.addColorStop(1,'#020817');c.fillStyle=g;c.fillRect(0,0,w,h);
    const top=c.createRadialGradient(w*.50,-h*.05,0,w*.50,h*.12,Math.max(w,h)*.70);top.addColorStop(0,'rgba(69,218,255,.38)');top.addColorStop(.38,'rgba(23,126,211,.13)');top.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=top;c.fillRect(0,0,w,h);
    const l=c.createRadialGradient(w*.08,h*.52,0,w*.08,h*.52,w*.38);l.addColorStop(0,'rgba(0,255,182,.10)');l.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=l;c.fillRect(0,0,w,h);
    const r=c.createRadialGradient(w*.92,h*.48,0,w*.92,h*.48,w*.42);r.addColorStop(0,'rgba(111,64,255,.10)');r.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=r;c.fillRect(0,0,w,h);
    const v=c.createRadialGradient(w*.5,h*.5,Math.min(w,h)*.15,w*.5,h*.5,Math.max(w,h)*.72);v.addColorStop(0,'rgba(0,0,0,0)');v.addColorStop(1,'rgba(0,2,12,.62)');c.fillStyle=v;c.fillRect(0,0,w,h);
  }
  #table(c,L){
    const {outer,cloth,rail}=L,{T,geom,pockets,cushions}=this.#tableGeometry();
    c.save();
    c.shadowColor='rgba(0,0,0,.78)';c.shadowBlur=30;c.shadowOffsetY=10;
    const wood=c.createLinearGradient(outer.x,outer.y,outer.x,outer.y+outer.h);
    wood.addColorStop(0,'#315c9f');wood.addColorStop(.16,'#153b78');wood.addColorStop(.48,'#0a2453');wood.addColorStop(.76,'#071734');wood.addColorStop(1,'#020919');
    c.fillStyle=wood;rr(c,outer.x,outer.y,outer.w,outer.h,outer.r);c.fill();c.shadowColor='transparent';
    c.strokeStyle='#9bd7ff';c.lineWidth=Math.max(2,rail*.09);rr(c,outer.x+2,outer.y+2,outer.w-4,outer.h-4,outer.r-2);c.stroke();
    // Decorative inlay stays on the wooden frame; it is not used as a fake
    // collision rail, so the visible pocket gaps remain truthful.
    c.strokeStyle='rgba(41,235,255,.92)';c.lineWidth=Math.max(2,rail*.075);rr(c,cloth.x-rail*.57,cloth.y-rail*.57,cloth.w+rail*1.14,cloth.h+rail*1.14,rail*.26);c.stroke();
    c.strokeStyle='rgba(255,215,85,.92)';c.lineWidth=Math.max(1,rail*.035);rr(c,cloth.x-rail*.50,cloth.y-rail*.50,cloth.w+rail,cloth.h+rail,rail*.22);c.stroke();

    const pool=this.gameMode!=='snooker',felt=c.createLinearGradient(cloth.x,cloth.y,cloth.x+cloth.w,cloth.y+cloth.h);
    felt.addColorStop(0,pool?'#19b7dc':'#1bb878');felt.addColorStop(.42,pool?'#079bc8':'#0da067');felt.addColorStop(.72,pool?'#0781b1':'#078455');felt.addColorStop(1,pool?'#056590':'#056b45');
    c.fillStyle=felt;c.fillRect(cloth.x,cloth.y,cloth.w,cloth.h);
    const glow=c.createRadialGradient(L.cx,L.cy,0,L.cx,L.cy,cloth.w*.55);glow.addColorStop(0,'rgba(255,255,255,.13)');glow.addColorStop(.48,'rgba(78,225,255,.025)');glow.addColorStop(1,'rgba(0,14,34,.27)');c.fillStyle=glow;c.fillRect(cloth.x,cloth.y,cloth.w,cloth.h);

    c.strokeStyle='rgba(238,249,246,.44)';c.lineWidth=1;
    if(this.gameMode==='snooker'){
      const s=this.worldToScreen(0,D_AREA.baulkZ);c.beginPath();c.moveTo(s.x,cloth.y);c.lineTo(s.x,cloth.y+cloth.h);c.stroke();c.beginPath();c.arc(s.x,s.y,D_AREA.radius*L.scale,Math.PI/2,Math.PI*1.5);c.stroke();
      for(const p of Object.values(COLOUR_SPOTS)){const q=this.worldToScreen(p.x,p.z);c.fillStyle='rgba(240,250,248,.33)';c.beginPath();c.arc(q.x,q.y,1.5,0,Math.PI*2);c.fill();}
    }else{
      const headZ=-T.length*.25,hs=this.worldToScreen(0,headZ),fs=this.worldToScreen(0,T.length*.25);c.beginPath();c.moveTo(hs.x,cloth.y);c.lineTo(hs.x,cloth.y+cloth.h);c.stroke();c.fillStyle='rgba(240,250,248,.48)';c.beginPath();c.arc(fs.x,fs.y,2,0,Math.PI*2);c.fill();
    }

    for(let i=1;i<=7;i++){const x=cloth.x+cloth.w*i/8;c.fillStyle='#f7e6a8';c.save();c.translate(x,cloth.y-rail*.48);c.rotate(Math.PI/4);c.fillRect(-2,-2,4,4);c.restore();c.save();c.translate(x,cloth.y+cloth.h+rail*.48);c.rotate(Math.PI/4);c.fillRect(-2,-2,4,4);c.restore();}

    // Presentation geometry is intentionally NOT the collision geometry.
    // Physics still uses the full hidden jaw segments, but exposing those
    // segments visually produced the hook-like corners seen in v4.6.  The
    // player now sees a continuous cushion profile with clean pocket cut-outs.
    const cushionTone=pool?'#057c9f':'#087c50',cushionHi=pool?'rgba(132,245,255,.88)':'rgba(123,255,184,.78)';
    c.lineJoin='round';c.lineCap='round';
    for(const sg of cushions){
      if(sg.kind!=='straight')continue;
      const a=this.worldToScreen(sg.ax,sg.az),b=this.worldToScreen(sg.bx,sg.bz);
      // Dark rubber body gives the rail real depth without showing collision gizmos.
      c.strokeStyle='rgba(0,8,21,.90)';c.lineWidth=Math.max(10,rail*.37);c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();
      // Main cushion face.
      c.strokeStyle=cushionTone;c.lineWidth=Math.max(6.5,rail*.245);c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();
      // Narrow top highlight makes the cushion read as a beveled 3D edge.
      c.strokeStyle=cushionHi;c.lineWidth=Math.max(1.15,rail*.038);c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();
    }

    // Pocket mouths are rendered at the real rail openings, not at the deep
    // physics capture target.  Drawing them last masks the rounded cushion
    // ends and creates a seamless rail -> facing -> recessed-hole transition.
    const hx=T.width/2,hz=T.length/2;
    for(const p of pockets){
      const mouth=p.type==='corner'?geom.cornerMouth:geom.middleMouth;
      let vx=0,vz=0;
      if(p.type==='corner'){
        vx=p.sx*(hx+T.ballRadius*.08);vz=p.sz*(hz+T.ballRadius*.08);
      }else{
        vx=p.sx*(hx+T.ballRadius*.055);vz=0;
      }
      const s=this.worldToScreen(vx,vz),r=Math.max(10,mouth*.50*L.scale),side=p.type==='middle';
      c.save();c.translate(s.x,s.y);
      // Leather/facing surround: restrained and flush with the rail instead of
      // the old bright circular ring.
      c.shadowColor='rgba(0,0,0,.82)';c.shadowBlur=Math.max(9,r*.52);c.shadowOffsetY=Math.max(1,r*.06);
      const leather=c.createRadialGradient(-r*.30,-r*.34,1,0,0,r*1.22);
      leather.addColorStop(0,pool?'#71362d':'#603126');leather.addColorStop(.45,'#2c1318');leather.addColorStop(1,'#06070a');
      c.fillStyle=leather;c.beginPath();c.ellipse(0,0,side?r*1.16:r*1.08,side?r*.82:r*1.02,0,0,Math.PI*2);c.fill();
      // Deep pocket interior.  A small off-centre highlight gives depth but no
      // exposed hardware or collision-line look.
      c.shadowColor='transparent';
      const hole=c.createRadialGradient(-r*.22,-r*.28,1,r*.08,r*.08,r*1.02);
      hole.addColorStop(0,'#182531');hole.addColorStop(.26,'#070a0e');hole.addColorStop(.64,'#010203');hole.addColorStop(1,'#000');
      c.fillStyle=hole;c.beginPath();c.ellipse(0,0,side?r*.94:r*.90,side?r*.63:r*.85,0,0,Math.PI*2);c.fill();
      c.strokeStyle='rgba(255,171,97,.45)';c.lineWidth=Math.max(1,r*.045);c.stroke();
      c.restore();
    }
    c.restore();
  }
  #poolBall(c,b,s,r){const stripe=b.poolGroup==='stripe',base=b.color||'#ddd';c.save();c.filter='saturate(1.22) contrast(1.06)';c.fillStyle='rgba(0,0,0,.42)';c.beginPath();c.ellipse(s.x+r*.22,s.y+r*.58,r*.92,r*.34,0,0,Math.PI*2);c.fill();const body=c.createRadialGradient(s.x-r*.35,s.y-r*.42,1,s.x+r*.15,s.y+r*.15,r*1.2);body.addColorStop(0,'#fff');body.addColorStop(.07,'#fff');body.addColorStop(.15,stripe?'#fffef8':base);body.addColorStop(.58,stripe?'#f3f0e5':base);body.addColorStop(.86,stripe?'#d0cdc3':base);body.addColorStop(1,stripe?'#757879':'#080d17');c.fillStyle=body;c.beginPath();c.arc(s.x,s.y,r,0,Math.PI*2);c.fill();if(stripe){c.save();c.beginPath();c.arc(s.x,s.y,r*.94,0,Math.PI*2);c.clip();const ang=2*Math.atan2(b.orientation?.[2]||0,b.orientation?.[3]||1);c.translate(s.x,s.y);c.rotate(ang*.35);const band=c.createLinearGradient(0,-r*.38,0,r*.38);band.addColorStop(0,base);band.addColorStop(.5,base);band.addColorStop(1,'#111');c.fillStyle=band;c.fillRect(-r*1.1,-r*.38,r*2.2,r*.76);c.restore();}
    c.strokeStyle='rgba(0,0,0,.58)';c.lineWidth=Math.max(1,r*.07);c.beginPath();c.arc(s.x,s.y,r,0,Math.PI*2);c.stroke();
    const n=b.number||0;if(n>0){const v=rotateVec(b.orientation||[0,0,0,1],[0,1,0]);if(v[1]>-.15){const vis=clamp((v[1]+.15)/1.15,.18,1),ox=v[2]*r*.47,oy=-v[0]*r*.47;c.save();c.translate(s.x+ox,s.y+oy);c.scale(1,Math.max(.28,vis));c.fillStyle='#f9f8f2';c.beginPath();c.arc(0,0,r*.39,0,Math.PI*2);c.fill();c.strokeStyle='rgba(0,0,0,.25)';c.lineWidth=1;c.stroke();c.fillStyle='#111722';c.font=`900 ${Math.max(7,r*.48)}px Arial`;c.textAlign='center';c.textBaseline='middle';c.fillText(String(n),0,.5);c.restore();}}
    c.shadowColor='rgba(255,255,255,.34)';c.shadowBlur=Math.max(2,r*.18);c.fillStyle='rgba(255,255,255,.96)';c.beginPath();c.ellipse(s.x-r*.34,s.y-r*.40,r*.18,r*.10,-.55,0,Math.PI*2);c.fill();c.restore();}
  #snookerBall(c,b,s,r){c.save();c.filter='saturate(1.20) contrast(1.06)';c.fillStyle='rgba(0,0,0,.33)';c.beginPath();c.ellipse(s.x+r*.22,s.y+r*.56,r*.92,r*.34,0,0,Math.PI*2);c.fill();const edge=b.name==='Black'?'#000':b.kind==='red'?'#730f1d':b.color,g=c.createRadialGradient(s.x-r*.36,s.y-r*.43,1,s.x+r*.1,s.y+r*.13,r*1.15);g.addColorStop(0,'#fff');g.addColorStop(.075,'#fff');g.addColorStop(.15,b.color);g.addColorStop(.58,b.color);g.addColorStop(.84,b.color);g.addColorStop(1,edge);c.fillStyle=g;c.beginPath();c.arc(s.x,s.y,r,0,Math.PI*2);c.fill();c.strokeStyle='rgba(0,0,0,.45)';c.lineWidth=Math.max(1,r*.07);c.stroke();c.shadowColor='rgba(255,255,255,.30)';c.shadowBlur=Math.max(2,r*.16);c.fillStyle='rgba(255,255,255,.96)';c.beginPath();c.ellipse(s.x-r*.35,s.y-r*.4,r*.19,r*.11,-.55,0,Math.PI*2);c.fill();c.restore();}
  #ball(c,b,L,alpha=1,ghost=false,sizeScale=1){const s=this.worldToScreen(b.position.x,b.position.y),r=Math.max(2,b.radius*L.scale*1.08*sizeScale);c.save();c.globalAlpha=alpha;if(ghost){c.strokeStyle='#fff';c.lineWidth=1.5;c.beginPath();c.arc(s.x,s.y,r,0,Math.PI*2);c.stroke();c.restore();return;}if(b.kind==='pool')this.#poolBall(c,b,s,r);else this.#snookerBall(c,b,s,r);c.restore();}
  #balls(c,L){for(const b of this.world.balls){if(!b.potted){this.#ball(c,b,L);if(b.kind==='cue'&&b.inHand){const s=this.worldToScreen(b.position.x,b.position.y),r=Math.max(5,b.radius*L.scale*1.08);c.save();c.strokeStyle='rgba(124,255,206,.78)';c.lineWidth=2;c.beginPath();c.arc(s.x,s.y,r*1.55,0,Math.PI*2);c.stroke();c.restore();}continue;}if(b.pocketDrop&&b.fall<.30){const t=clamp(b.fall/.30,0,1),e=1-Math.pow(1-t,3),q=Object.create(b);q.position={x:b.pocketDrop.startX+(b.pocketDrop.targetX-b.pocketDrop.startX)*e,y:b.pocketDrop.startZ+(b.pocketDrop.targetZ-b.pocketDrop.startZ)*e};this.#ball(c,q,L,1-t*.92,false,1-t*.58);}}if(this.placementPreview&&this.ballInHand){const R=this.cue.cueBall?.radius||TABLE.ballRadius,q={position:{x:this.placementPreview.x,y:this.placementPreview.z},radius:R,color:'white',kind:'cue',name:'Cue'},ok=this.placementPreview.valid!==false;if(!ok)this.#ball(c,q,L,.38);const s=this.worldToScreen(q.position.x,q.position.y);c.strokeStyle=ok?'#71ff9b':'#ff6577';c.lineWidth=2;c.beginPath();c.arc(s.x,s.y,R*L.scale*1.55,0,Math.PI*2);c.stroke();}}
  #targetAssist(c,L){
    if(this.gameMode!=='9ball'||this.ballInHand||this.aiThinking||!this.world.allStopped()||!this.legalTargetProvider)return;
    const targets=this.legalTargetProvider()||[],b=targets[0];if(!b||b.potted||b.offTable)return;
    const s=this.worldToScreen(b.position.x,b.position.y),r=Math.max(8,b.radius*L.scale*1.08),pulse=.5+.5*Math.sin(performance.now()*.0045);
    c.save();c.strokeStyle=`rgba(255,220,92,${.52+pulse*.24})`;c.lineWidth=Math.max(1.6,r*.10);c.beginPath();c.arc(s.x,s.y,r*1.42,0,Math.PI*2);c.stroke();
    c.strokeStyle='rgba(255,255,255,.72)';c.lineWidth=1;c.beginPath();c.arc(s.x,s.y,r*1.72,-.42,.42);c.stroke();c.beginPath();c.arc(s.x,s.y,r*1.72,Math.PI-.42,Math.PI+.42);c.stroke();c.restore();
  }
  #guideCue(c,L,off=0){
    const b=this.cue.cueBall;if(!b||b.potted||!this.world.allStopped()||this.ballInHand||this.aiThinking)return;
    const d=this.cue.direction(),sd=this.#screenDir(d),p=this.worldToScreen(b.position.x,b.position.y),r=b.radius*L.scale;
    const hit=this.#rayFirstBall(),cushionHit=this.#rayFirstCushion(),bound=cushionHit?.t??this.#rayBounds(b.position.x,b.position.y,d,b.radius);
    const ballFirst=!!hit&&hit.t<=bound+.0015,len=ballFirst?hit.t:bound;
    const start={x:p.x+sd.x*r*1.06,y:p.y+sd.y*r*1.06},end={x:p.x+sd.x*len*L.scale,y:p.y+sd.y*len*L.scale};
    c.save();c.lineCap='round';
    c.strokeStyle='rgba(0,12,18,.58)';c.lineWidth=4;c.beginPath();c.moveTo(start.x,start.y);c.lineTo(end.x,end.y);c.stroke();
    c.strokeStyle='rgba(250,253,255,.97)';c.lineWidth=1.65;c.beginPath();c.moveTo(start.x,start.y);c.lineTo(end.x,end.y);c.stroke();

    if(ballFirst){
      const gx=b.position.x+d.x*hit.t,gz=b.position.y+d.y*hit.t,gs=this.worldToScreen(gx,gz),ox=hit.ball.position.x,oz=hit.ball.position.y;
      let nx=ox-gx,nz=oz-gz,n=Math.hypot(nx,nz)||1;nx/=n;nz/=n;
      const legal=this.firstContactValidator?!!this.firstContactValidator(hit.ball):true;
      const os=this.worldToScreen(ox,oz),out=.30,o=this.worldToScreen(ox+nx*out,oz+nz*out);
      // Only legal first-contact balls get object-ball trajectory help.
      // Wrong-group / wrong-number contacts are marked with the foul X only.
      if(legal){c.strokeStyle='rgba(250,253,255,.90)';c.lineWidth=1.65;c.beginPath();c.moveTo(os.x,os.y);c.lineTo(o.x,o.y);c.stroke();}
      c.fillStyle=legal?'rgba(255,255,255,.035)':'rgba(255,45,64,.10)';c.beginPath();c.arc(gs.x,gs.y,r,0,Math.PI*2);c.fill();
      c.strokeStyle=legal?'rgba(250,253,255,.96)':'#ff4055';c.lineWidth=legal?1.65:2.8;c.beginPath();c.arc(gs.x,gs.y,r,0,Math.PI*2);c.stroke();
      if(!legal){
        // Clear incorrect-contact symbol at the ghost-ball collision location,
        // plus a restrained halo around the actual illegal object ball.
        c.strokeStyle='rgba(255,64,85,.88)';c.lineWidth=Math.max(1.6,r*.09);c.beginPath();c.arc(os.x,os.y,r*1.22,0,Math.PI*2);c.stroke();
        const q=Math.max(4.5,r*.42);c.strokeStyle='#ff4055';c.lineWidth=Math.max(2.2,r*.13);c.beginPath();c.moveTo(gs.x-q,gs.y-q);c.lineTo(gs.x+q,gs.y+q);c.moveTo(gs.x+q,gs.y-q);c.lineTo(gs.x-q,gs.y+q);c.stroke();
      }
    }
    c.restore();

    const tipGap=r+7+off,clearWorld=this.#cueBackClearance(),maxCueLen=L.cloth.w*.46,availablePx=Math.max(0,clearWorld*L.scale-tipGap-3),cueLen=Math.min(maxCueLen,availablePx),tipX=p.x-sd.x*tipGap,tipY=p.y-sd.y*tipGap,buttX=tipX-sd.x*cueLen,buttY=tipY-sd.y*cueLen;
    c.save();c.lineCap='round';c.strokeStyle='rgba(0,0,0,.5)';c.lineWidth=10;c.beginPath();c.moveTo(tipX+2,tipY+3);c.lineTo(buttX+2,buttY+3);c.stroke();const g=c.createLinearGradient(tipX,tipY,buttX,buttY);g.addColorStop(0,'#fff5d2');g.addColorStop(.30,'#e7c77e');g.addColorStop(.33,'#efffff');g.addColorStop(.40,'#27efff');g.addColorStop(.51,'#0786be');g.addColorStop(.59,'#ffd34d');g.addColorStop(.68,'#f0a91e');g.addColorStop(.76,'#253ea1');g.addColorStop(.88,'#15d4e4');g.addColorStop(1,'#251064');c.strokeStyle=g;c.shadowColor='rgba(33,224,255,.22)';c.shadowBlur=6;c.lineWidth=6.4;c.beginPath();c.moveTo(tipX,tipY);c.lineTo(buttX,buttY);c.stroke();c.strokeStyle='#fff1d0';c.lineWidth=6.8;c.beginPath();c.moveTo(tipX,tipY);c.lineTo(tipX-sd.x*7,tipY-sd.y*7);c.stroke();c.restore();
  }
  #proAim(c,L){
    if(!this.proAimEnabled||!this.proAimAllowed||this.ballInHand||this.aiThinking||!this.world.allStopped()||this.stroke)return;
    const result=this.proAimPredictor.predict(this.world,this.cue);if(!result)return;
    c.save();c.lineCap='round';c.lineJoin='round';
    for(const tr of result.tracks){
      if(!tr.points||tr.points.length<2)continue;
      const cueTrack=tr.kind==='cue'||tr.name==='Cue';
      c.strokeStyle=cueTrack?'rgba(255,255,255,.78)':(tr.color?tr.color:'rgba(120,255,210,.72)');
      c.globalAlpha=cueTrack?.92:.70;c.lineWidth=cueTrack?1.8:1.35;
      c.beginPath();let q=this.worldToScreen(tr.points[0].x,tr.points[0].z);c.moveTo(q.x,q.y);
      for(let i=1;i<tr.points.length;i++){q=this.worldToScreen(tr.points[i].x,tr.points[i].z);c.lineTo(q.x,q.y);}c.stroke();
    }
    c.globalAlpha=.92;
    for(const e of result.collisions){const s=this.worldToScreen(e.x,e.z);c.strokeStyle='#b8ffd8';c.lineWidth=1.25;c.beginPath();c.arc(s.x,s.y,3.2,0,Math.PI*2);c.stroke();}
    for(const e of result.cushions){const s=this.worldToScreen(e.x,e.z);c.fillStyle='rgba(145,255,193,.82)';c.beginPath();c.arc(s.x,s.y,2.1,0,Math.PI*2);c.fill();}
    for(const end of result.ends){if(end.potted||end.offTable)continue;const tr=result.tracks.find(t=>t.key===end.key);if(!tr||tr.points.length<2)continue;const s=this.worldToScreen(end.x,end.z),r=Math.max(3,(tr.radius||this.cue.cueBall?.radius||.026)*L.scale);c.strokeStyle=tr.kind==='cue'||tr.name==='Cue'?'rgba(255,255,255,.66)':(tr.color||'rgba(132,255,194,.66)');c.lineWidth=1;c.globalAlpha=.66;c.beginPath();c.arc(s.x,s.y,r,0,Math.PI*2);c.stroke();}
    for(const e of result.pockets){const s=this.worldToScreen(e.x,e.z);c.strokeStyle='rgba(127,255,177,.92)';c.globalAlpha=.92;c.lineWidth=1.4;c.beginPath();c.arc(s.x,s.y,4.2,0,Math.PI*2);c.stroke();}
    c.restore();
  }
  #proAimIndicator(c,w,h){if(!this.proAimEnabled)return;c.save();c.shadowColor='rgba(39,255,103,.72)';c.shadowBlur=8;c.fillStyle='#27ff67';c.beginPath();c.arc(14,h-14,4,0,Math.PI*2);c.fill();c.restore();}
  #aimPointer(c,now){if(!this.aimPointer)return;const age=now-this.aimPointer.t;if(this.aimPointer.fade&&age>260){this.aimPointer=null;return;}const a=this.aimPointer.fade?1-age/260:.75,s=this.worldToScreen(this.aimPointer.x,this.aimPointer.z);c.save();c.globalAlpha=a;c.strokeStyle='#fff';c.lineWidth=1;c.beginPath();c.arc(s.x,s.y,6,0,Math.PI*2);c.stroke();c.restore();}
  #bursts(c,now){this.pocketBursts=this.pocketBursts.filter(p=>now-p.t<420);for(const p of this.pocketBursts){const t=(now-p.t)/420,s=this.worldToScreen(p.x,p.z);c.save();c.globalAlpha=1-t;c.strokeStyle=p.color||'#fff';c.lineWidth=2;c.beginPath();c.arc(s.x,s.y,8+18*t,0,Math.PI*2);c.stroke();c.restore();}}
  #hints(c,L){if(this.ballInHand){c.save();c.fillStyle='rgba(6,32,30,.78)';rr(c,L.cx-42,L.cloth.y+8,84,22,11);c.fill();c.fillStyle='#eaffef';c.font='900 8px Arial';c.textAlign='center';c.fillText('BALL IN HAND',L.cx,L.cloth.y+22);c.restore();}}
  render(){const {w,h}=this.#resize(),c=this.ctx,L=this.#layout(w,h),now=performance.now(),strokeOffset=this.advanceStroke(now);c.clearRect(0,0,w,h);this.#background(c,w,h);this.#table(c,L);this.#proAim(c,L);this.#guideCue(c,L,strokeOffset);this.#balls(c,L);this.#targetAssist(c,L);this.#aimPointer(c,now);this.#bursts(c,now);this.#hints(c,L);this.#proAimIndicator(c,w,h);}
}
