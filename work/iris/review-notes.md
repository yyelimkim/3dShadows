# Iris — review notes

Factory: `src/flowers/createIrisModel.ts` (data `IRIS_SPEC`, built by `src/flowers/flowerKit.ts`).
Pipeline spec: `object-sculpt-spec.json` (strict-quality PASS). Implemented parameters, exported from
the TypeScript: `flower-spec.implemented.json`.

## Gate status: BLOCKED at blockout, Tier 1 silhouette IoU

| Gate | Result |
|---|---|
| validate --strict-quality | PASS |
| reference PBR evidence | PASS (petal 0.79, stem 0.86, leaf 0.82 confidence) |
| Tier 1 silhouette IoU (≥ 0.85) | **FAIL 0.710** (best probe 0.717) |
| Tier 1 aspect (≤ 0.05) / scale (≤ 0.08) | PASS 0.014 / 0.023 |
| multi-angle degenerate-view | PASS (side area 0.47 of front) |
| turntable 0/90/180/270 + holes | PASS |
| AI-vision review | 0.74 (falls 0.78, standards 0.72, leaves 0.78, stem 0.80) |

Same cause as carnation: thin stem/leaf edges and petal outlines lose cells on Tier 1's 224×224 grid,
and `orchestrate_passes.py check` locks every later pass until Tier 1 passes. Correction cycles
used: 1 recorded `refine-code` (fixed the spathe leaf detaching from the leaning stem), r2 recorded
as `request-input`.

## Inferred regions (not visible in the reference)
- Back standard (only its tip shows) and the back faces of all falls/standards.
- Exact azimuths: front fall at 28°, side falls at ±105°, standards at 180° and ±52°, from the
  trimerous plan and the foreshortened outline lengths.
- Fall roll (±28° by azimuth) so the side falls show their upper faces as photographed.
- Sword- and spathe-leaf roll in depth; bud position slightly in front-right of the stem.
- Head nod (8° toward the camera).

## Known issues
- Front IoU 0.710 (gate above).
- Right fall's upturned tip curl is not modelled (both side falls share one shape).
- Venation and the fall's lighter edge streaks are skipped (no outline change); standards read a
  little darker and narrower than the reference's pale salmon.
- Leaf sheath bases are narrowed blades rather than true tubular sheaths.
