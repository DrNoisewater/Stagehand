/**
 * 4.19: the guitar outline: in full VR (your room hidden) a calm drawing of a neck where your real guitar
 * is (real fret spacing, strings, frets, side dots, a few fret numbers), with the frets your hand should
 * be on lit, and the notes being played now as small dots. Look down and you know where you are.
 * Guitar (6 strings, 648 mm) or bass (4 or 5 strings, 864 mm), from the part.
 */
import * as THREE from '/three/three.module.min.js';
import { neckLayout, stringAcross } from './place.js';

const SHOWN = [1, 3, 5, 7, 9, 12, 15, 17, 19, 21];

function label(text, size, color) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d');
  g.font = '800 46px Archivo, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,.7)';
  g.strokeText(text, 64, 34);
  g.fillStyle = color;
  g.fillText(text, 64, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size * 2, size).rotateX(Math.PI), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
  m.userData.draw = (col) => {
    g.clearRect(0, 0, 128, 64);
    g.strokeText(text, 64, 34);
    g.fillStyle = col;
    g.fillText(text, 64, 34);
    t.needsUpdate = true;
  };
  return m;
}

export function createGuitarOutline({ colors }) {
  const root = new THREE.Group(); // where the guitar is: moved and turned from the menu
  const tilt = new THREE.Group(); // the board's face turned up towards you
  root.add(tilt);
  let built = null;
  let layout = null;
  const lit = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateY(Math.PI),
    new THREE.MeshBasicMaterial({ color: 0x3fe0ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  const litEdges = [0, 1].map(() => new THREE.Mesh(new THREE.BoxGeometry(0.0022, 1, 0.003), new THREE.MeshBasicMaterial({ color: 0x9ff3ff, transparent: true, opacity: 0.9 })));
  const DOTS = 12;
  const dots = new THREE.InstancedMesh(new THREE.CircleGeometry(0.0055, 16).rotateY(Math.PI), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, depthWrite: false }), DOTS);
  dots.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(DOTS * 3), 3);
  dots.frustumCulled = false;
  dots.count = 0;
  const numbers = new Map();
  tilt.add(lit, ...litEdges, dots);

  function build(strings) {
    if (built) {
      tilt.remove(built);
      built.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
    }
    layout = neckLayout(strings);
    const L = layout;
    const g = new THREE.Group();
    // the board: wider towards the body, dark wood, soft edges
    const x0 = L.at(0);
    const x1 = L.at(L.frets) + 0.012;
    const shape = new THREE.Shape();
    shape.moveTo(x0, -L.width(x0) / 2);
    shape.lineTo(x1, -L.width(x1) / 2);
    shape.lineTo(x1, L.width(x1) / 2);
    shape.lineTo(x0, L.width(x0) / 2);
    shape.closePath();
    const board = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: 0x1b1612, transparent: true, opacity: 0.82, side: THREE.DoubleSide, depthWrite: false }));
    board.position.z = 0.001;
    g.add(board);
    // its two long edges, so it reads against a dark venue
    for (const sgn of [-1, 1]) {
      const len = Math.hypot(x1 - x0, (L.width(x1) - L.width(x0)) / 2);
      const e = new THREE.Mesh(new THREE.BoxGeometry(len, 0.0016, 0.002), new THREE.MeshBasicMaterial({ color: 0xb3a38c, transparent: true, opacity: 0.9 }));
      e.position.set((x0 + x1) / 2, (sgn * (L.width(x0) + L.width(x1))) / 4, -0.0005);
      e.rotation.z = (sgn * Math.atan2((L.width(x1) - L.width(x0)) / 2, x1 - x0));
      g.add(e);
    }
    // the nut and the frets
    const fretMat = new THREE.MeshBasicMaterial({ color: 0xb9c0c8 });
    const frets = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), fretMat, L.frets + 1);
    const m4 = new THREE.Matrix4();
    const one = new THREE.Quaternion();
    for (let n = 0; n <= L.frets; n++) {
      const x = L.wires[n];
      frets.setMatrixAt(n, m4.compose(new THREE.Vector3(x, 0, -0.0012), one, new THREE.Vector3(n === 0 ? 0.005 : 0.0018, L.width(x), 0.0018)));
      frets.setColorAt(n, new THREE.Color(n === 0 ? 0xf2ead8 : 0xaeb6bf));
    }
    g.add(frets);
    // side dots (two at 12) in the middle of the board
    const inlayMat = new THREE.MeshBasicMaterial({ color: 0xe9dfc8, transparent: true, opacity: 0.55, depthWrite: false });
    const inlayGeo = new THREE.CircleGeometry(0.0042, 16).rotateY(Math.PI);
    for (const n of L.dots) {
      const x = L.mids[n - 1];
      for (const y of n === 12 ? [-L.width(x) * 0.22, L.width(x) * 0.22] : [0]) {
        const d = new THREE.Mesh(inlayGeo, inlayMat);
        d.position.set(x, y, -0.0008);
        g.add(d);
      }
    }
    // the strings: thin, the low one (nearest you) thickest, in the highway's string colours, quiet
    for (let s = 0; s < L.strings; s++) {
      const ax = x0;
      const bx = x1 - 0.004;
      const ay = stringAcross(L, s, ax);
      const by = stringAcross(L, s, bx);
      const len = Math.hypot(bx - ax, by - ay);
      const th = (L.bass ? 0.0016 : 0.0011) * (1.25 - (s / Math.max(1, L.strings - 1)) * 0.5);
      const col = new THREE.Color(colors[s] || '#ffffff').lerp(new THREE.Color(0xd8dde4), 0.55);
      const str = new THREE.Mesh(new THREE.BoxGeometry(len, th, th), new THREE.MeshBasicMaterial({ color: col }));
      str.position.set((ax + bx) / 2, (ay + by) / 2, -0.0032);
      str.rotation.z = Math.atan2(by - ay, bx - ax);
      g.add(str);
    }
    // fret numbers along the edge nearest you
    numbers.clear();
    for (const n of SHOWN) {
      if (n > L.frets) continue;
      const x = L.mids[n - 1];
      const m = label(String(n), 0.02, '#b8cad3');
      m.position.set(x, L.width(x) / 2 + 0.017, -0.001);
      g.add(m);
      numbers.set(n, m);
    }
    built = g;
    tilt.add(g);
  }

  let litKey = '';
  /**
   * anchor: { fret, width } the hand's place; notes: the notes being played now [[string, fret], …]
   * (up to 12); fade: 0–1 how strongly they show.
   */
  function update(strings, anchor, notes, nNotes) {
    if (!layout || layout.strings !== strings) build(strings);
    const L = layout;
    const f0 = Math.max(1, Math.min(L.frets, anchor.fret));
    const f1 = Math.max(f0, Math.min(L.frets, anchor.fret + anchor.width - 1));
    const xa = L.wires[f0 - 1];
    const xb = L.wires[f1];
    const w = L.width((xa + xb) / 2);
    lit.position.set((xa + xb) / 2, 0, -0.0006);
    lit.scale.set(xb - xa, w, 1);
    litEdges[0].position.set(xa, 0, -0.002);
    litEdges[1].position.set(xb, 0, -0.002);
    litEdges[0].scale.y = L.width(xa);
    litEdges[1].scale.y = L.width(xb);
    const key = `${f0}|${f1}`;
    if (key !== litKey) {
      litKey = key;
      for (const [n, m] of numbers) m.userData.draw(n >= f0 && n <= f1 ? '#ffc35a' : '#b8cad3');
    }
    let k = 0;
    for (let i = 0; i < nNotes && k < 12; i++) {
      const [s, f, a] = notes[i];
      if (s >= L.strings || f > L.frets) continue;
      const x = f === 0 ? L.wires[0] - 0.008 : L.mids[f - 1];
      dots.setMatrixAt(k, m4.makeTranslation(x, stringAcross(L, s, x), -0.0045).scale(sc.setScalar(0.6 + a * 0.6)));
      dots.setColorAt(k, col.set(colors[s] || '#fff').multiplyScalar(0.4 + a * 0.8));
      k++;
    }
    dots.count = k;
    dots.instanceMatrix.needsUpdate = true;
    dots.instanceColor.needsUpdate = true;
  }
  const m4 = new THREE.Matrix4();
  const sc = new THREE.Vector3();
  const col = new THREE.Color();

  /** g: { x, y, z, angle } from the menu (the middle of the 5th fret's space sits at x, y, z). */
  function place(g) {
    root.position.set(g.x, g.y, g.z);
    root.rotation.set(0, -0.3, -0.2); // the headstock a little higher and further out, as you hold it
    tilt.rotation.x = (g.angle * Math.PI) / 180;
  }
  return { root, update, place, get layout() { return layout; } };
}
