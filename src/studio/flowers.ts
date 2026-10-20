import * as THREE from 'three';
import { flowers, type FlowerEntry } from '../flowers/registry';
import type { FlowerOptions } from '../flowers/flowerKit';
import { CASTER_LAYER } from './pipeline';

export type FlowerSettings = Required<Omit<FlowerOptions, 'seed'>> & { seed: number };

export type FlowerInstance = {
  id: number;
  type: string;
  settings: FlowerSettings;
  /** Transform handle (gizmo target); origin at the stem base. */
  wrapper: THREE.Group;
  model: THREE.Group;
};

export type SavedFlower = {
  type: string;
  settings: FlowerSettings;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
};

export const DEFAULT_SETTINGS: FlowerSettings = { seed: 1, openness: 0.8, stemLean: 0, bend: 1, stemHeight: 1, scale: 1 };

function disposeModel(group: THREE.Object3D) {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    (Array.isArray(m.material) ? m.material : [m.material]).forEach((mat) => mat.dispose());
  });
}

export class FlowerSet {
  readonly instances: FlowerInstance[] = [];
  private nextId = 1;

  constructor(private parent: THREE.Object3D) {}

  entry(type: string): FlowerEntry {
    return flowers.find((f) => f.id === type) ?? flowers[0];
  }

  private buildModel(inst: FlowerInstance) {
    const model = this.entry(inst.type).create({ ...inst.settings });
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.layers.enable(CASTER_LAYER);
        o.castShadow = false;
        o.userData.flowerId = inst.id;
      }
    });
    return model;
  }

  add(type: string, settings: Partial<FlowerSettings> = {}, transform?: Partial<Pick<SavedFlower, 'position' | 'rotation' | 'scale'>>) {
    const wrapper = new THREE.Group();
    const inst: FlowerInstance = {
      id: this.nextId++,
      type,
      settings: { ...DEFAULT_SETTINGS, ...settings },
      wrapper,
      model: new THREE.Group(),
    };
    wrapper.name = `flower.${type}.${inst.id}`;
    wrapper.userData.flowerId = inst.id;
    if (transform?.position) wrapper.position.set(...transform.position);
    if (transform?.rotation) wrapper.rotation.set(...transform.rotation);
    if (transform?.scale) wrapper.scale.set(...transform.scale);
    inst.model = this.buildModel(inst);
    wrapper.add(inst.model);
    this.parent.add(wrapper);
    this.instances.push(inst);
    return inst;
  }

  rebuild(inst: FlowerInstance) {
    inst.wrapper.remove(inst.model);
    disposeModel(inst.model);
    inst.model = this.buildModel(inst);
    inst.wrapper.add(inst.model);
  }

  remove(inst: FlowerInstance) {
    inst.wrapper.removeFromParent();
    disposeModel(inst.model);
    this.instances.splice(this.instances.indexOf(inst), 1);
  }

  clear() {
    [...this.instances].forEach((i) => this.remove(i));
  }

  duplicate(inst: FlowerInstance) {
    const copy = this.add(inst.type, { ...inst.settings, seed: inst.settings.seed + 1 }, {
      position: [inst.wrapper.position.x + 0.18, inst.wrapper.position.y, inst.wrapper.position.z + 0.06],
      rotation: [inst.wrapper.rotation.x, inst.wrapper.rotation.y, inst.wrapper.rotation.z],
      scale: [inst.wrapper.scale.x, inst.wrapper.scale.y, inst.wrapper.scale.z],
    });
    return copy;
  }

  find(id: number) {
    return this.instances.find((i) => i.id === id);
  }

  tick(t: number) {
    for (const inst of this.instances) {
      const tick = inst.model.userData.tick as ((t: number, dt: number) => void) | undefined;
      tick?.(t + inst.id * 1.7, 0);
    }
  }

  serialize(): SavedFlower[] {
    return this.instances.map((i) => ({
      type: i.type,
      settings: { ...i.settings },
      position: i.wrapper.position.toArray() as [number, number, number],
      rotation: [i.wrapper.rotation.x, i.wrapper.rotation.y, i.wrapper.rotation.z],
      scale: i.wrapper.scale.toArray() as [number, number, number],
    }));
  }

  load(saved: SavedFlower[]) {
    this.clear();
    for (const s of saved) this.add(s.type, s.settings, s);
  }
}

/** Render one thumbnail per registry entry (transparent PNG data URLs). */
export function renderThumbnails(renderer: THREE.WebGLRenderer, size = 112): Record<string, string> {
  const out: Record<string, string> = {};
  const rt = new THREE.WebGLRenderTarget(size, size);
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8278, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 2);
  key.position.set(1, 2, 3);
  scene.add(key);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 20);
  const pixels = new Uint8Array(size * size * 4);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  for (const f of flowers) {
    const model = f.create();
    scene.add(model);
    const box = new THREE.Box3().setFromObject(model);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    cam.position.set(sphere.center.x, sphere.center.y + 0.05, sphere.center.z + sphere.radius * 3.6);
    cam.lookAt(sphere.center);
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, pixels);
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) img.data.set(pixels.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
    ctx.putImageData(img, 0, 0);
    out[f.id] = canvas.toDataURL('image/png');
    scene.remove(model);
    disposeModel(model);
  }
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  rt.dispose();
  return out;
}
