import * as THREE from 'three';
import { CFG, ORD } from '@/core/config';
import { AUDIO, HAPTIC } from '@/core/audio';
import { INPUT } from '@/core/input';
import { clamp, damp, lerp, rand, smoothstep } from '@/core/math';
import { buildSharedGeo } from '@/render/geom';
import { buildTextures } from '@/render/textures';
import { PATH } from '@/track/path';
import { TrackPath, type TrackFrame } from '@/track/TrackPath';
import { RACERS } from '@/content/racers';
import { World } from './World';
import { Kart } from './Kart';
import { ItemSystem } from './ItemSystem';
import { FX } from './FX';
import { CamRig } from './CamRig';
import { UI } from '@/ui/UI';
import type { Quality } from '@/core/quality';

export type GameState = 'boot' | 'title' | 'countdown' | 'race' | 'finish';

/**
 * Owns the renderer, the race, and the loop that drives them.
 *
 * The state machine is deliberately flat — five states, one tick function each
 * — because everything interesting (drifting, items, the volcano) lives in the
 * systems this class steps rather than in the flow between screens.
 */
export class Game {
  readonly canvas: HTMLCanvasElement;
  readonly quality: Quality;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly cam: CamRig;
  /** Seconds since boot; drives every ambient animation. */
  clock = 0;
  state: GameState = 'boot';
  /** Volcano eruption intensity, 0..2, rising through the race. */
  phase = 0;
  raceTime = 0;

  ui!: UI;
  world!: World;
  fx!: FX;
  items!: ItemSystem;
  karts: Kart[] = [];
  player!: Kart;

  /** Mirrors the #rotate media query; the race freezes while it matches. */
  private readonly rotateMQ: MediaQueryList;
  private rotHeld = false;
  private fpsAcc = 0;
  private fpsN = 0;
  private degraded = false;
  private ambT = 0;
  private eruptT = 0;
  private debrisT = 0;
  private readonly stageEl: HTMLElement | null;
  readonly onResize: () => void;
  private last = 0;
  private cdT = 0;
  private cdLast = 99;
  private finishT = 0;
  private _resultsShown = false;
  /** How many racers have already crossed the line. */
  private finishOrder = 0;
  private _wwShown = false;
  private readonly _fr: TrackFrame = TrackPath.emptyFrame();

  constructor(){
    this.canvas=document.getElementById('c') as HTMLCanvasElement;
    this.quality=this.detectQuality();
    this.renderer=new THREE.WebGLRenderer({canvas:this.canvas,antialias:this.quality.aa,powerPreference:'high-performance',alpha:false});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,this.quality.dpr));
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=1.14;
    if(this.quality.shadows){ this.renderer.shadowMap.enabled=true; this.renderer.shadowMap.type=THREE.PCFSoftShadowMap; }
    this.scene=new THREE.Scene();
    this.camera=new THREE.PerspectiveCamera(62,1,.6,3000);
    this.cam=new CamRig(this.camera);
    // Must mirror the #rotate media query in the stylesheet exactly.
    this.rotateMQ=matchMedia('(orientation:portrait) and (max-width:900px)');
    this.stageEl=document.getElementById('stage');
    this.onResize=this._resize.bind(this);
    addEventListener('resize',this.onResize);
    addEventListener('orientationchange',()=>setTimeout(this.onResize,250));
    // The visual viewport changes without firing window resize when a mobile
    // toolbar slides in or out, so listen to it directly as well.
    if(window.visualViewport){
      window.visualViewport.addEventListener('resize',this.onResize);
      window.visualViewport.addEventListener('scroll',this.onResize);
    }
    document.addEventListener('visibilitychange',()=>{
      if(document.hidden){ AUDIO.skidStop(); }
    });
  }
  detectQuality(): Quality {
    const mob=/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    const mem=(navigator as Navigator & {deviceMemory?: number}).deviceMemory ?? (mob?4:8);
    const low=mob&&mem<=4;
    return {
      mobile:mob, aa:!mob, dpr:mob?(low?1.35:1.75):2,
      shadows:!low, shadowSize:mob?1024:2048, terrainSeg:mob?96:150,
      pDrift:mob?420:700, pSpark:mob?520:900, pSmoke:mob?300:480, pAmb:mob?200:340,
    };
  }
  async boot(): Promise<void> {
    const ui=this.ui=new UI(this);
    ui.progress(.08);
    await this.frame();
    const aniso=this.renderer.capabilities.getMaxAnisotropy();
    buildTextures(Math.min(8,aniso)); ui.progress(.28); await this.frame();
    buildSharedGeo(); ui.progress(.42); await this.frame();
    this.world=new World(this.scene,this.quality); ui.progress(.74); await this.frame();
    this.fx=new FX(this.scene,this.quality); ui.progress(.82); await this.frame();
    this.karts=RACERS.map((d,i)=>new Kart(d,i,this));
    this.player=this.karts[0];
    ui.progress(.92); await this.frame();
    this.items=new ItemSystem(this); ui.progress(1);
    this.karts.forEach((k,i)=>k.reset(i));
    this.onResize();
    // warm the shader cache so the first race frame doesn't hitch
    this.renderer.compile(this.scene,this.camera);
    await this.frame();
    ui.hideLoader(); ui.showTitle();
    this.state='title';
    this.world.setPhase(0,0);
    this.last=performance.now();
    requestAnimationFrame(this.loop.bind(this));
  }
  frame(): Promise<void> { return new Promise(r=>requestAnimationFrame(()=>r())); }
  private _resize(): void {
    // Mobile browsers expose two viewports. `innerHeight` follows the VISUAL
    // viewport, which shrinks while an auto-hiding toolbar is on screen, but a
    // position:fixed element sizes to the LAYOUT viewport, which does not. When
    // those disagree the canvas CSS box and the drawing buffer disagree too:
    // the render stretches, and the bottom row of controls slides underneath
    // the browser chrome. Driving the stage and the renderer from the same
    // measurement keeps them locked together on every browser.
    // Measure the stage's own box rather than pinning it to a JS-computed size:
    // #stage keeps inset:0 so it always tracks the viewport by itself and can
    // never hold a stale value, and measuring it guarantees the drawing buffer
    // matches the element the canvas actually fills.
    const r=this.stageEl?this.stageEl.getBoundingClientRect():null;
    const w=Math.max(1,Math.round(r&&r.width ?r.width :innerWidth));
    const h=Math.max(1,Math.round(r&&r.height?r.height:innerHeight));
    this.renderer.setSize(w,h,false);
    this.camera.aspect=w/h;
    this.camera.updateProjectionMatrix();
  }

  /* ── Race flow ── */
  startRace(): void {
    this.ui.enterRace();
    this.karts.forEach((k,i)=>k.reset(i));
    this.items.reset(); this.fx.clear();
    INPUT.reset();
    this.state='countdown'; this.cdT=3.6; this.cdLast=99;
    this.finishT=0; this._resultsShown=false;
    this.raceTime=0; this.phase=0; this.finishOrder=0;
    this.cam.mode='chase'; this.cam._roll=0; this.cam.fov=62;
    this.cam.snap(this.player);
    AUDIO.init(); AUDIO.resume(); AUDIO.startEngine();
    this.world.setPhase(0,this.clock);
    this.ui.setLap(1,CFG.laps); this.ui.setPlace(4,4);
  }
  toMenu(): void {
    this.state='title'; AUDIO.stopEngine(); AUDIO.skidStop();
    this.karts.forEach((k,i)=>k.reset(i));
    this.items.reset(); this.fx.clear();
    this.cam.mode='title'; this.phase=0; this.world.setPhase(0,this.clock);
    this.ui.showTitle();
  }
  onLapComplete(k: Kart): void {
    if(k.finished) return;              // never score a kart twice
    if(k.lap>CFG.laps){
      k.finished=true; k.finishTime=this.raceTime; k.place=++this.finishOrder;
      k.releaseDrift(false);
      if(k.isPlayer) this.onPlayerFinish();
    } else if(k.isPlayer){
      this.ui.setLap(k.lap,CFG.laps);
      if(k.lap===CFG.laps){
        this.ui.banner('FINAL LAP!',true); AUDIO.finalLap(); HAPTIC.go();
        this.ui.flash(.3,'#ffb37a');
      } else {
        this.ui.banner('LAP '+k.lap,false); AUDIO.tone(700,.16,'square',.2,1050);
      }
    }
  }
  onPlayerFinish(): void {
    if(this.state==='finish') return;   // guard against a double trigger
    this.state='finish'; this.finishT=0;
    AUDIO.skidStop();
    // Assign remaining places by current progress so standings are complete
    const rest=this.karts.filter(k=>!k.finished).sort((a,b)=>b.progress-a.progress);
    let n=this.finishOrder;
    for(const k of rest){
      k.finished=true; k.place=++n;
      k.finishTime=this.raceTime + (this.player.progress-k.progress)/48 + rand(.4,2.2);
    }
    this.finishOrder=n;
    this.cam.startOrbit();
    const won=this.player.place===1;
    AUDIO.finish(won);
    HAPTIC.buzz(won?[0,60,40,60,40,120]:[0,40,30,60]);
    this.ui.banner(this.player.place+ORD[Math.min(this.player.place-1,3)]+' PLACE!',won);
    this.ui.flash(.4,won?'#ffe36b':'#ffb3d5');
    // celebration confetti
    for(let i=0;i<90;i++){
      const a=Math.random()*Math.PI*2;
      this.fx.spark.spawn(this.player.pos.x+rand(-3,3),this.player.pos.y+rand(1,4),this.player.pos.z+rand(-3,3),
        Math.cos(a)*rand(4,20),rand(9,24),Math.sin(a)*rand(4,20),
        Math.random(),Math.random()*.6+.4,Math.random()*.8+.2, rand(1.6,3.2), rand(.5,1.1),1,-9,.5,0);
    }
  }
  /* ── Helpers used by AI + items ── */
  nextAhead(k: Kart): Kart | null {
    let best=null,bd=Infinity;
    for(const o of this.karts){
      if(o===k||o.finished) continue;
      let d=o.progress-k.progress;
      if(d<0) continue;
      if(d<bd){ bd=d; best=o; }
    }
    return best;
  }
  hasTargetAhead(k: Kart, range: number): boolean {
    const t=this.nextAhead(k);
    return !!t && (t.progress-k.progress)<range;
  }
  anyThreatNear(k: Kart): boolean {
    for(const pr of this.items.live){
      if(pr.owner===k) continue;
      const dx=pr.p.obj.position.x-k.pos.x, dz=pr.p.obj.position.z-k.pos.z;
      if(dx*dx+dz*dz<3600) return true;
    }
    return false;
  }
  /** Gentle rubber band — preserves tension without deciding the race. */
  rubber(k: Kart): number {
    if(!k.ai) return 1;
    const d=this.player.progress-k.progress;   // + means AI is behind the player
    if(d>65)  return 1.06;                     // player pulling away → AI presses a little
    if(d<-65) return 0.955;                    // player dropped back → AI eases slightly
    return 1;
  }
  updatePlaces(): void {
    const s=this.karts.slice().sort((a,b)=>{
      if(a.finished&&b.finished) return a.place-b.place;
      if(a.finished) return -1; if(b.finished) return 1;
      return b.progress-a.progress;
    });
    for(let i=0;i<s.length;i++) if(!s[i].finished) s[i].place=i+1;
  }
  /* ── Ambient world life: smoke, eruption, debris ── */
  ambient(dt: number): void {
    const W=this.world, fx=this.fx, ph=this.phase;
    this.ambT-=dt;
    if(this.ambT<=0){
      this.ambT=lerp(.09,.022,clamp(ph/2,0,1));
      // crater plume
      const a=W.smokeAnchors[0]!;
      const spread=lerp(9,26,clamp(ph/2,0,1));
      const rise=lerp(11,32,clamp(ph/2,0,1));
      const g=lerp(.9,.62,clamp(ph/2,0,1));
      fx.amb.spawn(a.x+rand(-spread,spread),a.y,a.z+rand(-spread,spread),
        rand(-4,4),rand(rise*.6,rise),rand(-4,4),
        1,g,lerp(.92,.55,clamp(ph/2,0,1)), rand(4,8), rand(6,13), lerp(.34,.6,clamp(ph/2,0,1)), 1.4, .32, 5);
      // lava lake wisps
      for(let i=1;i<W.smokeAnchors.length;i++){
        if(Math.random()>.34) continue;
        const p=W.smokeAnchors[i]!;
        fx.amb.spawn(p.x+rand(-22,22),p.y,p.z+rand(-22,22), rand(-2,2),rand(3,8),rand(-2,2),
          1,.72,.6, rand(2.6,5), rand(3,6), .3, .9, .5, 3);
      }
      // floating candy motes near the player (cheap sense of speed & place)
      if(this.state==='race'||this.state==='countdown'){
        const p=this.player.pos;
        for(let i=0;i<2;i++){
          const a2=Math.random()*Math.PI*2, r=rand(18,58);
          fx.spark.spawn(p.x+Math.cos(a2)*r, p.y+rand(2,22), p.z+Math.sin(a2)*r,
            rand(-1.5,1.5),rand(-2.5,-.6),rand(-1.5,1.5),
            1,rand(.5,.9),rand(.6,1), rand(2.2,4.4), rand(.4,.9),.7,0,.15,0);
        }
      }
    }
    // ── Lap-3 eruption: bursts, flashes, falling popcorn debris
    if(ph>1.35){
      this.eruptT-=dt;
      if(this.eruptT<=0){
        this.eruptT=rand(1.9,4.4);
        const a=W.smokeAnchors[0]!;
        for(let i=0;i<46;i++){
          const ang=Math.random()*Math.PI*2, e=rand(.55,1);
          fx.spark.spawn(a.x+rand(-14,14),a.y,a.z+rand(-14,14),
            Math.cos(ang)*rand(6,40), rand(34,76)*e, Math.sin(ang)*rand(6,40),
            1,rand(.42,.8),rand(.1,.3), rand(2.4,5.6), rand(1.6,3.4),1,-17,.28,0);
        }
        for(let i=0;i<20;i++){
          fx.amb.spawn(a.x+rand(-20,20),a.y+rand(0,14),a.z+rand(-20,20),
            rand(-16,16),rand(20,44),rand(-16,16), 1,.62,.42, rand(6,11), rand(8,16),.6,.7,.3,7);
        }
        AUDIO.eruption();
        this.ui.flash(.2,'#ff9a5a');
        if(this.player) this.cam.shake(.34);
        HAPTIC.buzz(24);
      }
      // popcorn debris drifting past — atmosphere only, never on the racing line
      this.debrisT-=dt;
      if(this.debrisT<=0){
        this.debrisT=.14;
        for(let i=0;i<2;i++){
          const side=Math.random()<.5?-1:1;
          const off=side*rand(24,70);
          const fr=PATH.frameAtS(this.player.s+rand(30,150),this._fr);
          const x=fr.pos.x+fr.right.x*off, z=fr.pos.z+fr.right.z*off;
          fx.amb.spawn(x,fr.pos.y+rand(46,90),z, rand(-3,3),-rand(11,20),rand(-3,3),
            1,.86,.7, rand(1.6,3.4), rand(2.4,4),.85,-4.5,.12,0);
        }
      }
    }
  }

  /* ── Main loop ── */
  loop(now: number): void {
    requestAnimationFrame(this.loop.bind(this));
    let dt=(now-this.last)/1000; this.last=now;
    if(dt>0.05) dt=0.05;               // clamp after tab-switches / hitches
    if(dt<=0) return;
    this.clock+=dt;

    // adaptive quality: sustained low FPS → shed the expensive effects once
    this.fpsAcc+=dt; this.fpsN++;
    if(this.fpsAcc>2){
      const fps=this.fpsN/this.fpsAcc; this.fpsAcc=0; this.fpsN=0;
      if(!this.degraded&&fps<42&&this.clock>6){
        this.degraded=true;
        this.renderer.shadowMap.enabled=false;
        this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.15));
        if(this.world.key) this.world.key.castShadow=false;
        this.onResize();
      }
    }

    // ── Portrait hold.
    // The stylesheet covers the screen with "rotate your device" and disables
    // the controls under exactly this condition. Freeze the simulation to match:
    // otherwise the kart keeps driving at full speed, unsteerable, behind an
    // opaque overlay — turn your phone for a moment and you lose the race.
    if(this.rotateMQ.matches && this.state!=='title'){
      if(!this.rotHeld){
        this.rotHeld=true;
        INPUT.reset(); AUDIO.skidStop(); AUDIO.engineUpdate(0,0);
        this.ui.setRotatePaused(true);
      }
      return;                              // overlay is opaque; skip rendering too
    }
    if(this.rotHeld){ this.rotHeld=false; this.ui.setRotatePaused(false); }

    switch(this.state){
      case 'title':     this.tickTitle(dt);     break;
      case 'countdown': this.tickCountdown(dt); break;
      case 'race':      this.tickRace(dt);      break;
      case 'finish':    this.tickFinish(dt);    break;
    }

    this.world.setPhase(this.phase,this.clock);
    this.ambient(dt);
    this.fx.update(dt);
    if(this.state!=='title'&&this.state!=='boot'){
      AUDIO.musicStep(dt,clamp(this.phase/2,0,1));
    }
    this.renderer.render(this.scene,this.camera);
  }
  tickTitle(dt: number): void {
    this.cam.titleShot(this.clock);
    // idle showcase: karts creep along the grid so the scene isn't frozen
    for(const k of this.karts) k.syncVisual(dt);
    this.phase=damp(this.phase,.70,1.2,dt);   // a little crater life behind the menu
  }
  tickCountdown(dt: number): void {
    this.cdT-=dt;
    const n=Math.ceil(this.cdT-0.6);
    if(n!==this.cdLast&&n<=3&&n>=0){
      this.cdLast=n;
      this.ui.countdown(n); AUDIO.count(n);
      if(n===0){ HAPTIC.go(); this.cam.punch(.5); } else HAPTIC.count();
      // engine rev anticipation
      AUDIO.engineUpdate(n===0?.5:.25+((3-n)*.1),.5);
    }
    for(const k of this.karts) k.update(dt,false);
    this.cam.update(dt,this.player,this.phase);
    if(this.cdT<=0.6){
      this.state='race'; this.raceTime=0;
      this.ui.setLap(1,CFG.laps);
    }
  }
  tickRace(dt: number): void {
    this.raceTime+=dt;
    const P=this.player;
    for(const k of this.karts) k.update(dt,true);
    this.items.update(dt);
    this.updatePlaces();
    // race phase drives the whole atmosphere (lap 1 calm → lap 3 eruption)
    const lapProg=clamp((P.lap-1)+P.s/PATH.len,0,CFG.laps);
    this.phase=damp(this.phase,clamp(lapProg,0,2),1.6,dt);
    this.cam.update(dt,P,this.phase);
    // HUD
    this.ui.setPlace(P.place,CFG.racers);
    this.ui.setSpeed(P.speed,P.boosting);
    this.ui.setDrift(P.driftCharge,P.driftTier);
    // engine audio
    AUDIO.engineUpdate(clamp(P.speed/CFG.topSpeed,0,1.35),P.boosting?1:.55);
    if(P.wrongWay>1.4&&!this._wwShown){ this._wwShown=true; this.ui.banner('WRONG WAY!',true); }
    if(P.wrongWay<=0) this._wwShown=false;
  }
  tickFinish(dt: number): void {
    this.finishT+=dt;
    // brief slow-mo into the celebration
    const slow=lerp(.28,1,smoothstep(0,1.5,this.finishT));
    const sdt=dt*slow;
    for(const k of this.karts) k.update(sdt,false);
    this.items.update(sdt);
    this.cam.update(dt,this.player,this.phase);
    AUDIO.engineUpdate(clamp(this.player.speed/CFG.topSpeed,0,1)*.6,.2);
    // victory celebration: driver punches the air
    const v=this.player.vis;
    if(this.player.place===1){
      const t=this.finishT;
      v.arms[0].rotation.x=-Math.abs(Math.sin(t*4))*1.5;
      v.arms[1].rotation.x=-Math.abs(Math.sin(t*4+1))*1.5;
      v.headG.rotation.x=Math.sin(t*3.4)*.2-.1;
      v.hipG.position.y=Math.abs(Math.sin(t*4))*.14;
    } else {
      v.headG.rotation.x=lerp(0,.24,smoothstep(0,1,this.finishT));
    }
    if(this.finishT>2.6&&!this._resultsShown){
      this._resultsShown=true;
      this.ui.results(this.karts,this.player);
      AUDIO.stopEngine();
    }
    if(this.finishT<=2.6) this._resultsShown=false;
  }
}

