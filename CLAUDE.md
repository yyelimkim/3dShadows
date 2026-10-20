# 3D Shadows — project instructions

Host app for img2threejs reconstructions. The skill itself is installed at
`~/.claude/skills/img2threejs` (via `npm run skill:install`); its `forge/` scripts run from that
skill root, and this repo holds inputs and outputs only. Do not vendor or copy the skill here.

## Where things go

- Reference images: `references/<id>.<ext>`
- Pipeline artifacts for a model: `work/<id>/` — `assessment.json`, `object-sculpt-spec.json`,
  `.img2threejs/state.json`, comparison sheets. Renders/crops go in `work/<id>/renders/` (gitignored).
- Generated factory: `src/models/<id>/create<Name>Model.ts`, then add an entry to
  `src/models/registry.ts` (`status: 'in-progress'` until the final pass is reviewed `continue`,
  then `'final'`).

## Viewer contract for generated factories

- Return a `THREE.Group`; pass `{ castShadow: true }`. The viewer sets `receiveShadow` on all
  meshes, rests the model on y=0 and frames it, so factories need not position themselves.
- Animation hook: `userData.tick(elapsedSeconds, deltaSeconds)` on any object in the group.
- The viewer supplies its own lights and environment; do not add the generated LookDev lights
  or presentation composer to the scene.
- Plain `three` only, no runtime fetches.

## Screenshot gate

Run `npm run dev` and capture review renders from `http://localhost:5173/#/model/<id>`.
`window.__shadows` exposes `{ scene, camera, renderer, sun, ready }` for capture/mesh-export
tooling. Save screenshots to `work/<id>/renders/` and read them back before claiming a pass.
`npm run build` must pass (it typechecks) before a model is committed.
