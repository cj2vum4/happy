import type { Palette } from '@/game/kart-model';

/**
 * What separates one AI from another. Each rival is a distinct set of these,
 * not a difficulty slider, so their mistakes stay recognisably theirs across a
 * race: Mia is clean and defensive, Kai is quick but crashes into people, Leo
 * drifts everything.
 */
export interface AIProfile {
  /** Multiplier on target corner speed. Above 1 means "carries more than grip". */
  skill: number;
  /** Willingness to spend an item on whoever is in front. */
  aggro: number;
  /** How readily this driver enters a drift on a marginal corner. */
  drift: number;
  /** Preferred lateral offset from the racing line, in track units. */
  lane: number;
  /** Amplitude of the wandering steering error. */
  err: number;
  /** Seconds to sit on an item before using it. */
  itemHold: number;
}

export interface RacerDef {
  name: string;
  player: boolean;
  /** Marker colour on the HUD and results screen. */
  hex: string;
  pal: Palette;
  ai: AIProfile | null;
}

export const RACERS: RacerDef[]=[
  { name:'PIPPA', player:true,  hex:'#ff4f9a',
    pal:{body:'#ff4f9a',trim:'#fff4e6',rim:'#ffd54a',seat:'#7d1440',glow:'#ffe36b',
         suit:'#ff77b4',suit2:'#ffffff',skin:'#f7c9a8',hair:'#5a2438',lens:'#57e6c8'},
    ai:null },
  { name:'MIA',   player:false, hex:'#57e6c8',
    pal:{body:'#57e6c8',trim:'#0d6a5c',rim:'#fff4e6',seat:'#0b4a41',glow:'#c8fff2',
         suit:'#17a98c',suit2:'#0d6a5c',skin:'#8b5a3c',hair:'#241318',lens:'#ffd54a'},
    ai:{ skill:1.03, aggro:.5,  drift:.62, lane:-4.5, err:.05, itemHold:.9 } },
  { name:'KAI',   player:false, hex:'#ffb02e',
    pal:{body:'#ffb02e',trim:'#7a3a00',rim:'#3a1d22',seat:'#5c2a00',glow:'#fff08a',
         suit:'#e07a00',suit2:'#7a3a00',skin:'#e8b08a',hair:'#1a0f14',lens:'#ff4f9a'},
    ai:{ skill:1.055, aggro:.95, drift:.55, lane:4.5,  err:.10, itemHold:.28 } },
  { name:'LEO',   player:false, hex:'#a86bff',
    pal:{body:'#a86bff',trim:'#f0e6ff',rim:'#57e6c8',seat:'#3d1a70',glow:'#e2c9ff',
         suit:'#8b46e0',suit2:'#f0e6ff',skin:'#c98f6a',hair:'#f2e9ff',lens:'#ffb02e'},
    ai:{ skill:1.04, aggro:.68, drift:1.0, lane:0,    err:.12, itemHold:.55 } },
];

