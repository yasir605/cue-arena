export class OnlineClient {
  constructor({onStatus,onMessage,onOpen,onClose}={}){
    this.ws=null;this.roomCode='';this.seat=null;this.playerId='';this.connected=false;this.ready=false;this.onStatus=onStatus;this.onMessage=onMessage;this.onOpen=onOpen;this.onClose=onClose;
    this.pending=new Map();this.pingMs=null;this.pingTimer=null;
  }
  url(){
    const p=new URLSearchParams(location.search);const override=p.get('ws');if(override)return override;
    if(location.protocol==='http:'||location.protocol==='https:')return `${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`;
    return 'ws://localhost:10000/ws';
  }
  connect(){
    if(this.ws&&this.ws.readyState<=1)return Promise.resolve();
    this.onStatus?.('CONNECTING');
    return new Promise((resolve,reject)=>{
      const ws=new WebSocket(this.url());this.ws=ws;
      const timer=setTimeout(()=>{try{ws.close();}catch(_){}reject(new Error('Connection timeout'));},8000);
      ws.addEventListener('open',()=>{clearTimeout(timer);this.connected=true;this.onStatus?.('ONLINE');clearInterval(this.pingTimer);this.pingTimer=setInterval(()=>this.send('ping',{t:Date.now()}),20000);this.send('ping',{t:Date.now()});this.onOpen?.();resolve();});
      ws.addEventListener('message',e=>{let msg;try{msg=JSON.parse(e.data);}catch(_){return;}this.#handle(msg);});
      ws.addEventListener('close',()=>{clearTimeout(timer);clearInterval(this.pingTimer);this.pingTimer=null;this.connected=false;this.ready=false;this.onStatus?.('OFFLINE');this.onClose?.();});
      ws.addEventListener('error',()=>{this.onStatus?.('NETWORK ERROR');});
    });
  }
  #handle(msg){
    if(msg.type==='pong'){this.pingMs=Math.max(0,Date.now()-(+msg.t||Date.now()));this.onStatus?.(`LIVE ${this.pingMs}ms`);return;}
    if(msg.type==='room_joined'){this.roomCode=msg.code||'';this.seat=msg.seat;this.playerId=msg.playerId||'';}
    if(msg.type==='room_ready')this.ready=true;
    if(msg.type==='room_waiting')this.ready=false;
    this.onMessage?.(msg);
  }
  send(type,payload={}){if(!this.ws||this.ws.readyState!==WebSocket.OPEN)return false;this.ws.send(JSON.stringify({type,...payload}));return true;}
  async createRoom({mode,name}){await this.connect();this.send('create_room',{mode,name});}
  async joinRoom({code,name}){await this.connect();this.send('join_room',{code:String(code||'').trim().toUpperCase(),name});}
  leave(){this.send('leave_room');this.roomCode='';this.seat=null;this.ready=false;}
  shot({angle,power,spinX,spinY,clientShotId}){return this.send('shot',{angle,power,spinX,spinY,clientShotId});}
  placeCue({x,z,preview=false}){return this.send(preview?'place_preview':'place_cue',{x,z});}
  rematch(){return this.send('rematch');}
}
