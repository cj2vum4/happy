import * as THREE from 'three';
import { CFG } from '@/core/config';
import { AUDIO, HAPTIC } from '@/core/audio';
import { INPUT } from '@/core/input';
import { clamp, damp, lerp, angleDiff, rand, randi, smoothstep } from '@/core/math';
import { _v1, _v2 } from '@/core/scratch';
import { PATH } from '@/track/path';
import { TrackPath } from '@/track/TrackPath';
import { ITEMS } from '@/content/items';
import { buildKart } from './kart-model';
import { AIBrain } from './AIBrain';
import type { KartModel } from './kart-model';
import type { Game } from './Game';
import type { RacerDef } from '@/content/racers';
import type { Projection, TrackFrame } from '@/track/TrackPath';

/**
 * One racer: the physics body, the model, the race state, and — for a rival —
 * the brain that produces its input. Player and AI karts are the same class on
 * purpose: everything from drift charge to item odds behaves identically, so a
 * rival is never doing something the player cannot.
 */
export class Kart {
  readonly def: RacerDef;
  readonly idx: number;
  readonly game: Game;
  readonly name: string;
  readonly isPlayer: boolean;
  readonly color: THREE.Color;
  /** Animation handles from the kart factory. */
  readonly vis: KartModel;
  readonly obj: THREE.Group;

  /* ── Physics state ── */
  readonly pos = new THREE.Vector3();
  heading = 0;
  speed = 0;
  /** Smoothed steer input, so the wheels and camera do not snap. */
  steerSm = 0;
  wheelSpin = 0;

  /* ── Drift and boost ── */
  drifting = false;
  /** -1 or 1 while drifting, 0 otherwise. */
  driftDir = 0;
  driftCharge = 0;
  driftTier = 0;
  boostT = 0;
  boostTier = 0;

  /* ── Damage and items ── */
  spinT = 0;
  hitCool = 0;
  shield = 0;
  shieldMesh: THREE.Mesh | null = null;
  /** Index into ITEMS, or -1 for empty. */
  item = -1;
  /** Seconds left on the item roulette. */
  rolling = 0;
  rollIdx = 0;
  rollTick = 0;

  /* ── Race position ── */
  lap = 1;
  /** Arc length around the circuit. */
  s = 0;
  prevS = 0;
  /** Lateral offset from the centreline. */
  lat = 0;
  /** Total distance covered, laps included — what places are sorted on. */
  progress = 0;
  place: number;
  finished = false;
  finishTime = 0;
  /** Last projection index, the hint that keeps `PATH.project` O(1). */
  trackIdx = 0;
  private readonly _proj: Projection = TrackPath.emptyProjection();
  private readonly _fr: TrackFrame = TrackPath.emptyFrame();
  /** Quarters of the lap already passed, so a lap only counts if all four were. */
  sector = 0;

  /* ── Presentation ── */
  visYaw = 0;
  visRoll = 0;
  visPitch = 0;
  bodyBob = 0;
  surfBank = 0;
  surfPitch = 0;

  /* ── Housekeeping ── */
  offTrack = 0;
  stuckT = 0;
  respawnCool = 0;
  wrongWay = 0;
  smokeT = 0;
  driftPartT = 0;
  bumpCool = false;
  private _nudgeCool = false;
  private _lastSpeed = 0;
  /** The item the roulette will land on, hidden until it stops. */
  private _pending = -1;
  readonly ai: AIBrain | null;

  constructor(def: RacerDef, idx: number, game: Game){
    this.def=def; this.idx=idx; this.game=game;
    this.name=def.name; this.isPlayer=def.player; this.color=new THREE.Color(def.hex);
    const built=buildKart(def.pal);
    this.vis=built; this.obj=built.group; game.scene.add(this.obj);
    this.place=idx+1;
    this.ai=def.ai?new AIBrain(this,def.ai):null;
  }
  /** Put the kart on the grid. `gridSlot` is 0-based, two abreast. */
  reset(gridSlot: number): void {
    // Grid: 2x2 staggered behind the line
    const row=Math.floor(gridSlot/2), col=gridSlot%2;
    const s=PATH.len-14-row*9;
    const off=(col?1:-1)*5.2;
    this.s=((s%PATH.len)+PATH.len)%PATH.len; this.prevS=this.s;
    const fr=PATH.frameAtS(this.s,this._fr);
    this.pos.copy(fr.pos).addScaledVector(fr.right,off).setY(fr.pos.y+Math.sin(fr.bank)*off);
    this.heading=Math.atan2(fr.tan.x,fr.tan.z);
    this.lat=off;
    this.speed=0; this.steerSm=0; this.drifting=false; this.driftCharge=0; this.driftTier=0;
    this.boostT=0; this.boostTier=0; this.spinT=0; this.hitCool=0;
    this.setShield(0); this.item=-1; this.rolling=0;
    this.lap=1; this.finished=false; this.finishTime=0; this.progress=0;
    this.sector=0; this.trackIdx=0; this.offTrack=0; this.stuckT=0; this.wrongWay=0;
    this.visYaw=this.visRoll=this.visPitch=0;
    this.obj.visible=true;
    this.syncVisual(0);
    if(this.ai) this.ai.reset();
  }
  get boosting(): boolean { return this.boostT>0; }
  get topSpeed(): number { return this.boosting?CFG.boostTop[this.boostTier-1]!:CFG.topSpeed; }

  setShield(t: number): void {
    this.shield=t;
    if(t>0 && !this.shieldMesh){
      const m=new THREE.Mesh(new THREE.SphereGeometry(3.1,16,12),
        new THREE.MeshStandardMaterial({color:this.def.pal.glow,emissive:this.def.pal.glow,
          emissiveIntensity:.7,transparent:true,opacity:.3,roughness:.1,side:THREE.DoubleSide,depthWrite:false}));
      m.renderOrder=5; this.shieldMesh=m; this.obj.add(m); m.position.y=1.1;
    }
    if(t<=0 && this.shieldMesh){ this.obj.remove(this.shieldMesh); this.shieldMesh.geometry.dispose(); this.shieldMesh=null; }
  }
  /** Apply an offensive hit (unless shielded). */
  takeHit(_from: Kart | null): boolean {
    if(this.finished||this.hitCool>0) return false;
    if(this.shield>0){
      this.setShield(0); this.hitCool=.5;
      this.game.fx.burst(this.pos,this.def.pal.glow,26,7);
      if(this.isPlayer){ AUDIO.block(); HAPTIC.bump(); } else AUDIO.block();
      return false;
    }
    this.spinT=CFG.hitSpinTime; this.hitCool=CFG.hitSpinTime+.35;
    this.speed*=CFG.hitSpeedMul; this.boostT=0; this.drifting=false; this.driftCharge=0;
    this.game.fx.burst(this.pos,'#fff4e6',34,10);
    this.game.fx.burst(this.pos,this.def.hex,22,7);
    if(this.isPlayer){ AUDIO.impact(); HAPTIC.hit(); this.game.cam.shake(.55); this.game.ui.flash(.32,'#ff9dc6'); }
    else AUDIO.impact();
    return true;
  }
  giveItem(i: number): void {
    this.item=-1; this.rolling=CFG.rouletteTime; this.rollIdx=randi(ITEMS.length);
    this.rollTick=0; this._pending=i;
  }
  useItem(): void {
    if(this.item<0||this.rolling>0||this.finished) return;
    const id=ITEMS[this.item]!.id; this.item=-1;
    this.game.items.fire(this,id);
    if(this.isPlayer){ AUDIO.itemUse(); HAPTIC.tap(); this.game.ui.setItem(-1); }
  }

  /* ── Core simulation ── */
  update(dt: number, raceLive: boolean): void {
    // roulette
    if(this.rolling>0){
      this.rolling-=dt; this.rollTick-=dt;
      if(this.rollTick<=0){
        this.rollTick=.062; this.rollIdx=(this.rollIdx+1)%ITEMS.length;
        if(this.isPlayer){ this.game.ui.setItem(this.rollIdx,true); AUDIO.rouletteTick(this.rollIdx); }
      }
      if(this.rolling<=0){
        this.item=this._pending;
        if(this.isPlayer){ this.game.ui.setItem(this.item); AUDIO.pickup(); HAPTIC.tap(); }
      }
    }
    if(this.hitCool>0) this.hitCool-=dt;
    if(this.shield>0){ this.shield-=dt; if(this.shield<=0) this.setShield(0); }
    if(this.respawnCool>0) this.respawnCool-=dt;

    // ── Inputs
    let steer=0, wantDrift=false;
    if(!raceLive||this.finished){
      if(this.finished){ // coast down after the flag
        this.speed=damp(this.speed,0,1.1,dt);
        if(this.ai||true){ const b=this.ai?this.ai.steerToLine():0; steer=b; }
      }
    } else if(this.spinT>0){
      this.spinT-=dt;                       // no control while spinning out
    } else if(this.isPlayer){
      steer=INPUT.steer; wantDrift=INPUT.drift;
      if(INPUT.consumeItem()) this.useItem();
    } else if(this.ai){
      const o=this.ai.update(dt);
      steer=o.steer; wantDrift=o.drift;
    }

    // ── Drift state machine
    const fastEnough=this.speed>19;
    if(raceLive&&!this.finished&&this.spinT<=0){
      if(wantDrift&&fastEnough&&Math.abs(steer)>.15&&!this.drifting){
        this.drifting=true; this.driftDir=Math.sign(steer); this.driftCharge=0;
        if(this.isPlayer){ AUDIO.skidStart(); HAPTIC.tap(); }
      }
      if(this.drifting){
        // The drift lives as long as DRIFT is held. Counter-steering tightens or
        // opens the slide rather than cancelling it — one stray frame of opposite
        // input must never dump the charge, or the mechanic feels broken.
        if(!wantDrift||this.speed<12){
          this.releaseDrift();
        } else {
          this.driftCharge=Math.min(CFG.driftTiers[2],
            this.driftCharge+dt*CFG.driftChargeRate*(0.72+Math.abs(steer)*0.5));
          let tier=0;
          for(let i=0;i<CFG.driftTiers.length;i++) if(this.driftCharge>=CFG.driftTiers[i]) tier=i+1;
          if(tier!==this.driftTier){
            this.driftTier=tier;
            if(this.isPlayer&&tier>0){ AUDIO.tone(500+tier*220,.11,'square',.16); HAPTIC.tap(); }
          }
        }
      }
    } else if(this.drifting) this.releaseDrift(false);

    if(this.isPlayer&&this.drifting) AUDIO.skidUpdate(clamp(this.driftCharge/2.6,0,1));

    // ── Steering
    this.steerSm=damp(this.steerSm,steer,13,dt);
    const spd01=clamp(this.speed/CFG.topSpeed,0,1.4);
    // authority ramps in at low speed, tapers at the top end for stability
    const auth=(.42+.58*smoothstep(0,.28,spd01))*(1-.26*spd01);
    let rate=CFG.steerRate*auth;
    let turn=this.steerSm*rate;
    if(this.drifting){
      turn = (this.steerSm*CFG.driftSteerIn + this.driftDir*CFG.driftSteerBias)
             *rate*CFG.driftSteerMul;
    }
    if(this.spinT>0) turn=(CFG.hitSpinTime-this.spinT>0?1:1)*Math.PI*2/CFG.hitSpinTime*.85;
    this.heading+=turn*dt;

    // ── Longitudinal
    const throttle = (raceLive&&!this.finished&&this.spinT<=0)?1:(this.finished?0:0);
    let acc;
    if(this.boostT>0){
      this.boostT-=dt;
      acc=CFG.boostAcc[this.boostTier-1];
      if(this.boostT<=0) this.boostTier=0;
    } else {
      acc=CFG.accel*throttle;
    }
    if(this.spinT>0) acc=0;
    if(this.ai) acc*=this.ai.throttleMul;
    // drifting scrubs a little speed; off-track is heavily penalised
    const scrub=this.drifting?CFG.driftScrub:0;
    const offPen=this.offTrack>0?15:0;
    this.speed += (acc - this.speed*this.speed*CFG.dragK - CFG.rollRes - scrub - offPen)*dt;
    this.speed=clamp(this.speed,0,this.topSpeed);

    // ── Integrate position
    const sinH=Math.sin(this.heading), cosH=Math.cos(this.heading);
    this.pos.x+=sinH*this.speed*dt;
    this.pos.z+=cosH*this.speed*dt;

    // ── Track projection, walls, surface
    this.resolveTrack(dt,raceLive);
    // ── Kart-vs-kart
    this.resolveKarts();
    // ── Visuals
    this.syncVisual(dt);
    // ── Emissions
    this.emit(dt);
  }
  releaseDrift(grantBoost = true): void {
    if(!this.drifting) return;
    this.drifting=false;
    const tier=this.driftTier;
    if(grantBoost&&tier>0){
      this.applyBoost(tier);
      this.speed=Math.max(this.speed,CFG.topSpeed*(.94+tier*.045));
      if(this.isPlayer){ AUDIO.turbo(tier); HAPTIC.turbo(); this.game.cam.punch(.42+tier*.2); }
      else AUDIO.turbo(tier);
      this.game.fx.turboBurst(this,tier);
    }
    this.driftCharge=0; this.driftTier=0;
    if(this.isPlayer) AUDIO.skidStop();
  }
  /** Start (or extend) a turbo at the given tier. */
  applyBoost(tier: number): void {
    tier=clamp(tier,1,3);
    this.boostTier=Math.max(this.boostTier,tier);
    this.boostT=Math.max(this.boostT,CFG.boostDur[this.boostTier-1]);
  }
  giveBoost(tier: number): void {
    this.applyBoost(tier);
    this.speed=Math.max(this.speed,CFG.topSpeed*1.02);
    if(this.isPlayer){ AUDIO.turbo(2); HAPTIC.turbo(); this.game.cam.punch(.6); }
    this.game.fx.turboBurst(this,2);
  }
  resolveTrack(dt: number, raceLive: boolean): void {
    const pr=PATH.project(this.pos,this.trackIdx,this._proj);
    this.trackIdx=pr.idx;
    const halfW=pr.fr.width*.5;
    const limit=halfW-CFG.kartRadius*.85;
    this.lat=pr.lat;

    // wall collision
    if(Math.abs(pr.lat)>limit){
      const over=Math.abs(pr.lat)-limit, sgn=Math.sign(pr.lat);
      this.pos.addScaledVector(pr.fr.right,-sgn*over*1.02);
      // glancing blows barely slow you; head-on hits do
      const dirDot=Math.abs(Math.sin(this.heading)*pr.fr.right.x+Math.cos(this.heading)*pr.fr.right.z);
      const severity=clamp(dirDot,0,1);
      this.speed*=lerp(.985,.62,severity);
      this.heading-=angleDiff(this.heading-Math.atan2(pr.fr.tan.x,pr.fr.tan.z))*severity*CFG.wallBounce*dt*34;
      if(severity>.22&&this.bumpCool!==true){
        this.bumpCool=true; setTimeout(()=>{this.bumpCool=false;},170);
        this.game.fx.burst(this.pos,'#fff4e6',7,4);
        if(this.isPlayer){ AUDIO.bump(); HAPTIC.bump(); this.game.cam.shake(severity*.24); }
      }
      if(this.drifting&&severity>.5) this.releaseDrift();
      this.offTrack=0;
      // anti-stuck: if scraping a wall very slowly for too long, nudge free
      if(this.speed<7){ this.stuckT+=dt; } else this.stuckT=0;
      if(this.stuckT>1.6){
        this.stuckT=0;
        this.heading=Math.atan2(pr.fr.tan.x,pr.fr.tan.z);
        this.pos.copy(pr.fr.pos).addScaledVector(pr.fr.right,clamp(pr.lat,-limit*.5,limit*.5));
        this.speed=Math.max(this.speed,14);
      }
    } else {
      this.offTrack=0; this.stuckT=0;
    }
    // stick to the road surface
    const pr2=PATH.project(this.pos,this.trackIdx,this._proj);
    this.pos.y=pr2.y;
    this.surfBank=pr2.fr.bank;
    this.surfPitch=Math.asin(clamp(pr2.fr.tan.y,-1,1));

    // ── Lap / sector logic.
    // The sector gate means a lap only counts after the kart has actually
    // travelled through all four quarters — you can't reverse over the line
    // to farm laps. secOld must be read before the sector advances, otherwise
    // the wrap itself clears the very state the lap check is testing for.
    const s=pr2.s, L=PATH.len;
    const secOld=this.sector|0;
    const secNow=Math.floor(clamp(s/L,0,.9999)*4);
    const d=s-this.prevS;
    if(raceLive&&!this.finished){
      if(d<-L*.5){                              // wrapped forwards over the line
        if(secOld===3){ this.lap++; this.game.onLapComplete(this); }
        this.sector=0;                          // (grid start sits in sector 3 but
      } else if(d>L*.5){                        //  begins at sector 0, so the very
        this.lap=Math.max(1,this.lap-1);        //  first crossing correctly scores
        this.sector=3;                          //  nothing)
      } else if(secNow===(secOld+1)%4){
        this.sector=secNow;
      }
      // wrong-way nag
      const fwd=Math.sin(this.heading)*pr2.fr.tan.x+Math.cos(this.heading)*pr2.fr.tan.z;
      this.wrongWay = fwd<-.25 ? this.wrongWay+dt : 0;
    } else if(secNow===(secOld+1)%4) this.sector=secNow;
    this.prevS=s; this.s=s;
    this.progress=(this.lap-1)*L+s;
  }
  resolveKarts(): void {
    const K=this.game.karts;
    for(let i=0;i<K.length;i++){
      const o=K[i]!; if(o===this) continue;
      const dx=o.pos.x-this.pos.x, dz=o.pos.z-this.pos.z;
      const d2=dx*dx+dz*dz, R=CFG.kartRadius*2;
      if(d2>R*R||d2<1e-5) continue;
      const d=Math.sqrt(d2), push=(R-d)*.5;
      const nx=dx/d, nz=dz/d;
      this.pos.x-=nx*push; this.pos.z-=nz*push;
      o.pos.x+=nx*push;    o.pos.z+=nz*push;
      // side-swipe scrub — the faster kart keeps more momentum
      const rel=this.speed-o.speed;
      if(rel>3){ this.speed-=rel*.06; o.speed+=rel*.045; }
      if(!this._nudgeCool){
        this._nudgeCool=true; setTimeout(()=>{this._nudgeCool=false;},220);
        this.game.fx.burst(_v1.set((this.pos.x+o.pos.x)/2,this.pos.y+1,(this.pos.z+o.pos.z)/2),'#fff4e6',5,4);
        if(this.isPlayer||o.isPlayer){ AUDIO.bump(); if(this.isPlayer) HAPTIC.bump(); }
      }
    }
  }
  /* ── Visual rig: lean, squat, wheel spin, drift yaw ── */
  syncVisual(dt: number): void {
    const v=this.vis;
    this.obj.position.copy(this.pos);
    // drift yaw offset — the kart points into the corner while sliding
    const targetYaw=this.drifting?-this.driftDir*.46:0;
    this.visYaw=damp(this.visYaw,targetYaw,dt?9:60,dt||1);
    // body roll from steering + bank
    const targetRoll=-this.steerSm*.09-(this.drifting?this.driftDir*.13:0)+(this.surfBank||0);
    this.visRoll=damp(this.visRoll,targetRoll,dt?7:60,dt||1);
    // pitch: squat under boost, dive when slowing
    const dv=(this.speed-(this._lastSpeed||this.speed))/Math.max(dt,1e-3);
    this._lastSpeed=this.speed;
    const targetPitch=clamp(-dv*.0032,-.08,.08)+(this.surfPitch||0)*-1;
    this.visPitch=damp(this.visPitch,targetPitch,dt?6:60,dt||1);

    this.obj.rotation.set(0,0,0);
    this.obj.rotateY(this.heading+this.visYaw);
    this.obj.rotateX(this.visPitch);
    this.obj.rotateZ(this.visRoll);

    // spin-out visual
    if(this.spinT>0){
      const t=1-this.spinT/CFG.hitSpinTime;
      this.obj.rotateY(t*Math.PI*2);
      this.obj.rotateZ(Math.sin(t*Math.PI*3)*.12);
    }
    // suspension bob
    this.bodyBob=damp(this.bodyBob,this.drifting?.06:0,8,dt||1);
    const bounce=Math.sin(performance.now()*.011)*.02*clamp(this.speed/50,0,1);
    v.chassis.position.y=.86+this.bodyBob+bounce;

    // wheels
    this.wheelSpin+=this.speed*dt*1.3;
    const steerAng=this.steerSm*.42+(this.drifting?this.driftDir*.3:0);
    for(const w of v.wheels){
      w.spinG.rotation.x=this.wheelSpin/(w.R||.75);
      if(w.front) w.steerG.rotation.y=steerAng;
    }
    v.wheelGrp.rotation.z=-this.steerSm*1.05;
    // driver lean + look-into-corner
    v.hipG.rotation.z=-this.steerSm*.17-(this.drifting?this.driftDir*.24:0);
    v.hipG.rotation.x=clamp(this.speed/CFG.topSpeed,0,1)*.1+(this.boosting?.09:0);
    v.headG.rotation.y=this.steerSm*.42+(this.drifting?this.driftDir*.3:0);
    v.headG.rotation.z=-this.steerSm*.1;
    for(let i=0;i<v.arms.length;i++) v.arms[i].rotation.z=-this.steerSm*.3*(i?1:1);
    // emblem pulse when an item is ready
    v.emblem.rotation.z+=dt*(this.item>=0?5:1.2);
    if(this.shieldMesh){
      this.shieldMesh.rotation.y+=dt*1.6;
      const p=.22+Math.sin(performance.now()*.006)*.09;
      (this.shieldMesh.material as THREE.MeshStandardMaterial).opacity=this.shield<1.4?p*(this.shield/1.4):p;
      this.shieldMesh.scale.setScalar(1+Math.sin(performance.now()*.004)*.04);
    }
  }
  /* ── Particle emission ── */
  emit(dt: number): void {
    const fx=this.game.fx;
    const back=_v1.set(-Math.sin(this.heading),0,-Math.cos(this.heading));
    // drift sparks
    if(this.drifting&&this.speed>16){
      this.driftPartT-=dt;
      if(this.driftPartT<=0){
        this.driftPartT=0.026;
        const tier=this.driftTier;
        const col=tier>=3?[1,.37,.66]:tier>=2?[1,.84,.29]:tier>=1?[.34,.9,.78]:[1,.96,.9];
        for(const sx of [-1,1]){
          const wx=this.pos.x+Math.cos(this.heading)*sx*1.5-Math.sin(this.heading)*1.5;
          const wz=this.pos.z-Math.sin(this.heading)*sx*1.5-Math.cos(this.heading)*1.5;
          fx.drift.spawn(wx,this.pos.y+.32,wz,
            back.x*rand(3,10)+rand(-4,4), rand(1.6,5.4), back.z*rand(3,10)+rand(-4,4),
            col[0],col[1],col[2], rand(.28,.5), rand(.45,.85), .45, -4.5, 2.2, .45);
        }
        if(tier>0&&Math.random()<.5){
          fx.spark.spawn(this.pos.x+rand(-1.6,1.6),this.pos.y+.5,this.pos.z+rand(-1.6,1.6),
            rand(-6,6),rand(4,11),rand(-6,6), col[0],col[1],col[2], rand(.2,.42), rand(.3,.6),.55,-11,1.2,0);
        }
      }
    }
    // exhaust / turbo trail
    this.smokeT-=dt;
    if(this.smokeT<=0){
      this.smokeT=this.boosting?.012:.075;
      for(const ex of this.vis.exhausts){
        _v2.copy(ex).applyQuaternion(this.obj.quaternion).add(this.pos);
        if(this.boosting){
          const t=this.boostTier||2;
          fx.spark.spawn(_v2.x,_v2.y,_v2.z, back.x*rand(9,22)+rand(-2.6,2.6), rand(.6,3.4), back.z*rand(9,22)+rand(-2.6,2.6),
            1, t>=3?.42:.78, t>=3?.72:.24, rand(.24,.46), rand(.5,.95),.6,1.6,1.9,1.0);
          if(Math.random()<.5)
            fx.smoke.spawn(_v2.x,_v2.y,_v2.z, back.x*rand(3,9), rand(1.4,3.4), back.z*rand(3,9),
              1,.92,.84, rand(.5,.9), rand(.7,1.3),.2,1.4,1.5,1.5);
        } else if(this.speed>4){
          fx.smoke.spawn(_v2.x,_v2.y,_v2.z, back.x*rand(1.4,4)+rand(-1,1), rand(.7,1.9), back.z*rand(1.4,4)+rand(-1,1),
            1,.94,.9, rand(.35,.6), rand(.4,.8),.15,1.2,1.7,1.3);
        }
      }
    }
  }
}
