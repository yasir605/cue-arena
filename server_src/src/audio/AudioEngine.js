export class AudioEngine {
  constructor(){
    this.ctx=null;this.input=null;this.master=null;this.compressor=null;this.limiter=null;this.output=null;
    this.enabled=true;this.volume=3;this.unlocked=false;
    this.lastRoll=0;this.lastCollision=0;this.lastCushion=0;this.lastTurn=0;
  }
  unlock(){
    if(!this.enabled)return;
    try{
      if(!this.ctx){
        const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
        try{this.ctx=new AC({latencyHint:'interactive'});}catch(_){this.ctx=new AC();}
        this.input=this.ctx.createGain();
        const low=this.ctx.createBiquadFilter();low.type='lowshelf';low.frequency.value=145;low.gain.value=2.8;
        const presence=this.ctx.createBiquadFilter();presence.type='peaking';presence.frequency.value=2450;presence.Q.value=.82;presence.gain.value=2.2;
        this.master=this.ctx.createGain();this.master.gain.value=this.enabled?this.volume:0;
        this.compressor=this.ctx.createDynamicsCompressor();
        this.compressor.threshold.value=-18;this.compressor.knee.value=16;this.compressor.ratio.value=5.5;this.compressor.attack.value=.003;this.compressor.release.value=.16;
        this.limiter=this.ctx.createDynamicsCompressor();
        this.limiter.threshold.value=-3;this.limiter.knee.value=0;this.limiter.ratio.value=20;this.limiter.attack.value=.001;this.limiter.release.value=.075;
        this.output=this.ctx.createGain();this.output.gain.value=.94;
        this.input.connect(low);low.connect(presence);presence.connect(this.master);this.master.connect(this.compressor);this.compressor.connect(this.limiter);this.limiter.connect(this.output);this.output.connect(this.ctx.destination);
      }
      if(this.ctx.state==='suspended')this.ctx.resume();
      this.unlocked=true;
    }catch(_){/* audio must never block gameplay */}
  }
  setVolume(v){
    this.volume=Math.max(0,Math.min(3,Number(v)||0));
    if(this.master&&this.ctx)this.master.gain.setTargetAtTime(this.enabled?this.volume:0,this.ctx.currentTime,.018);
  }
  setEnabled(v){
    this.enabled=!!v;
    if(this.master&&this.ctx)this.master.gain.setTargetAtTime(this.enabled?this.volume:0,this.ctx.currentTime,.012);
  }
  #route(node,pan=0){
    if(!node||!this.input)return;
    if(this.ctx.createStereoPanner){const p=this.ctx.createStereoPanner();p.pan.value=Math.max(-.8,Math.min(.8,pan));node.connect(p);p.connect(this.input);}else node.connect(this.input);
  }
  #tone({freq=440,freqEnd=null,duration=.07,gain=.08,type='sine',detune=0,attack=.003,delay=0,pan=0,filter=null,q=.8}={}){
    if(!this.ctx||!this.input||!this.enabled)return;
    const t=this.ctx.currentTime+Math.max(0,delay),o=this.ctx.createOscillator(),g=this.ctx.createGain();
    o.type=type;o.frequency.setValueAtTime(Math.max(20,freq),t);o.detune.value=detune;
    if(freqEnd!=null)o.frequency.exponentialRampToValueAtTime(Math.max(20,freqEnd),t+Math.max(.01,duration*.86));
    g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(Math.max(.0002,gain),t+Math.max(.001,attack));g.gain.exponentialRampToValueAtTime(.0001,t+Math.max(attack+.004,duration));
    o.connect(g);
    if(filter){const f=this.ctx.createBiquadFilter();f.type=filter.type||'lowpass';f.frequency.value=filter.freq||2200;f.Q.value=filter.q??q;g.connect(f);this.#route(f,pan);}else this.#route(g,pan);
    o.start(t);o.stop(t+duration+.035);
  }
  #noise({duration=.08,gain=.045,cutoff=2200,filterType='lowpass',q=.65,delay=0,pan=0,attack=.001}={}){
    if(!this.ctx||!this.input||!this.enabled)return;
    const sr=this.ctx.sampleRate,len=Math.max(1,Math.floor(sr*duration)),buf=this.ctx.createBuffer(1,len,sr),d=buf.getChannelData(0);
    for(let i=0;i<len;i++){const env=1-i/len;d[i]=(Math.random()*2-1)*env*env;}
    const src=this.ctx.createBufferSource(),filter=this.ctx.createBiquadFilter(),g=this.ctx.createGain(),t=this.ctx.currentTime+Math.max(0,delay);
    src.buffer=buf;filter.type=filterType;filter.frequency.value=cutoff;filter.Q.value=q;
    g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(Math.max(.0002,gain),t+attack);g.gain.exponentialRampToValueAtTime(.0001,t+duration);
    src.connect(filter);filter.connect(g);this.#route(g,pan);src.start(t);src.stop(t+duration+.02);
  }
  #impactBody({strength=.5,base=180,delay=0,pan=0}={}){
    const k=Math.max(0,Math.min(1,strength));
    this.#tone({freq:base+24*(1-k),freqEnd:base*.72,duration:.075+.035*k,gain:.035+.055*k,type:'triangle',attack:.0015,delay,pan});
    this.#tone({freq:base*2.3,freqEnd:base*1.75,duration:.035+.02*k,gain:.018+.03*k,type:'sine',attack:.001,delay:delay+.002,pan:-pan*.45});
  }
  ui(){
    this.unlock();const pan=(Math.random()-.5)*.16;
    this.#tone({freq:1040,freqEnd:880,duration:.038,gain:.032,type:'sine',attack:.001,pan});
    this.#tone({freq:1560,duration:.025,gain:.014,type:'triangle',delay:.006,pan:-pan});
  }
  cueStrike(power=.5){
    this.unlock();const p=Math.max(.05,Math.min(1,power)),pan=(Math.random()-.5)*.1;
    // Tip crack + shaft/body resonance + tiny chalk transient.
    this.#tone({freq:1480-310*p,freqEnd:910-150*p,duration:.034+.018*p,gain:.055+.075*p,type:'triangle',attack:.0008,pan});
    this.#impactBody({strength:p,base:205-42*p,delay:.002,pan:-pan*.45});
    this.#tone({freq:480-95*p,freqEnd:345-55*p,duration:.09+.035*p,gain:.032+.045*p,type:'sine',delay:.003,pan});
    this.#noise({duration:.026+.018*p,gain:.025+.035*p,cutoff:5200,filterType:'highpass',q:.3,delay:.001,pan:-pan});
  }
  ballCollision(impulse=.1){
    if(!this.ctx)return;const now=performance.now();if(now-this.lastCollision<14)return;this.lastCollision=now;
    const k=Math.max(0,Math.min(1,impulse/.55)),pan=(Math.random()-.5)*.42;
    // Ceramic click: crisp shell plus a short dense body resonance.
    this.#tone({freq:1850-560*k,freqEnd:1240-300*k,duration:.023+.022*k,gain:.025+.058*k,type:'sine',attack:.0006,detune:(Math.random()-.5)*35,pan});
    this.#tone({freq:820-180*k,freqEnd:650-120*k,duration:.034+.025*k,gain:.018+.038*k,type:'triangle',attack:.0008,delay:.001,pan:-pan*.4});
    if(k>.24)this.#noise({duration:.015+.013*k,gain:.007+.022*k,cutoff:4300+1700*k,filterType:'bandpass',q:1.1,pan});
  }
  cushion(impulse=.1){
    if(!this.ctx)return;const now=performance.now();if(now-this.lastCushion<20)return;this.lastCushion=now;
    const k=Math.max(0,Math.min(1,impulse/.6)),pan=(Math.random()-.5)*.34;
    this.#impactBody({strength:k,base:148-22*k,pan});
    this.#tone({freq:315-45*k,freqEnd:235-25*k,duration:.06+.03*k,gain:.023+.045*k,type:'triangle',attack:.0012,pan:-pan*.35});
    this.#noise({duration:.042+.03*k,gain:.012+.026*k,cutoff:1150+420*k,filterType:'lowpass',q:.55,pan});
  }
  pocket(ball){
    this.unlock();const cue=ball?.name==='Cue'||ball?.kind==='cue',low=cue?98:112,pan=(Math.random()-.5)*.32;
    // Jaw/rim tick -> deep leather pocket body -> cloth/net settling tail.
    this.#tone({freq:760,freqEnd:430,duration:.045,gain:.032,type:'triangle',attack:.0008,pan});
    this.#tone({freq:low,freqEnd:low*.72,duration:.26,gain:.09,type:'sine',attack:.002,delay:.012,pan:-pan*.25});
    this.#tone({freq:low*1.78,freqEnd:low*1.25,duration:.16,gain:.043,type:'triangle',delay:.016,pan});
    this.#noise({duration:.19,gain:.05,cutoff:840,filterType:'lowpass',q:.7,delay:.012,pan:-pan});
    this.#noise({duration:.075,gain:.022,cutoff:2600,filterType:'bandpass',q:.9,delay:.055,pan});
  }
  offTable(){
    this.unlock();
    this.#tone({freq:118,freqEnd:72,duration:.3,gain:.105,type:'triangle',attack:.001});
    this.#noise({duration:.16,gain:.052,cutoff:720,filterType:'lowpass',q:.5,delay:.004});
  }
  foul(){
    this.unlock();
    this.#tone({freq:335,freqEnd:245,duration:.19,gain:.072,type:'sawtooth',attack:.003});
    this.#tone({freq:214,freqEnd:156,duration:.29,gain:.072,type:'triangle',attack:.002,delay:.105});
    this.#tone({freq:107,duration:.22,gain:.032,type:'sine',delay:.12});
  }
  score(value=1){
    this.unlock();const v=Math.max(1,Math.min(7,Number(value)||1)),base=610+v*24;
    this.#tone({freq:base,duration:.105,gain:.047,type:'sine',attack:.002});
    this.#tone({freq:base*1.5,duration:.12,gain:.027,type:'sine',delay:.045});
    this.#tone({freq:base*2,duration:.07,gain:.012,type:'triangle',delay:.075});
  }
  turn(){
    this.unlock();const now=performance.now();if(now-this.lastTurn<180)return;this.lastTurn=now;
    this.#tone({freq:440,freqEnd:520,duration:.09,gain:.028,type:'sine',attack:.003});
    this.#tone({freq:660,duration:.08,gain:.018,type:'triangle',delay:.055});
  }
  frameWin(){
    this.unlock();
    [392,494,587,784].forEach((f,i)=>{
      this.#tone({freq:f,duration:.28,gain:.047,type:'sine',attack:.004,delay:i*.085,pan:(i-1.5)*.09});
      this.#tone({freq:f*2,duration:.18,gain:.015,type:'triangle',attack:.002,delay:i*.085+.025,pan:(1.5-i)*.07});
    });
    this.#noise({duration:.28,gain:.014,cutoff:5000,filterType:'highpass',q:.35,delay:.18});
  }
  frameLose(){
    this.unlock();
    this.#tone({freq:294,freqEnd:220,duration:.24,gain:.045,type:'triangle',attack:.004});
    this.#tone({freq:196,freqEnd:147,duration:.34,gain:.05,type:'sine',attack:.004,delay:.13});
  }
  updateRolling(world){
    if(!this.ctx||!this.enabled)return;const now=performance.now();if(now-this.lastRoll<82)return;this.lastRoll=now;
    let max=0,moving=0;for(const b of world.balls)if(!b.potted){const s=b.speed();max=Math.max(max,s);if(s>.1)moving++;}
    if(max>.07){const k=Math.min(1,max/3.5),density=Math.min(1,moving/8),pan=(Math.random()-.5)*.3;
      this.#noise({duration:.062,gain:.0035+.012*k+.004*density,cutoff:380+760*k,filterType:'bandpass',q:.55,pan});
    }
  }
}
