import type * as THREE from 'three';
import { buildFlower, type FlowerOptions, type FlowerSpec } from './flowerKit';

/**
 * Iris (references/iris.png) — beardless iris: three spreading coral falls, three upright salmon
 * standards, a sword leaf and a narrow spathe leaf sheathing the stem, and a closed bud.
 * Reconstruction data: work/iris/object-sculpt-spec.json. The back fall/standard, petal backs and
 * leaf twist in depth are inferred; see work/iris/review-notes.md.
 */

const FALL = ['#a08238', '#ac3539', '#aa3040', '#b23a46', '#c05058'];
const STANDARD = ['#d8955e', '#de7a72', '#e07c78', '#e28080', '#e48a8a'];
const STYLE = ['#d9b45a', '#e6a05c', '#e98f6a'];
const STEM = ['#6c8044', '#798746', '#7a9050', '#7f9458'];
const LEAF = ['#5f7a45', '#6c854f', '#718759'];

export const IRIS_SPEC: FlowerSpec = {
  id: 'iris',
  label: 'Iris',
  stem: {
    points: [
      [0.0, 0.0, 0.0],
      [-0.004, 0.25, 0.003],
      [-0.012, 0.4, 0.002],
      [-0.015, 0.55, 0.0],
      [0.0, 0.65, -0.002],
      [0.02, 0.74, -0.003],
      [0.028, 0.8, -0.002],
      [0.03, 0.83, 0.0],
    ],
    radii: [0.0068, 0.0066, 0.0062, 0.006, 0.0057, 0.0052, 0.0045, 0.0037],
    colors: STEM,
    nodes: [
      { height: 0.301, extra: 0.0018 },
      { height: 0.755, extra: 0.0018 },
    ],
    midHeight: 0.66,
  },
  calyx: {
    profile: [
      [0.0037, -0.004],
      [0.0072, 0.016],
      [0.0078, 0.04],
      [0.0072, 0.062],
      [0.0055, 0.076],
    ],
    colors: ['#798746', '#8aa05a', '#b6b25e'],
  },
  head: {
    socketHeight: 0.07,
    offset: [-0.007, 0, 0],
    tiltDeg: [8, 0, 0],
    whorls: [
      {
        id: 'fall-front',
        count: 1,
        phase: 0,
        azimuths: [28],
        baseHeight: 0.005,
        baseRadius: 0.006,
        opennessWeight: 1,
        jitter: { azimuthDeg: 4, size: 0.05, bendDeg: 4 },
        shell: {
          length: 0.2, width: 0.14, widthPeak: 0.68, baseWidth: 0.18, tipSharpness: 0.5,
          bendFrom: 44, bendTo: 142, bendCurve: 1.2, cup: 0.2,
          ruffleWaves: 3, ruffleAmp: 0.005, ruffleStart: 0.7,
          colors: FALL, edgeColor: '#d26c6c', edgeStart: 0.6,
          signal: { color: '#eccb52', from: 0.04, to: 0.34, halfWidth: 0.4 },
          segmentsU: 18, segmentsV: 24,
        },
      },
      {
        id: 'falls-side',
        count: 2,
        phase: 105,
        azimuths: [105, -105],
        baseHeight: 0.005,
        baseRadius: 0.006,
        opennessWeight: 1,
        rollByAzimuth: 28,
        jitter: { azimuthDeg: 5, size: 0.05, bendDeg: 4 },
        shell: {
          length: 0.205, width: 0.095, widthPeak: 0.7, baseWidth: 0.18, tipSharpness: 0.5,
          bendFrom: 38, bendTo: 106, bendCurve: 1.3, cup: 0.22,
          ruffleWaves: 3, ruffleAmp: 0.005, ruffleStart: 0.7,
          colors: FALL, edgeColor: '#d26c6c', edgeStart: 0.6,
          signal: { color: '#eccb52', from: 0.04, to: 0.36, halfWidth: 0.42 },
          segmentsU: 18, segmentsV: 24,
        },
      },
      {
        id: 'standards',
        count: 3,
        phase: 60,
        azimuths: [52, 180, -52],
        baseHeight: 0.008,
        baseRadius: 0.005,
        opennessWeight: 0.6,
        jitter: { azimuthDeg: 6, size: 0.06, bendDeg: 4 },
        shell: {
          length: 0.185, width: 0.078, widthPeak: 0.72, baseWidth: 0.12, tipSharpness: 0.4,
          bendFrom: 34, bendTo: 16, bendCurve: 1.2, cup: 0.28,
          ruffleWaves: 3, ruffleAmp: 0.003, ruffleStart: 0.75,
          colors: STANDARD, edgeColor: '#eda3a0', edgeStart: 0.55,
          segmentsU: 16, segmentsV: 22,
        },
      },
      {
        id: 'style-arms',
        count: 3,
        phase: 0,
        azimuths: [0, 105, -105],
        baseHeight: 0.012,
        baseRadius: 0.004,
        opennessWeight: 0.5,
        jitter: { azimuthDeg: 4, size: 0.05, bendDeg: 3 },
        shell: {
          length: 0.055, width: 0.024, widthPeak: 0.6, baseWidth: 0.4, tipSharpness: 0.6,
          bendFrom: 35, bendTo: 70, cup: 0.4,
          colors: STYLE, segmentsU: 8, segmentsV: 10,
        },
      },
    ],
  },
  leaves: [
    {
      id: 'sword',
      attachHeight: 0.301,
      azimuth: 95,
      rootOffset: 0.005,
      shell: {
        length: 0.5, width: 0.044, widthPeak: 0.4, baseWidth: 0.6, tipSharpness: 1.6, roll: 75,
        bendFrom: 14, bendTo: 24, cup: 0.05, keel: 0.12, baseWrap: 1.2,
        colors: LEAF, edgeColor: '#5a7342', edgeStart: 0.5, segmentsU: 10, segmentsV: 36,
      },
    },
    {
      id: 'spathe',
      attachHeight: 0.755,
      azimuth: 80,
      rootOffset: -0.002,
      shell: {
        length: 0.3, width: 0.05, widthPeak: 0.45, baseWidth: 0.32, tipSharpness: 1.4, roll: -80,
        bendFrom: 5, bendTo: 9, cup: 0.15, keel: 0.1, baseWrap: 1.0,
        colors: LEAF, edgeColor: '#5a7342', edgeStart: 0.5, segmentsU: 8, segmentsV: 28,
      },
    },
  ],
  stemSpindles: [
    {
      id: 'bud',
      stemHeight: 0.795,
      offset: [0.008, 0, 0.004],
      tiltDeg: [0, 0, -6],
      length: 0.16,
      radii: [0.005, 0.009, 0.011, 0.0105, 0.008, 0.004, 0.0005],
      colors: ['#6f8a4e', '#7d9a62', '#90a873'],
      material: 'stem',
    },
  ],
  materials: {
    petal: { roughness: 0.728, sheen: 0 },
    stem: { roughness: 0.694 },
    leaf: { roughness: 0.711 },
  },
  sway: { amplitude: 0.02, speed: 0.5 },
};

export function createIrisModel(spec: FlowerSpec = IRIS_SPEC, options: FlowerOptions = {}): THREE.Group {
  return buildFlower(spec, options);
}
