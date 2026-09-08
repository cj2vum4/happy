/**
 * The one settings object every renderer-touching system reads.
 *
 * Decided once at boot from the device, then treated as immutable — a system
 * that sized a buffer from it at construction cannot be re-sized mid-race
 * without a hitch, so runtime degradation happens by disabling features rather
 * than by rewriting this.
 */
export interface Quality {
  mobile: boolean;
  /** MSAA. Off on mobile, where the fill cost outweighs the benefit. */
  aa: boolean;
  /** Ceiling on devicePixelRatio. */
  dpr: number;
  shadows: boolean;
  shadowSize: number;
  /** Terrain mesh resolution per side. */
  terrainSeg: number;
  pDrift: number;
  pSpark: number;
  pSmoke: number;
  pAmb: number;
}
