# 3D Shadows

Reference images rebuilt as procedural Three.js models with
[img2threejs](https://github.com/img2threejs/img2threejs), then staged under a movable,
shadow-casting light.

img2threejs is an **agent skill**, not an npm library: Claude Code reads a reference image,
writes a sculpt spec, and generates a TypeScript `THREE.Group` factory pass by pass, checked by
the skill's Python quality gates. This repo is the host app those factories land in.

## Setup

Requires Node 18+, Git and Python 3.10+.

```bash
npm install
npm run skill:install   # installs the img2threejs skill into ~/.claude (pinned release)
npm run skill:doctor    # confirms the skill link
npm run dev             # http://localhost:5173
```

Restart Claude Code after installing the skill so `/img2threejs` is available.

## Viewer

- Model picker, or deep link with `#/model/<id>`
- Light azimuth / elevation, shadow softness, and an "orbit the light" toggle
- Models are rested on the ground plane and auto-framed
- Any `userData.tick(elapsed, delta)` in a model runs each frame

## Making a model

1. Drop the image in `references/` (e.g. `references/teapot.png`).
2. In Claude Code, from this repo:
   ```text
   /img2threejs Rebuild the object in ./references/teapot.png as a procedural Three.js model
   for 3D Shadows. Keep its proportions, silhouette and colours. Follow the quality gates.
   ```
3. The factory lands in `src/models/<id>/`, is registered in `src/models/registry.ts`, and its
   spec, assessment and reviews are kept in `work/<id>/`.

## Layout

```
references/          input images
src/main.ts          viewer: renderer, shadow light, controls, tick loop
src/models/          one folder per model + registry.ts
work/<id>/           img2threejs spec, assessment, state and review history
```
