import type * as THREE from 'three';
import { DEFAULT_HEIGHT, type FlowerOptions } from './flowerKit';
import { CARNATION_SPEC, createCarnationModel } from './createCarnationModel';
import { IRIS_SPEC, createIrisModel } from './createIrisModel';
import { LEAVES_SPEC, createLeavesModel } from './createLeavesModel';

export type FlowerEntry = {
  id: string;
  label: string;
  create: (options?: FlowerOptions) => THREE.Group;
  defaultHeight: number;
};

export const flowers: FlowerEntry[] = [
  {
    id: 'carnation',
    label: CARNATION_SPEC.label,
    create: (options) => createCarnationModel(CARNATION_SPEC, options),
    defaultHeight: DEFAULT_HEIGHT,
  },
  {
    id: 'iris',
    label: IRIS_SPEC.label,
    create: (options) => createIrisModel(IRIS_SPEC, options),
    defaultHeight: DEFAULT_HEIGHT,
  },
  {
    id: 'leaves',
    label: LEAVES_SPEC.label,
    create: (options) => createLeavesModel(LEAVES_SPEC, options),
    defaultHeight: DEFAULT_HEIGHT,
  },
];
