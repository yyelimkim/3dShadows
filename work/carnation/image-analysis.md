# Carnation — image analysis (references/carnation.png, 1024×1536)

Measurements are normalized to subject height (1399 px → 1.0), origin at stem base, +Y up.
Image x is the lateral axis of a single front view; depth (Z) is not observable.

## L1 Identification
- Work type: single cut flower stem with one fully open, double, ruffled bloom and one
  opposite pair of lanceolate leaves. Labelled "carnation" by the user; the ruffled
  multi-whorl cup, smooth (non-serrate) petal margins and glaucous lance leaves are more
  consistent with *Eustoma* (lisianthus). Inference; identity kept as the user's id.
- Broad class: botanical, organic thin-shelled object. primaryDomain = object. Confidence 0.9.

## L2 Form & silhouette
- Very tall, thin vertical: head 0.21 wide vs 1.0 tall. Radial symmetry in the head
  (approx.), stem a near-straight tapered cylinder with a gentle S wobble (lateral
  offset ±0.008 around x̄; leans +x around h 0.6–0.75, −x around h 0.2–0.25).
- Organic shape language; no hard edges.

## L3 Decomposition
- Macro: stem (h 0 → 0.79), calyx/receptacle (h 0.78–0.83), corolla head (h 0.80–1.0),
  leaf pair.
- Meso: corolla = cup of ~3 nested whorls — outer whorl of ~5 broad obovate petals that
  flare outward ~35–50° from vertical, middle whorl ~5–6 petals more upright, inner whorl
  of ~6–8 small crumpled petals filling the top. Calyx = short green cup + 5 narrow
  awl-shaped sepal tips curling outward/down (visible 2 left, 1 right, h≈0.82).
  Leaves: left leaf base h≈0.38, tip at (−0.09, 0.56); right leaf base h≈0.30, tip at
  (+0.10, 0.49). Each ≈0.21 long, max width ≈0.05 at ~35% length, acuminate tip,
  clasping (sessile) base, gentle upward-outward arc, slight keel fold along the midrib.
- Micro: ruffled/undulate petal margins with fine picotee (deeper pink fringe), node
  swellings at leaf bases. Veins/pollen: skipped (do not change outline).

## L4 Spatial relationships
- <stem, attached-to, calyx> butt; <calyx, socket, corolla> embed.
- <leaf-L, clasps, stem@0.38>, <leaf-R, clasps, stem@0.30> overlap-wrap.
- <outer whorl, below/around, middle whorl>, <inner whorl, inside, middle whorl>.

## L5 Materials (PBR)
- Petal: dielectric, roughness ~0.6, semi-translucent thin shell (light bleeds through
  the flared outer petals — they read lighter at edges).
- Stem: dielectric, roughness ~0.55, opaque, mid-green.
- Leaf: dielectric, roughness ~0.7, glaucous (matte, slightly bluish-gray green).

## L6 Color (pixel-sampled medians)
- Petal centre→edge: #e7b8b9 → #e7c3c4 → #e9cccd → #edd1d1 → #f2d8d7; picotee edge
  ~#d99aa8 (deeper pink, thin band). Base of outer petals slightly greener/cream.
- Stem: #7a9269 (upper) / #6e8238 (base, darker cut end).
- Leaf: #819872 → #8ea47a (gray-green, lighter midrib).

## L7 Identity features
1. Tall single thin stem with long uninterrupted upper internode (h 0.38 → 0.79).
2. Opposite-ish lance leaf pair low on the stem, angled up-out on both sides.
3. Cup-shaped double bloom, wider than tall (0.21 × 0.19), slightly asymmetric — flares
   wider to −x at the top-left.
4. Ruffled outer petal margins (outline-changing, so modelled as low-freq edge undulation).
5. Small curled sepals under the head.

## L8 Uncertainty
- Hidden: back half of the corolla (inferred by continuing the radial whorl), back faces
  of leaves, true depth of the S-curve (only lateral component seen), the azimuth of the
  leaf pair relative to the camera (assumed ~in image plane, opposite).
- Uncertain: exact inner petal count (crumpled, overlapping) — modelled as 7.
