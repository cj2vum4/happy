import * as THREE from 'three';
import { rand, randi } from '@/core/math';

/**
 * Every texture in the game, drawn into canvases at boot.
 *
 * Nothing is fetched: the whole art direction is procedural, so the game has no
 * asset budget, no loading failure mode, and no licence to track. Keys are
 * filled by `buildTextures` and read by name everywhere else, which is why the
 * index signature is loose rather than an exhaustive union — Phase 3 replaces
 * this module wholesale.
 */
export const TEX: Record<string, THREE.Texture> = {};

type Ctx2D = CanvasRenderingContext2D;

/** A square canvas and its 2D context, ready to draw into. */
function cv(size: number): [HTMLCanvasElement, Ctx2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function finish(c: HTMLCanvasElement, rx = 1, ry = 1, aniso = 4): THREE.CanvasTexture {
  const t=new THREE.CanvasTexture(c);
  t.wrapS=t.wrapT=THREE.RepeatWrapping; t.repeat.set(rx,ry);
  t.anisotropy=aniso; t.colorSpace=THREE.SRGBColorSpace; t.needsUpdate=true; return t;
}

export function buildTextures(maxAniso: number): void {
  // ── Soft radial particle sprite
  {
    const [c,x]=cv(64);
    const g=x.createRadialGradient(32,32,0,32,32,32);
    g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(.35,'rgba(255,255,255,.72)');
    g.addColorStop(.72,'rgba(255,255,255,.16)'); g.addColorStop(1,'rgba(255,255,255,0)');
    x.fillStyle=g; x.fillRect(0,0,64,64);
    TEX.spark=new THREE.CanvasTexture(c); TEX.spark.colorSpace=THREE.SRGBColorSpace;
  }
  // ── Chunky puff sprite (smoke / marshmallow)
  {
    const [c,x]=cv(96);
    for(let i=0;i<9;i++){
      const a=i/9*Math.PI*2, r=22+Math.sin(i*2.3)*8;
      const px=48+Math.cos(a)*r*.62, py=48+Math.sin(a)*r*.62, rr=20+Math.sin(i*1.7)*7;
      const g=x.createRadialGradient(px,py,0,px,py,rr);
      g.addColorStop(0,'rgba(255,255,255,.92)'); g.addColorStop(.6,'rgba(255,255,255,.42)');
      g.addColorStop(1,'rgba(255,255,255,0)');
      x.fillStyle=g; x.beginPath(); x.arc(px,py,rr,0,7); x.fill();
    }
    const g=x.createRadialGradient(48,48,0,48,48,30);
    g.addColorStop(0,'rgba(255,255,255,.95)'); g.addColorStop(1,'rgba(255,255,255,0)');
    x.fillStyle=g; x.beginPath(); x.arc(48,48,30,0,7); x.fill();
    TEX.puff=new THREE.CanvasTexture(c); TEX.puff.colorSpace=THREE.SRGBColorSpace;
  }
  // ── Road: dark chocolate + sprinkles + subtle wear
  {
    const S=512, [c,x]=cv(S);
    const g=x.createLinearGradient(0,0,S,0);
    g.addColorStop(0,'#5c333a'); g.addColorStop(.5,'#6b3c43'); g.addColorStop(1,'#5c333a');
    x.fillStyle=g; x.fillRect(0,0,S,S);
    // cocoa grain
    for(let i=0;i<2600;i++){
      const px=Math.random()*S, py=Math.random()*S, r=Math.random()*2.4+.4;
      x.fillStyle=`rgba(${58+randi(46)},${32+randi(30)},${38+randi(28)},${.1+Math.random()*.28})`;
      x.beginPath(); x.arc(px,py,r,0,7); x.fill();
    }
    // sprinkles (only outside the driving groove for readability)
    const SP=['#ff5fa8','#ffd54a','#57e6c8','#a86bff','#fff4e6','#ff8a4a'];
    for(let i=0;i<190;i++){
      const px=Math.random()*S, py=Math.random()*S;
      const d=Math.abs(px-S*.5)/(S*.5); if(d<.34 && Math.random()<.8) continue;
      x.save(); x.translate(px,py); x.rotate(Math.random()*7);
      x.fillStyle=SP[randi(SP.length)]; x.globalAlpha=.34+Math.random()*.3;
      x.fillRect(-1.3,-4.4,2.6,8.8); x.restore();
    }
    // faint racing groove
    x.globalAlpha=.14;
    const gg=x.createLinearGradient(0,0,S,0);
    gg.addColorStop(0,'rgba(0,0,0,0)'); gg.addColorStop(.5,'rgba(0,0,0,.85)'); gg.addColorStop(1,'rgba(0,0,0,0)');
    x.fillStyle=gg; x.fillRect(0,0,S,S); x.globalAlpha=1;
    TEX.road=finish(c,1,26,maxAniso);
  }
  // ── Candy-cane stripe (curbs, barriers, exhaust)
  {
    const S=128, [c,x]=cv(S);
    x.fillStyle='#fff6ee'; x.fillRect(0,0,S,S);
    x.save(); x.translate(S/2,S/2); x.rotate(-Math.PI/4); x.translate(-S,-S);
    x.fillStyle='#ff3d72';
    for(let i=0;i<9;i++) x.fillRect(0,i*(S*2/9),S*2,S*2/18);
    x.restore();
    TEX.stripe=finish(c,1,1,maxAniso);
  }
  // ── Strawberry lava: molten syrup cells
  {
    const S=256, [c,x]=cv(S);
    x.fillStyle='#6d0018'; x.fillRect(0,0,S,S);
    for(let i=0;i<70;i++){
      const px=Math.random()*S, py=Math.random()*S, r=14+Math.random()*44;
      const g=x.createRadialGradient(px,py,0,px,py,r);
      g.addColorStop(0,'rgba(255,244,150,.95)'); g.addColorStop(.28,'rgba(255,120,60,.8)');
      g.addColorStop(.62,'rgba(232,26,80,.5)'); g.addColorStop(1,'rgba(120,0,30,0)');
      x.fillStyle=g; x.beginPath(); x.arc(px,py,r,0,7); x.fill();
    }
    // dark crust veins
    x.globalCompositeOperation='multiply';
    for(let i=0;i<34;i++){
      x.strokeStyle=`rgba(70,0,20,${.3+Math.random()*.4})`; x.lineWidth=1+Math.random()*4;
      x.beginPath(); let px=Math.random()*S, py=Math.random()*S; x.moveTo(px,py);
      for(let k=0;k<5;k++){ px+=rand(-52,52); py+=rand(-52,52); x.lineTo(px,py); }
      x.stroke();
    }
    x.globalCompositeOperation='source-over';
    TEX.lava=finish(c,3,3,2);
  }
  // ── Chocolate rock. Kept in a mid tone on purpose: the materials that use it
  //    are tinted white, so the texture alone carries the value. A dark texture
  //    multiplied by a dark tint lands at ~0 in linear space and reads as black.
  {
    const S=256, [c,x]=cv(S);
    x.fillStyle='#7a4c33'; x.fillRect(0,0,S,S);
    for(let i=0;i<1400;i++){
      const px=Math.random()*S, py=Math.random()*S, r=Math.random()*7+1;
      const v=randi(54);
      x.fillStyle=`rgb(${96+v} ${58+v*.55} ${40+v*.5} / ${(.14+Math.random()*.3).toFixed(2)})`;
      x.beginPath(); x.arc(px,py,r,0,7); x.fill();
    }
    // cocoa highlights + darker crevices for readable form
    for(let i=0;i<300;i++){
      x.fillStyle=`rgba(196,146,102,${(.06+Math.random()*.2).toFixed(2)})`;
      x.beginPath(); x.arc(Math.random()*S,Math.random()*S,Math.random()*5+1,0,7); x.fill();
    }
    for(let i=0;i<220;i++){
      x.fillStyle=`rgba(56,30,20,${(.08+Math.random()*.26).toFixed(2)})`;
      x.beginPath(); x.arc(Math.random()*S,Math.random()*S,Math.random()*6+1,0,7); x.fill();
    }
    TEX.rock=finish(c,4,4,2);
  }
  // ── Ground: frosting-dusted candy soil
  {
    const S=256, [c,x]=cv(S);
    const g=x.createLinearGradient(0,0,0,S);
    g.addColorStop(0,'#6b3550'); g.addColorStop(.5,'#59263f'); g.addColorStop(1,'#4a1c33');
    x.fillStyle=g; x.fillRect(0,0,S,S);
    for(let i=0;i<900;i++){
      const px=Math.random()*S, py=Math.random()*S, r=Math.random()*11+2;
      x.fillStyle=`rgba(${120+randi(70)},${70+randi(50)},${110+randi(60)},${.05+Math.random()*.14})`;
      x.beginPath(); x.arc(px,py,r,0,7); x.fill();
    }
    // sugar dusting
    for(let i=0;i<520;i++){
      x.fillStyle=`rgba(255,235,250,${.08+Math.random()*.3})`;
      x.beginPath(); x.arc(Math.random()*S,Math.random()*S,Math.random()*1.7+.3,0,7); x.fill();
    }
    TEX.ground=finish(c,34,34,maxAniso);
  }
  // ── Start/finish checker with candy colours
  {
    const S=256, [c,x]=cv(S);
    const n=8, q=S/n;
    for(let i=0;i<n;i++) for(let j=0;j<n;j++){
      x.fillStyle=((i+j)&1)?'#fff6ee':'#33131f'; x.fillRect(i*q,j*q,q,q);
    }
    x.strokeStyle='rgba(255,90,160,.55)'; x.lineWidth=5; x.strokeRect(0,0,S,S);
    TEX.check=finish(c,10,1,maxAniso);
  }
}

/* ═══════════════ 2. GEOMETRY HELPERS ═══════════════ */
