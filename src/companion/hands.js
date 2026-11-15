/**
 * 4.19: your hands drawn in the headset (so they never vanish in full VR): a ball at each joint and a
 * bone between, soft and see-through. Dim while a song plays, bright when it's paused or the menu is
 * open. Two instanced meshes for both hands: nothing new is made per frame.
 */
import * as THREE from '/three/three.module.min.js';
import { BONES } from './handpose.js';

const N = 25;

export function createHandsView(scene) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xdfe6f2, emissive: 0x31404f, roughness: 0.6, metalness: 0, transparent: true, opacity: 0.9, depthWrite: false });
  const balls = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), mat, N * 2);
  const bones = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true), mat, BONES.length * 2);
  for (const m of [balls, bones]) {
    m.frustumCulled = false;
    m.count = 0;
    m.renderOrder = 30; // drawn last (over the menu too), so your hand never disappears behind anything
    scene.add(m);
  }
  const m4 = new THREE.Matrix4();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Quaternion();
  let opacity = 0.9;

  /**
   * hands: [{ on, pts: 75 numbers or null, radii: 25 numbers or null }] (left, right); want: how bright (0–1).
   * dt: seconds since the last frame (the brightness eases).
   */
  function update(hands, want, dt) {
    opacity += (want - opacity) * Math.min(1, dt * 6);
    mat.opacity = opacity;
    let bi = 0;
    let ki = 0;
    for (const h of hands) {
      if (!h || !h.pts || h.on === false) continue; // not seen this frame
      const P = h.pts;
      for (let j = 0; j < N; j++) {
        const r = (h.radii && h.radii[j]) || (j === 0 ? 0.012 : j % 5 === 4 ? 0.0075 : 0.009);
        balls.setMatrixAt(bi++, m4.compose(a.set(P[j * 3], P[j * 3 + 1], P[j * 3 + 2]), one, sc.setScalar(r * 0.95)));
      }
      for (const [i, k] of BONES) {
        a.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
        b.set(P[k * 3], P[k * 3 + 1], P[k * 3 + 2]);
        dir.subVectors(b, a);
        const len = dir.length();
        if (len < 1e-4) continue;
        q.setFromUnitVectors(UP, dir.multiplyScalar(1 / len));
        const r = ((h.radii && h.radii[k]) || 0.008) * 0.55;
        bones.setMatrixAt(ki++, m4.compose(mid.addVectors(a, b).multiplyScalar(0.5), q, sc.set(r, len, r)));
      }
    }
    balls.count = bi;
    bones.count = ki;
    balls.instanceMatrix.needsUpdate = true;
    bones.instanceMatrix.needsUpdate = true;
  }
  return { update, get opacity() { return opacity; }, mat };
}

/** A plain controller shape (when the headset sees controllers instead of hands). */
export function controllerShape() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.5, metalness: 0.2, emissive: 0x0c0f12 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.021, 0.11, 16), mat);
  body.rotation.x = -Math.PI / 2 + 0.5;
  body.position.set(0, -0.012, 0.045);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.038, 0.007, 8, 32), new THREE.MeshStandardMaterial({ color: 0x9aa4ad, roughness: 0.4, metalness: 0.3, emissive: 0x161a1e }));
  ring.position.set(0, 0.012, -0.02);
  ring.rotation.x = -0.6;
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffb547 }));
  light.position.set(0, 0.01, 0.01);
  g.add(body, ring, light);
  return g;
}
