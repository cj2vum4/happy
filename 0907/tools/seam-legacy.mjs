/**
 * Second half of the one-shot port (see slice-legacy.mjs): rewrites the module
 * seams. Adds `export` to the declarations other modules need and prepends the
 * import block each file requires. Type annotations are hand-written afterwards
 * and this script is not re-run.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

/** name -> import header, plus the top-level names to export. */
const seams = {
  'src/core/config.ts': {
    head: '',
    exports: ['CFG', 'ORD'],
  },
  'src/render/textures.ts': {
    head: `import * as THREE from 'three';
import { rand, randi } from '@/core/math';
`,
    exports: ['TEX', 'buildTextures'],
  },
  'src/render/geom.ts': {
    head: `import * as THREE from 'three';
import { lerp } from '@/core/math';
`,
    exports: ['roundedBox', 'blobGeo', 'coneProfile', 'makeInstanced', 'GEO', 'buildSharedGeo', 'mat'],
  },
  'src/core/audio.ts': {
    head: '',
    exports: ['AudioMan', 'AUDIO', 'HAPTIC'],
  },
  'src/core/input.ts': {
    head: '',
    exports: ['InputMan', 'INPUT'],
  },
  'src/render/ParticlePool.ts': {
    head: `import * as THREE from 'three';\n`,
    exports: ['ParticlePool'],
  },
  'src/content/racers.ts': { head: '', exports: ['RACERS'] },
  'src/content/items.ts': {
    head: `import { clamp } from '@/core/math';\n`,
    exports: ['ITEMS', 'ITEM_W', 'rollItem'],
  },
  'src/game/kart-model.ts': {
    head: `import * as THREE from 'three';
import { rand } from '@/core/math';
import { GEO, mat, roundedBox } from '@/render/geom';
import { TEX } from '@/render/textures';
`,
    exports: ['buildKart'],
  },
  'src/game/World.ts': {
    head: `import * as THREE from 'three';
import { clamp, lerp, rand, randi, smoothstep, seededRandom } from '@/core/math';
import { _v1, _v2, _v3 } from '@/core/scratch';
import { GEO, blobGeo, coneProfile, makeInstanced, mat, roundedBox } from '@/render/geom';
import { TEX } from '@/render/textures';
import { PATH, CENTREPIECE } from '@/track/path';
`,
    exports: ['World'],
  },
  'src/game/Kart.ts': {
    head: `import * as THREE from 'three';
import { CFG } from '@/core/config';
import { AUDIO, HAPTIC } from '@/core/audio';
import { INPUT } from '@/core/input';
import { clamp, damp, lerp, angleDiff, rand, randi, smoothstep } from '@/core/math';
import { _v1, _v2 } from '@/core/scratch';
import { PATH } from '@/track/path';
import { TrackPath } from '@/track/TrackPath';
import { ITEMS } from '@/content/items';
import { buildKart } from './kart-model';
import { AIBrain } from './AIBrain';
`,
    exports: ['Kart'],
  },
  'src/game/AIBrain.ts': {
    head: `import * as THREE from 'three';
import { CFG } from '@/core/config';
import { clamp, lerp, damp, angleDiff, rand } from '@/core/math';
import { _v4 } from '@/core/scratch';
import { PATH } from '@/track/path';
import { ITEMS } from '@/content/items';
`,
    exports: ['AIBrain'],
  },
  'src/game/ItemSystem.ts': {
    head: `import * as THREE from 'three';
import { AUDIO, HAPTIC } from '@/core/audio';
import { clamp, lerp, rand, smoothstep, angleDiff } from '@/core/math';
import { _v1 } from '@/core/scratch';
import { GEO, makeInstanced, mat } from '@/render/geom';
import { TEX } from '@/render/textures';
import { PATH } from '@/track/path';
import { rollItem } from '@/content/items';
`,
    exports: ['ItemSystem'],
  },
  'src/game/FX.ts': {
    head: `import * as THREE from 'three';
import { rand } from '@/core/math';
import { _v1, _c1 } from '@/core/scratch';
import { ParticlePool } from '@/render/ParticlePool';
import { TEX } from '@/render/textures';
`,
    exports: ['FX'],
  },
  'src/game/CamRig.ts': {
    head: `import * as THREE from 'three';
import { CFG } from '@/core/config';
import { clamp, damp, lerp, smoothstep } from '@/core/math';
import { _v1 } from '@/core/scratch';
import { PATH } from '@/track/path';
`,
    exports: ['CamRig'],
  },
  'src/ui/UI.ts': {
    head: `import { CFG, ORD } from '@/core/config';
import { clamp, fmtTime } from '@/core/math';
import { AUDIO, HAPTIC } from '@/core/audio';
import { ITEMS } from '@/content/items';
`,
    exports: ['$', 'UI'],
  },
  'src/game/Game.ts': {
    head: `import * as THREE from 'three';
import { CFG, ORD } from '@/core/config';
import { AUDIO, HAPTIC } from '@/core/audio';
import { INPUT } from '@/core/input';
import { clamp, damp, lerp, rand, smoothstep } from '@/core/math';
import { buildSharedGeo } from '@/render/geom';
import { buildTextures, TEX } from '@/render/textures';
import { PATH } from '@/track/path';
import { RACERS } from '@/content/racers';
import { World } from './World';
import { Kart } from './Kart';
import { ItemSystem } from './ItemSystem';
import { FX } from './FX';
import { CamRig } from './CamRig';
import { UI, $ } from '@/ui/UI';
`,
    exports: ['Game'],
  },
};

for (const [rel, { head, exports }] of Object.entries(seams)) {
  const p = resolve(root, rel);
  let text = readFileSync(p, 'utf8');
  // Strip the placeholder import the slicer wrote, then add the real one.
  text = text.replace(/^import \* as THREE from 'three';\n+/, '');
  for (const name of exports) {
    const word = name === '$' ? '\\$' : `${name}\\b`;
    const re = new RegExp(`^(const|let|class|function) ${word}`, 'm');
    if (!re.test(text)) {
      console.warn(`  ! ${rel}: no top-level declaration of ${name}`);
      continue;
    }
    text = text.replace(re, (m) => `export ${m}`);
  }
  writeFileSync(p, (head ? head + '\n' : '') + text);
  console.log('seamed', rel);
}
