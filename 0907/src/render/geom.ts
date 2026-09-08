import * as THREE from 'three';
import { lerp } from '@/core/math';

/** Beveled rounded box — the backbone of every kart panel. */
export function roundedBox(
  w: number, h: number, d: number, r: number, seg = 2,
): THREE.ExtrudeGeometry {
  r=Math.min(r,w/2-.001,h/2-.001,d/2-.001);
  const s=new THREE.Shape(), hw=w/2-r, hh=h/2-r;
  s.moveTo(-w/2,-hh); s.lineTo(-w/2,hh);
  s.quadraticCurveTo(-w/2,h/2,-hw,h/2); s.lineTo(hw,h/2);
  s.quadraticCurveTo(w/2,h/2,w/2,hh);   s.lineTo(w/2,-hh);
  s.quadraticCurveTo(w/2,-h/2,hw,-h/2); s.lineTo(-hw,-h/2);
  s.quadraticCurveTo(-w/2,-h/2,-w/2,-hh);
  const g=new THREE.ExtrudeGeometry(s,{depth:Math.max(.001,d-r*2),bevelEnabled:true,
    bevelSize:r*.92,bevelThickness:r*.92,bevelSegments:seg,curveSegments:seg+2,steps:1});
  g.translate(0,0,-(d-r*2)/2); g.computeVertexNormals(); return g;
}
/** Lumpy blob — candy rocks, marshmallows, gumdrops. */
export function blobGeo(
  r: number, detail: number, lump: number, seed = 1,
): THREE.IcosahedronGeometry {
  const g=new THREE.IcosahedronGeometry(r,detail);
  const p=g.attributes.position, n=p.count; let s=seed*9781.37;
  const rnd=()=>{ s=Math.sin(s)*43758.5453; return s-Math.floor(s); };
  const seen=new Map<string, number>();
  for(let i=0;i<n;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    const key=`${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let f=seen.get(key); if(f===undefined){ f=1+(rnd()-.5)*lump*2; seen.set(key,f); }
    p.setXYZ(i,x*f,y*f,z*f);
  }
  g.computeVertexNormals(); return g;
}
/** Lathe profile → volcanic cone with an irregular, art-directed silhouette. */
export function coneProfile(
  baseR: number, topR: number, h: number, pts: number, jag: number, seed = 3,
): THREE.Vector2[] {
  const p: THREE.Vector2[]=[]; let s=seed*3711.11;
  const rnd=()=>{ s=Math.sin(s)*43758.5453; return s-Math.floor(s); };
  for(let i=0;i<=pts;i++){
    const t=i/pts;
    const ease=Math.pow(t,1.62);                       // concave volcano flank
    const r=lerp(baseR,topR,ease) * (1+(rnd()-.5)*jag);
    p.push(new THREE.Vector2(Math.max(.2,r), t*h));
  }
  return p;
}
/**
 * Batch a pile of identical-geometry props into one InstancedMesh.
 * The whole scenery layer is built this way — it keeps the draw-call count
 * flat no matter how much candy we scatter around the circuit.
 * entries: [{p:[x,y,z], r:[rx,ry,rz], s:[sx,sy,sz], c:'#hex'}]
 */
/** One prop to stamp out: position, optional Euler rotation, scale, tint. */
export interface InstanceEntry {
  /** Position, as [x, y, z]. */
  p: number[];
  /** Scale, as [sx, sy, sz]. */
  s: number[];
  /** Euler rotation, as [rx, ry, rz]. Omitted means unrotated. */
  r?: number[];
  /** Per-instance tint. Present on any entry means the whole batch is tinted. */
  c?: string;
}
export interface InstanceOpts {
  cast?: boolean;
  receive?: boolean;
  /** Defaults to true; the sky dome and other always-visible props opt out. */
  cull?: boolean;
}
const _im={m:new THREE.Matrix4(),q:new THREE.Quaternion(),e:new THREE.Euler(),
           s:new THREE.Vector3(),p:new THREE.Vector3(),c:new THREE.Color()};
export function makeInstanced(
  parent: THREE.Object3D,
  geo: THREE.BufferGeometry,
  material: THREE.Material,
  entries: InstanceEntry[],
  opts: InstanceOpts = {},
): THREE.InstancedMesh | null {
  if(!entries.length) return null;
  const im=new THREE.InstancedMesh(geo,material,entries.length);
  const colored=entries.some(e=>e.c);
  for(let i=0;i<entries.length;i++){
    const en=entries[i]!;
    _im.p.set(en.p[0],en.p[1],en.p[2]);
    _im.e.set(en.r?en.r[0]:0, en.r?en.r[1]:0, en.r?en.r[2]:0);
    _im.q.setFromEuler(_im.e);
    _im.s.set(en.s[0],en.s[1],en.s[2]);
    _im.m.compose(_im.p,_im.q,_im.s);
    im.setMatrixAt(i,_im.m);
    if(colored) im.setColorAt(i,_im.c.set(en.c||'#ffffff'));
  }
  im.instanceMatrix.needsUpdate=true;
  if(im.instanceColor) im.instanceColor.needsUpdate=true;
  im.castShadow=!!opts.cast; im.receiveShadow=!!opts.receive;
  im.frustumCulled=opts.cull!==false;
  parent.add(im);
  return im;
}

/**
 * Geometry shared by every kart and prop, built once at boot.
 *
 * Four karts each building their own wheel and panel geometry was the single
 * biggest cost in the v1 load, and identical geometry also lets Three.js reuse
 * the same GPU buffers.
 */
export const GEO: Record<string, THREE.BufferGeometry> = {};
export function buildSharedGeo(): void {
  GEO.tire   = new THREE.CylinderGeometry(1,1,1,18,1);
  GEO.rim    = new THREE.CylinderGeometry(.56,.56,1.02,12,1);
  GEO.hub    = new THREE.CylinderGeometry(.2,.2,1.1,8,1);
  GEO.spoke  = new THREE.BoxGeometry(.11,.9,.16);
  GEO.sphere = new THREE.SphereGeometry(1,16,12);
  GEO.sphereLo=new THREE.SphereGeometry(1,10,8);
  GEO.lolli  = new THREE.SphereGeometry(1,13,9);   // squashed flat — low poly reads fine
  GEO.cyl    = new THREE.CylinderGeometry(1,1,1,14,1);
  GEO.cone   = new THREE.ConeGeometry(1,1,14);
  GEO.torus  = new THREE.TorusGeometry(1,.26,8,20);
  GEO.capsule= new THREE.CapsuleGeometry(1,1,4,10);
  GEO.octa   = new THREE.OctahedronGeometry(1,0);
  GEO.chassis= roundedBox(2.55,.66,4.25,.34,2);
  GEO.nose   = roundedBox(2.05,.5,1.35,.24,2);
  GEO.pod    = roundedBox(.52,.62,2.5,.24,2);
  GEO.bumperF= roundedBox(2.75,.42,.46,.2,2);
  GEO.bumperR= roundedBox(2.6,.5,.44,.2,2);
  GEO.seatB  = roundedBox(1.28,1.32,.3,.16,2);
  GEO.seatS  = roundedBox(1.34,.26,1.0,.13,2);
  GEO.hood   = roundedBox(1.75,.3,1.15,.15,2);
  GEO.wing   = roundedBox(2.45,.14,.66,.08,1);
  GEO.wingP  = roundedBox(.16,.5,.16,.06,1);
  GEO.torso  = roundedBox(1.0,1.12,.72,.3,2);
  GEO.limb   = new THREE.CapsuleGeometry(.15,.62,4,8);
  GEO.dash   = roundedBox(1.7,.42,.34,.14,2);
}

/** Cheap shared-material lookup so 4 karts don't create 200 materials. */
export type MatKind = 'candy' | 'choco' | 'matte' | 'metal' | 'glow' | 'std';
const _matCache=new Map<string, THREE.Material>();
export function mat(
  kind: MatKind,
  color: THREE.ColorRepresentation,
  extra?: Record<string, unknown>,
): THREE.Material {
  const key=kind+'|'+String(color)+'|'+(extra?JSON.stringify(extra):'');
  let m=_matCache.get(key); if(m) return m;
  const o=Object.assign({color},extra||{});
  if(kind==='candy')  m=new THREE.MeshPhysicalMaterial(Object.assign({roughness:.14,metalness:.0,clearcoat:.9,clearcoatRoughness:.12},o));
  else if(kind==='choco') m=new THREE.MeshStandardMaterial(Object.assign({roughness:.72,metalness:.04},o));
  else if(kind==='matte') m=new THREE.MeshStandardMaterial(Object.assign({roughness:.94,metalness:0},o));
  else if(kind==='metal') m=new THREE.MeshStandardMaterial(Object.assign({roughness:.28,metalness:.85},o));
  else if(kind==='glow')  m=new THREE.MeshStandardMaterial(Object.assign({roughness:.3,emissive:new THREE.Color(color),emissiveIntensity:1.1},o));
  else m=new THREE.MeshStandardMaterial(o);
  _matCache.set(key,m); return m;
}
