import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

function buildLatheGeometry(profile: { points: [number, number][]; segments?: number }): THREE.LatheGeometry {
  const points = profile.points.map(([x, y]) => new THREE.Vector2(Math.max(0.0001, x), y));
  return new THREE.LatheGeometry(points, profile.segments ?? 24);
}

type TaperedStation = { position: [number, number, number]; rx: number; rz: number; twist?: number };

// Frames come from PARALLEL TRANSPORT, not from a Frenet frame. A Frenet frame is defined by
// the curve's normal, which flips sign wherever the path has an inflection or straightens out,
// and every flip twists the surface 180 degrees within one segment. Carrying the previous frame
// forward and removing only its along-path component keeps the twist continuous. THREE's own
// extrudePath and TubeGeometry do not expose this, which is why this is hand-built.
function buildTaperedSweepGeometry(
  sweep: { stations: TaperedStation[]; radialSegments?: number; capEnds?: boolean },
): THREE.BufferGeometry {
  const stations = sweep.stations;
  if (stations.length < 2) throw new Error('tapered-sweep needs at least two stations');
  const radial = Math.max(3, sweep.radialSegments ?? 10);
  const centres = stations.map((s) => new THREE.Vector3(...s.position));

  const tangents = centres.map((_, i) => {
    const prev = centres[Math.max(0, i - 1)];
    const next = centres[Math.min(centres.length - 1, i + 1)];
    const t = next.clone().sub(prev);
    // Coincident neighbours would normalise to NaN and poison every downstream vertex.
    return t.lengthSq() < 1e-12 ? new THREE.Vector3(0, 1, 0) : t.normalize();
  });

  // Seed a reference axis that is not parallel to the first tangent, or the first cross
  // product is degenerate and the whole sweep collapses to a line.
  let ref = new THREE.Vector3(0, 0, 1);
  if (Math.abs(tangents[0].dot(ref)) > 0.9) ref = new THREE.Vector3(1, 0, 0);

  const normals: THREE.Vector3[] = [];
  const binormals: THREE.Vector3[] = [];
  let carried = ref.clone().sub(tangents[0].clone().multiplyScalar(ref.dot(tangents[0]))).normalize();
  for (let i = 0; i < tangents.length; i += 1) {
    const t = tangents[i];
    // Project the carried frame back onto the plane perpendicular to this tangent.
    const n = carried.clone().sub(t.clone().multiplyScalar(carried.dot(t)));
    if (n.lengthSq() < 1e-12) {
      const fallback = Math.abs(t.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      n.copy(fallback.sub(t.clone().multiplyScalar(fallback.dot(t))));
    }
    n.normalize();
    normals.push(n);
    binormals.push(new THREE.Vector3().crossVectors(t, n).normalize());
    carried = n;
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ringStart: number[] = [];
  const isPoint: boolean[] = [];

  for (let i = 0; i < stations.length; i += 1) {
    const st = stations[i];
    const v = i / (stations.length - 1);
    ringStart.push(positions.length / 3);
    // A station whose section has collapsed emits ONE vertex, not a ring of radius zero.
    // A degenerate ring still carries `radial` coincident vertices and `radial` zero-area
    // triangles, so the lock ends in a blunt cap the width of the floating-point noise
    // rather than at a point -- and a hair lock, a horn or a blade tip has to reach a point.
    if (st.rx <= 1e-6 && st.rz <= 1e-6) {
      isPoint.push(true);
      positions.push(centres[i].x, centres[i].y, centres[i].z);
      uvs.push(0.5, v);
      continue;
    }
    isPoint.push(false);
    const twist = ((st.twist ?? 0) * Math.PI) / 180;
    for (let j = 0; j <= radial; j += 1) {
      const theta = (j / radial) * Math.PI * 2 + twist;
      const offset = normals[i].clone().multiplyScalar(Math.cos(theta) * st.rx)
        .add(binormals[i].clone().multiplyScalar(Math.sin(theta) * st.rz));
      const p = centres[i].clone().add(offset);
      positions.push(p.x, p.y, p.z);
      uvs.push(j / radial, v);
    }
  }

  for (let i = 0; i < stations.length - 1; i += 1) {
    const a0 = ringStart[i];
    const b0 = ringStart[i + 1];
    if (isPoint[i] && isPoint[i + 1]) continue;   // two collapsed stations bound nothing
    for (let j = 0; j < radial; j += 1) {
      // Wound so the face normal points radially OUTWARD.
      //
      // Ring vertices advance from `normal` toward `binormal`, and binormal is
      // tangent x normal, so increasing theta runs counter-clockwise seen from the
      // far end of the segment. Taking the ring-to-ring edge first therefore puts
      // the cross product on the inside. Measured as signed volume on the built
      // mesh: every tapered-sweep came out negative -- a torso at -0.0674 and a
      // tail at -0.0044 against a positive ellipsoid head -- so every sweep this
      // generator has ever emitted rendered its back faces, with normals pointing
      // into the solid and every lighting judgement made on the wrong surface.
      if (isPoint[i]) indices.push(a0, b0 + j + 1, b0 + j);
      else if (isPoint[i + 1]) indices.push(a0 + j, a0 + j + 1, b0);
      else indices.push(a0 + j, a0 + j + 1, b0 + j, a0 + j + 1, b0 + j + 1, b0 + j);
    }
  }

  if (sweep.capEnds ?? true) {
    for (const end of [0, stations.length - 1]) {
      if (isPoint[end]) continue;   // a point end is already closed
      const centreIndex = positions.length / 3;
      positions.push(centres[end].x, centres[end].y, centres[end].z);
      uvs.push(0.5, end === 0 ? 0 : 1);
      const base = ringStart[end];
      for (let j = 0; j < radial; j += 1) {
        if (end === 0) indices.push(centreIndex, base + j + 1, base + j);
        else indices.push(centreIndex, base + j, base + j + 1);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  // setStyle with an explicit SRGBColorSpace, NOT the numeric constructor.
  //
  // `new THREE.Color(r, g, b)` treats its arguments as LINEAR working-space components,
  // while an authored `baseColor` hex is sRGB. Feeding one to the other skipped the
  // transfer function and lifted every dark albedo: #2e2a28, authored as a near-black
  // vinyl, rendered at roughly sRGB 0.46 — a mid grey. The error is largest exactly where
  // it matters most, because the transfer curve is steepest near black.
  return new THREE.Color().setStyle(source, THREE.SRGBColorSpace);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  // A material that declares -- with evidence -- that its subject carries no texture
  // detail gets NO texture set. Synthesising one anyway is not a harmless default: the
  // branch below then forces color to white and roughness to 1 and reads both from the
  // generated maps, so the authored albedo and the reference-derived roughness are both
  // discarded, and the model gains mottling the reference does not have. Measured on the
  // tuxedo cat, whose black fur rendered as speckled grey-and-white from a palette that
  // only ever described two flat regions.
  const textureless = (spec.textureless as { declared?: boolean } | undefined)?.declared === true;
  const textures = textureless
    ? null
    : makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Iris
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createIrisModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Iris";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40.0, "aspect": 1.0, "orientation": {"yaw": 0.0, "pitch": 0.0, "roll": 0.0}, "positionHint": [0.0, 0.0, 3.0], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["petal"] = createSculptMaterial(
    "petal",
    {"id": "petal", "name": "Tepal thin shell", "type": "physical", "shaderModel": "MeshPhysicalMaterial, procedural vertex-colour gradient", "baseColor": "#c9a24a", "color": "#c9a24a", "albedo": {"dominant": "#DB5B63", "secondary": ["#CD404B", "#BC2A37", "#EC8486"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights.", "map": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/petal/petal_albedo.png", "url": "petal_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}}, "colorVariation": {"palette": ["#DB5B63", "#CD404B", "#BC2A37", "#EC8486", "#646422"], "pattern": "reference-derived pixel palette", "amplitude": 0.136, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.393, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.35, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.728, "variation": 0.091, "map": "independent-procedural-field", "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother", "extractedEvidenceMap": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/petal/petal_roughness.png", "url": "petal_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "mapNote": "extracted map kept as evidence only; brief forbids external texture files, so the factory uses the scalar"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "reference-derived height-gradient normal map", "strength": 0.212, "map": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/petal/petal_normal.png", "url": "petal_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "heightSource": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/petal/petal_height.png", "url": "petal_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.021, "map": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/petal/petal_height.png", "url": "petal_height.png", "channel": "height", "source": "reference-pixel-extraction"}}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "map": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/petal/petal_ao.png", "url": "petal_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "signal-patch", "region": "fall v 0.05-0.38, centre 45%", "color": "#eccb52", "detailRef": "d-signal", "evidenceRefs": ["zone:top-center"]}, {"id": "fall-edge-lighten", "region": "outer 30% of margin", "color": "#ea9590", "detailRef": "d-fall-edge", "evidenceRefs": ["zone:top-right"]}, {"id": "standard-salmon", "region": "standards", "color": "#f0a19d", "evidenceRefs": ["zone:top-center"]}, {"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["Every mesh castShadow = true; no external textures.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "translucency": "semi-translucent thin shell", "side": "DoubleSide", "finishClass": "botanical-matte-dielectric", "texturePalette": ["#A67C43", "#E99295", "#D6515A", "#C63B46", "#DC5761"], "proceduralTexture": {"kind": "vertex-colour gradient", "note": "no canvas or file textures"}, "clearcoat": {"base": 0.0, "variation": 0.0}, "clearcoatRoughness": 0.0, "transmission": 0.0, "ior": 1.4, "envMapIntensity": 0.6, "referencePbr": {"version": "1.0", "sourceImage": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/petal.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.79, "estimatedFidelity": 0.79, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/petal/petal_albedo.png", "url": "petal_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/petal/petal_roughness.png", "url": "petal_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/petal/petal_height.png", "url": "petal_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/petal/petal_normal.png", "url": "petal_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/petal/petal_ao.png", "url": "petal_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 150, "sourceHeight": 75, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 150, "height": 75}, "mask": {"backgroundColor": "#DD6D68", "backgroundNoise": 126.321, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.9489}, "mapStats": {"valueRange": 0.3234, "heightP90Gradient": 0.04765, "roughnessBase": 0.728, "roughnessVariation": 0.091, "normalStrength": 0.212, "blurRadius": 21}, "palette": ["#DB5B63", "#CD404B", "#BC2A37", "#EC8486", "#646422"]}, "warnings": ["image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}, "finishCorrection": "analyze_texture classified this crop as 'candy-coat'; overridden: plant tissue is a non-metallic dielectric (metalness 0, no clearcoat, no anisotropy)"},
    options
  );
  materialMap["stem"] = createSculptMaterial(
    "stem",
    {"id": "stem", "name": "Stem / bud / ovary", "type": "physical", "shaderModel": "MeshPhysicalMaterial, procedural vertex-colour gradient", "baseColor": "#6c8044", "color": "#6c8044", "albedo": {"dominant": "#808B43", "secondary": ["#899555", "#78833A", "#9AA571"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights.", "map": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/stem/stem_albedo.png", "url": "stem_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}}, "colorVariation": {"palette": ["#808B43", "#899555", "#78833A", "#9AA571", "#D4D9C2"], "pattern": "reference-derived pixel palette", "amplitude": 0.121, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.381, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.273, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.125, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.694, "variation": 0.05, "map": "independent-procedural-field", "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother", "extractedEvidenceMap": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/stem/stem_roughness.png", "url": "stem_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "mapNote": "extracted map kept as evidence only; brief forbids external texture files, so the factory uses the scalar"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "reference-derived height-gradient normal map", "strength": 0.19, "map": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/stem/stem_normal.png", "url": "stem_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "heightSource": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/stem/stem_height.png", "url": "stem_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.013, "map": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/stem/stem_height.png", "url": "stem_height.png", "channel": "height", "source": "reference-pixel-extraction"}}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "map": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/stem/stem_ao.png", "url": "stem_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "bud-tint", "region": "bud tip", "color": "#a4b77f", "evidenceRefs": ["zone:middle-center"]}, {"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["Every mesh castShadow = true; no external textures.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "translucency": "opaque", "side": "DoubleSide", "finishClass": "botanical-matte-dielectric", "texturePalette": ["#CAD1B8", "#85904C", "#7C873F", "#899556", "#F7F8F4"], "proceduralTexture": {"kind": "vertex-colour gradient", "note": "no canvas or file textures"}, "clearcoat": {"base": 0.0, "variation": 0.0}, "clearcoatRoughness": 0.0, "transmission": 0.0, "ior": 1.4, "envMapIntensity": 0.6, "referencePbr": {"version": "1.0", "sourceImage": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/stem.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.86, "estimatedFidelity": 0.86, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/stem/stem_albedo.png", "url": "stem_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/stem/stem_roughness.png", "url": "stem_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/stem/stem_height.png", "url": "stem_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/stem/stem_normal.png", "url": "stem_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/stem/stem_ao.png", "url": "stem_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 26, "sourceHeight": 280, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 25, "height": 280}, "mask": {"backgroundColor": "#FCFCFB", "backgroundNoise": 7.0, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.7346}, "mapStats": {"valueRange": 0.2878, "heightP90Gradient": 0.02919, "roughnessBase": 0.694, "roughnessVariation": 0.05, "normalStrength": 0.19, "blurRadius": 21}, "palette": ["#808B43", "#899555", "#78833A", "#9AA571", "#D4D9C2"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}, "finishCorrection": "analyze_texture classified this crop as 'painted-metal'; overridden: plant tissue is a non-metallic dielectric (metalness 0, no clearcoat, no anisotropy)"},
    options
  );
  materialMap["leaf"] = createSculptMaterial(
    "leaf",
    {"id": "leaf", "name": "Sword/spathe leaf", "type": "physical", "shaderModel": "MeshPhysicalMaterial, procedural vertex-colour gradient", "baseColor": "#5f7a45", "color": "#5f7a45", "albedo": {"dominant": "#6E8756", "secondary": ["#637A4F", "#91A866", "#7C965D"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights.", "map": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/leaf/leaf_albedo.png", "url": "leaf_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}}, "colorVariation": {"palette": ["#6E8756", "#637A4F", "#91A866", "#7C965D", "#566C44"], "pattern": "reference-derived pixel palette", "amplitude": 0.1, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2.0, 2.0], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2.0, "amplitude": 0.363, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14.0, "amplitude": 0.28, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72.0, "amplitude": 0.129, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.711, "variation": 0.064, "map": "independent-procedural-field", "localResponse": "reference-derived roughness estimate; cavities and textured zones trend rougher, bright highlights trend smoother", "extractedEvidenceMap": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/leaf/leaf_roughness.png", "url": "leaf_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "mapNote": "extracted map kept as evidence only; brief forbids external texture files, so the factory uses the scalar"}, "metalness": {"base": 0.0, "variation": 0.0}, "normal": {"pattern": "reference-derived height-gradient normal map", "strength": 0.192, "map": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/leaf/leaf_normal.png", "url": "leaf_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "heightSource": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/leaf/leaf_height.png", "url": "leaf_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.014, "map": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/leaf/leaf_height.png", "url": "leaf_height.png", "channel": "height", "source": "reference-pixel-extraction"}}, "displacement": {"pattern": "none", "amplitude": 0.0, "scale": 1.0, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "map": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/leaf/leaf_ao.png", "url": "leaf_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0.0, "scratches": [], "chips": []}, "dirt": {"amount": 0.0, "cavityBias": 0.0, "color": "#2F2A22"}, "localOverrides": [{"id": "parallel-vein-tint", "region": "whole blade, lengthwise", "color": "#7b9361", "detailRef": "d-leaf-veins", "evidenceRefs": ["zone:bottom-right"]}, {"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["Every mesh castShadow = true; no external textures.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "translucency": "opaque", "side": "DoubleSide", "finishClass": "botanical-matte-dielectric", "texturePalette": ["#C6D1B6", "#A1B289", "#768D57", "#687F53", "#728563"], "proceduralTexture": {"kind": "vertex-colour gradient", "note": "no canvas or file textures"}, "clearcoat": {"base": 0.0, "variation": 0.0}, "clearcoatRoughness": 0.0, "transmission": 0.0, "ior": 1.4, "envMapIntensity": 0.6, "referencePbr": {"version": "1.0", "sourceImage": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/leaf.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.818, "estimatedFidelity": 0.818, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/leaf/leaf_albedo.png", "url": "leaf_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/leaf/leaf_roughness.png", "url": "leaf_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/leaf/leaf_height.png", "url": "leaf_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/leaf/leaf_normal.png", "url": "leaf_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/Users/yelimkim/Projects/3dShadows/work/iris/material-evidence/leaf/leaf_ao.png", "url": "leaf_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 50, "sourceHeight": 100, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 50, "height": 100}, "mask": {"backgroundColor": "#FCFCFC", "backgroundNoise": 264.798, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.8604}, "mapStats": {"valueRange": 0.2374, "heightP90Gradient": 0.03087, "roughnessBase": 0.711, "roughnessVariation": 0.064, "normalStrength": 0.192, "blurRadius": 21}, "palette": ["#6E8756", "#637A4F", "#91A866", "#7C965D", "#566C44"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped", "low value range weakens height/roughness inference"]}, "finishCorrection": "analyze_texture classified this crop as 'painted-metal'; overridden: plant tissue is a non-metallic dielectric (metalness 0, no clearcoat, no anisotropy)"},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_stem_0 = makeAttachmentEndpoint(null);
  const node_stem_0 = new THREE.Group();
  node_stem_0.name = "Stem (tapered tube, gentle S)__pivot";
  node_stem_0.scale.set(1, 1, 1);
  if (endpoint_stem_0) {
    node_stem_0.position.copy(endpoint_stem_0.start);
    node_stem_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_stem_0.position.set(0.0, 0.0, 0.0);
    node_stem_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_stem_0.userData.sculptComponent = {"id": "stem", "name": "Stem (tapered tube, gentle S)", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.85, "primitive": "tapered-sweep", "topologyClass": "fiber-strand", "topologyRationale": "Long thin path-following strand with a slowly tapering round section: tapered sweep.", "geometryDescriptor": {"topologyIntent": "smooth organic surface", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "taperedSweep": {"stations": [{"position": [0, 0, 0], "rx": 0.0068, "rz": 0.0068, "twist": 0}, {"position": [-0.004, 0.25, 0.003], "rx": 0.0066, "rz": 0.0066, "twist": 0}, {"position": [-0.012, 0.4, 0.002], "rx": 0.0062, "rz": 0.0062, "twist": 0}, {"position": [-0.015, 0.55, 0], "rx": 0.006, "rz": 0.006, "twist": 0}, {"position": [-0.008, 0.65, -0.002], "rx": 0.0057, "rz": 0.0057, "twist": 0}, {"position": [0.01, 0.74, -0.003], "rx": 0.0052, "rz": 0.0052, "twist": 0}, {"position": [0.022, 0.8, -0.002], "rx": 0.0045, "rz": 0.0045, "twist": 0}, {"position": [0.025, 0.83, 0], "rx": 0.0037, "rz": 0.0037, "twist": 0}], "radialSegments": 12, "capEnds": true}}, "parent": null, "attachment": null, "dimensions": {"width": 0.014, "height": 0.83, "depth": 0.014, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": true, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "node-0.25", "localPosition": [-0.004, 0.25, 0.003]}, {"id": "node-0.60", "localPosition": [-0.013, 0.6, 0]}, {"id": "head", "localPosition": [0.025, 0.83, 0]}], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "proxy for click/explode only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stem", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stem"}}, "material": "stem", "materialLayers": ["stem"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone:bottom-center", "zone:middle-center"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(122, 144, 80, 1.0)", "secondaryAlbedo": "rgba(127, 148, 88, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.8, "materialClassNote": "botanical tissue (petal/leaf/stem): thin dielectric, no listed class fits", "colorGradient": {"type": "linear", "axis": "base-to-tip", "stops": [{"position": 0.0, "color": "rgba(108, 128, 68, 1.0)"}, {"position": 0.333, "color": "rgba(121, 135, 70, 1.0)"}, {"position": 0.667, "color": "rgba(122, 144, 80, 1.0)"}, {"position": 1.0, "color": "rgba(127, 148, 88, 1.0)"}]}, "evidenceRefs": ["zone:bottom-center", "zone:middle-center"]}};
  node_stem_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": true, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "node-0.25", "localPosition": [-0.004, 0.25, 0.003]}, {"id": "node-0.60", "localPosition": [-0.013, 0.6, 0]}, {"id": "head", "localPosition": [0.025, 0.83, 0]}], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "proxy for click/explode only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stem", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stem"}};
  (nodes["root"] ?? root).add(node_stem_0);
  nodes["stem"] = node_stem_0;
  const mesh_stem_0Geometry = endpoint_stem_0
    ? new THREE.CylinderGeometry(endpoint_stem_0.endRadius, endpoint_stem_0.baseRadius, endpoint_stem_0.length, 16, 6)
    : buildTaperedSweepGeometry({"stations": [{"position": [0, 0, 0], "rx": 0.0068, "rz": 0.0068, "twist": 0}, {"position": [-0.004, 0.25, 0.003], "rx": 0.0066, "rz": 0.0066, "twist": 0}, {"position": [-0.012, 0.4, 0.002], "rx": 0.0062, "rz": 0.0062, "twist": 0}, {"position": [-0.015, 0.55, 0], "rx": 0.006, "rz": 0.006, "twist": 0}, {"position": [-0.008, 0.65, -0.002], "rx": 0.0057, "rz": 0.0057, "twist": 0}, {"position": [0.01, 0.74, -0.003], "rx": 0.0052, "rz": 0.0052, "twist": 0}, {"position": [0.022, 0.8, -0.002], "rx": 0.0045, "rz": 0.0045, "twist": 0}, {"position": [0.025, 0.83, 0], "rx": 0.0037, "rz": 0.0037, "twist": 0}], "radialSegments": 12, "capEnds": true});
  if (!endpoint_stem_0) {
    mesh_stem_0Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_stem_0 = new THREE.Mesh(
    mesh_stem_0Geometry,
    materialMap["stem"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_stem_0.name = "Stem (tapered tube, gentle S)";
  if (endpoint_stem_0) {
    mesh_stem_0.position.copy(endpoint_stem_0.midpoint);
    mesh_stem_0.quaternion.copy(endpoint_stem_0.quaternion);
  }
  mesh_stem_0.castShadow = options.castShadow ?? true;
  mesh_stem_0.receiveShadow = options.receiveShadow ?? true;
  mesh_stem_0.userData.sculptComponent = {"id": "stem", "name": "Stem (tapered tube, gentle S)", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.85, "primitive": "tapered-sweep", "topologyClass": "fiber-strand", "topologyRationale": "Long thin path-following strand with a slowly tapering round section: tapered sweep.", "geometryDescriptor": {"topologyIntent": "smooth organic surface", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "taperedSweep": {"stations": [{"position": [0, 0, 0], "rx": 0.0068, "rz": 0.0068, "twist": 0}, {"position": [-0.004, 0.25, 0.003], "rx": 0.0066, "rz": 0.0066, "twist": 0}, {"position": [-0.012, 0.4, 0.002], "rx": 0.0062, "rz": 0.0062, "twist": 0}, {"position": [-0.015, 0.55, 0], "rx": 0.006, "rz": 0.006, "twist": 0}, {"position": [-0.008, 0.65, -0.002], "rx": 0.0057, "rz": 0.0057, "twist": 0}, {"position": [0.01, 0.74, -0.003], "rx": 0.0052, "rz": 0.0052, "twist": 0}, {"position": [0.022, 0.8, -0.002], "rx": 0.0045, "rz": 0.0045, "twist": 0}, {"position": [0.025, 0.83, 0], "rx": 0.0037, "rz": 0.0037, "twist": 0}], "radialSegments": 12, "capEnds": true}}, "parent": null, "attachment": null, "dimensions": {"width": 0.014, "height": 0.83, "depth": 0.014, "units": "world", "confidence": 0.85}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": true, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "node-0.25", "localPosition": [-0.004, 0.25, 0.003]}, {"id": "node-0.60", "localPosition": [-0.013, 0.6, 0]}, {"id": "head", "localPosition": [0.025, 0.83, 0]}], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "proxy for click/explode only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stem", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stem"}}, "material": "stem", "materialLayers": ["stem"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone:bottom-center", "zone:middle-center"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(122, 144, 80, 1.0)", "secondaryAlbedo": "rgba(127, 148, 88, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.8, "materialClassNote": "botanical tissue (petal/leaf/stem): thin dielectric, no listed class fits", "colorGradient": {"type": "linear", "axis": "base-to-tip", "stops": [{"position": 0.0, "color": "rgba(108, 128, 68, 1.0)"}, {"position": 0.333, "color": "rgba(121, 135, 70, 1.0)"}, {"position": 0.667, "color": "rgba(122, 144, 80, 1.0)"}, {"position": 1.0, "color": "rgba(127, 148, 88, 1.0)"}]}, "evidenceRefs": ["zone:bottom-center", "zone:middle-center"]}};
  node_stem_0.add(mesh_stem_0);
  meshes["stem"] = mesh_stem_0;
  colliders["stem"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "proxy for click/explode only"};
  destructionGroups["stem"] ??= [];
  destructionGroups["stem"].push(node_stem_0);
  const socket_stem_node_0_25_0 = new THREE.Object3D();
  socket_stem_node_0_25_0.name = "node-0.25";
  socket_stem_node_0_25_0.position.set(-0.004, 0.25, 0.003);
  socket_stem_node_0_25_0.rotation.set(0, 0, 0);
  socket_stem_node_0_25_0.userData.socket = {"id": "node-0.25", "localPosition": [-0.004, 0.25, 0.003]};
  node_stem_0.add(socket_stem_node_0_25_0);
  sockets["stem:node-0.25"] = socket_stem_node_0_25_0;
  const socket_stem_node_0_60_1 = new THREE.Object3D();
  socket_stem_node_0_60_1.name = "node-0.60";
  socket_stem_node_0_60_1.position.set(-0.013, 0.6, 0.0);
  socket_stem_node_0_60_1.rotation.set(0, 0, 0);
  socket_stem_node_0_60_1.userData.socket = {"id": "node-0.60", "localPosition": [-0.013, 0.6, 0]};
  node_stem_0.add(socket_stem_node_0_60_1);
  sockets["stem:node-0.60"] = socket_stem_node_0_60_1;
  const socket_stem_head_2 = new THREE.Object3D();
  socket_stem_head_2.name = "head";
  socket_stem_head_2.position.set(0.025, 0.83, 0.0);
  socket_stem_head_2.rotation.set(0, 0, 0);
  socket_stem_head_2.userData.socket = {"id": "head", "localPosition": [0.025, 0.83, 0]};
  node_stem_0.add(socket_stem_head_2);
  sockets["stem:head"] = socket_stem_head_2;

  const endpoint_ovary_1 = makeAttachmentEndpoint(null);
  const node_ovary_1 = new THREE.Group();
  node_ovary_1.name = "Ovary / perianth tube__pivot";
  node_ovary_1.scale.set(1, 1, 1);
  if (endpoint_ovary_1) {
    node_ovary_1.position.copy(endpoint_ovary_1.start);
    node_ovary_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_ovary_1.position.set(0.025, 0.83, 0.0);
    node_ovary_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_ovary_1.userData.sculptComponent = {"id": "ovary", "name": "Ovary / perianth tube", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.7, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "Rotationally symmetric green swelling under the perianth: lathe.", "geometryDescriptor": {"topologyIntent": "smooth organic surface", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0037, 0], [0.0075, 0.012], [0.008, 0.026], [0.006, 0.038], [0.003, 0.042]], "segments": 18}}, "parent": "stem", "attachment": {"parentId": "stem", "parentSocket": "head", "contactType": "embed", "localStart": [0, 0, 0], "localEnd": [0, 0.042, 0], "embedDepth": 0.004, "overlap": 0.02, "gapTolerance": 0.002, "contactNormal": [0, 1, 0], "baseRadius": 0.0037, "endRadius": 0.006, "evidenceRefs": ["zone:top-center"]}, "dimensions": {"width": 0.016, "height": 0.04, "depth": 0.016, "units": "world", "confidence": 0.7}, "transform": {"position": [0.025, 0.83, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-child", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "proxy for click/explode only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ovary", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stem"}}, "material": "stem", "materialLayers": ["stem"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone:top-center"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(122, 144, 80, 1.0)", "secondaryAlbedo": "rgba(127, 148, 88, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.8, "materialClassNote": "botanical tissue (petal/leaf/stem): thin dielectric, no listed class fits", "colorGradient": {"type": "linear", "axis": "base-to-tip", "stops": [{"position": 0.0, "color": "rgba(108, 128, 68, 1.0)"}, {"position": 0.333, "color": "rgba(121, 135, 70, 1.0)"}, {"position": 0.667, "color": "rgba(122, 144, 80, 1.0)"}, {"position": 1.0, "color": "rgba(127, 148, 88, 1.0)"}]}, "evidenceRefs": ["zone:top-center"]}};
  node_ovary_1.userData.actionProfile = {"animationRole": "static-child", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "proxy for click/explode only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ovary", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stem"}};
  (nodes["stem"] ?? root).add(node_ovary_1);
  nodes["ovary"] = node_ovary_1;
  const mesh_ovary_1Geometry = endpoint_ovary_1
    ? new THREE.CylinderGeometry(endpoint_ovary_1.endRadius, endpoint_ovary_1.baseRadius, endpoint_ovary_1.length, 16, 6)
    : buildLatheGeometry({"points": [[0.0037, 0], [0.0075, 0.012], [0.008, 0.026], [0.006, 0.038], [0.003, 0.042]], "segments": 18});
  if (!endpoint_ovary_1) {
    mesh_ovary_1Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_ovary_1 = new THREE.Mesh(
    mesh_ovary_1Geometry,
    materialMap["stem"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_ovary_1.name = "Ovary / perianth tube";
  if (endpoint_ovary_1) {
    mesh_ovary_1.position.copy(endpoint_ovary_1.midpoint);
    mesh_ovary_1.quaternion.copy(endpoint_ovary_1.quaternion);
  }
  mesh_ovary_1.castShadow = options.castShadow ?? true;
  mesh_ovary_1.receiveShadow = options.receiveShadow ?? true;
  mesh_ovary_1.userData.sculptComponent = {"id": "ovary", "name": "Ovary / perianth tube", "level": "meso", "role": "body", "importance": 0.8, "confidence": 0.7, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "Rotationally symmetric green swelling under the perianth: lathe.", "geometryDescriptor": {"topologyIntent": "smooth organic surface", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0.0037, 0], [0.0075, 0.012], [0.008, 0.026], [0.006, 0.038], [0.003, 0.042]], "segments": 18}}, "parent": "stem", "attachment": {"parentId": "stem", "parentSocket": "head", "contactType": "embed", "localStart": [0, 0, 0], "localEnd": [0, 0.042, 0], "embedDepth": 0.004, "overlap": 0.02, "gapTolerance": 0.002, "contactNormal": [0, 1, 0], "baseRadius": 0.0037, "endRadius": 0.006, "evidenceRefs": ["zone:top-center"]}, "dimensions": {"width": 0.016, "height": 0.04, "depth": 0.016, "units": "world", "confidence": 0.7}, "transform": {"position": [0.025, 0.83, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-child", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "proxy for click/explode only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "ovary", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "stem"}}, "material": "stem", "materialLayers": ["stem"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone:top-center"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(122, 144, 80, 1.0)", "secondaryAlbedo": "rgba(127, 148, 88, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.8, "materialClassNote": "botanical tissue (petal/leaf/stem): thin dielectric, no listed class fits", "colorGradient": {"type": "linear", "axis": "base-to-tip", "stops": [{"position": 0.0, "color": "rgba(108, 128, 68, 1.0)"}, {"position": 0.333, "color": "rgba(121, 135, 70, 1.0)"}, {"position": 0.667, "color": "rgba(122, 144, 80, 1.0)"}, {"position": 1.0, "color": "rgba(127, 148, 88, 1.0)"}]}, "evidenceRefs": ["zone:top-center"]}};
  node_ovary_1.add(mesh_ovary_1);
  meshes["ovary"] = mesh_ovary_1;
  colliders["ovary"] = {"type": "capsule", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "proxy for click/explode only"};
  destructionGroups["ovary"] ??= [];
  destructionGroups["ovary"].push(node_ovary_1);

  const endpoint_perianth_2 = makeAttachmentEndpoint(null);
  const node_perianth_2 = new THREE.Group();
  node_perianth_2.name = "Perianth (falls + standards + style arms)__pivot";
  node_perianth_2.scale.set(1, 1, 1);
  if (endpoint_perianth_2) {
    node_perianth_2.position.copy(endpoint_perianth_2.start);
    node_perianth_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_perianth_2.position.set(0.0, 0.04, 0.0);
    node_perianth_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_perianth_2.userData.sculptComponent = {"id": "perianth", "name": "Perianth (falls + standards + style arms)", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.7, "primitive": "instanced-cluster", "topologyClass": "conforming-shell", "topologyRationale": "Head is an assembly of curved thin tepal shells on a trimerous plan.", "geometryDescriptor": {"topologyIntent": "smooth organic surface", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "instancedBase": "plane-card"}, "parent": "ovary", "attachment": {"parentId": "ovary", "parentSocket": "ovary-top", "contactType": "socket", "localStart": [0, 0, 0], "localEnd": [0, 0.14, 0], "embedDepth": 0.004, "overlap": 0.02, "gapTolerance": 0.002, "contactNormal": [0, 1, 0], "baseRadius": 0.006, "endRadius": 0.17, "evidenceRefs": ["zone:top-center"]}, "dimensions": {"width": 0.34, "height": 0.16, "depth": 0.3, "units": "world", "confidence": 0.7}, "transform": {"position": [0, 0.04, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "head", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "proxy for click/explode only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "perianth", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "petal"}}, "material": "petal", "materialLayers": ["petal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone:top-center"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(212, 84, 90, 1.0)", "secondaryAlbedo": "rgba(226, 123, 123, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.8, "materialClassNote": "botanical tissue (petal/leaf/stem): thin dielectric, no listed class fits", "colorGradient": {"type": "linear", "axis": "petal base -> edge -> tip", "stops": [{"position": 0.0, "color": "rgba(201, 162, 74, 1.0)"}, {"position": 0.25, "color": "rgba(216, 96, 90, 1.0)"}, {"position": 0.5, "color": "rgba(212, 84, 90, 1.0)"}, {"position": 0.75, "color": "rgba(216, 93, 97, 1.0)"}, {"position": 1.0, "color": "rgba(226, 123, 123, 1.0)"}]}, "evidenceRefs": ["zone:top-center"]}};
  node_perianth_2.userData.actionProfile = {"animationRole": "head", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "proxy for click/explode only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "perianth", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "petal"}};
  (nodes["ovary"] ?? root).add(node_perianth_2);
  nodes["perianth"] = node_perianth_2;
  const mesh_perianth_2Geometry = endpoint_perianth_2
    ? new THREE.CylinderGeometry(endpoint_perianth_2.endRadius, endpoint_perianth_2.baseRadius, endpoint_perianth_2.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_perianth_2) {
    mesh_perianth_2Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_perianth_2 = new THREE.Mesh(
    mesh_perianth_2Geometry,
    materialMap["petal"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_perianth_2.name = "Perianth (falls + standards + style arms)";
  if (endpoint_perianth_2) {
    mesh_perianth_2.position.copy(endpoint_perianth_2.midpoint);
    mesh_perianth_2.quaternion.copy(endpoint_perianth_2.quaternion);
  }
  mesh_perianth_2.castShadow = options.castShadow ?? true;
  mesh_perianth_2.receiveShadow = options.receiveShadow ?? true;
  mesh_perianth_2.userData.sculptComponent = {"id": "perianth", "name": "Perianth (falls + standards + style arms)", "level": "macro", "role": "body", "importance": 1.0, "confidence": 0.7, "primitive": "instanced-cluster", "topologyClass": "conforming-shell", "topologyRationale": "Head is an assembly of curved thin tepal shells on a trimerous plan.", "geometryDescriptor": {"topologyIntent": "smooth organic surface", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "instancedBase": "plane-card"}, "parent": "ovary", "attachment": {"parentId": "ovary", "parentSocket": "ovary-top", "contactType": "socket", "localStart": [0, 0, 0], "localEnd": [0, 0.14, 0], "embedDepth": 0.004, "overlap": 0.02, "gapTolerance": 0.002, "contactNormal": [0, 1, 0], "baseRadius": 0.006, "endRadius": 0.17, "evidenceRefs": ["zone:top-center"]}, "dimensions": {"width": 0.34, "height": 0.16, "depth": 0.3, "units": "world", "confidence": 0.7}, "transform": {"position": [0, 0.04, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "head", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "proxy for click/explode only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "perianth", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "petal"}}, "material": "petal", "materialLayers": ["petal"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone:top-center"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(212, 84, 90, 1.0)", "secondaryAlbedo": "rgba(226, 123, 123, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.8, "materialClassNote": "botanical tissue (petal/leaf/stem): thin dielectric, no listed class fits", "colorGradient": {"type": "linear", "axis": "petal base -> edge -> tip", "stops": [{"position": 0.0, "color": "rgba(201, 162, 74, 1.0)"}, {"position": 0.25, "color": "rgba(216, 96, 90, 1.0)"}, {"position": 0.5, "color": "rgba(212, 84, 90, 1.0)"}, {"position": 0.75, "color": "rgba(216, 93, 97, 1.0)"}, {"position": 1.0, "color": "rgba(226, 123, 123, 1.0)"}]}, "evidenceRefs": ["zone:top-center"]}};
  node_perianth_2.add(mesh_perianth_2);
  meshes["perianth"] = mesh_perianth_2;
  colliders["perianth"] = {"type": "sphere", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "proxy for click/explode only"};
  destructionGroups["perianth"] ??= [];
  destructionGroups["perianth"].push(node_perianth_2);

  const endpoint_leaf_sword_3 = makeAttachmentEndpoint(null);
  const node_leaf_sword_3 = new THREE.Group();
  node_leaf_sword_3.name = "Sword leaf__pivot";
  node_leaf_sword_3.scale.set(1, 1, 1);
  if (endpoint_leaf_sword_3) {
    node_leaf_sword_3.position.copy(endpoint_leaf_sword_3.start);
    node_leaf_sword_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leaf_sword_3.position.set(-0.004, 0.25, 0.003);
    node_leaf_sword_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_leaf_sword_3.userData.sculptComponent = {"id": "leaf-sword", "name": "Sword leaf", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.75, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Long linear blade with sheathing base and slight arc: deformed card, DoubleSide.", "geometryDescriptor": {"topologyIntent": "smooth organic surface", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [{"type": "wrap", "amount": 1.0, "region": "base 20%"}, {"type": "bend", "axis": "length", "fromDeg": 12, "toDeg": 22}], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "stem", "attachment": {"parentId": "stem", "parentSocket": "node-0.25", "contactType": "overlap", "localStart": [0, 0, 0], "localEnd": [0.145, 0.43, 0], "embedDepth": 0.004, "overlap": 0.02, "gapTolerance": 0.002, "contactNormal": [0, 1, 0], "baseRadius": 0.008, "endRadius": 0.0, "evidenceRefs": ["zone:bottom-right"]}, "dimensions": {"width": 0.042, "height": 0.455, "depth": 0.02, "units": "world", "confidence": 0.75}, "transform": {"position": [-0.004, 0.25, 0.003], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-child", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "proxy for click/explode only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leaf-sword", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "leaf"}}, "material": "leaf", "materialLayers": ["leaf"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "leaf-sheath", "kind": "seam", "description": "base wraps the stem", "evidenceRefs": ["zone:bottom-center"], "detailRef": "d-sheath"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone:bottom-right"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 133, 79, 1.0)", "secondaryAlbedo": "rgba(113, 135, 89, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.8, "materialClassNote": "botanical tissue (petal/leaf/stem): thin dielectric, no listed class fits", "colorGradient": {"type": "linear", "axis": "base-to-tip", "stops": [{"position": 0.0, "color": "rgba(95, 122, 69, 1.0)"}, {"position": 0.5, "color": "rgba(108, 133, 79, 1.0)"}, {"position": 1.0, "color": "rgba(113, 135, 89, 1.0)"}]}, "evidenceRefs": ["zone:bottom-right"]}};
  node_leaf_sword_3.userData.actionProfile = {"animationRole": "static-child", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "proxy for click/explode only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leaf-sword", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "leaf"}};
  (nodes["stem"] ?? root).add(node_leaf_sword_3);
  nodes["leaf-sword"] = node_leaf_sword_3;
  const mesh_leaf_sword_3Geometry = endpoint_leaf_sword_3
    ? new THREE.CylinderGeometry(endpoint_leaf_sword_3.endRadius, endpoint_leaf_sword_3.baseRadius, endpoint_leaf_sword_3.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_leaf_sword_3) {
    mesh_leaf_sword_3Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_leaf_sword_3 = new THREE.Mesh(
    mesh_leaf_sword_3Geometry,
    materialMap["leaf"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leaf_sword_3.name = "Sword leaf";
  if (endpoint_leaf_sword_3) {
    mesh_leaf_sword_3.position.copy(endpoint_leaf_sword_3.midpoint);
    mesh_leaf_sword_3.quaternion.copy(endpoint_leaf_sword_3.quaternion);
  }
  mesh_leaf_sword_3.castShadow = options.castShadow ?? true;
  mesh_leaf_sword_3.receiveShadow = options.receiveShadow ?? true;
  mesh_leaf_sword_3.userData.sculptComponent = {"id": "leaf-sword", "name": "Sword leaf", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.75, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Long linear blade with sheathing base and slight arc: deformed card, DoubleSide.", "geometryDescriptor": {"topologyIntent": "smooth organic surface", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [{"type": "wrap", "amount": 1.0, "region": "base 20%"}, {"type": "bend", "axis": "length", "fromDeg": 12, "toDeg": 22}], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "stem", "attachment": {"parentId": "stem", "parentSocket": "node-0.25", "contactType": "overlap", "localStart": [0, 0, 0], "localEnd": [0.145, 0.43, 0], "embedDepth": 0.004, "overlap": 0.02, "gapTolerance": 0.002, "contactNormal": [0, 1, 0], "baseRadius": 0.008, "endRadius": 0.0, "evidenceRefs": ["zone:bottom-right"]}, "dimensions": {"width": 0.042, "height": 0.455, "depth": 0.02, "units": "world", "confidence": 0.75}, "transform": {"position": [-0.004, 0.25, 0.003], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-child", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "proxy for click/explode only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leaf-sword", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "leaf"}}, "material": "leaf", "materialLayers": ["leaf"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "leaf-sheath", "kind": "seam", "description": "base wraps the stem", "evidenceRefs": ["zone:bottom-center"], "detailRef": "d-sheath"}], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone:bottom-right"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 133, 79, 1.0)", "secondaryAlbedo": "rgba(113, 135, 89, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.8, "materialClassNote": "botanical tissue (petal/leaf/stem): thin dielectric, no listed class fits", "colorGradient": {"type": "linear", "axis": "base-to-tip", "stops": [{"position": 0.0, "color": "rgba(95, 122, 69, 1.0)"}, {"position": 0.5, "color": "rgba(108, 133, 79, 1.0)"}, {"position": 1.0, "color": "rgba(113, 135, 89, 1.0)"}]}, "evidenceRefs": ["zone:bottom-right"]}};
  node_leaf_sword_3.add(mesh_leaf_sword_3);
  meshes["leaf-sword"] = mesh_leaf_sword_3;
  colliders["leaf-sword"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "proxy for click/explode only"};
  destructionGroups["leaf-sword"] ??= [];
  destructionGroups["leaf-sword"].push(node_leaf_sword_3);

  const endpoint_leaf_spathe_4 = makeAttachmentEndpoint(null);
  const node_leaf_spathe_4 = new THREE.Group();
  node_leaf_spathe_4.name = "Spathe leaf__pivot";
  node_leaf_spathe_4.scale.set(1, 1, 1);
  if (endpoint_leaf_spathe_4) {
    node_leaf_spathe_4.position.copy(endpoint_leaf_spathe_4.start);
    node_leaf_spathe_4.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_leaf_spathe_4.position.set(-0.013, 0.6, 0.0);
    node_leaf_spathe_4.rotation.set(0.0, 0.0, 0.0);
  }
  node_leaf_spathe_4.userData.sculptComponent = {"id": "leaf-spathe", "name": "Spathe leaf", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.7, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Narrow sheathing blade running straight up alongside the stem: deformed card, DoubleSide.", "geometryDescriptor": {"topologyIntent": "smooth organic surface", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [{"type": "wrap", "amount": 0.9, "region": "base 25%"}, {"type": "bend", "axis": "length", "fromDeg": 2, "toDeg": 5}], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "stem", "attachment": {"parentId": "stem", "parentSocket": "node-0.60", "contactType": "overlap", "localStart": [0, 0, 0], "localEnd": [0.005, 0.29, 0], "embedDepth": 0.004, "overlap": 0.02, "gapTolerance": 0.002, "contactNormal": [0, 1, 0], "baseRadius": 0.007, "endRadius": 0.0, "evidenceRefs": ["zone:middle-center"]}, "dimensions": {"width": 0.026, "height": 0.29, "depth": 0.015, "units": "world", "confidence": 0.7}, "transform": {"position": [-0.013, 0.6, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-child", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "proxy for click/explode only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leaf-spathe", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "leaf"}}, "material": "leaf", "materialLayers": ["leaf"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone:middle-center"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 133, 79, 1.0)", "secondaryAlbedo": "rgba(113, 135, 89, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.8, "materialClassNote": "botanical tissue (petal/leaf/stem): thin dielectric, no listed class fits", "colorGradient": {"type": "linear", "axis": "base-to-tip", "stops": [{"position": 0.0, "color": "rgba(95, 122, 69, 1.0)"}, {"position": 0.5, "color": "rgba(108, 133, 79, 1.0)"}, {"position": 1.0, "color": "rgba(113, 135, 89, 1.0)"}]}, "evidenceRefs": ["zone:middle-center"]}};
  node_leaf_spathe_4.userData.actionProfile = {"animationRole": "static-child", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "proxy for click/explode only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leaf-spathe", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "leaf"}};
  (nodes["stem"] ?? root).add(node_leaf_spathe_4);
  nodes["leaf-spathe"] = node_leaf_spathe_4;
  const mesh_leaf_spathe_4Geometry = endpoint_leaf_spathe_4
    ? new THREE.CylinderGeometry(endpoint_leaf_spathe_4.endRadius, endpoint_leaf_spathe_4.baseRadius, endpoint_leaf_spathe_4.length, 16, 6)
    : new THREE.PlaneGeometry(1, 1, 12, 12);
  if (!endpoint_leaf_spathe_4) {
    mesh_leaf_spathe_4Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_leaf_spathe_4 = new THREE.Mesh(
    mesh_leaf_spathe_4Geometry,
    materialMap["leaf"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_leaf_spathe_4.name = "Spathe leaf";
  if (endpoint_leaf_spathe_4) {
    mesh_leaf_spathe_4.position.copy(endpoint_leaf_spathe_4.midpoint);
    mesh_leaf_spathe_4.quaternion.copy(endpoint_leaf_spathe_4.quaternion);
  }
  mesh_leaf_spathe_4.castShadow = options.castShadow ?? true;
  mesh_leaf_spathe_4.receiveShadow = options.receiveShadow ?? true;
  mesh_leaf_spathe_4.userData.sculptComponent = {"id": "leaf-spathe", "name": "Spathe leaf", "level": "macro", "role": "body", "importance": 0.8, "confidence": 0.7, "primitive": "plane-card", "topologyClass": "conforming-shell", "topologyRationale": "Narrow sheathing blade running straight up alongside the stem: deformed card, DoubleSide.", "geometryDescriptor": {"topologyIntent": "smooth organic surface", "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1}, "deformationStack": [{"type": "wrap", "amount": 0.9, "region": "base 25%"}, {"type": "bend", "axis": "length", "fromDeg": 2, "toDeg": 5}], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "stem", "attachment": {"parentId": "stem", "parentSocket": "node-0.60", "contactType": "overlap", "localStart": [0, 0, 0], "localEnd": [0.005, 0.29, 0], "embedDepth": 0.004, "overlap": 0.02, "gapTolerance": 0.002, "contactNormal": [0, 1, 0], "baseRadius": 0.007, "endRadius": 0.0, "evidenceRefs": ["zone:middle-center"]}, "dimensions": {"width": 0.026, "height": 0.29, "depth": 0.015, "units": "world", "confidence": 0.7}, "transform": {"position": [-0.013, 0.6, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-child", "pivot": {"mode": "custom", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 0.7}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "proxy for click/explode only"}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "leaf-spathe", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0.0, "debrisMaterial": "leaf"}}, "material": "leaf", "materialLayers": ["leaf"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0.0, "microRoughness": 0.0, "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["zone:middle-center"], "details": [], "fidelityTier": "form", "colorMaterialRecipe": {"dominantAlbedo": "rgba(108, 133, 79, 1.0)", "secondaryAlbedo": "rgba(113, 135, 89, 1.0)", "materialClass": "unknown", "materialClassConfidence": 0.8, "materialClassNote": "botanical tissue (petal/leaf/stem): thin dielectric, no listed class fits", "colorGradient": {"type": "linear", "axis": "base-to-tip", "stops": [{"position": 0.0, "color": "rgba(95, 122, 69, 1.0)"}, {"position": 0.5, "color": "rgba(108, 133, 79, 1.0)"}, {"position": 1.0, "color": "rgba(113, 135, 89, 1.0)"}]}, "evidenceRefs": ["zone:middle-center"]}};
  node_leaf_spathe_4.add(mesh_leaf_spathe_4);
  meshes["leaf-spathe"] = mesh_leaf_spathe_4;
  colliders["leaf-spathe"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "proxy for click/explode only"};
  destructionGroups["leaf-spathe"] ??= [];
  destructionGroups["leaf-spathe"].push(node_leaf_spathe_4);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."], "presentation": "viewer-owned lights and environment; presentation composer skipped per brief"};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createIrisLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Iris look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = [{"id": "key-sun", "type": "directional", "intensity": 3.0, "color": "#fff4e6", "castShadow": true, "note": "viewer-owned sun; user orbits azimuth/elevation; PCF soft shadow map 2048, the cast shadow on the wall/ground is the hero read"}, {"id": "fill-hemisphere", "type": "hemisphere", "intensity": 0.35, "sky": "#ffffff", "ground": "#888070", "note": "soft fill matching the photo's white seamless studio light"}, {"id": "environment", "type": "environment", "source": "RoomEnvironment PMREM", "intensity": 0.35, "note": "exposure 1.0 with ACES filmic tone mapping, sRGB output"}, {"id": "ground-contact", "type": "shadow", "note": "ground shadow / contact shadow from the viewer ground plane (receiveShadow); no baked ambient occlusion"}];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."], "presentation": "viewer-owned lights and environment; presentation composer skipped per brief"};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createIrisEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameIrisCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createIrisPresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureIrisRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createIrisInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
