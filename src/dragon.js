import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SITES, LAKE, clamp, mulberry32, smoothstep } from './world.js';

/*
 * dragon.js: Old Ember, the dragon of the north-west peaks. One mesh lofted
 * along a spine (tail, body, neck, horned head with a hinged jaw, a ridge of
 * spines, tucked legs) with two membrane wings. The vertex shader (also used
 * for its shadow) beats and folds the wings about shoulder and elbow, sways the
 * spine like a swimming snake and opens the jaw. On the CPU she flies between
 * waypoints over the kingdom, banking into turns, climbing with deep wingbeats
 * and gliding down, breathes fire at the sky now and then, and from time to
 * time lands at her lair on Dragon's Peak to rest before taking off again.
 */

const TAU = Math.PI * 2;
const SPEED = 17;            // cruising speed, m/s
const TURN = 0.32;           // radians per second at full turn
const _c = new THREE.Color();

const DRAGON_PARS = /* glsl */ `
attribute float aSpine;
attribute float aWing;
attribute float aJaw;
uniform float uFlap;
uniform float uFold;
uniform float uSway;
uniform float uSwayAmp;
uniform float uJawOpen;
mat3 dRotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
mat3 dRotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 dWingR() { return dRotZ(uFlap * sign(aWing)); }
vec3 dragonPose(vec3 p) {
  if (abs(aWing) > 0.001) {
    float side = sign(aWing);
    float u = abs(aWing);
    vec3 S = vec3(1.1 * side, 0.9, 1.6);
    vec3 E = vec3(6.5 * side, 1.2, 0.8);
    mat3 R1 = dWingR();
    p = R1 * (p - S) + S;
    vec3 E1 = R1 * (E - S) + S;
    float w = smoothstep(0.32, 0.55, u);
    p = mix(p, dRotZ(uFold * side) * (p - E1) + E1, w);
  }
  if (aJaw > 0.5) {
    vec3 J = vec3(0.0, 0.05, 7.6);
    p = dRotX(uJawOpen * 0.55) * (p - J) + J;
  }
  float s = aSpine;
  float amp = uSwayAmp * (s < 0.0 ? s * s * 2.2 : s * s * 0.7);
  p.x += sin(uSway + s * 3.6) * amp;
  p.y += sin(uSway * 0.5 + s * 2.8) * amp * 0.35;
  return p;
}
`;

function dragonMaterial(material, uniforms, key) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${DRAGON_PARS}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed = dragonPose(transformed);');
    if (shader.vertexShader.includes('#include <beginnormal_vertex>')) {
      shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  if (abs(aWing) > 0.001) objectNormal = dWingR() * objectNormal;');
    }
  };
  material.customProgramCacheKey = () => key;
  return material;
}

// Gives a part its colours and animation attributes; spine(z) gives aSpine per vertex.
function part(geometry, color, { spine = null, wing = null, jaw = 0 } = {}) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g.attributes.uv) g.deleteAttribute('uv');
  const p = g.attributes.position;
  const n = p.count;
  const col = new Float32Array(n * 3);
  const sp = new Float32Array(n);
  const wg = new Float32Array(n);
  const jw = new Float32Array(n).fill(jaw);
  const nrm = g.attributes.normal;
  for (let i = 0; i < n; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    if (typeof color === 'function') color(x, y, z, nrm ? nrm.getY(i) : 0, _c);
    else _c.set(color);
    col.set([_c.r, _c.g, _c.b], i * 3);
    sp[i] = spine ? spine(z) : 0;
    wg[i] = wing ? wing(x, y, z) : 0;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSpine', new THREE.BufferAttribute(sp, 1));
  g.setAttribute('aWing', new THREE.BufferAttribute(wg, 1));
  g.setAttribute('aJaw', new THREE.BufferAttribute(jw, 1));
  return g;
}

const BACK = new THREE.Color(0x7a1e14);
const BELLY = new THREE.Color(0xd0a050);
const MEMBRANE = new THREE.Color(0x9a3a24);
const BONE = new THREE.Color(0x4a1610);
const HORN = new THREE.Color(0xe8dcc8);

// Spine position from the tail tip (-1) through the body (0) to the snout (+1).
function spineAt(z) {
  return z < 0 ? Math.max(-1, z / 15) : Math.min(1, z / 10);
}

// Scales: dark red above, gold below, flecked.
function scales(x, y, z, ny, out) {
  out.copy(BACK).lerp(BELLY, smoothstep(-0.1, -0.6, ny));
  out.multiplyScalar(0.85 + 0.3 * Math.abs(Math.sin(x * 9.1 + z * 5.3) * Math.sin(y * 7.7 - z * 3.1)));
}

// The body: rings lofted along the spine from the tail tip to the back of the head.
function bodyGeometry() {
  const prof = [
    [-15, 0.1, 0.1], [-12, 0.32, 0.3], [-9, 0.55, 0.5], [-6, 0.85, 0.8], [-3.5, 1.25, 1.15], [-1, 1.65, 1.5],
    [1, 1.7, 1.55], [2.6, 1.35, 1.3], [3.8, 0.85, 0.85], [5, 0.62, 0.62], [6.4, 0.55, 0.58], [7.3, 0.62, 0.64],
  ];
  const around = 14;
  const pos = [];
  for (const [z, rx, ry] of prof) {
    // The neck rises towards the head.
    const lift = z > 3 ? (z - 3) * 0.32 : 0;
    for (let j = 0; j <= around; j++) {
      const a = (j / around) * TAU;
      pos.push(Math.sin(a) * rx, Math.cos(a) * ry * (Math.cos(a) < 0 ? 0.85 : 1) + lift, z);
    }
  }
  const index = [];
  for (let i = 0; i < prof.length - 1; i++) {
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
  return g;
}

/*
 * A wing as a grid between its leading edge (shoulder, elbow, wrist, tip) and
 * its scalloped trailing edge back to the flank. aWing carries the side (sign)
 * and the fraction of the span (0 at the shoulder, 1 at the tip).
 */
function wingGeometry(side) {
  const lead = [[1.1, 0.9, 1.6], [6.5, 1.2, 0.8], [10.5, 0.9, -0.6], [16.5, 0.2, -3.4]];
  const trail = [[1.3, 0.4, -4.2], [6.5, 0.1, -6.6], [11, 0.1, -8.6], [16.5, 0.2, -3.6]];
  const nu = 18;
  const nv = 6;
  const along = (pts, u) => {
    const f = u * (pts.length - 1);
    const i = Math.min(pts.length - 2, Math.floor(f));
    const t = f - i;
    return pts[i].map((v, k) => v + (pts[i + 1][k] - v) * t);
  };
  const pos = [];
  for (let i = 0; i <= nu; i++) {
    const u = i / nu;
    const a = along(lead, u);
    const b = along(trail, u);
    // Scallops between the finger bones.
    const scallop = Math.abs(Math.sin(u * Math.PI * 3)) * 0.9 * smoothstep(0.3, 0.6, u);
    for (let j = 0; j <= nv; j++) {
      const v = j / nv;
      const x = (a[0] + (b[0] - a[0]) * v) * side;
      const y = a[1] + (b[1] - a[1]) * v - Math.sin(v * Math.PI) * 0.35;
      const z = a[2] + (b[2] - a[2]) * v + scallop * v * v;
      pos.push(x, y, z);
    }
  }
  const index = [];
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = i * (nv + 1) + j;
      const b = a + nv + 1;
      if (side > 0) index.push(a, a + 1, b, a + 1, b + 1, b);
      else index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  const span = 16.5;
  const parts = [part(g, (x, y, z, ny, out) => out.copy(MEMBRANE).multiplyScalar(0.8 + 0.3 * Math.abs(x) / span), { wing: (x) => side * clamp(Math.abs(x) / span, 0.001, 1) })];
  // Arm and finger bones along the leading edge and out to the scallops.
  const bone = (p0, p1, r) => {
    const d = new THREE.Vector3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    const c = new THREE.CylinderGeometry(r * 0.7, r, d.length(), 6);
    c.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3((p0[0] + p1[0]) / 2 * side, (p0[1] + p1[1]) / 2 + 0.05, (p0[2] + p1[2]) / 2),
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(d.x * side, d.y, d.z).normalize()),
      new THREE.Vector3(1, 1, 1),
    ));
    parts.push(part(c, BONE, { wing: (x) => side * clamp(Math.abs(x) / span, 0.001, 1) }));
  };
  bone(lead[0], lead[1], 0.28);
  bone(lead[1], lead[2], 0.22);
  bone(lead[2], lead[3], 0.12);
  for (const f of [0.55, 0.75]) bone(lead[2], along(trail, f), 0.08);
  parts.push(part(new THREE.ConeGeometry(0.16, 0.7, 5).rotateZ(-side * Math.PI / 2).translate(10.5 * side + side * 0.2, 1.25, -0.6), HORN, { wing: () => side * 0.64 }));
  return parts;
}

function dragonGeometry() {
  const parts = [part(bodyGeometry(), scales, { spine: spineAt })];
  const head = (g, color, opts = {}) => parts.push(part(g, color, { spine: () => 1, ...opts }));
  // Head: skull, snout, jaw, horns, brow ridges, eyes and nostrils.
  head(new THREE.BoxGeometry(1.2, 0.9, 1.6).translate(0, 1.85, 7.9), scales);
  head(new THREE.BoxGeometry(0.85, 0.55, 1.8).translate(0, 1.72, 9.4), scales);
  head(new THREE.BoxGeometry(0.8, 0.3, 2.4).translate(0, 1.22, 8.9), BELLY, { jaw: 1 });
  for (let k = -2; k <= 2; k++) head(new THREE.ConeGeometry(0.05, 0.22, 4).rotateX(Math.PI).translate(k * 0.14, 1.36, 9.9), HORN, { jaw: 1 });
  for (const s of [-1, 1]) {
    head(new THREE.ConeGeometry(0.16, 1.7, 6).rotateX(-Math.PI / 2 - 0.5).translate(s * 0.45, 2.45, 7.0), HORN);
    head(new THREE.ConeGeometry(0.09, 0.9, 5).rotateX(-Math.PI / 2 - 0.2).translate(s * 0.6, 1.9, 7.2), HORN);
    head(new THREE.BoxGeometry(0.22, 0.14, 0.6).translate(s * 0.48, 2.28, 8.3), BACK);
    head(new THREE.SphereGeometry(0.1, 8, 6).translate(s * 0.58, 2.12, 8.45), 0xffc830);
    head(new THREE.SphereGeometry(0.06, 6, 4).translate(s * 0.22, 1.98, 10.25), 0x2a0a06);
  }
  // A ridge of spines from the head down to the tail.
  for (let z = -13; z < 7; z += 0.85) {
    const top = (z > 3 ? (z - 3) * 0.32 : 0) + (z < -6 ? 0.4 + (z + 15) * 0.05 : z < -1 ? 1.0 : z < 3 ? 1.5 : 0.62);
    const h = z > 5 ? 0.25 : 0.5 + Math.max(0, 1 - Math.abs(z + 1) / 8) * 0.4;
    parts.push(part(new THREE.ConeGeometry(0.16, h, 4).translate(0, top + h / 2 - 0.05, z), HORN, { spine: () => spineAt(z) }));
  }
  // A spade at the tail's tip.
  parts.push(part(new THREE.ConeGeometry(0.55, 1.2, 4).rotateX(-Math.PI / 2).scale(1, 0.25, 1).translate(0, 0.1, -15.3), BACK, { spine: () => -1 }));
  // Legs tucked up under the body.
  for (const s of [-1, 1]) {
    parts.push(part(new THREE.CylinderGeometry(0.28, 0.22, 2.0, 7).rotateX(1.2).translate(s * 1.1, -1.2, 1.4), scales, { spine: () => 0.1 }));
    parts.push(part(new THREE.CylinderGeometry(0.42, 0.3, 2.6, 7).rotateX(1.4).translate(s * 1.2, -1.0, -2.8), scales, { spine: () => -0.2 }));
    for (let k = -1; k <= 1; k++) parts.push(part(new THREE.ConeGeometry(0.06, 0.4, 4).rotateX(Math.PI / 2 + 0.6).translate(s * 1.1 + k * 0.12, -1.55, 2.3), HORN, { spine: () => 0.1 }));
  }
  parts.push(...wingGeometry(1), ...wingGeometry(-1));
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  g.boundingSphere.radius += 6;
  return g;
}

// A stream of fire: a few stretched, flickering cones ahead of the jaw.
function fireGeometry() {
  const parts = [];
  for (let k = 0; k < 4; k++) {
    // Each cone's tip sits at the jaw and its mouth opens out ahead.
    const L = 4 + k * 2.5;
    const c = new THREE.ConeGeometry(0.5 + k * 0.35, L, 8, 4, true).rotateX(-Math.PI / 2).translate(0, 0, L / 2 + 0.3);
    if (c.attributes.uv) c.deleteAttribute('uv');
    // White-yellow at the jaw, through orange to a dark red edge.
    const p = c.attributes.position;
    const col = new Float32Array(p.count * 3);
    const hot = new THREE.Color(0xfff2a0);
    const cool = new THREE.Color(k < 2 ? 0xff8a20 : 0xc8301a);
    for (let i = 0; i < p.count; i++) {
      _c.copy(hot).lerp(cool, Math.min(1, p.getZ(i) / (L * 0.8)));
      col.set([_c.r, _c.g, _c.b], i * 3);
    }
    c.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(c);
  }
  return mergeGeometries(parts, false);
}

export class Dragon {
  constructor(scene, world) {
    this.world = world;
    this.uniforms = {
      uFlap: { value: 0 },
      uFold: { value: 0 },
      uSway: { value: 0 },
      uSwayAmp: { value: 0.6 },
      uJawOpen: { value: 0 },
    };
    const material = dragonMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15, side: THREE.DoubleSide }), this.uniforms, 'dragon');
    this.mesh = new THREE.Mesh(dragonGeometry(), material);
    this.mesh.customDepthMaterial = dragonMaterial(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide }), this.uniforms, 'dragon-depth');
    this.mesh.castShadow = true;
    this.mesh.name = 'dragon';
    this.group = new THREE.Group();
    this.group.add(this.mesh);
    this.fire = new THREE.Mesh(fireGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    this.fire.position.set(0, 1.6, 10.2);
    this.fire.visible = false;
    this.mesh.add(this.fire);
    scene.add(this.group);

    this.rng = mulberry32(31337);
    const p = SITES.dragonPeak;
    this.pos = new THREE.Vector3(p.x + 150, 200, p.z + 150);
    this.heading = 0.6;
    this.pitch = 0;
    this.roll = 0;
    this.speed = SPEED;
    this.phase = 0;
    this.state = 'fly';
    this.timer = 0;
    this.fireTimer = 8;
    this.breath = 0;
    // Where she likes to fly: over the peaks, the woods, the castle, the town, the lake and the farms.
    this.waypoints = [
      { x: p.x + 60, z: p.z + 80, alt: 170 },
      { x: -260, z: -60, alt: 120 },
      { x: 0, z: -190, alt: 115 },
      { x: 20, z: 10, alt: 95 },
      { x: LAKE.x, z: LAKE.z, alt: 90 },
      { x: SITES.lighthouse.x, z: SITES.lighthouse.z, alt: 75 },
      { x: SITES.millbrook.x, z: SITES.millbrook.z, alt: 110 },
      { x: -300, z: 300, alt: 130 },
      { x: 300, z: -300, alt: 150 },
    ];
    this.target = this.waypoints[0];
    this.legs = 0;
    this.time = 0;
    this.update(0);
  }

  _pick() {
    this.legs++;
    // Every few legs, head home to the lair to rest.
    if (this.legs % 7 === 0 && this.world.lair) {
      const l = this.world.lair;
      this.target = { x: l.x, z: l.z, alt: 0, land: true };
      return;
    }
    let next;
    do next = this.waypoints[Math.floor(this.rng() * this.waypoints.length)];
    while (next === this.target);
    this.target = next;
  }

  update(dt) {
    this.time += dt;
    const w = this.world;
    const u = this.uniforms;
    const p = this.pos;
    const t = this.target;

    if (this.state === 'perched') {
      // Resting at the lair: wings folded, head swaying, the odd puff of smoke and flame.
      this.timer -= dt;
      u.uFlap.value += (-0.25 - u.uFlap.value) * Math.min(1, dt * 2);
      u.uFold.value += (-2.2 - u.uFold.value) * Math.min(1, dt * 2);
      u.uSwayAmp.value = 0.25;
      u.uSway.value += dt * 0.6;
      this.pitch += (0 - this.pitch) * Math.min(1, dt * 2);
      this.roll += (0 - this.roll) * Math.min(1, dt * 2);
      this._breathe(dt, 0.3);
      if (this.timer <= 0) {
        this.state = 'takeoff';
        this.timer = 6;
        this._pick();
      }
      this._place();
      return;
    }

    // Steer towards the target, climbing or diving to its height above the land.
    const ground = w.getHeight(p.x, p.z);
    const dx = t.x - p.x;
    const dz = t.z - p.z;
    const dist = Math.hypot(dx, dz);
    const want = Math.atan2(dx, dz);
    const diff = Math.atan2(Math.sin(want - this.heading), Math.cos(want - this.heading));
    const turn = clamp(diff, -1, 1) * TURN * (t.land && dist < 120 ? (dist < 50 ? 4 : 1.8) : 1);
    this.heading += turn * dt;
    let altWant;
    if (t.land) altWant = dist < 70 ? t.y ?? w.lair.y : Math.max(w.getHeight(t.x, t.z), ground) + 40 + dist * 0.15;
    else altWant = Math.max(ground + 55, w.getHeight(t.x, t.z) + t.alt);
    if (this.state === 'takeoff') {
      this.timer -= dt;
      altWant = ground + 80;
      if (this.timer <= 0) this.state = 'fly';
    }
    const climb = clamp((altWant - p.y) * 0.25, -9, 7);
    const speed = t.land && dist < 60 ? Math.max(4, dist * 0.25) : this.state === 'takeoff' ? 9 : SPEED;
    this.speed += (speed - this.speed) * Math.min(1, dt * 0.8);
    p.x += Math.sin(this.heading) * this.speed * dt;
    p.z += Math.cos(this.heading) * this.speed * dt;
    p.y += climb * dt;
    p.y = Math.max(p.y, ground + (t.land && dist < 30 ? 1.2 : 20));

    this.pitch += (-Math.atan2(climb, this.speed) * 0.8 - this.pitch) * Math.min(1, dt * 1.5);
    this.roll += (-turn * 1.7 - this.roll) * Math.min(1, dt * 1.5);

    // Deep, slow wingbeats while climbing, slowing down or landing; long glides otherwise.
    const effort = clamp(climb / 5, 0, 1) + (this.state === 'takeoff' || (t.land && dist < 80) ? 1 : 0);
    const gliding = effort < 0.1 && Math.sin(this.time * 0.11) > -0.2;
    this.phase += dt * (gliding ? 0.6 : 2.6 + effort * 1.2);
    const beat = gliding ? 0.12 + Math.sin(this.phase) * 0.06 : Math.sin(this.phase) * (0.75 + effort * 0.25) + 0.1;
    u.uFlap.value += (beat - u.uFlap.value) * Math.min(1, dt * 8);
    const fold = gliding ? -0.05 : -Math.max(0, -Math.sin(this.phase)) * 0.7;
    u.uFold.value += (fold - u.uFold.value) * Math.min(1, dt * 6);
    u.uSway.value += dt * (gliding ? 0.9 : 1.6);
    u.uSwayAmp.value = 0.55;
    this._breathe(dt, 1);

    if (t.land && dist < 6 && Math.abs(p.y - (w.lair ? w.lair.y : p.y)) < 4) {
      this.state = 'perched';
      this.timer = 35 + this.rng() * 25;
      p.set(w.lair.x, w.lair.y + 1.2, w.lair.z);
    } else if (!t.land && dist < 40) {
      this._pick();
    }
    this._place();
  }

  // Now and then a gout of fire at the sky (rarely when resting).
  _breathe(dt, keen) {
    this.fireTimer -= dt * keen;
    if (this.fireTimer <= 0 && this.breath <= 0) {
      this.breath = 2.5;
      this.fireTimer = 18 + this.rng() * 20;
    }
    const u = this.uniforms;
    if (this.breath > 0) {
      this.breath -= dt;
      const k = smoothstep(0, 0.4, 2.5 - this.breath) * smoothstep(0, 0.5, this.breath);
      u.uJawOpen.value = k;
      this.fire.visible = k > 0.05;
      this.fire.scale.set(0.6 + k * 0.6, 0.6 + k * 0.6, k * (1 + Math.sin(this.time * 30) * 0.1));
      this.fire.material.opacity = 0.75 * k;
    } else {
      u.uJawOpen.value += (0 - u.uJawOpen.value) * Math.min(1, dt * 4);
      this.fire.visible = false;
    }
  }

  _place() {
    this.group.position.copy(this.pos);
    this.mesh.rotation.set(this.pitch, this.heading, this.roll, 'YXZ');
  }
}
