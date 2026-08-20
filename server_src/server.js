import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { GameRoom } from './gameRoom.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'web');
const PORT=Number(process.env.PORT||10000);const rooms=new Map();const wsRoom=new WeakMap();
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.ico':'image/x-icon'};
function code(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';for(let tries=0;tries<50;tries++){let s='';for(let i=0;i<5;i++)s+=chars[Math.floor(Math.random()*chars.length)];if(!rooms.has(s))return s;}return crypto.randomBytes(3).toString('hex').toUpperCase().slice(0,5);}
function send(ws,msg){if(ws.readyState===1)ws.send(JSON.stringify(msg));}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function finite(v,d=0){v=Number(v);return Number.isFinite(v)?v:d;}
function leave(ws,reason='left'){const room=wsRoom.get(ws);if(!room)return;const seat=room.remove(ws);wsRoom.delete(ws);if(room.players.every(p=>!p)){rooms.delete(room.code);return;}room.broadcast({type:'peer_left',seat,reason,snapshot:room.snapshot()});room.broadcast({type:'room_waiting',code:room.code});}
function safeFile(urlPath){let p=decodeURIComponent((urlPath||'/').split('?')[0]);if(p==='/'||!p)p='/index.html';const full=path.resolve(root,'.'+p);return full.startsWith(root)?full:null;}
const server=http.createServer((req,res)=>{if(req.url==='/health'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({ok:true,rooms:rooms.size,uptime:Math.round(process.uptime())}));}const full=safeFile(req.url);if(!full||!fs.existsSync(full)||fs.statSync(full).isDirectory()){res.writeHead(404);return res.end('Not found');}const name=path.basename(full);const noCache=name==='index.html'||name==='game.js'||name==='styles.css';const headers={'content-type':MIME[path.extname(full)]||'application/octet-stream','cache-control':noCache?'no-store, no-cache, must-revalidate, max-age=0':'public, max-age=3600'};if(noCache){headers.pragma='no-cache';headers.expires='0';}res.writeHead(200,headers);fs.createReadStream(full).pipe(res);});
const wss=new WebSocketServer({server,path:'/ws',maxPayload:16*1024});
wss.on('connection',ws=>{send(ws,{type:'hello',protocol:1});ws.isAlive=true;ws.on('pong',()=>ws.isAlive=true);ws.on('message',raw=>{let m;try{m=JSON.parse(String(raw));}catch(_){return send(ws,{type:'error',message:'Invalid message.'});}try{
  if(m.type==='ping'){send(ws,{type:'pong',t:m.t});return;}
  if(m.type==='create_room'){leave(ws);const room=new GameRoom(code(),m.mode);rooms.set(room.code,room);const seat=room.addPlayer(ws,m.name);wsRoom.set(ws,room);const p=room.players[seat];send(ws,{type:'room_joined',code:room.code,seat,playerId:p.id,snapshot:room.snapshot()});send(ws,{type:'room_waiting',code:room.code});return;}
  if(m.type==='join_room'){leave(ws);const room=rooms.get(String(m.code||'').trim().toUpperCase());if(!room)return send(ws,{type:'error',message:'Room not found.'});const seat=room.addPlayer(ws,m.name);if(seat<0)return send(ws,{type:'error',message:'Room is full.'});wsRoom.set(ws,room);const p=room.players[seat];send(ws,{type:'room_joined',code:room.code,seat,playerId:p.id,snapshot:room.snapshot()});room.broadcast({type:'room_ready',code:room.code,snapshot:room.snapshot(),players:room.players.map((x,i)=>x?{seat:i,name:x.name}:null)});return;}
  const room=wsRoom.get(ws);if(!room)return send(ws,{type:'error',message:'Join a room first.'});const seat=room.seatFor(ws);
  if(m.type==='aim'){
    if(!room.canSeatAct(seat))return;
    room.broadcastExcept(ws,{type:'opponent_aim',seat,aim:{angle:finite(m.angle),power:clamp(finite(m.power,.45),.02,1),spinX:clamp(finite(m.spinX),-1,1),spinY:clamp(finite(m.spinY),-1,1),pullback:clamp(finite(m.pullback),0,1)}});return;
  }
  if(m.type==='leave_room'){leave(ws);return;}
  if(m.type==='place_cue'){const r=room.placeCue(seat,m.x,m.z);if(!r.ok)return send(ws,{type:'action_rejected',action:'place_cue',message:r.error});room.broadcast({type:'state_sync',reason:'cue_placed',snapshot:r.snapshot});return;}
  if(m.type==='shot'){
    const r=room.simulateShot(seat,m);if(!r.ok)return send(ws,{type:'action_rejected',action:'shot',message:r.error,clientShotId:m.clientShotId||null});
    const impactDelayMs=205,tailMs=150,visualMs=impactDelayMs+r.durationMs+tailMs;
    room.animating=true;room.animatingUntil=Date.now()+visualMs;
    room.broadcast({type:'shot_start',seat,shot:r.shot,clientShotId:r.clientShotId,start:r.start,durationMs:visualMs,impactDelayMs,streamHz:30});
    const frames=r.motionFrames||[];let fi=0;const started=Date.now();
    const motionTimer=setInterval(()=>{
      if(!rooms.has(room.code)){clearInterval(motionTimer);return;}
      const t=Date.now()-started-impactDelayMs;if(t<0)return;let latest=null;
      while(fi<frames.length&&frames[fi].tMs<=t){latest=frames[fi++];}
      if(latest)room.broadcast({type:'shot_frame',seat,clientShotId:r.clientShotId,tMs:latest.tMs,balls:latest.balls});
      if(fi>=frames.length)clearInterval(motionTimer);
    },25);
    setTimeout(()=>{if(!rooms.has(room.code))return;clearInterval(motionTimer);room.animating=false;room.animatingUntil=0;room.broadcast({type:'state_sync',reason:'shot_result',result:r.result,snapshot:r.final,clientShotId:r.clientShotId});},visualMs);return;
  }
  if(m.type==='rematch'){room.rematchVotes.add(seat);room.broadcast({type:'rematch_vote',seat});if(room.rematchVotes.size===2){const snapshot=room.reset();room.broadcast({type:'state_sync',reason:'rematch',snapshot});}return;}
}catch(err){console.error('message error',err);send(ws,{type:'error',message:'Server error.'});}});ws.on('close',()=>leave(ws,'disconnected'));});
const timer=setInterval(()=>{for(const ws of wss.clients){if(ws.isAlive===false){ws.terminate();continue;}ws.isAlive=false;ws.ping();}},25000);timer.unref?.();
server.listen(PORT,'0.0.0.0',()=>console.log(`Cue Arena online server listening on ${PORT}`));
