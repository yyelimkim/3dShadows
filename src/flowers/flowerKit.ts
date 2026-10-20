import * as THREE from 'three';

/**
 * Shared procedural botanical kit for the flower library.
 *
 * Coordinate frame: origin at the stem base, +Y up, the reference photo's camera on +Z.
 * Every spec is authored in "reference units" (subject height ≈ 1.0); the factory then
 * normalises so the default flower is exactly `DEFAULT_HEIGHT` tall.
 */

export const DEFAULT_HEIGHT = 1.0;

export type Vec3 = readonly [number, number, number];

export type FlowerOptions = {
  /** Seeds every jitter; the same seed always rebuilds the same flower. */
  seed?: number;
  /** 0 = nearly closed bud, 1 = fully blown. The reference pose sits at 0.8. */
  openness?: number;
  /** Lean of the whole stem from vertical, radians, pivoting at the base. */
  stemLean?: number;
  /** Stem length multiplier (head size unchanged). */
  stemHeight?: number;
  /** Multiplier on the stem's S-curve and leaf arc. 0 = straight stem. */
  bend?: number;
  /** Uniform scale applied after height normalisation. */
  scale?: number;
};

export type ResolvedFlowerOptions = Required<FlowerOptions>;

export const REFERENCE_OPENNESS = 0.8;

export function resolveOptions(options: FlowerOptions = {}): ResolvedFlowerOptions {
  return {
    seed: options.seed ?? 1,
    openness: THREE.MathUtils.clamp(options.openness ?? REFERENCE_OPENNESS, 0, 1),
    stemLean: options.stemLean ?? 0,
    stemHeight: Math.max(0.2, options.stemHeight ?? 1),
    bend: Math.max(0, options.bend ?? 1),
    scale: options.scale ?? 1,
  };
}

/** mulberry32: tiny deterministic PRNG. */
export function createRng(seed: number) {
  let a = (Math.floor(seed) ^ 0x9e3779b9) >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** Uniform in [-1, 1]. */
    signed: () => next() * 2 - 1,
  };
}
export type Rng = ReturnType<typeof createRng>;

// ---------------------------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------------------------

export type GradientStops = readonly string[];

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

/** Sample evenly spaced sRGB hex stops at t∈[0,1]; result is in linear working space. */
export function sampleGradient(stops: GradientStops, t: number, out: THREE.Color): THREE.Color {
  const x = THREE.MathUtils.clamp(t, 0, 1) * (stops.length - 1);
  const i = Math.min(Math.floor(x), stops.length - 2);
  tmpA.set(stops[i]);
  tmpB.set(stops[i + 1]);
  return out.copy(tmpA).lerp(tmpB, x - i);
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------------------------
// Tapered tube along a Catmull-Rom spine, parallel-transport frames (no Frenet flips)
// ---------------------------------------------------------------------------------------------

export type TubeSpec = {
  readonly points: readonly Vec3[];
  /** One radius per point, linearly interpolated along the curve parameter. */
  readonly radii: readonly number[];
  readonly colors: GradientStops;
  readonly radialSegments?: number;
};

function radiusAt(radii: readonly number[], t: number) {
  const x = THREE.MathUtils.clamp(t, 0, 1) * (radii.length - 1);
  const i = Math.min(Math.floor(x), radii.length - 2);
  return THREE.MathUtils.lerp(radii[i], radii[i + 1], x - i);
}

export function makeCurve(points: readonly Vec3[]) {
  return new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
}

/**
 * Build a tube over curve parameters [t0, t1], translated by -origin so it can live inside a
 * pivot group. `extraRadius(t)` adds node swellings. Bottom end capped when `capStart`.
 */
export function buildTaperedTube(
  curve: THREE.Curve<THREE.Vector3>,
  radii: readonly number[],
  colors: GradientStops,
  t0: number,
  t1: number,
  origin: THREE.Vector3,
  opts: { radialSegments?: number; lengthSegments?: number; capStart?: boolean; capEnd?: boolean; extraRadius?: (t: number) => number } = {},
): THREE.BufferGeometry {
  const radial = opts.radialSegments ?? 12;
  const rings = Math.max(2, opts.lengthSegments ?? 32);
  const positions: number[] = [];
  const normals: number[] = [];
  const cols: number[] = [];
  const indices: number[] = [];
  const color = new THREE.Color();

  // Parallel transport frames, seeded from a fixed reference so adjacent sub-tubes agree.
  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const seedT = curve.getTangent(0).normalize();
  const ref = Math.abs(seedT.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  normal.crossVectors(seedT, ref).normalize();
  let prevT = seedT.clone();
  // Transport from 0 up to t0 so frames match whichever sub-range we build.
  const transportSteps = 64;
  const transportTo = (t: number) => {
    const steps = Math.max(1, Math.ceil(transportSteps * t));
    for (let s = 1; s <= steps; s++) {
      const tt = (t * s) / steps;
      const nt = curve.getTangent(Math.min(tt, 1)).normalize();
      const axis = new THREE.Vector3().crossVectors(prevT, nt);
      const len = axis.length();
      if (len > 1e-8) {
        const ang = Math.asin(THREE.MathUtils.clamp(len, -1, 1));
        normal.applyAxisAngle(axis.normalize(), ang);
      }
      prevT = nt;
    }
  };
  if (t0 > 0) transportTo(t0);

  for (let r = 0; r <= rings; r++) {
    const t = THREE.MathUtils.lerp(t0, t1, r / rings);
    const p = curve.getPoint(t);
    tangent.copy(curve.getTangent(t)).normalize();
    const axis = new THREE.Vector3().crossVectors(prevT, tangent);
    const len = axis.length();
    if (len > 1e-8) normal.applyAxisAngle(axis.normalize(), Math.asin(THREE.MathUtils.clamp(len, -1, 1)));
    prevT = tangent.clone();
    normal.sub(tangent.clone().multiplyScalar(normal.dot(tangent))).normalize();
    binormal.crossVectors(tangent, normal).normalize();
    const radius = radiusAt(radii, t) + (opts.extraRadius ? opts.extraRadius(t) : 0);
    sampleGradient(colors, t, color);
    for (let s = 0; s <= radial; s++) {
      const a = (s / radial) * Math.PI * 2;
      const nx = Math.cos(a) * normal.x + Math.sin(a) * binormal.x;
      const ny = Math.cos(a) * normal.y + Math.sin(a) * binormal.y;
      const nz = Math.cos(a) * normal.z + Math.sin(a) * binormal.z;
      positions.push(p.x + nx * radius - origin.x, p.y + ny * radius - origin.y, p.z + nz * radius - origin.z);
      normals.push(nx, ny, nz);
      cols.push(color.r, color.g, color.b);
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < radial; s++) {
      const a = r * (radial + 1) + s;
      const b = a + radial + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const cap = (t: number, flip: boolean) => {
    const p = curve.getPoint(t);
    const tan = curve.getTangent(t).normalize();
    const centre = positions.length / 3;
    positions.push(p.x - origin.x, p.y - origin.y, p.z - origin.z);
    normals.push(flip ? -tan.x : tan.x, flip ? -tan.y : tan.y, flip ? -tan.z : tan.z);
    sampleGradient(colors, t, color);
    cols.push(color.r * 0.85, color.g * 0.85, color.b * 0.85);
    const ring = flip ? 0 : rings;
    for (let s = 0; s < radial; s++) {
      const a = ring * (radial + 1) + s;
      if (flip) indices.push(centre, a + 1, a);
      else indices.push(centre, a, a + 1);
    }
  };
  if (opts.capStart) cap(t0, true);
  if (opts.capEnd) cap(t1, false);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.setIndex(indices);
  return g;
}

// ---------------------------------------------------------------------------------------------
// Petal / leaf shell: a curved thin surface, never a flat card
// ---------------------------------------------------------------------------------------------

export type ShellSpec = {
  readonly length: number;
  readonly width: number;
  /** Position along the length (0..1) of maximum width. */
  readonly widthPeak: number;
  /** Width at the very base as a fraction of max width (petal claw / leaf clasp). */
  readonly baseWidth: number;
  /** <1 = blunt/rounded tip, >1 = acuminate pointed tip. */
  readonly tipSharpness: number;
  /** Spine angle from the local +Y axis toward local +Z (outward), degrees, at base and tip. */
  readonly bendFrom: number;
  readonly bendTo: number;
  /** Exponent shaping how the bend accumulates along the length (1 = linear). */
  readonly bendCurve?: number;
  /** Extra outward degrees eased in over the last third (reflexed lip). */
  readonly bendTip?: number;
  /** Cross-curvature: edges curl toward the inner side by cup × half-width. */
  readonly cup: number;
  /** Extra cup concentrated near the base (sheathing / clasping). */
  readonly baseWrap?: number;
  /** V-fold along the midrib (leaf keel), as a fraction of half-width. */
  readonly keel?: number;
  /** Lateral S-sweep of the tip, as a fraction of length (asymmetric leaves). */
  readonly sweep?: number;
  /** Twist about the spine from base to tip, degrees. */
  readonly twist?: number;
  /** Constant roll of the blade about its spine, degrees (turns a leaf's face toward the camera). */
  readonly roll?: number;
  readonly ruffleWaves?: number;
  readonly ruffleAmp?: number;
  /** Ruffles start at this distance from the midline/base (0..1). */
  readonly ruffleStart?: number;
  /** Colour stops along the length (base → tip). */
  readonly colors: GradientStops;
  /** Colour toward the lateral margins. */
  readonly edgeColor?: string;
  readonly edgeStart?: number;
  /** Thin margin band colour (picotee). */
  readonly rimColor?: string;
  readonly rimWidth?: number;
  /** Optional central blotch (iris signal patch): colour, v range and half-width fraction. */
  readonly signal?: { readonly color: string; readonly from: number; readonly to: number; readonly halfWidth: number };
  readonly segmentsU?: number;
  readonly segmentsV?: number;
};

export type ShellVariation = {
  /** Multiplier applied to bendFrom/bendTo (openness). */
  readonly bendScale: number;
  /** Extra outward degrees added along the whole spine. */
  readonly extraBend: number;
  readonly sizeScale: number;
  readonly rufflePhase: number;
  readonly crumple: number;
  /** Extra roll about the spine, degrees (per petal). */
  readonly roll?: number;
};

const halfWidthProfile = (spec: ShellSpec, v: number) => {
  const peak = THREE.MathUtils.clamp(spec.widthPeak, 0.05, 0.95);
  const g = Math.pow(THREE.MathUtils.clamp(v, 0, 1), Math.log(0.5) / Math.log(peak));
  const body = Math.pow(Math.max(Math.sin(Math.PI * g), 0), spec.tipSharpness);
  const base = spec.baseWidth * Math.pow(1 - v, 2);
  return (spec.width / 2) * Math.max(body, base);
};

/**
 * Parametric shell. Local frame: grows along +Y from the origin, flares toward +Z, width on X.
 * The inner (concave) side faces -Z at the base. DoubleSide materials render both faces.
 */
export function buildShell(spec: ShellSpec, variation: ShellVariation): THREE.BufferGeometry {
  const nu = spec.segmentsU ?? 14;
  const nv = spec.segmentsV ?? 20;
  const length = spec.length * variation.sizeScale;
  const widthScale = variation.sizeScale;
  const ds = length / nv;

  // Integrate the spine in the YZ plane.
  const spine: THREE.Vector3[] = [];
  const inward: THREE.Vector3[] = [];
  const tangents: THREE.Vector3[] = [];
  const pos = new THREE.Vector3();
  const bc = spec.bendCurve ?? 1.4;
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    const lip = (spec.bendTip ?? 0) * smoothstep(0.62, 1, v);
    const deg = (spec.bendFrom + (spec.bendTo - spec.bendFrom) * Math.pow(v, bc) + lip) * variation.bendScale + variation.extraBend * v;
    const th = THREE.MathUtils.degToRad(deg);
    const tan = new THREE.Vector3(0, Math.cos(th), Math.sin(th));
    if (j > 0) pos.addScaledVector(tangents[j - 1].clone().add(tan).normalize(), ds);
    spine.push(pos.clone());
    tangents.push(tan);
    inward.push(new THREE.Vector3(0, Math.sin(th), -Math.cos(th)));
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const cols: number[] = [];
  const indices: number[] = [];
  const c = new THREE.Color();
  const edge = new THREE.Color(spec.edgeColor ?? spec.colors[spec.colors.length - 1]);
  const rim = spec.rimColor ? new THREE.Color(spec.rimColor) : null;
  const signal = spec.signal ? new THREE.Color(spec.signal.color) : null;
  const xAxis = new THREE.Vector3(1, 0, 0);
  const p = new THREE.Vector3();
  const lat = new THREE.Vector3();

  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    const hw = halfWidthProfile(spec, v) * widthScale;
    const twist = THREE.MathUtils.degToRad((spec.roll ?? 0) + (variation.roll ?? 0) + (spec.twist ?? 0) * v);
    for (let i = 0; i <= nu; i++) {
      const u = (i / nu) * 2 - 1;
      const au = Math.abs(u);
      // lateral direction twisted about the spine tangent
      lat.copy(xAxis).applyAxisAngle(tangents[j], twist);
      const inn = inward[j].clone().applyAxisAngle(tangents[j], twist);
      p.copy(spine[j]).addScaledVector(lat, u * hw);
      const wrap = (spec.baseWrap ?? 0) * Math.pow(1 - v, 2);
      p.addScaledVector(inn, (spec.cup + wrap) * hw * u * u);
      if (spec.keel) p.addScaledVector(inn, spec.keel * hw * au);
      if (spec.sweep) p.addScaledVector(lat, spec.sweep * length * Math.sin(Math.PI * 0.5 * v) * v);
      const amp = (spec.ruffleAmp ?? 0) * widthScale;
      if (amp > 0) {
        // Ruffles travel along the outline (side margin, then across the tip), so the frill
        // sits on the edge instead of corrugating the blade.
        const start = spec.ruffleStart ?? 0.6;
        const edgeProximity = Math.max(au, smoothstep(0.75, 1, v));
        const w = smoothstep(start, 1, edgeProximity);
        const waves = spec.ruffleWaves ?? 6;
        const outline = Math.sign(u || 1) * (v + (1 - au));
        const r =
          Math.sin(waves * Math.PI * outline + variation.rufflePhase) * 0.75 +
          Math.sin(waves * 2.3 * Math.PI * outline + variation.rufflePhase * 1.7) * 0.25;
        p.addScaledVector(inn, amp * w * r);
      }
      if (variation.crumple > 0) {
        const k = variation.crumple * hw * 0.35;
        p.addScaledVector(inn, k * Math.sin(5.3 * u + 3.1 * v + variation.rufflePhase) * v);
      }
      positions.push(p.x, p.y, p.z);
      uvs.push((u + 1) / 2, v);

      sampleGradient(spec.colors, v, c);
      c.lerp(edge, smoothstep(spec.edgeStart ?? 0.55, 1, au) * 0.8);
      if (rim) {
        const rw = spec.rimWidth ?? 0.08;
        c.lerp(rim, smoothstep(1 - rw, 1, Math.max(au, smoothstep(0.92, 1, v))) * 0.85);
      }
      if (signal && spec.signal) {
        const s = spec.signal;
        const inV = smoothstep(s.from, s.from + 0.06, v) * (1 - smoothstep(s.to - 0.06, s.to, v));
        const inU = 1 - smoothstep(s.halfWidth * 0.6, s.halfWidth, au);
        c.lerp(signal, inV * inU * 0.9);
      }
      cols.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      const b = a + nu + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/**
 * Tissue data read by shadow renderers: `aThin` is how much light the shell lets through
 * (0 = opaque), `aVein` its vein layout (0 = radiating petal veins, 1 = leaf midrib + laterals).
 * Geometry without these attributes (stems, buds) casts fully opaque shadows.
 */
export function markTissue(g: THREE.BufferGeometry, thin: number, vein: 0 | 1) {
  const n = g.getAttribute('position').count;
  g.setAttribute('aThin', new THREE.Float32BufferAttribute(new Float32Array(n).fill(thin), 1));
  g.setAttribute('aVein', new THREE.Float32BufferAttribute(new Float32Array(n).fill(vein), 1));
  return g;
}

// ---------------------------------------------------------------------------------------------
// Flower assembly
// ---------------------------------------------------------------------------------------------

export type WhorlSpec = {
  readonly id: string;
  readonly count: number;
  /** Azimuth of the first petal, degrees (0 = toward the reference camera, +Z). */
  readonly phase: number;
  /** Height above the head socket and radius from the axis where petal bases sit. */
  readonly baseHeight: number;
  readonly baseRadius: number;
  readonly shell: ShellSpec;
  /** Seeded jitter amplitudes. */
  readonly jitter: { readonly azimuthDeg: number; readonly size: number; readonly bendDeg: number; readonly crumple?: number };
  /** Asymmetric flare: petals facing `azimuth` open by extraDeg, those facing away close by it. */
  readonly lean?: { readonly azimuth: number; readonly extraDeg: number };
  /** How strongly openness affects this whorl (outer whorls open most). */
  readonly opennessWeight?: number;
  /** How much light these petals let through in shadow renders (default 0.6). */
  readonly translucency?: number;
  /** Optional explicit per-petal azimuths (degrees), overrides even spacing. */
  readonly azimuths?: readonly number[];
  /** Roll each petal about its spine by rollByAzimuth × sin(azimuth): side petals tip their front edge. */
  readonly rollByAzimuth?: number;
};

export type LeafSpec = {
  readonly id: string;
  /** Attachment height as a fraction of the stem curve's height. */
  readonly attachHeight: number;
  /** Direction the blade faces/grows toward, degrees about +Y (0 = +Z camera, 90 = +X). */
  readonly azimuth: number;
  readonly shell: ShellSpec;
  /** Offset of the blade root from the stem axis (the clasp sits on the stem surface). */
  readonly rootOffset?: number;
};

export type SepalSpec = {
  readonly count: number;
  readonly phase: number;
  readonly height: number;
  readonly radius: number;
  readonly length: number;
  readonly rootRadius: number;
  /** Outward then downward curl, degrees (start, end) from vertical. */
  readonly curlFrom: number;
  readonly curlTo: number;
  readonly colors: GradientStops;
};

/** A closed spindle (bud, ovary) on the head axis or beside it. */
export type SpindleSpec = {
  readonly id: string;
  readonly offset: Vec3;
  readonly tiltDeg: Vec3;
  readonly length: number;
  readonly radii: readonly number[];
  readonly colors: GradientStops;
  /** Attach to the stem at this height fraction instead of the head socket. */
  readonly stemHeight?: number;
  readonly material?: 'petal' | 'stem';
};

/** A leaf carried by a side branch, placed at curve parameter `t` (0 = branch root, 1 = tip). */
export type BranchLeafSpec = {
  readonly id: string;
  readonly t: number;
  /** Degrees about the branch tangent (±90 puts the pair either side, in the image plane). */
  readonly azimuth: number;
  readonly shell: ShellSpec;
  readonly rootOffset?: number;
};

/** A side twig leaving the main stem, with its own leaves. */
export type BranchSpec = {
  readonly id: string;
  readonly attachHeight: number;
  /** Spine relative to the attachment point, reference units. */
  readonly points: readonly Vec3[];
  readonly radii: readonly number[];
  readonly colors: GradientStops;
  readonly leaves: readonly BranchLeafSpec[];
};

export type FlowerSpec = {
  readonly id: string;
  readonly label: string;
  readonly stem: {
    readonly points: readonly Vec3[];
    readonly radii: readonly number[];
    readonly colors: GradientStops;
    /** Node swellings: height fraction and extra radius. */
    readonly nodes?: readonly { readonly height: number; readonly extra: number }[];
    /** Height fraction of the midStem pivot. */
    readonly midHeight: number;
  };
  readonly calyx?: {
    /** Lathe profile [radius, height] from the stem top, reference units. */
    readonly profile: readonly (readonly [number, number])[];
    readonly colors: GradientStops;
  };
  readonly sepals?: SepalSpec;
  /** Omitted for foliage-only stems (the head pivot still exists at the stem tip). */
  readonly head?: {
    /** Offset of the corolla socket above the stem top. */
    readonly socketHeight: number;
    /** Lateral offset of the corolla in the head frame (asymmetric heads). */
    readonly offset?: Vec3;
    /** Extra tilt of the head relative to the stem tangent, degrees (x = nod toward camera). */
    readonly tiltDeg: Vec3;
    readonly whorls: readonly WhorlSpec[];
    readonly spindles?: readonly SpindleSpec[];
  };
  readonly leaves: readonly LeafSpec[];
  readonly branches?: readonly BranchSpec[];
  readonly stemSpindles?: readonly SpindleSpec[];
  readonly materials: {
    /** `glow` is a faint emissive standing in for thin-shell light transmission. */
    readonly petal: { readonly roughness: number; readonly sheen?: number; readonly glow?: string; readonly glowIntensity?: number };
    readonly stem: { readonly roughness: number };
    readonly leaf: { readonly roughness: number };
  };
  readonly sway: { readonly amplitude: number; readonly speed: number };
};

type Materials = { petal: THREE.Material; stem: THREE.Material; leaf: THREE.Material };

function createMaterials(spec: FlowerSpec): Materials {
  const make = (roughness: number, sheen = 0) =>
    new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness,
      metalness: 0,
      side: THREE.DoubleSide,
      shadowSide: THREE.DoubleSide,
      sheen,
      sheenRoughness: 0.8,
      sheenColor: new THREE.Color(1, 1, 1),
    });
  const petal = make(spec.materials.petal.roughness, spec.materials.petal.sheen ?? 0.35);
  if (spec.materials.petal.glow) {
    petal.emissive = new THREE.Color(spec.materials.petal.glow);
    petal.emissiveIntensity = spec.materials.petal.glowIntensity ?? 0.2;
  }
  return {
    petal,
    stem: make(spec.materials.stem.roughness),
    leaf: make(spec.materials.leaf.roughness),
  };
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, name: string) {
  const m = new THREE.Mesh(geometry, material);
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Curve parameter whose point is at height fraction `h` of the curve's top. */
function tAtHeight(curve: THREE.Curve<THREE.Vector3>, h: number, top: number) {
  const target = h * top;
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    if (curve.getPoint(mid).y < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const UP = new THREE.Vector3(0, 1, 0);

function alignToTangent(obj: THREE.Object3D, tangent: THREE.Vector3) {
  obj.quaternion.setFromUnitVectors(UP, tangent.clone().normalize());
}

const heightCache = new WeakMap<FlowerSpec, number>();

/** Build the flower at reference proportions (no normalisation). */
function assemble(spec: FlowerSpec, o: ResolvedFlowerOptions) {
  const rng = createRng(o.seed);
  const mats = createMaterials(spec);
  const root = new THREE.Group();
  root.name = spec.id;

  // Stem spine with options applied: stemHeight stretches Y, bend scales lateral offsets.
  const pts = spec.stem.points.map(([x, y, z]) => [x * o.bend, y * o.stemHeight, z * o.bend] as Vec3);
  const curve = makeCurve(pts);
  const top = pts[pts.length - 1][1];

  const tMid = tAtHeight(curve, spec.stem.midHeight, top);
  const midPoint = curve.getPoint(tMid);
  const topPoint = curve.getPoint(1);

  const base = new THREE.Group();
  base.name = 'pivot.base';
  base.rotation.z = -o.stemLean;
  root.add(base);
  const midStem = new THREE.Group();
  midStem.name = 'pivot.midStem';
  midStem.position.copy(midPoint);
  base.add(midStem);
  const head = new THREE.Group();
  head.name = 'pivot.head';
  head.position.copy(topPoint).sub(midPoint);
  midStem.add(head);

  const nodeBumps = (t: number) => {
    let r = 0;
    for (const n of spec.stem.nodes ?? []) {
      const tn = tAtHeight(curve, n.height, top);
      const d = (t - tn) / 0.012;
      r += n.extra * Math.exp(-d * d);
    }
    return r;
  };
  const zero = new THREE.Vector3();
  base.add(
    mesh(
      buildTaperedTube(curve, spec.stem.radii, spec.stem.colors, 0, tMid, zero, {
        lengthSegments: 48,
        capStart: true,
        extraRadius: nodeBumps,
      }),
      mats.stem,
      'stem.lower',
    ),
  );
  midStem.add(
    mesh(
      buildTaperedTube(curve, spec.stem.radii, spec.stem.colors, tMid, 1, midPoint, {
        lengthSegments: 40,
        capEnd: !spec.head,
        extraRadius: nodeBumps,
      }),
      mats.stem,
      'stem.upper',
    ),
  );

  // Head frame follows the stem tangent at the top, plus the authored nod.
  const headFrame = new THREE.Group();
  headFrame.name = 'head.frame';
  alignToTangent(headFrame, curve.getTangent(1));
  const tilt = new THREE.Euler(...(spec.head?.tiltDeg ?? [0, 0, 0]).map((d) => THREE.MathUtils.degToRad(d)) as [number, number, number]);
  headFrame.quaternion.multiply(new THREE.Quaternion().setFromEuler(tilt));
  head.add(headFrame);

  if (spec.calyx) {
    const lathe = new THREE.LatheGeometry(
      spec.calyx.profile.map(([r, y]) => new THREE.Vector2(r, y)),
      20,
    );
    const cols: number[] = [];
    const pa = lathe.getAttribute('position');
    const maxY = spec.calyx.profile[spec.calyx.profile.length - 1][1] || 1;
    const c = new THREE.Color();
    for (let i = 0; i < pa.count; i++) {
      sampleGradient(spec.calyx.colors, pa.getY(i) / maxY, c);
      cols.push(c.r, c.g, c.b);
    }
    lathe.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    headFrame.add(mesh(lathe, mats.stem, 'calyx'));
  }

  if (spec.sepals) {
    const s = spec.sepals;
    for (let i = 0; i < s.count; i++) {
      const az = THREE.MathUtils.degToRad(s.phase + (360 / s.count) * i + rng.signed() * 8);
      const holder = new THREE.Group();
      holder.rotation.y = az;
      holder.position.y = s.height;
      const pts3: Vec3[] = [];
      let px = s.radius;
      let py = 0;
      const steps = 4;
      for (let k = 0; k <= steps; k++) {
        pts3.push([0, py, px]);
        const ang = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(s.curlFrom, s.curlTo, k / steps));
        px += Math.sin(ang) * (s.length / steps);
        py += Math.cos(ang) * (s.length / steps);
      }
      const sc = makeCurve(pts3);
      holder.add(
        mesh(
          buildTaperedTube(sc, [s.rootRadius, s.rootRadius * 0.7, s.rootRadius * 0.35, 0.0001], s.colors, 0, 1, zero, {
            radialSegments: 6,
            lengthSegments: 10,
          }),
          mats.stem,
          `sepal.${i}`,
        ),
      );
      headFrame.add(holder);
    }
  }

  const corolla = new THREE.Group();
  corolla.name = 'corolla';
  corolla.position.set(...(spec.head?.offset ?? [0, 0, 0]));
  corolla.position.y += spec.head?.socketHeight ?? 0;
  headFrame.add(corolla);

  const open01 = o.openness / REFERENCE_OPENNESS;
  for (const w of spec.head?.whorls ?? []) {
    const weight = w.opennessWeight ?? 1;
    // openness 0 → 30% of the reference bend, 0.8 → 100%, 1 → 125% (scaled by weight)
    const bendScale = 1 + (THREE.MathUtils.lerp(0.3, 1, Math.min(open01, 1)) - 1 + Math.max(open01 - 1, 0) * 1.0) * weight;
    for (let i = 0; i < w.count; i++) {
      const azDeg = (w.azimuths ? w.azimuths[i] : w.phase + (360 / w.count) * i) + rng.signed() * w.jitter.azimuthDeg;
      const az = THREE.MathUtils.degToRad(azDeg);
      let extra = rng.signed() * w.jitter.bendDeg;
      if (w.lean) {
        const d = Math.cos(az - THREE.MathUtils.degToRad(w.lean.azimuth));
        extra += d * w.lean.extraDeg;
      }
      const geo = buildShell(w.shell, {
        bendScale,
        extraBend: extra,
        sizeScale: 1 + rng.signed() * w.jitter.size,
        rufflePhase: rng.next() * Math.PI * 2,
        crumple: (w.jitter.crumple ?? 0) * (0.6 + rng.next() * 0.4),
        roll: (w.rollByAzimuth ?? 0) * Math.sin(az),
      });
      const holder = new THREE.Group();
      holder.name = `${w.id}.${i}`;
      holder.rotation.y = az;
      markTissue(geo, w.translucency ?? 0.6, 0);
      const petal = mesh(geo, mats.petal, `${w.id}.petal.${i}`);
      petal.position.set(0, w.baseHeight, w.baseRadius);
      holder.add(petal);
      corolla.add(holder);
    }
  }

  const addSpindle = (sp: SpindleSpec, parent: THREE.Object3D) => {
    const n = sp.radii.length;
    const pts2: Vec3[] = sp.radii.map((_, k) => [0, (sp.length * k) / (n - 1), 0]);
    const g = buildTaperedTube(makeCurve(pts2), sp.radii, sp.colors, 0, 1, zero, { radialSegments: 12, lengthSegments: 20, capStart: true, capEnd: true });
    const m = mesh(g, sp.material === 'stem' ? mats.stem : mats.petal, sp.id);
    m.position.set(...sp.offset);
    m.rotation.set(...sp.tiltDeg.map((d) => THREE.MathUtils.degToRad(d)) as [number, number, number]);
    parent.add(m);
  };
  for (const sp of spec.head?.spindles ?? []) addSpindle(sp, headFrame);

  // On foliage-only stems openness spreads the leaves instead of a corolla.
  const leafSpread = spec.head ? 1 : THREE.MathUtils.lerp(0.4, 1, Math.min(open01, 1)) + Math.max(open01 - 1, 0) * 0.6;
  const makeBlade = (shell: ShellSpec, name: string) =>
    mesh(
      markTissue(
        buildShell(
          { ...shell, bendFrom: shell.bendFrom * Math.min(1, 0.5 + o.bend * 0.5), bendTo: shell.bendTo * Math.min(1.3, 0.5 + o.bend * 0.5) },
          { bendScale: leafSpread, extraBend: rng.signed() * (spec.head ? 0 : 10), sizeScale: 1 + rng.signed() * (spec.head ? 0 : 0.08), rufflePhase: 0, crumple: 0 },
        ),
        0.3,
        1,
      ),
      mats.leaf,
      name,
    );

  // Leaves attach below or above the midStem pivot depending on height.
  for (const leaf of spec.leaves) {
    const t = tAtHeight(curve, leaf.attachHeight, top);
    const p = curve.getPoint(t);
    const parent = t < tMid ? base : midStem;
    const origin = t < tMid ? zero : midPoint;
    const holder = new THREE.Group();
    holder.name = `leaf.${leaf.id}`;
    holder.position.copy(p).sub(origin);
    holder.rotation.y = THREE.MathUtils.degToRad(leaf.azimuth + rng.signed() * (spec.head ? 0 : 12));
    const blade = makeBlade(leaf.shell, `leaf.${leaf.id}.blade`);
    blade.position.z = leaf.rootOffset ?? 0.004;
    holder.add(blade);
    parent.add(holder);
  }

  for (const br of spec.branches ?? []) {
    const t = tAtHeight(curve, br.attachHeight, top);
    const parent = t < tMid ? base : midStem;
    const group = new THREE.Group();
    group.name = `branch.${br.id}`;
    group.position.copy(curve.getPoint(t)).sub(t < tMid ? zero : midPoint);
    parent.add(group);
    const bc = makeCurve(br.points.map(([x, y, z]) => [x, y, z * o.bend] as Vec3));
    group.add(mesh(buildTaperedTube(bc, br.radii, br.colors, 0, 1, zero, { radialSegments: 6, lengthSegments: 24, capEnd: true }), mats.stem, `branch.${br.id}.twig`));
    for (const leaf of br.leaves) {
      const holder = new THREE.Group();
      holder.name = `leaf.${br.id}.${leaf.id}`;
      holder.position.copy(bc.getPoint(leaf.t));
      alignToTangent(holder, bc.getTangent(leaf.t));
      holder.rotateY(THREE.MathUtils.degToRad(leaf.azimuth + rng.signed() * 12));
      const blade = makeBlade(leaf.shell, `leaf.${br.id}.${leaf.id}.blade`);
      blade.position.z = leaf.rootOffset ?? 0.002;
      holder.add(blade);
      group.add(holder);
    }
  }
  for (const sp of spec.stemSpindles ?? []) {
    const t = tAtHeight(curve, sp.stemHeight ?? 0.5, top);
    const p = curve.getPoint(t);
    const parent = t < tMid ? base : midStem;
    const holder = new THREE.Group();
    holder.position.copy(p).sub(t < tMid ? zero : midPoint);
    parent.add(holder);
    addSpindle(sp, holder);
  }

  return { root, base, midStem, head, rng };
}

/**
 * Build a flower group: origin at the stem base, +Y up, default total height DEFAULT_HEIGHT.
 * Pivots: `pivot.base` → `pivot.midStem` → `pivot.head`. `userData.tick(t)` drives the sway.
 */
export function buildFlower(spec: FlowerSpec, options: FlowerOptions = {}): THREE.Group {
  const o = resolveOptions(options);

  let refHeight = heightCache.get(spec);
  if (refHeight === undefined) {
    // Always probe the reference pose with a fixed seed, so normalisation never depends on
    // which flower happened to be built first.
    const probe = assemble(spec, resolveOptions({}));
    refHeight = new THREE.Box3().setFromObject(probe.root).max.y;
    probe.root.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    heightCache.set(spec, refHeight);
  }

  const { root, base, midStem, head, rng } = assemble(spec, o);
  const outer = new THREE.Group();
  outer.name = `${spec.id}.model`;
  root.scale.setScalar((DEFAULT_HEIGHT / refHeight) * o.scale);
  outer.add(root);

  const phaseA = rng.next() * Math.PI * 2;
  const phaseB = rng.next() * Math.PI * 2;
  const amp = spec.sway.amplitude;
  const w = spec.sway.speed;
  const lean = -o.stemLean;
  outer.userData.pivots = { base, midStem, head };
  outer.userData.options = o;
  outer.userData.tick = (t: number) => {
    base.rotation.z = lean + amp * Math.sin(w * t + phaseA);
    base.rotation.x = amp * 0.6 * Math.sin(w * 0.77 * t + phaseB);
    midStem.rotation.z = amp * 0.5 * Math.sin(w * t + phaseA - 0.6);
    midStem.rotation.x = amp * 0.3 * Math.sin(w * 0.77 * t + phaseB - 0.6);
    head.rotation.z = amp * 0.4 * Math.sin(w * 1.3 * t + phaseB);
    head.rotation.x = amp * 0.3 * Math.sin(w * 1.1 * t + phaseA);
  };
  return outer;
}
