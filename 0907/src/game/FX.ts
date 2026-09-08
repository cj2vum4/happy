import * as THREE from 'three';
import { rand } from '@/core/math';
import { _v1, _c1 } from '@/core/scratch';
import { ParticlePool } from '@/render/ParticlePool';
import { TEX } from '@/render/textures';
import type { Quality } from '@/core/quality';

/** Anything that reads a kart's position for a particle effect. */
interface Emitter {
  pos: THREE.Vector3;
  heading: number;
}

/**
 * The four particle pools, sized from the quality tier and shared by everything
 * that emits: karts, items, the volcano.
 */
export class FX {
  readonly drift: ParticlePool;
  readonly spark: ParticlePool;
  readonly smoke: ParticlePool;
  readonly amb: ParticlePool;
  readonly pools: ParticlePool[];
  constructor(scene: THREE.Object3D, q: Quality){
    this.drift=new ParticlePool(scene,q.pDrift,TEX.spark,THREE.AdditiveBlending,0.5);
    this.spark=new ParticlePool(scene,q.pSpark,TEX.spark,THREE.AdditiveBlending,1.0);
    this.smoke=new ParticlePool(scene,q.pSmoke,TEX.puff,THREE.NormalBlending,1.5);
    this.amb  =new ParticlePool(scene,q.pAmb,  TEX.puff,THREE.NormalBlending,3.4);
    this.pools=[this.drift,this.spark,this.smoke,this.amb];
  }
  update(dt: number): void { for(const p of this.pools) p.update(dt); }
  clear(): void { for(const p of this.pools) p.clear(); }
  /** Omnidirectional spray — impacts, pickups, the finish line. */
  burst(pos: THREE.Vector3, hex: string, n: number, spread: number): void {
    _c1.set(hex);
    for(let i=0;i<n;i++){
      const a=Math.random()*Math.PI*2, e=rand(.15,1.3);
      this.spark.spawn(pos.x,pos.y+1,pos.z,
        Math.cos(a)*spread*rand(.4,1.6), e*spread*rand(.7,1.7), Math.sin(a)*spread*rand(.4,1.6),
        _c1.r,_c1.g,_c1.b, rand(.35,.8), rand(.5,1.2), 1, -13, 1.1, 0);
    }
  }
  /** Flame and smoke out of the exhausts when a charged drift is released. */
  turboBurst(kart: Emitter, tier: number): void {
    const back=_v1.set(-Math.sin(kart.heading),0,-Math.cos(kart.heading));
    const col: [number,number,number]=tier>=3?[1,.37,.66]:tier>=2?[1,.84,.29]:[.34,.9,.78];
    for(let i=0;i<26+tier*9;i++){
      this.spark.spawn(kart.pos.x,kart.pos.y+.9,kart.pos.z,
        back.x*rand(10,34)+rand(-7,7), rand(1,9), back.z*rand(10,34)+rand(-7,7),
        col[0],col[1],col[2], rand(.35,.8), rand(.5,1.05), .62, -3, 1.5, .9);
    }
    for(let i=0;i<12;i++){
      this.smoke.spawn(kart.pos.x,kart.pos.y+.7,kart.pos.z,
        back.x*rand(5,16)+rand(-4,4), rand(1,4), back.z*rand(5,16)+rand(-4,4),
        1,.95,.9, rand(.6,1.2), rand(.8,1.5), .26, 1.6, 1.4, 1.7);
    }
  }
}
