import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WATER_LEVEL, LAKE, riverZ, mulberry32 } from './world.js';

/*
 * boats.js: everything afloat. Cogs and a two-masted carrack sail loops round
 * Mirrormere, fishing boats work near the harbour, a cargo barge plies the
 * river between the town and the lake, rowing boats go up and down the river,
 * and more are tied up at the piers or pulled up on the shore. Each vessel is
 * one mesh: a planked hull lofted from cross-sections and coloured per vertex
 * (tarred below the waterline), with decks, castles, masts, sails, rigging and
 * cargo merged in. They roll and pitch on the water as they go.
 */

const TAU = Math.PI * 2;
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

function paint(geometry, color) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const p = g.attributes.position;
  for (let i = 0; i < n; i++) {
    if (typeof color === 'function') color(p.getX(i), p.getY(i), p.getZ(i), _c);
    else _c.set(color);
    col[i * 3] = _c.r;
    col[i * 3 + 1] = _c.g;
    col[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

function at(geometry, x, y, z, rx = 0, ry = 0, rz = 0) {
  return geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
}

function line(a, b, r = 0.03) {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r, r, d.length(), 4);
  return g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()), new THREE.Vector3(1, 1, 1)));
}

/*
 * A hull L long, B wide and D deep (keel to gunwale), its waterline at y = 0
 * and bow towards +Z: U-shaped sections, pointed at the bow, broad at a
 * square-ish stern, with a sheer that rises to both ends.
 */
function hullGeometry(L, B, D, draft, colors) {
  const segs = 18;
  const around = 10;
  const pos = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const z = -L / 2 + t * L;
    let w = B / 2;
    if (t > 0.62) w *= Math.cos(((t - 0.62) / 0.38) * (Math.PI / 2)) ** 0.8;
    if (t < 0.12) w *= 0.78 + 0.22 * (t / 0.12);
    const sheer = D * 0.32 * ((t - 0.5) * 2) ** 2;
    const depth = D * (t > 0.85 ? 1 - (t - 0.85) * 2.2 : 1);
    for (let j = 0; j <= around; j++) {
      const a = (Math.PI * j) / around;
      const x = -Math.cos(a) * Math.max(w, 0.02);
      const y = D - draft + sheer - Math.sin(a) ** 0.7 * depth;
      pos.push(x, y, z);
    }
  }
  const index = [];
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < around; j++) {
      const a = i * (around + 1) + j;
      const b = a + around + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  const [tar, planks, wale] = colors.map((c) => new THREE.Color(c));
  // Tar below the waterline, a painted wale along the gunwale, planks between.
  return paint(g, (x, y, z, out) => {
    const gunwale = D - draft + D * 0.32 * ((z / L) * 2) ** 2;
    if (y < -0.05) out.copy(tar);
    else if (y > gunwale - 0.2) out.copy(wale);
    else out.copy(planks).multiplyScalar(0.9 + 0.1 * Math.sin(y * 40));
  });
}

// A square sail hanging from a yard, bellied forward a little.
function sailGeometry(w, h, belly, stripes) {
  const g = new THREE.PlaneGeometry(w, h, 8, 8);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / w;
    const v = p.getY(i) / h;
    p.setZ(i, belly * (1 - (2 * u) ** 2) * (1 - (2 * v) ** 2));
  }
  g.computeVertexNormals();
  const cols = stripes.map((c) => new THREE.Color(c));
  return paint(g, (x, y, z, out) => out.copy(cols[Math.floor(((x / w) + 0.5) * cols.length * 0.999 + cols.length) % cols.length]));
}

const WOOD = 0x8a6a48;
const DARK = 0x4a3424;
const TAR = 0x2a2422;

function rowboat(rng) {
  const parts = [hullGeometry(4.2, 1.5, 0.7, 0.3, [TAR, [0x9a7a54, 0x5a7a8a, 0x8a4a3a][Math.floor(rng() * 3)], 0xd8c8a8])];
  for (const z of [-0.8, 0.3, 1.2]) parts.push(paint(at(new THREE.BoxGeometry(1.25, 0.06, 0.22), 0, 0.25, z), WOOD));
  for (const s of [-1, 1]) parts.push(paint(at(new THREE.BoxGeometry(0.06, 0.06, 2.6), s * 0.85, 0.38, 0.1, 0, s * 0.35, 0), DARK));
  return mergeGeometries(parts, false);
}

function fishingBoat(rng) {
  const parts = [hullGeometry(6.5, 2.2, 1.1, 0.45, [TAR, 0x7a5a3a, 0xe8dcc0])];
  parts.push(paint(at(new THREE.BoxGeometry(1.9, 0.08, 4.8), 0, 0.45, -0.2), WOOD));
  parts.push(paint(at(new THREE.CylinderGeometry(0.07, 0.09, 5.6, 6), 0, 3.1, 0.6), DARK));
  parts.push(at(sailGeometry(2.8, 3.0, 0.35, [[0xe8dcc0, 0xc85a3a, 0x3a6aa0][Math.floor(rng() * 3)]]), 0, 3.4, 0.75));
  parts.push(paint(at(new THREE.CylinderGeometry(0.04, 0.04, 3.2, 5), 0, 4.9, 0.7, 0, 0, Math.PI / 2), DARK));
  parts.push(paint(at(new THREE.SphereGeometry(0.5, 8, 6), 0.4, 0.6, -2.0, 0, 0, 0), 0x8a7a5a));
  parts.push(paint(line(new THREE.Vector3(0, 5.8, 0.6), new THREE.Vector3(0, 0.9, 3.0)), 0x3a3028));
  parts.push(paint(line(new THREE.Vector3(0, 5.8, 0.6), new THREE.Vector3(0, 0.9, -2.9)), 0x3a3028));
  return mergeGeometries(parts, false);
}

function barge(rng) {
  const parts = [hullGeometry(11, 3.4, 1.2, 0.5, [TAR, 0x6a5038, 0x4a3424])];
  parts.push(paint(at(new THREE.BoxGeometry(3.0, 0.1, 9.2), 0, 0.55, -0.2), WOOD));
  for (let k = 0; k < 6; k++) parts.push(paint(at(new THREE.CylinderGeometry(0.32, 0.3, 0.8, 10), (k % 2 ? 0.6 : -0.6), 1.0, -3 + Math.floor(k / 2) * 1.2), 0x7a5634));
  for (let k = 0; k < 3; k++) parts.push(paint(at(new THREE.BoxGeometry(0.8, 0.7, 0.8), (k - 1) * 0.9, 0.95, 1.6), 0x9a7a54));
  parts.push(paint(at(new THREE.CylinderGeometry(0.09, 0.11, 7, 6), 0, 3.9, 0.5), DARK));
  parts.push(at(sailGeometry(4.2, 3.6, 0.5, [0xd8c8a0, 0x8a3a2a]), 0, 4.7, 0.65));
  parts.push(paint(at(new THREE.CylinderGeometry(0.05, 0.05, 4.6, 5), 0, 6.5, 0.6, 0, 0, Math.PI / 2), DARK));
  parts.push(paint(at(new THREE.BoxGeometry(0.1, 0.9, 0.08), 0, 0.4, -5.5, 0.3, 0, 0), DARK));
  return mergeGeometries(parts, false);
}

/*
 * A cog: one mast with a great striped square sail, castles fore and aft, a
 * crow's nest and a long pennant. masts: 2 makes a carrack with a foremast.
 */
function cog(rng, sailColors, masts = 1) {
  const L = masts > 1 ? 21 : 16;
  const parts = [hullGeometry(L, 5.2, 3.0, 1.2, [TAR, [0x6a4a30, 0x5a3e2a, 0x7a5a3a][Math.floor(rng() * 3)], 0xc8a040])];
  const deck = 1.55;
  parts.push(paint(at(new THREE.BoxGeometry(4.6, 0.14, L * 0.82), 0, deck, -0.3), WOOD));
  // Castles.
  parts.push(paint(at(new THREE.BoxGeometry(4.4, 1.6, 3.6), 0, deck + 0.8, -L / 2 + 2.2), 0x6a4a30));
  parts.push(paint(at(new THREE.BoxGeometry(4.6, 0.3, 3.8), 0, deck + 1.7, -L / 2 + 2.2), 0xc8a040));
  parts.push(paint(at(new THREE.BoxGeometry(3.0, 1.2, 2.6), 0, deck + 0.9, L / 2 - 3.2), 0x6a4a30));
  parts.push(paint(at(new THREE.BoxGeometry(3.2, 0.3, 2.8), 0, deck + 1.55, L / 2 - 3.2), 0xc8a040));
  for (let k = 0; k < 5; k++) parts.push(paint(at(new THREE.BoxGeometry(0.5, 0.4, 0.06), 2.32, deck + 0.9, -L / 2 + 0.9 + k * 0.7), 0x2a2420));
  parts.push(paint(at(new THREE.BoxGeometry(0.3, 0.3, 4.5), 0, 2.2, L / 2 + 1.0, -0.35, 0, 0), DARK));
  const mastSet = masts > 1 ? [{ z: 1.2, h: 15, w: 9, sh: 8 }, { z: L / 2 - 4.2, h: 10, w: 5.5, sh: 5 }] : [{ z: 0.5, h: 13.5, w: 8.5, sh: 7.5 }];
  for (const m of mastSet) {
    parts.push(paint(at(new THREE.CylinderGeometry(0.18, 0.26, m.h, 8), 0, deck + m.h / 2, m.z), DARK));
    parts.push(paint(at(new THREE.CylinderGeometry(0.1, 0.1, m.w + 0.6, 6), 0, deck + m.h - 1.2, m.z + 0.15, 0, 0, Math.PI / 2), DARK));
    parts.push(at(sailGeometry(m.w, m.sh, 0.9, sailColors), 0, deck + m.h - 1.3 - m.sh / 2, m.z + 0.45));
    parts.push(paint(at(new THREE.CylinderGeometry(0.55, 0.45, 0.6, 10, 1, true), 0, deck + m.h - 0.3, m.z), 0x6a4a30));
    // Shrouds down to the rails, and stays fore and aft.
    for (const s of [-1, 1]) {
      for (const dz of [-1.2, 0, 1.2]) parts.push(paint(line(new THREE.Vector3(0, deck + m.h - 1.5, m.z), new THREE.Vector3(s * 2.3, deck + 0.4, m.z + dz)), 0x2a2420));
    }
    parts.push(paint(line(new THREE.Vector3(0, deck + m.h - 0.2, m.z), new THREE.Vector3(0, 2.6, L / 2 + 2.6)), 0x2a2420));
    parts.push(paint(line(new THREE.Vector3(0, deck + m.h - 0.2, m.z), new THREE.Vector3(0, deck + 1.8, -L / 2 + 1)), 0x2a2420));
  }
  // A long pennant at the masthead.
  const top = mastSet[0];
  const pennant = new THREE.BufferGeometry();
  pennant.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.3, 0, 0, -0.3, 0, 0, 0, -3.2, 0, -0.3, 0, 0, 0.3, 0, 0, 0, -3.2], 3));
  pennant.computeVertexNormals();
  parts.push(paint(at(pennant, 0, deck + top.h + 0.2, top.z), sailColors[1] || sailColors[0]));
  return mergeGeometries(parts, false);
}

const SAILS = [[0xf2eee6, 0xc8302a], [0x24356e, 0xe8b030], [0xf2eee6, 0x3d7a45], [0xe8dcc0, 0xe8dcc0], [0x7a3f86, 0xf2eee6]];

/*
 * A vessel and how it moves: on a loop round an ellipse (lake), back and forth
 * along the river between two x positions, or not at all (tied up, beached).
 */
class Vessel {
  constructor(mesh, motion, rng) {
    this.mesh = mesh;
    this.motion = motion;
    this.phase = rng() * TAU;
    this.t = motion.start ?? rng() * TAU;
    this.dir = 1;
    this.rollAmp = motion.roll ?? 0.04;
  }
}

export class Boats {
  constructor(scene, world) {
    this.world = world;
    this.list = [];
    const rng = mulberry32(4711);
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, side: THREE.DoubleSide });
    const add = (geometry, motion) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = 'boat';
      scene.add(mesh);
      const v = new Vessel(mesh, motion, rng);
      this.list.push(v);
      return v;
    };
    const geo = {
      cog: (i) => cog(rng, SAILS[i % SAILS.length]),
      carrack: () => cog(rng, [0x3d7a45, 0xf2eee6, 0x3d7a45], 2),
    };

    // Ships under sail round the lake, and fishing boats near the harbour.
    const L = LAKE;
    // (The loops keep clear of the harbour piers, which reach about x = 410.)
    add(geo.cog(0), { kind: 'loop', cx: L.x + 16, cz: L.z + 4, rx: 80, rz: 70, speed: 0.022, start: 0 });
    add(geo.carrack(), { kind: 'loop', cx: L.x + 18, cz: L.z, rx: 78, rz: 78, speed: -0.016, start: 2.4 });
    add(geo.cog(1), { kind: 'loop', cx: L.x + 20, cz: L.z + 12, rx: 62, rz: 53, speed: 0.028, start: 4.1 });
    for (let k = 0; k < 3; k++) {
      add(fishingBoat(rng), { kind: 'loop', cx: L.x - 38 + k * 14, cz: L.z - 30 + k * 26, rx: 14 + k * 3, rz: 11 + k * 3, speed: (k % 2 ? -1 : 1) * (0.05 + k * 0.01), roll: 0.06 });
    }
    // At the harbour piers: ships alternately tied up at the berths.
    const berths = world.berths;
    berths.forEach((b, i) => {
      if (b.z < 100 && i % 2 === 0) add(i % 4 === 0 ? geo.cog(2 + i) : fishingBoat(rng), { kind: 'moored', x: b.x, z: b.z, heading: b.heading + (i % 4 === 0 ? 0 : Math.PI) });
      else if (b.z >= 100 && i % 2 === 1) add(rowboat(rng), { kind: 'moored', x: b.x, z: b.z, heading: b.heading + Math.PI, roll: 0.06 });
    });
    for (const b of world.beached) add(rowboat(rng), { kind: 'beached', x: b.x, z: b.z, heading: b.heading });

    // On the river: a cargo barge between the town and the lake, rowing boats west and east of the bridge.
    add(barge(rng), { kind: 'river', x0: 60, x1: 380, offset: 3, speed: 1.6 });
    add(rowboat(rng), { kind: 'river', x0: -230, x1: -24, offset: -3, speed: 1.2, roll: 0.07 });
    add(rowboat(rng), { kind: 'river', x0: 24, x1: 330, offset: -1.5, speed: 1.0, roll: 0.07 });
    add(fishingBoat(rng), { kind: 'river', x0: -420, x1: -240, offset: 1, speed: 1.3 });
    this.time = 0;
    this.update(0);
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    for (const v of this.list) {
      const m = v.motion;
      let x;
      let z;
      let heading;
      let y = WATER_LEVEL;
      if (m.kind === 'loop') {
        v.t += m.speed * dt;
        x = m.cx + Math.sin(v.t) * m.rx;
        z = m.cz + Math.cos(v.t) * m.rz;
        const dx = Math.cos(v.t) * m.rx * Math.sign(m.speed);
        const dz = -Math.sin(v.t) * m.rz * Math.sign(m.speed);
        heading = Math.atan2(dx, dz);
      } else if (m.kind === 'river') {
        // Along the river's centre line (plus an offset), turning round at each end.
        if (v.pos === undefined) v.pos = m.x0 + (m.x1 - m.x0) * ((v.phase / TAU) % 1);
        v.pos += v.dir * m.speed * dt;
        if (v.pos > m.x1) v.dir = -1;
        if (v.pos < m.x0) v.dir = 1;
        x = v.pos;
        z = riverZ(x) + m.offset;
        const slope = (riverZ(x + 1) - riverZ(x - 1)) / 2;
        const target = Math.atan2(v.dir, slope * v.dir);
        v.heading = v.heading === undefined ? target : v.heading + Math.atan2(Math.sin(target - v.heading), Math.cos(target - v.heading)) * Math.min(1, dt * 0.8);
        heading = v.heading;
      } else if (m.kind === 'beached') {
        x = m.x;
        z = m.z;
        heading = m.heading;
        y = Math.max(WATER_LEVEL - 0.15, this.world.getHeight(x, z) + 0.15);
        v.mesh.position.set(x, y, z);
        v.mesh.rotation.set(0.12, heading, 0.35, 'YXZ');
        continue;
      } else {
        x = m.x;
        z = m.z;
        heading = m.heading;
      }
      const roll = Math.sin(t * 0.9 + v.phase) * v.rollAmp;
      const pitch = Math.sin(t * 0.7 + v.phase * 1.7) * v.rollAmp * 0.5;
      v.mesh.position.set(x, y + Math.sin(t * 1.1 + v.phase) * 0.06, z);
      v.mesh.rotation.set(pitch, heading, roll, 'YXZ');
    }
  }
}
