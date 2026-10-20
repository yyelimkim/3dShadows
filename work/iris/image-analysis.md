# Iris — image analysis (references/iris.png, 1024×1536)

Normalized to subject height (1449 px → 1.0), origin at the stem base (image x≈465 px), +Y up.

## L1 Identification
- Single cut iris stem, beardless (Louisiana-type) open bloom: 3 falls, 3 standards, 3 style
  arms, one closed bud in a spathe, one sword leaf and one narrow sheathing spathe leaf.
- Botanical, organic thin-shelled object. primaryDomain = object. Confidence 0.9.

## L2 Form & silhouette
- Tall vertical, head 0.34 wide on a 0.83-high stem; head bbox h 0.84–1.0.
- Head trimerous (3-fold radial). Falls spread almost horizontal (left/right falls nearly in
  profile → azimuths ±120°), the front fall droops toward the camera. Standards stand upright.

## L3 Decomposition
- Macro: stem (h 0 → 0.83), head, sword leaf, spathe leaf.
- Meso: falls ×3 (length ≈0.16, width ≈0.07, arch then droop; right fall's tip curls up),
  standards ×3 (length ≈0.14, width ≈0.055, spoon-shaped, slightly incurved), style arms ×3
  (≈0.05 long, yellow-orange, over each fall), bud (green spindle h 0.725–0.81, beside the stem),
  ovary/perianth tube (green swelling under the head).
- Leaves: sword leaf sheathes the stem at h 0.25 and runs up-right to a tip at (+0.14, 0.68),
  length ≈0.45, width ≈0.04, near-straight; spathe leaf sheathes at h 0.60 and runs straight up
  alongside the stem to (−0.007, 0.89), length ≈0.29, width ≈0.024.
- Micro: yellow signal patch at each fall base; reflexed curl at the right fall tip; dense red
  venation (skipped — does not change the outline).

## L4 Spatial
- <sword leaf, sheathes, stem@0.25>, <spathe leaf, sheathes, stem@0.60>, <bud, beside, stem@0.70>
- <falls, alternate-with, standards> at 60°; <style arm, over, fall>.

## L5/L6 Materials & colour (pixel medians)
- Falls: claw yellow-green → signal #e8c64a → coral red #d65a5a/#dc635e → edge #e3787a.
- Standards: #e9b07a base → salmon #ef9a96 → #f09797 tip, lighter margins.
- Stem #798746 / #6e8754; leaves #6c854f → #718759 (matte, parallel-veined).

## L7 Identity features
1. Three broad coral falls spread flat/drooping — the dominant wide silhouette.
2. Three upright salmon standards forming the crown.
3. Long sword leaf crossing up-right; narrow spathe leaf hugging the upper stem.
4. Green bud tucked beside the stem below the head.
5. Yellow signal patches at the fall bases.

## L8 Uncertainty
- Hidden: back standard (only its top seen), back of all falls, exact azimuths (inferred from
  3-fold symmetry and the foreshortened profile lengths), sword-leaf twist in depth.
