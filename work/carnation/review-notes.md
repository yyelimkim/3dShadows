# Carnation — review notes

Factory: `src/flowers/createCarnationModel.ts` (data `CARNATION_SPEC`, built by `src/flowers/flowerKit.ts`).
Pipeline spec: `object-sculpt-spec.json` (strict-quality PASS). Implemented parameters, exported from
the TypeScript: `flower-spec.implemented.json`.

## Gate status: BLOCKED at blockout, Tier 1 silhouette IoU

| Gate | Result |
|---|---|
| validate --strict-quality | PASS |
| reference PBR evidence | PASS (petal 0.84, stem 0.86, leaf 0.84 confidence) |
| Tier 1 silhouette IoU (≥ 0.85) | **FAIL 0.695** as recorded; 0.715 after the review framing was aligned to the photo's stem-base pixel (`renders/final-front-aligned.png`) |
| Tier 1 aspect (≤ 0.05) / scale (≤ 0.08) | PASS 0.001 / 0.029 |
| multi-angle degenerate-view | PASS (side area 0.88 of front) |
| turntable 0/90/180/270 + holes | PASS |
| AI-vision review | 0.76 (head 0.78, stem 0.80, leaves 0.80) |

Why IoU stalls: Tier 1 compares on a 224×224 grid, where the stem is ~2 cells wide, so a sub-pixel
lateral offset loses half the stem; the reference's own clean black silhouette only scores 0.87 on
the same grid. `orchestrate_passes.py check` refuses every later pass until Tier 1 passes, so the
structural → optimization passes were never unlocked. The factory is complete regardless (all
components, pivots, options, sway); it was reviewed visually from front, side, 3/4, top, rear and as
a wall shadow.

Correction cycles used: 1 recorded `refine-code` (r1 → r2), r2 recorded as `request-input`.

## Inferred regions (not visible in the reference)
- Back half of the corolla: radial whorls continued around (5 outer / 6 middle / 7 inner), seeded jitter.
- Petal backs and depth: curvature continued as cupped shells with an outward lip.
- Leaf pair orientation in depth: opposite, ±15° off the image plane, rolled 70° so the blades face the camera as photographed.
- Stem S-curve depth component: 0.004 sinusoid (photo shows only lateral wobble).
- Inner whorl petal count (crumpled; modelled as 7).

## Known issues
- Front IoU 0.695 (gate above).
- Leaves render lighter than the glaucous reference under a frontal key light.
- Petal pink is slightly less saturated than the photo; translucency is a faint emissive, not transmission.
- Identity: the photo reads as lisianthus (*Eustoma*) rather than a carnation; id kept as given.

## Follow-up: smoother, thinner petals (user request, after the recorded reviews)
Ruffle amplitude cut ~70% (0.012 → 0.004 outer) with 4 waves instead of 9–10, inner crumple
1.0 → 0.35, rim band 0.05 → 0.025 and lighter, petal widths −10%. Tier 1 after the change:
IoU 0.702, aspect 0.042, scale 0.013 (`renders/smooth-front.png`, `renders/smooth-cmp.png`).
