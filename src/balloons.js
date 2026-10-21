import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SITES, clamp, smoothstep, mulberry32 } from './world.js';

/*
 * balloons.js: hot-air balloons. Four drift in wide loops high over the valley;
 * a fifth is tethered on the Balloon Meadow east of the town and takes the
 * player up for a ride: it climbs on its rope, hangs over the meadow for a
 * while, and comes back down. Each balloon is one mesh (envelope, skirt, ropes,
 * basket and burner, coloured per vertex) plus a small flame.
 */

const TAU = Math.PI * 2;
const GORES = 12;
const BASKET_Y = -6.4;         // basket floor below the envelope's mouth
const RIDE_HEIGHT = 34;
const RIDE = { up: 22, stay: 14, down: 22 };

// Outline of the envelope: [radius, height] from the mouth up to the crown.
const PROFILE = [[0.9, 0], [1.7, 1.2], [3.3, 3], [5.2, 5], [6.8, 7.2], [7.5, 9.2], [7.4, 10.8], [6.8, 12.3], [5.6, 13.6], [3.9, 14.6], [2.0, 15.2], [0.01, 15.45]];

const _c = new THREE.Color();

// Gives a geometry a colour attribute: one colour, or color(x, y, z, out) per
// vertex, or (faces) per triangle from its centre, for crisp stripes.
function coloured(geometry, color, faces = false) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const p = g.attributes.position;
  for (let i = 0; i < n; i++) {
    if (typeof color !== 'function') _c.set(color);
    else if (faces) {
      const t = i - (i % 3);
      color((p.getX(t) + p.getX(t + 1) + p.getX(t + 2)) / 3, (p.getY(t) + p.getY(t + 1) + p.getY(t + 2)) / 3, (p.getZ(t) + p.getZ(t + 1) + p.getZ(t + 2)) / 3, _c);
    } else color(p.getX(i), p.getY(i), p.getZ(i), _c);
    col.set([_c.r, _c.g, _c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

function placed(geometry, x, y, z, rx = 0, ry = 0, rz = 0) {
  return geometry.applyMatrix4(new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(1, 1, 1),
  ));
}

function rope(a, b, r = 0.025) {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r, r, d.length(), 4);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  return g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
}

/*
 * One balloon's geometry, origin at the envelope's mouth: striped gores in two
 * colours with a band round the widest part, a skirt, ropes down to a wicker
 * basket hung with sandbags, and the burner frame.
 */
function balloonGeometry(colors) {
  const [a, b, band] = colors.map((c) => new THREE.Color(c));
  const lathe = new THREE.LatheGeometry(PROFILE.map(([r, y]) => new THREE.Vector2(r, y)), GORES * 3);
  const envelope = coloured(lathe, (x, y, z, out) => {
    const gore = Math.floor(((Math.atan2(x, z) + Math.PI) / TAU) * GORES) % 2;
    out.copy(Math.abs(y - 9.6) < 0.9 ? band : gore ? a : b);
    if (y > 14.6) out.copy(band);
  }, true);
  const skirt = coloured(placed(new THREE.CylinderGeometry(0.92, 1.25, 1.6, GORES * 2, 1, true), 0, -0.8, 0), b);
  const parts = [envelope, skirt];
  const basketTop = BASKET_Y + 1.1;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const top = new THREE.Vector3(sx * 0.8, -1.55, sz * 0.8);
    const bottom = new THREE.Vector3(sx * 0.62, basketTop, sz * 0.62);
    parts.push(coloured(rope(top, bottom), 0x4a3a2a));
    parts.push(coloured(rope(new THREE.Vector3(sx * 0.45, BASKET_Y + 2.3, sz * 0.45), bottom, 0.03), 0x3a3a3a));
  }
  const wicker = (x, y, z, out) => out.set(Math.sin(y * 40) * Math.sin(x * 30 + z * 30) > 0 ? 0x9a7444 : 0x7a5630);
  parts.push(coloured(placed(new THREE.BoxGeometry(1.3, 1.1, 1.3, 4, 4, 4), 0, BASKET_Y + 0.55, 0), wicker));
  parts.push(coloured(placed(new THREE.BoxGeometry(1.38, 0.1, 1.38), 0, basketTop, 0), 0x5a3e24));
  for (const [sx, sz] of [[-0.7, 0.3], [0.7, -0.3], [0.3, 0.7], [-0.3, -0.7]]) {
    parts.push(coloured(placed(new THREE.BoxGeometry(0.18, 0.28, 0.18), sx, BASKET_Y + 0.7, sz), 0xc8b48a));
  }
  parts.push(coloured(placed(new THREE.CylinderGeometry(0.22, 0.26, 0.4, 10), 0, BASKET_Y + 2.4, 0), 0x6a6a72));
  parts.push(coloured(placed(new THREE.BoxGeometry(1.0, 0.06, 0.06), 0, BASKET_Y + 2.3, 0), 0x6a6a72));
  parts.push(coloured(placed(new THREE.BoxGeometry(0.06, 0.06, 1.0), 0, BASKET_Y + 2.3, 0), 0x6a6a72));
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  return g;
}

const FLAME_GEO = new THREE.ConeGeometry(0.22, 0.9, 8).translate(0, 0.45, 0);

export class Balloons {
  constructor(scene, world) {
    this.world = world;
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide });
    const flameMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffa040, emissiveIntensity: 3 });
    this.flameMat = flameMat;
    const rng = mulberry32(808);
    const make = (colors) => {
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(balloonGeometry(colors), material);
      mesh.castShadow = true;
      const flame = new THREE.Mesh(FLAME_GEO, flameMat);
      flame.position.y = BASKET_Y + 2.6;
      group.add(mesh, flame);
      group.userData.flame = flame;
      scene.add(group);
      return group;
    };
    // Loops high over the valley: centre, radii, height above the land, angular speed.
    this.drifting = [
      { colors: [0xc8302a, 0xe8b030, 0xf4ecd8], cx: 20, cz: 30, rx: 165, rz: 120, alt: 82, speed: 0.011 },
      { colors: [0x2f5fae, 0xf2eee6, 0xe8b030], cx: 60, cz: 120, rx: 140, rz: 95, alt: 68, speed: -0.01 },
      { colors: [0x3d8a45, 0xf0d040, 0x2a2a2a], cx: -60, cz: -40, rx: 120, rz: 140, alt: 104, speed: 0.008 },
      { colors: [0x7a3f9a, 0xe8843a, 0xf2eee6], cx: 150, cz: 10, rx: 75, rz: 95, alt: 60, speed: 0.016 },
    ].map((d) => ({ ...d, angle: rng() * TAU, bob: rng() * TAU, group: make(d.colors) }));

    // The tethered balloon on the meadow, and the stake its rope is tied to.
    const f = SITES.balloonField;
    this.anchor = new THREE.Vector3(f.x, world.getGroundHeight(f.x, f.z), f.z);
    this.tethered = { group: make([0xd8402a, 0xf4ecd8, 0x24356e]), lift: 0, bob: 0 };
    const line = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 4), new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 1 }));
    scene.add(line);
    this.line = line;
    this.ride = null;           // { t } while the player is aboard
    this.basket = new THREE.Vector3();
    this.time = 0;
    this.update(0);
  }

  // Where the player stands in the tethered balloon's basket.
  get basketFloor() {
    return this.basket;
  }

  // The tethered balloon can be boarded while it rests on the ground.
  get boardable() {
    return !this.ride && this.tethered.lift < 0.05;
  }

  get riding() {
    return !!this.ride;
  }

  board() {
    if (!this.boardable) return false;
    this.ride = { t: 0 };
    return true;
  }

  // How high the tethered balloon is lifted (0..1) at time t into a ride.
  _rideLift(t) {
    if (t < RIDE.up) return smoothstep(0, RIDE.up, t);
    if (t < RIDE.up + RIDE.stay) return 1;
    return 1 - smoothstep(RIDE.up + RIDE.stay, RIDE.up + RIDE.stay + RIDE.down, t);
  }

  // Returns 'landed' on the frame a ride ends.
  update(dt) {
    this.time += dt;
    const t = this.time;
    const w = this.world;
    for (const b of this.drifting) {
      b.angle += b.speed * dt;
      const x = b.cx + Math.sin(b.angle) * b.rx;
      const z = b.cz + Math.cos(b.angle) * b.rz;
      const y = Math.max(w.getHeight(x, z) + 45, w.getHeight(b.cx, b.cz) + b.alt) + Math.sin(t * 0.25 + b.bob) * 3;
      b.group.position.set(x, y, z);
      b.group.rotation.set(Math.sin(t * 0.4 + b.bob) * 0.03, b.angle * 0.3, Math.cos(t * 0.33 + b.bob) * 0.03);
      this._flame(b.group, t + b.bob);
    }

    // The tethered balloon: resting on the meadow, or up on its rope with the player aboard.
    const tb = this.tethered;
    let event = null;
    if (this.ride) {
      this.ride.t += dt;
      tb.lift = this._rideLift(this.ride.t);
      if (this.ride.t > RIDE.up + RIDE.stay + RIDE.down) {
        this.ride = null;
        tb.lift = 0;
        event = 'landed';
      }
    }
    const a = this.anchor;
    const sway = tb.lift * 1.5;
    const gx = a.x + 3 + Math.sin(t * 0.3) * sway;
    const gz = a.z + Math.cos(t * 0.23) * sway;
    const ground = w.getGroundHeight(gx, gz);
    const y = ground - BASKET_Y + 0.02 + tb.lift * RIDE_HEIGHT + Math.sin(t * 0.8) * 0.05 * (1 - tb.lift);
    tb.group.position.set(gx, y, gz);
    tb.group.rotation.set(Math.sin(t * 0.5) * 0.02 * tb.lift, 0.4, Math.cos(t * 0.4) * 0.02 * tb.lift);
    this.basket.set(gx, y + BASKET_Y + 0.08, gz);
    this._flame(tb.group, t, this.ride ? 1.3 : 0.6);
    // The tether from the stake up to the basket.
    const top = new THREE.Vector3(gx, y + BASKET_Y + 0.4, gz);
    const base = new THREE.Vector3(a.x, a.y + 0.6, a.z);
    const d = top.clone().sub(base);
    this.line.position.copy(base).addScaledVector(d, 0.5);
    this.line.scale.set(1, d.length(), 1);
    this.line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    return event;
  }

  // The burner roars in bursts.
  _flame(group, t, strength = 1) {
    const burst = clamp(Math.sin(t * 0.9) * 2 - 0.6, 0, 1) * strength;
    const f = group.userData.flame;
    f.visible = burst > 0.05;
    f.scale.set(0.6 + burst * 0.6, 0.4 + burst * 1.2, 0.6 + burst * 0.6);
  }
}
