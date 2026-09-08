import * as THREE from 'three';
import { rand } from '@/core/math';
import { GEO, mat, roundedBox } from '@/render/geom';
import { TEX } from '@/render/textures';

/** One racer's colourway. Every part of the kart and driver reads from this. */
export interface Palette {
  body: string; trim: string; rim: string; seat: string; glow: string;
  suit: string; suit2: string; skin: string; hair: string; lens: string;
}

/** A wheel the simulation animates: steering group, spin group, radius. */
export interface KartWheel {
  steerG: THREE.Group;
  spinG: THREE.Group;
  front: boolean;
  R: number;
}

/**
 * The handles the simulation needs to animate a kart. Everything else the
 * factory builds is parented and forgotten.
 */
export interface KartModel {
  group: THREE.Group;
  wheels: KartWheel[];
  /** The steering wheel, not the road wheels. */
  wheelGrp: THREE.Group;
  hipG: THREE.Group;
  headG: THREE.Group;
  arms: THREE.Group[];
  chassis: THREE.Mesh;
  emblem: THREE.Mesh;
  /** Local-space exhaust tips, where the boost flame and smoke are emitted. */
  exhausts: THREE.Vector3[];
  driver: THREE.Group;
  gum: THREE.Mesh;
  seatBack: THREE.Mesh;
}

/** Builds one full kart + seated driver. Returns animation handles. */
export function buildKart(pal: Palette): KartModel {
  const G=new THREE.Group();
  const bodyM  = mat('candy',pal.body);
  const trimM  = mat('candy',pal.trim);
  const darkM  = mat('choco','#2a1219');
  const tireM  = mat('matte','#221016');
  const rimM   = mat('metal',pal.rim);
  const chromeM= mat('metal','#e8dcc8');
  const creamM = mat('candy','#fff4e6');

  // ── Chassis stack
  const chassis=new THREE.Mesh(GEO.chassis,bodyM);
  chassis.position.y=.86; chassis.castShadow=true;
  G.add(chassis);

  const floor=new THREE.Mesh(roundedBox(2.35,.2,4.0,.1,1),darkM);
  floor.position.y=.55; G.add(floor);

  // nose + splitter
  const nose=new THREE.Mesh(GEO.nose,bodyM);
  nose.position.set(0,.82,2.42); nose.rotation.x=-.1; nose.castShadow=true; G.add(nose);
  const noseTip=new THREE.Mesh(GEO.cone,trimM);
  noseTip.scale.set(.85,.7,.85); noseTip.rotation.x=Math.PI/2;
  noseTip.position.set(0,.78,3.12); G.add(noseTip);
  const splitter=new THREE.Mesh(roundedBox(2.5,.1,.7,.05,1),creamM);
  splitter.position.set(0,.5,2.85); G.add(splitter);

  // side pods
  for(const sx of [-1,1]){
    const pod=new THREE.Mesh(GEO.pod,trimM);
    pod.position.set(sx*1.36,.82,.15); pod.castShadow=true; G.add(pod);
    const podTop=new THREE.Mesh(roundedBox(.46,.16,1.9,.07,1),creamM);
    podTop.position.set(sx*1.36,1.16,.15); G.add(podTop);
  }
  // bumpers
  const bf=new THREE.Mesh(GEO.bumperF,chromeM); bf.position.set(0,.62,3.0); G.add(bf);
  const br=new THREE.Mesh(GEO.bumperR,chromeM); br.position.set(0,.72,-2.1); G.add(br);

  // hood + candy emblem
  const hood=new THREE.Mesh(GEO.hood,trimM);
  hood.position.set(0,1.18,1.42); G.add(hood);
  const emblem=new THREE.Mesh(GEO.torus,mat('glow',pal.glow,{emissiveIntensity:.9}));
  emblem.scale.set(.3,.3,.3); emblem.position.set(0,1.4,1.42); emblem.rotation.x=Math.PI/2;
  G.add(emblem);
  const gum=new THREE.Mesh(GEO.sphereLo,mat('candy',pal.glow,{transparent:true,opacity:.9}));
  gum.scale.setScalar(.19); gum.position.set(0,1.42,1.42); G.add(gum);

  // ── Seat + cockpit.  The rear three-quarter is the view the player lives in
  //    all race, so it carries the racer's colour rather than dark upholstery.
  const seatBack=new THREE.Mesh(GEO.seatB,mat('matte',pal.seat));
  seatBack.position.set(0,1.5,-1.12); seatBack.rotation.x=.2; seatBack.castShadow=true; G.add(seatBack);
  const seatShell=new THREE.Mesh(roundedBox(1.52,1.5,.26,.22,2),bodyM);
  seatShell.position.set(0,1.52,-1.3); seatShell.rotation.x=.2; seatShell.castShadow=true; G.add(seatShell);
  const seatBase=new THREE.Mesh(GEO.seatS,mat('matte',pal.seat));
  seatBase.position.set(0,.86,-.6); G.add(seatBase);
  const headrest=new THREE.Mesh(GEO.sphereLo,mat('candy',pal.trim));
  headrest.scale.set(.44,.32,.26); headrest.position.set(0,2.14,-1.2); G.add(headrest);
  // rear deck + diffuser so the tail reads as bodywork, not a hole
  const deck=new THREE.Mesh(roundedBox(2.3,.3,1.25,.16,2),bodyM);
  deck.position.set(0,1.16,-1.86); G.add(deck);
  const diffuser=new THREE.Mesh(roundedBox(2.2,.5,.5,.14,2),mat('candy',pal.trim));
  diffuser.position.set(0,.72,-2.28); diffuser.rotation.x=-.22; G.add(diffuser);
  for(let i=0;i<3;i++){
    const fin=new THREE.Mesh(roundedBox(.1,.42,.9,.04,1),creamM);
    fin.position.set((i-1)*.62,.78,-2.2); G.add(fin);
  }
  // tail lights — two glowing candy discs, the clearest ID at distance
  for(const sx of [-1,1]){
    const tl=new THREE.Mesh(GEO.cyl,mat('glow',pal.glow,{emissiveIntensity:1.5}));
    tl.scale.set(.22,.1,.22); tl.rotation.x=Math.PI/2;
    tl.position.set(sx*.86,1.2,-2.44); G.add(tl);
  }

  const dash=new THREE.Mesh(GEO.dash,darkM);
  dash.position.set(0,1.24,.62); G.add(dash);

  // ── Steering column + wheel (animated)
  const colGrp=new THREE.Group(); colGrp.position.set(0,1.34,.48); colGrp.rotation.x=-.44; G.add(colGrp);
  const col=new THREE.Mesh(GEO.cyl,chromeM); col.scale.set(.07,.5,.07); col.position.y=-.2; colGrp.add(col);
  const wheelGrp=new THREE.Group(); wheelGrp.position.y=.14; colGrp.add(wheelGrp);
  const swRim=new THREE.Mesh(GEO.torus,mat('matte','#1c0d13'));
  swRim.scale.set(.36,.36,.36); wheelGrp.add(swRim);
  for(let i=0;i<3;i++){
    const sp=new THREE.Mesh(GEO.spoke,trimM);
    sp.scale.set(.7,.42,.7); sp.rotation.z=i*Math.PI*2/3; sp.position.set(0,0,0);
    const a=i*Math.PI*2/3; sp.position.set(Math.cos(a+Math.PI/2)*.17,Math.sin(a+Math.PI/2)*.17,0);
    wheelGrp.add(sp);
  }
  const swHub=new THREE.Mesh(GEO.sphereLo,mat('candy',pal.glow)); swHub.scale.setScalar(.1); wheelGrp.add(swHub);

  // ── Exhaust pipes (candy striped)
  const stripeM=new THREE.MeshStandardMaterial({map:TEX.stripe,roughness:.34,metalness:.15});
  const exhausts: THREE.Vector3[]=[];
  for(const sx of [-1,1]){
    const ex=new THREE.Mesh(GEO.cyl,stripeM);
    ex.scale.set(.15,1.5,.15); ex.rotation.x=Math.PI/2-.16;
    ex.position.set(sx*.72,1.02,-2.05); G.add(ex);
    const tip=new THREE.Mesh(GEO.cyl,chromeM);
    tip.scale.set(.19,.22,.19); tip.rotation.x=Math.PI/2-.16;
    tip.position.set(sx*.72,.94,-2.82); G.add(tip);
    exhausts.push(new THREE.Vector3(sx*.72,.94,-2.95));
  }
  // ── Rear wing
  const wing=new THREE.Mesh(GEO.wing,trimM);
  wing.position.set(0,1.86,-2.32); wing.rotation.x=.2; wing.castShadow=true; G.add(wing);
  for(const sx of [-1,1]){
    const p=new THREE.Mesh(GEO.wingP,darkM); p.position.set(sx*.95,1.6,-2.3); G.add(p);
  }
  const wingLip=new THREE.Mesh(roundedBox(2.45,.1,.2,.05,1),creamM);
  wingLip.position.set(0,1.92,-2.6); wingLip.rotation.x=.2; G.add(wingLip);

  // sprinkle decorations along the pods
  for(let i=0;i<8;i++){
    const s=new THREE.Mesh(GEO.cyl,mat('candy',i%2?pal.glow:'#fff4e6'));
    s.scale.set(.045,.16,.045);
    s.position.set((i<4?-1:1)*1.63,1.05,(i%4)*.62-.95);
    s.rotation.z=Math.PI/2; s.rotation.y=rand(-.4,.4);
    G.add(s);
  }

  // ── Wheels
  const wheels: KartWheel[]=[];
  const WP=[[-1.42,.72,1.5],[1.42,.72,1.5],[-1.48,.78,-1.5],[1.48,.78,-1.5]];
  WP.forEach((p,i)=>{
    const front=i<2;
    const steerG=new THREE.Group(); steerG.position.set(p[0],p[1],p[2]); G.add(steerG);
    const spinG=new THREE.Group(); steerG.add(spinG);
    const R=front?.72:.8, W=front?.5:.62;
    const tire=new THREE.Mesh(GEO.tire,tireM);
    tire.scale.set(R,W,R); tire.rotation.z=Math.PI/2; tire.castShadow=true; spinG.add(tire);
    const rim=new THREE.Mesh(GEO.rim,rimM);
    rim.scale.set(R,W,R); rim.rotation.z=Math.PI/2; spinG.add(rim);
    for(let k=0;k<5;k++){
      const sp=new THREE.Mesh(GEO.spoke,rimM);
      sp.scale.set(1,R*1.15,1); sp.rotation.z=Math.PI/2; sp.rotation.x=k*Math.PI*2/5;
      spinG.add(sp);
    }
    const hub=new THREE.Mesh(GEO.hub,mat('candy',pal.glow));
    hub.scale.set(R,W*1.08,R); hub.rotation.z=Math.PI/2; spinG.add(hub);
    // sidewall candy stripe
    for(const sw of [-1,1]){
      const ring=new THREE.Mesh(GEO.torus,mat('candy',pal.trim));
      ring.scale.set(R*.86,R*.86,R*.28); ring.position.x=sw*W*.5; ring.rotation.y=Math.PI/2;
      spinG.add(ring);
    }
    wheels.push({steerG,spinG,front,R});
  });

  // ═══ DRIVER ═══
  const D=new THREE.Group(); D.position.set(0,1.06,-.62); G.add(D);
  const suitM=mat('matte',pal.suit), suit2=mat('matte',pal.suit2);
  const skinM=mat('matte',pal.skin);

  const hipG=new THREE.Group(); D.add(hipG);              // leans with drift
  const torso=new THREE.Mesh(GEO.torso,suitM);
  torso.position.y=.52; torso.castShadow=true; hipG.add(torso);
  const chest=new THREE.Mesh(roundedBox(1.06,.5,.78,.24,2),suit2);
  chest.position.y=.86; hipG.add(chest);
  // racing number bib
  const bib=new THREE.Mesh(roundedBox(.5,.5,.06,.1,1),mat('matte','#fff4e6'));
  bib.position.set(0,.72,.38); hipG.add(bib);
  // collar
  const collar=new THREE.Mesh(GEO.torus,mat('candy',pal.trim));
  collar.scale.set(.36,.36,.5); collar.position.y=1.08; collar.rotation.x=Math.PI/2; hipG.add(collar);

  const neck=new THREE.Mesh(GEO.cyl,skinM); neck.scale.set(.15,.16,.15); neck.position.y=1.12; hipG.add(neck);

  // head assembly (looks into corners)
  const headG=new THREE.Group(); headG.position.y=1.24; hipG.add(headG);
  const head=new THREE.Mesh(GEO.sphere,skinM);
  head.scale.set(.42,.46,.4); head.castShadow=true; headG.add(head);
  // hair — layered blobs for a real silhouette
  const hairM=mat('matte',pal.hair);
  const hairTop=new THREE.Mesh(GEO.sphereLo,hairM);
  hairTop.scale.set(.45,.36,.43); hairTop.position.set(0,.16,-.02); headG.add(hairTop);
  for(let i=0;i<4;i++){
    const tuft=new THREE.Mesh(GEO.sphereLo,hairM);
    const a=(i/4)*Math.PI*2;
    tuft.scale.set(.2,.16,.2);
    tuft.position.set(Math.cos(a)*.3,.24+Math.sin(i*1.7)*.07,Math.sin(a)*.28-.06);
    headG.add(tuft);
  }
  const ponytail=new THREE.Mesh(GEO.capsule,hairM);
  ponytail.scale.set(.17,.2,.17); ponytail.position.set(0,.04,-.44); ponytail.rotation.x=.75; headG.add(ponytail);
  // goggles
  const strap=new THREE.Mesh(GEO.torus,mat('matte',pal.trim));
  strap.scale.set(.44,.44,.34); strap.position.set(0,.1,0); strap.rotation.x=Math.PI/2+.16; headG.add(strap);
  for(const sx of [-1,1]){
    const lens=new THREE.Mesh(GEO.sphereLo,mat('candy',pal.lens,{transparent:true,opacity:.92,roughness:.05}));
    lens.scale.set(.17,.15,.1); lens.position.set(sx*.17,.12,.33); headG.add(lens);
    const ring=new THREE.Mesh(GEO.torus,mat('metal','#d8ccb8'));
    ring.scale.set(.19,.19,.16); ring.position.set(sx*.17,.12,.33); headG.add(ring);
  }
  // face
  for(const sx of [-1,1]){
    const cheek=new THREE.Mesh(GEO.sphereLo,mat('matte','#ff9fb8',{transparent:true,opacity:.55}));
    cheek.scale.set(.1,.07,.05); cheek.position.set(sx*.24,-.08,.3); headG.add(cheek);
  }
  const mouth=new THREE.Mesh(GEO.torus,mat('matte','#8c2b3f'));
  mouth.scale.set(.09,.09,.05); mouth.position.set(0,-.16,.36); mouth.rotation.x=.2; headG.add(mouth);

  // arms → hands on the wheel
  const arms: THREE.Group[]=[];
  for(const sx of [-1,1]){
    const shoulder=new THREE.Group();
    shoulder.position.set(sx*.52,.86,.06); hipG.add(shoulder);
    const upper=new THREE.Mesh(GEO.limb,suit2);
    upper.scale.set(1,.9,1); upper.position.set(sx*.1,-.2,.28); upper.rotation.set(-1.02,0,sx*.24);
    shoulder.add(upper);
    const fore=new THREE.Mesh(GEO.limb,suitM);
    fore.scale.set(.9,.8,.9); fore.position.set(sx*.2,-.34,.72); fore.rotation.set(-1.35,0,sx*.18);
    shoulder.add(fore);
    const glove=new THREE.Mesh(GEO.sphereLo,mat('matte',pal.trim));
    glove.scale.setScalar(.16); glove.position.set(sx*.25,-.4,1.0); shoulder.add(glove);
    arms.push(shoulder);
  }
  // knees peeking out of the cockpit
  for(const sx of [-1,1]){
    const knee=new THREE.Mesh(GEO.sphereLo,suit2);
    knee.scale.set(.19,.19,.3); knee.position.set(sx*.3,.14,.86); hipG.add(knee);
  }

  return {
    group:G, wheels, wheelGrp, hipG, headG, arms, chassis, emblem, exhausts,
    driver:D, gum, seatBack,
  };
}

