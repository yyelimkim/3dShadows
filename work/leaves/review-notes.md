# Leaves (eucalyptus sprig) — review notes

Factory: `src/flowers/createLeavesModel.ts` (data `LEAVES_SPEC`; uses the kit's new side-branch
system). Pipeline spec: `object-sculpt-spec.json` (strict-quality PASS).

## Gate status: BLOCKED at blockout, Tier 1

| Gate | Result |
|---|---|
| validate --strict-quality | PASS |
| reference PBR evidence | PASS (leaf 0.77, stem 0.86) |
| Tier 1 IoU / aspect / scale | **FAIL** 0.438 / 0.108 / 0.224 — unreliable here: on the 224 grid the thin twigs break the mask apart, and Tier 1 discards 26% of the reference's own foreground (19% of the render) before measuring |
| own bbox check | width 0.494 vs reference 0.481 |
| multi-angle degenerate-view | PASS (side area 0.32 of front) |
| turntable | PASS with `--allow-holes` — the reference photo itself fails the hole check (2.6% enclosed background between leaves) |
| AI-vision review | 0.72 |

Correction cycles: 1 `refine-code` (narrowed the left side, raised branch D, leaned the tip right),
r2 recorded as `request-input`.

## Inferred regions
- Rotation of each pair in depth: alternate pairs swung to −60°/120° (decussate) so side and top
  views have volume; the photo shows every pair pressed face-on.
- Branch depth (±0.05–0.06 at the tips) and the faces of leaves turned away from the camera.
- Leaf roll toward the camera (80° × sin of the leaf's azimuth).

## Known issues
- More regular than the photo (pairs evenly spaced, similar angles); seeded jitter only partly breaks it.
- `openness` changes leaf angles but barely changes the overall width (the branches set it).
- Leaf colour has no glaucous bloom/speckle; petioles are the blade's narrowed base, not stalks.
