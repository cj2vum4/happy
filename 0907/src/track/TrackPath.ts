import * as THREE from 'three';
import { clamp, lerp } from '@/core/math';

export interface TrackFrame {
  pos: THREE.Vector3;
  tan: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  bank: number;
  width: number;
  curv: number;
}

export interface Projection {
  fr: TrackFrame;
  idx: number;
  s: number;
  lat: number;
  y: number;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/**
 * A closed circuit sampled into arc-length space.
 *
 * Everything downstream — driving, AI, lap counting, item boxes, scenery
 * placement, camera clamping — is expressed as a distance `s` around the lap
 * plus a lateral offset. Keeping one shared parameterisation is what makes
 * those systems cheap and consistent with each other.
 */
export class TrackPath {
  readonly curve: THREE.CatmullRomCurve3;
  readonly N: number;
  readonly pts: THREE.Vector3[] = [];
  readonly tan: THREE.Vector3[] = [];
  readonly right: THREE.Vector3[] = [];
  readonly up: THREE.Vector3[] = [];
  readonly cum: Float32Array;
  readonly curv: Float32Array;
  readonly bank: Float32Array;
  readonly width: Float32Array;
  readonly len: number;

  private _f0: TrackFrame = TrackPath.emptyFrame();

  constructor(ctrl: Array<[number, number, number]>, samples = 900) {
    this.curve = new THREE.CatmullRomCurve3(
      ctrl.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
      true,
      'catmullrom',
      0.5,
    );
    const N = (this.N = samples);
    this.cum = new Float32Array(N + 1);
    this.curv = new Float32Array(N);
    this.bank = new Float32Array(N);
    this.width = new Float32Array(N);

    for (let i = 0; i < N; i++) {
      const t = i / N;
      this.pts.push(this.curve.getPointAt(t));
      this.tan.push(this.curve.getTangentAt(t).normalize());
    }

    let acc = 0;
    for (let i = 0; i < N; i++) {
      this.cum[i] = acc;
      acc += this.pts[i]!.distanceTo(this.pts[(i + 1) % N]!);
    }
    this.cum[N] = acc;
    this.len = acc;

    // Signed curvature from the turn between consecutive tangents.
    for (let i = 0; i < N; i++) {
      const a = this.tan[i]!;
      const b = this.tan[(i + 1) % N]!;
      const ds = this.pts[i]!.distanceTo(this.pts[(i + 1) % N]!) || 1e-3;
      this.curv[i] = (a.z * b.x - a.x * b.z) / ds;
    }
    TrackPath.smooth(this.curv, 3);

    for (let i = 0; i < N; i++) {
      this.bank[i] = clamp(this.curv[i]! * 46, -0.2, 0.2);
      // Narrow as the corner tightens. A wide corner can be straight-lined,
      // which removes any reason to drift through it; a drift turns tighter
      // than grip does and so needs less road, not more.
      this.width[i] = lerp(30, 20, TrackPath.smoothstep(0.004, 0.026, Math.abs(this.curv[i]!)));
    }
    TrackPath.smooth(this.bank, 6);
    TrackPath.smooth(this.width, 10);

    for (let i = 0; i < N; i++) {
      const up = _v1.set(0, 1, 0).applyAxisAngle(this.tan[i]!, this.bank[i]!).clone();
      this.up.push(up);
      this.right.push(new THREE.Vector3().crossVectors(this.tan[i]!, up).normalize());
    }
  }

  static emptyFrame(): TrackFrame {
    return {
      pos: new THREE.Vector3(),
      tan: new THREE.Vector3(),
      right: new THREE.Vector3(),
      up: new THREE.Vector3(),
      bank: 0,
      width: 0,
      curv: 0,
    };
  }

  private static smoothstep(e0: number, e1: number, x: number): number {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  private static smooth(arr: Float32Array, passes: number): void {
    const N = arr.length;
    const tmp = new Float32Array(N);
    for (let p = 0; p < passes; p++) {
      for (let i = 0; i < N; i++)
        tmp[i] = (arr[(i - 1 + N) % N]! + arr[i]! * 2 + arr[(i + 1) % N]!) / 4;
      arr.set(tmp);
    }
  }

  /** Arc length -> fractional sample index. */
  idxAtS(s: number): number {
    s = ((s % this.len) + this.len) % this.len;
    let lo = 0;
    let hi = this.N;
    while (lo < hi - 1) {
      const m = (lo + hi) >> 1;
      if (this.cum[m]! <= s) lo = m;
      else hi = m;
    }
    const seg = this.cum[lo + 1]! - this.cum[lo]! || 1e-3;
    return lo + (s - this.cum[lo]!) / seg;
  }

  sAtIdx(fi: number): number {
    const i = Math.floor(fi) % this.N;
    const f = fi - Math.floor(fi);
    return this.cum[i]! + (this.cum[i + 1]! - this.cum[i]!) * f;
  }

  frame(fi: number, out: TrackFrame): TrackFrame {
    const N = this.N;
    const i = ((Math.floor(fi) % N) + N) % N;
    const j = (i + 1) % N;
    const f = fi - Math.floor(fi);
    out.pos.copy(this.pts[i]!).lerp(this.pts[j]!, f);
    out.tan.copy(this.tan[i]!).lerp(this.tan[j]!, f).normalize();
    out.right.copy(this.right[i]!).lerp(this.right[j]!, f).normalize();
    out.up.copy(this.up[i]!).lerp(this.up[j]!, f).normalize();
    out.bank = lerp(this.bank[i]!, this.bank[j]!, f);
    out.width = lerp(this.width[i]!, this.width[j]!, f);
    out.curv = lerp(this.curv[i]!, this.curv[j]!, f);
    return out;
  }

  frameAtS(s: number, out: TrackFrame): TrackFrame {
    return this.frame(this.idxAtS(s), out);
  }

  /** World position on the road surface at arc length `s`, lateral offset `o`. */
  posAt(s: number, o: number, out: THREE.Vector3): THREE.Vector3 {
    const fr = this.frameAtS(s, this._f0);
    return out
      .copy(fr.pos)
      .addScaledVector(fr.right, o)
      .setY(fr.pos.y + Math.sin(fr.bank) * o);
  }

  /**
   * Project a world point onto the circuit.
   * `hint` restricts the search to samples near the caller's last known index,
   * which turns this from an O(N) scan into a handful of comparisons.
   */
  project(p: THREE.Vector3, hint: number | undefined, res: Projection): Projection {
    const N = this.N;
    let best = -1;
    let bd = Infinity;
    const range = hint === undefined ? N : 44;
    const start = hint === undefined ? 0 : hint - 12;
    for (let k = 0; k < range; k++) {
      const i = (((start + k) % N) + N) % N;
      const dx = p.x - this.pts[i]!.x;
      const dz = p.z - this.pts[i]!.z;
      const d = dx * dx + dz * dz;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    // A NaN position leaves `best` at -1; bail out rather than indexing past
    // the array and producing a confusing error far from the real cause.
    if (best < 0) return res;

    const i = best;
    const j = (i + 1) % N;
    const h = (i - 1 + N) % N;
    const refine = (a: number, b: number): number => {
      const ax = this.pts[a]!.x;
      const az = this.pts[a]!.z;
      const bx = this.pts[b]!.x - ax;
      const bz = this.pts[b]!.z - az;
      const L = bx * bx + bz * bz || 1e-6;
      return clamp(((p.x - ax) * bx + (p.z - az) * bz) / L, 0, 1);
    };
    const tf = refine(i, j);
    const tb = refine(h, i);
    const fi = tb < 1 && tb > 0 && tf <= 0 ? i - 1 + tb : i + tf;

    const fr = this.frame(fi, res.fr);
    res.idx = ((Math.floor(fi) % N) + N) % N;
    res.s = this.sAtIdx(((fi % N) + N) % N);
    _v2.subVectors(p, fr.pos);
    res.lat = _v2.x * fr.right.x + _v2.z * fr.right.z;
    res.y = fr.pos.y + Math.sin(fr.bank) * res.lat;
    return res;
  }

  static emptyProjection(): Projection {
    return { fr: TrackPath.emptyFrame(), idx: 0, s: 0, lat: 0, y: 0 };
  }

  /** Worst curvature over the next `dist` metres — drives AI corner braking. */
  maxCurvAhead(s: number, dist: number): number {
    let m = 0;
    const steps = 8;
    for (let k = 1; k <= steps; k++) {
      const fi = this.idxAtS(s + (dist * k) / steps);
      const c = this.curv[((Math.floor(fi) % this.N) + this.N) % this.N]!;
      if (Math.abs(c) > Math.abs(m)) m = c;
    }
    return m;
  }

  /** True when (x,z) clears every part of the circuit by `pad`. */
  clearOfTrack(x: number, z: number, pad: number): boolean {
    for (let i = 0; i < this.N; i += 3) {
      const dx = this.pts[i]!.x - x;
      const dz = this.pts[i]!.z - z;
      const need = this.width[i]! * 0.5 + pad;
      if (dx * dx + dz * dz < need * need) return false;
    }
    return true;
  }
}
