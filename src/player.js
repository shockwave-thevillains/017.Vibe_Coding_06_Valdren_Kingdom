import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SITES, PLAY_HALF, WATER_LEVEL, MAX_WADE_DEPTH, clamp } from './world.js';

/*
 * player.js: the skinned human figure (shared with NPCs), its procedural
 * animation, the player controller, and the third-person follow camera.
 */

export const WALK_SPEED = 4.2;
export const RUN_SPEED = 8.2;
const PLAYER_RADIUS = 0.4;
const TAU = Math.PI * 2;

// Move an angle towards a target along the shortest arc, frame-rate independent.
export function dampAngle(current, target, rate, dt) {
  const diff = ((((target - current + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
  return current + diff * (1 - Math.exp(-rate * dt));
}

// ------------------------------------------------------------------ figure

/*
 * The human figure is one skinned mesh generated in code: a lofted torso,
 * limbs, hands and boots, a sculpted head with a painted face, a pleated
 * tunic skirt and a cloak, all bound to a 19-bone skeleton. Hair (and an
 * optional beard) is a separate mesh riding on the head bone.
 */

// Joint positions in the bind pose (metres, facing +Z, feet at y = 0).
const JOINTS = {
  hips: [0, 0.96, 0],
  spine: [0, 1.06, 0],
  chest: [0, 1.26, 0],
  neck: [0, 1.49, 0],
  head: [0, 1.555, 0],
  upperArmL: [-0.19, 1.425, -0.005],
  forearmL: [-0.205, 1.155, -0.01],
  handL: [-0.215, 0.905, 0],
  upperArmR: [0.19, 1.425, -0.005],
  forearmR: [0.205, 1.155, -0.01],
  handR: [0.215, 0.905, 0],
  thighL: [-0.095, 0.93, 0],
  shinL: [-0.1, 0.505, 0.01],
  footL: [-0.1, 0.085, -0.01],
  thighR: [0.095, 0.93, 0],
  shinR: [0.1, 0.505, 0.01],
  footR: [0.1, 0.085, -0.01],
  cloak1: [0, 1.44, -0.12],
  cloak2: [0, 0.95, -0.17],
};
const PARENT = {
  hips: null, spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  upperArmL: 'chest', forearmL: 'upperArmL', handL: 'forearmL',
  upperArmR: 'chest', forearmR: 'upperArmR', handR: 'forearmR',
  thighL: 'hips', shinL: 'thighL', footL: 'shinL',
  thighR: 'hips', shinR: 'thighR', footR: 'shinR',
  cloak1: 'chest', cloak2: 'cloak1',
};
const BONES = Object.keys(JOINTS);
const BONE_INDEX = Object.fromEntries(BONES.map((n, i) => [n, i]));
export const HEAD_CENTRE = [0, 1.66, 0.012];
export const HEAD_RADII = [0.077, 0.112, 0.095];

const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const gauss = (x, centre, width) => Math.exp(-(((x - centre) / width) ** 2));
const colour = (hex) => new THREE.Color(hex);
const ring = (x, y, z, rx, rf, rb) => ({ c: [x, y, z], rx, rf, rb });
const WHITE = new THREE.Color(1, 1, 1);
const SPHERE = new THREE.SphereGeometry(1, 14, 10);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

function placement(x, y, z, rx, ry, rz, sx, sy, sz) {
  return _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
}

// Material groups of the figure mesh, in material order. Matte gear shares the skin's
// plain vertex-coloured material, so it costs no extra draw call.
const GROUPS = ['skin', 'cloth', 'face', 'metal'];

// Accumulates skinned vertices (two bones each) into the material groups above.
class SkinBuilder {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.col = [];
    this.si = [];
    this.sw = [];
    this.groups = Object.fromEntries(GROUPS.map((g) => [g, []]));
    this.seams = [];
  }

  get count() {
    return this.pos.length / 3;
  }

  vertex(x, y, z, u, v, c, b0, b1 = b0, w = 0) {
    this.pos.push(x, y, z);
    this.uv.push(u, v);
    this.col.push(c.r, c.g, c.b);
    this.si.push(BONE_INDEX[b0], BONE_INDEX[b1], 0, 0);
    this.sw.push(1 - w, w, 0, 0);
    return this.count - 1;
  }

  tri(group, a, b, c) {
    this.groups[group].push(a, b, c);
  }

  // An indexed template (sphere, box) placed by a matrix and bound to one or two bones.
  shape(template, matrix, group, c, b0, b1 = b0, w = 0) {
    const g = template.clone().applyMatrix4(matrix);
    const p = g.attributes.position;
    const uv = g.attributes.uv;
    const base = this.count;
    for (let i = 0; i < p.count; i++) this.vertex(p.getX(i), p.getY(i), p.getZ(i), uv.getX(i), uv.getY(i), c, b0, b1, w);
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) this.tri(group, base + idx[i], base + idx[i + 1], base + idx[i + 2]);
    g.dispose();
  }

  // Any geometry (indexed or not), already in bind-pose space, bound rigidly to one bone.
  mesh(geometry, group, bone, colorAt) {
    const p = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    const base = this.count;
    for (let i = 0; i < p.count; i++) this.vertex(p.getX(i), p.getY(i), p.getZ(i), uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0, colorAt(i), bone);
    if (geometry.index) {
      const idx = geometry.index.array;
      for (let i = 0; i < idx.length; i += 3) this.tri(group, base + idx[i], base + idx[i + 1], base + idx[i + 2]);
    } else {
      for (let i = 0; i < p.count; i += 3) this.tri(group, base + i, base + i + 1, base + i + 2);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    const index = [];
    GROUPS.forEach((name, m) => {
      const list = this.groups[name];
      g.addGroup(index.length, list.length, m);
      for (let i = 0; i < list.length; i++) index.push(list[i]);
    });
    g.setIndex(index);
    g.computeVertexNormals();
    // Duplicated seam vertices share one normal so lofts shade without a visible line.
    const n = g.attributes.normal;
    for (const [a, b] of this.seams) {
      _v.set(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
      n.setXYZ(a, _v.x, _v.y, _v.z);
      n.setXYZ(b, _v.x, _v.y, _v.z);
    }
    g.computeBoundingSphere();
    return g;
  }
}

const AXIS_X = [1, 0, 0];
const AXIS_Y = [0, 1, 0];
const AXIS_Z = [0, 0, 1];

/*
 * A tube through a list of rings. Each ring is an ellipse in the U/V plane with
 * separate radii in front of (rf) and behind (rb) its centre. paint() decides
 * each vertex's colour, material group and bone weights.
 */
function loft(B, rings, o) {
  const n = o.radial;
  const U = o.U || AXIS_X;
  const V = o.V || AXIS_Z;
  const axis = o.axis || AXIS_Y;
  const cr = [U[1] * V[2] - U[2] * V[1], U[2] * V[0] - U[0] * V[2], U[0] * V[1] - U[1] * V[0]];
  const flip = cr[0] * axis[0] + cr[1] * axis[1] + cr[2] * axis[2] > 0;
  const start = B.count;
  const groupOf = [];
  let arc = 0;
  rings.forEach((r, i) => {
    if (i) arc += Math.hypot(r.c[0] - rings[i - 1].c[0], r.c[1] - rings[i - 1].c[1], r.c[2] - rings[i - 1].c[2]);
    for (let k = 0; k <= n; k++) {
      const t = (k / n) * TAU;
      const s = Math.sin(t);
      const c = Math.cos(t);
      const m = o.wobble ? o.wobble(t, r, i) : 1;
      const ru = r.rx * m;
      const rv = (c >= 0 ? r.rf : r.rb) * m;
      const x = r.c[0] + U[0] * ru * s + V[0] * rv * c;
      const y = r.c[1] + U[1] * ru * s + V[1] * rv * c;
      const z = r.c[2] + U[2] * ru * s + V[2] * rv * c;
      const p = o.paint(x, y, z, s, c, i);
      B.vertex(x, y, z, k / n, arc / (o.vScale || 0.3), p.color, p.b0, p.b1, p.w);
      groupOf.push(p.group);
    }
    B.seams.push([start + i * (n + 1), start + i * (n + 1) + n]);
  });
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < n; k++) {
      const a = start + i * (n + 1) + k;
      const b = a + 1;
      const c = a + n + 1;
      const d = c + 1;
      const ga = groupOf[a - start];
      const group = ga === groupOf[b - start] && ga === groupOf[c - start] && ga === groupOf[d - start] ? ga : 'cloth';
      if (flip) {
        B.tri(group, a, c, b);
        B.tri(group, b, c, d);
      } else {
        B.tri(group, a, b, c);
        B.tri(group, b, d, c);
      }
    }
  }
  const cap = (i, end) => {
    const r = rings[i];
    const p = o.paint(r.c[0], r.c[1], r.c[2], 0, 1, i);
    const centre = B.vertex(r.c[0], r.c[1], r.c[2], 0.5, 0, p.color, p.b0, p.b1, p.w);
    const group = groupOf[i * (n + 1)];
    for (let k = 0; k < n; k++) {
      const a = start + i * (n + 1) + k;
      if (end !== flip) B.tri(group, a, a + 1, centre);
      else B.tri(group, a + 1, a, centre);
    }
  };
  if (o.capStart) cap(0, false);
  if (o.capEnd) cap(rings.length - 1, true);
}

// Rings: [y, half-width, front depth, back depth, centre z].
const TORSO = [
  [0.83, 0.13, 0.08, 0.085, 0], [0.88, 0.152, 0.088, 0.1, 0], [0.94, 0.165, 0.092, 0.112, -0.005],
  [1.0, 0.158, 0.088, 0.1, -0.005], [1.06, 0.142, 0.084, 0.085, 0], [1.12, 0.143, 0.088, 0.083, 0.005],
  [1.19, 0.15, 0.1, 0.085, 0.01], [1.26, 0.162, 0.112, 0.09, 0.01], [1.33, 0.17, 0.115, 0.095, 0.005],
  [1.39, 0.19, 0.1, 0.094, 0], [1.425, 0.184, 0.09, 0.088, -0.005], [1.455, 0.165, 0.08, 0.082, -0.008],
  [1.48, 0.135, 0.072, 0.077, -0.01], [1.492, 0.109, 0.068, 0.073, -0.01], [1.495, 0.1, 0.067, 0.072, -0.01],
  [1.502, 0.089, 0.066, 0.07, -0.009], [1.508, 0.079, 0.064, 0.068, -0.008], [1.5095, 0.076, 0.063, 0.067, -0.008],
  [1.528, 0.07, 0.061, 0.065, -0.005], [1.55, 0.066, 0.058, 0.062, 0], [1.59, 0.06, 0.054, 0.058, 0.005],
];
// [y, half-width, front, back]
const LEG = [
  [0.09, 0.036, 0.042, 0.04], [0.14, 0.038, 0.042, 0.042], [0.2, 0.043, 0.046, 0.05], [0.27, 0.05, 0.05, 0.06],
  [0.325, 0.057, 0.055, 0.066], [0.345, 0.063, 0.061, 0.071], [0.362, 0.055, 0.053, 0.064], [0.42, 0.054, 0.05, 0.062],
  [0.48, 0.053, 0.056, 0.056], [0.53, 0.057, 0.06, 0.055], [0.6, 0.064, 0.066, 0.061], [0.7, 0.073, 0.074, 0.071],
  [0.8, 0.079, 0.077, 0.082], [0.88, 0.077, 0.074, 0.084], [0.95, 0.07, 0.068, 0.078],
];
const ARM = [
  [0.905, 0.026, 0.022, 0.022], [0.925, 0.03, 0.026, 0.026], [0.935, 0.037, 0.033, 0.033], [0.955, 0.037, 0.033, 0.033],
  [1.0, 0.038, 0.034, 0.034], [1.07, 0.043, 0.04, 0.038], [1.12, 0.044, 0.042, 0.04], [1.155, 0.042, 0.04, 0.042],
  [1.2, 0.046, 0.043, 0.045], [1.28, 0.05, 0.048, 0.048], [1.35, 0.056, 0.052, 0.05], [1.39, 0.056, 0.053, 0.051],
  [1.41, 0.05, 0.049, 0.047], [1.425, 0.038, 0.038, 0.036], [1.433, 0.016, 0.016, 0.016],
];
// Boot: [z, centre y, half-width, top, bottom] from heel to toe.
const FOOT = [
  [-0.06, 0.05, 0.037, 0.034, 0.05], [-0.035, 0.056, 0.045, 0.046, 0.056], [0.0, 0.052, 0.047, 0.052, 0.052],
  [0.04, 0.042, 0.048, 0.042, 0.042], [0.08, 0.033, 0.047, 0.033, 0.033], [0.12, 0.029, 0.043, 0.027, 0.029],
  [0.16, 0.026, 0.036, 0.021, 0.026], [0.185, 0.025, 0.022, 0.012, 0.024],
];

// Skirts: [y, half-width, front, back], hem first. A tunic stops at the knee, a robe at the ankle.
const TUNIC_SKIRT = [
  [0.655, 0.205, 0.15, 0.155], [0.675, 0.203, 0.148, 0.153], [0.69, 0.2, 0.145, 0.15], [0.76, 0.19, 0.135, 0.14],
  [0.84, 0.182, 0.125, 0.128], [0.9, 0.178, 0.114, 0.12], [0.95, 0.172, 0.104, 0.116],
];
const ROBE_SKIRT = [
  [0.06, 0.25, 0.205, 0.22], [0.075, 0.249, 0.204, 0.219], [0.09, 0.247, 0.202, 0.217], [0.2, 0.235, 0.19, 0.203],
  [0.35, 0.222, 0.175, 0.188], [0.5, 0.208, 0.16, 0.172], [0.65, 0.196, 0.146, 0.156], [0.78, 0.187, 0.132, 0.14],
  [0.88, 0.18, 0.118, 0.124], [0.95, 0.172, 0.104, 0.116],
];

// Interpolates [y, ...values] rows (sorted by y) at height y.
function rowAt(rows, y) {
  if (y <= rows[0][0]) return rows[0];
  for (let i = 1; i < rows.length; i++) {
    if (y <= rows[i][0]) {
      const a = rows[i - 1];
      const b = rows[i];
      const t = (y - a[0]) / (b[0] - a[0]);
      return a.map((v, k) => v + (b[k] - v) * t);
    }
  }
  return rows[rows.length - 1];
}

/*
 * Torso and skirt rings for a look. A female build narrows the shoulders and
 * waist and adds a bust and hips; belly (0..1) rounds the stomach. The skirt
 * always clears the torso it hangs from.
 */
function bodyShape(L) {
  const belly = L.belly || 0;
  const torso = TORSO.map(([y, rx, rf, rb, z]) => {
    if (L.female) {
      rx *= (1 - 0.06 * smooth(1.28, 1.42, y)) * (1 - 0.09 * gauss(y, 1.1, 0.07)) * (1 + 0.05 * gauss(y, 0.93, 0.06));
      rf += 0.03 * gauss(y, 1.27, 0.055);
      rb += 0.012 * gauss(y, 0.9, 0.06);
    }
    rf += 0.06 * belly * gauss(y, 1.08, 0.12);
    rx += 0.02 * belly * gauss(y, 1.05, 0.12);
    return [y, rx, rf, rb, z];
  });
  const skirt = (L.skirt === 'robe' ? ROBE_SKIRT : TUNIC_SKIRT).map(([y, rx, rf, rb]) => {
    if (y >= 0.83) {
      const t = rowAt(torso, y);
      return [y, Math.max(rx, t[1] + 0.01), Math.max(rf, t[2] + 0.012), Math.max(rb, t[3] + 0.012)];
    }
    return [y, rx, rf, rb];
  });
  return { torso, skirt };
}

const shapes = new WeakMap();

/*
 * The body's outline at height y for a look: { rx, rf } = half-width and depth
 * in front of the centre line, over the clothes (skirt pleats included). Used
 * to fit aprons and armour.
 */
export function frontProfile(look, y) {
  let shape = shapes.get(look);
  if (!shape) shapes.set(look, (shape = bodyShape(look)));
  const r = y >= 0.95 ? rowAt(shape.torso, y) : rowAt(shape.skirt, y);
  const pleat = y < 0.95 ? 1.04 : 1;
  return { rx: r[1] * pleat, rf: r[2] * pleat };
}

function torsoWeights(x, y) {
  let r;
  if (y < 1.0) r = ['hips', 'hips', 0];
  else if (y < 1.12) r = ['hips', 'spine', smooth(1.0, 1.12, y)];
  else if (y < 1.22) r = ['spine', 'spine', 0];
  else if (y < 1.32) r = ['spine', 'chest', smooth(1.22, 1.32, y)];
  else if (y < 1.48) r = ['chest', 'chest', 0];
  else if (y < 1.53) r = ['chest', 'neck', smooth(1.48, 1.53, y)];
  else if (y < 1.55) r = ['neck', 'neck', 0];
  else r = ['neck', 'head', smooth(1.55, 1.59, y)];
  // The shoulders follow the arms a little.
  if (y > 1.33 && y < 1.47 && Math.abs(x) > 0.12) r = ['chest', x < 0 ? 'upperArmL' : 'upperArmR', 0.45 * smooth(0.12, 0.178, Math.abs(x))];
  return r;
}

function buildBody(B, c, look) {
  const shape = bodyShape(look);
  const robe = look.skirt === 'robe';
  loft(B, shape.torso.map(([y, rx, rf, rb, z]) => ring(0, y, z, rx, rf, rb)), {
    radial: 24,
    capStart: true,
    capEnd: true,
    paint: (x, y, z, s, cs) => {
      const [b0, b1, w] = torsoWeights(x, y);
      const skin = y > 1.509;
      const collar = !skin && y > 1.494;
      return { color: skin ? c.skin : collar ? c.trim : y < 0.92 ? c.trousers : c.tunic, group: skin ? 'skin' : 'cloth', b0, b1, w };
    },
  });

  // Pleated skirt, pulled along by whichever thigh is nearer (a robe only gently).
  const last = shape.skirt.length - 1;
  loft(B, shape.skirt.map(([y, rx, rf, rb]) => ring(0, y, -0.005, rx, rf, rb)), {
    radial: robe ? 40 : 36,
    wobble: (t, r, i) => 1 + Math.sin(t * 9) * 0.035 * (1 - i / last),
    paint: (x, y, z, s) => ({
      color: y < (robe ? 0.095 : 0.68) ? c.trim : c.tunic,
      group: 'cloth',
      b0: 'hips',
      b1: x < 0 ? 'thighL' : 'thighR',
      w: robe ? smooth(0.95, 0.45, y) * (0.15 + 0.3 * Math.abs(s)) : smooth(0.95, 0.66, y) * (0.3 + 0.45 * Math.abs(s)),
    }),
  });

  // Belt, buckle and a pouch.
  const beltFront = rowAt(shape.torso, 1.045)[2] + 0.009;
  loft(B, [[1.03, 0.003], [1.045, 0.008], [1.075, 0.008], [1.09, 0.003]].map(([y, d]) => {
    const t = rowAt(shape.torso, y);
    return ring(0, y, 0, t[1] + d, t[2] + d, t[3] + d);
  }), {
    radial: 24,
    paint: (x, y) => ({ color: c.belt, group: 'cloth', b0: 'hips', b1: 'spine', w: smooth(1.0, 1.12, y) }),
  });
  B.shape(BOX, placement(0, 1.06, beltFront, 0, 0, 0, 0.05, 0.045, 0.012), 'cloth', c.trim, 'hips', 'spine', 0.5);
  if (c.pouch) B.shape(BOX, placement(0.125, 0.99, beltFront - 0.026, 0.05, 0.6, 0, 0.075, 0.085, 0.035), 'cloth', c.pouch, 'hips');

  for (const side of [-1, 1]) {
    const L = side < 0 ? 'L' : 'R';

    // Leg: trousers into turned-down boots.
    loft(B, LEG.map(([y, rx, rf, rb]) => ring(side * (0.092 + (0.95 - y) * 0.009), y, 0.005, rx, rf, rb)), {
      radial: 16,
      capStart: true,
      paint: (x, y) => {
        let b0 = `thigh${L}`;
        let b1 = b0;
        let w = 0;
        if (y < 0.56) {
          b1 = `shin${L}`;
          w = smooth(0.56, 0.47, y);
        }
        if (y < 0.47) {
          b0 = `shin${L}`;
          b1 = `foot${L}`;
          w = smooth(0.14, 0.08, y) * 0.5;
        }
        const boot = y < 0.355;
        return { color: boot ? (y > 0.32 ? c.bootCuff : c.boots) : c.trousers, group: 'cloth', b0, b1, w };
      },
    });

    // Boot, heel to toe, with a darker sole.
    loft(B, FOOT.map(([z, y, rx, rt, rb]) => ({ c: [side * 0.1, y, z], rx, rf: rt, rb })), {
      radial: 14,
      U: AXIS_X,
      V: AXIS_Y,
      axis: AXIS_Z,
      capStart: true,
      capEnd: true,
      paint: (x, y, z, s, cs) => ({ color: cs < -0.55 ? c.sole : c.boots, group: 'cloth', b0: `foot${L}`, b1: `shin${L}`, w: smooth(-0.01, -0.06, z) * 0.4 }),
    });

    // Arm: sleeve with a cuff, bare (or gloved) wrist.
    const hand = side < 0 && c.gloveL ? c.gloveL : c.skin;
    loft(B, ARM.map(([y, rx, rf, rb]) => ring(side * (0.19 + (1.425 - y) * 0.05), y, -0.005, rx, rf, rb)), {
      radial: 14,
      capStart: true,
      capEnd: true,
      paint: (x, y) => {
        let b0 = `upperArm${L}`;
        let b1 = b0;
        let w = 0;
        if (y < 1.19) {
          b1 = `forearm${L}`;
          w = smooth(1.19, 1.12, y);
        }
        if (y < 1.12) {
          b0 = `forearm${L}`;
          b1 = `hand${L}`;
          w = smooth(0.94, 0.9, y) * 0.6;
        }
        const skin = y < 0.927;
        const cuff = !skin && y < 0.958;
        return { color: skin ? hand : cuff ? c.trim : c.sleeves, group: skin ? 'skin' : 'cloth', b0, b1, w };
      },
    });

    // Hand: palm, curled fingers and thumb.
    const hx = side * 0.218;
    B.shape(SPHERE, placement(hx, 0.855, 0.004, 0, 0, side * 0.08, 0.021, 0.05, 0.042), 'skin', hand, `hand${L}`);
    B.shape(SPHERE, placement(hx + side * 0.003, 0.797, 0.013, 0.28, 0, 0, 0.018, 0.04, 0.036), 'skin', hand, `hand${L}`);
    B.shape(SPHERE, placement(hx - side * 0.013, 0.848, 0.036, 0.4, 0, -side * 0.5, 0.011, 0.03, 0.012), 'skin', hand, `hand${L}`);

    // Ears: a flattened shell with a darker hollow.
    B.shape(SPHERE, placement(side * 0.074, HEAD_CENTRE[1] - 0.004, HEAD_CENTRE[2] - 0.02, -0.15, side * 0.25, 0, 0.008, 0.026, 0.015), 'skin', c.skin, 'head');
    B.shape(SPHERE, placement(side * 0.0795, HEAD_CENTRE[1] - 0.008, HEAD_CENTRE[2] - 0.018, -0.15, side * 0.25, 0, 0.0035, 0.011, 0.007), 'skin', c.earHollow, 'head');
  }
}

// Head shapes: how much the jaw tapers, how broad the chin, the jaw angle, brow ridge and nose.
const MALE_HEAD = { jaw: 0.07, chin: 0.22, angle: 0.006, brow: 0.007, nose: 1 };
const FEMALE_HEAD = { jaw: 0.13, chin: 0.1, angle: 0.0015, brow: 0.0025, nose: 0.82 };

// Head shape: a sphere sculpted into a skull, brow, eye sockets, nose, cheekbones, lips and chin.
function sculpt(nx, ny, nz, S = MALE_HEAD) {
  let x = nx * HEAD_RADII[0];
  const y = ny * HEAD_RADII[1];
  let z = nz * HEAD_RADII[2];
  const front = smooth(0.05, 0.55, nz);
  const jaw = smooth(-0.35, -1.0, ny);
  x *= (1 - S.jaw * jaw) * (1 + S.chin * smooth(-0.78, -1, ny) * smooth(-0.1, 0.5, nz));
  z *= 1 - 0.16 * jaw * (nz < 0 ? 1.5 : 0.5);
  if (nz < 0) z *= 1.04 + 0.05 * smooth(0, 0.6, ny);
  // A sphere's front recedes towards the chin; a face is closer to a vertical plane.
  const facing = smooth(0.25, 0.9, nz / Math.max(Math.hypot(nx, nz), 1e-6));
  z += (0.021 * Math.exp(-(((ny + 0.8) / 0.22) ** 2)) + 0.006 * Math.exp(-(((ny + 0.5) / 0.15) ** 2))) * facing;
  const yOut = y - 0.01 * smooth(-0.45, -0.85, ny) * smooth(-0.4, 0.2, nz);
  const g = (a, b, ca, cb) => Math.exp(-(((a - ca[0]) / ca[1]) ** 2) - (((b - cb[0]) / cb[1]) ** 2));
  const ax = Math.abs(nx);
  z += 0.011 * g(nx, ny, [0, 0.3], [-0.82, 0.16]) * front;
  z += S.brow * Math.exp(-(((ny - 0.2) / 0.07) ** 2)) * front * smooth(0.75, 0.3, ax);
  z -= 0.01 * g(ax, ny, [0.34, 0.17], [0.07, 0.1]) * front;
  z += 0.004 * g(ax, ny, [0.33, 0.09], [0.07, 0.05]) * front;
  z += 0.024 * S.nose * g(nx, ny, [0, 0.1], [-0.13, 0.2]) * front;
  z += 0.008 * S.nose * g(nx, ny, [0, 0.12], [-0.28, 0.07]) * front;
  z += 0.006 * g(nx, ny, [0, 0.22], [-0.47, 0.07]) * front;
  z -= 0.002 * g(nx, ny, [0, 0.2], [-0.5, 0.02]) * front;
  x += Math.sign(nx) * 0.004 * g(ax, ny, [0.75, 0.15], [-0.05, 0.15]);
  x += Math.sign(nx) * S.angle * g(ax, ny, [0.85, 0.2], [-0.55, 0.15]) * smooth(-0.55, -0.2, nz);
  return [x, yOut, z];
}

const HEAD_SEGMENTS = [40, 28];

function buildHead(B, S) {
  const g = new THREE.SphereGeometry(1, HEAD_SEGMENTS[0], HEAD_SEGMENTS[1]);
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  const base = B.count;
  for (let i = 0; i < p.count; i++) {
    const [x, y, z] = sculpt(p.getX(i), p.getY(i), p.getZ(i), S);
    // The front half of the head gets 82 % of the face texture; the back a plain strip.
    const phi = uv.getX(i) * TAU;
    const u = phi <= Math.PI ? (phi / Math.PI) * 0.82 : 0.82 + ((phi - Math.PI) / Math.PI) * 0.18;
    B.vertex(HEAD_CENTRE[0] + x, HEAD_CENTRE[1] + y, HEAD_CENTRE[2] + z, u, uv.getY(i), WHITE, 'head');
  }
  const idx = g.index.array;
  for (let i = 0; i < idx.length; i += 3) B.tri('face', base + idx[i], base + idx[i + 1], base + idx[i + 2]);
  const cols = HEAD_SEGMENTS[0] + 1;
  for (let iy = 0; iy <= HEAD_SEGMENTS[1]; iy++) B.seams.push([base + iy * cols, base + iy * cols + HEAD_SEGMENTS[0]]);
  g.dispose();
}

function buildCloak(B, c) {
  const cols = 12;
  const rows = 12;
  const start = B.count;
  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    const half = lerpN(0.19, 0.31, Math.pow(t, 0.8));
    for (let k = 0; k <= cols; k++) {
      const u = (k / cols) * 2 - 1;
      const x = u * half;
      const y = lerpN(1.5 - 0.055 * u * u, 0.42, t);
      let z = -(0.1 + 0.07 * t) - 0.04 * (1 - u * u) - Math.sin(u * Math.PI * 3) * 0.012 * t;
      if (t < 0.15) z += u * u * 0.05 * (1 - t / 0.15);
      const top = t < 0.18;
      const b0 = top ? 'chest' : 'cloak1';
      const b1 = top ? 'cloak1' : 'cloak2';
      const w = top ? smooth(0, 0.18, t) : smooth(0.4, 0.75, t);
      B.vertex(x, y, z, k / cols, t * 3, t > 0.96 ? c.cloakHem : c.cloak, b0, b1, w);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const a = start + r * (cols + 1) + k;
      const b = a + 1;
      const d = a + cols + 1;
      B.tri('cloth', a, b, d);
      B.tri('cloth', b, d + 1, d);
    }
  }
}

function lerpN(a, b, t) {
  return a + (b - a) * t;
}

// ------------------------------------------------------------ textures

let sharedTextures = null;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function figureTextures() {
  if (sharedTextures) return sharedTextures;
  // Fine woven cloth, near white so vertex colours carry the hue.
  const weave = canvas(64, 64);
  const g = weave.getContext('2d');
  g.fillStyle = '#f4f4f4';
  g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 64; i += 2) {
    g.fillStyle = i % 4 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.25)';
    g.fillRect(0, i, 64, 1);
    g.fillStyle = i % 4 ? 'rgba(0,0,0,0.05)' : 'rgba(0,0,0,0.02)';
    g.fillRect(i, 0, 1, 64);
  }
  for (let i = 0; i < 300; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`;
    g.fillRect(Math.random() * 64, Math.random() * 64, 2, 1);
  }
  const weaveTex = new THREE.CanvasTexture(weave);
  weaveTex.colorSpace = THREE.SRGBColorSpace;
  weaveTex.wrapS = weaveTex.wrapT = THREE.RepeatWrapping;
  weaveTex.repeat.set(10, 4);

  // Hair strands running from the crown down.
  const hair = canvas(256, 256);
  const h = hair.getContext('2d');
  h.fillStyle = '#c8c8c8';
  h.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2200; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const len = 30 + Math.random() * 110;
    const v = Math.floor(70 + Math.random() * 185);
    h.strokeStyle = `rgba(${v},${v},${v},0.6)`;
    h.lineWidth = 0.6 + Math.random() * 1.4;
    h.beginPath();
    h.moveTo(x, y);
    h.bezierCurveTo(x + (Math.random() - 0.5) * 8, y + len / 3, x + (Math.random() - 0.5) * 8, y + (2 * len) / 3, x + (Math.random() - 0.5) * 6, y + len);
    h.stroke();
  }
  const hairTex = new THREE.CanvasTexture(hair);
  hairTex.colorSpace = THREE.SRGBColorSpace;
  hairTex.wrapS = hairTex.wrapT = THREE.RepeatWrapping;
  hairTex.repeat.set(2, 1);

  // Strand mask for the thinning edge of the hair: bright strands on a dim ground.
  const strands = canvas(256, 256);
  const st = strands.getContext('2d');
  st.fillStyle = '#4a4a4a';
  st.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1500; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const len = 20 + Math.random() * 70;
    const v = Math.floor(120 + Math.random() * 135);
    const bend = (Math.random() - 0.5) * 6;
    const drift = (Math.random() - 0.5) * 5;
    st.strokeStyle = `rgb(${v},${v},${v})`;
    st.lineWidth = 0.8 + Math.random() * 1.6;
    // Drawn again one tile over so the mask wraps seamlessly.
    for (const dx of [0, -256, 256]) {
      for (const dy of [0, -256]) {
        st.beginPath();
        st.moveTo(x + dx, y + dy);
        st.quadraticCurveTo(x + dx + bend, y + dy + len / 2, x + dx + drift, y + dy + len);
        st.stroke();
      }
    }
  }
  const strandTex = new THREE.CanvasTexture(strands);
  strandTex.wrapS = strandTex.wrapT = THREE.RepeatWrapping;
  strandTex.repeat.set(2, 1);

  sharedTextures = {
    weave: weaveTex,
    hair: hairTex,
    strands: strandTex,
    skin: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0, side: THREE.DoubleSide }),
    cloth: new THREE.MeshStandardMaterial({ vertexColors: true, map: weaveTex, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.8, side: THREE.DoubleSide }),
  };
  return sharedTextures;
}

function css(hex) {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/*
 * Where hair grows, as a field on the unit head sphere: positive inside the
 * hair or beard, zero on its edge. HAIRLINE lists the height (ny) of the
 * hairline against the azimuth around the head (0 = the middle of the brow,
 * pi = the nape), passing in front of the ears as sideburns.
 */
const HAIRLINE = {
  short: [[0, 0.44], [0.32, 0.5], [0.85, 0.37], [1.2, 0.12], [1.4, -0.2], [1.53, -0.2], [1.64, 0.25], [1.97, 0.22], [2.35, -0.36], [Math.PI, -0.8]],
  long: [[0, 0.44], [0.32, 0.5], [0.85, 0.37], [1.2, 0.1], [1.45, -0.32], [1.8, -0.55], [2.4, -0.85], [Math.PI, -0.95]],
  // Swept back from a rounder brow, no sideburns, tucked behind the ears.
  female: [[0, 0.48], [0.45, 0.47], [0.95, 0.34], [1.3, 0.12], [1.48, 0.02], [1.62, 0.26], [1.95, 0.22], [2.35, -0.38], [Math.PI, -0.82]],
};

function hairlineAt(style, a) {
  const pts = HAIRLINE[style] || HAIRLINE.short;
  const t = Math.abs(a);
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) return lerpN(pts[i - 1][1], pts[i][1], smooth(pts[i - 1][0], pts[i][0], t));
  }
  return pts[pts.length - 1][1];
}

// Height of the hairline at azimuth a for a look (null for a bald head).
function scalpLine(look, a) {
  const style = look.hairStyle;
  if (style === 'bald') return null;
  return hairlineAt(style === 'long' ? 'long' : look.female ? 'female' : 'short', a);
}

// Hair on the scalp only: 'short', 'long', 'bun' (swept up) or 'bald'.
function scalpField(look, nx, ny, nz, line = scalpLine(look, Math.atan2(nx, nz))) {
  if (line === null) return -1;
  return ny - line;
}

function hairField(look, nx, ny, nz, line) {
  let f = scalpField(look, nx, ny, nz, line);
  if (look.beard) {
    // Below a line from the sideburns, under the cheekbones, to above the lip;
    // the lips stay clear and the beard stops under the jaw.
    let b = -0.33 + 0.38 * smooth(0.12, 0.95, Math.abs(nx)) - ny;
    b = Math.min(b, (Math.hypot(nx / 0.2, (ny + 0.47) / 0.075) - 1) * 0.08);
    b = Math.min(b, (nz + 0.3) * 0.5);
    f = Math.max(f, b);
  }
  return f;
}

// Paints the face into the head's UV layout: skin, blush, eyes, brows, nose and lips.
function paintFace(look) {
  const W = 512;
  const H = 512;
  const cv = canvas(W, H);
  const g = cv.getContext('2d', { willReadFrequently: true });
  const P = (nx, ny) => {
    const nz = Math.sqrt(Math.max(1e-4, 1 - nx * nx - ny * ny));
    return [(Math.atan2(nz, -nx) / Math.PI) * 0.82 * W, (Math.acos(clamp(ny, -1, 1)) / Math.PI) * H];
  };
  const SX = (0.82 * W) / Math.PI;
  const SY = H / Math.PI;
  const rand = mulberry(look.seed || 7);

  g.fillStyle = css(look.skin);
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 3000; i++) {
    g.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(90,40,30,0.04)';
    g.fillRect(rand() * W, rand() * H, 2, 2);
  }
  // The scalp (and a beard's skin) shows through the thinning edge of the hair.
  if (look.hairStyle !== 'bald' || look.beard) {
    const img = g.getImageData(0, 0, W, H);
    const d = img.data;
    const hr = (look.hair >> 16) & 255;
    const hg = (look.hair >> 8) & 255;
    const hb = look.hair & 255;
    // The azimuth (and so the hairline) depends only on the column.
    const lines = [];
    const cols = [];
    for (let px = 0; px < W; px++) {
      const u = (px + 0.5) / W;
      const phi = u <= 0.82 ? (u / 0.82) * Math.PI : Math.PI + ((u - 0.82) / 0.18) * Math.PI;
      cols.push([-Math.cos(phi), Math.sin(phi)]);
      lines.push(scalpLine(look, Math.atan2(-Math.cos(phi), Math.sin(phi))));
    }
    for (let py = 0; py < H; py++) {
      const theta = ((py + 0.5) / H) * Math.PI;
      const ny = Math.cos(theta);
      const st = Math.sin(theta);
      for (let px = 0; px < W; px++) {
        const f = hairField(look, cols[px][0] * st, ny, cols[px][1] * st, lines[px]);
        if (f < -0.03) continue;
        const a = smooth(-0.03, 0.06, f) * (0.4 + 0.3 * rand());
        const k = (py * W + px) * 4;
        d[k] += (hr - d[k]) * a;
        d[k + 1] += (hg - d[k + 1]) * a;
        d[k + 2] += (hb - d[k + 2]) * a;
      }
    }
    g.putImageData(img, 0, 0);
  }
  const blob = (nx, ny, rx, ry, rgb, alpha) => {
    const [x, y] = P(nx, ny);
    g.save();
    g.translate(x, y);
    g.scale(rx * SX, ry * SY);
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    grd.addColorStop(0, `rgba(${rgb},${alpha})`);
    grd.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grd;
    g.beginPath();
    g.arc(0, 0, 1, 0, TAU);
    g.fill();
    g.restore();
  };
  const curve = (pts, width, rgba) => {
    const q = pts.map(([nx, ny]) => P(nx, ny));
    g.strokeStyle = rgba;
    g.lineWidth = width;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(q[0][0], q[0][1]);
    if (q.length === 3) g.quadraticCurveTo(q[1][0], q[1][1], q[2][0], q[2][1]);
    else g.lineTo(q[1][0], q[1][1]);
    g.stroke();
  };
  const age = look.age || 0;

  // Age spots and a burn scar go under the features.
  for (let i = 0; i < age * 60; i++) blob((rand() * 2 - 1) * 0.8, rand() * 0.9 - 0.5, 0.02 + rand() * 0.03, 0.02 + rand() * 0.03, '120,70,45', 0.12 * age);
  if (look.scar === 'burn') {
    for (let i = 0; i < 70; i++) {
      const nx = -0.4 - rand() * 0.48;
      const ny = 0.3 - rand() * 0.75;
      if (nx > -0.5 && ny > -0.05) continue;
      const pale = rand() < 0.4;
      blob(nx, ny, 0.03 + rand() * 0.07, 0.03 + rand() * 0.06, pale ? '235,200,185' : '170,70,60', pale ? 0.35 : 0.22);
    }
    for (let i = 0; i < 12; i++) {
      const nx = -0.5 - rand() * 0.35;
      const ny = 0.2 - rand() * 0.6;
      curve([[nx, ny], [nx - 0.05 + rand() * 0.1, ny - 0.05], [nx + rand() * 0.1 - 0.05, ny - 0.1 - rand() * 0.08]], 1.2, 'rgba(120,45,40,0.25)');
    }
  }

  for (const s of [-1, 1]) {
    blob(s * 0.45, -0.22, 0.22, 0.15, '200,90,80', look.female ? 0.3 : 0.22);
    blob(s * 0.34, 0.05, 0.2, 0.12, '110,60,50', 0.2);
  }
  blob(0, -0.47, 0.25, 0.1, '180,90,80', 0.15);
  blob(0, -0.78, 0.3, 0.12, '110,70,60', 0.12);
  blob(0, -0.56, 0.12, 0.04, '90,45,35', 0.22);
  for (const s of [-1, 1]) {
    blob(s * 0.33, 0.15, 0.18, 0.05, '90,50,40', 0.18);
    blob(s * 0.33, -0.04, 0.12, 0.04, '120,60,60', 0.12);
    blob(s * 0.13, -0.22, 0.05, 0.12, '100,55,45', 0.14);
    blob(s * 0.62, -0.62, 0.18, 0.25, '100,60,50', 0.12);
    blob(s * 0.085, -0.12, 0.035, 0.14, '100,55,45', 0.16);
  }
  blob(0, -0.05, 0.035, 0.16, '255,235,220', 0.18);
  blob(0, -0.29, 0.1, 0.05, '90,50,40', 0.25);
  for (const s of [-1, 1]) blob(s * 0.05, -0.305, 0.028, 0.016, '50,25,20', 0.6);

  // Eyes: almond-shaped whites, iris, pupil, catch-light, lids and lashes.
  for (const s of [-1, 1]) {
    const [ex, ey] = P(s * 0.33, 0.07);
    const w = 0.125 * SX;
    const h = 0.046 * SY;
    const almond = () => {
      g.beginPath();
      g.moveTo(ex - w, ey);
      g.quadraticCurveTo(ex, ey - h * 1.7, ex + w, ey);
      g.quadraticCurveTo(ex, ey + h * 1.25, ex - w, ey);
      g.closePath();
    };
    almond();
    g.fillStyle = '#efe9e2';
    g.fill();
    g.save();
    almond();
    g.clip();
    const r = h * 1.2;
    const iris = g.createRadialGradient(ex, ey - h * 0.1, r * 0.2, ex, ey - h * 0.1, r);
    iris.addColorStop(0, css(look.eyes));
    iris.addColorStop(0.85, css(look.eyes));
    iris.addColorStop(1, '#1d1612');
    g.fillStyle = iris;
    g.beginPath();
    g.arc(ex, ey - h * 0.1, r, 0, TAU);
    g.fill();
    g.fillStyle = '#0c0907';
    g.beginPath();
    g.arc(ex, ey - h * 0.1, r * 0.42, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.beginPath();
    g.arc(ex - r * 0.35, ey - h * 0.45, r * 0.18, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(60,30,20,0.25)';
    g.fillRect(ex - w, ey - h * 2, w * 2, h * 1.1);
    g.restore();
    g.strokeStyle = '#24160f';
    g.lineWidth = look.female ? 3.4 : 2.4;
    g.beginPath();
    g.moveTo(ex - w * 1.05, ey + 0.5);
    g.quadraticCurveTo(ex, ey - h * 1.75, ex + w * 1.08, ey - 0.5);
    g.stroke();
    if (look.female) {
      g.lineWidth = 1.8;
      g.beginPath();
      g.moveTo(ex + s * w * 1.02, ey - 0.5);
      g.lineTo(ex + s * w * 1.28, ey - h * 0.7);
      g.stroke();
    }
    g.strokeStyle = 'rgba(120,60,50,0.5)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(ex - w * 0.9, ey + 1);
    g.quadraticCurveTo(ex, ey + h * 1.3, ex + w * 0.9, ey + 1);
    g.stroke();
    g.strokeStyle = 'rgba(100,55,45,0.35)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(ex - w * 0.8, ey - h * 1.9);
    g.quadraticCurveTo(ex, ey - h * 2.8, ex + w * 0.9, ey - h * 1.7);
    g.stroke();
    // Brow.
    const [b0x, b0y] = P(s * 0.17, 0.215);
    const [b1x, b1y] = P(s * 0.34, 0.255);
    const [b2x, b2y] = P(s * 0.52, 0.2);
    g.strokeStyle = css(look.brows);
    g.lineCap = 'round';
    const fine = look.female ? 0.65 : 1;
    for (let k = 0; k < 3; k++) {
      g.lineWidth = (4.5 - k * 1.2) * fine;
      g.globalAlpha = 0.45 + k * 0.2;
      g.beginPath();
      g.moveTo(b0x, b0y + k);
      g.quadraticCurveTo(b1x, b1y - (look.female ? 5 : 2), b2x, b2y + 1);
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  // Lips and mouth line.
  const [mx, my] = P(0, -0.465);
  const lw = 0.23 * SX;
  const full = look.female ? 1.25 : 1;
  g.fillStyle = css(look.lips);
  g.beginPath();
  g.moveTo(mx - lw, my);
  g.quadraticCurveTo(mx - lw * 0.4, my - 9 * full, mx, my - 5);
  g.quadraticCurveTo(mx + lw * 0.4, my - 9 * full, mx + lw, my);
  g.quadraticCurveTo(mx, my + 2, mx - lw, my);
  g.fill();
  g.globalAlpha = 0.85;
  g.beginPath();
  g.moveTo(mx - lw * 0.9, my + 1);
  g.quadraticCurveTo(mx, my + 14 * full, mx + lw * 0.9, my + 1);
  g.quadraticCurveTo(mx, my + 3, mx - lw * 0.9, my + 1);
  g.fill();
  g.globalAlpha = 1;
  g.strokeStyle = 'rgba(70,25,20,0.8)';
  g.lineWidth = 1.4;
  g.beginPath();
  g.moveTo(mx - lw, my);
  g.quadraticCurveTo(mx, my + 2.5, mx + lw, my);
  g.stroke();

  // Lines that come with age: forehead, crow's feet, under the eyes, nose to mouth.
  if (age > 0) {
    const a = (k) => `rgba(95,50,38,${(k * age).toFixed(3)})`;
    for (const fy of [0.34, 0.4, 0.46]) curve([[-0.3, fy - 0.01], [0, fy + 0.02], [0.3, fy - 0.01]], 1.3, a(0.22));
    for (const s of [-1, 1]) {
      for (const d of [-1, 0, 1]) curve([[s * 0.47, 0.07 + d * 0.025], [s * 0.56, 0.07 + d * 0.06]], 1.1, a(0.3));
      curve([[s * 0.24, -0.01], [s * 0.33, -0.05], [s * 0.43, -0.01]], 1.2, a(0.25));
      curve([[s * 0.13, -0.2], [s * 0.2, -0.33], [s * 0.21, -0.48]], 1.6, a(0.3));
      if (age > 0.5) curve([[s * 0.25, -0.55], [s * 0.3, -0.68], [s * 0.27, -0.8]], 1.4, a(0.2));
    }
  }

  // Stubble across the jaw.
  if (look.stubble && !look.beard) {
    for (let i = 0; i < 1600; i++) {
      const nx = (rand() * 2 - 1) * 0.85;
      const ny = -0.32 - rand() * 0.62;
      if (Math.abs(nx) < 0.2 && ny > -0.58 && ny < -0.38) continue;
      const [x, y] = P(nx, ny);
      g.fillStyle = `rgba(50,35,25,${0.04 + rand() * 0.06})`;
      g.fillRect(x, y, 1.2, 1.2);
    }
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/*
 * Hair (and beard) is a shell just above the sculpted head. Its thickness and
 * its vertex alpha follow hairField(): full inside the hair, fading towards the
 * hairline. The material alpha-tests that fade against a strand texture, so
 * the edge breaks up into strands instead of ending in a hard rim.
 */
const HAIR_FADE = 2.4;

function hairMesh(look, S) {
  const style = look.hairStyle;
  const beard = look.beard;
  if (style === 'bald' && !beard) return null;
  const g = new THREE.SphereGeometry(1, 64, 44);
  const p = g.attributes.position;
  const alpha = new Float32Array(p.count * 4);
  const field = [];
  for (let i = 0; i < p.count; i++) {
    const nx = p.getX(i);
    const ny = p.getY(i);
    const nz = p.getZ(i);
    const f = hairField(look, nx, ny, nz);
    field.push(f);
    const scalp = scalpField(look, nx, ny, nz);
    const isBeard = beard && scalp < f;
    const lump = Math.sin(nx * 23 + nz * 17) * Math.sin(ny * 19 + nx * 11) * 0.012;
    // Thick on the crown, close-cropped at the sides; beards by style.
    let depth = style === 'bun' ? 0.035 + 0.02 * smooth(-0.2, 0.9, ny) : 0.05 + 0.065 * smooth(-0.2, 0.9, ny) + (style === 'long' ? 0.02 : 0);
    if (isBeard) depth = beard === 'full' ? 0.13 : 0.05;
    const vol = 1.01 + (depth + lump) * smooth(0, 0.28, f);
    const [x, y, z] = sculpt(nx, ny, nz, S);
    // A full beard hangs a little below the chin.
    const hang = beard === 'full' && isBeard ? 0.03 * smooth(0, 0.2, f) * smooth(-0.35, -0.9, ny) : 0;
    p.setXYZ(i, HEAD_CENTRE[0] + x * vol - JOINTS.head[0], HEAD_CENTRE[1] + y * vol + 0.002 - hang - JOINTS.head[1], HEAD_CENTRE[2] + z * vol - JOINTS.head[2]);
    // Swept-back hair ends cleanly; loose hair thins out into strands.
    alpha.set([1, 1, 1, HAIR_FADE * (style === 'bun' && !isBeard ? smooth(-0.01, 0.05, f) : smooth(-0.02, 0.12, f))], i * 4);
  }
  g.setAttribute('color', new THREE.BufferAttribute(alpha, 4));
  const idx = g.index.array;
  const kept = [];
  for (let i = 0; i < idx.length; i += 3) {
    if (Math.max(field[idx[i]], field[idx[i + 1]], field[idx[i + 2]]) > 0) kept.push(idx[i], idx[i + 1], idx[i + 2]);
  }
  g.setIndex(kept);

  let geo = g;
  // A bun gathered at the back of the head.
  if (style === 'bun') {
    const bun = new THREE.SphereGeometry(0.047, 18, 12);
    bun.scale(1, 0.9, 0.85);
    bun.translate(HEAD_CENTRE[0] - JOINTS.head[0], HEAD_CENTRE[1] + 0.03 - JOINTS.head[1], HEAD_CENTRE[2] - 0.112 - JOINTS.head[2]);
    const ba = new Float32Array(bun.attributes.position.count * 4);
    for (let i = 0; i < ba.length; i += 4) ba.set([1, 1, 1, HAIR_FADE], i);
    bun.setAttribute('color', new THREE.BufferAttribute(ba, 4));
    geo = mergeGeometries([g.toNonIndexed(), bun.toNonIndexed()]);
  }
  // Long hair falls behind the neck to the shoulders, its ends thinning out.
  if (style === 'long') {
    const tube = new THREE.CylinderGeometry(0.105, 0.082, 0.26, 20, 3, true);
    tube.scale(1, 1, 0.9);
    tube.translate(HEAD_CENTRE[0] - JOINTS.head[0], 1.6 - JOINTS.head[1], -0.035 - JOINTS.head[2]);
    const tp = tube.attributes.position;
    const ta = new Float32Array(tp.count * 4);
    const bottom = 1.47 - JOINTS.head[1];
    for (let i = 0; i < tp.count; i++) {
      if (tp.getZ(i) > -0.02) tp.setZ(i, -0.02 + (tp.getZ(i) + 0.02) * 0.2);
      ta.set([1, 1, 1, HAIR_FADE * (0.35 + 0.65 * smooth(bottom, bottom + 0.09, tp.getY(i)))], i * 4);
    }
    tube.setAttribute('color', new THREE.BufferAttribute(ta, 4));
    geo = mergeGeometries([g.toNonIndexed(), tube.toNonIndexed()]);
  }
  geo.computeVertexNormals();
  const t = figureTextures();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: look.hair,
    map: t.hair,
    bumpMap: t.hair,
    bumpScale: 2,
    alphaMap: t.strands,
    alphaTest: 0.5,
    alphaToCoverage: true,
    vertexColors: true,
    roughness: 0.6,
    side: THREE.DoubleSide,
  }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/*
 * Builds a ~1.8 m human facing +Z with its feet at y = 0. look sets colours and
 * style:
 *   body     female, belly (0..1), skirt ('tunic' | 'robe'), age (0..1),
 *            scar (null | 'burn'), gloveL (a colour for a gloved left hand)
 *   head     skin, hair, hairStyle ('short' | 'long' | 'bun' | 'bald'),
 *            beard (null | 'short' | 'full'), stubble, eyes, brows, lips
 *   clothes  tunic, sleeves, trousers, boots, belt, pouch (null for none), trim,
 *            cloak (null for none), cloakTrim
 *   seed     varies the painted skin
 * look.gear(api) adds accessories (a crown, an apron, a staff) to the figure's
 * own mesh, so they cost no extra draw calls; see gearApi below.
 */
export function createFigure(look = {}) {
  const L = {
    skin: 0xbf8b6a,
    hair: 0x3b2516,
    hairStyle: 'short',
    beard: null,
    stubble: true,
    eyes: 0x5a6e3a,
    brows: null,
    lips: 0xb0524a,
    tunic: 0x2a4670,
    sleeves: null,
    trousers: 0x4c3d31,
    boots: 0x4a3322,
    belt: 0x2e2116,
    pouch: 0x6a4a2e,
    trim: 0xb8923e,
    cloak: 0x6e2525,
    cloakTrim: null,
    female: false,
    belly: 0,
    skirt: 'tunic',
    age: 0,
    scar: null,
    gloveL: null,
    seed: 7,
    ...look,
  };
  if (L.brows === null) L.brows = L.hair;
  if (L.female && look.stubble === undefined) L.stubble = false;
  const c = {
    skin: colour(L.skin),
    earHollow: colour(L.skin).multiplyScalar(0.62),
    tunic: colour(L.tunic),
    sleeves: colour(L.sleeves ?? L.tunic),
    trousers: colour(L.trousers),
    boots: colour(L.boots),
    bootCuff: colour(L.boots).multiplyScalar(1.25),
    sole: colour(0x1e150f),
    belt: colour(L.belt),
    pouch: L.pouch === null ? null : colour(L.pouch),
    trim: colour(L.trim),
    gloveL: L.gloveL === null ? null : colour(L.gloveL),
    cloak: L.cloak === null ? null : colour(L.cloak),
    cloakHem: L.cloak === null ? null : L.cloakTrim !== null ? colour(L.cloakTrim) : colour(L.cloak).multiplyScalar(0.75),
  };
  const S = L.female ? FEMALE_HEAD : MALE_HEAD;

  const B = new SkinBuilder();
  buildBody(B, c, L);
  buildHead(B, S);
  if (c.cloak) buildCloak(B, c);

  const bones = {};
  for (const name of BONES) {
    const b = new THREE.Bone();
    b.name = name;
    // Arms bend first, then twist about the parent bone, so poses can fold them across the body.
    if (/Arm|forearm|hand/.test(name)) b.rotation.order = 'YXZ';
    bones[name] = b;
  }
  for (const name of BONES) {
    const j = JOINTS[name];
    const parent = PARENT[name];
    if (parent) {
      const pj = JOINTS[parent];
      bones[name].position.set(j[0] - pj[0], j[1] - pj[1], j[2] - pj[2]);
      bones[parent].add(bones[name]);
    } else {
      bones[name].position.set(j[0], j[1], j[2]);
    }
  }
  if (L.gear) L.gear(gearApi(B, bones));
  const geometry = B.build();

  const shared = figureTextures();
  const face = new THREE.MeshStandardMaterial({ map: paintFace(L), roughness: 0.55, metalness: 0 });
  const mesh = new THREE.SkinnedMesh(geometry, [shared.skin, shared.cloth, face, shared.metal]);
  mesh.add(bones.hips);
  mesh.bind(new THREE.Skeleton(BONES.map((n) => bones[n])));
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const hair = hairMesh(L, S);
  if (hair) bones.head.add(hair);

  const root = new THREE.Group();
  root.add(mesh);
  return { root, mesh, hair, bones, hipsY: JOINTS.hips[1], look: L };
}

/*
 * What look.gear(api) gets:
 *   add(bone, geometry, colorAt, metal)  geometry in bind-pose space (feet at 0,
 *                                        facing +Z), bound rigidly to bone;
 *                                        colorAt(i) gives vertex i's colour
 *   grip(bone, action, time)             a matrix placing an item held in that
 *                                        hand: item space has the grip at the
 *                                        origin, and the item stands upright
 *                                        (+Y up, +Z forward) in that pose
 */
function gearApi(B, bones) {
  return {
    add(bone, geometry, colorAt, metal = false) {
      B.mesh(geometry, metal ? 'metal' : 'skin', bone, colorAt);
    },
    grip(bone, action, time = 0) {
      const a = new FigureAnimator({ bones, hipsY: JOINTS.hips[1] });
      a.action = action;
      a.settle();
      a.time = time;
      a.update(0, 0);
      bones.hips.updateMatrixWorld(true);
      const q = bones[bone].getWorldQuaternion(new THREE.Quaternion()).invert();
      // Back to the bind pose before the skeleton is bound.
      for (const name of BONES) bones[name].rotation.set(0, 0, 0);
      bones.hips.position.set(...JOINTS.hips);
      bones.hips.updateMatrixWorld(true);
      const j = JOINTS[bone];
      const side = bone.endsWith('L') ? -1 : 1;
      return new THREE.Matrix4().compose(new THREE.Vector3(j[0] + side * 0.003, j[1] - 0.055, j[2] + 0.012), q, new THREE.Vector3(1, 1, 1));
    },
  };
}

/*
 * Poses layered over the walk cycle, as target rotations [x, y, z] per bone.
 * A 'carry' pose (holding a staff) stays on while walking; the others fade in
 * only while standing still. right: the pose uses the right arm, so talking
 * gestures switch to the left.
 */
const ACTIONS = {
  // Hands clasped behind the back.
  behind: {
    pose: () => ({
      upperArmL: [0.42, 0, 0.12], forearmL: [-1.45, 1.45, 0], handL: [0, 0, 0],
      upperArmR: [0.42, 0, -0.12], forearmR: [-1.45, -1.45, 0], handR: [0, 0, 0],
    }),
  },
  // Raise the hammer slowly, strike fast, rest; the other hand steadies the work.
  hammer: {
    right: true,
    pose: (t) => {
      const p = (t * 0.9) % 1;
      const k = p < 0.62 ? smooth(0, 0.62, p) : p < 0.74 ? 1 - smooth(0.62, 0.74, p) : 0;
      return {
        upperArmR: [-0.35 - 1.25 * k, 0, 0.12], forearmR: [-0.55 - 0.75 * k, 0, 0], handR: [0.85 - 0.6 * k, 0, 0],
        upperArmL: [-0.55, 0, 0.1], forearmL: [-0.85, 0.3, 0], handL: [0.2, 0, 0],
        spine: [0.12, 0, 0], chest: [0.06, 0, 0], neck: [0.1, 0, 0], head: [0.32, 0, 0],
      };
    },
  },
  // One hand holds a mug, the other polishes it.
  wipe: {
    right: true,
    pose: (t) => ({
      upperArmL: [-0.38, 0, 0.18], forearmL: [-1.4, 0.55, 0], handL: [0, 0, 0],
      upperArmR: [-0.45 + 0.07 * Math.sin(t * 3.2), 0, -0.22], forearmR: [-1.3 + 0.15 * Math.cos(t * 3.2), -0.75, 0], handR: [0.1, 0, 0],
      head: [0.22, 0, 0],
    }),
  },
  // A staff or tool held upright in the right hand.
  staff: {
    carry: true,
    right: true,
    pose: () => ({ upperArmR: [-0.22, 0, 0.14], forearmR: [-1.0, 0, 0], handR: [0, 0, 0] }),
  },
  // Seated on a bench or chair, forearms on the table in front.
  sit: {
    seated: true,
    pose: () => ({ ...SEAT, ...SEAT_ARMS }),
  },
  // Seated with a tankard in the left hand, taking a long drink now and then.
  drink: {
    seated: true,
    right: true,
    pose: (t) => {
      const p = (t * 0.13) % 1;
      const k = p < 0.12 ? smooth(0, 0.12, p) : p < 0.3 ? 1 : p < 0.42 ? 1 - smooth(0.3, 0.42, p) : 0;
      return {
        ...SEAT,
        upperArmR: [-0.5, 0, -0.12], forearmR: [-1.25, -0.25, 0], handR: [0.1, 0, 0],
        upperArmL: [-0.55 - 0.75 * k, 0, 0.14 + 0.2 * k], forearmL: [-1.2 - 1.0 * k, 0.3 + 0.45 * k, 0], handL: [0.1 + 0.4 * k, 0, 0],
        neck: [-0.08 * k, 0, 0], head: [-0.3 * k, 0, 0],
      };
    },
  },
  // Kneading dough on a counter.
  knead: {
    pose: (t) => {
      const a = Math.sin(t * 3.4);
      return {
        spine: [0.16, 0, 0], chest: [0.06, 0, 0], neck: [0.05, 0, 0], head: [0.32, 0, 0],
        upperArmL: [-0.6 - 0.12 * a, 0, 0.2], forearmL: [-0.85 + 0.22 * a, 0.35, 0], handL: [0.55, 0, 0],
        upperArmR: [-0.6 + 0.12 * a, 0, -0.2], forearmR: [-0.85 - 0.22 * a, -0.35, 0], handR: [0.55, 0, 0],
      };
    },
  },
};

// The lower half of a seated figure: thighs level, shins down to the floor.
const SEAT = {
  hips: [0, 0, 0], spine: [0.08, 0, 0],
  thighL: [-1.5, 0, 0.05], shinL: [1.47, 0, 0], footL: [0.03, 0, 0],
  thighR: [-1.5, 0, -0.05], shinR: [1.47, 0, 0], footR: [0.03, 0, 0],
};
const SEAT_ARMS = {
  upperArmL: [-0.5, 0, 0.12], forearmL: [-1.25, 0.25, 0], handL: [0.1, 0, 0],
  upperArmR: [-0.5, 0, -0.12], forearmR: [-1.25, -0.25, 0], handR: [0.1, 0, 0],
};
const SEAT_DROP = 0.44; // how far the hips sink onto a seat

export function isSeated(action) {
  return !!(action && ACTIONS[action] && ACTIONS[action].seated);
}

// Moves a bone's rotation towards [x, y, z] by weight w.
function blendBone(bone, r, w) {
  if (!r || w <= 0) return;
  bone.rotation.x += (r[0] - bone.rotation.x) * w;
  bone.rotation.y += (r[1] - bone.rotation.y) * w;
  bone.rotation.z += (r[2] - bone.rotation.z) * w;
}

/*
 * Procedural animation on the skeleton: walk, run and idle (pelvis sway and
 * twist, counter-rotating shoulders, bending knees and elbows, heel-to-toe
 * feet, a swaying cloak), with optional layers on top:
 *   action   a pose from ACTIONS ('behind', 'hammer', 'wipe', 'staff', 'sit',
 *            'drink', 'knead')
 *   talking  hand gestures and nods while speaking
 *   lookAt   { yaw, pitch } in radians relative to the body, or null
 *   stoop    a permanent forward bend (0..1)
 */
export class FigureAnimator {
  constructor(figure) {
    this.figure = figure;
    this.phase = 0;
    this.moving = 0;
    this.time = Math.random() * 10;
    this.action = null;
    this.talking = false;
    this.lookAt = null;
    this.stoop = 0;
    this._act = 0;
    this._actName = null;
    this._talk = 0;
    this._lookYaw = 0;
    this._lookPitch = 0;
    this._looking = 0;
  }

  // Jumps straight to the current action pose (no fade), e.g. when a figure is first placed.
  settle() {
    this._actName = this.action;
    this._act = this.action ? 1 : 0;
  }

  update(dt, speed) {
    const b = this.figure.bones;
    this.time += dt;
    const target = clamp(speed / WALK_SPEED, 0, 1);
    this.moving += (target - this.moving) * (1 - Math.exp(-10 * dt));
    const running = clamp((speed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED), 0, 1);
    if (speed > 0.1) this.phase += dt * (8.6 + speed * 1.45);

    const m = this.moving;
    const r = running * m;
    const idle = 1 - m;
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const swing = m * (0.5 + running * 0.32);
    const t = this.time;
    const breathe = Math.sin(t * 1.7);

    // Layer weights: the action fades out to change, while walking (unless carried) and while talking.
    const def = this.action ? ACTIONS[this.action] : null;
    const kAct = 1 - Math.exp(-5 * dt);
    if (this._actName !== this.action) {
      this._act -= this._act * kAct * 1.6;
      if (this._act < 0.03) {
        this._actName = this.action;
        this._act = 0;
      }
    } else {
      const want = def && (def.carry || def.seated || (m < 0.15 && !this.talking)) ? 1 : 0;
      this._act += (want - this._act) * kAct;
    }
    this._talk += ((this.talking ? 1 : 0) - this._talk) * (1 - Math.exp(-6 * dt));
    const look = this.lookAt;
    this._looking += ((look ? 1 : 0) - this._looking) * (1 - Math.exp(-4 * dt));
    const kLook = 1 - Math.exp(-6 * dt);
    this._lookYaw += ((look ? clamp(look.yaw, -1.2, 1.2) : 0) - this._lookYaw) * kLook;
    this._lookPitch += ((look ? clamp(look.pitch, -0.5, 0.5) : 0) - this._lookPitch) * kLook;
    const free = 1 - this._looking;
    const bend = this.stoop;

    // Pelvis: bob, twist with the stride, drop on the swinging side, idle weight shift.
    b.hips.position.y = this.figure.hipsY + Math.abs(c) * 0.045 * m - m * 0.025 - r * 0.03 - bend * 0.03;
    b.hips.rotation.set(r * 0.05, -s * 0.1 * m, c * 0.035 * m + Math.sin(t * 0.5) * 0.02 * idle);
    b.spine.rotation.set(r * 0.12 + breathe * 0.008 * idle + bend * 0.32, s * 0.05 * m, -c * 0.02 * m);
    b.chest.rotation.set(r * 0.06 + breathe * 0.012 * idle + bend * 0.2, s * 0.07 * m, 0);
    b.neck.rotation.set(-r * 0.08 - bend * 0.28, -s * 0.05 * m + this._lookYaw * 0.4, 0);
    b.head.rotation.set(
      -r * 0.06 + Math.sin(t * 0.23) * 0.04 * idle * free - bend * 0.18 - this._lookPitch * 0.7,
      (Math.sin(t * 0.37) * 0.3 * idle - s * 0.04 * m) * free + this._lookYaw * 0.6,
      0,
    );

    // Legs: thigh swing, knee bends while the leg comes forward, foot rolls heel to toe.
    const legs = [[b.thighL, b.shinL, b.footL, s, c], [b.thighR, b.shinR, b.footR, -s, -c]];
    for (const [thigh, shin, foot, ls, lc] of legs) {
      thigh.rotation.set(ls * swing - r * 0.1, 0, 0);
      shin.rotation.set(Math.max(0, -lc) * swing * 1.7 + m * 0.06 + r * 0.25, 0, 0);
      const pitch = Math.max(ls, 0) * 0.35 * m - Math.max(-ls, 0) * 0.18 * m;
      foot.rotation.set(pitch - thigh.rotation.x - shin.rotation.x, 0, 0);
    }

    // Arms swing against the legs; elbows bend more when running.
    const arms = [[b.upperArmL, b.forearmL, b.handL, -s, -1], [b.upperArmR, b.forearmR, b.handR, s, 1]];
    for (const [upper, fore, hand, as, side] of arms) {
      upper.rotation.set(as * swing * 0.75, 0, side * (0.06 + breathe * 0.012 * idle + r * 0.08));
      fore.rotation.set(-(0.14 + r * 1.15 + Math.max(0, -as) * 0.35 * m), 0, 0);
      hand.rotation.set(-0.1 - r * 0.2, 0, 0);
    }

    // Action pose; a seated pose also lowers the hips onto the seat.
    const actDef = this._actName ? ACTIONS[this._actName] : null;
    if (actDef && this._act > 0.001) {
      const pose = actDef.pose(t);
      for (const name in pose) blendBone(b[name], pose[name], this._act);
      if (actDef.seated) b.hips.position.y -= SEAT_DROP * this._act;
    }

    // Talking: a hand that gestures (whichever is free) and small nods.
    if (this._talk > 0.001) {
      const left = actDef && actDef.right && actDef.carry;
      const side = left ? -1 : 1;
      const S = left ? 'L' : 'R';
      blendBone(b[`upperArm${S}`], [-0.3 - 0.1 * Math.sin(t * 1.7), 0, side * 0.1], this._talk);
      blendBone(b[`forearm${S}`], [-1.1 - 0.25 * Math.sin(t * 2.9 + 1), -side * 0.35, 0], this._talk);
      blendBone(b[`hand${S}`], [0.3 * Math.sin(t * 2.3), 0, 0], this._talk);
      b.head.rotation.x += Math.sin(t * 5.1) * 0.035 * this._talk;
    }

    // The cloak trails behind as speed builds.
    b.cloak1.rotation.x = 0.08 + m * (0.12 + running * 0.35) + Math.sin(this.phase * 2) * 0.04 * m + Math.sin(t * 1.3) * 0.01 + bend * 0.15;
    b.cloak2.rotation.x = 0.04 + m * (0.1 + running * 0.25) + Math.sin(this.phase * 2 + 0.8) * 0.05 * m;
  }
}

// ------------------------------------------------------------------ player

export class Player {
  constructor(scene, world) {
    this.world = world;
    this.radius = PLAYER_RADIUS;
    this.figure = createFigure();
    this.figure.root.name = 'player';
    this.animator = new FigureAnimator(this.figure);
    scene.add(this.figure.root);

    this.position = new THREE.Vector3(SITES.spawn.x, 0, SITES.spawn.z);
    this.position.y = world.getGroundHeight(this.position.x, this.position.z);
    this.velocity = new THREE.Vector3();
    this.heading = SITES.spawn.heading;
    this.speed = 0;
    this._visualY = this.position.y;
    this._sync();
  }

  /*
   * move: { x, y, magnitude, run } from Input.getMove (x = strafe right, y = forward).
   * cameraYaw: FollowCamera.yaw, so "forward" is always away from the camera.
   */
  update(dt, move, cameraYaw) {
    const pos = this.position;
    const vel = this.velocity;
    const world = this.world;

    const s = Math.sin(cameraYaw);
    const c = Math.cos(cameraYaw);
    const ix = c * move.x - s * move.y;
    const iz = -s * move.x - c * move.y;

    let top = move.run ? RUN_SPEED : WALK_SPEED;
    const depth = WATER_LEVEL - world.getGroundHeight(pos.x, pos.z);
    if (depth > 0.05) top *= 1 - 0.55 * Math.min(1, depth / MAX_WADE_DEPTH);

    const k = 1 - Math.exp(-(move.magnitude > 0.01 ? 10 : 14) * dt);
    vel.x += (ix * top - vel.x) * k;
    vel.z += (iz * top - vel.z) * k;

    const px = pos.x;
    const pz = pos.z;
    this._step(vel.x * dt, vel.z * dt);
    world.colliders.resolve(pos, this.radius, pos.y + 0.15, pos.y + 1.8);
    pos.x = clamp(pos.x, -PLAY_HALF, PLAY_HALF);
    pos.z = clamp(pos.z, -PLAY_HALF, PLAY_HALF);
    pos.y = world.getGroundHeight(pos.x, pos.z);

    this.speed = dt > 0 ? Math.hypot(pos.x - px, pos.z - pz) / dt : 0;
    if (move.magnitude > 0.01 && Math.hypot(vel.x, vel.z) > 0.3) {
      this.heading = dampAngle(this.heading, Math.atan2(vel.x, vel.z), 12, dt);
    }

    this._visualY += (pos.y - this._visualY) * (1 - Math.exp(-30 * dt));
    this.animator.update(dt, this.speed);
    this._sync();
  }

  // Stands still and turns towards (x, z), e.g. to face someone in a conversation.
  faceTowards(x, z, dt) {
    this.velocity.set(0, 0, 0);
    this.speed = 0;
    this.heading = dampAngle(this.heading, Math.atan2(x - this.position.x, z - this.position.z), 8, dt);
    this.animator.update(dt, 0);
    this._sync();
  }

  // Places the player instantly (no smoothing), e.g. when restoring a saved position.
  teleport(x, z, heading = this.heading) {
    this.position.set(x, this.world.getGroundHeight(x, z), z);
    this.velocity.set(0, 0, 0);
    this.heading = heading;
    this._visualY = this.position.y;
    this._sync();
  }

  // Moves by (sx, sz), sliding along whichever axis is still allowed when blocked.
  _step(sx, sz) {
    if (sx === 0 && sz === 0) return;
    const pos = this.position;
    const w = this.world;
    if (w.canStep(pos.x, pos.z, pos.x + sx, pos.z + sz)) {
      pos.x += sx;
      pos.z += sz;
    } else if (sx !== 0 && w.canStep(pos.x, pos.z, pos.x + sx, pos.z)) {
      pos.x += sx;
      this.velocity.z = 0;
    } else if (sz !== 0 && w.canStep(pos.x, pos.z, pos.x, pos.z + sz)) {
      pos.z += sz;
      this.velocity.x = 0;
    } else {
      this.velocity.x = 0;
      this.velocity.z = 0;
    }
  }

  _sync() {
    const root = this.figure.root;
    root.position.set(this.position.x, this._visualY, this.position.z);
    root.rotation.y = this.heading;
  }
}

// ------------------------------------------------------------------ camera

export class FollowCamera {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.yaw = 0;           // 0 = camera south of the target, looking north
    this.pitch = 0.32;      // radians above the horizontal
    this.distance = 6.5;
    this.minDistance = 2.5;
    this.maxDistance = 14;
    this.height = 1.6;      // look-at point above the feet
    this.focus = new THREE.Vector3();
    this._distance = this.distance;
    this._ready = false;
  }

  // Current camera distance after pulling in for obstacles.
  get actualDistance() {
    return this._distance;
  }

  addLook(dYaw, dPitch) {
    this.yaw += dYaw;
    this.pitch = clamp(this.pitch + dPitch, -0.3, 1.25);
  }

  addZoom(amount) {
    if (amount) this.distance = clamp(this.distance * (1 + amount), this.minDistance, this.maxDistance);
  }

  // True where the camera may not be: under ground, above a room's ceiling, inside a wall.
  _blocked(x, y, z) {
    const w = this.world;
    return y < w.getGroundHeight(x, z) + 0.35 || y > w.ceilingAt(x, z, y) - 0.25 || w.cameraBlocked(x, y, z, 0.25);
  }

  update(dt, target, snap = false) {
    const f = this.focus;
    if (snap || !this._ready) {
      f.set(target.x, target.y + this.height, target.z);
      this._distance = this.distance;
      this._ready = true;
    } else {
      const kh = 1 - Math.exp(-14 * dt);
      const kv = 1 - Math.exp(-7 * dt);
      f.x += (target.x - f.x) * kh;
      f.z += (target.z - f.z) * kh;
      f.y += (target.y + this.height - f.y) * kv;
    }

    const cp = Math.cos(this.pitch);
    const dx = Math.sin(this.yaw) * cp;
    const dy = Math.sin(this.pitch);
    const dz = Math.cos(this.yaw) * cp;

    // Pull in when terrain, walls or a ceiling would come between the camera and the player.
    const steps = 14;
    let allowed = this.distance;
    for (let i = 1; i <= steps; i++) {
      const d = (this.distance * i) / steps;
      if (this._blocked(f.x + dx * d, f.y + dy * d, f.z + dz * d)) {
        allowed = (this.distance * (i - 1)) / steps;
        break;
      }
    }
    allowed = Math.max(allowed, 0.6);
    const rate = allowed < this._distance ? 25 : 3.5;
    this._distance += (allowed - this._distance) * (snap ? 1 : 1 - Math.exp(-rate * dt));

    const cam = this.camera;
    cam.position.set(f.x + dx * this._distance, f.y + dy * this._distance, f.z + dz * this._distance);
    const floor = this.world.getGroundHeight(cam.position.x, cam.position.z) + 0.3;
    if (cam.position.y < floor) cam.position.y = floor;
    const ceiling = this.world.ceilingAt(cam.position.x, cam.position.z, cam.position.y) - 0.25;
    if (cam.position.y > ceiling) cam.position.y = ceiling;
    cam.lookAt(f);
  }
}
