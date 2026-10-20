import * as THREE from 'three';

// Hand-written placeholder so the viewer has something to light before the first
// img2threejs reconstruction lands. Not generated from a reference image.

export type SampleSculptureOptions = { castShadow?: boolean };

export function createSampleSculptureModel(options: SampleSculptureOptions = {}): THREE.Group {
  const castShadow = options.castShadow ?? true;
  const root = new THREE.Group();
  root.name = 'SampleSculpture';

  const stone = new THREE.MeshStandardMaterial({ color: 0xd9d4cb, roughness: 0.85 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb08d57, roughness: 0.35, metalness: 0.9 });

  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 0.3, 48), stone);
  plinth.position.y = 0.15;
  root.add(plinth);

  const spinPivot = new THREE.Group();
  spinPivot.name = 'spinPivot';
  spinPivot.position.y = 1.05;
  root.add(spinPivot);

  const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.42, 0.07, 220, 20, 2, 5), brass);
  spinPivot.add(knot);

  const ringCount = 7;
  for (let i = 0; i < ringCount; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.012, 8, 96), brass);
    ring.rotation.y = (i / ringCount) * Math.PI;
    spinPivot.add(ring);
  }

  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      obj.castShadow = castShadow;
      obj.receiveShadow = true;
    }
  });

  root.userData.pivots = { spin: spinPivot };
  root.userData.tick = (elapsed: number) => {
    spinPivot.rotation.y = elapsed * 0.35;
    knot.rotation.x = Math.sin(elapsed * 0.5) * 0.25;
  };

  return root;
}
