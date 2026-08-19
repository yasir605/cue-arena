import { isCue } from '../game/BallRegistry.js';

export class ShotTracker {
  constructor(){ this.active=false; this.reset(); }
  reset(){
    this.firstHit=null;
    this.potted=[];
    this.offTable=[];
    this.cushions=[];
    this.cuePotted=false;
    this.cueOffTable=false;
    this.context=null;
  }
  begin(context){ this.reset(); this.context={...context}; this.active=true; }
  cancel(){ this.active=false; this.reset(); }
  collision(a,b){
    if(!this.active || this.firstHit) return;
    if(isCue(a) && !isCue(b)) this.firstHit=b;
    else if(isCue(b) && !isCue(a)) this.firstHit=a;
  }
  pocket(ball){
    if(!this.active) return;
    if(isCue(ball)) this.cuePotted=true;
    else if(!this.potted.includes(ball)) this.potted.push(ball);
  }
  cushion(ball){
    if(!this.active || !ball) return;
    if(!this.cushions.includes(ball)) this.cushions.push(ball);
  }
  ballOffTable(ball){
    if(!this.active) return;
    if(isCue(ball)) this.cueOffTable=true;
    else if(!this.offTable.includes(ball)) this.offTable.push(ball);
  }
  report(){
    return {
      context:this.context ? {...this.context} : null,
      firstHit:this.firstHit,
      potted:[...this.potted],
      offTable:[...this.offTable],
      cushions:[...this.cushions],
      cuePotted:this.cuePotted,
      cueOffTable:this.cueOffTable,
    };
  }
  end(){ const r=this.report(); this.active=false; return r; }
}
