import { clamp, lerp } from '@/core/math';

/** [x, z, cornerRadius, elevation] */
export type CircuitVertex = [number, number, number, number];

export interface CircuitDef {
  id: string;
  name: string;
  /** Closed polygon whose corners are rounded to an exact radius. */
  poly: CircuitVertex[];
  /** Where the volcano (or this circuit's centrepiece) stands. */
  centrepiece: { x: number; z: number; base: number; height: number; top: number };
}

/**
 * Circuits are authored as a closed polygon with a radius per corner rather
 * than as hand-placed spline points, because the layout has to hit specific
 * numbers for the drifting mechanic to mean anything:
 *
 *   a kart holds  TOP/OMEGA        ~= 38 units of radius flat out
 *   and           TOP/(OMEGA*1.35) ~= 28 units while drifting
 *
 * so a corner between those figures can only be taken at full speed by
 * drifting through it. Authoring by radius makes that band explicit; authoring
 * by spline points made it accidental.
 */
export function buildCircuit(poly: CircuitVertex[]): Array<[number, number, number]> {
  const n = poly.length;
  const V = poly.map((p) => ({ x: p[0], z: p[1], r: p[2], y: p[3] }));

  const geo = V.map((v, i) => {
    const a = V[(i - 1 + n) % n]!;
    const b = V[(i + 1) % n]!;
    const ux = a.x - v.x;
    const uz = a.z - v.z;
    const ul = Math.hypot(ux, uz);
    const wx = b.x - v.x;
    const wz = b.z - v.z;
    const wl = Math.hypot(wx, wz);
    const u = { x: ux / ul, z: uz / ul };
    const w = { x: wx / wl, z: wz / wl };
    const phi = Math.acos(clamp(u.x * w.x + u.z * w.z, -0.9999, 0.9999));
    let r = v.r;
    let t = r / Math.tan(phi / 2);
    // Shrink the radius if the adjoining straights are too short for its
    // tangents, rather than letting the arcs overlap and fold the track.
    const cap = 0.46 * Math.min(ul, wl);
    if (t > cap) {
      t = cap;
      r = t * Math.tan(phi / 2);
    }
    return { u, w, phi, r, t };
  });

  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    const v = V[i]!;
    const g = geo[i]!;
    const P1 = { x: v.x + g.u.x * g.t, z: v.z + g.u.z * g.t };
    const P2 = { x: v.x + g.w.x * g.t, z: v.z + g.w.z * g.t };
    let bx = g.u.x + g.w.x;
    let bz = g.u.z + g.w.z;
    const bl = Math.hypot(bx, bz) || 1e-6;
    bx /= bl;
    bz /= bl;
    const d = g.r / Math.sin(g.phi / 2);
    const C = { x: v.x + bx * d, z: v.z + bz * d };
    const a1 = Math.atan2(P1.z - C.z, P1.x - C.x);
    let sweep = Math.atan2(P2.z - C.z, P2.x - C.x) - a1;
    while (sweep > Math.PI) sweep -= Math.PI * 2;
    while (sweep < -Math.PI) sweep += Math.PI * 2;

    // Straight from the previous arc's exit into this arc's entry. Elevation
    // ramps along the straight and stays level through the corner itself, so
    // no corner is also a crest.
    const pi = (i - 1 + n) % n;
    const pv = V[pi]!;
    const pg = geo[pi]!;
    const from = { x: pv.x + pg.w.x * pg.t, z: pv.z + pg.w.z * pg.t };
    const segLen = Math.hypot(P1.x - from.x, P1.z - from.z);
    const steps = Math.max(1, Math.round(segLen / 11));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      pts.push([
        from.x + (P1.x - from.x) * t,
        lerp(pv.y, v.y, t * t * (3 - 2 * t)),
        from.z + (P1.z - from.z) * t,
      ]);
    }
    const arcLen = Math.abs(sweep) * g.r;
    const asteps = Math.max(2, Math.round(arcLen / 9));
    for (let k = 0; k < asteps; k++) {
      const a = a1 + sweep * (k / asteps);
      pts.push([C.x + Math.cos(a) * g.r, v.y, C.z + Math.sin(a) * g.r]);
    }
  }
  return pts;
}
