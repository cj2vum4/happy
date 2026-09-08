import * as THREE from 'three';
import { CFG } from '@/core/config';
import { clamp, lerp, damp, angleDiff, rand } from '@/core/math';
import { _v4 } from '@/core/scratch';
import { PATH } from '@/track/path';
import { ITEMS } from '@/content/items';
import type { AIProfile } from '@/content/racers';
import type { Kart } from './Kart';
import { TrackPath, type TrackFrame } from '@/track/TrackPath';

/** What the brain hands back to the kart each frame — the same shape a human's
 *  input produces, so `Kart` drives identically whoever is steering. */
export interface AIIntent {
  steer: number;
  drift: boolean;
}

/**
 * One rival's driving. Reads the circuit ahead, picks a lane and a corner
 * speed, and decides whether this corner is worth drifting.
 */
export class AIBrain {
  private readonly k: Kart;
  private readonly c: AIProfile;
  /** 0, 0.38 or 1 — the kart multiplies its acceleration by this. */
  throttleMul = 1;
  private readonly noiseSeed = Math.random()*100;
  private lane = 0;
  private laneTarget = 0;
  private laneT = 0;
  private itemT = 0;
  private mistakeT = 0;
  private mistakeCool = 0;
  private readonly _fr: TrackFrame = TrackPath.emptyFrame();
  constructor(kart: Kart, cfg: AIProfile){
    this.k=kart; this.c=cfg;
    this.reset();
  }
  reset(): void {
    this.lane=this.c.lane; this.laneTarget=this.c.lane;
    this.laneT=rand(1.5,4); this.itemT=rand(.6,2.2);
    this.throttleMul=1; this.mistakeT=0; this.mistakeCool=rand(6,16);
  }
  /** Steer back toward the racing line — also used post-finish. */
  steerToLine(): number {
    const k=this.k;
    const look=14+k.speed*.42;
    const tp=PATH.posAt(k.s+look,this.lane,_v4);
    return this._steerTo(tp);
  }
  private _steerTo(target: THREE.Vector3): number {
    const k=this.k;
    const dx=target.x-k.pos.x, dz=target.z-k.pos.z;
    const local = Math.atan2(dx,dz);
    return clamp(angleDiff(local-k.heading)*2.9,-1,1);
  }
  update(dt: number): AIIntent {
    const k=this.k, g=k.game, t=g.clock;
    // ── Racing line: drift toward the inside of the coming corner
    const curvAhead=PATH.maxCurvAhead(k.s,14+k.speed*.34);
    const inside=-Math.sign(curvAhead)*clamp(Math.abs(curvAhead)*620,0,5.0);
    // personality lane wander
    this.laneT-=dt;
    if(this.laneT<=0){
      this.laneT=rand(1.6,3.6);
      this.laneTarget=clamp(this.c.lane+rand(-4,4),-8.5,8.5);
    }
    // ── Avoid the kart directly ahead (simple overtake logic)
    let avoid=0;
    for(const o of g.karts){
      if(o===k) continue;
      const ds=o.progress-k.progress;
      if(ds>0&&ds<17){
        const dlat=o.lat-k.lat;
        if(Math.abs(dlat)<4.6){
          // pick the side with more room
          avoid = (o.lat>0? -1:1) * lerp(3.5,7.5,this.c.aggro) * (1-ds/17);
        }
      }
    }
    const noise=Math.sin(t*.7+this.noiseSeed)*1.5+Math.sin(t*1.9+this.noiseSeed*2)*.7;
    // Lane offsets have to scale with the local road: a fixed +/-9.5 put the AI
    // against the barrier on the narrowed hairpins, where the half-width is ~10.
    const halfW=PATH.frameAtS(k.s,this._fr).width*.5;
    const laneMax=Math.max(2.5,halfW-4.5);
    this.lane=damp(this.lane,clamp(this.laneTarget*.45+inside+avoid+noise,-laneMax,laneMax),2.6,dt);

    // Aim closer the tighter the corner. A lookahead sized for a fast sweeper
    // points straight across a hairpin apex, which walks the kart into the
    // inside barrier — that alone was a quarter of their lap in wall contact.
    const tight=clamp(Math.abs(curvAhead)/0.028,0,1);
    const look=lerp(13+k.speed*.44, 9+k.speed*.17, tight);
    const tp=PATH.posAt(k.s+look,this.lane,_v4);
    let steer=this._steerTo(tp);

    // ── Corner speed management.
    // A kart turning at omega rad/s can hold a corner of curvature c up to
    // v = omega/c. Deriving the target from the real steering limit (with a
    // safety margin) instead of a guessed curve keeps the AI on the pace —
    // this circuit is fast enough that only the tightest corners need lifting.
    const cAbs=Math.abs(curvAhead);
    const OMEGA=1.72;                      // ≈ steerRate × high-speed authority
    // While drifting the yaw limit rises, so the same corner supports a higher
    // entry speed — without this the AI lifts for a corner it is about to drift.
    const omega=OMEGA*(k.drifting?CFG.driftSteerMul:1);
    let target = cAbs>1e-5 ? (omega/cAbs)*0.97 : CFG.topSpeed;
    target=clamp(target,32,CFG.topSpeed);
    target*=this.c.skill*g.rubber(k);
    // occasional believable mistake
    this.mistakeCool-=dt;
    if(this.mistakeCool<=0&&Math.random()<this.c.err*dt*3){
      this.mistakeT=rand(.35,.9); this.mistakeCool=rand(7,18);
    }
    if(this.mistakeT>0){ this.mistakeT-=dt; target*=.72; steer+=Math.sin(t*9)*.34; }
    // off-line recovery
    if(Math.abs(k.lat)>PATH.frameAtS(k.s,this._fr).width*.5-3.4) target*=.9;
    // Deadband around the target — lifting the instant you're a hair over it
    // costs far more lap time than the tiny bit of extra corner safety buys.
    if(k.speed>target*1.16)      this.throttleMul=0;
    else if(k.speed>target*1.04) this.throttleMul=.38;
    else                         this.throttleMul=1;

    // ── Drifting: personality-weighted, on genuinely tight corners
    // Sticky drift: entering needs a real corner and a real steering input, but
    // staying in only needs the corner to still be there. Without the hysteresis
    // the intent flickers frame to frame and no charge ever accumulates.
    const thr=lerp(.0132,.0062,this.c.drift);
    const enter = cAbs>thr && k.speed>30 && Math.abs(steer)>.22;
    // The exit threshold is floored: a drifter's entry threshold can sit below
    // the track's median curvature, and without the floor they would never stop
    // drifting — paying the scrub cost down every straight.
    const stay  = k.drifting && cAbs>Math.max(.0072,thr*.62) && k.speed>24;
    const wantDrift = (enter||stay) && this.mistakeT<=0;

    // ── Items
    this.itemT-=dt;
    if(k.item>=0&&this.itemT<=0){
      const id=ITEMS[k.item]!.id;
      let use=false;
      if(id==='boost') use = cAbs<.006 || k.place>2;
      else if(id==='shield') use = g.anyThreatNear(k) || Math.random()<.3;
      else if(id==='trap') use = k.place<=2 || Math.random()<.45;
      else use = g.hasTargetAhead(k,id==='bolt'?46:170) || Math.random()<.12;
      if(use){ k.useItem(); this.itemT=rand(1.4,3.4); }
      else this.itemT=this.c.itemHold*rand(.6,1.5);
    }
    return {steer:clamp(steer,-1,1),drift:wantDrift};
  }
}
