export class InputMan {
  left!: boolean;
  right!: boolean;
  drift!: boolean;
  itemEdge!: boolean;
  _itemHeld!: boolean;
  anyInteraction!: boolean;
  constructor(){
    this.left=false; this.right=false; this.drift=false;
    this.itemEdge=false; this._itemHeld=false;
    this.anyInteraction=false;
    this._bind();
  }
  /**
   * Steering sign convention — read this before touching it.
   *
   * A kart's forward vector is (sin heading, 0, cos heading), so increasing
   * `heading` swings the nose toward +X. The chase camera looks along that
   * same forward vector, and screen-right for such a view is
   * forward × up = (-cos h, 0, sin h) — i.e. -X. Increasing heading therefore
   * turns the kart LEFT on screen, not right.
   *
   * So throughout the simulation: positive steer = turn left on screen. The AI
   * is naturally consistent with this (its steer is a heading error), and every
   * kart visual — front wheels, steering wheel, driver lean, drift yaw — is
   * keyed to the same sign. Only the physical buttons need the mapping, which
   * is why LEFT produces +1 here.
   */
  get steer(): number { return (this.left?1:0)-(this.right?1:0); }
  consumeItem(): boolean { const v=this.itemEdge; this.itemEdge=false; return v; }
  _btn(el: HTMLElement | null, onDown: () => void, onUp?: () => void): void {
    if(!el) return;
    const down=(e: Event)=>{ e.preventDefault(); e.stopPropagation(); el.classList.add('on'); this.anyInteraction=true; onDown(); };
    const up  =(e?: Event)=>{ if(e) e.preventDefault(); el.classList.remove('on'); onUp&&onUp(); };
    el.addEventListener('pointerdown',down,{passive:false});
    el.addEventListener('pointerup',up,{passive:false});
    el.addEventListener('pointercancel',up,{passive:false});
    el.addEventListener('pointerleave',up,{passive:false});
    el.addEventListener('contextmenu',(e: Event)=>e.preventDefault());
  }
  _bind(): void {
    const $=(id: string)=>document.getElementById(id);
    this._btn($('bLeft'), ()=>{this.left=true;},  ()=>{this.left=false;});
    this._btn($('bRight'),()=>{this.right=true;}, ()=>{this.right=false;});
    this._btn($('bDrift'),()=>{this.drift=true;}, ()=>{this.drift=false;});
    this._btn($('bItem'), ()=>{this.itemEdge=true;});
    addEventListener('keydown',e=>{
      if(e.repeat) return; let hit=true;
      switch(e.code){
        case 'ArrowLeft': case 'KeyA': this.left=true; break;
        case 'ArrowRight':case 'KeyD': this.right=true; break;
        case 'Space': case 'ShiftLeft': case 'ShiftRight': this.drift=true; break;
        case 'KeyE': case 'Enter': this.itemEdge=true; break;
        default: hit=false;
      }
      if(hit){ e.preventDefault(); this.anyInteraction=true; }
    });
    addEventListener('keyup',e=>{
      switch(e.code){
        case 'ArrowLeft': case 'KeyA': this.left=false; break;
        case 'ArrowRight':case 'KeyD': this.right=false; break;
        case 'Space': case 'ShiftLeft': case 'ShiftRight': this.drift=false; break;
      }
    });
    addEventListener('blur',()=>{ this.left=this.right=this.drift=false; });
    // Block browser gesture interference during play
    document.addEventListener('gesturestart',(e: Event)=>e.preventDefault(),{passive:false});
    document.addEventListener('dblclick',(e: Event)=>e.preventDefault(),{passive:false});
    document.addEventListener('touchmove',(e: TouchEvent)=>{ if(e.touches.length>1) e.preventDefault(); },{passive:false});
  }
  reset(): void { this.left=this.right=this.drift=false; this.itemEdge=false; }
}
export const INPUT = new InputMan();
