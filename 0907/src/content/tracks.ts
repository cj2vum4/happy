import type { CircuitDef } from '@/track/circuit';

/**
 * Candy Volcano — the circuit carried over from v1, with its measured
 * characteristics: 11 corners, ~35% of the lap spent turning, tightest radius
 * 29 (inside the drift-only band), longest corner 2.0s at racing speed which
 * is what makes a full tier-3 charge reachable.
 */
export const VOLCANO_GP: CircuitDef = {
  id: 'volcano',
  name: 'Candy Volcano GP',
  poly: [
    [0, 380, 130, 0], //  T1  fast right off the start straight
    [320, 300, 62, 10], //  T2  Chocolate Canyon entry
    [232, 158, 42, 22], //  T3  canyon esses - left
    [372, 52, 42, 32], //  T4  canyon esses - right
    [300, -120, 31, 46], //  T5  Strawberry Lava hairpin  <- drift or lift
    [128, -50, 52, 56], //  T6  flick back onto the ridge
    [46, -252, 105, 64], //  T7  Lollipop Ridge sweeper (entry)
    [-170, -286, 105, 62], //  T8  Lollipop Ridge sweeper (exit)
    [-306, -150, 86, 50], //  T9  Marshmallow Smoke Tunnel
    [-238, 14, 32, 30], //  T10 Sugar Crystal hairpin    <- drift or lift
    [-386, 118, 58, 16], //  T11 crystal exit
    [-196, 262, 100, 4], //  T12 onto the Sugar Straight
  ],
  // Sized to stand clear of the road: the closest the circuit comes to this
  // axis is ~229, so a 150 base leaves ~65 units of daylight. At 192 the flank
  // read as a chocolate wall standing at the trackside.
  centrepiece: { x: -28, z: 96, base: 150, height: 176, top: 26 },
};

export const TRACKS: CircuitDef[] = [VOLCANO_GP];
