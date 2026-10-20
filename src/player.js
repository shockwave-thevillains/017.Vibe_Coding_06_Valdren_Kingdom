import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SITES, PLAY_HALF, WATER_LEVEL, MAX_WADE_DEPTH, clamp } from './world.js';

/*
 * player.js: the jointed humanoid figure (shared with NPCs), its procedural
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

// One material for every figure; part colours live in vertex colours so each
// limb is a single mesh (11 draw calls per figure).
const FIGURE_MATERIAL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
const geometryCache = new Map();

function cached(key, make) {
  let g = geometryCache.get(key);
  if (!g) {
    g = make();
    geometryCache.set(key, g);
  }
  return g;
}

const cyl = (rt, rb, h, seg = 10) => cached(`c${rt}|${rb}|${h}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
const box = (w, h, d) => cached(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
const ball = (r) => cached(`s${r}`, () => new THREE.SphereGeometry(r, 14, 10));
const cap = (r) => cached(`h${r}`, () => new THREE.SphereGeometry(r, 14, 8, 0, TAU, 0, Math.PI * 0.56));

// Collects coloured, positioned primitives and merges them into one mesh.
export class PartList {
  constructor() {
    this.parts = [];
  }

  add(geometry, color, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (g.attributes.uv) g.deleteAttribute('uv');
    g.scale(sx, sy, sz);
    if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
    g.translate(x, y, z);
    const col = new THREE.Color(color);
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      c[i * 3] = col.r;
      c[i * 3 + 1] = col.g;
      c[i * 3 + 2] = col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    this.parts.push(g);
    return this;
  }

  mesh() {
    const m = new THREE.Mesh(mergeGeometries(this.parts), FIGURE_MATERIAL);
    for (const g of this.parts) g.dispose();
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
}

export const FIGURE_SHAPES = { cyl, box, ball, cap };

/*
 * Builds a ~1.8 m humanoid facing +Z with its feet at y = 0. Hips, knees,
 * shoulders and elbows are pivot groups so the limbs can swing and bend.
 * Pass colours to dress it; cloak: null leaves the cloak off. An optional
 * look.decorate(parts, shapes) can add accessories to any part list
 * (torso, head, thighL/R, shinL/R, upperArmL/R, forearmL/R, cloak).
 */
export function createFigure(look = {}) {
  const c = {
    skin: 0xd9a77c,
    hair: 0x4a2f1b,
    tunic: 0x2f4f7f,
    sleeves: null,
    trim: 0xc9a14a,
    belt: 0x3a2818,
    legs: 0x4a3b2c,
    boots: 0x2a1e14,
    cloak: 0x6b2626,
    ...look,
  };
  const sleeves = c.sleeves ?? c.tunic;
  const parts = {
    torso: new PartList(),
    head: new PartList(),
    thighL: new PartList(),
    thighR: new PartList(),
    shinL: new PartList(),
    shinR: new PartList(),
    upperArmL: new PartList(),
    upperArmR: new PartList(),
    forearmL: new PartList(),
    forearmR: new PartList(),
    cloak: new PartList(),
  };

  // Torso, skirt, belt and buckle, collar, shoulders, neck.
  parts.torso
    .add(cyl(0.2, 0.21, 0.2), c.legs, 0, 0.98, 0, 1, 1, 0.75)
    .add(cyl(0.22, 0.28, 0.36), c.tunic, 0, 0.93, 0, 1, 1, 0.78)
    .add(cyl(0.25, 0.205, 0.52), c.tunic, 0, 1.27, 0, 1, 1, 0.66)
    .add(cyl(0.215, 0.215, 0.07), c.belt, 0, 1.06, 0, 1, 1, 0.74)
    .add(box(0.07, 0.06, 0.03), c.trim, 0, 1.06, 0.16)
    .add(cyl(0.12, 0.2, 0.06), c.trim, 0, 1.52, 0, 1, 1, 0.75)
    .add(ball(0.085), sleeves, -0.25, 1.45, 0)
    .add(ball(0.085), sleeves, 0.25, 1.45, 0)
    .add(cyl(0.055, 0.06, 0.1), c.skin, 0, 1.56, 0);

  // Head (local to the head pivot at 1.69 m).
  parts.head
    .add(ball(0.115), c.skin, 0, 0, 0, 0.92, 1.08, 1)
    .add(cap(0.123), c.hair, 0, 0.012, -0.008, 0.95, 1.05, 1.02)
    .add(box(0.2, 0.12, 0.05), c.hair, 0, -0.03, -0.095)
    .add(box(0.034, 0.05, 0.045), c.skin, 0, -0.012, 0.11);
  for (const side of [-1, 1]) {
    parts.head
      .add(box(0.032, 0.02, 0.02), 0x1a1410, side * 0.042, 0.018, 0.111)
      .add(box(0.05, 0.013, 0.016), c.hair, side * 0.042, 0.046, 0.108)
      .add(ball(0.025), c.skin, side * 0.108, -0.005, 0, 0.5, 1, 0.8);
  }

  // Limbs, each local to its own pivot.
  for (const [side, thigh, shin, upper, fore] of [
    [-1, parts.thighL, parts.shinL, parts.upperArmL, parts.forearmL],
    [1, parts.thighR, parts.shinR, parts.upperArmR, parts.forearmR],
  ]) {
    void side;
    thigh.add(cyl(0.085, 0.07, 0.46), c.legs, 0, -0.23, 0);
    shin
      .add(cyl(0.066, 0.052, 0.42), c.legs, 0, -0.21, 0)
      .add(cyl(0.075, 0.07, 0.16), c.boots, 0, -0.33, 0)
      .add(box(0.12, 0.13, 0.27), c.boots, 0, -0.44, 0.04);
    upper.add(cyl(0.056, 0.05, 0.3), sleeves, 0, -0.15, 0);
    fore
      .add(cyl(0.049, 0.04, 0.27), sleeves, 0, -0.135, 0)
      .add(cyl(0.05, 0.05, 0.05), c.trim, 0, -0.25, 0)
      .add(box(0.06, 0.09, 0.04), c.skin, 0, -0.32, 0.01);
  }
  if (c.cloak !== null) parts.cloak.add(box(0.52, 0.98, 0.03), c.cloak, 0, -0.49, 0);

  if (look.decorate) look.decorate(parts, FIGURE_SHAPES);

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  body.add(parts.torso.mesh());

  const head = new THREE.Group();
  head.position.set(0, 1.69, 0);
  head.add(parts.head.mesh());
  body.add(head);

  const legs = [];
  const knees = [];
  const arms = [];
  const elbows = [];
  for (const [side, thigh, shin, upper, fore] of [
    [-1, parts.thighL, parts.shinL, parts.upperArmL, parts.forearmL],
    [1, parts.thighR, parts.shinR, parts.upperArmR, parts.forearmR],
  ]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.11, 0.97, 0);
    hip.add(thigh.mesh());
    const knee = new THREE.Group();
    knee.position.set(0, -0.46, 0);
    knee.add(shin.mesh());
    hip.add(knee);
    body.add(hip);
    legs.push(hip);
    knees.push(knee);

    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.27, 1.45, 0);
    shoulder.add(upper.mesh());
    const elbow = new THREE.Group();
    elbow.position.set(0, -0.3, 0);
    elbow.add(fore.mesh());
    shoulder.add(elbow);
    body.add(shoulder);
    arms.push(shoulder);
    elbows.push(elbow);
  }

  let cloak = null;
  if (parts.cloak.parts.length) {
    cloak = new THREE.Group();
    cloak.position.set(0, 1.5, -0.14);
    cloak.add(parts.cloak.mesh());
    body.add(cloak);
  }

  return {
    root,
    body,
    head,
    legL: legs[0],
    legR: legs[1],
    kneeL: knees[0],
    kneeR: knees[1],
    armL: arms[0],
    armR: arms[1],
    elbowL: elbows[0],
    elbowR: elbows[1],
    cloak,
  };
}

// Procedural walk / run / idle cycle with bending knees and elbows.
export class FigureAnimator {
  constructor(figure) {
    this.figure = figure;
    this.phase = 0;
    this.moving = 0;
    this.time = Math.random() * 10;
  }

  update(dt, speed) {
    const f = this.figure;
    this.time += dt;
    const target = clamp(speed / WALK_SPEED, 0, 1);
    this.moving += (target - this.moving) * (1 - Math.exp(-10 * dt));
    const running = clamp((speed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED), 0, 1);
    if (speed > 0.1) this.phase += dt * (9 + speed * 1.5);

    const m = this.moving;
    const swing = m * (0.55 + running * 0.3);
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const breathe = Math.sin(this.time * 1.8) * (1 - m);

    // A leg bends at the knee while it swings forward.
    f.legL.rotation.x = s * swing;
    f.legR.rotation.x = -s * swing;
    f.kneeL.rotation.x = Math.max(0, -c) * swing * 1.5 + m * 0.05;
    f.kneeR.rotation.x = Math.max(0, c) * swing * 1.5 + m * 0.05;
    f.armL.rotation.x = -s * swing * 0.8;
    f.armR.rotation.x = s * swing * 0.8;
    f.elbowL.rotation.x = -(0.12 + running * 1.0 * m + Math.max(0, s) * 0.35 * m);
    f.elbowR.rotation.x = -(0.12 + running * 1.0 * m + Math.max(0, -s) * 0.35 * m);
    f.armL.rotation.z = -0.07 - breathe * 0.025;
    f.armR.rotation.z = 0.07 + breathe * 0.025;
    f.body.position.y = Math.abs(c) * 0.055 * m - m * 0.02 + breathe * 0.005;
    f.body.rotation.x = running * 0.16 * m;
    f.head.rotation.x = -running * 0.12 * m;
    f.head.rotation.y = Math.sin(this.time * 0.37) * 0.15 * (1 - m);
    if (f.cloak) f.cloak.rotation.x = 0.12 + m * (0.15 + running * 0.4) + Math.sin(this.phase * 2) * 0.05 * m;
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
    return y < w.getGroundHeight(x, z) + 0.35 || y > w.ceilingAt(x, z) - 0.25 || w.cameraBlocked(x, y, z, 0.25);
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
    const ceiling = this.world.ceilingAt(cam.position.x, cam.position.z) - 0.25;
    if (cam.position.y > ceiling) cam.position.y = ceiling;
    cam.lookAt(f);
  }
}
