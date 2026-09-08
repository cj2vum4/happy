/** The three oscillators and filter that make up the engine voice. */
interface EngineVoice {
  o1: OscillatorNode;
  o2: OscillatorNode;
  o3: OscillatorNode;
  f: BiquadFilterNode;
}
/** The looping tyre-scrub voice. */
interface SkidVoice {
  s: AudioBufferSourceNode;
  f: BiquadFilterNode;
  g: GainNode;
}

/**
 * Every sound in the game, synthesised at play time.
 *
 * Nothing is loaded, so there is no audio budget and no decode stall on the
 * first corner. The whole class is a no-op until `init()` succeeds, because a
 * browser that blocks or lacks Web Audio must still be playable in silence
 * rather than throwing on the first skid.
 */
export class AudioMan {
  on = true;
  ready = false;
  ctx: AudioContext | null = null;
  started = false;
  engine: EngineVoice | null = null;
  skid: SkidVoice | null = null;
  musicTimer = 0;
  bar = 0;
  master!: GainNode;
  bus!: DynamicsCompressorNode;
  sfxG!: GainNode;
  musG!: GainNode;
  engG!: GainNode;
  _noiseBuf!: AudioBuffer;
  constructor(){
    // Fields carry their initialisers; nothing to do until a gesture arrives.
  }
  init(): void {
    if(this.ctx) return;
    try{
      // Safari still only exposes the prefixed constructor on older iOS.
      const AC=window.AudioContext
        ?? (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
      if(!AC) return;
      this.ctx=new AC();
      const c=this.ctx;
      this.master=c.createGain(); this.master.gain.value=this.on?.85:0; this.master.connect(c.destination);
      // gentle bus compression so layered SFX never clip
      const comp=c.createDynamicsCompressor();
      comp.threshold.value=-14; comp.knee.value=22; comp.ratio.value=4; comp.attack.value=.004; comp.release.value=.22;
      comp.connect(this.master);
      this.bus=comp;
      this.sfxG=c.createGain(); this.sfxG.gain.value=.9;  this.sfxG.connect(this.bus);
      this.musG=c.createGain(); this.musG.gain.value=.24; this.musG.connect(this.bus);
      this.engG=c.createGain(); this.engG.gain.value=0;   this.engG.connect(this.bus);
      this.ready=true;
      this._noiseBuf=this._makeNoise(2);
    }catch{ this.ready=false; }
  }
  resume(): void { if(this.ctx && this.ctx.state==='suspended') this.ctx.resume().catch(()=>{}); }
  setOn(v: boolean): void {
    this.on=v;
    if(this.master && this.ctx) this.master.gain.setTargetAtTime(v?.85:0, this.ctx.currentTime, .04);
  }
  _makeNoise(sec: number): AudioBuffer {
    const c=this.ctx!, n=c.sampleRate*sec, b=c.createBuffer(1,n,c.sampleRate), d=b.getChannelData(0);
    for(let i=0;i<n;i++) d[i]=Math.random()*2-1;
    return b;
  }
  noise(
    dur: number, filt: number, q: number, gain: number,
    type: BiquadFilterType = 'bandpass', dest?: AudioNode,
  ): void {
    if(!this.ready) return;
    const c=this.ctx!, s=c.createBufferSource(); s.buffer=this._noiseBuf; s.loop=true;
    const f=c.createBiquadFilter(); f.type=type; f.frequency.value=filt; f.Q.value=q;
    const g=c.createGain(); g.gain.value=0;
    s.connect(f); f.connect(g); g.connect(dest||this.sfxG);
    const t=c.currentTime;
    g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(gain,t+.012);
    g.gain.exponentialRampToValueAtTime(.0001,t+dur);
    s.start(t); s.stop(t+dur+.05);
  }
  tone(
    freq: number, dur: number, type: OscillatorType = 'sine', gain = .3,
    slideTo: number | null = null, delay = 0, dest?: AudioNode,
  ): void {
    if(!this.ready) return;
    const c=this.ctx!, t=c.currentTime+delay;
    const o=c.createOscillator(), g=c.createGain();
    o.type=type; o.frequency.setValueAtTime(freq,t);
    if(slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20,slideTo),t+dur);
    g.gain.setValueAtTime(.0001,t);
    g.gain.exponentialRampToValueAtTime(gain,t+Math.min(.02,dur*.2));
    g.gain.exponentialRampToValueAtTime(.0001,t+dur);
    o.connect(g); g.connect(dest||this.sfxG); o.start(t); o.stop(t+dur+.03);
  }
  // ── Engine: two detuned saws + sub, pitch tracks speed
  startEngine(): void {
    if(!this.ready||this.engine) return;
    const c=this.ctx!;
    const o1=c.createOscillator(), o2=c.createOscillator(), o3=c.createOscillator();
    o1.type='sawtooth'; o2.type='sawtooth'; o3.type='square';
    o2.detune.value=13; o3.detune.value=-1200;
    const f=c.createBiquadFilter(); f.type='lowpass'; f.frequency.value=900; f.Q.value=3.2;
    const g1=c.createGain(); g1.gain.value=.34;
    const g3=c.createGain(); g3.gain.value=.2;
    o1.connect(g1); o2.connect(g1); g1.connect(f); o3.connect(g3); g3.connect(f);
    f.connect(this.engG);
    o1.start(); o2.start(); o3.start();
    this.engine={o1,o2,o3,f};
    this.engG.gain.setTargetAtTime(.15,c.currentTime,.3);
  }
  engineUpdate(rpm01: number, load: number): void {
    if(!this.engine) return;
    const c=this.ctx!, t=c.currentTime;
    const base=52+rpm01*168;
    this.engine.o1.frequency.setTargetAtTime(base,t,.045);
    this.engine.o2.frequency.setTargetAtTime(base*1.005,t,.045);
    this.engine.o3.frequency.setTargetAtTime(base*.5,t,.06);
    this.engine.f.frequency.setTargetAtTime(560+rpm01*2100,t,.06);
    this.engG.gain.setTargetAtTime(.09+load*.11,t,.1);
  }
  stopEngine(): void {
    if(!this.engine) return;
    this.engG.gain.setTargetAtTime(0,this.ctx!.currentTime,.15);
    const e=this.engine; this.engine=null;
    setTimeout(()=>{ try{e.o1.stop();e.o2.stop();e.o3.stop();}catch{/* already stopped */} },500);
  }
  // ── Skid loop
  skidStart(): void {
    if(!this.ready||this.skid) return;
    const c=this.ctx!, s=c.createBufferSource(); s.buffer=this._noiseBuf; s.loop=true;
    const f=c.createBiquadFilter(); f.type='bandpass'; f.frequency.value=1750; f.Q.value=2.4;
    const g=c.createGain(); g.gain.value=0;
    s.connect(f); f.connect(g); g.connect(this.sfxG); s.start();
    g.gain.setTargetAtTime(.19,c.currentTime,.06);
    this.skid={s,f,g};
  }
  skidUpdate(intensity: number): void {
    if(!this.skid) return;
    const t=this.ctx!.currentTime;
    this.skid.g.gain.setTargetAtTime(.09+intensity*.19,t,.07);
    this.skid.f.frequency.setTargetAtTime(1350+intensity*1500,t,.07);
  }
  skidStop(): void {
    if(!this.skid) return;
    const k=this.skid; this.skid=null;
    k.g.gain.setTargetAtTime(0,this.ctx!.currentTime,.07);
    setTimeout(()=>{ try{k.s.stop();}catch{/* already stopped */} },420);
  }
  // ── One-shots
  turbo(tier: number): void {
    if(!this.ready) return;
    this.noise(.5+tier*.12,700,1.1,.34,'bandpass');
    this.tone(150,.42,'sawtooth',.2,760+tier*180);
    this.tone(320,.3,'square',.1,1400);
  }
  impact(): void {
    if(!this.ready) return;
    this.noise(.34,320,.7,.5,'lowpass');
    this.tone(120,.24,'square',.28,42);
    this.tone(70,.36,'sine',.3,30);
  }
  bump(): void { this.noise(.13,420,.9,.2,'lowpass'); }
  pickup(): void {
    if(!this.ready) return;
    [660,880,1180].forEach((f,i)=>this.tone(f,.14,'triangle',.2,null,i*.045));
  }
  rouletteTick(i: number): void { this.tone(760+(i%4)*130,.05,'square',.1); }
  itemUse(): void { if(!this.ready)return; this.tone(520,.2,'sawtooth',.2,1180); this.noise(.16,1500,1.4,.16); }
  shieldUp(): void { if(!this.ready)return; [420,560,700,880].forEach((f,i)=>this.tone(f,.3,'sine',.14,null,i*.05)); }
  block(): void { if(!this.ready)return; this.tone(900,.2,'square',.24,220); this.noise(.2,2400,2,.2); }
  count(n: number): void {
    if(!this.ready) return;
    if(n>0){ this.tone(440,.16,'square',.26); this.tone(880,.14,'sine',.12); }
    else { this.tone(720,.5,'square',.3); this.tone(1080,.45,'sawtooth',.16,1320); this.noise(.4,1400,1,.22); }
  }
  finalLap(): void {
    if(!this.ready) return;
    [523,659,784,1046].forEach((f,i)=>this.tone(f,.34,'square',.2,null,i*.09));
    this.noise(.7,600,.8,.2,'lowpass');
  }
  finish(win: boolean): void {
    if(!this.ready) return;
    const notes = win?[523,659,784,1046,1318]:[440,523,587,698];
    notes.forEach((f,i)=>{ this.tone(f,.5,'triangle',.24,null,i*.13); this.tone(f*2,.4,'sine',.1,null,i*.13); });
  }
  eruption(): void {
    if(!this.ready) return;
    this.noise(1.8,150,.5,.4,'lowpass');
    this.tone(58,1.5,'sine',.3,26);
    this.tone(92,1.1,'sawtooth',.14,34);
  }
  ui(): void { this.tone(620,.07,'square',.14,880); }
  /** Lightweight arcade-candy loop: bass pulse + arpeggio + hats. */
  musicStep(dt: number, intensity: number): void {
    if(!this.ready||!this.on) return;
    this.musicTimer-=dt;
    if(this.musicTimer>0) return;
    const bpm=132+intensity*16, step=60/bpm/2;
    this.musicTimer=step;
    const b=this.bar++, s=b&7;
    const ROOT=[0,0,5,5,7,7,3,3][ (b>>3)&7 ]!;
    const hz=(n: number)=>110*Math.pow(2,n/12);
    if(s%2===0) this.tone(hz(ROOT-12),step*1.5,'square',.22,null,0,this.musG);
    const ARP=[0,7,12,16,12,7,4,7];
    this.tone(hz(ROOT+ARP[s]!+12),step*.9,'triangle',.12+intensity*.05,null,0,this.musG);
    if(s===0||s===4) this.noise(.06,7000,1,.09,'highpass',this.musG);
    if(s===2||s===6) this.noise(.16,220,.6,.14,'lowpass',this.musG);
    if(intensity>.5 && (s===3||s===7)) this.tone(hz(ROOT+ARP[(s+3)&7]!+24),step*.6,'square',.06,null,0,this.musG);
  }
}
export const AUDIO = new AudioMan();

/**
 * Haptics ride along with the sound toggle: muting the game should silence the
 * phone in your hands too, not just the speaker.
 */
export const HAPTIC = {
  ok: (typeof navigator!=='undefined' && typeof navigator.vibrate==='function'),
  buzz(p: number | number[]): void {
    if(!this.ok||!AUDIO.on) return;
    try{ navigator.vibrate(p); }catch{/* blocked by the browser */}
  },
  tap(): void { this.buzz(11); },
  bump(): void { this.buzz(24); },
  hit(): void { this.buzz([0,42,34,60]); },
  turbo(): void { this.buzz([0,20,26,44]); },
  count(): void { this.buzz(16); },
  go(): void { this.buzz([0,34,26,80]); },
};

