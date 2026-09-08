import { CFG, ORD } from '@/core/config';
import { clamp, fmtTime } from '@/core/math';
import { AUDIO, HAPTIC } from '@/core/audio';
import { ITEMS } from '@/content/items';
import type { Game } from '@/game/Game';
import type { Kart } from '@/game/Kart';

/**
 * The document is authored in index.html and only ever mutated here, never
 * rebuilt: the game touches a handful of nodes per frame and the browser is
 * left to do nothing else.
 */
export const $=(id: string): HTMLElement | null => document.getElementById(id);

/** Same lookup, for the nodes the page is guaranteed to have. */
const req=(id: string): HTMLElement => {
  const el=document.getElementById(id);
  if(!el) throw new Error(`missing element #${id}`);
  return el;
};

export class UI {
  private readonly g: Game;
  private readonly el: Record<string, HTMLElement>;
  private _pos = 0;
  private _lap = 0;
  private _spd = -1;
  private _item = -2;
  private _tier = -1;
  private _boost = false;
  constructor(game: Game){
    this.g=game;
    this.el={
      title:req('title'), howto:req('howto'), hud:req('hud'), controls:req('controls'),
      results:req('results'), loader:req('loader'), loadFill:req('loadFill'),
      posBox:req('posBox'), posNum:req('posNum'), posOrd:req('posOrd'),
      lapVal:req('lapVal'), itemBox:req('itemBox'), itemGlyph:req('itemGlyph'),
      spdNum:req('spdNum'), cdNum:req('cdNum'), bannerTxt:req('bannerTxt'),
      flash:req('flash'), drift:req('bDrift'), bItem:req('bItem'),
      placeBig:req('placeBig'), placeSub:req('placeSub'), standings:req('standings'),
      btnSound:req('btnSound'),
    };
    this.bind();
  }
  private bind(): void {
    const tapAudio=()=>{ AUDIO.init(); AUDIO.resume(); };
    req('btnPlay').onclick=()=>{ tapAudio(); AUDIO.ui(); HAPTIC.tap(); this.g.startRace(); };
    req('btnHow').onclick=()=>{ tapAudio(); AUDIO.ui(); HAPTIC.tap(); this.el.howto.classList.remove('hidden'); };
    req('btnBack').onclick=()=>{ AUDIO.ui(); HAPTIC.tap(); this.el.howto.classList.add('hidden'); };
    req('btnSound').onclick=()=>{
      tapAudio(); const on=!AUDIO.on; AUDIO.setOn(on); HAPTIC.tap();
      this.el.btnSound.textContent='SOUND: '+(on?'ON':'OFF'); if(on) AUDIO.ui();
    };
    req('btnAgain').onclick=()=>{ tapAudio(); AUDIO.ui(); HAPTIC.tap(); this.g.startRace(); };
    req('btnMenu').onclick=()=>{ AUDIO.ui(); HAPTIC.tap(); this.g.toMenu(); };
  }
  setRotatePaused(on: boolean): void { const e=document.getElementById('rotPaused'); if(e) e.hidden=!on; }
  progress(p: number): void { this.el.loadFill!.style.width=(p*100)+'%'; }
  hideLoader(): void {
    this.el.loader.style.opacity='0';
    setTimeout(()=>this.el.loader.classList.add('hidden'),620);
  }
  showTitle(): void {
    this.el.title.classList.remove('hidden'); this.el.title.classList.add('fade-in');
    this.el.hud.classList.add('hidden'); this.el.controls.classList.add('hidden');
    this.el.results.classList.add('hidden'); this.el.howto.classList.add('hidden');
  }
  enterRace(): void {
    this.el.title.classList.add('hidden'); this.el.results.classList.add('hidden');
    this.el.hud.classList.remove('hidden'); this.el.controls.classList.remove('hidden');
    this._pos=0; this._lap=0; this._spd=-1; this._item=-2; this._tier=-1;
    this.setItem(-1); this.setDrift(0,0);
  }
  countdown(n: number): void {
    const e=this.el.cdNum;
    e.textContent=n>0?String(n):'GO!';
    e.classList.toggle('go',n===0);
    e.classList.remove('tick'); void e.offsetWidth; e.classList.add('tick');
  }
  banner(text: string, fire = false): void {
    const e=this.el.bannerTxt;
    e.textContent=text; e.classList.toggle('fire',!!fire);
    e.classList.remove('show'); void e.offsetWidth; e.classList.add('show');
  }
  flash(a: number, color?: string): void {
    const e=this.el.flash;
    e.style.background=color||'#fff';
    e.style.transition='none'; e.style.opacity=String(a);
    requestAnimationFrame(()=>{ e.style.transition='opacity .5s ease'; e.style.opacity='0'; });
  }
  setPlace(p: number, _total: number): void {
    if(p===this._pos) return;
    const up=p<this._pos&&this._pos>0;
    this._pos=p;
    this.el.posNum!.textContent=String(p);
    this.el.posOrd!.textContent=ORD[Math.min(p-1,3)]!;
    if(up){ this.el.posBox.classList.remove('up'); void this.el.posBox.offsetWidth; this.el.posBox.classList.add('up'); }
  }
  setLap(l: number, total: number): void {
    if(l===this._lap) return; this._lap=l;
    this.el.lapVal.innerHTML=Math.min(l,total)+'<span class="sm"> / '+total+'</span>';
  }
  setSpeed(v: number, boost: boolean): void {
    const n=Math.round(v*3.1);
    if(n!==this._spd){ this._spd=n; this.el.spdNum!.textContent=String(n); }
    if(boost!==this._boost){ this._boost=boost; this.el.spdNum.classList.toggle('boost',boost); }
  }
  setItem(i: number, rolling = false): void {
    const b=this.el.itemBox;
    if(i===this._item&&!rolling) return;
    this._item=rolling?-2:i;
    this.el.itemGlyph.textContent = i>=0 ? ITEMS[i]!.glyph : '❔';
    b.classList.toggle('empty', i<0);
    b.classList.toggle('rolling', !!rolling);
    b.classList.toggle('ready', i>=0&&!rolling);
    this.el.bItem.textContent = i>=0 ? ITEMS[i]!.glyph : '❔';
    this.el.bItem.classList.toggle('armed', i>=0&&!rolling);
    if(i>=0&&!rolling){ b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
  }
  setDrift(charge: number, tier: number): void {
    const d=this.el.drift;
    const tiers=CFG.driftTiers;
    let p: number;
    if(tier>=3) p=100;
    else p=clamp(charge/tiers[Math.min(tier,tiers.length-1)]!*100,0,100);
    if(tier>0){
      const from=tier>1?tiers[tier-2]!:0;
      p=100*clamp((charge-from)/((tiers[tier-1]!-from)||1),0,1);
    }
    d.style.setProperty('--p',p.toFixed(0));
    if(tier!==this._tier){
      this._tier=tier;
      d.classList.toggle('t2',tier===2); d.classList.toggle('t3',tier>=3);
    }
  }
  results(karts: Kart[], player: Kart): void {
    const p=player.place;
    this.el.placeBig.innerHTML=p+'<span style="font-size:.5em">'+ORD[Math.min(p-1,3)]!+'</span>';
    this.el.placeBig.classList.toggle('lose',p>2);
    this.el.placeSub.textContent = p===1?'CANDY VOLCANO CHAMPION':p===2?'SO CLOSE!':p===3?'ON THE PODIUM':'BETTER LUCK NEXT LAP';
    const sorted=karts.slice().sort((a,b)=>a.place-b.place);
    const best=sorted[0]!.finishTime;
    this.el.standings.innerHTML=sorted.map(k=>
      '<div class="srow'+(k.isPlayer?' me':'')+'">'+
      '<span class="p">'+k.place+ORD[Math.min(k.place-1,3)]!+'</span>'+
      '<span class="sw" style="background:'+k.def.hex+';color:'+k.def.hex+'"></span>'+
      '<span class="n">'+k.name+(k.isPlayer?' (YOU)':'')+'</span>'+
      '<span class="tm">'+(k.place===1?fmtTime(k.finishTime):'+'+ (k.finishTime-best).toFixed(2)+'s')+'</span>'+
      '</div>').join('');
    this.el.hud.classList.add('hidden'); this.el.controls.classList.add('hidden');
    this.el.results.classList.remove('hidden');
  }
}
