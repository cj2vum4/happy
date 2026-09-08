import * as THREE from 'three';

/**
 * Pooled GPU point sprites: one draw call per pool, zero per-frame allocation.
 *
 * Particles are a ring buffer — a spawn past the end overwrites the oldest,
 * which is the right failure mode for a racer. A burst of sparks losing its
 * tail is invisible at speed; a stutter from allocating is not.
 *
 * The typed arrays are held directly as well as through their BufferAttribute
 * so the update loop never walks the attribute's widened `array` union.
 */
export class ParticlePool {
  readonly n: number;
  i = 0;
  /** Velocities, xyz per particle. */
  readonly px: Float32Array;
  readonly life: Float32Array;
  readonly max: Float32Array;
  readonly grav: Float32Array;
  readonly drag: Float32Array;
  readonly grow: Float32Array;
  readonly baseA: Float32Array;
  readonly pts: THREE.Points;
  readonly aPos: THREE.BufferAttribute;
  readonly aCol: THREE.BufferAttribute;
  readonly aSiz: THREE.BufferAttribute;
  readonly aAlp: THREE.BufferAttribute;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly siz: Float32Array;
  private readonly alp: Float32Array;
  readonly baseSize: number;
  private _dirty = false;
  constructor(
    scene: THREE.Object3D,
    count: number,
    tex: THREE.Texture,
    blend: THREE.Blending,
    baseSize: number,
  ){
    this.n=count;
    const pos=new Float32Array(count*3), col=new Float32Array(count*3),
          siz=new Float32Array(count), alp=new Float32Array(count);
    this.px=new Float32Array(count*3);   // velocity
    this.life=new Float32Array(count); this.max=new Float32Array(count);
    this.grav=new Float32Array(count); this.drag=new Float32Array(count);
    this.grow=new Float32Array(count); this.baseA=new Float32Array(count);
    for(let k=0;k<count;k++){ pos[k*3+1]=-9999; }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.BufferAttribute(pos,3));
    g.setAttribute('color',new THREE.BufferAttribute(col,3));
    g.setAttribute('aSize',new THREE.BufferAttribute(siz,1));
    g.setAttribute('aAlpha',new THREE.BufferAttribute(alp,1));
    g.boundingSphere=new THREE.Sphere(new THREE.Vector3(),4000);
    const m=new THREE.ShaderMaterial({
      uniforms:{ map:{value:tex}, uScale:{value:520} },
      vertexColors:true, transparent:true, depthWrite:false, blending:blend,
      vertexShader:`
        attribute float aSize; attribute float aAlpha;
        varying float vA; varying vec3 vC; uniform float uScale;
        void main(){ vA=aAlpha; vC=color;
          vec4 mv=modelViewMatrix*vec4(position,1.0);
          gl_PointSize=aSize*(uScale/max(1.0,-mv.z));
          gl_Position=projectionMatrix*mv; }`,
      fragmentShader:`
        uniform sampler2D map; varying float vA; varying vec3 vC;
        void main(){ vec4 t=texture2D(map,gl_PointCoord);
          if(t.a*vA<0.004) discard;
          gl_FragColor=vec4(vC,t.a*vA); }`,
    });
    this.pts=new THREE.Points(g,m); this.pts.frustumCulled=false; this.pts.renderOrder=6;
    scene.add(this.pts);
    this.aPos=g.attributes.position as THREE.BufferAttribute;
    this.aCol=g.attributes.color as THREE.BufferAttribute;
    this.aSiz=g.attributes.aSize as THREE.BufferAttribute;
    this.aAlp=g.attributes.aAlpha as THREE.BufferAttribute;
    this.pos=pos; this.col=col; this.siz=siz; this.alp=alp;
    this.baseSize=baseSize;
  }
  spawn(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    r: number, g: number, b: number,
    life: number, size: number, alpha = 1, gravity = -9, drag = 1.1, grow = 0,
  ): void {
    const k=this.i; this.i=(this.i+1)%this.n;
    this.pos[k*3]=x; this.pos[k*3+1]=y; this.pos[k*3+2]=z;
    this.px[k*3]=vx; this.px[k*3+1]=vy; this.px[k*3+2]=vz;
    this.col[k*3]=r; this.col[k*3+1]=g; this.col[k*3+2]=b;
    this.siz[k]=size*this.baseSize; this.alp[k]=alpha;
    this.life[k]=life; this.max[k]=life; this.baseA[k]=alpha;
    this.grav[k]=gravity; this.drag[k]=drag; this.grow[k]=grow;
    this._dirty=true;
  }
  update(dt: number): void {
    const P=this.pos, V=this.px, A=this.alp, S=this.siz;
    let live=false;
    for(let k=0;k<this.n;k++){
      if(this.life[k]<=0){ if(A[k]!==0){ A[k]=0; S[k]=0; P[k*3+1]=-9999; live=true; } continue; }
      this.life[k]-=dt; live=true;
      if(this.life[k]<=0){ A[k]=0; S[k]=0; P[k*3+1]=-9999; continue; }
      const d=Math.max(0,1-this.drag[k]*dt);
      V[k*3]*=d; V[k*3+2]*=d; V[k*3+1]=V[k*3+1]*d+this.grav[k]*dt;
      P[k*3]+=V[k*3]*dt; P[k*3+1]+=V[k*3+1]*dt; P[k*3+2]+=V[k*3+2]*dt;
      const t=this.life[k]/this.max[k];
      A[k]=this.baseA[k]*(t>.72?(1-t)/.28:t/.72*.35+t*.65);
      if(this.grow[k]) S[k]+=this.grow[k]*dt*this.baseSize;
    }
    if(live||this._dirty){
      this.aPos.needsUpdate=true; this.aAlp.needsUpdate=true;
      this.aSiz.needsUpdate=true; this.aCol.needsUpdate=true;
      this._dirty=false;
    }
  }
  clear(): void {
    for(let k=0;k<this.n;k++){ this.life[k]=0; this.alp[k]=0; this.siz[k]=0; this.pos[k*3+1]=-9999; }
    this._dirty=true;
  }
}
