import * as THREE from 'three';
import { CFG } from '@/core/config';
import { clamp, damp, lerp, smoothstep } from '@/core/math';
import { _v1 } from '@/core/scratch';
import { PATH } from '@/track/path';
import { TrackPath, type Projection } from '@/track/TrackPath';

/**
 * What the camera needs from whatever it is following. Declared structurally
 * rather than as `Kart` so the rig stays independent of the simulation — the
 * title and results shots follow things that are not karts.
 */
export interface CameraTarget {
  pos: THREE.Vector3;
  heading: number;
  /** Visual yaw offset during a drift; the body points off the direction of travel. */
  visYaw: number;
  speed: number;
  boosting: boolean;
  drifting: boolean;
  driftDir: number;
  /** Smoothed steer input, -1..1. */
  steerSm: number;
  trackIdx: number;
}

export type CamMode = 'chase' | 'intro' | 'orbit' | 'title';

export class CamRig {
  readonly cam: THREE.PerspectiveCamera;
  readonly pos = new THREE.Vector3();
  readonly look = new THREE.Vector3();
  shakeAmt = 0;
  punchAmt = 0;
  fov = 62;
  lateral = 0;
  mode: CamMode = 'chase';
  orbT = 0;
  private readonly _cp: Projection = TrackPath.emptyProjection();
  private _look: THREE.Vector3 | null = null;
  _roll = 0;
  constructor(cam: THREE.PerspectiveCamera){
    this.cam=cam;
  }
  snap(kart: CameraTarget): void {
    this._compute(kart,1,true);
    this.cam.position.copy(this.pos); this.cam.lookAt(this.look);
  }
  shake(a: number): void { this.shakeAmt=Math.min(1.1,this.shakeAmt+a); }
  punch(a: number): void { this.punchAmt=Math.min(1.3,this.punchAmt+a); }
  private _compute(k: CameraTarget, dt: number, instant: boolean): void {
    const spd01=clamp(k.speed/CFG.topSpeed,0,1.5);
    const boost=k.boosting?1:0;
    // pull back + rise with speed
    const dist=8.5+spd01*2.5+boost*2.0+(k.drifting?.75:0);
    const hgt =3.95+spd01*.8+boost*.3;
    // lateral swing: camera trails the drift/steer
    const wantLat=(k.drifting? k.driftDir*2.9 : k.steerSm*1.35);
    this.lateral=instant?wantLat:damp(this.lateral,wantLat,3.6,dt);
    const yaw=k.heading+k.visYaw*.42;
    const bx=-Math.sin(yaw), bz=-Math.cos(yaw);
    const rx= Math.cos(yaw), rz=-Math.sin(yaw);
    this.pos.set(
      k.pos.x+bx*dist+rx*this.lateral,
      k.pos.y+hgt,
      k.pos.z+bz*dist+rz*this.lateral);
    // Keep the camera inside the track corridor and above the surface. Without
    // the lateral clamp it swings past the barrier on wide drifts and ends up
    // inside the scenery — a lollipop through the lens reads as a broken game.
    const cp=PATH.project(this.pos,k.trackIdx,this._cp);
    const maxLat=cp.fr.width*.5+1.5;
    if(Math.abs(cp.lat)>maxLat)
      this.pos.addScaledVector(cp.fr.right,-Math.sign(cp.lat)*(Math.abs(cp.lat)-maxLat));
    if(this.pos.y<cp.y+2.6) this.pos.y=cp.y+2.6;
    this.look.set(
      k.pos.x-bx*(12+spd01*6)-rx*this.lateral*.34,
      k.pos.y+1.85,
      k.pos.z-bz*(12+spd01*6)-rz*this.lateral*.34);
  }
  update(dt: number, k: CameraTarget, phase: number): void {
    if(this.mode==='orbit'){ this.orbit(dt,k); return; }
    this._compute(k,dt,false);
    const lag=this.mode==='intro'?2.4:8.5;
    this.cam.position.lerp(this.pos,1-Math.exp(-lag*dt));
    this._look ??= new THREE.Vector3().copy(this.look);
    this._look.lerp(this.look,1-Math.exp(-11*dt));
    // ── shake / rumble
    this.shakeAmt=Math.max(0,this.shakeAmt-dt*2.6);
    this.punchAmt=Math.max(0,this.punchAmt-dt*3.4);
    const volcanoRumble=phase>1.05?(phase-1)*.16:0;
    const amt=this.shakeAmt*.85+volcanoRumble;
    if(amt>.001){
      const t=performance.now()*.001;
      this.cam.position.x+=Math.sin(t*47)*amt*.42;
      this.cam.position.y+=Math.sin(t*61+1.7)*amt*.34;
      this.cam.position.z+=Math.sin(t*53+3.1)*amt*.42;
    }
    this.cam.lookAt(this._look);
    // subtle roll into the corner
    const roll=-k.steerSm*.033-(k.drifting?k.driftDir*.045:0);
    this._roll=damp(this._roll,roll,6,dt);
    this.cam.rotateZ(this._roll);
    // ── FOV
    const spd01=clamp(k.speed/CFG.topSpeed,0,1.5);
    const wantFov=62+spd01*6.5+(k.boosting?9:0)+this.punchAmt*7;
    this.fov=damp(this.fov,wantFov,7,dt);
    if(Math.abs(this.cam.fov-this.fov)>.02){ this.cam.fov=this.fov; this.cam.updateProjectionMatrix(); }
  }
  startOrbit(): void { this.mode='orbit'; this.orbT=0; }
  orbit(dt: number, k: CameraTarget): void {
    this.orbT+=dt;
    const a=this.orbT*.62+Math.PI*.35;
    const d=lerp(15,9.4,smoothstep(0,2.4,this.orbT));
    const h=lerp(7.5,3.5,smoothstep(0,3,this.orbT));
    this.cam.position.set(k.pos.x+Math.cos(a)*d, k.pos.y+h, k.pos.z+Math.sin(a)*d);
    _v1.copy(k.pos).setY(k.pos.y+1.7);
    this.cam.lookAt(_v1);
    this.fov=damp(this.fov,54,3,dt);
    this.cam.fov=this.fov; this.cam.updateProjectionMatrix();
  }
  /** Slow drifting sweep over the Candy Village start straight, volcano behind. */
  titleShot(t: number): void {
    this.mode='title';
    const a=.72+Math.sin(t*.05)*.30;           // gentle arc, never a full spin
    const R=118;
    const cx=6, cz=330;                        // the start / finish area
    this.cam.position.set(cx+Math.sin(a)*R, 15+Math.sin(t*.19)*3.0, cz+Math.cos(a)*R);
    _v1.set(-52, 102, cz-250);                 // look high so the crater clears the logo
    this.cam.lookAt(_v1);
    if(this.cam.fov!==56){ this.cam.fov=56; this.cam.updateProjectionMatrix(); }
    this.fov=56;
  }
}
