import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import GUI, { type Controller } from 'lil-gui';
import { flowers } from '../flowers/registry';
import { FlowerSet, renderThumbnails, type FlowerInstance, type SavedFlower } from './flowers';
import { DEFAULT_HALFTONE, DEFAULT_PARAMS, HALFTONE_EDGES, HALFTONE_STYLES, PRESETS, randomPalette, type HalftoneParams, type StudioParams } from './params';
import { ShadowPipeline, createOutputMaterial, type Look, type StudioMode } from './pipeline';

// Colours sampled from references/Ui Reference.
const STAGE_BG = '#a19a90';
const DISC_COLOR = '#c2af6a';

const ASPECTS: Record<string, number> = { '16:10': 16 / 10, '3:2': 3 / 2, '4:3': 4 / 3, '1:1': 1, '4:5': 4 / 5, '2:3': 2 / 3 };
const WALL_CENTER = new THREE.Vector3(0, 1.15, -0.9);
const WALL_HEIGHT = 1.62;

const canvasEl = document.getElementById('stage') as HTMLCanvasElement;
const previewEl = document.getElementById('preview') as HTMLButtonElement;
const hintEl = document.getElementById('expanded-hint') as HTMLDivElement;
const trayEl = document.getElementById('tray') as HTMLElement;
const fileEl = document.getElementById('file') as HTMLInputElement;

const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.autoClear = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(STAGE_BG);

const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 60);
camera.position.set(0, 1.2, 3.7);
const orbit = new OrbitControls(camera, canvasEl);
orbit.target.set(0, 1.08, -0.6);
orbit.enableDamping = true;
orbit.update();

scene.add(new THREE.HemisphereLight(0xfff8ef, 0x8f877c, 1.5));
const fill = new THREE.DirectionalLight(0xffffff, 0.9);
fill.position.set(-1.5, 3, 4);
scene.add(fill);

// --- Canvas wall: displays the processed output, unlit -------------------------------------
const state: { mode: StudioMode; aspect: string; outputWidth: number; sway: boolean; preset: string } = {
  mode: 'Photogram',
  aspect: '16:10',
  outputWidth: 1600,
  sway: true,
  preset: 'Stage (UI reference)',
};
const params: StudioParams = { ...DEFAULT_PARAMS };
const halftone: HalftoneParams = { ...DEFAULT_HALFTONE };
const look = (): Look => ({ mode: state.mode, photo: params, halftone });

const pipeline = new ShadowPipeline(renderer);
const wallMaterial = createOutputMaterial(pipeline.output.texture);
const wall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), wallMaterial);
wall.name = 'canvas wall (shows processed output)';
scene.add(wall);

function applyCanvasSize() {
  const a = ASPECTS[state.aspect] ?? 1.6;
  const height = a >= 1 ? Math.min(WALL_HEIGHT, 2.7 / a) : WALL_HEIGHT;
  const width = height * a;
  wall.position.copy(WALL_CENTER);
  wall.scale.set(width, height, 1);
  const w = state.outputWidth;
  pipeline.setCanvas({ center: WALL_CENTER.clone(), width, height }, new THREE.Vector2(w, Math.round(w / a)));
  layoutPreview();
}

// --- Light: flat yellow billboard disc driving a spotlight aimed at the canvas ---------------
const disc = new THREE.Mesh(
  new THREE.CircleGeometry(1, 48),
  new THREE.MeshBasicMaterial({ color: DISC_COLOR, toneMapped: false }),
);
disc.name = 'light disc';
disc.position.set(0.42, 1.05, 1.45);
scene.add(disc);
const spot = new THREE.SpotLight(0xfff1d6, 2.2, 0, Math.PI / 3, 0.6, 0);
spot.target.position.copy(WALL_CENTER);
scene.add(spot, spot.target);

// --- Flowers -------------------------------------------------------------------------------
const flowerRoot = new THREE.Group();
flowerRoot.name = 'flowers';
scene.add(flowerRoot);
const set = new FlowerSet(flowerRoot);

const DEFAULT_COMPOSITION: SavedFlower[] = [
  { type: 'iris', settings: { seed: 3, openness: 0.8, stemLean: 0.05, bend: 1.2, stemHeight: 1.1, scale: 1 }, position: [-0.95, 0, 0.75], rotation: [0, 0.4, 0], scale: [1.35, 1.35, 1.35] },
  { type: 'carnation', settings: { seed: 1, openness: 0.85, stemLean: -0.04, bend: 1, stemHeight: 1.05, scale: 1 }, position: [-0.7, 0, 0.35], rotation: [0, -0.3, 0], scale: [1.3, 1.3, 1.3] },
  { type: 'leaves', settings: { seed: 2, openness: 0.7, stemLean: 0.03, bend: 1, stemHeight: 1, scale: 1 }, position: [-0.05, 0, 0.2], rotation: [0, 0.2, 0], scale: [1.15, 1.15, 1.15] },
  { type: 'iris', settings: { seed: 7, openness: 0.9, stemLean: -0.08, bend: 1.4, stemHeight: 1.15, scale: 1 }, position: [0.2, 0, 0.55], rotation: [0, -0.5, 0], scale: [1.25, 1.25, 1.25] },
  { type: 'carnation', settings: { seed: 5, openness: 0.75, stemLean: 0.06, bend: 1.3, stemHeight: 1.1, scale: 1 }, position: [0.4, 0, 0.1], rotation: [0, 0.6, 0], scale: [1.2, 1.2, 1.2] },
  { type: 'iris', settings: { seed: 11, openness: 0.95, stemLean: 0.02, bend: 0.8, stemHeight: 1, scale: 1 }, position: [-0.32, 0, 0.62], rotation: [0, 1.1, 0], scale: [1.2, 1.2, 1.2] },
  { type: 'leaves', settings: { seed: 9, openness: 0.6, stemLean: -0.05, bend: 1.2, stemHeight: 1, scale: 1 }, position: [0.72, 0, 0.62], rotation: [0, -0.8, 0], scale: [1.1, 1.1, 1.1] },
  { type: 'carnation', settings: { seed: 4, openness: 0.95, stemLean: 0.1, bend: 1.5, stemHeight: 1.15, scale: 1 }, position: [1.05, 0.12, -0.72], rotation: [0, 2.2, 0], scale: [1.1, 1.1, 1.1] },
];

// --- Gizmos and selection --------------------------------------------------------------------
const flowerGizmo = new TransformControls(camera, canvasEl);
flowerGizmo.setSize(1.1);
scene.add(flowerGizmo.getHelper());
const lightGizmo = new TransformControls(camera, canvasEl);
lightGizmo.setMode('translate');
lightGizmo.setSize(0.6);
scene.add(lightGizmo.getHelper());
for (const g of [flowerGizmo, lightGizmo]) {
  g.addEventListener('dragging-changed', (e) => {
    orbit.enabled = !(e as unknown as { value: boolean }).value;
  });
  g.addEventListener('mouseUp', () => commit());
}

/** Every selected flower; `selected` is the most recently picked one. */
let selection: FlowerInstance[] = [];
let selected: FlowerInstance | null = null;
let lightSelected = false;

// Several flowers move together by riding a temporary pivot at their centre (stem-base height).
const groupPivot = new THREE.Group();
groupPivot.name = 'selection.pivot';
flowerRoot.add(groupPivot);

function releaseGroup() {
  for (const w of [...groupPivot.children]) flowerRoot.attach(w);
  groupPivot.position.set(0, 0, 0);
  groupPivot.rotation.set(0, 0, 0);
  groupPivot.scale.set(1, 1, 1);
  groupPivot.updateMatrixWorld();
}

function setSelection(list: FlowerInstance[]) {
  releaseGroup();
  selection = [...new Set(list)];
  selected = selection[selection.length - 1] ?? null;
  lightSelected = false;
  lightGizmo.detach();
  if (selection.length === 0) flowerGizmo.detach();
  else if (selection.length === 1) flowerGizmo.attach(selection[0].wrapper);
  else {
    const centre = new THREE.Vector3();
    let minY = Infinity;
    for (const inst of selection) {
      const p = inst.wrapper.getWorldPosition(new THREE.Vector3());
      centre.add(p);
      minY = Math.min(minY, p.y);
    }
    centre.divideScalar(selection.length);
    centre.y = minY;
    groupPivot.position.copy(centre);
    groupPivot.updateMatrixWorld();
    for (const inst of selection) groupPivot.attach(inst.wrapper);
    flowerGizmo.attach(groupPivot);
  }
  syncFlowerPanel();
}

function select(inst: FlowerInstance | null) {
  setSelection(inst ? [inst] : []);
}

function selectAll() {
  setSelection([...set.instances]);
}

function selectLight() {
  setSelection([]);
  lightSelected = true;
  flowerGizmo.detach();
  lightGizmo.attach(disc);
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt: { x: number; y: number } | null = null;
let discDrag: { plane: THREE.Plane; offset: THREE.Vector3 } | null = null;

function setPointer(e: PointerEvent) {
  const r = canvasEl.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
}

canvasEl.addEventListener('pointerdown', (e) => {
  if (expanded) return;
  if (flowerGizmo.axis !== null || lightGizmo.axis !== null) return;
  setPointer(e);
  const hit = raycaster.intersectObject(disc, false)[0];
  if (hit) {
    selectLight();
    const normal = camera.getWorldDirection(new THREE.Vector3());
    discDrag = { plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, disc.position), offset: disc.position.clone().sub(hit.point) };
    orbit.enabled = false;
    canvasEl.setPointerCapture(e.pointerId);
    return;
  }
  downAt = { x: e.clientX, y: e.clientY };
});

canvasEl.addEventListener('pointermove', (e) => {
  if (!discDrag) return;
  setPointer(e);
  const p = raycaster.ray.intersectPlane(discDrag.plane, new THREE.Vector3());
  if (p) disc.position.copy(p.add(discDrag.offset));
});

canvasEl.addEventListener('pointerup', (e) => {
  if (discDrag) {
    discDrag = null;
    orbit.enabled = true;
    commit();
    return;
  }
  if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) {
    downAt = null;
    return;
  }
  downAt = null;
  setPointer(e);
  const hit = raycaster.intersectObject(flowerRoot, true)[0];
  const id = hit?.object.userData.flowerId as number | undefined;
  const inst = id ? set.find(id) ?? null : null;
  if (e.shiftKey) {
    if (inst) setSelection(selection.includes(inst) ? selection.filter((x) => x !== inst) : [...selection, inst]);
  } else select(inst);
});

// --- Mini preview + fullscreen export view ---------------------------------------------------
const previewScene = new THREE.Scene();
const previewMaterial = createOutputMaterial(pipeline.output.texture, true);
const previewQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), previewMaterial);
previewQuad.frustumCulled = false;
previewScene.add(previewQuad);
const quadCam = new THREE.Camera();
let expanded = false;
const previewRect = { x: 0, y: 0, w: 300, h: 188 };

function layoutPreview() {
  const a = pipeline.basePx.x / pipeline.basePx.y;
  const maxW = 300;
  const maxH = 220;
  let w = maxW;
  let h = w / a;
  if (h > maxH) { h = maxH; w = h * a; }
  previewRect.w = Math.round(w);
  previewRect.h = Math.round(h);
  previewRect.x = window.innerWidth - previewRect.w - 20;
  previewRect.y = window.innerHeight - previewRect.h - 20;
  Object.assign(previewEl.style, { width: `${previewRect.w}px`, height: `${previewRect.h}px` });
}

function setExpanded(v: boolean) {
  expanded = v;
  document.body.classList.toggle('expanded', v);
  hintEl.hidden = !v;
}
previewEl.addEventListener('click', () => setExpanded(true));
hintEl.addEventListener('click', () => setExpanded(false));
canvasEl.addEventListener('click', () => { if (expanded) setExpanded(false); });

function drawOutputRect(x: number, y: number, w: number, h: number, radius: number) {
  const dpr = renderer.getPixelRatio();
  renderer.setViewport(x, window.innerHeight - y - h, w, h);
  renderer.setScissor(x, window.innerHeight - y - h, w, h);
  renderer.setScissorTest(true);
  previewMaterial.uniforms.sizePx.value.set(w * dpr, h * dpr);
  previewMaterial.uniforms.radiusPx.value = radius * dpr;
  renderer.render(previewScene, quadCam);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
}

// --- Tray ------------------------------------------------------------------------------------
function buildTray() {
  const thumbs = renderThumbnails(renderer);
  trayEl.innerHTML = '';
  for (const f of flowers) {
    const b = document.createElement('button');
    b.className = 'tray-item';
    b.title = `Add ${f.label}`;
    b.innerHTML = `<img alt="" src="${thumbs[f.id]}"><span>${f.label}</span>`;
    b.addEventListener('click', () => {
      const s = 1.25 + Math.random() * 0.3;
      const inst = set.add(f.id, { seed: Math.floor(Math.random() * 9999) }, {
        position: [(Math.random() - 0.5) * 1.4, 0, Math.random() * 0.6],
        rotation: [0, Math.random() * Math.PI * 2, 0],
        scale: [s, s, s],
      });
      select(inst);
      commit();
    });
    trayEl.appendChild(b);
  }
}

// --- Composition helpers ---------------------------------------------------------------------
function randomize() {
  set.clear();
  const n = 3 + Math.floor(Math.random() * 10);
  for (let i = 0; i < n; i++) {
    const f = flowers[Math.floor(Math.random() * flowers.length)];
    const s = 1.1 + Math.random() * 0.55;
    set.add(f.id, {
      seed: Math.floor(Math.random() * 9999),
      openness: 0.45 + Math.random() * 0.55,
      stemLean: (Math.random() - 0.5) * 0.5,
      bend: 0.5 + Math.random() * 1.2,
      stemHeight: 0.85 + Math.random() * 0.35,
      scale: 1,
    }, {
      position: [(Math.random() - 0.5) * 2.4, 0, -0.45 + Math.random() * 1.35],
      rotation: [0, Math.random() * Math.PI * 2, 0],
      scale: [s, s, s],
    });
  }
  select(null);
  commit();
}

type SceneFile = {
  version: 1;
  canvas: { aspect: string; outputWidth: number };
  light: [number, number, number];
  sway: boolean;
  preset: string;
  mode?: StudioMode;
  params: StudioParams;
  halftone?: HalftoneParams;
  flowers: SavedFlower[];
};

function serialize(): SceneFile {
  return {
    version: 1,
    canvas: { aspect: state.aspect, outputWidth: state.outputWidth },
    light: disc.position.toArray() as [number, number, number],
    sway: state.sway,
    preset: state.preset,
    mode: state.mode,
    params: { ...params },
    halftone: { ...halftone },
    flowers: set.serialize(),
  };
}

function load(file: SceneFile) {
  state.aspect = file.canvas?.aspect ?? state.aspect;
  state.outputWidth = file.canvas?.outputWidth ?? state.outputWidth;
  state.sway = file.sway ?? state.sway;
  state.preset = file.preset ?? state.preset;
  // Ignore keys from older saves (e.g. the removed halftone settings).
  const saved = (file.params ?? {}) as Partial<StudioParams>;
  const known = Object.fromEntries(Object.entries(saved).filter(([k]) => k in DEFAULT_PARAMS));
  Object.assign(params, DEFAULT_PARAMS, known);
  for (const k of Object.keys(params)) if (!(k in DEFAULT_PARAMS)) delete (params as Record<string, unknown>)[k];
  state.mode = file.mode ?? 'Photogram';
  const savedHt = (file.halftone ?? {}) as Partial<HalftoneParams>;
  Object.assign(halftone, DEFAULT_HALFTONE, Object.fromEntries(Object.entries(savedHt).filter(([k]) => k in DEFAULT_HALFTONE)));
  if (file.light) disc.position.set(...file.light);
  set.load(file.flowers ?? []);
  select(null);
  applyCanvasSize();
  refreshGui();
  applyMode();
}

// --- Undo / redo: whole-scene snapshots recorded after each finished edit -------------------
const HISTORY_LIMIT = 100;
let history: string[] = [];
let historyIndex = -1;
let restoring = false;

function commit() {
  if (restoring) return;
  const snapshot = JSON.stringify(serialize());
  if (history[historyIndex] === snapshot) return;
  history = history.slice(0, historyIndex + 1);
  history.push(snapshot);
  if (history.length > HISTORY_LIMIT) history.shift();
  historyIndex = history.length - 1;
}

function restore(snapshot: string) {
  const indices = selection.map((inst) => set.instances.indexOf(inst));
  const wasLight = lightSelected;
  restoring = true;
  load(JSON.parse(snapshot) as SceneFile);
  restoring = false;
  if (wasLight) selectLight();
  else setSelection(indices.map((i) => set.instances[i]).filter((inst): inst is FlowerInstance => !!inst));
}

function undo() {
  if (historyIndex <= 0) return;
  historyIndex--;
  restore(history[historyIndex]);
}

function redo() {
  if (historyIndex >= history.length - 1) return;
  historyIndex++;
  restore(history[historyIndex]);
}

const STORAGE_KEY = 'shadow-studio.scene';
function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

fileEl.addEventListener('change', async () => {
  const f = fileEl.files?.[0];
  if (!f) return;
  try {
    load(JSON.parse(await f.text()) as SceneFile);
    commit();
  } catch (err) {
    console.warn('Could not load scene file', err);
  }
  fileEl.value = '';
});

// --- GUI -------------------------------------------------------------------------------------
// Two independent, collapsible panels stacked top-right.
const panelStack = document.createElement('div');
panelStack.className = 'panel-stack';
document.body.appendChild(panelStack);
const gui = new GUI({ title: 'Shadow Studio', container: panelStack });
const htGui = new GUI({ title: 'Halftone Studio', container: panelStack });
htGui.close();
// Scene, export/file and shortcuts live in their own stack on the left.
const leftStack = document.createElement('div');
leftStack.className = 'panel-stack left';
document.body.appendChild(leftStack);
const sceneGui = new GUI({ title: 'Scene', container: leftStack });
const exportGui = new GUI({ title: 'Export & file', container: leftStack });
const infoGui = new GUI({ title: 'Shortcuts', container: leftStack });
exportGui.close();
infoGui.close();
const allGuis = [gui, htGui, sceneGui, exportGui, infoGui];
function refreshGui() {
  for (const g of allGuis) g.controllersRecursive().forEach((c) => c.updateDisplay());
}
const actions = {
  randomize,
  randomPalette: () => {
    Object.assign(params, randomPalette());
    refreshGui();
    commit();
  },
  reset: () => {
    Object.assign(params, DEFAULT_PARAMS, PRESETS[state.preset] ?? {});
    refreshGui();
    commit();
  },
  export1: () => exportPng(1),
  export2: () => exportPng(2),
  export4: () => exportPng(4),
  save: () => { localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize())); },
  loadLocal: () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      load(JSON.parse(raw) as SceneFile);
      commit();
    }
  },
  downloadJson: () => download(new Blob([JSON.stringify(serialize(), null, 2)], { type: 'application/json' }), 'shadow-scene.json'),
  openJson: () => fileEl.click(),
};

gui.onFinishChange(() => commit());
htGui.onFinishChange(() => commit());
sceneGui.onFinishChange(() => commit());
exportGui.onFinishChange(() => commit());
const sceneFolder = sceneGui;
sceneFolder.add(actions, 'randomize').name('Randomize composition');
sceneFolder.add({ selectAll }, 'selectAll').name('Select all flowers (⌘/Ctrl+A)');
sceneFolder.add(state, 'sway').name('Slow sway');
const photoLight = [
  sceneFolder.add(params, 'lightSize', 0.01, 0.3, 0.005).name('Light size'),
  sceneFolder.add(params, 'softness', 0.2, 3, 0.05).name('Shadow softness'),
];
sceneFolder.add(params, 'translucency', 0, 1, 0.01).name('Petal translucency');
sceneFolder.add(params, 'veinDetail', 0, 1, 0.01).name('Vein detail');
sceneFolder.add(state, 'aspect', Object.keys(ASPECTS)).name('Canvas aspect').onChange(applyCanvasSize);
sceneFolder.add(state, 'outputWidth', [1200, 1600, 2000, 2400]).name('Canvas width px').onChange(applyCanvasSize);

const presetCtrl = gui.add(state, 'preset', Object.keys(PRESETS)).name('Preset').onChange((name: string) => {
  Object.assign(params, DEFAULT_PARAMS, PRESETS[name]);
  refreshGui();
  commit();
});
const paletteCtrl = gui.add(actions, 'randomPalette').name('Randomize palette');
const inverseCtrl = gui.add(params, 'inverse', 0, 1, 0.01).name('Inverse');

const color = gui.addFolder('Color');
color.close();
color.addColor(params, 'paper').name('Paper');
color.addColor(params, 'rampLight').name('Ramp: light');
color.addColor(params, 'rampMid').name('Ramp: mid');
color.addColor(params, 'rampDeep').name('Ramp: deep');
color.add(params, 'midPosition', 0.1, 0.9, 0.01).name('Mid position');
color.add(params, 'density', 0, 1.5, 0.01).name('Shadow density');
color.add(params, 'hue', -180, 180, 1).name('Hue');
color.add(params, 'saturation', 0, 2, 0.01).name('Saturation');
color.add(params, 'brightness', -0.5, 0.5, 0.01).name('Brightness');
color.add(params, 'contrast', 0.3, 2, 0.01).name('Contrast');
color.add(params, 'gamma', 0.3, 2.5, 0.01).name('Gamma');
color.add(params, 'blackPoint', 0, 0.5, 0.01).name('Black point');
color.add(params, 'whitePoint', 0.5, 1, 0.01).name('White point');
color.add(params, 'temperature', -1, 1, 0.01).name('Temperature');
color.add(params, 'tint', -1, 1, 0.01).name('Tint');

const eph = gui.addFolder('Ephemeral');
eph.add(params, 'extraBlur', 0, 1, 0.01).name('Extra blur (by depth)');
eph.add(params, 'blurFalloff', 0.3, 3, 0.05).name('Depth falloff');
eph.add(params, 'bloom', 0, 1, 0.01).name('Bloom / glow');
eph.add(params, 'ghost', 0, 1, 0.01).name('Ghosting');
eph.add(params, 'ghostOffset', 0, 80, 1).name('Ghost offset px');
eph.add(params, 'ghostAngle', -180, 180, 1).name('Ghost angle');
eph.add(params, 'misregister', 0, 1, 0.01).name('RGB misregister');
eph.close();

const scan = gui.addFolder('Scan');
scan.add(params, 'grain', 0, 1, 0.01).name('Grain amount');
scan.add(params, 'grainSize', 0.5, 4, 0.1).name('Grain size');
scan.add(params, 'fiber', 0, 1, 0.01).name('Paper fiber');
scan.add(params, 'dust', 0, 1, 0.01).name('Dust');
scan.add(params, 'scratches', 0, 1, 0.01).name('Scratches');
scan.add(params, 'banding', 0, 1, 0.01).name('Scanner banding');
scan.add(params, 'unevenLight', 0, 1, 0.01).name('Uneven light');
scan.add(params, 'vignette', 0, 1, 0.01).name('Vignette');
scan.add(params, 'scanRotation', -3, 3, 0.05).name('Scan rotation °');
scan.add(params, 'border', 0, 0.1, 0.001).name('Scan border');
scan.addColor(params, 'castColor').name('Color cast');
scan.add(params, 'cast', 0, 1, 0.01).name('Cast amount');
scan.close();

const ht = htGui;
const outputSwitch = {
  get on() { return state.mode === 'Halftone'; },
  set on(v: boolean) { state.mode = v ? 'Halftone' : 'Photogram'; applyMode(); },
};
ht.add(outputSwitch, 'on').name('Output halftone');
ht.add(halftone, 'edges', [...HALFTONE_EDGES]).name('Edges').onChange(() => applyMode());
const edgeBlurCtrl = ht.add(halftone, 'edgeBlur', 0, 1, 0.01).name('Edge blur');
ht.add(halftone, 'style', [...HALFTONE_STYLES]).name('Style').onChange(() => applyMode());
const dotCtrls = [
  ht.add(halftone, 'dotSize', 0.1, 3, 0.01).name('Dot size'),
  ht.add(halftone, 'minDot', 0.5, 12, 0.5).name('Min dot px'),
  ht.add(halftone, 'ringBelow', 0, 0.6, 0.01).name('Rings below tone'),
];
ht.add(halftone, 'cellSize', 3, 80, 0.5).name('Cell size px');
ht.add(halftone, 'angle', 0, 90, 1).name('Screen angle °');
ht.add(halftone, 'threshold', 0.05, 0.95, 0.01).name('Threshold');
ht.add(halftone, 'contrast', 0.3, 4, 0.05).name('Contrast');
ht.add(halftone, 'gamma', 0.3, 3, 0.05).name('Gamma');
ht.addColor(halftone, 'ink').name('Ink');
ht.addColor(halftone, 'paper').name('Paper');
ht.add(halftone, 'invert').name('Invert');
ht.add({ reset: () => {
  Object.assign(halftone, DEFAULT_HALFTONE);
  refreshGui();
  commit();
} }, 'reset').name('Reset halftone');

/** Show only the controls that drive the active studio. */
function applyMode() {
  const isHalftone = state.mode === 'Halftone';
  htGui.title(isHalftone ? 'Halftone Studio · on' : 'Halftone Studio');
  edgeBlurCtrl.show(halftone.edges !== 'Exact outline');
  for (const c of dotCtrls) c.show(halftone.style === 'Dots');
  for (const f of [color, eph, scan]) f.show(!isHalftone);
  for (const c of [presetCtrl, paletteCtrl, inverseCtrl, ...photoLight]) c.show(!isHalftone);
}
applyMode();

const flowerFolder = gui.addFolder('Selected flower');
const flowerProxy = { openness: 0.8, stemLean: 0, bend: 1, stemHeight: 1, scale: 1 };
const flowerActions = {
  reseed: () => {
    if (!selection.length) return;
    for (const inst of selection) {
      inst.settings.seed = Math.floor(Math.random() * 99999);
      set.rebuild(inst);
    }
    commit();
  },
  duplicate: () => duplicateSelected(),
  remove: () => deleteSelected(),
};
const flowerControllers: Controller[] = [
  flowerFolder.add(flowerProxy, 'openness', 0, 1, 0.01).name('Openness'),
  flowerFolder.add(flowerProxy, 'stemLean', -0.6, 0.6, 0.01).name('Stem lean'),
  flowerFolder.add(flowerProxy, 'bend', 0, 2.5, 0.01).name('Bend'),
  flowerFolder.add(flowerProxy, 'stemHeight', 0.5, 1.6, 0.01).name('Stem height'),
  flowerFolder.add(flowerProxy, 'scale', 0.4, 2, 0.01).name('Scale'),
];
for (const c of flowerControllers) {
  // With several flowers selected, a slider sets only its own property on each of them.
  const key = c.property as keyof typeof flowerProxy;
  c.onChange((v: number) => {
    for (const inst of selection) {
      inst.settings[key] = v;
      set.rebuild(inst);
    }
  });
}
flowerFolder.add(flowerActions, 'reseed').name('Reseed');
flowerFolder.add(flowerActions, 'duplicate').name('Duplicate (⌘/Ctrl+D)');
flowerFolder.add(flowerActions, 'remove').name('Delete (Backspace)');

function syncFlowerPanel() {
  if (!selected) {
    flowerFolder.hide();
    return;
  }
  flowerFolder.show();
  flowerFolder.title(selection.length > 1 ? `Selected: ${selection.length} flowers` : `Selected: ${set.entry(selected.type).label}`);
  Object.assign(flowerProxy, {
    openness: selected.settings.openness,
    stemLean: selected.settings.stemLean,
    bend: selected.settings.bend,
    stemHeight: selected.settings.stemHeight,
    scale: selected.settings.scale,
  });
  flowerControllers.forEach((c) => c.updateDisplay());
}

const out = exportGui;
out.add(actions, 'export1').name('Export PNG 1×');
out.add(actions, 'export2').name('Export PNG 2×');
out.add(actions, 'export4').name('Export PNG 4×');
out.add({ undo }, 'undo').name('Undo');
out.add({ redo }, 'redo').name('Redo');
out.add(actions, 'reset').name('Reset look');
out.add(actions, 'save').name('Save scene (browser)');
out.add(actions, 'loadLocal').name('Load scene (browser)');
out.add(actions, 'downloadJson').name('Download scene JSON');
out.add(actions, 'openJson').name('Open scene JSON…');

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl';
const SHORTCUTS: [string, string][] = [
  ['Click flower', 'Select it'],
  ['Shift-click flower', 'Add / remove from selection'],
  [`${mod} A`, 'Select all flowers (move together)'],
  ['Click empty space', 'Deselect'],
  ['V', 'Select / move tool'],
  ['R', 'Rotate tool'],
  ['K', 'Scale tool'],
  [`${mod} D`, 'Duplicate selected flower'],
  [`${mod} Z`, 'Undo'],
  [isMac ? '⌘ ⇧ Z' : 'Ctrl Y / Ctrl ⇧ Z', 'Redo'],
  ['Backspace / Delete', 'Delete selected flower'],
  ['Esc', 'Deselect / close fullscreen'],
  ['Drag yellow disc', 'Move the light'],
  ['Click preview', 'Fullscreen canvas output'],
  ['Drag', 'Orbit camera'],
  ['Right-drag', 'Pan camera'],
  ['Scroll', 'Zoom camera'],
  ['?', 'Open this list'],
];
const info = infoGui;
const list = document.createElement('dl');
list.className = 'shortcuts';
list.innerHTML = SHORTCUTS.map(([k, v]) => `<dt><kbd>${k}</kbd></dt><dd>${v}</dd>`).join('');
info.$children.appendChild(list);
function openInfo() {
  info.open();
  info.domElement.scrollIntoView({ block: 'nearest' });
}
if (location.hash === '#info') openInfo();

let exporting = false;
async function exportPng(scale: number) {
  if (exporting) return;
  exporting = true;
  try {
    const blob = await pipeline.exportPNG(scene, disc.position, look(), elapsed, scale);
    lastExport = blob;
    download(blob, `shadow-${pipeline.basePx.x * scale}x${pipeline.basePx.y * scale}.png`);
  } finally {
    exporting = false;
  }
}
let lastExport: Blob | null = null;

// --- Keyboard --------------------------------------------------------------------------------
function duplicateSelected() {
  if (!selection.length) return;
  const sources = [...selection];
  releaseGroup();
  setSelection(sources.map((inst) => set.duplicate(inst)));
  commit();
}
function deleteSelected() {
  if (!selection.length) return;
  const doomed = [...selection];
  setSelection([]);
  doomed.forEach((inst) => set.remove(inst));
  commit();
}
window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
  const key = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && key === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  } else if (e.ctrlKey && !e.metaKey && key === 'y') {
    e.preventDefault();
    redo();
  } else if ((e.metaKey || e.ctrlKey) && key === 'a') {
    e.preventDefault();
    selectAll();
  } else if ((e.metaKey || e.ctrlKey) && key === 'd') {
    e.preventDefault();
    duplicateSelected();
  } else if (key === 'backspace' || key === 'delete') {
    e.preventDefault();
    deleteSelected();
  } else if (e.metaKey || e.ctrlKey || e.altKey) {
    return;
  } else if (key === 'v') flowerGizmo.setMode('translate');
  else if (key === 'r') flowerGizmo.setMode('rotate');
  else if (key === 'k') flowerGizmo.setMode('scale');
  else if (e.key === '?') openInfo();
  else if (key === 'escape') {
    if (expanded) setExpanded(false);
    else select(null);
  }
});

// --- Resize + loop ---------------------------------------------------------------------------
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  layoutPreview();
}
window.addEventListener('resize', resize);

let elapsed = 0;
const timer = new THREE.Timer();
const frameTimes: number[] = [];

function frame(timestamp: number) {
  timer.update(timestamp);
  const dt = Math.min(timer.getDelta(), 0.1);
  elapsed += dt;
  frameTimes.push(dt);
  if (frameTimes.length > 120) frameTimes.shift();
  if (state.sway) set.tick(elapsed);

  disc.quaternion.copy(camera.quaternion);
  disc.scale.setScalar(Math.max(params.lightSize, 0.02));
  spot.position.copy(disc.position);
  orbit.update();

  pipeline.update(scene, disc.position, look(), elapsed);

  renderer.setRenderTarget(null);
  renderer.setClearColor(expanded ? 0x1d1b19 : STAGE_BG, 1);
  renderer.clear();
  if (expanded) {
    const a = pipeline.basePx.x / pipeline.basePx.y;
    const maxW = window.innerWidth - 80;
    const maxH = window.innerHeight - 100;
    const w = Math.min(maxW, maxH * a);
    const h = w / a;
    drawOutputRect((window.innerWidth - w) / 2, (window.innerHeight - h) / 2, w, h, 0);
  } else {
    renderer.render(scene, camera);
    renderer.clearDepth();
    drawOutputRect(previewRect.x, previewRect.y, previewRect.w, previewRect.h, 14);
  }
}

// --- Boot ------------------------------------------------------------------------------------
resize();
applyCanvasSize();
buildTray();
set.load(DEFAULT_COMPOSITION);
select(set.instances[set.instances.length - 1] ?? null);
commit();
renderer.setAnimationLoop(frame);

Object.assign(window as unknown as Record<string, unknown>, {
  __studio: {
    scene, camera, renderer, pipeline, set, params, state, disc,
    get fps() {
      const avg = frameTimes.reduce((a, b) => a + b, 0) / Math.max(frameTimes.length, 1);
      return avg > 0 ? 1 / avg : 0;
    },
    get lastExport() { return lastExport; },
    exportPng: (scale: number) => pipeline.exportPNG(scene, disc.position, look(), elapsed, scale),
    halftone,
    setMode: (m: StudioMode) => {
      state.mode = m;
      refreshGui();
      applyMode();
    },
    select: (i: number) => select(set.instances[i] ?? null),
    selectAll,
    get selectionSize() { return selection.length; },
    selectLight,
    randomize,
    randomPalette: actions.randomPalette,
    undo,
    redo,
    get historyDepth() { return { index: historyIndex, length: history.length }; },
    serialize,
    load,
  },
});
