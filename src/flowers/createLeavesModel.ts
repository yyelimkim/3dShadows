import type * as THREE from 'three';
import { buildFlower, type BranchLeafSpec, type FlowerOptions, type FlowerSpec, type LeafSpec, type ShellSpec } from './flowerKit';

/**
 * Leaves (references/leaves.jpeg) — round-leaved eucalyptus sprig: a main stem with 12 opposite
 * leaf pairs and four side branches. No flower. Reconstruction data:
 * work/leaves/object-sculpt-spec.json. Pair rotation in depth and every hidden leaf face are
 * inferred; see work/leaves/review-notes.md.
 */

const LEAF = ['#34421d', '#3f4f25', '#4a5c2e', '#556936'];
const STEM = ['#5c4830', '#4e4630', '#4f5a36', '#6b7a52'];
const TWIG = ['#5a4a34', '#5d5a3a', '#6b7a52'];

/** Ovate-round "coin" blade, slight point, short petiole neck. */
const coin = (length: number, spread: [number, number] = [58, 78]): ShellSpec => ({
  length,
  width: length * 0.95,
  widthPeak: 0.42,
  baseWidth: 0.1,
  tipSharpness: 0.9,
  bendFrom: spread[0],
  bendTo: spread[1],
  cup: 0.12,
  keel: 0.05,
  colors: LEAF,
  edgeColor: '#64784e',
  edgeStart: 0.5,
  segmentsU: 10,
  segmentsV: 12,
});

/** Leaves face the camera as photographed: sideways leaves roll their face toward +Z, leaves
 *  pointing at or away from the camera already show it. */
const faceRoll = (azimuth: number) => 80 * Math.sin((azimuth * Math.PI) / 180);

const STEM_TOP = 0.978;

/** One opposite pair on the main stem; alternate pairs are rotated (decussate). */
function pair(index: number, h: number, left: number, right: number, spread?: [number, number]): LeafSpec[] {
  const [azL, azR] = index % 2 === 0 ? [-90, 90] : [-60, 120];
  return [
    { id: `p${index}l`, attachHeight: h / STEM_TOP, azimuth: azL, rootOffset: 0.002, shell: { ...coin(left, spread), roll: faceRoll(azL) } },
    { id: `p${index}r`, attachHeight: h / STEM_TOP, azimuth: azR, rootOffset: 0.002, shell: { ...coin(right, spread), roll: faceRoll(azR) } },
  ];
}

/** Opposite pair on a side branch at curve parameter t. */
function twigPair(id: string, t: number, length: number, spread?: [number, number], swing = 0): BranchLeafSpec[] {
  const a = 90 - swing;
  const b = -90 - swing;
  return [
    { id: `${id}a`, t, azimuth: a, shell: { ...coin(length, spread), roll: faceRoll(a) } },
    { id: `${id}b`, t, azimuth: b, shell: { ...coin(length * 0.92, spread), roll: faceRoll(b) } },
  ];
}

const TIP: [number, number] = [18, 32];

export const LEAVES_SPEC: FlowerSpec = {
  id: 'leaves',
  label: 'Eucalyptus leaves',
  stem: {
    points: [
      [0.0, 0.0, 0.0],
      [-0.002, 0.148, 0.002],
      [-0.004, 0.304, 0.0],
      [-0.013, 0.452, -0.002],
      [-0.017, 0.574, 0.0],
      [-0.009, 0.687, 0.002],
      [0.008, 0.8, 0.0],
      [0.02, 0.887, -0.001],
      [0.03, 0.957, 0.0],
      [0.034, STEM_TOP, 0.0],
    ],
    radii: [0.005, 0.0045, 0.004, 0.0036, 0.0032, 0.0028, 0.0024, 0.002, 0.0017, 0.0015],
    colors: STEM,
    midHeight: 0.5,
  },
  leaves: [
    ...pair(0, 0.109, 0.055, 0.055),
    ...pair(1, 0.191, 0.085, 0.09),
    ...pair(2, 0.265, 0.09, 0.095),
    ...pair(3, 0.37, 0.085, 0.09),
    ...pair(4, 0.44, 0.07, 0.085),
    ...pair(5, 0.54, 0.085, 0.08),
    ...pair(6, 0.626, 0.095, 0.09),
    ...pair(7, 0.72, 0.075, 0.065),
    ...pair(8, 0.787, 0.095, 0.08),
    ...pair(9, 0.843, 0.08, 0.07, [35, 55]),
    ...pair(10, 0.9, 0.08, 0.065, [30, 45]),
    ...pair(11, 0.96, 0.055, 0.05, TIP),
  ],
  branches: [
    {
      id: 'A',
      attachHeight: 0.652 / STEM_TOP,
      points: [[0, 0, 0], [-0.05, 0.03, 0.02], [-0.09, 0.055, 0.04], [-0.12, 0.07, 0.05]],
      radii: [0.0024, 0.0018, 0.0012, 0.0008],
      colors: TWIG,
      leaves: [...twigPair('1', 0.35, 0.06), ...twigPair('2', 0.65, 0.055, undefined, 35), ...twigPair('t', 1, 0.045, TIP)],
    },
    {
      id: 'B',
      attachHeight: 0.435 / STEM_TOP,
      points: [[0, 0, 0], [-0.065, 0.06, -0.025], [-0.14, 0.12, -0.05], [-0.195, 0.16, -0.06]],
      radii: [0.0026, 0.002, 0.0014, 0.0008],
      colors: TWIG,
      leaves: [...twigPair('1', 0.3, 0.05), ...twigPair('2', 0.55, 0.055, undefined, 35), ...twigPair('3', 0.8, 0.075), ...twigPair('t', 1, 0.06, TIP, 35)],
    },
    {
      id: 'C',
      attachHeight: 0.2 / STEM_TOP,
      points: [[0, 0, 0], [-0.07, 0.045, 0.02], [-0.14, 0.085, 0.035], [-0.195, 0.113, 0.045]],
      radii: [0.0026, 0.002, 0.0014, 0.0008],
      colors: TWIG,
      leaves: [...twigPair('1', 0.4, 0.05), ...twigPair('2', 0.7, 0.055, undefined, 35), ...twigPair('t', 1, 0.06, TIP)],
    },
    {
      id: 'D',
      attachHeight: 0.135 / STEM_TOP,
      points: [[0, 0, 0], [0.065, 0.08, -0.02], [0.14, 0.17, -0.04], [0.2, 0.235, -0.05]],
      radii: [0.0028, 0.0022, 0.0015, 0.0008],
      colors: TWIG,
      leaves: [...twigPair('1', 0.3, 0.06), ...twigPair('2', 0.55, 0.05, undefined, 35), ...twigPair('3', 0.8, 0.055), ...twigPair('t', 1, 0.05, TIP, 35)],
    },
  ],
  materials: {
    petal: { roughness: 0.7 },
    stem: { roughness: 0.697 },
    leaf: { roughness: 0.734 },
  },
  sway: { amplitude: 0.018, speed: 0.45 },
};

export function createLeavesModel(spec: FlowerSpec = LEAVES_SPEC, options: FlowerOptions = {}): THREE.Group {
  return buildFlower(spec, options);
}
