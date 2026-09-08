# Candy Rush: Volcano GP — v2

A 3D arcade kart racer. This directory is the version-2 rebuild: same game,
rebuilt on a real toolchain so it can grow past what one HTML file can hold.

## Play

- **Built game:** `0907/dist/index.html`
- **v1, for reference:** `0907/legacy/index.html` — the original single-file
  build, byte-identical to `test/index.html`. Kept as the reference the port was
  checked against. Not built, not imported, not deployed.

`dist/` is committed on purpose: this repository is served straight from the
branch with no build step, so the built game has to be in git to be playable.
Rebuild with `npm run build` and commit the result whenever `src/` changes.

## Develop

```
npm install
npm run dev        # vite dev server on :5173, hot reload
npm run build      # typecheck, then build to dist/
npm run preview    # serve dist/ on :4173
npm run typecheck  # tsc --noEmit on its own
```

## Layout

```
src/
  core/     config, math, input, audio, quality tier, scratch vectors, debug handles
  render/   procedural textures, shared geometry and materials, particle pool
  track/    circuit authoring (polygon + corner radii), arc-length path
  game/     World, Kart, AIBrain, ItemSystem, FX, CamRig, Game
  ui/       DOM HUD and screens, stylesheet
  content/  the data: racers, items, tracks
tools/      the one-shot scripts that cut v1 into these modules
```

The dependency direction is `content → game → render/track → core`. Nothing in
`core/` imports from `game/`, which is what lets the track and physics be tested
without a renderer.

### Two ideas worth knowing before changing anything

**Circuits are authored as a polygon with a radius per corner**
(`src/track/circuit.ts`), not as hand-placed spline points. Drifting only means
something if corners land in a specific band: a kart holds about 38 units of
radius flat out and about 25 while drifting, so a corner between those figures
can *only* be taken at speed by drifting. Authoring by radius makes that band
explicit. Widening a corner to "give the drift room" does the opposite — a wide
corner can be straight-lined, and a drift turns tighter than grip does.

**Positive steer means turn left on screen** (`src/core/input.ts`). Forward is
`(sin h, 0, cos h)`, so screen-right for a chase camera is `-X` and increasing
heading swings the nose left. The AI, the front wheels, the driver lean and the
drift yaw are all keyed to that sign; only the physical buttons need mapping.

## Testing

The renderer runs at roughly one frame per second under software GL, so nothing
is verified through the frame loop. The harnesses drive `game.tickRace(1/60)`
directly at a fixed step and read the simulation out, which measures gameplay
independently of frame rate. `src/core/debug.ts` exposes the handles they need.
