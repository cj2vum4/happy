import * as THREE from 'three';
import { AUDIO } from '@/core/audio';
import { clamp, rand, smoothstep, angleDiff } from '@/core/math';
import { _v1 } from '@/core/scratch';
import { GEO } from '@/render/geom';
import { PATH } from '@/track/path';
import { rollItem, type ItemId } from '@/content/items';
import { TrackPath, type Projection, type TrackFrame } from '@/track/TrackPath';
import type { Game } from './Game';
import type { Kart } from './Kart';

/** A Mystery Candy box waiting on the track. */
interface Box {
  /** Arc length around the lap. */
  s: number;
  /** Lateral offset from the centreline. */
  off: number;
  pos: THREE.Vector3;
  y: number;
  /** Seconds until it respawns; 0 means available. */
  cool: number;
  spin: number;
}

/** A pooled projectile model: sphere plus spinning ring. */
interface Projectile {
  obj: THREE.Group;
  body: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  ring: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
}

/** One projectile in flight. */
interface Live {
  p: Projectile;
  id: ItemId;
  owner: Kart;
  life: number;
  /** Collision radius. */
  r: number;
  /** True for the seeker, which steers toward whoever is ahead. */
  home: boolean;
  vx: number;
  vz: number;
  /** Speed; 0 for a dropped trap, which never moves. */
  sp: number;
  heading: number;
  target: Kart | null;
  /** Seconds before a trap can hurt its own owner. */
  armed: number;
  trackIdx: number;
  spin: number;
}

/**
 * Mystery Candy boxes and everything fired out of them.
 *
 * Boxes are three InstancedMeshes rewritten each frame rather than 33 separate
 * objects, and projectiles come from a pool, so a busy final lap allocates
 * nothing.
 */
export class ItemSystem {
  private readonly g: Game;
  readonly live: Live[] = [];
  private readonly boxes: Box[] = [];
  private readonly pool: Projectile[] = [];
  private shellIM!: THREE.InstancedMesh;
  private coreIM!: THREE.InstancedMesh;
  private wrapIM!: THREE.InstancedMesh;
  /** The glowing core inside each box, pulsed every frame. */
  private boxCoreM!: THREE.MeshStandardMaterial;
  private readonly _bm = new THREE.Matrix4();
  private readonly _bq = new THREE.Quaternion();
  private readonly _be = new THREE.Euler();
  private readonly _bp = new THREE.Vector3();
  private readonly _bs = new THREE.Vector3();
  private readonly _proj: Projection = TrackPath.emptyProjection();
  private readonly _fr: TrackFrame = TrackPath.emptyFrame();

  constructor(game: Game){
    this.g=game;
    this.buildBoxes();
  }
  private buildBoxes(): void {
    // Rows of Mystery Candy at readable spots around the lap.
    // Rendered as three InstancedMeshes whose matrices are refreshed each frame.
    const SPOTS=[.075,.16,.245,.335,.425,.505,.60,.685,.775,.865,.94];
    const OFF=[-7.4,0,7.4];
    for(const t of SPOTS) for(const o of OFF){
      const s=t*PATH.len;
      const p=PATH.posAt(s,o,new THREE.Vector3());
      this.boxes.push({s,off:o,pos:p.clone().setY(p.y+2.5),y:p.y+2.5,cool:0,spin:Math.random()*7});
    }
    const n=this.boxes.length;
    const shellM=new THREE.MeshPhysicalMaterial({color:0xffe8f4,transparent:true,opacity:.4,
      roughness:.03,metalness:0,clearcoat:1,side:THREE.DoubleSide,depthWrite:false});
    const coreM=new THREE.MeshStandardMaterial({color:0xff4f9a,emissive:0xff4f9a,emissiveIntensity:1.5,roughness:.2});
    const wrapM=new THREE.MeshStandardMaterial({color:0xfff4e6,emissive:0xffd54a,emissiveIntensity:.5,roughness:.35});
    const S=this.g.scene;
    this.shellIM=new THREE.InstancedMesh(new THREE.SphereGeometry(1.5,14,11),shellM,n);
    this.coreIM =new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.86,0),coreM,n);
    this.wrapIM =new THREE.InstancedMesh(new THREE.ConeGeometry(.62,1.1,7),wrapM,n*2);
    for(const im of [this.shellIM,this.coreIM,this.wrapIM]){ im.frustumCulled=false; S.add(im); }
    this.shellIM.renderOrder=4;
    this.boxCoreM=coreM;
    this.refreshBoxes(0);
  }
  /** Rewrite every box matrix — bob, spin, and pickup pop-in. */
  private refreshBoxes(t: number): void {
    const m=this._bm,q=this._bq,e=this._be,p=this._bp,s=this._bs;
    for(let i=0;i<this.boxes.length;i++){
      const b=this.boxes[i]!;
      let sc=1;
      if(b.cool>0) sc = b.cool>5.2 ? 0 : smoothstep(0,1,clamp(1-b.cool/5.2,0,1));
      const y=b.y+(sc>0?Math.sin(t*2.1+b.s*.05)*.42:0);
      const spin=b.spin+t*1.5;
      p.set(b.pos.x,y,b.pos.z);
      e.set(0,spin,0); q.setFromEuler(e);
      s.set(sc*1,sc*1,sc*1);
      m.compose(p,q,s); this.shellIM.setMatrixAt(i,m);
      e.set(t*2.2+i,spin,t*1.4); q.setFromEuler(e);
      s.setScalar(sc); m.compose(p,q,s); this.coreIM.setMatrixAt(i,m);
      for(let k=0;k<2;k++){
        const sx=k?1:-1;
        p.set(b.pos.x+Math.cos(spin)*sx*1.9, y, b.pos.z-Math.sin(spin)*sx*1.9);
        e.set(0,spin,sx*Math.PI/2); q.setFromEuler(e);
        s.setScalar(sc); m.compose(p,q,s);
        this.wrapIM.setMatrixAt(i*2+k,m);
      }
    }
    this.shellIM.instanceMatrix.needsUpdate=true;
    this.coreIM.instanceMatrix.needsUpdate=true;
    this.wrapIM.instanceMatrix.needsUpdate=true;
  }
  reset(): void {
    for(const pr of this.live) this.despawn(pr.p);
    this.live.length=0;
    for(const b of this.boxes) b.cool=0;
    this.refreshBoxes(0);
  }
  private _get(): Projectile {
    let p=this.pool.pop();
    if(!p){
      const G=new THREE.Group();
      const body=new THREE.Mesh(GEO.sphere,new THREE.MeshStandardMaterial({roughness:.2,emissiveIntensity:1.1}));
      G.add(body);
      const ring=new THREE.Mesh(GEO.torus,new THREE.MeshStandardMaterial({roughness:.25,emissiveIntensity:.9}));
      ring.scale.set(1.5,1.5,.5); G.add(ring);
      p={
        obj:G,
        body: body as Projectile['body'],
        ring: ring as Projectile['ring'],
      };
      this.g.scene.add(G);
    }
    p.obj.visible=true;
    return p;
  }
  private despawn(p: Projectile): void {
    p.obj.visible=false; this.pool.push(p);
  }
  fire(owner: Kart, id: ItemId): void {
    const g=this.g;
    if(id==='boost'){ owner.giveBoost(2); return; }
    if(id==='shield'){ owner.setShield(8); if(owner.isPlayer){AUDIO.shieldUp();} return; }
    const fwd=_v1.set(Math.sin(owner.heading),0,Math.cos(owner.heading));
    const p=this._get();
    const conf={
      seeker:{c:0xff4f9a,sp:74,life:6.5,r:2.6,home:true,  y:1.6, fwd: 3.4, scale:1.05},
      bolt:  {c:0xffd54a,sp:118,life:3.2,r:2.2,home:false,y:1.3, fwd: 3.4, scale:.86},
      trap:  {c:0x8b5a2b,sp:0,  life:22, r:2.7,home:false,y:.9,  fwd:-4.2, scale:1.15},
    }[id as 'seeker'|'bolt'|'trap'];
    p.body.material.color.setHex(conf.c); p.body.material.emissive.setHex(conf.c);
    p.ring.material.color.setHex(0xfff4e6); p.ring.material.emissive.setHex(0xfff4e6);
    p.body.scale.setScalar(conf.scale);
    p.obj.position.copy(owner.pos).addScaledVector(fwd,conf.fwd).setY(owner.pos.y+conf.y);
    const proj: Live={
      p, id, owner, life:conf.life, r:conf.r, home:conf.home,
      vx:fwd.x*conf.sp, vz:fwd.z*conf.sp, sp:conf.sp,
      heading:owner.heading, target:null, armed:id==='trap'?.4:0, trackIdx:owner.trackIdx,
      spin:0,
    };
    if(conf.home) proj.target=g.nextAhead(owner);
    this.live.push(proj);
    if(id==='trap') g.fx.burst(p.obj.position,'#c98f4a',10,4);
  }
  update(dt: number): void {
    const g=this.g;
    // ── Mystery Candy boxes
    for(const b of this.boxes){
      if(b.cool>0){ b.cool-=dt; continue; }
      for(const k of g.karts){
        if(k.finished) continue;
        const dx=k.pos.x-b.pos.x, dz=k.pos.z-b.pos.z, dy=k.pos.y+1.2-b.pos.y;
        if(dx*dx+dz*dz<13 && Math.abs(dy)<4.5){
          b.cool=5.5;
          g.fx.burst(b.pos,'#ff4f9a',26,8);
          g.fx.burst(b.pos,'#ffd54a',18,6);
          const free=k.item<0&&k.rolling<=0;
          if(free) k.giveItem(rollItem(k.place));
          else if(k.isPlayer) AUDIO.pickup();
          break;
        }
      }
    }
    this.refreshBoxes(g.clock);
    // ── Projectiles
    for(let i=this.live.length-1;i>=0;i--){
      const pr=this.live[i]!;
      pr.life-=dt; if(pr.armed>0) pr.armed-=dt;
      const o=pr.p.obj;
      if(pr.life<=0){ this.despawn(pr.p); this.live.splice(i,1); continue; }
      pr.spin+=dt*7; pr.p.ring.rotation.z=pr.spin; pr.p.body.rotation.y=pr.spin*.6;

      if(pr.sp>0){
        if(pr.home){
          if(!pr.target||pr.target.finished) pr.target=g.nextAhead(pr.owner);
          if(pr.target){
            const dx=pr.target.pos.x-o.position.x, dz=pr.target.pos.z-o.position.z;
            const want=Math.atan2(dx,dz);
            pr.heading+=angleDiff(want-pr.heading)*clamp(dt*3.4,0,1);
          } else {
            // no target: hug the racing line
            const fr=PATH.frameAtS(PATH.project(o.position,pr.trackIdx,this._proj).s+12,this._fr);
            pr.heading+=angleDiff(Math.atan2(fr.tan.x,fr.tan.z)-pr.heading)*clamp(dt*2.4,0,1);
          }
          pr.vx=Math.sin(pr.heading)*pr.sp; pr.vz=Math.cos(pr.heading)*pr.sp;
        }
        o.position.x+=pr.vx*dt; o.position.z+=pr.vz*dt;
        const p2=PATH.project(o.position,pr.trackIdx,this._proj);
        pr.trackIdx=p2.idx;
        o.position.y=p2.y+ (pr.home?1.6:1.3) + Math.sin(g.clock*9+i)*.16;
        // die on walls
        if(Math.abs(p2.lat)>p2.fr.width*.5+1){
          g.fx.burst(o.position,'#fff4e6',16,6); AUDIO.bump();
          this.despawn(pr.p); this.live.splice(i,1); continue;
        }
        if(Math.random()<.55)
          g.fx.spark.spawn(o.position.x,o.position.y,o.position.z,rand(-3,3),rand(-1,3),rand(-3,3),
            1,.6,.8,rand(.2,.4),rand(.4,.8),1,-2,2,0);
      } else {
        o.position.y=PATH.project(o.position,pr.trackIdx,this._proj).y+.9;
        o.rotation.y+=dt*.8;
      }
      // ── Hit test
      for(const k of g.karts){
        if(k===pr.owner&&pr.armed>0) continue;
        if(k===pr.owner&&pr.id==='trap'&&pr.life>21.2) continue;
        if(k.finished) continue;
        const dx=k.pos.x-o.position.x, dz=k.pos.z-o.position.z;
        if(dx*dx+dz*dz<pr.r*pr.r+3){
          if(k===pr.owner&&pr.id!=='trap') continue;
          k.takeHit(pr.owner);
          g.fx.burst(o.position,'#fff4e6',30,9);
          g.fx.burst(o.position,'#ff4f9a',20,7);
          this.despawn(pr.p); this.live.splice(i,1);
          break;
        }
      }
    }
    this.boxCoreM.emissiveIntensity=1.3+Math.sin(g.clock*4)*.4;
  }
}
