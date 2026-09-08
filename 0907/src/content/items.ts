import { clamp } from '@/core/math';

export type ItemId = 'seeker' | 'bolt' | 'trap' | 'shield' | 'boost';
export interface ItemDef {
  id: ItemId;
  glyph: string;
  name: string;
}

export const ITEMS: ItemDef[]=[
  {id:'seeker', glyph:'🍬', name:'GUMMY SEEKER'},
  {id:'bolt',   glyph:'🍭', name:'SUGAR BOLT'},
  {id:'trap',   glyph:'🟤', name:'JAWBREAKER'},
  {id:'shield', glyph:'🛡️', name:'SHELL SHIELD'},
  {id:'boost',  glyph:'⚡', name:'FIZZ BOOST'},
];
// Comeback weighting — behind racers get more offence, leaders get defence.
export const ITEM_W=[
  [.10,.14,.34,.30,.12],   // P1
  [.22,.24,.18,.19,.17],   // P2
  [.31,.20,.09,.15,.25],   // P3
  [.34,.15,.05,.11,.35],   // P4
];
/** Draw an item index for a racer running in `place` (1-based). */
export function rollItem(place: number): number {
  const w=ITEM_W[clamp(place-1,0,3)]!;
  const r=Math.random(); let a=0;
  for(let i=0;i<w.length;i++){ a+=w[i]!; if(r<=a) return i; }
  return w.length-1;
}
