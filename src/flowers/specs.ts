import type { FlowerSpec } from './flowerKit';
import { CARNATION_SPEC } from './createCarnationModel';
import { IRIS_SPEC } from './createIrisModel';
import { LEAVES_SPEC } from './createLeavesModel';

/** Reconstruction data for every flower, keyed by id (used by tooling to sync work/<id> specs). */
export const FLOWER_SPECS: Record<string, FlowerSpec> = {
  carnation: CARNATION_SPEC,
  iris: IRIS_SPEC,
  leaves: LEAVES_SPEC,
};
