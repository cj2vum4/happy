import * as THREE from 'three';
import { clamp, lerp, rand, randi, smoothstep } from '@/core/math';
import { _v1, _v2, _v3 } from '@/core/scratch';
import { GEO, blobGeo, coneProfile, makeInstanced, mat, roundedBox, type InstanceEntry } from '@/render/geom';
import { TEX } from '@/render/textures';
import { PATH } from '@/track/path';
import { TrackPath, type TrackFrame } from '@/track/TrackPath';
import type { Quality } from '@/core/quality';

/**
 * Everything that is not a racer: sky, terrain, the volcano, the road surface,
 * the barriers and every piece of scenery.
 *
 * Built once at boot and then only animated — `setPhase` drives the whole
 * eruption from a single 0..2 number, so the race can escalate the volcano
 * without any of the systems above knowing how it is drawn.
 */
export class World {
  private readonly scene: THREE.Scene;
  private readonly q: Quality;
  /** Lava materials with the emissive strength they were authored at, so the
   *  eruption can scale them all from one number without losing their balance. */
  private readonly lavaMats: Array<{m: THREE.MeshStandardMaterial; base: number}> = [];
  /** Where ambient smoke is emitted: [0] is the crater, the rest lava lakes. */
  readonly smokeAnchors: THREE.Vector3[] = [];
  private readonly glowLights: THREE.PointLight[] = [];
  readonly vPos: THREE.Vector3;
  readonly vBase: number;
  readonly vTop: number;
  readonly vHeight: number;
  private skyMat!: THREE.ShaderMaterial;
  private hemi!: THREE.HemisphereLight;
  /** The one shadow-casting light; the runtime degrade path turns it off. */
  key!: THREE.DirectionalLight;
  private rim!: THREE.DirectionalLight;
  private craterLight!: THREE.PointLight;
  private fog!: THREE.FogExp2;
  private crystalMat: THREE.MeshStandardMaterial | null = null;
  private orbMat: THREE.MeshStandardMaterial | null = null;
  private sceneCrystalMat: THREE.MeshStandardMaterial | null = null;
  private ambient!: THREE.AmbientLight;
  /** Kept so later phases can swap materials or dispose the scene. */
  readonly parts: { terrain?: THREE.Mesh; volcano?: THREE.Group; craterLava?: THREE.Mesh } = {};

  constructor(scene: THREE.Scene, quality: Quality){
    this.scene=scene; this.q=quality;
    // The cone must stand in the circuit's infield without overlapping the road.
    // The largest circle that fits inside this layout is centred here with a
    // radius of 213, so the base is sized under that with margin to spare.
    this.vPos=new THREE.Vector3(-28,-6,96);
    // Base kept well inside the infield: the closest the road comes to this
    // axis is ~229, so a 150 base leaves ~65 units of daylight rather than the
    // ~20 that made the flank read as a wall standing at the track edge.
    this.vBase=150; this.vTop=26; this.vHeight=176;
    this.build();
  }
  /** True when (x,z) is clear of every part of the circuit by `pad`.
   *  Decorative geometry has no collision, so anything overlapping the road is
   *  a wall the player drives straight through — and it blocks the view. */
  clearOfTrack(x: number, z: number, pad: number): boolean {
    for(let i=0;i<PATH.N;i+=3){
      const dx=PATH.pts[i]!.x-x, dz=PATH.pts[i]!.z-z;
      const need=PATH.width[i]!*.5+pad;
      if(dx*dx+dz*dz<need*need) return false;
    }
    return true;
  }
  private build(): void {
    this.buildSky();
    this.buildLights();
    this.buildTerrain();
    this.buildVolcano();
    this.buildTrack();
    this.buildScenery();
  }
  /* ── Sky dome: 3-stop candy gradient, animated per race phase ── */
  private buildSky(): void {
    const m=new THREE.ShaderMaterial({
      side:THREE.BackSide, depthWrite:false, fog:false,
      uniforms:{
        top:{value:new THREE.Color('#ffc3e6')}, mid:{value:new THREE.Color('#ff8fb8')},
        bot:{value:new THREE.Color('#5d2340')}, glowC:{value:new THREE.Color('#ff6a3d')},
        glowP:{value:0.0},
      },
      vertexShader:`varying vec3 vW; void main(){ vW=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader:`
        uniform vec3 top,mid,bot,glowC; uniform float glowP; varying vec3 vW;
        void main(){
          vec3 d=normalize(vW); float h=d.y;
          vec3 c = h>0.0 ? mix(mid,top,pow(h,0.62)) : mix(mid,bot,pow(-h,0.55));
          // volcanic bloom low on the horizon toward the crater
          float hz = smoothstep(0.42,-0.14,h);
          float dir= smoothstep(0.1,0.95,dot(d,normalize(vec3(0.0,0.12,-1.0)))*0.5+0.5);
          c = mix(c, glowC, hz*dir*glowP*0.72);
          gl_FragColor=vec4(c,1.0);
        }`,
    });
    this.skyMat=m;
    const sky=new THREE.Mesh(new THREE.SphereGeometry(2400,26,16),m);
    sky.frustumCulled=false; this.scene.add(sky);
  }
  private buildLights(): void {
    const S=this.scene;
    this.hemi=new THREE.HemisphereLight(0xffd6ec,0x4a2038,1.05); S.add(this.hemi);
    this.key=new THREE.DirectionalLight(0xfff0da,1.55);
    this.key.position.set(-260,340,300);
    if(this.q.shadows){
      this.key.castShadow=true;
      const sz=this.q.shadowSize;
      this.key.shadow.mapSize.set(sz,sz);
      const c=this.key.shadow.camera;
      c.left=-230;c.right=230;c.top=230;c.bottom=-230;c.near=60;c.far=900;
      this.key.shadow.bias=-0.0011; this.key.shadow.normalBias=1.1;
    }
    S.add(this.key); S.add(this.key.target);
    this.rim=new THREE.DirectionalLight(0xff5f7a,.5); this.rim.position.set(220,120,-320); S.add(this.rim);
    // crater glow
    this.craterLight=new THREE.PointLight(0xff5522,2.4,700,1.7);
    this.craterLight.position.set(this.vPos.x,this.vPos.y+170,this.vPos.z); S.add(this.craterLight);
    this.ambient=new THREE.AmbientLight(0xffe0f0,.18); S.add(this.ambient);
    this.fog=new THREE.FogExp2(0xf3a8c4,0.00092); this.scene.fog=this.fog;
  }
  /* ── Rolling candy terrain with a crater-side depression ── */
  private buildTerrain(): void {
    const SZ=2600, SEG=this.q.terrainSeg;
    const g=new THREE.PlaneGeometry(SZ,SZ,SEG,SEG);
    g.rotateX(-Math.PI/2);
    const p=g.attributes.position;
    const res=TrackPath.emptyProjection();
    for(let i=0;i<p.count;i++){
      const x=p.getX(i), z=p.getZ(i);
      const d=Math.hypot(x-this.vPos.x,z-this.vPos.z);
      // large rolling hills
      let y = Math.sin(x*.0042)*Math.cos(z*.0037)*26
            + Math.sin(x*.0101+1.7)*Math.cos(z*.0089-.6)*11
            + Math.sin(d*.0067)*7;
      // volcano skirt rises toward centre
      y += smoothstep(300,105,d)*44;
      // outer ring lifts to hide the world edge
      y += smoothstep(760,1240,Math.hypot(x,z))*180;
      // flatten a corridor under the track so nothing pokes through the road
      PATH.project(_v3.set(x,0,z),undefined,res);
      const dist=Math.abs(res.lat);
      const band=smoothstep(155,55,dist);
      y = lerp(y, res.fr.pos.y-4.2, band);
      p.setY(i,y);
    }
    g.computeVertexNormals();
    const m=new THREE.MeshStandardMaterial({map:TEX.ground,roughness:.95,metalness:0});
    const t=new THREE.Mesh(g,m); t.receiveShadow=this.q.shadows; t.position.y=-1.2;
    this.scene.add(t); this.parts.terrain=t;
  }
  /* ── The volcano: layered lathe cone, crater, lava, smoke source ── */
  private buildVolcano(): void {
    const V=new THREE.Group(); V.position.copy(this.vPos); this.scene.add(V); this.parts.volcano=V;
    const BASE=this.vBase, TOPR=this.vTop, H=this.vHeight;
    const rockM=new THREE.MeshStandardMaterial({map:TEX.rock,color:0xfff0e4,roughness:.86,metalness:.02});
    // main cone
    const cone=new THREE.Mesh(new THREE.LatheGeometry(coneProfile(BASE,TOPR,H,22,.035,7),40),rockM);
    cone.castShadow=this.q.shadows; cone.receiveShadow=this.q.shadows; V.add(cone);
    // secondary spur for silhouette interest
    const spur=new THREE.Mesh(new THREE.LatheGeometry(coneProfile(BASE*.34,14,H*.42,14,.09,19),24),rockM);
    spur.position.set(-BASE*.62,4,BASE*.30); spur.rotation.z=.1; spur.castShadow=this.q.shadows; V.add(spur);
    const spur2=new THREE.Mesh(new THREE.LatheGeometry(coneProfile(BASE*.26,12,H*.34,12,.11,31),22),rockM);
    spur2.position.set(BASE*.56,2,BASE*.38); spur2.rotation.z=-.08; V.add(spur2);

    // crater rim — ring of chocolate boulders
    const rimM=new THREE.MeshStandardMaterial({map:TEX.rock,color:0xffdfc8,roughness:.9});
    const rimEnts=[];
    for(let i=0;i<20;i++){
      const a=i/20*Math.PI*2, r=TOPR*1.12+Math.sin(i*2.3)*6, sc=8+Math.sin(i*1.9)*3.6;
      rimEnts.push({p:[Math.cos(a)*r,H*.985+Math.sin(i*3.1)*4,Math.sin(a)*r],
                    r:[rand(0,7),rand(0,7),rand(0,7)], s:[sc,sc,sc]});
    }
    makeInstanced(V,blobGeo(1,0,.42,11),rimM,rimEnts,{cast:this.q.shadows});
    // crater lava pool
    const craterLava=new THREE.Mesh(new THREE.CircleGeometry(TOPR*1.05,28),this.lavaMat(1.9));
    craterLava.rotation.x=-Math.PI/2; craterLava.position.y=H*.96; V.add(craterLava);
    this.parts.craterLava=craterLava;
    this.smokeAnchors.push(new THREE.Vector3(this.vPos.x,this.vPos.y+H*1.0,this.vPos.z));

    // frozen strawberry-syrup flows down the flank
    for(let i=0;i<5;i++){
      const a=(i/5)*Math.PI*2+.6;
      const pts=[];
      for(let k=0;k<=7;k++){
        const t=k/7, rr=lerp(TOPR*1.3,BASE*.9,Math.pow(t,.82));
        const wob=Math.sin(t*5+i*2.1)*18;
        pts.push(new THREE.Vector3(Math.cos(a)*rr+Math.cos(a+1.57)*wob, lerp(H*.95,6,Math.pow(t,.62)), Math.sin(a)*rr+Math.sin(a+1.57)*wob));
      }
      const curve=new THREE.CatmullRomCurve3(pts);
      const tube=new THREE.Mesh(new THREE.TubeGeometry(curve,26,lerp(6,12,i/5),7,false),this.lavaMat(1.35));
      V.add(tube);
    }
    // glowing sugar-crystal veins on the flanks
    const crystM=new THREE.MeshStandardMaterial({color:0xff86c8,emissive:0xff3d86,emissiveIntensity:.85,
      roughness:.12,metalness:0,transparent:true,opacity:.86});
    // Crystals sit on the volcano flank, which the circuit now runs close to;
    // reject any that would grow up through the road and try another spot.
    const vcEnts=[];
    for(let i=0;i<30;i++){
      for(let tries=0;tries<16;tries++){
        const a=rand(0,Math.PI*2), t=rand(.15,.72), sz=rand(4,13);
        const rr=lerp(TOPR*1.35,BASE*.96,Math.pow(t,.85)), yy=lerp(H*.95,4,Math.pow(t,.62));
        const wx=Math.cos(a)*rr+V.position.x, wz=Math.sin(a)*rr+V.position.z;
        if(!this.clearOfTrack(wx,wz,sz*.5+8)) continue;
        vcEnts.push({p:[Math.cos(a)*rr,yy+sz*.6,Math.sin(a)*rr],
                     r:[rand(-.3,.3),rand(0,7),rand(-.3,.3)], s:[sz*.5,sz*1.7,sz*.5]});
        break;
      }
    }
    makeInstanced(V,GEO.octa,crystM,vcEnts);
    this.crystalMat=crystM;
  }
  private lavaMat(intensity: number): THREE.MeshStandardMaterial {
    const m=new THREE.MeshStandardMaterial({
      map:TEX.lava, emissiveMap:TEX.lava, emissive:0xffffff, emissiveIntensity:intensity,
      color:0x883040, roughness:.28, metalness:0,
    });
    this.lavaMats.push({m,base:intensity});
    return m;
  }
  /* ── Track ribbon, curbs, barriers, start line, tunnel ── */
  private buildTrack(): void {
    const N=PATH.N, SEG=N;
    const pos=[],uv=[],idx=[];
    const cl=[],cr=[];          // curb strips
    const bl=[],br=[];          // barrier tops
    const fr=TrackPath.emptyFrame();
    let vLen=0;
    for(let i=0;i<=SEG;i++){
      const fi=i%N;
      PATH.frame(fi,fr);
      const hw=fr.width*.5;
      const L=_v1.copy(fr.pos).addScaledVector(fr.right,-hw);
      const R=_v2.copy(fr.pos).addScaledVector(fr.right, hw);
      L.y=fr.pos.y-Math.sin(fr.bank)*hw; R.y=fr.pos.y+Math.sin(fr.bank)*hw;
      pos.push(L.x,L.y,L.z, R.x,R.y,R.z);
      if(i>0) vLen+=PATH.pts[fi].distanceTo(PATH.pts[(fi-1+N)%N]);
      uv.push(0,vLen*.02, 1,vLen*.02);
      cl.push(L.x,L.y,L.z); cr.push(R.x,R.y,R.z);
      // barrier line, pushed outward and lifted
      bl.push(L.x-fr.right.x*2.0, L.y, L.z-fr.right.z*2.0);
      br.push(R.x+fr.right.x*2.0, R.y, R.z+fr.right.z*2.0);
      if(i<SEG){ const a=i*2; idx.push(a,a+1,a+2, a+1,a+3,a+2); }
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
    g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    g.setIndex(idx); g.computeVertexNormals();
    const roadM=new THREE.MeshStandardMaterial({map:TEX.road,roughness:.82,metalness:.02});
    const road=new THREE.Mesh(g,roadM); road.receiveShadow=this.q.shadows; road.renderOrder=1;
    this.scene.add(road);

    // ── Curbs: candy-cane ribbons hugging both edges
    const curbM=new THREE.MeshStandardMaterial({map:TEX.stripe,roughness:.42,metalness:.05});
    [cl,cr].forEach((line,side)=>{
      const P=[],U=[],I=[];
      const sgn=side?1:-1;
      for(let i=0;i<=SEG;i++){
        const fi=i%N; PATH.frame(fi,fr);
        const x=line[i*3],y=line[i*3+1],z=line[i*3+2];
        P.push(x,y+.09,z, x+fr.right.x*sgn*1.5, y+.16, z+fr.right.z*sgn*1.5);
        U.push(0,i*.5, 1,i*.5);
        if(i<SEG){ const a=i*2; I.push(a,a+1,a+2, a+1,a+3,a+2); }
      }
      const cg=new THREE.BufferGeometry();
      cg.setAttribute('position',new THREE.Float32BufferAttribute(P,3));
      cg.setAttribute('uv',new THREE.Float32BufferAttribute(U,2));
      cg.setIndex(I); cg.computeVertexNormals();
      const cm=new THREE.Mesh(cg,curbM); cm.receiveShadow=false; this.scene.add(cm);
    });

    // ── Barrier walls (candy stripe) with glowing lollipop posts
    const wallM=new THREE.MeshStandardMaterial({map:TEX.stripe,roughness:.5,metalness:.06,side:THREE.DoubleSide});
    [bl,br].forEach((line)=>{
      const P=[],U=[],I=[];
      for(let i=0;i<=SEG;i++){
        const x=line[i*3],y=line[i*3+1],z=line[i*3+2];
        P.push(x,y-.4,z, x,y+2.6,z);
        U.push(i*.12,0, i*.12,1);
        if(i<SEG){ const a=i*2; I.push(a,a+1,a+2, a+1,a+3,a+2); }
      }
      const wg=new THREE.BufferGeometry();
      wg.setAttribute('position',new THREE.Float32BufferAttribute(P,3));
      wg.setAttribute('uv',new THREE.Float32BufferAttribute(U,2));
      wg.setIndex(I); wg.computeVertexNormals();
      this.scene.add(new THREE.Mesh(wg,wallM));
    });
    // posts + safety glow orbs
    const postM=mat('choco','#4a2028');
    const orbM=new THREE.MeshStandardMaterial({color:0xffe36b,emissive:0xffc93d,emissiveIntensity:1.3,roughness:.25});
    const step=Math.max(4,Math.round(N/150));
    const postG=new THREE.CylinderGeometry(.24,.3,3.4,7);
    const orbG=new THREE.SphereGeometry(.44,10,8);
    const pCount=Math.floor(N/step)*2;
    const posts=new THREE.InstancedMesh(postG,postM,pCount);
    const orbs =new THREE.InstancedMesh(orbG,orbM,pCount);
    posts.castShadow=false; const M=new THREE.Matrix4(); let ci=0;
    for(let i=0;i<N;i+=step){
      for(const line of [bl,br]){
        if(ci>=pCount) break;
        const x=line[i*3],y=line[i*3+1],z=line[i*3+2];
        M.makeTranslation(x,y+1.3,z); posts.setMatrixAt(ci,M);
        M.makeTranslation(x,y+3.1,z); orbs.setMatrixAt(ci,M);
        ci++;
      }
    }
    posts.count=ci; orbs.count=ci;
    posts.instanceMatrix.needsUpdate=true; orbs.instanceMatrix.needsUpdate=true;
    this.scene.add(posts); this.scene.add(orbs);
    this.orbMat=orbM;

    // ── Start / finish line + gantry
    PATH.frame(0,fr);
    const lineG=new THREE.PlaneGeometry(fr.width,7);
    const line=new THREE.Mesh(lineG,new THREE.MeshStandardMaterial({map:TEX.check,roughness:.6}));
    line.rotation.x=-Math.PI/2; line.rotation.z=Math.atan2(fr.tan.x,fr.tan.z);
    line.position.copy(fr.pos).setY(fr.pos.y+.07); line.renderOrder=2;
    this.scene.add(line);
    this.buildGantry(fr);

    // ── Marshmallow Smoke Tunnel over the ridge section
    this.buildTunnel(0.585,0.655);
  }
  private buildGantry(fr: TrackFrame): void {
    const G=new THREE.Group();
    const hw=fr.width*.5+2.6;
    const legM=mat('candy','#ff4f9a'), stripeM=new THREE.MeshStandardMaterial({map:TEX.stripe,roughness:.4});
    for(const sx of [-1,1]){
      const leg=new THREE.Mesh(new THREE.CylinderGeometry(.95,1.15,15,10),stripeM);
      leg.position.set(sx*hw,7.5,0); leg.castShadow=this.q.shadows; G.add(leg);
      const cap=new THREE.Mesh(GEO.sphere,legM); cap.scale.setScalar(1.35); cap.position.set(sx*hw,15.2,0); G.add(cap);
    }
    const beam=new THREE.Mesh(roundedBox(hw*2+2.6,2.4,1.9,.5,2),mat('candy','#fff4e6'));
    beam.position.y=15.4; beam.castShadow=this.q.shadows; G.add(beam);
    const band=new THREE.Mesh(roundedBox(hw*2+1.2,.9,2.1,.3,2),mat('candy','#ff4f9a'));
    band.position.y=13.9; G.add(band);
    // hanging gumdrop bunting
    for(let i=0;i<13;i++){
      const t=i/12;
      const gd=new THREE.Mesh(GEO.sphereLo,mat('candy',['#ff4f9a','#ffd54a','#57e6c8','#a86bff'][i%4]));
      gd.scale.set(.72,.86,.72);
      gd.position.set(lerp(-hw,hw,t), 13.0-Math.sin(t*Math.PI)*1.1, 0);
      G.add(gd);
    }
    // glowing "GO" arch lights
    for(let i=0;i<5;i++){
      const l=new THREE.Mesh(GEO.sphereLo,new THREE.MeshStandardMaterial({color:0xfff2a0,emissive:0xffd54a,emissiveIntensity:1.6,roughness:.2}));
      l.scale.setScalar(.6); l.position.set((i-2)*3.2,16.9,0); G.add(l);
    }
    G.position.copy(fr.pos); G.rotation.y=Math.atan2(fr.tan.x,fr.tan.z);
    this.scene.add(G);
  }
  private buildTunnel(t0: number, t1: number): void {
    const mm=new THREE.MeshStandardMaterial({color:0xfff0f6,roughness:.97,metalness:0});
    const fr=TrackPath.emptyFrame(), ents=[];
    const s0=t0*PATH.len, s1=t1*PATH.len, n=15, segs=9;
    for(let i=0;i<=n;i++){
      PATH.frameAtS(lerp(s0,s1,i/n),fr);
      // Spring the arch from clear of the barrier, not from the road edge: at
      // +3.2 the base blobs (radius ~5) hung several units over the racing line
      // at windscreen height, swallowing the view of the corner ahead.
      const hw=fr.width*.5+10;
      const yaw=Math.atan2(fr.tan.x,fr.tan.z);
      const cs=Math.cos(yaw), sn=Math.sin(yaw);
      for(let k=0;k<=segs;k++){
        const a=Math.PI*k/segs;
        const lx=Math.cos(a)*hw, ly=Math.sin(a)*(hw*.86)+2.2;
        const sc=3.4+Math.sin(k*1.7+i)*.8;
        const wx=fr.pos.x+lx*cs, wz=fr.pos.z-lx*sn;
        // belt and braces: skip any blob still reaching the road below roof height
        if(ly-sc*1.2 < 9 && !this.clearOfTrack(wx,wz,sc*1.2+2)) continue;
        ents.push({p:[wx, fr.pos.y+ly, wz], r:[0,yaw,0], s:[sc,sc,sc]});
      }
    }
    makeInstanced(this.scene,blobGeo(1,1,.2,29),mm,ents,{cast:this.q.shadows});
  }
  /* ── Scenery: lollipops, crystals, gumdrops, chocolate rocks, lava lakes ──
     Everything repeated is batched into InstancedMeshes — the whole candy
     landscape costs roughly a dozen draw calls instead of two thousand. */
  private buildScenery(): void {
    const S=new THREE.Group(); this.scene.add(S);
    const fr=TrackPath.emptyFrame();
    const LOLLI=['#ff4f9a','#ffd54a','#57e6c8','#a86bff','#ff8a4a','#fff4e6'];
    const sh=this.q.shadows;
    // instance buckets
    const bucket=(): InstanceEntry[]=>[];
    const B={ stick:bucket(), head:bucket(), swirlA:bucket(), swirlB:bucket(),
              rock:bucket(), gum:bucket(), cryst:bucket(), caneShaft:bucket(),
              caneHook:bucket(), hutWrap:bucket(), hutIcing:bucket(),
              hutCherry:bucket(), hutDoor:bucket(), lakeRock:bucket() };
    // Props are positioned relative to the local track frame, but the circuit
    // loops back on itself: a large lateral offset can drop a lollipop right
    // beside a completely different straight, close enough to clip the chase
    // camera. Reject any candidate that lands inside another stretch of road.
    const clearOfTrack=(x: number,z: number,pad: number)=>this.clearOfTrack(x,z,pad);
    // place a prop beside the track, retrying until it clears the whole circuit
    /** A spot beside the road: world position plus the arc length it sits at. */
    const beside=(minOff: number,maxOff: number,pad=9): {x:number;y:number;z:number;s:number}|null=>{
      for(let tries=0;tries<10;tries++){
        const s=Math.random()*PATH.len; PATH.frameAtS(s,fr);
        const side=Math.random()<.5?-1:1;
        const off=side*(fr.width*.5+rand(minOff,maxOff));
        const p=_v1.copy(fr.pos).addScaledVector(fr.right,off);
        if(clearOfTrack(p.x,p.z,pad))
          return {x:p.x, z:p.z, y:fr.pos.y+Math.sin(fr.bank)*off, s};
      }
      return null;                      // crowded spot — skip this prop
    };

    // ── Lollipop groves
    for(let i=0;i<190;i++){
      const h=rand(7,19), R=rand(2.6,5.6);
      const q=beside(11,60,11+R); if(!q) continue;
      const tilt=rand(-.1,.1), lean=rand(-.08,.08);
      const col=LOLLI[randi(LOLLI.length)];
      const hy=q.y-1.4;
      B.stick.push({p:[q.x,hy+h/2,q.z], r:[lean,0,tilt], s:[.34,h,.34]});
      const headY=hy+h+R*.5;
      const spin=rand(0,7);
      B.head.push({p:[q.x,headY,q.z], r:[rand(-.3,.3),spin,tilt], s:[R,R*.92,R*.42], c:col});
      B.swirlA.push({p:[q.x+Math.sin(spin)*R*.44,headY,q.z+Math.cos(spin)*R*.44], r:[0,spin,tilt], s:[R*.55,R*.55,R*.1]});
      B.swirlB.push({p:[q.x+Math.sin(spin)*R*.45,headY,q.z+Math.cos(spin)*R*.45], r:[0,spin,tilt], s:[R*.28,R*.28,R*.1]});
    }
    // ── Chocolate boulders
    for(let i=0;i<170;i++){
      const sc=rand(2.4,10);
      const q=beside(9,86,9+sc*1.4); if(!q) continue;
      B.rock.push({p:[q.x,q.y-1.6+sc*.3,q.z], r:[rand(0,7),rand(0,7),rand(0,7)],
                   s:[sc,sc*rand(.5,.95),sc*rand(.75,1.2)]});
    }
    // ── Gumdrop clusters
    for(let i=0;i<115;i++){
      const q=beside(10,48,14); if(!q) continue;
      const col=LOLLI[randi(LOLLI.length)];
      for(let k=0;k<2+randi(3);k++){
        const sc=rand(1.1,3.1);
        B.gum.push({p:[q.x+rand(-5,5),q.y-1.2+sc*.7,q.z+rand(-5,5)], r:[0,rand(0,7),0],
                    s:[sc,sc*1.25,sc], c:col});
      }
    }
    // ── Glowing sugar crystals
    for(let i=0;i<140;i++){
      const sc=rand(1.1,4.4);
      const q=beside(9,54,9+sc*.6); if(!q) continue;
      B.cryst.push({p:[q.x,q.y-1+sc*.9,q.z], r:[rand(-.26,.26),rand(0,7),rand(-.26,.26)],
                    s:[sc*.46,sc*rand(1.6,3.1),sc*.46]});
    }
    // ── Candy canes
    for(let i=0;i<64;i++){
      const q=beside(10,34,13); if(!q) continue;
      const h=rand(6,13), tilt=rand(-.14,.14);
      B.caneShaft.push({p:[q.x,q.y-1.4+h/2,q.z], r:[0,0,tilt], s:[.42,h,.42]});
      B.caneHook.push({p:[q.x-Math.sin(tilt)*h,q.y-1.4+h,q.z], r:[0,Math.PI/2,tilt], s:[1,1,1]});
    }
    // ── Candy Village cupcake huts near the start straight
    PATH.frameAtS(PATH.len*.985,fr);
    for(let i=0;i<12;i++){
      const side=i%2?1:-1;
      const off=side*rand(32,66), along=rand(-100,130);
      const b=_v1.copy(fr.pos).addScaledVector(fr.right,off).addScaledVector(fr.tan,along);
      if(!clearOfTrack(b.x,b.z,14)) continue;
      const y=fr.pos.y-1.6, spin=rand(0,7);
      B.hutWrap.push({p:[b.x,y+1.8,b.z], r:[0,spin,0], s:[1,1,1]});
      B.hutIcing.push({p:[b.x,y+4.6,b.z], r:[0,spin,0], s:[3.9,2.7,3.9], c:LOLLI[i%LOLLI.length]});
      B.hutCherry.push({p:[b.x,y+6.6,b.z], r:[0,0,0], s:[.85,.85,.85]});
      B.hutDoor.push({p:[b.x+Math.sin(spin)*3.2,y+1.05,b.z+Math.cos(spin)*3.2], r:[0,spin,0], s:[1,1,1]});
    }
    // ── Lava lakes (unique meshes — each needs its own animated material)
    const LAKES=[[0.60,72,44],[0.62,-86,34],[0.30,80,40],[0.05,-96,30],[0.86,90,36]];
    // The circuit loops back on itself, so a fixed lateral offset can drop a lake
    // straight onto another part of the road. Push each one outward (and flip
    // sides if need be) until it clears every stretch of track.
    const clears=(x: number,z: number,r: number)=>{
      for(let i=0;i<PATH.N;i+=2){
        const dx=PATH.pts[i]!.x-x, dz=PATH.pts[i]!.z-z;
        const need=r+PATH.width[i]!*.5+8;
        if(dx*dx+dz*dz<need*need) return false;
      }
      return true;
    };
    for(const [t,off0,r] of LAKES){
      PATH.frameAtS(t*PATH.len,fr);
      let off=off0;
      for(const k of [1,1.18,1.38,1.6,1.85,-1,-1.2,-1.45,-1.7]){
        const cand=off0*k;
        const cx=fr.pos.x+fr.right.x*cand, cz=fr.pos.z+fr.right.z*cand;
        if(clears(cx,cz,r)){ off=cand; break; }
      }
      const p=_v1.copy(fr.pos).addScaledVector(fr.right,off);
      const geo=new THREE.CircleGeometry(r,26);
      const pa=geo.attributes.position;   // ripple the rim so it isn't a flat disc
      for(let i=0;i<pa.count;i++){
        const d=Math.hypot(pa.getX(i),pa.getY(i));
        if(d>r*.55) pa.setXYZ(i,pa.getX(i)*(1+Math.sin(i*1.9)*.09),pa.getY(i)*(1+Math.cos(i*2.3)*.09),pa.getZ(i));
      }
      geo.computeVertexNormals();
      const lake=new THREE.Mesh(geo,this.lavaMat(1.5));
      lake.rotation.x=-Math.PI/2;
      const ly=fr.pos.y+Math.sin(fr.bank)*off-3.4;
      lake.position.set(p.x,ly,p.z);
      S.add(lake);
      this.smokeAnchors.push(new THREE.Vector3(p.x,ly+1,p.z));
      const pl=new THREE.PointLight(0xff4422,1.7,r*5,2);
      pl.position.set(p.x,ly+9,p.z); S.add(pl); this.glowLights.push(pl);
      for(let k=0;k<14;k++){
        const a=k/14*Math.PI*2, sc=rand(3,7);
        B.lakeRock.push({p:[p.x+Math.cos(a)*r*1.02,ly+1,p.z+Math.sin(a)*r*1.02],
                         r:[rand(0,7),rand(0,7),rand(0,7)], s:[sc,sc*.62,sc]});
      }
    }

    // ── Materials + batched builds
    const stripeM=new THREE.MeshStandardMaterial({map:TEX.stripe,roughness:.4});
    const rockM=new THREE.MeshStandardMaterial({map:TEX.rock,color:0xffeede,roughness:.9});
    const candyW=new THREE.MeshPhysicalMaterial({color:0xffffff,roughness:.14,clearcoat:.9,clearcoatRoughness:.12});
    const gumM=new THREE.MeshPhysicalMaterial({color:0xffffff,roughness:.13,clearcoat:1,transparent:true,opacity:.93});
    const creamM=mat('candy','#fff4e6');
    const cm=new THREE.MeshStandardMaterial({color:0xd8f6ff,emissive:0x57e6c8,emissiveIntensity:1.05,
      roughness:.08,metalness:0,transparent:true,opacity:.82});
    this.sceneCrystalMat=cm;
    const hookGeo=new THREE.TorusGeometry(1.5,.42,7,14,Math.PI);
    const hutGeo=new THREE.CylinderGeometry(3.4,2.6,3.6,14,1);
    const icingGeo=blobGeo(1,1,.16,17);
    const rockGeo=blobGeo(1,0,.34,41);
    const lakeRockGeo=blobGeo(1,0,.4,73);
    const doorGeo=roundedBox(1.5,2.1,.3,.5,2);

    // Scenery does not cast shadows: at these distances the shadow reads as
    // noise, and skipping it halves the geometry pushed through the depth pass.
    // The karts (the things the player actually needs grounded) still do.
    makeInstanced(S,GEO.cyl,   creamM, B.stick);
    makeInstanced(S,GEO.lolli, candyW, B.head);
    makeInstanced(S,GEO.torus, creamM, B.swirlA);
    makeInstanced(S,GEO.torus, creamM, B.swirlB);
    makeInstanced(S,rockGeo,   rockM,  B.rock,      {receive:sh});
    makeInstanced(S,GEO.sphereLo,gumM, B.gum);
    makeInstanced(S,GEO.octa,  cm,     B.cryst);
    makeInstanced(S,GEO.cyl,   stripeM,B.caneShaft);
    makeInstanced(S,hookGeo,   stripeM,B.caneHook);
    makeInstanced(S,hutGeo,    stripeM,B.hutWrap,   {cast:sh});
    makeInstanced(S,icingGeo,  candyW, B.hutIcing,  {cast:sh});
    makeInstanced(S,GEO.sphereLo,mat('candy','#ff2d55'),B.hutCherry);
    makeInstanced(S,doorGeo,   mat('choco','#3a1d22'),B.hutDoor);
    makeInstanced(S,lakeRockGeo,rockM, B.lakeRock);
  }
  /* ── Race-phase atmosphere (calm → awakening → eruption) ── */
  /** Drive the whole eruption. `p` is 0..2; `t` is the game clock. */
  setPhase(p: number, t: number): void {
    const A={ sky:[0xffc3e6,0xffb28f,0xff8a5e], mid:[0xff8fb8,0xff8f7a,0xf2604a],
              bot:[0x5d2340,0x5a2436,0x4a1520], fog:[0xf3a8c4,0xf0a08e,0xd9705f],
              hemiS:[0xffd6ec,0xffc9b0,0xffa080], hemiG:[0x4a2038,0x4a2430,0x501a1e],
              keyI:[1.55,1.42,1.2], craterI:[1.9,3.6,6.2], lavaB:[1.0,1.35,1.85],
              fogD:[0.00092,0.00108,0.00136], glowP:[0.10,0.36,0.78] };
    const i0=Math.floor(clamp(p,0,2)), i1=Math.min(2,i0+1), f=clamp(p,0,2)-i0;
    this.skyMat.uniforms.top.value.setHex(A.sky[i0]).lerp(new THREE.Color(A.sky[i1]),f);
    this.skyMat.uniforms.mid.value.setHex(A.mid[i0]).lerp(new THREE.Color(A.mid[i1]),f);
    this.skyMat.uniforms.bot.value.setHex(A.bot[i0]).lerp(new THREE.Color(A.bot[i1]),f);
    this.skyMat.uniforms.glowP.value=lerp(A.glowP[i0],A.glowP[i1],f);
    this.fog.color.setHex(A.fog[i0]).lerp(new THREE.Color(A.fog[i1]),f);
    this.fog.density=lerp(A.fogD[i0],A.fogD[i1],f);
    this.hemi.color.setHex(A.hemiS[i0]).lerp(new THREE.Color(A.hemiS[i1]),f);
    this.hemi.groundColor.setHex(A.hemiG[i0]).lerp(new THREE.Color(A.hemiG[i1]),f);
    this.key.intensity=lerp(A.keyI[i0],A.keyI[i1],f);
    const pulse=1+Math.sin(t*2.6)*.07+Math.sin(t*5.7)*.03;
    this.craterLight.intensity=lerp(A.craterI[i0],A.craterI[i1],f)*pulse;
    const lb=lerp(A.lavaB[i0],A.lavaB[i1],f);
    for(const L of this.lavaMats) L.m.emissiveIntensity=L.base*lb*(1+Math.sin(t*1.9+L.base)*.09);
    for(const g of this.glowLights) g.intensity=1.7*lb*pulse;
    // scroll the lava textures — molten syrup creep
    TEX.lava.offset.y=t*.021; TEX.lava.offset.x=Math.sin(t*.13)*.04;
    if(this.crystalMat) this.crystalMat.emissiveIntensity=.85+Math.sin(t*2.1)*.2;
    if(this.sceneCrystalMat) this.sceneCrystalMat.emissiveIntensity=1.05+Math.sin(t*1.5)*.28;
    if(this.orbMat) this.orbMat.emissiveIntensity=1.3+Math.sin(t*3.3)*.3;
  }
}
