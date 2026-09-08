import * as THREE from 'three';
import { CFG } from './config';
import { AUDIO } from './audio';
import { INPUT } from './input';
import { PATH } from '@/track/path';
import { ITEMS } from '@/content/items';
import { Kart } from '@/game/Kart';
import type { Game } from '@/game/Game';

/**
 * Handles the headless QA harness drives.
 *
 * The renderer runs at about one frame per second under software GL, so the
 * tests never measure gameplay through the frame loop — they call `tickRace`
 * directly at a fixed step and read the simulation out. That needs the live
 * objects, which is what this exposes. It costs a few property writes at boot
 * and no runtime overhead.
 */
export function exposeDebugHandles(game: Game): void {
  Object.assign(window as unknown as Record<string, unknown>, {
    __G: game,
    __PATH: PATH,
    __INPUT: INPUT,
    __AUDIO: AUDIO,
    __Kart: Kart,
    __ITEMS: ITEMS,
    __THREE: THREE,
    __CFG: CFG,
  });
}
