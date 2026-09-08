/**
 * One-shot port helper: cuts the v1 single-file game into the module layout.
 *
 * The v1 build is 3400 lines of working, tuned, play-tested code. Retyping it
 * by hand would introduce transcription bugs the test harnesses would then have
 * to find, so the bodies are moved verbatim and only the seams — imports,
 * exports, type annotations — are authored by hand afterwards.
 *
 * Kept in the repo as the record of how src/ was derived from legacy/.
 * Running it again would overwrite hand-written types; it is not part of the
 * build.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const src = readFileSync(resolve(root, 'legacy/index.html'), 'utf8').split('\n');

/** `[fromLine, toLine]` inclusive, 1-indexed as the editor shows them. */
const cut = (a, b) => src.slice(a - 1, b).join('\n');

const files = {
  'src/core/config.ts': [`import * as THREE from 'three';\n`, cut(405, 425)],
  'src/render/textures.ts': [`import * as THREE from 'three';\n`, cut(440, 587)],
  'src/render/geom.ts': [`import * as THREE from 'three';\n`, cut(589, 658), '', cut(1203, 1245)],
  'src/core/audio.ts': ['', cut(659, 842)],
  'src/core/input.ts': ['', cut(844, 909)],
  'src/render/ParticlePool.ts': [`import * as THREE from 'three';\n`, cut(1127, 1200)],
  'src/content/racers.ts': ['', cut(1477, 1495)],
  'src/content/items.ts': ['', cut(1497, 1516)],
  'src/game/kart-model.ts': [`import * as THREE from 'three';\n`, cut(1247, 1475)],
  'src/game/World.ts': [`import * as THREE from 'three';\n`, cut(1518, 2047)],
  'src/game/Kart.ts': [`import * as THREE from 'three';\n`, cut(2049, 2452)],
  'src/game/AIBrain.ts': [`import * as THREE from 'three';\n`, cut(2455, 2572)],
  'src/game/ItemSystem.ts': [`import * as THREE from 'three';\n`, cut(2575, 2758)],
  'src/game/FX.ts': [`import * as THREE from 'three';\n`, cut(2761, 2794)],
  'src/game/CamRig.ts': [`import * as THREE from 'three';\n`, cut(2797, 2891)],
  'src/ui/UI.ts': ['', cut(2893, 3015)],
  'src/game/Game.ts': [`import * as THREE from 'three';\n`, cut(3018, 3401)],
};

for (const [rel, parts] of Object.entries(files)) {
  const out = resolve(root, rel);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, parts.join('\n').replace(/\n{3,}/g, '\n\n').trimStart() + '\n');
  console.log('wrote', rel);
}
