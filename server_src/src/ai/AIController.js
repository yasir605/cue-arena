import { PotPlanner } from './PotPlanner.js';
import { SafetyPlanner } from './SafetyPlanner.js';

export const AI_DIFFICULTIES=Object.freeze({
  easy:{label:'Easy',searchCount:2,maxCutDeg:55,positionWeight:0.05,aimError:0.024,powerError:0.10,thinkMs:1150,safetyTargets:3,safetyPowerScales:[1.00],attackConfidence:0.72,safetyAwareness:0.72,poorDecision:0.18,frameBudgetMs:3.5},
  medium:{label:'Medium',searchCount:4,maxCutDeg:67,positionWeight:0.30,aimError:0.013,powerError:0.065,thinkMs:850,safetyTargets:5,safetyPowerScales:[0.94,1.06],attackConfidence:0.63,safetyAwareness:0.84,poorDecision:0.08,frameBudgetMs:4.0},
  hard:{label:'Hard',searchCount:7,maxCutDeg:77,positionWeight:0.75,aimError:0.0065,powerError:0.035,thinkMs:650,safetyTargets:7,safetyPowerScales:[0.90,1.00,1.10],attackConfidence:0.53,safetyAwareness:0.93,poorDecision:0.025,frameBudgetMs:4.5},
  expert:{label:'Expert',searchCount:10,maxCutDeg:83,positionWeight:1.00,aimError:0.0032,powerError:0.018,thinkMs:480,safetyTargets:9,safetyPowerScales:[0.88,0.96,1.04,1.12],attackConfidence:0.43,safetyAwareness:0.98,poorDecision:0.008,frameBudgetMs:5.0},
});

const controllerClamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const perfNow=()=>typeof performance!=='undefined'&&performance.now?performance.now():Date.now();
function drain(iterator){let r=iterator.next();while(!r.done)r=iterator.next();return r.value;}

export class AIController {
  constructor(world,{enabled=true,playerIndex=1,difficulty='medium',rng=Math.random,onDecision=null,executeShot=null}={}){
    this.world=world;this.enabled=enabled;this.playerIndex=playerIndex;this.difficulty=difficulty in AI_DIFFICULTIES?difficulty:'medium';
    this.rng=rng;this.onDecision=onDecision;this.executeShot=executeShot;
    this.potPlanner=new PotPlanner(world);this.safetyPlanner=new SafetyPlanner(world);
    this.pending=null;this.search=null;this.lastPlan=null;this.lastPlanMs=0;this.cooldownUntil=0;
  }
  profile(){return AI_DIFFICULTIES[this.difficulty];}
  displayName(){return `AI · ${this.profile().label.toUpperCase()}`;}
  setDifficulty(level){if(AI_DIFFICULTIES[level]){this.difficulty=level;this.pending=null;this.search=null;}}
  setEnabled(v){this.enabled=!!v;this.pending=null;this.search=null;}
  isAITurn(match){return this.enabled&&match.turn===this.playerIndex&&match.stage!=='over';}
  reset(){this.pending=null;this.search=null;this.lastPlan=null;this.lastPlanMs=0;this.cooldownUntil=0;}

  chooseDPlacement(match){
    const samples=[{x:0,depth:.70},{x:-.48,depth:.62},{x:.48,depth:.62},{x:-.72,depth:.42},{x:.72,depth:.42},{x:0,depth:.35}];
    for(const s of samples){const p=match.respotter.validDPosition(s.x,s.depth,match.cueBall());if(p.free)return s;}
    return {x:0,depth:.55};
  }

  *planSearch(match){
    const profile=this.profile();
    let plan=yield* this.potPlanner.search(match,this.difficulty,profile);
    const poor=this.rng()<profile.poorDecision;
    const risky=!!plan&&plan.confidence<profile.attackConfidence&&this.rng()<profile.safetyAwareness;
    if(!plan||poor||risky)plan=(yield* this.safetyPlanner.search(match,profile))||plan;
    if(!plan)return null;
    const aimNoise=(this.rng()*2-1)*profile.aimError,powerNoise=(this.rng()*2-1)*profile.powerError;
    plan={...plan,angle:plan.angle+aimNoise,power:controllerClamp(plan.power*(1+powerNoise),0.08,0.95),rawAngle:plan.angle,rawPower:plan.power,difficulty:this.difficulty,error:{aim:aimNoise,power:powerNoise}};
    return plan;
  }

  // Synchronous API is retained for deterministic tests/tools.
  plan(match){
    const t0=perfNow();const plan=drain(this.planSearch(match));this.lastPlanMs=perfNow()-t0;
    if(plan)this.lastPlan=plan;return plan;
  }

  fallbackShot(match){
    const cue=match?.cueBall?.();
    let targets=(typeof match?.legalTargetsFor==='function'?match.legalTargetsFor(match.turn):[]).filter(b=>b&&!b.potted&&!b.offTable);
    if(!targets.length){
      const on=String(match?.state?.()?.ballOn||'').toUpperCase();
      const live=this.world.balls.filter(b=>b!==cue&&!b.potted&&!b.offTable&&!b.inHand);
      if(on==='RED')targets=live.filter(b=>b.kind==='red');
      else if(on==='COLOUR')targets=live.filter(b=>b.kind==='colour');
      else if(on)targets=live.filter(b=>String(b.name||'').toUpperCase()===on||on.includes(String(b.name||'').toUpperCase()));
    }
    if(!cue||!targets.length)return null;
    const live=this.world.balls.filter(b=>b!==cue&&!b.potted&&!b.offTable&&!b.inHand);
    const clearPath=(target)=>{
      const dx=target.position.x-cue.position.x,dz=target.position.y-cue.position.y,L=Math.hypot(dx,dz);
      if(L<1e-6)return false;const ux=dx/L,uz=dz/L;
      for(const b of live){if(b===target)continue;const rx=b.position.x-cue.position.x,rz=b.position.y-cue.position.y,t=rx*ux+rz*uz;if(t<=0||t>=L)continue;const px=rx-ux*t,pz=rz-uz*t,rr=cue.radius+b.radius+.003;if(px*px+pz*pz<rr*rr)return false;}
      return true;
    };
    const ordered=[...targets].sort((a,b)=>Math.hypot(a.position.x-cue.position.x,a.position.y-cue.position.y)-Math.hypot(b.position.x-cue.position.x,b.position.y-cue.position.y));
    const target=ordered.find(clearPath)||ordered[0];
    const dx=target.position.x-cue.position.x,dz=target.position.y-cue.position.y,dist=Math.hypot(dx,dz);
    return{type:'fallback',decision:'SAFE CONTACT',target,angle:Math.atan2(dx,dz),power:controllerClamp(.26+dist/Math.max(.8,(this.world.table?.length||3.5))*.30,.26,.56),spinX:0,spinY:0,confidence:.20,difficulty:this.difficulty,error:{aim:0,power:0}};
  }

  #finishSearch(result,wallNow){
    const search=this.search;this.search=null;
    let plan=result;this.lastPlanMs=search?.computeMs||0;
    if(!plan){plan=this.fallbackShot(search?.match);if(!plan){this.onDecision?.({type:'failed',planningMs:this.lastPlanMs});this.cooldownUntil=wallNow+450;return;}this.onDecision?.({type:'fallback',plan,planningMs:this.lastPlanMs});}
    this.lastPlan=plan;
    this.onDecision?.({type:'plan',plan,planningMs:this.lastPlanMs,wallMs:search?wallNow-search.wallStart:0});
    const ok=this.executeShot?.(plan);
    this.cooldownUntil=wallNow+(ok===false?500:300);
  }

  tick(now,match){
    if(!this.isAITurn(match)){this.pending=null;this.search=null;return;}
    if((match.ballInHandD||match.ballInHandAnywhere)&&!match.shotActive&&this.world.allStopped()){
      if(match.ballInHandAnywhere&&typeof match.placeCueAnywhere==='function'){
        const cue=match.cueBall(),targets=typeof match.legalTargetsFor==='function'?match.legalTargetsFor(match.turn):[];
        const t=targets[0];const z=t?Math.max(-1.1,Math.min(.2,t.position.y-.62)):-.65;
        const placed=match.placeCueAnywhere(0,z);
        if(placed?.ok===false&&cue)match.placeCueAnywhere(cue.position.x,cue.position.y);
      }else{const p=this.chooseDPlacement(match);match.placeCueInD(p.x,p.depth);}
      this.cooldownUntil=now+260;this.pending=null;this.search=null;return;
    }
    if(now<this.cooldownUntil||match.shotActive||!this.world.allStopped())return;

    // Continue a cooperative search. Each candidate still uses the exact same
    // physics simulation, but expensive Expert analysis is spread over frames.
    if(this.search){
      const budget=this.profile().frameBudgetMs||4;
      const sliceStart=perfNow();let r={done:false,value:null};
      do{r=this.search.iterator.next();}while(!r.done&&perfNow()-sliceStart<budget);
      this.search.computeMs+=perfNow()-sliceStart;
      if(r.done)this.#finishSearch(r.value,now);
      return;
    }

    const key=typeof match.stateKey==='function'?match.stateKey():`${match.turn}:${match.stage}:${match.expected}:${match.clearanceIndex}:${match.redsRemaining()}:${match.active.score}:${match.active.break}`;
    if(!this.pending||this.pending.key!==key){
      this.pending={key,fireAt:now+this.profile().thinkMs};
      this.onDecision?.({type:'thinking',difficulty:this.difficulty});return;
    }
    if(now<this.pending.fireAt)return;
    this.pending=null;
    this.search={key,iterator:this.planSearch(match),wallStart:now,computeMs:0,match};
    this.onDecision?.({type:'searching',difficulty:this.difficulty});
  }
}
