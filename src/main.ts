import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { models, type ModelEntry } from './models/registry';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const bg = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#ece9e4');
scene.background = bg;
scene.fog = new THREE.Fog(bg, 1, 2);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;

const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 200);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x888070, 0.35));

const sun = new THREE.DirectionalLight(0xfff4e6, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshStandardMaterial({ color: 0xf2efe9, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

let current: THREE.Group | null = null;
let modelRadius = 1;
const modelCenter = new THREE.Vector3();

function disposeModel(group: THREE.Group) {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((m) => m.dispose());
  });
}

function loadModel(entry: ModelEntry) {
  if (current) {
    scene.remove(current);
    disposeModel(current);
  }
  current = entry.create();
  current.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) obj.receiveShadow = true;
  });
  scene.add(current);

  // Rest the model on the ground plane and frame it.
  const box = new THREE.Box3().setFromObject(current);
  current.position.y -= box.min.y;
  box.setFromObject(current);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  modelRadius = Math.max(sphere.radius, 0.01);
  modelCenter.copy(sphere.center);

  ground.scale.setScalar(modelRadius * 40);
  const fog = scene.fog as THREE.Fog;
  fog.near = modelRadius * 6;
  fog.far = modelRadius * 16;
  camera.near = modelRadius / 100;
  camera.far = modelRadius * 100;
  camera.position.copy(modelCenter).add(new THREE.Vector3(1, 0.6, 1.4).normalize().multiplyScalar(modelRadius * 3.2));
  camera.updateProjectionMatrix();
  controls.target.copy(modelCenter);
  controls.update();

  const cam = sun.shadow.camera;
  const extent = modelRadius * 3;
  cam.left = -extent; cam.right = extent; cam.top = extent; cam.bottom = -extent;
  cam.near = 0.01; cam.far = modelRadius * 20;
  cam.updateProjectionMatrix();
  placeSun();

  location.hash = `#/model/${entry.id}`;
}

const azimuth = $<HTMLInputElement>('azimuth');
const elevation = $<HTMLInputElement>('elevation');
const softness = $<HTMLInputElement>('softness');
const orbitLight = $<HTMLInputElement>('orbitLight');
const animate = $<HTMLInputElement>('animate');

function placeSun() {
  const az = THREE.MathUtils.degToRad(Number(azimuth.value));
  const el = THREE.MathUtils.degToRad(Number(elevation.value));
  const dist = modelRadius * 8;
  sun.position.set(
    modelCenter.x + Math.cos(el) * Math.sin(az) * dist,
    Math.sin(el) * dist,
    modelCenter.z + Math.cos(el) * Math.cos(az) * dist,
  );
  sun.target.position.copy(modelCenter);
  sun.shadow.radius = Number(softness.value);
  $<HTMLOutputElement>('azimuthOut').value = `${azimuth.value}°`;
  $<HTMLOutputElement>('elevationOut').value = `${elevation.value}°`;
  $<HTMLOutputElement>('softnessOut').value = softness.value;
}
[azimuth, elevation, softness].forEach((el) => el.addEventListener('input', placeSun));

const select = $<HTMLSelectElement>('model');
for (const m of models) select.add(new Option(m.name, m.id));
select.addEventListener('change', () => {
  const entry = models.find((m) => m.id === select.value);
  if (entry) loadModel(entry);
});

const fromHash = location.hash.match(/#\/model\/(.+)$/)?.[1];
const initial = models.find((m) => m.id === fromHash) ?? models[models.length - 1];
select.value = initial.id;
loadModel(initial);

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
let elapsed = 0;
renderer.setAnimationLoop(() => {
  const delta = clock.getDelta();
  if (orbitLight.checked) {
    azimuth.value = String((Number(azimuth.value) + delta * 20) % 360);
    placeSun();
  }
  if (animate.checked && current) {
    elapsed += delta;
    // Viewer tick contract: tick(elapsedSeconds, deltaSeconds). Re-walked each frame so
    // ticks on nested groups added after load are not missed.
    current.traverse((obj) => {
      const tick = obj.userData.tick;
      if (typeof tick === 'function') tick(elapsed, delta);
    });
  }
  controls.update();
  renderer.render(scene, camera);
});

// Exposed for img2threejs screenshot / mesh-export tooling.
(window as unknown as Record<string, unknown>).__shadows = { scene, camera, renderer, sun, ready: true };
