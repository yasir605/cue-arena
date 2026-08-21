// Cue Arena v5.7.1 browser-native audio engine.
// All SFX are synthesized into AudioBuffers in the browser on first user gesture.
// No sound assets are fetched and no server message is required to trigger local SFX.
export class AudioEngine {
  constructor(){
    this.ctx=null;this.input=null;this.master=null;this.compressor=null;this.limiter=null;this.output=null;
    this.room=null;this.roomSend=null;this.roomReturn=null;this.softClip=null;
    this.enabled=true;this.volume=4.2;this.unlocked=false;this.bank=null;this.variant=0;
    this.rollSource=null;this.rollFilter=null;this.rollGain=null;
    this.lastCollision=0;this.lastCushion=0;this.lastTurn=0;
  }
  unlock(){
    if(!this.enabled)return;
    try{
      if(!this.ctx){
        const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
        try{this.ctx=new AC({latencyHint:'interactive'});}catch(_){this.ctx=new AC();}
        this.input=this.ctx.createGain();
        const hp=this.ctx.createBiquadFilter();hp.type='highpass';hp.frequency.value=34;hp.Q.value=.55;
        const low=this.ctx.createBiquadFilter();low.type='lowshelf';low.frequency.value=128;low.gain.value=3.4;
        const body=this.ctx.createBiquadFilter();body.type='peaking';body.frequency.value=620;body.Q.value=.72;body.gain.value=1.35;
        const presence=this.ctx.createBiquadFilter();presence.type='peaking';presence.frequency.value=2850;presence.Q.value=.78;presence.gain.value=2.8;
        const air=this.ctx.createBiquadFilter();air.type='highshelf';air.frequency.value=6100;air.gain.value=.65;
        this.master=this.ctx.createGain();this.master.gain.value=this.enabled?this.volume:0;
        this.softClip=this.ctx.createWaveShaper();this.softClip.oversample='4x';this.softClip.curve=this.#softClipCurve(32768,1.55);
        this.compressor=this.ctx.createDynamicsCompressor();
        this.compressor.threshold.value=-20;this.compressor.knee.value=12;this.compressor.ratio.value=4.2;this.compressor.attack.value=.0015;this.compressor.release.value=.12;
        this.limiter=this.ctx.createDynamicsCompressor();
        this.limiter.threshold.value=-2.2;this.limiter.knee.value=0;this.limiter.ratio.value=20;this.limiter.attack.value=.0007;this.limiter.release.value=.06;
        this.output=this.ctx.createGain();this.output.gain.value=.985;
        this.input.connect(hp);hp.connect(low);low.connect(body);body.connect(presence);presence.connect(air);air.connect(this.master);this.master.connect(this.softClip);this.softClip.connect(this.compressor);this.compressor.connect(this.limiter);this.limiter.connect(this.output);this.output.connect(this.ctx.destination);
        this.#buildRoom();
        this.#buildBank();
        // Continuous rolling noise intentionally disabled: it sounded like air/wind.
      }
      if(this.ctx.state==='suspended')this.ctx.resume();
      this.unlocked=true;
    }catch(_){/* audio must never block gameplay */}
  }
  setVolume(v){
    this.volume=Math.max(0,Math.min(4.2,Number(v)||0));
    if(this.master&&this.ctx)this.master.gain.setTargetAtTime(this.enabled?this.volume:0,this.ctx.currentTime,.012);
  }
  setEnabled(v){
    this.enabled=!!v;
    if(this.master&&this.ctx)this.master.gain.setTargetAtTime(this.enabled?this.volume:0,this.ctx.currentTime,.008);
  }
  #softClipCurve(n,drive){const c=new Float32Array(n),norm=Math.tanh(drive);for(let i=0;i<n;i++){const x=i*2/(n-1)-1;c[i]=Math.tanh(x*drive)/norm;}return c;}
  #rng(seed){let s=seed>>>0;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};}
  #modalBuffer({duration=.1,modes=[[1000,1,50]],noise=.04,noiseDecay=40,seed=1,attack=.00045}={}){
    const sr=this.ctx.sampleRate,len=Math.max(8,Math.floor(sr*duration)),buf=this.ctx.createBuffer(1,len,sr),d=buf.getChannelData(0),rnd=this.#rng(seed);
    let peak=.0001;const phases=modes.map(()=>rnd()*Math.PI*2);
    for(let i=0;i<len;i++){
      const t=i/sr,atk=Math.min(1,t/Math.max(.00005,attack));let v=0;
      for(let m=0;m<modes.length;m++){const [f,a,decay]=modes[m];v+=Math.sin(Math.PI*2*f*t+phases[m])*a*Math.exp(-decay*t);}
      if(noise)v+=(rnd()*2-1)*noise*Math.exp(-noiseDecay*t);
      v*=atk;d[i]=v;peak=Math.max(peak,Math.abs(v));
    }
    const scale=.88/peak;for(let i=0;i<len;i++)d[i]*=scale;return buf;
  }
  #noiseBuffer(duration=1,seed=1){
    const sr=this.ctx.sampleRate,len=Math.max(8,Math.floor(sr*duration)),buf=this.ctx.createBuffer(1,len,sr),d=buf.getChannelData(0),rnd=this.#rng(seed);let prev=0;
    for(let i=0;i<len;i++){const white=rnd()*2-1;prev=prev*.72+white*.28;d[i]=white*.48+prev*.52;}return buf;
  }
  #buildBank(){
    const variants=(count,fn)=>Array.from({length:count},(_,i)=>fn(i));
    this.bank={
      cue:variants(5,i=>this.#modalBuffer({duration:.105,seed:101+i*31,modes:[[1320+i*13,.95,63],[2470-i*17,.55,92],[540+i*7,.36,34],[215,.24,24]],noise:.16,noiseDecay:105})),
      ball:variants(8,i=>this.#modalBuffer({duration:.075,seed:401+i*47,modes:[[1910+i*19,1,92],[3140-i*23,.52,122],[1040+i*11,.34,74],[470,.12,52]],noise:.075,noiseDecay:155})),
      cushion:variants(5,i=>this.#modalBuffer({duration:.155,seed:701+i*37,modes:[[158+i*4,1,24],[326+i*8,.46,34],[618-i*7,.22,47],[910,.08,64]],noise:.19,noiseDecay:44})),
      pocket:variants(5,i=>this.#modalBuffer({duration:.34,seed:901+i*29,modes:[[106+i*2,1,13],[218+i*5,.52,22],[437-i*6,.23,32],[760,.09,55]],noise:.32,noiseDecay:18})),
      ui:variants(4,i=>this.#modalBuffer({duration:.055,seed:1201+i*19,modes:[[1120+i*45,1,92],[1730+i*37,.33,145]],noise:.025,noiseDecay:180})),
      roll:this.#noiseBuffer(1.15,20257),
      cloth:this.#noiseBuffer(.35,7777)
    };
  }
  #buildRoom(){
    const sr=this.ctx.sampleRate,dur=.23,len=Math.floor(sr*dur),buf=this.ctx.createBuffer(2,len,sr),rnd=this.#rng(57291);
    for(let ch=0;ch<2;ch++){const d=buf.getChannelData(ch);let lp=0;for(let i=0;i<len;i++){const t=i/sr,env=Math.exp(-t*19.5),w=rnd()*2-1;lp=lp*.62+w*.38;d[i]=(w*.38+lp*.62)*env*.34;}}
    this.room=this.ctx.createConvolver();this.room.buffer=buf;this.roomSend=this.ctx.createGain();this.roomSend.gain.value=1;this.roomReturn=this.ctx.createGain();this.roomReturn.gain.value=.14;this.roomSend.connect(this.room);this.room.connect(this.roomReturn);this.roomReturn.connect(this.input);
  }
  #route(node,pan=0,reverb=.03){
    if(!node||!this.input)return;
    let out=node;
    if(this.ctx.createStereoPanner){const p=this.ctx.createStereoPanner();p.pan.value=Math.max(-.82,Math.min(.82,pan));node.connect(p);out=p;}
    out.connect(this.input);
    if(reverb>0&&this.roomSend){const s=this.ctx.createGain();s.gain.value=Math.max(0,Math.min(.35,reverb));out.connect(s);s.connect(this.roomSend);}
  }
  #sample(buffer,{gain=.08,rate=1,pan=0,delay=0,lowpass=0,highpass=0,reverb=.035}={}){
    if(!this.ctx||!buffer||!this.enabled)return;const t=this.ctx.currentTime+Math.max(0,delay),src=this.ctx.createBufferSource(),g=this.ctx.createGain();src.buffer=buffer;src.playbackRate.value=Math.max(.55,Math.min(1.7,rate));g.gain.setValueAtTime(Math.max(.0001,gain),t);src.connect(g);let out=g;
    if(highpass>0){const f=this.ctx.createBiquadFilter();f.type='highpass';f.frequency.value=highpass;out.connect(f);out=f;}
    if(lowpass>0){const f=this.ctx.createBiquadFilter();f.type='lowpass';f.frequency.value=lowpass;out.connect(f);out=f;}
    this.#route(out,pan,reverb);src.start(t);
  }
  #tone({freq=440,freqEnd=null,duration=.07,gain=.08,type='sine',detune=0,attack=.0015,delay=0,pan=0,reverb=.03}={}){
    if(!this.ctx||!this.input||!this.enabled)return;const t=this.ctx.currentTime+Math.max(0,delay),o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type=type;o.frequency.setValueAtTime(Math.max(20,freq),t);o.detune.value=detune;if(freqEnd!=null)o.frequency.exponentialRampToValueAtTime(Math.max(20,freqEnd),t+Math.max(.01,duration*.86));g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(Math.max(.0002,gain),t+Math.max(.0004,attack));g.gain.exponentialRampToValueAtTime(.0001,t+Math.max(attack+.004,duration));o.connect(g);this.#route(g,pan,reverb);o.start(t);o.stop(t+duration+.025);
  }
  #noise({duration=.08,gain=.045,cutoff=2200,filterType='lowpass',q=.65,delay=0,pan=0,attack=.0007,reverb=.02}={}){
    if(!this.ctx||!this.input||!this.enabled)return;const buf=this.bank?.cloth||this.#noiseBuffer(Math.max(.1,duration),613);const src=this.ctx.createBufferSource(),filter=this.ctx.createBiquadFilter(),g=this.ctx.createGain(),t=this.ctx.currentTime+Math.max(0,delay);src.buffer=buf;filter.type=filterType;filter.frequency.value=cutoff;filter.Q.value=q;g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(Math.max(.0002,gain),t+attack);g.gain.exponentialRampToValueAtTime(.0001,t+duration);src.connect(filter);filter.connect(g);this.#route(g,pan,reverb);src.start(t,0,Math.min(duration,buf.duration));
  }
  #pick(group){const a=this.bank?.[group];if(!Array.isArray(a)||!a.length)return null;this.variant=(this.variant+1)%9973;return a[this.variant%a.length];}
  #startRollingBed(){
    // Disabled in v5.7.1. A looped broadband texture reads as wind/air on
    // phone and laptop speakers. Keep the shot bed silent between impacts.
    this.rollSource=null;this.rollFilter=null;this.rollGain=null;
  }
  ui(){this.unlock();const pan=(Math.random()-.5)*.12;this.#sample(this.#pick('ui'),{gain:.045,rate:.98+Math.random()*.06,pan,reverb:.018});}
  cueStrike(power=.5){
    this.unlock();const p=Math.max(.05,Math.min(1,power)),pan=(Math.random()-.5)*.08;
    // Browser-generated multi-layer cue recording: tip/chalk transient, ash shaft, butt/body resonance.
    this.#sample(this.#pick('cue'),{gain:.115+.105*p,rate:1.09-.15*p+(Math.random()-.5)*.018,pan,highpass:75,reverb:.055});
    this.#tone({freq:224-34*p,freqEnd:156-20*p,duration:.125+.055*p,gain:.05+.072*p,type:'sine',attack:.0007,pan:-pan*.35,reverb:.07});
    this.#noise({duration:.028+.016*p,gain:.034+.038*p,cutoff:4300+1900*p,filterType:'highpass',q:.25,pan:-pan,reverb:.015});
  }
  ballCollision(impulse=.1){
    if(!this.ctx)return;const now=performance.now();if(now-this.lastCollision<10)return;this.lastCollision=now;const k=Math.max(0,Math.min(1,impulse/.55)),pan=(Math.random()-.5)*.4;
    this.#sample(this.#pick('ball'),{gain:.055+.105*k,rate:1.11-.14*k+(Math.random()-.5)*.025,pan,highpass:180,reverb:.035+.025*k});
    if(k>.42)this.#tone({freq:690-110*k,freqEnd:520-70*k,duration:.04+.018*k,gain:.018+.028*k,type:'triangle',attack:.0005,pan:-pan*.45,reverb:.025});
  }
  cushion(impulse=.1){
    if(!this.ctx)return;const now=performance.now();if(now-this.lastCushion<16)return;this.lastCushion=now;const k=Math.max(0,Math.min(1,impulse/.6)),pan=(Math.random()-.5)*.3;
    this.#sample(this.#pick('cushion'),{gain:.064+.105*k,rate:1.04-.1*k+(Math.random()-.5)*.02,pan,lowpass:2350,reverb:.055});
    this.#noise({duration:.038+.025*k,gain:.014+.032*k,cutoff:980+520*k,filterType:'lowpass',q:.48,pan,reverb:.025});
  }
  pocket(ball){
    this.unlock();const cue=ball?.name==='Cue'||ball?.kind==='cue',pan=(Math.random()-.5)*.28;
    this.#sample(this.#pick('pocket'),{gain:cue?.17:.19,rate:(cue?.93:1)+(Math.random()-.5)*.018,pan,lowpass:2550,reverb:.105});
    this.#sample(this.#pick('ball'),{gain:.047,rate:.78,pan:-pan*.3,delay:.006,lowpass:1850,reverb:.07});
    this.#noise({duration:.18,gain:.045,cutoff:760,filterType:'lowpass',q:.52,delay:.022,pan:-pan,reverb:.12});
  }
  offTable(){this.unlock();this.#sample(this.#pick('cushion'),{gain:.18,rate:.72,lowpass:980,reverb:.12});this.#tone({freq:102,freqEnd:62,duration:.34,gain:.09,type:'triangle',attack:.0008,reverb:.11});}
  foul(){this.unlock();this.#tone({freq:349,freqEnd:262,duration:.18,gain:.082,type:'triangle',attack:.001,reverb:.065});this.#tone({freq:233,freqEnd:174,duration:.27,gain:.084,type:'triangle',attack:.001,delay:.085,reverb:.07});this.#tone({freq:116.5,duration:.2,gain:.038,type:'sine',delay:.09,reverb:.055});}
  score(value=1){this.unlock();const v=Math.max(1,Math.min(7,Number(value)||1)),base=622+v*23;this.#tone({freq:base,duration:.105,gain:.058,type:'sine',attack:.001,reverb:.08});this.#tone({freq:base*1.498,duration:.13,gain:.034,type:'sine',delay:.036,reverb:.09});this.#sample(this.#pick('ui'),{gain:.025,rate:1.08,delay:.006,reverb:.025});}
  turn(){this.unlock();const now=performance.now();if(now-this.lastTurn<160)return;this.lastTurn=now;this.#tone({freq:466,freqEnd:554,duration:.085,gain:.035,type:'sine',attack:.001,reverb:.06});this.#tone({freq:699,duration:.075,gain:.022,type:'triangle',delay:.045,reverb:.055});}
  frameWin(){this.unlock();[392,494,587,784].forEach((f,i)=>{this.#tone({freq:f,duration:.3,gain:.06,type:'sine',attack:.002,delay:i*.078,pan:(i-1.5)*.08,reverb:.16});this.#tone({freq:f*2,duration:.18,gain:.018,type:'triangle',attack:.001,delay:i*.078+.018,pan:(1.5-i)*.06,reverb:.13});});this.#noise({duration:.3,gain:.018,cutoff:4800,filterType:'highpass',q:.3,delay:.16,reverb:.18});}
  frameLose(){this.unlock();this.#tone({freq:294,freqEnd:220,duration:.25,gain:.055,type:'triangle',attack:.002,reverb:.11});this.#tone({freq:196,freqEnd:147,duration:.36,gain:.063,type:'sine',attack:.002,delay:.11,reverb:.13});}
  updateRolling(world){
    // No continuous broadband rolling layer: removes the reported air/wind hiss.
    if(this.rollGain&&this.ctx)this.rollGain.gain.setTargetAtTime(0,this.ctx.currentTime,.015);
  }
}
