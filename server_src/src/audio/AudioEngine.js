export class AudioEngine {
  constructor(){
    this.ctx=null; this.master=null; this.enabled=true; this.volume=0.78; this.unlocked=false;
    this.lastRoll=0; this.lastCollision=0; this.lastCushion=0;
  }
  unlock(){
    if(!this.enabled) return;
    try{
      if(!this.ctx){
        const AC=window.AudioContext||window.webkitAudioContext;
        if(!AC) return;
        this.ctx=new AC();
        this.master=this.ctx.createGain();
        this.master.gain.value=this.volume;
        this.master.connect(this.ctx.destination);
      }
      if(this.ctx.state==='suspended') this.ctx.resume();
      this.unlocked=true;
    }catch(_){ /* audio is an enhancement, never block play */ }
  }
  setVolume(v){ this.volume=Math.max(0,Math.min(1,v)); if(this.master) this.master.gain.setTargetAtTime(this.volume,this.ctx.currentTime,.02); }
  setEnabled(v){ this.enabled=!!v; if(this.master) this.master.gain.value=this.enabled?this.volume:0; }
  #tone({freq=440,duration=.07,gain=.08,type='sine',detune=0,attack=.003}={}){
    if(!this.ctx||!this.master||!this.enabled) return;
    const t=this.ctx.currentTime,o=this.ctx.createOscillator(),g=this.ctx.createGain();
    o.type=type; o.frequency.value=freq; o.detune.value=detune;
    g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(gain,t+attack); g.gain.exponentialRampToValueAtTime(.0001,t+duration);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t+duration+.02);
  }
  #noise({duration=.08,gain=.045,cutoff=2200}={}){
    if(!this.ctx||!this.master||!this.enabled) return;
    const sr=this.ctx.sampleRate, len=Math.max(1,Math.floor(sr*duration)), buf=this.ctx.createBuffer(1,len,sr),d=buf.getChannelData(0);
    for(let i=0;i<len;i++) d[i]=(Math.random()*2-1)*(1-i/len);
    const src=this.ctx.createBufferSource(),filter=this.ctx.createBiquadFilter(),g=this.ctx.createGain();
    src.buffer=buf; filter.type='lowpass'; filter.frequency.value=cutoff; g.gain.value=gain;
    src.connect(filter); filter.connect(g); g.connect(this.master); src.start();
  }
  ui(){ this.unlock(); this.#tone({freq:720,duration:.035,gain:.025,type:'sine',detune:(Math.random()-.5)*35}); }
  cueStrike(power=.5){
    this.unlock(); const p=Math.max(.05,Math.min(1,power));
    this.#tone({freq:540-120*p,duration:.045+.035*p,gain:.055+.09*p,type:'triangle',detune:(Math.random()-.5)*18});
    this.#noise({duration:.028+.025*p,gain:.018+.025*p,cutoff:3400});
  }
  ballCollision(impulse=.1){
    if(!this.ctx) return; const now=performance.now(); if(now-this.lastCollision<18) return; this.lastCollision=now;
    const k=Math.max(0,Math.min(1,impulse/.55));
    this.#tone({freq:1050-260*k,duration:.027+.035*k,gain:.025+.085*k,type:'sine',detune:(Math.random()-.5)*70});
    if(k>.46) this.#noise({duration:.022,gain:.012+.018*k,cutoff:5000});
  }
  cushion(impulse=.1){
    if(!this.ctx) return; const now=performance.now(); if(now-this.lastCushion<24) return; this.lastCushion=now;
    const k=Math.max(0,Math.min(1,impulse/.6));
    this.#tone({freq:240-55*k,duration:.055+.035*k,gain:.018+.07*k,type:'triangle',detune:(Math.random()-.5)*40});
    this.#noise({duration:.035+.025*k,gain:.012+.028*k,cutoff:1300});
  }
  pocket(ball){
    this.unlock(); const low=ball?.name==='Cue'?126:150;
    this.#tone({freq:low,duration:.18,gain:.09,type:'sine'});
    this.#tone({freq:low*1.48,duration:.11,gain:.04,type:'triangle',detune:(Math.random()-.5)*30});
    this.#noise({duration:.12,gain:.055,cutoff:900});
  }
  foul(){ this.unlock(); this.#tone({freq:250,duration:.18,gain:.07,type:'sawtooth'}); setTimeout(()=>this.#tone({freq:190,duration:.24,gain:.06,type:'triangle'}),90); }
  score(value=1){ this.unlock(); this.#tone({freq:520+value*34,duration:.12,gain:.055,type:'sine'}); }
  frameWin(){ this.unlock(); [392,494,587,784].forEach((f,i)=>setTimeout(()=>this.#tone({freq:f,duration:.24,gain:.055,type:'sine'}),i*90)); }
  updateRolling(world){
    if(!this.ctx||!this.enabled) return; const now=performance.now(); if(now-this.lastRoll<105) return; this.lastRoll=now;
    let max=0; for(const b of world.balls) if(!b.potted) max=Math.max(max,b.speed());
    if(max>.08){ const k=Math.min(1,max/3.5); this.#noise({duration:.075,gain:.002+.009*k,cutoff:340+620*k}); }
  }
}
