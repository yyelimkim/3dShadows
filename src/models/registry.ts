import type * as THREE from 'three';
import { createSampleSculptureModel } from './sample/createSampleSculptureModel';

export type ModelEntry = {
  id: string;
  name: string;
  /** Path under /references the model was rebuilt from, if any. */
  reference?: string;
  status: 'sample' | 'in-progress' | 'final';
  create: () => THREE.Group;
};

// img2threejs factories register here: one entry per src/models/<id>/ folder.
export const models: ModelEntry[] = [
  {
    id: 'sample-sculpture',
    name: 'Sample sculpture (placeholder)',
    status: 'sample',
    create: () => createSampleSculptureModel({ castShadow: true }),
  },
];
