import * as THREE from 'three';
import { SITES, PLAY_HALF, WATER_LEVEL, MAX_WADE_DEPTH, clamp } from './world.js';

/*
 * player.js: the low-poly figure (shared with NPCs), the player controller,
 * and the third-person follow camera.
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

const materialCache = new Map();
const boxCache = new Map();

function material(color) {
  let m = materialCache.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: true });
    materialCache.set(color, m);
  }
  return m;
}

function box(w, h, d) {
  const key = `${w}|${h}|${d}`;
  let g = boxCache.get(key);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    boxCache.set(key, g);
  }
  return g;
}

const skirtGeometry = new THREE.CylinderGeometry(0.26, 0.29, 0.36, 8);

function part(geometry, color, x, y, z, parent) {
  const mesh = new THREE.Mesh(geometry, material(color));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/*
 * Builds a ~1.95 m humanoid from boxes, facing +Z with its feet at y = 0.
 * Limbs hang from pivot groups so they can swing. Pass colours to dress it;
 * cloak: null leaves the cloak off.
 */
export function createFigure(look = {}) {
  const c = {
    skin: 0xd9a77c,
    hair: 0x4a2f1b,
    tunic: 0x2f4f7f,
    sleeves: null,
    trim: 0xc9a14a,
    legs: 0x4a3b2c,
    boots: 0x2a1e14,
    cloak: 0x6b2626,
    ...look,
  };
  const sleeves = c.sleeves ?? c.tunic;

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const legL = new THREE.Group();
  legL.position.set(-0.12, 0.92, 0);
  part(box(0.19, 0.78, 0.21), c.legs, 0, -0.39, 0, legL);
  part(box(0.21, 0.16, 0.3), c.boots, 0, -0.84, 0.04, legL);
  const legR = new THREE.Group();
  legR.position.set(0.12, 0.92, 0);
  part(box(0.19, 0.78, 0.21), c.legs, 0, -0.39, 0, legR);
  part(box(0.21, 0.16, 0.3), c.boots, 0, -0.84, 0.04, legR);
  body.add(legL, legR);

  part(skirtGeometry, c.tunic, 0, 0.9, 0, body);
  part(box(0.48, 0.52, 0.28), c.tunic, 0, 1.33, 0, body);
  part(box(0.5, 0.07, 0.3), c.trim, 0, 1.08, 0, body);
  part(box(0.12, 0.08, 0.12), c.skin, 0, 1.63, 0, body);

  const head = new THREE.Group();
  head.position.set(0, 1.79, 0);
  part(box(0.28, 0.3, 0.28), c.skin, 0, 0, 0, head);
  part(box(0.3, 0.1, 0.3), c.hair, 0, 0.15, -0.01, head);
  part(box(0.3, 0.2, 0.08), c.hair, 0, 0.04, -0.12, head);
  part(box(0.05, 0.04, 0.02), 0x1a1410, -0.065, 0.02, 0.145, head);
  part(box(0.05, 0.04, 0.02), 0x1a1410, 0.065, 0.02, 0.145, head);
  body.add(head);

  const armL = new THREE.Group();
  armL.position.set(-0.31, 1.55, 0);
  part(box(0.13, 0.56, 0.15), sleeves, 0, -0.26, 0, armL);
  part(box(0.12, 0.12, 0.12), c.skin, 0, -0.6, 0, armL);
  const armR = new THREE.Group();
  armR.position.set(0.31, 1.55, 0);
  part(box(0.13, 0.56, 0.15), sleeves, 0, -0.26, 0, armR);
  part(box(0.12, 0.12, 0.12), c.skin, 0, -0.6, 0, armR);
  body.add(armL, armR);

  let cloak = null;
  if (c.cloak !== null) {
    cloak = new THREE.Group();
    cloak.position.set(0, 1.58, -0.17);
    part(box(0.52, 0.9, 0.04), c.cloak, 0, -0.45, 0, cloak);
    body.add(cloak);
  }

  return { root, body, head, armL, armR, legL, legR, cloak };
}

// Procedural walk / run / idle cycle for a figure.
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
    const swing = m * (0.55 + running * 0.35);
    const s = Math.sin(this.phase);
    const breathe = Math.sin(this.time * 1.8) * (1 - m);

    f.legL.rotation.x = s * swing;
    f.legR.rotation.x = -s * swing;
    f.armL.rotation.x = -s * swing * 0.85;
    f.armR.rotation.x = s * swing * 0.85;
    f.armL.rotation.z = -0.06 - breathe * 0.025;
    f.armR.rotation.z = 0.06 + breathe * 0.025;
    f.body.position.y = Math.abs(Math.cos(this.phase)) * 0.06 * m + breathe * 0.006;
    f.body.rotation.x = running * 0.14 * m;
    f.head.rotation.x = -running * 0.1 * m;
    if (f.cloak) f.cloak.rotation.x = 0.17 + m * (0.12 + running * 0.35) + Math.sin(this.phase * 2) * 0.05 * m;
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
    world.colliders.resolve(pos, this.radius);
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

  addLook(dYaw, dPitch) {
    this.yaw += dYaw;
    this.pitch = clamp(this.pitch + dPitch, -0.3, 1.25);
  }

  addZoom(amount) {
    if (amount) this.distance = clamp(this.distance * (1 + amount), this.minDistance, this.maxDistance);
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

    // Pull in when the terrain would block the view of the player.
    let allowed = this.distance;
    for (let i = 1; i <= 12; i++) {
      const d = (this.distance * i) / 12;
      const x = f.x + dx * d;
      const z = f.z + dz * d;
      if (f.y + dy * d < this.world.getGroundHeight(x, z) + 0.35) {
        allowed = (this.distance * (i - 1)) / 12;
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
    cam.lookAt(f);
  }
}
