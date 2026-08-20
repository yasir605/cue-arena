import { TABLE } from '../config.js';
import { buildPockets, buildCushionSegments, geometryFor } from '../table/TableGeometry.js';
import { COLOUR_SPOTS, D_AREA } from '../game/SnookerSetup.js';
import { ProAimPredictor } from '../physics/ProAimPredictor.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function rr(c,x,y,w,h,r){r=Math.min(r,w/2,h/2);c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}
function rotateVec(q,v){const [x,y,z,w]=q||[0,0,0,1],[vx,vy,vz]=v;const tx=2*(y*vz-z*vy),ty=2*(z*vx-x*vz),tz=2*(x*vy-y*vx);return [vx+w*tx+(y*tz-z*ty),vy+w*ty+(z*tx-x*tz),vz+w*tz+(x*ty-y*tx)];}

export class Renderer2D{
  constructor(canvas,world,cue){this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:false});this.world=world;this.cue=cue;this.renderScale=1;this.quality='high';this.stroke=null;this.pullback=0;this.guideMode='full';this.placementPreview=null;this.pocketBursts=[];this.lastLayout=null;this.ballOn='RED';this.ballInHand=false;this.aiThinking=false;this.aimPointer=null;this.gameMode='snooker';this.firstContactValidator=null;this.legalTargetProvider=null;this._tableCache=null;this._cachedPockets=[];this._cachedCushions=[];this._cachedGeom=null;this.proAimEnabled=false;this.proAimAllowed=true;this.proAimPredictor=new ProAimPredictor();this._patternCache=new Map();this.mobileOptimized=false;this._staticLayer=null;this._staticKey='';}
  #invalidateStatic(){this._staticLayer=null;this._staticKey='';}
  setQuality(q){this.quality=q||'high';this.#invalidateStatic();}setMobileOptimized(v){this.mobileOptimized=!!v;this.#invalidateStatic();}setProAimEnabled(v){this.proAimEnabled=!!v;if(!this.proAimEnabled)this.proAimPredictor.clear();}setProAimAllowed(v){this.proAimAllowed=!!v;}setRenderScale(v){this.renderScale=clamp(+v||1,.72,1);this.#invalidateStatic();}setAimGuide(){this.guideMode='full';}setBallOn(v){this.ballOn=v||'—';}setBallInHand(v){this.ballInHand=!!v;}setAIThinking(v){this.aiThinking=!!v;}setPullback(v){this.pullback=clamp(v||0,0,1);}setPlacementPreview(p){this.placementPreview=p||null;}clearPlacementPreview(){this.placementPreview=null;}setGameMode(m){this.gameMode=m||'snooker';this._tableCache=null;this.#invalidateStatic();}setFirstContactValidator(fn){this.firstContactValidator=typeof fn==='function'?fn:null;}setLegalTargetProvider(fn){this.legalTargetProvider=typeof fn==='function'?fn:null;}
  setAimPointer(p){this.aimPointer=p?{...p,t:performance.now(),fade:false}:null;}fadeAimPointer(){if(this.aimPointer){this.aimPointer.fade=true;this.aimPointer.t=performance.now();}}
  cameraLabel(){return 'TOP DOWN 3D';}performanceStats(){return{drawCalls:1,triangles:0,geometries:0,textures:0,pixelRatio:(devicePixelRatio||1)*this.renderScale};}
  notifyPocket(ball){if(!ball)return;this.pocketBursts.push({x:ball.position.x,z:ball.position.y,color:ball.color,t:performance.now()});if(this.pocketBursts.length>8)this.pocketBursts.shift();}
  isStrokeAnimating(){return!!this.stroke;}playCueStroke(power,onImpact){if(this.stroke)return false;this.stroke={start:performance.now(),power:clamp(power,.02,1),onImpact,hit:false};return true;}
  // Advance cue-stroke timing independently from whether the cue is currently
  // visible. A scratch can put the white into ball-in-hand before the visual
  // stroke has finished; tying stroke progression to #guideCue previously left
  // this.stroke alive forever and deadlocked shot finalization/input.
  advanceStroke(now=performance.now()){let off=0;if(this.stroke){const q=clamp((now-this.stroke.start)/300,0,1),P=this.stroke.power;if(q<.5)off=q/.5*(20+44*P);else if(q<.74)off=(1-(q-.5)/.24)*(20+44*P)-8*((q-.5)/.24);else off=-8+(q-.74)/.26*10;if(q>=.68&&!this.stroke.hit){this.stroke.hit=true;this.stroke.onImpact?.();}if(q>=1){this.stroke=null;off=0;}}else off=this.pullback*(22+52*this.pullback);return off;}
  #resize(){const W=Math.max(320,this.canvas.clientWidth||innerWidth),H=Math.max(240,this.canvas.clientHeight||innerHeight),dpr=clamp((devicePixelRatio||1)*this.renderScale,1,this.mobileOptimized?1.25:2);const w=Math.floor(W*dpr),h=Math.floor(H*dpr);if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;this.#invalidateStatic();}this.ctx.setTransform(dpr,0,0,dpr,0,0);return{w:W,h:H,dpr};}
  #layout(w,h){const T=this.world.table||TABLE,compact=h<650,top=compact?53:62,bottom=2,left=compact?54:62,right=compact?54:62,rail=Math.max(22,Math.min(34,h*.039));const aw=w-left-right,ah=h-top-bottom,ratio=T.length/T.width;let tw=Math.min(aw-rail*2,(ah-rail*2)*ratio),th=tw/ratio;if(th+rail*2>ah){th=ah-rail*2;tw=th*ratio;}const cx=left+aw/2,cy=top+ah/2,scale=tw/T.length,cloth={x:cx-tw/2,y:cy-th/2,w:tw,h:th},outer={x:cloth.x-rail,y:cloth.y-rail,w:cloth.w+rail*2,h:cloth.h+rail*2,r:Math.max(14,rail*.55)};return this.lastLayout={w,h,compact,top,left,right,rail,cx,cy,scale,cloth,outer};}
  worldToScreen(x,z){const L=this.lastLayout;return L?{x:L.cx+z*L.scale,y:L.cy-x*L.scale}:{x:0,y:0};}
  screenToWorld(clientX,clientY){const r=this.canvas.getBoundingClientRect(),sx=clientX-r.left,sy=clientY-r.top,L=this.lastLayout||this.#layout(r.width,r.height);return{x:(L.cy-sy)/L.scale,z:(sx-L.cx)/L.scale};}
  #screenDir(d){return{x:d.y,y:-d.x};}
  #tableGeometry(){const T=this.world.table||TABLE;if(this._tableCache!==T){this._tableCache=T;this._cachedPockets=buildPockets(T);this._cachedCushions=buildCushionSegments(T);this._cachedGeom=geometryFor(T);}return{T,pockets:this._cachedPockets,cushions:this._cachedCushions,geom:this._cachedGeom};}
  #rayFirstBall(){const cb=this.cue.cueBall;if(!cb||cb.potted)return null;const d=this.cue.direction(),px=cb.position.x,pz=cb.position.y;let best=null,tBest=Infinity;for(const b of this.world.balls){if(b===cb||b.potted)continue;const ox=px-b.position.x,oz=pz-b.position.y,R=cb.radius+b.radius,B=2*(ox*d.x+oz*d.y),C=ox*ox+oz*oz-R*R,disc=B*B-4*C;if(disc<0)continue;const q=Math.sqrt(disc),t1=(-B-q)/2,t2=(-B+q)/2,t=t1>.001?t1:t2>.001?t2:Infinity;if(t<tBest){tBest=t;best={ball:b,t};}}return best;}
  #rayFirstCushion(){const cb=this.cue.cueBall;if(!cb||cb.potted)return null;const d=this.cue.direction(),px=cb.position.x,pz=cb.position.y,R=cb.radius;let best=null,tBest=Infinity;for(const sg of this.#tableGeometry().cushions){const s0=(px-sg.ax)*sg.nx+(pz-sg.az)*sg.nz,den=d.x*sg.nx+d.y*sg.nz;if(den< -1e-9){const t=(R-s0)/den;if(t>.001&&t<tBest){const ix=px+d.x*t,iz=pz+d.y*t,u=sg.lenSq>0?((ix-sg.ax)*sg.dx+(iz-sg.az)*sg.dz)/sg.lenSq:0;if(u>=0&&u<=1){best={segment:sg,t};tBest=t;}}}for(const [ex,ez] of [[sg.ax,sg.az],[sg.bx,sg.bz]]){const ox=px-ex,oz=pz-ez,B=2*(ox*d.x+oz*d.y),C=ox*ox+oz*oz-R*R,disc=B*B-4*C;if(disc<0)continue;const q=Math.sqrt(disc),t1=(-B-q)/2,t2=(-B+q)/2,t=t1>.001?t1:t2>.001?t2:Infinity;if(t>=tBest||!Number.isFinite(t))continue;const ix=px+d.x*t,iz=pz+d.y*t,nx=(ix-ex)/R,nz=(iz-ez)/R;if(nx*sg.nx+nz*sg.nz<-.12)continue;best={segment:sg,t};tBest=t;}}return best;}
  #rayBounds(x,z,d,r){const T=this.world.table||TABLE,hx=T.width/2-r,hz=T.length/2-r;let t=Infinity;if(Math.abs(d.x)>1e-9)for(const v of [(hx-x)/d.x,(-hx-x)/d.x])if(v>0)t=Math.min(t,v);if(Math.abs(d.y)>1e-9)for(const v of [(hz-z)/d.y,(-hz-z)/d.y])if(v>0)t=Math.min(t,v);return Number.isFinite(t)?t:1;}
  #cueBackClearance(){const cb=this.cue.cueBall;if(!cb)return 1.55;const d=this.cue.direction(),bx=-d.x,bz=-d.y;let best=1.55;for(const b of this.world.balls){if(b===cb||b.potted)continue;const rx=b.position.x-cb.position.x,rz=b.position.y-cb.position.y,t=rx*bx+rz*bz;if(t<=0)continue;const perp=Math.abs(rx*bz-rz*bx),shaftClear=b.radius+.012;if(perp>=shaftClear)continue;const halfChord=Math.sqrt(Math.max(0,shaftClear*shaftClear-perp*perp));const enter=t-halfChord-.010;best=Math.min(best,Math.max(0.004,enter));}return best;}
  #pattern(name,size,paint){let p=this._patternCache.get(name);if(p)return p;const q=document.createElement('canvas');q.width=q.height=size;const x=q.getContext('2d');paint(x,size);p=this.ctx.createPattern(q,'repeat');this._patternCache.set(name,p);return p;}
  #background(c,w,h){
    const base=c.createLinearGradient(0,0,0,h);base.addColorStop(0,'#102f54');base.addColorStop(.28,'#071c35');base.addColorStop(.72,'#030b18');base.addColorStop(1,'#01040b');c.fillStyle=base;c.fillRect(0,0,w,h);
    const arena=c.createRadialGradient(w*.5,h*.18,10,w*.5,h*.32,Math.max(w,h)*.76);arena.addColorStop(0,'rgba(64,183,255,.26)');arena.addColorStop(.28,'rgba(18,82,143,.13)');arena.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=arena;c.fillRect(0,0,w,h);
    // Carpet / venue texture gives the 2D renderer material density without WebGL.
    const carpet=this.#pattern('arena-carpet',48,(x,n)=>{x.fillStyle='#07111d';x.fillRect(0,0,n,n);x.strokeStyle='rgba(78,129,169,.10)';x.lineWidth=1;for(let i=-n;i<n*2;i+=12){x.beginPath();x.moveTo(i,0);x.lineTo(i+n,n);x.stroke();x.beginPath();x.moveTo(i,n);x.lineTo(i+n,0);x.stroke();}x.fillStyle='rgba(255,255,255,.025)';for(let y=4;y<n;y+=8)for(let z=4;z<n;z+=8)x.fillRect(z,y,1,1);});
    c.save();c.globalAlpha=.52;c.fillStyle=carpet;c.fillRect(0,h*.42,w,h*.58);c.restore();
    // Overhead light panels reflected into the scene.
    const pw=Math.min(260,w*.22),ph=Math.max(7,h*.012);for(const dx of [-.24,0,.24]){const x=w*.5+dx*w-pw*.5,y=Math.max(8,h*.075);c.save();c.shadowColor='rgba(129,224,255,.45)';c.shadowBlur=26;c.fillStyle='rgba(214,248,255,.34)';rr(c,x,y,pw,ph,ph*.5);c.fill();c.restore();}
    const vign=c.createRadialGradient(w*.5,h*.46,Math.min(w,h)*.18,w*.5,h*.48,Math.max(w,h)*.72);vign.addColorStop(.55,'rgba(0,0,0,0)');vign.addColorStop(1,'rgba(0,0,0,.62)');c.fillStyle=vign;c.fillRect(0,0,w,h);
  }
  #table(c,L){
    const {outer,cloth,rail}=L,{T,geom,pockets,cushions}=this.#tableGeometry(),pool=this.gameMode!=='snooker';
    c.save();
    // Ground shadow + under-table bounce light.
    c.shadowColor='rgba(0,0,0,.92)';c.shadowBlur=44;c.shadowOffsetY=18;c.fillStyle='#02050a';rr(c,outer.x-6,outer.y-4,outer.w+12,outer.h+14,outer.r+5);c.fill();c.shadowColor='transparent';
    const under=c.createRadialGradient(L.cx,L.cy+outer.h*.36,10,L.cx,L.cy+outer.h*.28,outer.w*.50);under.addColorStop(0,pool?'rgba(44,191,255,.18)':'rgba(34,255,170,.14)');under.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=under;c.fillRect(outer.x-40,outer.y-20,outer.w+80,outer.h+70);

    // Deep cabinet/apron layers.
    const apron=c.createLinearGradient(0,outer.y,0,outer.y+outer.h);apron.addColorStop(0,pool?'#173959':'#4c1d16');apron.addColorStop(.18,pool?'#0e243c':'#34120f');apron.addColorStop(.72,pool?'#071525':'#150909');apron.addColorStop(1,'#03070c');c.fillStyle=apron;rr(c,outer.x,outer.y,outer.w,outer.h,outer.r);c.fill();
    c.fillStyle=pool?'rgba(35,109,164,.42)':'rgba(126,58,36,.40)';rr(c,outer.x+5,outer.y+6,outer.w-10,outer.h-14,Math.max(8,outer.r-4));c.fill();
    const railSkin=c.createLinearGradient(outer.x,outer.y,outer.x+outer.w,outer.y+outer.h);railSkin.addColorStop(0,pool?'#2d6b94':'#8a3b24');railSkin.addColorStop(.18,pool?'#183d62':'#5d251a');railSkin.addColorStop(.5,pool?'#0e2948':'#34140f');railSkin.addColorStop(.82,pool?'#173b61':'#61291b');railSkin.addColorStop(1,pool?'#071a31':'#1b0b0a');c.fillStyle=railSkin;rr(c,outer.x+rail*.12,outer.y+rail*.10,outer.w-rail*.24,outer.h-rail*.20,Math.max(8,outer.r-rail*.08));c.fill();

    // Procedural cabinet grain / brushed material.
    const grain=this.#pattern(pool?'rail-brushed':'rail-wood',64,(x,n)=>{x.clearRect(0,0,n,n);for(let y=2;y<n;y+=4){x.strokeStyle=pool?(y%8?'rgba(181,224,255,.035)':'rgba(4,17,31,.12)'):(y%8?'rgba(255,190,130,.045)':'rgba(35,5,0,.12)');x.beginPath();x.moveTo(0,y+Math.sin(y*.5)*1.2);x.bezierCurveTo(n*.25,y-2,n*.7,y+2,n,y);x.stroke();}});c.save();rr(c,outer.x+rail*.12,outer.y+rail*.10,outer.w-rail*.24,outer.h-rail*.20,Math.max(8,outer.r-rail*.08));c.clip();c.globalAlpha=.92;c.fillStyle=grain;c.fillRect(outer.x,outer.y,outer.w,outer.h);c.restore();

    // Layered metallic/chrome and gold inlays.
    c.strokeStyle=pool?'rgba(114,226,255,.92)':'rgba(255,183,91,.82)';c.lineWidth=Math.max(2,rail*.080);rr(c,outer.x+2,outer.y+2,outer.w-4,outer.h-4,outer.r-2);c.stroke();
    c.strokeStyle='rgba(255,246,194,.70)';c.lineWidth=Math.max(1,rail*.036);rr(c,cloth.x-rail*.56,cloth.y-rail*.56,cloth.w+rail*1.12,cloth.h+rail*1.12,rail*.28);c.stroke();
    c.strokeStyle=pool?'rgba(69,199,255,.58)':'rgba(255,120,75,.40)';c.lineWidth=Math.max(3,rail*.11);rr(c,cloth.x-rail*.67,cloth.y-rail*.67,cloth.w+rail*1.34,cloth.h+rail*1.34,rail*.34);c.stroke();

    // Cloth base + directional nap + weave texture.
    const felt=c.createLinearGradient(cloth.x,cloth.y,cloth.x+cloth.w,cloth.y+cloth.h);felt.addColorStop(0,pool?'#27b9d1':'#20c77f');felt.addColorStop(.35,pool?'#148fab':'#0e9f66');felt.addColorStop(.72,pool?'#0a708c':'#087c53');felt.addColorStop(1,pool?'#064b66':'#045b40');c.fillStyle=felt;c.fillRect(cloth.x,cloth.y,cloth.w,cloth.h);
    const weave=this.#pattern(pool?'felt-blue':'felt-green',18,(x,n)=>{x.clearRect(0,0,n,n);x.strokeStyle='rgba(255,255,255,.045)';x.lineWidth=.7;for(let i=1;i<n;i+=3){x.beginPath();x.moveTo(0,i+.5);x.lineTo(n,i+.5);x.stroke();}x.strokeStyle='rgba(0,18,23,.055)';for(let i=0;i<n;i+=4){x.beginPath();x.moveTo(i,0);x.lineTo(i,n);x.stroke();}});c.save();c.globalAlpha=.68;c.fillStyle=weave;c.fillRect(cloth.x,cloth.y,cloth.w,cloth.h);c.restore();
    const nap=c.createLinearGradient(cloth.x,cloth.y,cloth.x+cloth.w,cloth.y);nap.addColorStop(0,'rgba(255,255,255,.09)');nap.addColorStop(.30,'rgba(255,255,255,.015)');nap.addColorStop(.68,'rgba(0,0,0,.03)');nap.addColorStop(1,'rgba(0,0,0,.16)');c.fillStyle=nap;c.fillRect(cloth.x,cloth.y,cloth.w,cloth.h);
    const light=c.createRadialGradient(L.cx-cloth.w*.12,L.cy-cloth.h*.20,0,L.cx,L.cy,cloth.w*.58);light.addColorStop(0,'rgba(225,255,255,.16)');light.addColorStop(.48,'rgba(255,255,255,.035)');light.addColorStop(1,'rgba(0,18,30,.22)');c.fillStyle=light;c.fillRect(cloth.x,cloth.y,cloth.w,cloth.h);
    // Inner bevel shadow makes cloth visibly recessed below cushion tops.
    c.strokeStyle='rgba(0,0,0,.48)';c.lineWidth=Math.max(4,rail*.18);c.strokeRect(cloth.x+1,cloth.y+1,cloth.w-2,cloth.h-2);c.strokeStyle='rgba(255,255,255,.09)';c.lineWidth=1;c.strokeRect(cloth.x+3,cloth.y+3,cloth.w-6,cloth.h-6);

    // Table markings.
    c.strokeStyle='rgba(244,255,251,.52)';c.lineWidth=1;
    if(this.gameMode==='snooker'){
      const s=this.worldToScreen(0,D_AREA.baulkZ);c.beginPath();c.moveTo(s.x,cloth.y);c.lineTo(s.x,cloth.y+cloth.h);c.stroke();c.beginPath();c.arc(s.x,s.y,D_AREA.radius*L.scale,Math.PI/2,Math.PI*1.5);c.stroke();for(const p of Object.values(COLOUR_SPOTS)){const q=this.worldToScreen(p.x,p.z);c.fillStyle='rgba(245,255,249,.45)';c.beginPath();c.arc(q.x,q.y,1.7,0,Math.PI*2);c.fill();}
    }else{const headZ=-T.length*.25,hs=this.worldToScreen(0,headZ),fs=this.worldToScreen(0,T.length*.25);c.beginPath();c.moveTo(hs.x,cloth.y);c.lineTo(hs.x,cloth.y+cloth.h);c.stroke();c.fillStyle='rgba(245,255,255,.58)';c.beginPath();c.arc(fs.x,fs.y,2.2,0,Math.PI*2);c.fill();}

    // Rail diamonds / sights with brass/chrome sockets.
    for(let i=1;i<=7;i++){const x=cloth.x+cloth.w*i/8;for(const y of [cloth.y-rail*.49,cloth.y+cloth.h+rail*.49]){c.save();c.translate(x,y);c.shadowColor='rgba(0,0,0,.65)';c.shadowBlur=3;c.fillStyle=pool?'#d8f7ff':'#ffe0a0';c.strokeStyle=pool?'#4bbfea':'#b66a2f';c.lineWidth=1;c.rotate(Math.PI/4);c.fillRect(-2.7,-2.7,5.4,5.4);c.strokeRect(-2.7,-2.7,5.4,5.4);c.restore();}}

    // Cushions: rubber shadow, saturated face, bevel highlight, stitched lower seam.
    const cushionTone=pool?'#087c97':'#087348',cushionMid=pool?'#16a9be':'#0cae66',cushionHi=pool?'rgba(194,252,255,.78)':'rgba(190,255,220,.70)';c.lineJoin='round';c.lineCap='round';
    for(const sg of cushions){if(sg.kind!=='straight')continue;const a=this.worldToScreen(sg.ax,sg.az),b=this.worldToScreen(sg.bx,sg.bz);c.strokeStyle='rgba(0,7,10,.88)';c.lineWidth=Math.max(13,rail*.43);c.beginPath();c.moveTo(a.x+1,a.y+2);c.lineTo(b.x+1,b.y+2);c.stroke();c.strokeStyle=cushionTone;c.lineWidth=Math.max(9,rail*.31);c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();c.strokeStyle=cushionMid;c.lineWidth=Math.max(5.5,rail*.19);c.beginPath();c.moveTo(a.x-.3,a.y-.4);c.lineTo(b.x-.3,b.y-.4);c.stroke();c.strokeStyle=cushionHi;c.lineWidth=Math.max(1.1,rail*.035);c.beginPath();c.moveTo(a.x-.6,a.y-.8);c.lineTo(b.x-.6,b.y-.8);c.stroke();}

    // Pocket mouths: leather surround, stitched facing, deep well and inner reflection.
    const hx=T.width/2,hz=T.length/2;
    for(const p of pockets){const mouth=p.type==='corner'?geom.cornerMouth:geom.middleMouth;let vx=0,vz=0;if(p.type==='corner'){vx=p.sx*(hx+T.ballRadius*.08);vz=p.sz*(hz+T.ballRadius*.08);}else{vx=p.sx*(hx+T.ballRadius*.055);vz=0;}const s=this.worldToScreen(vx,vz),r=Math.max(10,mouth*.50*L.scale),side=p.type==='middle';c.save();c.translate(s.x,s.y);c.shadowColor='rgba(0,0,0,.95)';c.shadowBlur=Math.max(11,r*.75);c.shadowOffsetY=3;const leather=c.createRadialGradient(-r*.32,-r*.36,1,0,0,r*1.25);leather.addColorStop(0,'#9b5d42');leather.addColorStop(.22,'#5a2b22');leather.addColorStop(.58,'#281214');leather.addColorStop(1,'#070608');c.fillStyle=leather;c.beginPath();c.ellipse(0,0,side?r*1.18:r*1.11,side?r*.85:r*1.05,0,0,Math.PI*2);c.fill();c.shadowColor='transparent';c.setLineDash([Math.max(2,r*.12),Math.max(2,r*.10)]);c.strokeStyle='rgba(236,173,114,.42)';c.lineWidth=Math.max(.8,r*.035);c.stroke();c.setLineDash([]);const hole=c.createRadialGradient(-r*.23,-r*.31,1,r*.08,r*.10,r*1.03);hole.addColorStop(0,'#202b30');hole.addColorStop(.18,'#0c1115');hole.addColorStop(.58,'#020304');hole.addColorStop(1,'#000');c.fillStyle=hole;c.beginPath();c.ellipse(0,0,side?r*.95:r*.91,side?r*.64:r*.87,0,0,Math.PI*2);c.fill();const inner=c.createLinearGradient(0,-r*.4,0,r*.7);inner.addColorStop(0,'rgba(191,230,234,.11)');inner.addColorStop(.45,'rgba(0,0,0,0)');inner.addColorStop(1,'rgba(0,0,0,.75)');c.fillStyle=inner;c.beginPath();c.ellipse(0,0,side?r*.81:r*.78,side?r*.53:r*.73,0,0,Math.PI*2);c.fill();c.restore();}
    c.restore();
  }
  #ballShadow(c,s,r){c.save();if(!this.mobileOptimized)c.filter='blur(1.2px)';c.fillStyle=this.mobileOptimized?'rgba(0,0,0,.38)':'rgba(0,0,0,.48)';c.beginPath();c.ellipse(s.x+r*.28,s.y+r*.62,r*.98,r*(this.mobileOptimized?.31:.37),-.08,0,Math.PI*2);c.fill();c.restore();}
  #gloss(c,s,r){c.save();c.globalCompositeOperation='screen';if(!this.mobileOptimized){const rim=c.createRadialGradient(s.x-r*.30,s.y-r*.42,r*.05,s.x,s.y,r*1.05);rim.addColorStop(0,'rgba(255,255,255,.62)');rim.addColorStop(.22,'rgba(255,255,255,.10)');rim.addColorStop(.70,'rgba(255,255,255,0)');rim.addColorStop(1,'rgba(151,220,255,.13)');c.fillStyle=rim;c.beginPath();c.arc(s.x,s.y,r*.94,0,Math.PI*2);c.fill();}c.fillStyle='rgba(255,255,255,.82)';c.beginPath();c.ellipse(s.x-r*.34,s.y-r*.41,r*.20,r*.105,-.56,0,Math.PI*2);c.fill();if(!this.mobileOptimized){c.fillStyle='rgba(255,255,255,.24)';c.beginPath();c.ellipse(s.x+r*.20,s.y+r*.23,r*.11,r*.055,-.55,0,Math.PI*2);c.fill();}c.restore();}
  #poolBall(c,b,s,r){const stripe=b.poolGroup==='stripe',base=b.color||'#ddd';c.save();this.#ballShadow(c,s,r);const body=c.createRadialGradient(s.x-r*.38,s.y-r*.44,r*.04,s.x+r*.16,s.y+r*.18,r*1.18);body.addColorStop(0,'#fff');body.addColorStop(.08,'#fff');body.addColorStop(.17,stripe?'#fffef8':base);body.addColorStop(.60,stripe?'#f1efe5':base);body.addColorStop(.84,stripe?'#c7c6bd':base);body.addColorStop(1,stripe?'#6d7070':'#090e15');c.fillStyle=body;c.beginPath();c.arc(s.x,s.y,r,0,Math.PI*2);c.fill();
    if(stripe){c.save();c.beginPath();c.arc(s.x,s.y,r*.96,0,Math.PI*2);c.clip();const ang=2*Math.atan2(b.orientation?.[2]||0,b.orientation?.[3]||1);c.translate(s.x,s.y);c.rotate(ang*.38);const band=c.createLinearGradient(0,-r*.43,0,r*.43);band.addColorStop(0,'rgba(0,0,0,.22)');band.addColorStop(.12,base);band.addColorStop(.52,base);band.addColorStop(.88,base);band.addColorStop(1,'rgba(0,0,0,.33)');c.fillStyle=band;c.fillRect(-r*1.2,-r*.40,r*2.4,r*.80);c.fillStyle='rgba(255,255,255,.15)';c.fillRect(-r*1.2,-r*.38,r*2.4,r*.08);c.restore();}
    c.strokeStyle='rgba(0,0,0,.50)';c.lineWidth=Math.max(1,r*.07);c.beginPath();c.arc(s.x,s.y,r,0,Math.PI*2);c.stroke();c.strokeStyle='rgba(210,246,255,.18)';c.lineWidth=Math.max(.7,r*.035);c.beginPath();c.arc(s.x,s.y,r*.91,-2.65,-.30);c.stroke();
    const n=b.number||0;if(n>0){const v=rotateVec(b.orientation||[0,0,0,1],[0,1,0]);if(v[1]>-.15){const vis=clamp((v[1]+.15)/1.15,.18,1),ox=v[2]*r*.47,oy=-v[0]*r*.47;c.save();c.translate(s.x+ox,s.y+oy);c.scale(1,Math.max(.28,vis));c.shadowColor='rgba(0,0,0,.35)';c.shadowBlur=2;c.fillStyle='#fffdf6';c.beginPath();c.arc(0,0,r*.39,0,Math.PI*2);c.fill();c.shadowColor='transparent';c.strokeStyle='rgba(0,0,0,.28)';c.lineWidth=1;c.stroke();c.fillStyle='#10131a';c.font=`1000 ${Math.max(7,r*.48)}px Arial`;c.textAlign='center';c.textBaseline='middle';c.fillText(String(n),0,.5);c.restore();}}
    this.#gloss(c,s,r);c.restore();}
  #snookerBall(c,b,s,r){c.save();this.#ballShadow(c,s,r);const edge=b.name==='Black'?'#000':b.kind==='red'?'#650817':b.color;const g=c.createRadialGradient(s.x-r*.39,s.y-r*.45,r*.03,s.x+r*.12,s.y+r*.16,r*1.16);g.addColorStop(0,'#fff');g.addColorStop(.075,'rgba(255,255,255,.98)');g.addColorStop(.16,b.color);g.addColorStop(.58,b.color);g.addColorStop(.82,edge);g.addColorStop(1,'#06090c');c.fillStyle=g;c.beginPath();c.arc(s.x,s.y,r,0,Math.PI*2);c.fill();c.strokeStyle='rgba(0,0,0,.50)';c.lineWidth=Math.max(1,r*.07);c.stroke();c.strokeStyle='rgba(210,247,255,.16)';c.lineWidth=Math.max(.7,r*.034);c.beginPath();c.arc(s.x,s.y,r*.91,-2.62,-.32);c.stroke();this.#gloss(c,s,r);c.restore();}
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

    const tipGap=r+7+off,clearWorld=this.#cueBackClearance(),maxCueLen=L.cloth.w*.48,availablePx=Math.max(0,clearWorld*L.scale-tipGap-3),cueLen=Math.min(maxCueLen,availablePx),tipX=p.x-sd.x*tipGap,tipY=p.y-sd.y*tipGap,buttX=tipX-sd.x*cueLen,buttY=tipY-sd.y*cueLen;
    c.save();c.lineCap='round';
    // Cue shadow.
    c.strokeStyle='rgba(0,0,0,.58)';c.lineWidth=11;c.beginPath();c.moveTo(tipX+2.8,tipY+3.6);c.lineTo(buttX+2.8,buttY+3.6);c.stroke();
    // Main shaft / butt material.
    const g=c.createLinearGradient(tipX,tipY,buttX,buttY);g.addColorStop(0,'#f4e4b5');g.addColorStop(.34,'#d8b46b');g.addColorStop(.355,'#f8fbff');g.addColorStop(.385,'#90a7b8');g.addColorStop(.41,'#d8f4ff');g.addColorStop(.44,'#5bd3ef');g.addColorStop(.51,'#0e6e9c');g.addColorStop(.59,'#e8bd43');g.addColorStop(.64,'#5b2d16');g.addColorStop(.74,'#9a4426');g.addColorStop(.88,'#241631');g.addColorStop(1,'#080b16');c.strokeStyle=g;c.lineWidth=7.3;c.beginPath();c.moveTo(tipX,tipY);c.lineTo(buttX,buttY);c.stroke();
    // Clear-coat highlight along cue length.
    c.strokeStyle='rgba(255,255,255,.44)';c.lineWidth=1.15;c.beginPath();c.moveTo(tipX-sd.y*1.3,tipY+sd.x*1.3);c.lineTo(buttX-sd.y*1.3,buttY+sd.x*1.3);c.stroke();
    // Ferrule + chalked tip.
    const ferr=8;c.strokeStyle='#fff4d9';c.lineWidth=7.7;c.beginPath();c.moveTo(tipX,tipY);c.lineTo(tipX-sd.x*ferr,tipY-sd.y*ferr);c.stroke();c.strokeStyle='#55c9e6';c.lineWidth=7.9;c.beginPath();c.moveTo(tipX+sd.x*.7,tipY+sd.y*.7);c.lineTo(tipX+sd.x*3.2,tipY+sd.y*3.2);c.stroke();
    // Joint rings and wrapped butt bands.
    const ring=(t,col,w=1.6)=>{const x=tipX+(buttX-tipX)*t,y=tipY+(buttY-tipY)*t,nx=-sd.y,ny=sd.x;c.strokeStyle=col;c.lineWidth=w;c.beginPath();c.moveTo(x-nx*4.2,y-ny*4.2);c.lineTo(x+nx*4.2,y+ny*4.2);c.stroke();};ring(.36,'rgba(255,255,255,.95)',2);ring(.405,'rgba(23,33,42,.9)',1.8);ring(.59,'#f7d467',2);ring(.64,'rgba(255,255,255,.65)',1.3);for(let t=.77;t<.95;t+=.035)ring(t,t%0.07<.035?'rgba(181,81,52,.8)':'rgba(30,17,35,.78)',1.05);c.restore();
  }
  #proAim(c,L){
    if(!this.proAimEnabled||!this.proAimAllowed||this.ballInHand||this.aiThinking||!this.world.allStopped()||this.stroke)return;
    const result=this.proAimPredictor.predict(this.world,this.cue,this.mobileOptimized?{sampleEvery:4}:{sampleEvery:2});if(!result)return;
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
  #staticBase(c,w,h,L,dpr){const key=`${this.canvas.width}x${this.canvas.height}|${w}x${h}|${this.gameMode}|${this.quality}|${this.mobileOptimized?1:0}`;if(!this._staticLayer||this._staticKey!==key){this.#background(c,w,h);this.#table(c,L);const layer=document.createElement('canvas');layer.width=this.canvas.width;layer.height=this.canvas.height;layer.getContext('2d',{alpha:false}).drawImage(this.canvas,0,0);this._staticLayer=layer;this._staticKey=key;return;}c.save();c.setTransform(1,0,0,1,0,0);c.drawImage(this._staticLayer,0,0);c.restore();}
  render(){const {w,h,dpr}=this.#resize(),c=this.ctx,L=this.#layout(w,h),now=performance.now(),strokeOffset=this.advanceStroke(now);c.clearRect(0,0,w,h);this.#staticBase(c,w,h,L,dpr);this.#proAim(c,L);this.#guideCue(c,L,strokeOffset);this.#balls(c,L);this.#targetAssist(c,L);this.#aimPointer(c,now);this.#bursts(c,now);this.#hints(c,L);this.#proAimIndicator(c,w,h);}
}
