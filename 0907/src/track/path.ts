import { buildCircuit } from './circuit';
import { TrackPath } from './TrackPath';
import { VOLCANO_GP } from '@/content/tracks';

/**
 * The circuit every system shares.
 *
 * A module-level singleton rather than something threaded through constructors,
 * because in v1 it was a file-level `const` and every consumer already assumes
 * one circuit exists for the life of the page. Phase 4 (multiple circuits) is
 * the point at which this becomes a parameter.
 */
export const PATH = new TrackPath(buildCircuit(VOLCANO_GP.poly));

export const CENTREPIECE = VOLCANO_GP.centrepiece;
