// Screenshot-gate harness for the flower library (dev server only, never bundled).
//   /work/review.html?model=<id>&layout=sheet            front | side | 3/4 | top | wall shadow
//   /work/review.html?model=<id>&layout=match            front view framed like the 1024x1536 reference
//   /work/review.html?model=<id>&layout=match&az=90      same framing, other azimuths (turntable gate)
//   &mode=silhouette renders flat black on white; &seed= &openness= etc. pass through as options.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { flowers } from '../src/flowers/registry';
import { FLOWER_SPECS } from '../src/flowers/specs';

if (new URLSearchParams(location.search).get('layout') === 'spec') {
  const id = new URLSearchParams(location.search).get('model') ?? '';
  const pre = document.createElement('pre');
  pre.id = 'spec';
  pre.textContent = JSON.stringify(FLOWER_SPECS[id] ?? null);
  document.body.appendChild(pre);
  throw new Error('spec dump only');
}

if (new URLSearchParams(location.search).get('layout') === 'check') {
  const hash = (g: THREE.Object3D) => {
    let h = 0;
    g.updateMatrixWorld(true);
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const p = m.geometry.getAttribute('position');
      const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i += 7) {
        v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
        h = (h * 31 + Math.round(v.x * 1e5) * 3 + Math.round(v.y * 1e5) * 5 + Math.round(v.z * 1e5) * 7) % 1000000007;
      }
    });
    return h;
  };
  const bbox = (g: THREE.Object3D) => new THREE.Box3().setFromObject(g);
  const results: Record<string, unknown> = {};
  for (const f of flowers) {
    const a = f.create({ seed: 7 });
    const b = f.create({ seed: 7 });
    const c = f.create({ seed: 8 });
    const base = f.create();
    const bb = bbox(base);
    let meshes = 0, shadow = 0, petalDouble = 0, petalMeshes = 0, tris = 0;
    base.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      meshes++;
      if (m.castShadow) shadow++;
      tris += (m.geometry.index?.count ?? 0) / 3;
      const mat = m.material as THREE.Material;
      if (mat.side === THREE.DoubleSide) petalDouble++;
      petalMeshes++;
    });
    const pivots = ['pivot.base', 'pivot.midStem', 'pivot.head'].map((n) => !!base.getObjectByName(n));
    const h = (o: Parameters<typeof f.create>[0]) => +bbox(f.create(o)).max.y.toFixed(4);
    const tick = base.userData.tick as (t: number) => void;
    const h0 = hash(base);
    tick(3.0);
    const h1 = hash(base);
    const headY0 = (() => { const p = new THREE.Vector3(); base.getObjectByName('pivot.head')!.getWorldPosition(p); return p; })();
    tick(9.0);
    const headY1 = (() => { const p = new THREE.Vector3(); base.getObjectByName('pivot.head')!.getWorldPosition(p); return p; })();
    results[f.id] = {
      sameSeedSame: hash(a) === hash(b),
      differentSeedDiffers: hash(a) !== hash(c),
      defaultHeight: +bb.max.y.toFixed(4),
      minY: +bb.min.y.toFixed(4),
      registryDefaultHeight: f.defaultHeight,
      meshes, castShadowAll: shadow === meshes, doubleSideAll: petalDouble === petalMeshes, tris,
      pivots,
      heights: { stemHeight0_7: h({ stemHeight: 0.7 }), stemHeight1_3: h({ stemHeight: 1.3 }), scale2: h({ scale: 2 }) },
      openness: { o0_width: +bbox(f.create({ openness: 0 })).getSize(new THREE.Vector3()).x.toFixed(4), o08_width: +bb.getSize(new THREE.Vector3()).x.toFixed(4), o1_width: +bbox(f.create({ openness: 1 })).getSize(new THREE.Vector3()).x.toFixed(4) },
      stemLeanHeadX: +(() => { const g = f.create({ stemLean: 0.2 }); const p = new THREE.Vector3(); g.updateMatrixWorld(true); g.getObjectByName('pivot.head')!.getWorldPosition(p); return p.x; })().toFixed(4),
      bend0Differs: hash(f.create({ bend: 0 })) !== h0,
      swayMoves: h0 !== h1,
      swayHeadTravel: +headY0.distanceTo(headY1).toFixed(4),
    };
  }
  const pre = document.createElement('pre');
  pre.id = 'check';
  pre.textContent = JSON.stringify(results);
  document.body.appendChild(pre);
  throw new Error('check only');
}

const q = new URLSearchParams(location.search);
const entry = flowers.find((f) => f.id === q.get('model')) ?? flowers[0];
const layout = q.get('layout') ?? 'sheet';
const silhouette = q.get('mode') === 'silhouette';
const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);

const refSize: Record<string, [number, number]> = { leaves: [843, 1264] };
const W = layout === 'match' ? (refSize[entry.id]?.[0] ?? 1024) : 1500;
const H = layout === 'match' ? (refSize[entry.id]?.[1] ?? 1536) : 900;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setScissorTest(true);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;
scene.add(new THREE.HemisphereLight(0xffffff, 0x888070, 0.6));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(0.6, 2, 3);
scene.add(key);

const model = entry.create({
  seed: num('seed'), openness: num('openness'), stemLean: num('stemLean'),
  stemHeight: num('stemHeight'), bend: num('bend'), scale: num('scale'),
});
if (q.has('t')) model.traverse((o) => typeof o.userData.tick === 'function' && o.userData.tick(Number(q.get('t')), 0));
scene.add(model);
const black = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
if (silhouette) model.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = black; });

const box = new THREE.Box3().setFromObject(model);
const size = box.getSize(new THREE.Vector3());
const centre = box.getCenter(new THREE.Vector3());

function ortho(az: number, el: number, halfH: number, aspect: number, target: THREE.Vector3) {
  const cam = new THREE.OrthographicCamera(-halfH * aspect, halfH * aspect, halfH, -halfH, 0.01, 20);
  const a = THREE.MathUtils.degToRad(az);
  const e = THREE.MathUtils.degToRad(el);
  cam.position.set(target.x + Math.sin(a) * Math.cos(e) * 5, target.y + Math.sin(e) * 5, target.z + Math.cos(a) * Math.cos(e) * 5);
  if (Math.abs(el) > 89) cam.up.set(0, 0, -1);
  cam.lookAt(target);
  return cam;
}

function draw(x: number, y: number, w: number, h: number, cam: THREE.Camera, bg = 0xffffff) {
  renderer.setViewport(x, H - y - h, w, h);
  renderer.setScissor(x, H - y - h, w, h);
  renderer.setClearColor(bg, 1);
  renderer.render(scene, cam);
}

if (layout === 'match') {
  // Per-reference framing measured from the photo: subject height and stem-base pixel position.
  const framing: Record<string, { heightPx: number; baseX: number; baseY: number }> = {
    carnation: { heightPx: 1399, baseX: 508, baseY: 1497 },
    iris: { heightPx: 1449, baseX: 465, baseY: 1509 },
    leaves: { heightPx: 1155, baseX: 434, baseY: 1221 },
  };
  const f = framing[entry.id] ?? { heightPx: 1399, baseX: W / 2, baseY: 1497 };
  const pxPerUnit = f.heightPx / size.y;
  const halfH = H / 2 / pxPerUnit;
  const baseY = box.min.y;
  const cy = baseY + (f.baseY - H / 2) / pxPerUnit;
  const cx = (W / 2 - (num('baseX') ?? f.baseX)) / pxPerUnit;
  const cam = ortho(num('az') ?? 0, 0, halfH, W / H, new THREE.Vector3(cx, cy, 0));
  draw(0, 0, W, H, cam);
} else {
  const panelW = 300;
  const views: [string, number, number][] = [['front', 0, 0], ['side', 90, 0], ['3/4', 45, 15], ['top', 0, 90]];
  const halfH = size.y * 0.55;
  views.forEach(([, az, el], i) => {
    const target = el > 80 ? new THREE.Vector3(centre.x, centre.y, centre.z) : new THREE.Vector3(0, centre.y, 0);
    const hh = el > 80 ? (Math.max(size.x, size.z) * 0.6) / (panelW / H) : halfH;
    draw(i * panelW, 0, panelW, H, ortho(az, el, hh, panelW / H, target));
  });
  // Wall shadow panel: sun behind/side of the flower projecting onto a back wall.
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshStandardMaterial({ color: 0xf2efe9, roughness: 1 }));
  wall.position.set(0, 1, -0.35);
  wall.receiveShadow = true;
  scene.add(wall);
  model.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  const sun = new THREE.DirectionalLight(0xfff4e6, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -1; sun.shadow.camera.right = 1; sun.shadow.camera.top = 1.4; sun.shadow.camera.bottom = -0.4;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.01;
  sun.position.set(0.8, 1.6, 3);
  sun.target.position.set(0, 0.5, 0);
  scene.add(sun, sun.target);
  key.intensity = 0.3;
  const persp = new THREE.PerspectiveCamera(35, panelW / H, 0.01, 20);
  persp.position.set(1.2, 0.6, 2.2);
  persp.lookAt(0, 0.5, -0.2);
  draw(4 * panelW, 0, panelW, H, persp, 0xece9e4);
}

let tris = 0;
model.traverse((o) => {
  const m = o as THREE.Mesh;
  if (m.isMesh) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3;
});
document.title = `ready h=${size.y.toFixed(4)} w=${size.x.toFixed(4)} d=${size.z.toFixed(4)} tris=${tris}`;
(window as unknown as Record<string, unknown>).__review = { ready: true, size, tris };
