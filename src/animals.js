import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WATER_LEVEL, PLAY_HALF, clamp, mulberry32, riverZ } from './world.js';

/*
 * animals.js: the animals of Valdren. Each species is one InstancedMesh built
 * from procedural parts; its legs, head, tail and wings are moved in the vertex
 * shader (per-instance gait phase, stride, head-down and swing values), so a
 * whole herd costs one draw call. On the CPU each animal wanders inside its
 * pen or patch of ground, grazes, rests, shies away from the player (chickens
 * and sheep), follows someone (a dog after a child) or flies (birds). Dogs,
 * cats, horses, sheep, cows and pigs can be petted.
 */

const TAU = Math.PI * 2;
const PET_RANGE = 1.7;

// Part ids, stored per vertex; the shader rotates each about its pivot.
const BODY = 0;
const LEG_FL = 1;
const LEG_FR = 2;
const LEG_BL = 3;
const LEG_BR = 4;
const HEAD = 5;
const TAIL = 6;
const WING_L = 7;
const WING_R = 8;

const ANIMAL_VERT_PARS = /* glsl */ `
attribute float aPart;
attribute vec3 aPivot;
attribute vec4 aAnim; // gait phase, stride (< 0: lying down), head down, swing phase
mat3 animRotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 animRotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 animRotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
mat3 animRotation() {
  float part = aPart;
  float stride = max(aAnim.y, 0.0);
  float fold = max(-aAnim.y, 0.0);
  if (part > 0.5 && part < 4.5) {
    // Diagonal pairs swing together (a trot); lying down folds the legs under.
    float pair = (abs(part - 1.0) < 0.5 || abs(part - 4.0) < 0.5) ? 1.0 : -1.0;
    float front = part < 2.5 ? 1.0 : -1.0;
    return animRotX(sin(aAnim.x) * stride * 0.55 * pair + fold * 1.35 * front);
  }
  if (part > 4.5 && part < 5.5) return animRotX(aAnim.z * 0.95 + sin(aAnim.w * 0.37) * 0.06);
  if (part > 5.5 && part < 6.5) return animRotY(sin(aAnim.w) * 0.45);
  if (part > 6.5 && part < 7.5) return animRotZ(-sin(aAnim.w) * 0.9);
  if (part > 7.5) return animRotZ(sin(aAnim.w) * 0.9);
  return mat3(1.0);
}
`;

function animalMaterial(material, key) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${ANIMAL_VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n  transformed = animRotation() * (transformed - aPivot) + aPivot;`);
    if (shader.vertexShader.includes('#include <beginnormal_vertex>')) {
      shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  objectNormal = animRotation() * objectNormal;');
    }
  };
  material.customProgramCacheKey = () => key;
  return material;
}

// ------------------------------------------------------------- geometry

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _proj = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _sphere = new THREE.Sphere();
// Animals this close to the player are always drawn: they may cast a shadow into view.
const SHADOW_REACH = 70;

function M(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return new THREE.Matrix4().compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
}

/*
 * Collects an animal's parts (facing +Z, feet at y = 0): geometry placed by a
 * matrix, a colour (or a function of the vertex position), and the part id and
 * pivot the shader animates it by.
 */
class Shape {
  constructor(seed) {
    this.parts = [];
    this.rng = mulberry32(seed);
  }

  add(geometry, matrix, color, part = BODY, pivot = [0, 0, 0], jitter = 0) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    g.applyMatrix4(matrix);
    g.deleteAttribute('uv');
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const pos = g.attributes.position;
    for (let i = 0; i < n; i++) {
      if (typeof color === 'function') color(pos.getX(i), pos.getY(i), pos.getZ(i), _c);
      else _c.set(color);
      if (jitter) _c.multiplyScalar(1 - jitter + this.rng() * jitter * 2);
      col[i * 3] = _c.r;
      col[i * 3 + 1] = _c.g;
      col[i * 3 + 2] = _c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
    const pv = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pv.set(pivot, i * 3);
    g.setAttribute('aPivot', new THREE.BufferAttribute(pv, 3));
    this.parts.push(g);
    return this;
  }

  // A blob: a sphere squashed to (rx, ry, rz) with a lumpy surface.
  blob(x, y, z, rx, ry, rz, color, part, pivot, lump = 0, detail = 2) {
    const g = new THREE.IcosahedronGeometry(1, detail);
    if (lump) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const k = 1 + (Math.sin(p.getX(i) * 9.1 + p.getY(i) * 7.3) * Math.sin(p.getZ(i) * 8.7 + p.getX(i) * 5.3)) * lump;
        p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
      }
      g.computeVertexNormals();
    }
    return this.add(g, M(x, y, z, 0, 0, 0, rx, ry, rz), color, part, pivot);
  }

  // A limb from (x, y0, z) down to (x, y1, z), hinged at its top.
  leg(x, y0, y1, z, r, color, part, hoof = null) {
    const len = y0 - y1;
    this.add(new THREE.CylinderGeometry(r, r * 0.8, len, 7), M(x, (y0 + y1) / 2, z), color, part, [x, y0, z]);
    if (hoof) this.add(new THREE.CylinderGeometry(r * 0.85, r * 0.95, 0.06, 7), M(x, y1 + 0.03, z), hoof, part, [x, y0, z]);
    return this;
  }

  // A tube between two points (a neck, a tail).
  tube(a, b, r0, r1, color, part, pivot) {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = d.length();
    const g = new THREE.CylinderGeometry(r1, r0, len, 7);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    const m = new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(1, 1, 1));
    return this.add(g, m, color, part, pivot);
  }

  build() {
    const g = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    g.computeBoundingSphere();
    return g;
  }
}

const WHITE = 0xffffff;
const HOOF = 0x2a2420;
const EYE = 0x101010;

function eyes(S, y, z, x, part, pivot, r = 0.018) {
  for (const s of [-1, 1]) S.blob(s * x, y, z, r, r, r, EYE, part, pivot, 0, 1);
}

const SPECIES = {
  sheep: {
    walk: 0.7, run: 2.4, turn: 3, radius: 0.45, stride: 0.55, shy: 4, legLen: 0.45, pet: 'the sheep', grazes: true,
    build() {
      const S = new Shape(11);
      const neck = [0, 0.78, 0.42];
      S.blob(0, 0.72, 0, 0.36, 0.32, 0.55, 0xf2ede2, BODY, [0, 0, 0], 0.08, 2);
      S.blob(0, 0.8, 0.62, 0.12, 0.14, 0.19, 0x3a3530, HEAD, neck, 0, 2);
      S.blob(0, 0.9, 0.58, 0.11, 0.08, 0.1, 0xf2ede2, HEAD, neck, 0.1, 1);
      for (const s of [-1, 1]) S.blob(s * 0.12, 0.86, 0.56, 0.08, 0.03, 0.04, 0x3a3530, HEAD, neck, 0, 1);
      eyes(S, 0.84, 0.74, 0.07, HEAD, neck);
      S.leg(-0.15, 0.5, 0, 0.3, 0.045, 0x3a3530, LEG_FL).leg(0.15, 0.5, 0, 0.3, 0.045, 0x3a3530, LEG_FR);
      S.leg(-0.15, 0.5, 0, -0.32, 0.045, 0x3a3530, LEG_BL).leg(0.15, 0.5, 0, -0.32, 0.045, 0x3a3530, LEG_BR);
      S.blob(0, 0.72, -0.56, 0.08, 0.1, 0.08, 0xf2ede2, TAIL, [0, 0.76, -0.52], 0.05, 1);
      return S.build();
    },
    colors: [0xffffff, 0xf4efe6, 0xe8e2d6, 0x9a928a],
  },
  cow: {
    walk: 0.8, run: 2.2, turn: 2, radius: 0.75, stride: 0.8, shy: 0, legLen: 0.72, pet: 'the cow', grazes: true,
    build() {
      const S = new Shape(12);
      const patch = (x, y, z, c) => c.set(Math.sin(x * 6.1 + z * 2.3) * Math.sin(z * 4.7 - y * 3.1) > 0.25 ? 0x1e1a18 : 0xf4f0e8);
      const neck = [0, 1.2, 0.72];
      S.blob(0, 1.05, 0, 0.42, 0.42, 0.85, patch, BODY, [0, 0, 0], 0.03, 2);
      S.blob(0, 0.62, -0.35, 0.16, 0.12, 0.16, 0xe8a0a0, BODY, [0, 0, 0], 0, 1);
      S.add(new THREE.BoxGeometry(0.26, 0.3, 0.44), M(0, 1.12, 1.0, 0.25), patch, HEAD, neck);
      S.add(new THREE.BoxGeometry(0.24, 0.16, 0.14), M(0, 0.98, 1.22, 0.25), 0xd89a90, HEAD, neck);
      for (const s of [-1, 1]) {
        S.add(new THREE.ConeGeometry(0.03, 0.14, 6), M(s * 0.15, 1.3, 0.92, 0, 0, -s * 1.1), 0xe6dcc8, HEAD, neck);
        S.blob(s * 0.2, 1.22, 0.86, 0.09, 0.03, 0.05, 0x1e1a18, HEAD, neck, 0, 1);
      }
      eyes(S, 1.2, 1.12, 0.13, HEAD, neck, 0.022);
      for (const [x, z, p] of [[-0.24, 0.55, LEG_FL], [0.24, 0.55, LEG_FR], [-0.24, -0.6, LEG_BL], [0.24, -0.6, LEG_BR]]) S.leg(x, 0.78, 0, z, 0.07, patch, p, HOOF);
      S.tube([0, 1.32, -0.82], [0, 0.6, -0.95], 0.025, 0.02, 0x1e1a18, TAIL, [0, 1.32, -0.82]);
      S.blob(0, 0.58, -0.96, 0.05, 0.09, 0.05, 0x1e1a18, TAIL, [0, 1.32, -0.82], 0.1, 1);
      return S.build();
    },
    colors: [0xffffff, 0xfff4e8, 0xc89070],
  },
  horse: {
    walk: 1.1, run: 4.5, turn: 2.5, radius: 0.7, stride: 1.0, shy: 0, legLen: 1.05, pet: 'the horse', grazes: true,
    build() {
      const S = new Shape(13);
      const neck = [0, 1.45, 0.55];
      const dark = 0x241a14;
      S.add(new THREE.CapsuleGeometry(0.32, 0.9, 6, 14), M(0, 1.3, 0, Math.PI / 2, 0, 0, 1, 1, 1.05), WHITE, BODY, [0, 0, 0]);
      S.tube([0, 1.4, 0.5], [0, 1.95, 0.88], 0.2, 0.13, WHITE, HEAD, neck);
      S.add(new THREE.BoxGeometry(0.2, 0.24, 0.55), M(0, 1.92, 1.12, 0.75), WHITE, HEAD, neck);
      S.add(new THREE.BoxGeometry(0.17, 0.17, 0.12), M(0, 1.7, 1.33, 0.75), 0x3a2a24, HEAD, neck);
      S.add(new THREE.BoxGeometry(0.05, 0.16, 0.62), M(0, 1.78, 0.68, -0.85), dark, HEAD, neck);
      for (const s of [-1, 1]) S.add(new THREE.ConeGeometry(0.04, 0.14, 5), M(s * 0.07, 2.12, 0.96, -0.3), WHITE, HEAD, neck);
      eyes(S, 1.98, 1.13, 0.1, HEAD, neck, 0.022);
      for (const [x, z, p] of [[-0.17, 0.48, LEG_FL], [0.17, 0.48, LEG_FR], [-0.17, -0.5, LEG_BL], [0.17, -0.5, LEG_BR]]) S.leg(x, 1.12, 0, z, 0.055, WHITE, p, HOOF);
      S.tube([0, 1.42, -0.72], [0, 0.72, -0.95], 0.07, 0.05, dark, TAIL, [0, 1.42, -0.72]);
      return S.build();
    },
    colors: [0x8a4a24, 0x5a3420, 0xb0aaa2, 0x2a2420, 0x9a6a3a],
  },
  pig: {
    walk: 0.6, run: 2.0, turn: 3, radius: 0.4, stride: 0.4, shy: 0, legLen: 0.28, pet: 'the pig', grazes: true,
    build() {
      const S = new Shape(14);
      const pink = 0xf0b0a8;
      const neck = [0, 0.48, 0.32];
      S.blob(0, 0.46, 0, 0.3, 0.28, 0.48, pink, BODY, [0, 0, 0], 0.02, 2);
      S.blob(0, 0.5, 0.46, 0.19, 0.18, 0.18, pink, HEAD, neck, 0, 2);
      S.add(new THREE.CylinderGeometry(0.08, 0.09, 0.1, 10), M(0, 0.47, 0.64, Math.PI / 2), 0xe09890, HEAD, neck);
      for (const s of [-1, 1]) S.add(new THREE.ConeGeometry(0.07, 0.12, 4), M(s * 0.11, 0.66, 0.44, 0.5, 0, -s * 0.3), pink, HEAD, neck);
      eyes(S, 0.56, 0.6, 0.08, HEAD, neck, 0.015);
      for (const [x, z, p] of [[-0.14, 0.26, LEG_FL], [0.14, 0.26, LEG_FR], [-0.14, -0.28, LEG_BL], [0.14, -0.28, LEG_BR]]) S.leg(x, 0.3, 0, z, 0.05, pink, p, 0x6a4a40);
      S.add(new THREE.TorusGeometry(0.05, 0.015, 5, 10, 4.5), M(0, 0.58, -0.48, 0, Math.PI / 2, 0), pink, TAIL, [0, 0.56, -0.46]);
      return S.build();
    },
    colors: [0xffffff, 0xf8e0d8, 0xd8b0a0],
  },
  chicken: {
    walk: 0.5, run: 2.6, turn: 6, radius: 0.18, stride: 0.12, shy: 2.6, legLen: 0.16, grazes: true, peck: true,
    build() {
      const S = new Shape(15);
      const neck = [0, 0.33, 0.08];
      S.blob(0, 0.28, 0, 0.13, 0.13, 0.18, WHITE, BODY, [0, 0, 0], 0.04, 1);
      S.add(new THREE.ConeGeometry(0.08, 0.16, 6), M(0, 0.38, -0.17, -0.7), WHITE, BODY, [0, 0, 0]);
      S.blob(0, 0.43, 0.13, 0.065, 0.075, 0.07, WHITE, HEAD, neck, 0, 1);
      S.add(new THREE.BoxGeometry(0.014, 0.05, 0.07), M(0, 0.51, 0.13), 0xd02a20, HEAD, neck);
      S.add(new THREE.ConeGeometry(0.018, 0.05, 4), M(0, 0.42, 0.21, Math.PI / 2), 0xe8b030, HEAD, neck);
      eyes(S, 0.45, 0.17, 0.04, HEAD, neck, 0.01);
      S.leg(-0.05, 0.18, 0, 0, 0.012, 0xe8b030, LEG_FL).leg(0.05, 0.18, 0, 0, 0.012, 0xe8b030, LEG_FR);
      for (const s of [-1, 1]) S.blob(s * 0.12, 0.3, -0.02, 0.025, 0.08, 0.13, WHITE, s < 0 ? WING_L : WING_R, [s * 0.1, 0.36, 0], 0, 1);
      return S.build();
    },
    colors: [0xffffff, 0xc8742e, 0x8a4a24, 0x3a3a3a, 0xe8d8b0],
  },
  dog: {
    walk: 1.0, run: 4.0, turn: 5, radius: 0.3, stride: 0.35, shy: 0, legLen: 0.42, pet: 'the dog', wag: true,
    build() {
      const S = new Shape(16);
      const neck = [0, 0.58, 0.28];
      S.add(new THREE.CapsuleGeometry(0.13, 0.42, 5, 10), M(0, 0.5, 0, Math.PI / 2), WHITE, BODY, [0, 0, 0]);
      S.tube([0, 0.55, 0.26], [0, 0.66, 0.38], 0.1, 0.08, WHITE, HEAD, neck);
      S.blob(0, 0.7, 0.42, 0.1, 0.1, 0.12, WHITE, HEAD, neck, 0, 2);
      S.add(new THREE.BoxGeometry(0.09, 0.08, 0.14), M(0, 0.66, 0.56), WHITE, HEAD, neck);
      S.blob(0, 0.69, 0.63, 0.022, 0.02, 0.02, EYE, HEAD, neck, 0, 1);
      for (const s of [-1, 1]) S.add(new THREE.BoxGeometry(0.03, 0.12, 0.07), M(s * 0.09, 0.72, 0.38, 0, 0, s * 0.25), 0x3a2a20, HEAD, neck);
      eyes(S, 0.74, 0.5, 0.05, HEAD, neck, 0.015);
      for (const [x, z, p] of [[-0.08, 0.2, LEG_FL], [0.08, 0.2, LEG_FR], [-0.08, -0.2, LEG_BL], [0.08, -0.2, LEG_BR]]) S.leg(x, 0.45, 0, z, 0.035, WHITE, p);
      S.tube([0, 0.56, -0.3], [0, 0.78, -0.48], 0.03, 0.015, WHITE, TAIL, [0, 0.56, -0.3]);
      return S.build();
    },
    colors: [0x8a5a2e, 0x2a2420, 0xd8a860, 0xeae4d8],
  },
  cat: {
    walk: 0.7, run: 3.2, turn: 5, radius: 0.18, stride: 0.22, shy: 2.2, legLen: 0.22, pet: 'the cat',
    build() {
      const S = new Shape(17);
      const neck = [0, 0.3, 0.16];
      S.add(new THREE.CapsuleGeometry(0.08, 0.28, 5, 10), M(0, 0.26, 0, Math.PI / 2), WHITE, BODY, [0, 0, 0]);
      S.blob(0, 0.36, 0.25, 0.075, 0.07, 0.075, WHITE, HEAD, neck, 0, 2);
      for (const s of [-1, 1]) S.add(new THREE.ConeGeometry(0.025, 0.06, 4), M(s * 0.045, 0.44, 0.24), WHITE, HEAD, neck);
      eyes(S, 0.38, 0.31, 0.03, HEAD, neck, 0.012);
      for (const [x, z, p] of [[-0.05, 0.12, LEG_FL], [0.05, 0.12, LEG_FR], [-0.05, -0.12, LEG_BL], [0.05, -0.12, LEG_BR]]) S.leg(x, 0.24, 0, z, 0.02, WHITE, p);
      S.tube([0, 0.3, -0.2], [0, 0.55, -0.32], 0.018, 0.014, WHITE, TAIL, [0, 0.3, -0.2]);
      return S.build();
    },
    colors: [0x8a8a8a, 0xd88a3a, 0x2a2a2a, 0xeee8e0, 0x8a6a4a],
  },
  duck: {
    walk: 0.35, run: 1.0, turn: 2, radius: 0.2, stride: 0, shy: 3, legLen: 0, swims: true,
    build() {
      const S = new Shape(18);
      const neck = [0, 0.12, 0.1];
      S.blob(0, 0.06, 0, 0.12, 0.08, 0.2, WHITE, BODY, [0, 0, 0], 0, 1);
      S.blob(0, 0.2, 0.15, 0.06, 0.065, 0.065, 0x2e6a3a, HEAD, neck, 0, 1);
      S.add(new THREE.BoxGeometry(0.05, 0.02, 0.07), M(0, 0.19, 0.23), 0xe8a030, HEAD, neck);
      S.add(new THREE.ConeGeometry(0.05, 0.1, 5), M(0, 0.1, -0.2, -1.1), WHITE, TAIL, [0, 0.08, -0.16]);
      return S.build();
    },
    colors: [0x8a7a5a, 0xa08a6a, 0xf2eee6],
  },
  bird: {
    flies: true,
    build() {
      const S = new Shape(19);
      S.blob(0, 0, 0, 0.05, 0.05, 0.13, WHITE, BODY, [0, 0, 0], 0, 1);
      S.add(new THREE.ConeGeometry(0.035, 0.12, 4).rotateX(-Math.PI / 2), M(0, 0, -0.17), WHITE, BODY, [0, 0, 0]);
      for (const s of [-1, 1]) {
        const w = new THREE.BufferGeometry();
        w.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.06, s * 0.32, 0, -0.02, 0, 0, -0.08, 0, 0, 0.06, 0, 0, -0.08, s * 0.32, 0, -0.02], 3));
        w.computeVertexNormals();
        S.add(w, new THREE.Matrix4(), 0xe8e8e8, s < 0 ? WING_L : WING_R, [0, 0, 0]);
      }
      return S.build();
    },
    colors: [0x2a2a30],
  },
  // A pigeon: pecks about the squares and flutters up out of the way.
  pigeon: {
    walk: 0.45, run: 3.2, turn: 6, radius: 0.12, stride: 0.09, shy: 2.4, legLen: 0.1, grazes: true, peck: true, flutters: true,
    build() {
      const S = new Shape(20);
      const neck = [0, 0.2, 0.05];
      S.blob(0, 0.16, 0, 0.09, 0.09, 0.14, WHITE, BODY, [0, 0, 0], 0.03, 1);
      S.add(new THREE.ConeGeometry(0.06, 0.12, 5), M(0, 0.17, -0.16, -1.3), 0xb0b0b8, BODY, [0, 0, 0]);
      S.blob(0, 0.27, 0.09, 0.05, 0.055, 0.055, 0x7a8a9a, HEAD, neck, 0, 1);
      S.blob(0, 0.22, 0.07, 0.055, 0.04, 0.05, 0x5a8a7a, HEAD, neck, 0, 1);
      S.add(new THREE.ConeGeometry(0.012, 0.035, 4), M(0, 0.265, 0.15, Math.PI / 2), 0x3a3030, HEAD, neck);
      eyes(S, 0.285, 0.12, 0.03, HEAD, neck, 0.008);
      S.leg(-0.03, 0.1, 0, 0, 0.008, 0xd06a6a, LEG_FL).leg(0.03, 0.1, 0, 0, 0.008, 0xd06a6a, LEG_FR);
      for (const s of [-1, 1]) S.blob(s * 0.08, 0.18, -0.02, 0.02, 0.06, 0.11, 0xa0a0a8, s < 0 ? WING_L : WING_R, [s * 0.07, 0.22, 0], 0, 1);
      return S.build();
    },
    colors: [0xb8bcc8, 0x9a9ea8, 0xd8d8dc, 0x6a6a72],
  },
};

// Bird colours for each kind of flock.
const BIRD_COLORS = { crow: 0x26262c, gull: 0xf4f4f2, swallow: 0x2e3448, raven: 0x18181c, finch: 0x8a6a4a };

// ---------------------------------------------------------------- animals

class Animal {
  constructor(spec, kind, home, rng, name = null) {
    this.spec = spec;
    this.kind = kind;
    this.home = home;          // { x, z, r } circle or { rect } to stay in
    this.name = name;
    this.rng = rng;
    this.x = home.x;
    this.z = home.z;
    this.y = 0;
    this.heading = rng() * TAU;
    this.speed = 0;
    this.state = 'idle';
    this.timer = rng() * 4;
    this.tx = this.x;
    this.tz = this.z;
    this.phase = rng() * TAU;
    this.swing = rng() * TAU;
    this.head = 0;
    this.fold = 0;
    this.scale = 0.9 + rng() * 0.2;
    this.follow = null;        // an NPC to trot after
    this.happy = 0;            // seconds of extra tail wagging after being petted
  }
}

/*
 * Animals: builds the species meshes and spawns everyone in their places.
 * update(dt, player, npcs) moves them; separate(player) keeps the player out
 * of the big ones; nearest(player) and pet(animal) handle petting.
 */
export class Animals {
  constructor(scene, world, npcs) {
    this.world = world;
    this.list = [];
    this.groups = new Map();
    const rng = mulberry32(5150);
    this.rng = rng;
    const add = (kind, home, n, names = []) => {
      for (let i = 0; i < n; i++) {
        const a = new Animal(SPECIES[kind], kind, home, rng, names[i] || null);
        this._placeInHome(a, true);
        this.list.push(a);
      }
    };
    const pens = world.pens;
    if (pens.paddock) add('horse', pens.paddock, 4, ['Chestnut', 'Ash']);
    add('sheep', { x: -62, z: 222, r: 12 }, 8);
    add('sheep', { x: 150, z: -55, r: 24 }, 11);
    add('cow', { x: 60, z: 178, r: 13 }, 6);
    if (pens.pigs) add('pig', pens.pigs, 4);
    if (pens.pond) add('duck', { x: pens.pond.x, z: pens.pond.z, r: pens.pond.r, pond: pens.pond.pond }, 4);
    add('chicken', { x: -12, z: 212, r: 6 }, 7);
    add('chicken', { x: -86, z: 44, r: 5 }, 5);
    for (const coop of Object.values(pens).filter((p) => p.species === 'chicken')) add('chicken', { x: coop.x, z: coop.z, r: 4 }, 3);
    add('dog', { x: 0, z: 14, r: 12 }, 1, ['Biscuit']);
    add('dog', { x: 84, z: 40, r: 9 }, 1, ['Patch']);
    add('dog', { x: -12, z: 205, r: 8 }, 1, ['Rusty']);
    add('cat', { x: 88, z: 51, r: 4 }, 1, ['Tansy']);
    add('cat', { x: -14, z: 22, r: 5 }, 1);
    // Strays about the streets of the town and the harbour.
    for (const [x, z] of [[-38, 4], [-56, 12], [38, 18], [52, 4], [46, -18], [26, -30], [4, 64], [-22, 52], [74, 8], [98, 6], [-80, -16], [56, -54], [346, 52], [312, 66]]) {
      add('cat', { x, z, r: 6 }, 1);
    }
    // Pigeons in the squares.
    add('pigeon', { x: 2, z: 14, r: 9 }, 8);
    add('pigeon', { x: 84, z: 40, r: 9 }, 7);
    add('pigeon', { x: 351, z: 46, r: 7 }, 6);
    add('duck', { x: -40, z: 0, r: 26, river: true }, 5);
    add('duck', { x: 42, z: 0, r: 22, river: true }, 4);

    // Cats asleep by the hearths of the Broken Oar and two homes.
    const rooms = world.interiors.filter((r) => r.lights.length && (r.name === 'The Broken Oar' || r.name === 'house'));
    for (const room of rooms.slice(0, 3)) {
      const l = room.lights[0];
      const a = new Animal(SPECIES.cat, 'cat', { x: l.x, z: l.z, r: 0.01, still: true }, rng, room.name === 'The Broken Oar' ? 'Smudge' : null);
      // Curl up a little way in front of the fire, towards the room's centre.
      const dx = room.x - l.x;
      const dz = room.z - l.z;
      const d = Math.hypot(dx, dz) || 1;
      a.x = l.x + (dx / d) * 0.7;
      a.z = l.z + (dz / d) * 0.7;
      a.home = { x: a.x, z: a.z, r: 0.01, still: true };
      a.heading = Math.atan2(-dx, -dz) + 1.2;
      a.state = 'rest';
      a.fold = 1;
      a.timer = 1e9;
      this.list.push(a);
    }

    // Dogs that keep close to someone: Patch after Wren, Rusty after Wynn.
    if (npcs) {
      const by = (id) => npcs.byId.get(id);
      for (const a of this.list) {
        if (a.name === 'Patch' && by('wren')) a.follow = by('wren');
        if (a.name === 'Rusty' && by('wynn')) a.follow = by('wynn');
      }
    }

    // Birds circling in flocks over the town, the fields and the woods.
    this.flocks = [
      { x: 30, z: 10, r: 46, y: 42, n: 9, speed: 0.11, kind: 'crow' },
      { x: 40, z: 222, r: 52, y: 34, n: 8, speed: -0.09, kind: 'finch' },
      { x: -200, z: 60, r: 60, y: 48, n: 9, speed: 0.08, kind: 'crow' },
      { x: 480, z: 92, r: 70, y: 30, n: 12, speed: 0.07, kind: 'gull' },
      { x: 382, z: 50, r: 28, y: 16, n: 9, speed: -0.13, kind: 'gull' },
      { x: 150, z: 136, r: 40, y: 20, n: 6, speed: 0.1, kind: 'gull' },
      { x: 0, z: -190, r: 30, y: 46, n: 7, speed: -0.13, kind: 'crow' },
      { x: 40, z: 362, r: 34, y: 20, n: 9, speed: 0.17, kind: 'swallow' },
      { x: 300, z: -300, r: 70, y: 55, n: 8, speed: 0.08, kind: 'crow' },
      { x: -455, z: -440, r: 60, y: 165, n: 6, speed: -0.07, kind: 'raven' },
    ];
    const birds = [];
    this.flocks.forEach((f, fi) => {
      for (let i = 0; i < f.n; i++) {
        birds.push({ flock: f, a: (i / f.n) * TAU * 0.35 + rng() * 0.3, dr: (rng() - 0.5) * 8, dy: (rng() - 0.5) * 5, flap: rng() * TAU, glide: rng() * 10, fi });
      }
    });
    this.birds = birds;

    // One instanced mesh per species.
    const kinds = new Set([...this.list.map((a) => a.kind), 'bird']);
    for (const kind of kinds) {
      const spec = SPECIES[kind];
      const members = kind === 'bird' ? birds : this.list.filter((a) => a.kind === kind);
      if (!members.length) continue;
      const geometry = spec.build();
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(members.length * 4), 4);
      anim.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('aAnim', anim);
      const material = animalMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), `animal-${kind}`);
      const mesh = new THREE.InstancedMesh(geometry, material, members.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.customDepthMaterial = animalMaterial(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), `animal-depth-${kind}`);
      mesh.castShadow = !spec.flies;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.name = `animals:${kind}`;
      members.forEach((m, i) => {
        m.index = i;
        const color = m.flock ? BIRD_COLORS[m.flock.kind] : spec.colors[Math.floor(rng() * spec.colors.length)];
        mesh.setColorAt(i, _c.set(color).multiplyScalar(0.9 + rng() * 0.2));
      });
      if (kind === 'horse') {
        // The named horses: Chestnut is chestnut, Ash is grey.
        members.forEach((m, i) => {
          if (m.name === 'Chestnut') mesh.setColorAt(i, _c.set(0x9a4a1e));
          if (m.name === 'Ash') mesh.setColorAt(i, _c.set(0xb4aea6));
        });
      }
      if (kind === 'dog') members.forEach((m, i) => mesh.setColorAt(i, _c.set({ Biscuit: 0x8a5a2e, Patch: 0xeae4d8, Rusty: 0xc8783a }[m.name] || 0x5a4a3a)));
      if (kind === 'cat') members.forEach((m, i) => { if (m.name === 'Smudge') mesh.setColorAt(i, _c.set(0x3a3a3a)); if (m.name === 'Tansy') mesh.setColorAt(i, _c.set(0xd88a3a)); });
      mesh.instanceColor.needsUpdate = true;
      // Each frame only the animals that can be seen fill the first instances, so every
      // member keeps its colour and takes it to whichever instance it is drawn in.
      members.forEach((m, i) => {
        m.color = new THREE.Color();
        mesh.getColorAt(i, m.color);
      });
      scene.add(mesh);
      this.groups.set(kind, { mesh, anim, members, spec, slots: new Array(members.length).fill(null) });
    }
    this._time = 0;
    this.update(0, { position: new THREE.Vector3(1e6, 0, 1e6) }, null);
  }

  // Picks a spot inside the animal's home: its pen, patch of ground or stretch of river.
  _spot(a) {
    const h = a.home;
    const r = this.rng;
    if (h.hw !== undefined) {
      const lx = (r() * 2 - 1) * (h.hw - 0.8);
      const lz = (r() * 2 - 1) * (h.hd - 0.8);
      return [h.x + lx * h.cos + lz * h.sin, h.z - lx * h.sin + lz * h.cos];
    }
    const ang = r() * TAU;
    const rad = Math.sqrt(r()) * h.r;
    const x = h.x + Math.sin(ang) * rad;
    if (h.river) return [x, riverZ(x) + (r() - 0.5) * 8];
    return [x, h.z + Math.cos(ang) * rad];
  }

  _placeInHome(a, first) {
    for (let k = 0; k < 12; k++) {
      const [x, z] = this._spot(a);
      if (a.spec.swims || this._free(a, x, z)) {
        a.x = x;
        a.z = z;
        break;
      }
    }
    a.tx = a.x;
    a.tz = a.z;
    if (first) a.y = this._ground(a, a.x, a.z);
  }

  _ground(a, x, z) {
    if (a.spec.swims) return a.home.pond ?? WATER_LEVEL - 0.03;
    return this.world.getGroundHeight(x, z);
  }

  _free(a, x, z) {
    const w = this.world;
    if (Math.abs(x) > PLAY_HALF || Math.abs(z) > PLAY_HALF) return false;
    const g = w.getGroundHeight(x, z);
    if (WATER_LEVEL - g > 0.25) return false;
    return !w.colliders.contains(x, g + Math.max(0.3, a.spec.legLen), z, a.spec.radius * 0.8);
  }

  update(dt, player, npcs) {
    this._time += dt;
    const pp = player.position;
    for (const a of this.list) this._think(a, dt, pp);
    for (const g of this.groups.values()) if (g.spec.flies) this._flyBirds(g, dt);
  }

  /*
   * Writes the instances to draw this frame: the animals inside the camera's view, and
   * on the ground those near focus (the player), whose shadows may fall into view.
   * The rest are skipped, so an animal far off costs nothing until it can be seen.
   */
  draw(camera, focus) {
    camera.updateMatrixWorld();
    _proj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_proj);
    for (const g of this.groups.values()) this._write(g, focus);
  }

  _think(a, dt, pp) {
    const spec = a.spec;
    const dxp = a.x - pp.x;
    const dzp = a.z - pp.z;
    const dp = Math.hypot(dxp, dzp);
    a.swing += dt * (spec.wag ? (a.happy > 0 || dp < 4 ? 14 : 5) : 3);
    a.happy = Math.max(0, a.happy - dt);
    if (a.home.still) {
      a.head += (0.3 - a.head) * Math.min(1, dt * 2);
      a.speed = 0;
      a.y = this._ground(a, a.x, a.z);
      return;
    }

    // Shy animals scatter from someone walking right up to them.
    if (spec.shy && dp < spec.shy && a.state !== 'flee') {
      const d = dp || 1;
      a.tx = a.x + (dxp / d) * spec.shy * 1.6 + (this.rng() - 0.5) * 2;
      a.tz = a.z + (dzp / d) * spec.shy * 1.6 + (this.rng() - 0.5) * 2;
      a.state = 'flee';
      a.timer = 1.6;
    }

    a.timer -= dt;
    if (a.follow && a.state !== 'flee') {
      // Trot after someone, keeping a little way behind.
      const f = a.follow.position;
      const back = a.follow.heading + Math.PI;
      a.tx = f.x + Math.sin(back) * 1.3;
      a.tz = f.z + Math.cos(back) * 1.3;
      a.state = Math.hypot(a.tx - a.x, a.tz - a.z) > 0.6 ? 'walk' : 'idle';
    } else if (a.timer <= 0) {
      const r = this.rng();
      if (a.state === 'flee' || r < 0.45) {
        const [x, z] = this._spot(a);
        a.tx = x;
        a.tz = z;
        a.state = 'walk';
        a.timer = 8 + this.rng() * 8;
      } else if (spec.grazes && r < 0.85) {
        a.state = 'graze';
        a.timer = 3 + this.rng() * 7;
      } else if (!spec.swims && r < 0.93 && (a.kind === 'dog' || a.kind === 'cat' || a.kind === 'sheep' || a.kind === 'cow' || a.kind === 'pig')) {
        a.state = 'rest';
        a.timer = 8 + this.rng() * 14;
      } else {
        a.state = 'idle';
        a.timer = 2 + this.rng() * 4;
      }
    }

    // Move towards the target.
    let want = 0;
    if (a.state === 'walk' || a.state === 'flee') {
      const dx = a.tx - a.x;
      const dz = a.tz - a.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.25) {
        if (!a.follow) {
          a.state = spec.grazes && this.rng() < 0.7 ? 'graze' : 'idle';
          a.timer = 2 + this.rng() * 6;
        }
      } else {
        const head = Math.atan2(dx, dz);
        let diff = ((head - a.heading + Math.PI) % TAU + TAU) % TAU - Math.PI;
        a.heading += clamp(diff, -spec.turn * dt, spec.turn * dt);
        diff = ((head - a.heading + Math.PI) % TAU + TAU) % TAU - Math.PI;
        const followFast = a.follow && d > 2.5;
        want = (a.state === 'flee' || followFast ? spec.run : spec.walk) * (Math.abs(diff) < 1 ? 1 : 0.2);
      }
    }
    a.speed += (want - a.speed) * Math.min(1, dt * 4);
    if (a.speed > 0.01) {
      const step = a.speed * dt;
      const nx = a.x + Math.sin(a.heading) * step;
      const nz = a.z + Math.cos(a.heading) * step;
      const h = a.home;
      const ok = spec.swims
        ? h.pond !== undefined ? Math.hypot(nx - h.x, nz - h.z) < h.r : Math.abs(nz - riverZ(nx)) < 7
        : this._free(a, nx, nz) && this._inside(a, nx, nz) && this.world.canStep(a.x, a.z, nx, nz);
      if (ok) {
        a.x = nx;
        a.z = nz;
      } else if (!a.follow) {
        // Blocked: give up on this target and look for another.
        a.state = 'idle';
        a.timer = 0.5 + this.rng();
        a.speed = 0;
      }
    }
    a.y += (this._ground(a, a.x, a.z) - a.y) * Math.min(1, dt * 10);
    if (spec.stride) a.phase += (a.speed / spec.stride) * dt * Math.PI;

    const grazing = a.state === 'graze' ? 1 : 0;
    const peck = spec.peck && grazing ? 0.5 + 0.5 * Math.sin(this._time * 9 + a.phase) : grazing;
    a.head += (peck - a.head) * Math.min(1, dt * (spec.peck ? 14 : 3));
    const lying = a.state === 'rest' ? 1 : 0;
    a.fold += (lying - a.fold) * Math.min(1, dt * 2);
    // Pigeons flutter up into the air while they get out of the way.
    if (spec.flutters) a.air = (a.air || 0) + ((a.state === 'flee' ? 1 : 0) - (a.air || 0)) * Math.min(1, dt * 2.5);
  }

  // Keeps animals with a pen or patch inside it (with a little slack while fleeing).
  _inside(a, x, z) {
    const h = a.home;
    if (a.follow) return true;
    if (h.hw !== undefined) {
      const dx = x - h.x;
      const dz = z - h.z;
      return Math.abs(dx * h.cos - dz * h.sin) < h.hw - 0.4 && Math.abs(dx * h.sin + dz * h.cos) < h.hd - 0.4;
    }
    return Math.hypot(x - h.x, z - h.z) < h.r + (a.state === 'flee' ? 6 : 2);
  }

  _write(g, focus) {
    const { mesh, anim, members, spec, slots } = g;
    let n = 0;
    let recolour = false;
    for (const a of members) {
      const s = a.scale;
      let y;
      if (spec.flies) {
        y = a.y;
        _sphere.set(_v.set(a.x, y, a.z), 2);
        if (!_frustum.intersectsSphere(_sphere)) continue;
        _m.compose(_v, _q.setFromEuler(_e.set(0, a.heading, a.bank)), _s.set(1.4, 1.4, 1.4));
      } else {
        const drop = a.fold * (spec.legLen || 0) * 0.75 * s;
        y = a.y - drop + (a.air || 0) * 2.4 + (spec.swims ? Math.sin(this._time * 2 + a.phase) * 0.015 : 0);
        const near = Math.abs(a.x - focus.x) < SHADOW_REACH && Math.abs(a.z - focus.z) < SHADOW_REACH;
        if (!near) {
          _sphere.set(_v.set(a.x, y + 0.6 * s, a.z), Math.max(1.2, spec.radius * 3) * s);
          if (!_frustum.intersectsSphere(_sphere)) continue;
        }
        _m.compose(_v.set(a.x, y, a.z), _q.setFromAxisAngle(UP, a.heading), _s.set(s, s, s));
      }
      mesh.setMatrixAt(n, _m);
      if (spec.flies) {
        anim.setXYZW(n, 0, 0, 0, a.gliding ? 0.25 : a.flap);
      } else {
        const stride = a.fold > 0.05 ? -a.fold : Math.min(1.3, a.speed / Math.max(spec.walk, 0.1));
        // Chickens keep their wings folded unless they are running away.
        const swing = spec.peck ? (a.state === 'flee' ? this._time * 22 : 0.08) : a.swing;
        anim.setXYZW(n, a.phase, stride, a.head, swing);
      }
      if (slots[n] !== a) {
        slots[n] = a;
        mesh.setColorAt(n, a.color);
        recolour = true;
      }
      n++;
    }
    mesh.count = n;
    mesh.visible = n > 0;
    if (!n) return;
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.instanceMatrix.addUpdateRange(0, n * 16);
    mesh.instanceMatrix.needsUpdate = true;
    anim.clearUpdateRanges();
    anim.addUpdateRange(0, n * 4);
    anim.needsUpdate = true;
    if (recolour) mesh.instanceColor.needsUpdate = true;
  }

  // Birds circle their flocks; where each one is goes to _write.
  _flyBirds(g, dt) {
    for (const b of g.members) {
      const f = b.flock;
      b.a += f.speed * dt;
      b.glide += dt;
      const r = f.r + b.dr + Math.sin(b.glide * 0.3) * 4;
      b.x = f.x + Math.sin(b.a) * r;
      b.z = f.z + Math.cos(b.a) * r;
      b.y = this.world.getHeight(f.x, f.z) + f.y + b.dy + Math.sin(b.glide * 0.7) * 1.5;
      b.heading = b.a + (f.speed > 0 ? Math.PI / 2 : -Math.PI / 2);
      b.bank = f.speed > 0 ? -0.25 : 0.25;
      // Flap for a while, then glide with the wings held out.
      b.gliding = Math.sin(b.glide * 0.5 + b.fi) > 0.3;
      b.flap += dt * (b.gliding ? 0 : 14);
    }
  }

  // Keeps the player from walking through the larger animals.
  separate(player) {
    const pos = player.position;
    for (const a of this.list) {
      if (a.spec.radius < 0.4 || a.spec.swims) continue;
      const dx = pos.x - a.x;
      const dz = pos.z - a.z;
      const min = a.spec.radius * a.scale + player.radius * 0.8;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min || Math.abs(pos.y - a.y) > 1.5) continue;
      const d = Math.sqrt(d2) || 1e-6;
      pos.x = a.x + (dx / d) * min;
      pos.z = a.z + (dz / d) * min;
    }
  }

  // The animal the player could pet: close, petable, at their height.
  nearest(player) {
    const pos = player.position;
    let best = null;
    let bestD = PET_RANGE;
    for (const a of this.list) {
      if (!a.spec.pet) continue;
      const d = Math.hypot(a.x - pos.x, a.z - pos.z) - a.spec.radius * a.scale;
      if (d < bestD && Math.abs(a.y - pos.y) < 1.2) {
        bestD = d;
        best = a;
      }
    }
    return best ? { animal: best, distance: bestD } : null;
  }

  // What the prompt calls it: its name, or 'the dog'.
  label(a) {
    return a.name || a.spec.pet;
  }

  // Petting: the animal reacts, and the line to show describes it.
  pet(a) {
    a.happy = 4;
    if (a.state === 'walk' && !a.follow) a.state = 'idle';
    a.timer = Math.max(a.timer, 3);
    const n = a.name;
    switch (a.kind) {
      case 'dog':
        return `${n || 'The dog'} wags so hard that ${n ? 'his' : 'its'} whole back end wags with it.`;
      case 'cat':
        a.state = 'rest';
        a.timer = 12;
        return `${n || 'The cat'} leans into your hand and purrs like a little kettle.`;
      case 'horse':
        if (n === 'Ash') return 'Ash flattens his ears and snaps at your sleeve. Tam did warn you.';
        return `${n || 'The horse'} nuzzles your shoulder, hoping for an apple.`;
      case 'sheep':
        return 'The sheep puts up with it. Its wool is thick and warm, and smells of meadow.';
      case 'cow':
        return 'The cow chews thoughtfully and lets you scratch behind her ears.';
      case 'pig':
        return 'The pig grunts happily and leans its whole weight against your leg.';
      default:
        return 'It seems to like that.';
    }
  }
}

const UP = new THREE.Vector3(0, 1, 0);
