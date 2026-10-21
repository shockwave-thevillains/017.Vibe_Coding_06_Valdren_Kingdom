import * as THREE from 'three';
import { createFigure, FigureAnimator, dampAngle, frontProfile, isSeated, HEAD_CENTRE } from './player.js';
import { clamp, mulberry32 } from './world.js';

/*
 * npc.js: the people of Valdren. Each one is described in data/npcs.json: a
 * look for createFigure() plus an outfit of procedural accessories, an idle
 * pose or a short patrol, and a dialogue tree that dialogue.js runs. A child
 * ("child": true) is a smaller figure with a larger head.
 * NPCManager moves them, keeps the player from walking through them, picks who
 * can be talked to, and reports name labels for the HUD.
 */

export const TALK_RANGE = 3.0;
const LABEL_RANGE = 16;
const CHILD_SCALE = 0.62;
const CHILD_HEAD = 1.27;
const SHADOW_RANGE = 24;         // farther away, a figure's shadow is too small to be worth its draw calls
const NPC_RADIUS = 0.32;
const TAU = Math.PI * 2;

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();

function wrapAngle(a) {
  return ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

// "#rrggbb" strings in JSON become numbers; everything else passes through.
function parseLook(look = {}) {
  const out = {};
  for (const [k, v] of Object.entries(look)) out[k] = typeof v === 'string' && v[0] === '#' ? parseInt(v.slice(1), 16) : v;
  return out;
}

function colorOf(v) {
  return new THREE.Color(typeof v === 'string' ? parseInt(v.replace('#', ''), 16) : v);
}

function M(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return new THREE.Matrix4().compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
}

// ------------------------------------------------------------ accessories

/*
 * Collects accessory parts for a figure. Parts are placed in the figure's
 * bind-pose space (feet at 0, facing +Z) and go straight into the figure's own
 * skinned mesh through the gear API, so a crowned, armoured or aproned figure
 * costs no more draw calls than a plain one. Held items (held: true) are built
 * around their grip, upright, and placed in the hand for the NPC's pose.
 */
class Kit {
  constructor(api, seed, action) {
    this.api = api;
    this.rng = mulberry32(seed);
    this.action = action;
    this.grips = new Map();
  }

  add(bone, geometry, color, { metal = false, matrix = null, jitter = 0, spots = null, held = false } = {}) {
    const g = geometry.clone();
    let m = matrix;
    if (held) {
      if (!this.grips.has(bone)) {
        // A hammer is placed for the moment of the blow, when the head points down.
        const time = this.action === 'hammer' ? 0.95 / 0.9 : 0;
        this.grips.set(bone, this.api.grip(bone, this.action, time));
      }
      m = matrix ? this.grips.get(bone).clone().multiply(matrix) : this.grips.get(bone);
    }
    if (m) g.applyMatrix4(m);
    const base = colorOf(color);
    const n = g.attributes.position.count;
    const colors = [];
    for (let i = 0; i < n; i++) {
      const c = base.clone();
      if (jitter) c.multiplyScalar(1 - jitter + this.rng() * jitter * 2);
      if (spots && this.rng() < spots.chance) c.set(spots.color);
      colors.push(c);
    }
    this.api.add(bone, g, (i) => colors[i], metal);
    g.dispose();
  }
}

const GOLD = '#d4a640';
const STEEL = '#b9bec6';
const IRON = '#5c5f66';
const WOOD = '#6a4a30';
const LEATHER = '#3a2618';

const HY = HEAD_CENTRE[1];
const HZ = HEAD_CENTRE[2];

/*
 * A sheet that hugs the front of the body between heights y0 and y1, following
 * frontProfile(); width(y) is its half-width. Aprons and the breastplate.
 * bulge(x, y) can push it further out (a breastplate's centre ridge).
 */
function bodySheet(kit, look, bone, y0, y1, width, color, opts = {}) {
  const g = new THREE.PlaneGeometry(1, 1, 14, 14);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = y0 + (p.getY(i) + 0.5) * (y1 - y0);
    const pr = frontProfile(look, y);
    const x = p.getX(i) * 2 * width(y);
    const z = pr.rf * Math.sqrt(Math.max(0, 1 - (x / (pr.rx * 1.02)) ** 2)) + (opts.gap ?? 0.016) + (opts.bulge ? opts.bulge(x, y) : 0);
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  kit.add(bone, g, color, { jitter: opts.jitter ?? 0.05, metal: !!opts.metal });
}

// Each outfit entry adds parts to the kit. o is the entry's value (true or options).
const OUTFIT = {
  crown(kit) {
    kit.add('head', new THREE.CylinderGeometry(1.05, 1, 1, 32, 1, true), GOLD, { metal: true, matrix: M(0, HY + 0.07, HZ - 0.004, 0, 0, 0, 0.08, 0.05, 0.097) });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      const x = Math.sin(a) * 0.084;
      const z = HZ - 0.004 + Math.cos(a) * 0.102;
      kit.add('head', new THREE.ConeGeometry(0.011, 0.04, 4), GOLD, { metal: true, matrix: M(x, HY + 0.114, z, 0, a, 0) });
      kit.add('head', new THREE.SphereGeometry(0.008, 8, 6), GOLD, { metal: true, matrix: M(x, HY + 0.137, z) });
    }
    [['#b0182a', 0], ['#1f4fb0', Math.PI / 2], ['#b0182a', Math.PI], ['#1f4fb0', -Math.PI / 2]].forEach(([c, a]) => {
      kit.add('head', new THREE.SphereGeometry(0.009, 10, 8), c, { metal: true, matrix: M(Math.sin(a) * 0.087, HY + 0.07, HZ - 0.004 + Math.cos(a) * 0.105, 0, 0, 0, 1, 1, 0.6) });
    });
  },

  ermine(kit) {
    const torus = new THREE.TorusGeometry(1, 0.28, 18, 72).rotateX(Math.PI / 2);
    kit.add('chest', torus, '#f2eee4', { matrix: M(0, 1.47, -0.01, 0, 0, 0, 0.152, 0.12, 0.112), spots: { chance: 0.025, color: '#16110d' } });
  },

  helmet(kit) {
    const dome = new THREE.SphereGeometry(1, 28, 14, 0, TAU, 0, Math.PI / 2);
    const p = dome.attributes.position;
    // Lift the rim at the front so the brow and eyes stay clear.
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + 0.42 * Math.max(0, p.getZ(i)) ** 1.5 * (1 - p.getY(i)));
    dome.computeVertexNormals();
    kit.add('head', dome, STEEL, { metal: true, matrix: M(0, HY - 0.006, HZ - 0.004, 0, 0, 0, 0.098, 0.135, 0.115) });
    // Nasal guard and a crest ridge.
    kit.add('head', new THREE.BoxGeometry(0.014, 0.06, 0.007), STEEL, { metal: true, matrix: M(0, HY + 0.02, HZ + 0.103, -0.3, 0, 0) });
    kit.add('head', new THREE.TorusGeometry(1, 0.05, 6, 24, Math.PI).rotateY(Math.PI / 2), IRON, { metal: true, matrix: M(0, HY - 0.006, HZ - 0.004, 0, 0, 0, 0.2, 0.137, 0.117) });
  },

  breastplate(kit, o, look) {
    // A plate hugging the chest with a raised centre ridge; a fauld below the waist.
    bodySheet(kit, look, 'chest', 1.06, 1.44, (y) => frontProfile(look, y).rx * 0.92, STEEL, {
      metal: true, jitter: 0.03, gap: 0.012, bulge: (x, y) => 0.012 * Math.exp(-((x / 0.03) ** 2)) * (1 - ((y - 1.25) / 0.2) ** 2),
    });
    bodySheet(kit, look, 'hips', 0.9, 1.06, (y) => frontProfile(look, y).rx * 0.88, IRON, { metal: true, jitter: 0.03, gap: 0.014 });
  },

  pauldrons(kit) {
    for (const side of [-1, 1]) {
      const L = side < 0 ? 'L' : 'R';
      kit.add(`upperArm${L}`, new THREE.SphereGeometry(1, 16, 10, 0, TAU, 0, Math.PI * 0.55), STEEL, {
        metal: true,
        matrix: M(side * 0.205, 1.395, -0.005, 0, 0, -side * 0.45, 0.07, 0.056, 0.076),
      });
    }
  },

  sword(kit) {
    // Hangs from the left hip, tip back and a little out.
    const pivot = M(-0.2, 1.02, 0.05, 0.32, 0, -0.12);
    const part = (g, color, metal, local) => kit.add('hips', g, color, { metal, matrix: pivot.clone().multiply(local) });
    part(new THREE.BoxGeometry(0.04, 0.78, 0.022), LEATHER, false, M(0, -0.4, 0));
    part(new THREE.BoxGeometry(0.046, 0.045, 0.026), STEEL, true, M(0, -0.79, 0));
    part(new THREE.BoxGeometry(0.15, 0.016, 0.024), STEEL, true, M(0, 0.008, 0));
    part(new THREE.CylinderGeometry(0.011, 0.012, 0.11, 8), LEATHER, false, M(0, 0.072, 0));
    part(new THREE.SphereGeometry(0.019, 10, 8), STEEL, true, M(0, 0.14, 0));
  },

  apron(kit, o, look) {
    const color = typeof o === 'string' ? o : '#e6dccb';
    const yBot = look.skirt === 'robe' ? 0.42 : 0.62;
    // A bib over the chest (rides the spine) and a skirt over the legs (rides the hips).
    bodySheet(kit, look, 'spine', 1.03, 1.36, (y) => 0.1 + 0.06 * (1 - smoothstep(1.03, 1.3, y)), color);
    bodySheet(kit, look, 'hips', yBot, 1.08, (y) => 0.16 + 0.05 * (1 - smoothstep(yBot, 1.08, y)), color);
    // Neck strap.
    kit.add('chest', new THREE.TorusGeometry(1, 0.08, 6, 24, Math.PI).rotateX(-Math.PI / 2 + 0.35), color, { matrix: M(0, 1.43, 0.0, 0, 0, 0, 0.085, 0.09, 0.09) });
  },

  hammer(kit) {
    kit.add('handR', new THREE.CylinderGeometry(0.013, 0.015, 0.34, 8).rotateX(Math.PI / 2), WOOD, { held: true, matrix: M(0, 0, 0.09) });
    kit.add('handR', new THREE.BoxGeometry(0.042, 0.11, 0.045), IRON, { held: true, metal: true, matrix: M(0, 0.0, 0.245) });
  },

  mug(kit) {
    kit.add('handL', new THREE.CylinderGeometry(0.038, 0.043, 0.115, 14), '#7a5634', { held: true, jitter: 0.06, matrix: M(0.0, 0.02, 0.035) });
    kit.add('handL', new THREE.CylinderGeometry(0.044, 0.044, 0.012, 14, 1, true), IRON, { held: true, metal: true, matrix: M(0, 0.065, 0.035) });
    kit.add('handL', new THREE.CylinderGeometry(0.047, 0.047, 0.012, 14, 1, true), IRON, { held: true, metal: true, matrix: M(0, -0.025, 0.035) });
    kit.add('handL', new THREE.CircleGeometry(0.035, 14).rotateX(-Math.PI / 2), '#e6d6a8', { held: true, matrix: M(0, 0.07, 0.035) });
  },

  staff(kit) {
    const g = new THREE.CylinderGeometry(0.019, 0.026, 1.72, 7, 10);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      p.setX(i, p.getX(i) + Math.sin(y * 7.3) * 0.012);
      p.setZ(i, p.getZ(i) + Math.sin(y * 5.1 + 1) * 0.01);
    }
    g.computeVertexNormals();
    kit.add('handR', g, '#5a4430', { held: true, jitter: 0.12, matrix: M(0, -0.16, 0) });
    kit.add('handR', new THREE.SphereGeometry(0.036, 10, 8), '#4e3a28', { held: true, jitter: 0.1, matrix: M(0.01, 0.71, 0, 0, 0, 0, 1, 1.2, 1) });
  },

  hoe(kit) {
    kit.add('handR', new THREE.CylinderGeometry(0.016, 0.019, 1.55, 8), '#8a6a44', { held: true, jitter: 0.08, matrix: M(0, -0.2, 0) });
    kit.add('handR', new THREE.BoxGeometry(0.17, 0.11, 0.012), IRON, { held: true, metal: true, matrix: M(0, 0.6, 0.045, 1.15, 0, 0) });
    kit.add('handR', new THREE.CylinderGeometry(0.022, 0.022, 0.05, 8), IRON, { held: true, metal: true, matrix: M(0, 0.575, 0) });
  },

  hat(kit, o) {
    const color = typeof o === 'string' ? o : '#2f4a2c';
    const dark = colorOf(color).multiplyScalar(0.55);
    kit.add('head', new THREE.CylinderGeometry(0.078, 0.09, 0.085, 22), color, { jitter: 0.04, matrix: M(0, HY + 0.106, HZ - 0.006, 0, 0, 0, 1, 1, 1.15) });
    kit.add('head', new THREE.CylinderGeometry(0.165, 0.165, 0.008, 30), color, { jitter: 0.04, matrix: M(0, HY + 0.065, HZ - 0.006, 0.05, 0, 0, 1, 1, 1.08) });
    kit.add('head', new THREE.CylinderGeometry(0.091, 0.091, 0.02, 22, 1, true), dark, { matrix: M(0, HY + 0.075, HZ - 0.006, 0, 0, 0, 1, 1, 1.15) });
    kit.add('head', new THREE.SphereGeometry(1, 10, 8), '#b8322c', { matrix: M(0.075, HY + 0.11, HZ - 0.05, -0.6, 0.35, 0, 0.008, 0.016, 0.105) });
  },

  strawHat(kit) {
    kit.add('head', new THREE.CylinderGeometry(0.23, 0.23, 0.01, 32), '#d9bd78', { jitter: 0.1, matrix: M(0, HY + 0.064, HZ - 0.006, -0.06, 0, 0, 1, 1, 1.1) });
    kit.add('head', new THREE.CylinderGeometry(0.062, 0.092, 0.1, 24), '#d2b46c', { jitter: 0.1, matrix: M(0, HY + 0.112, HZ - 0.006, -0.06, 0, 0, 1, 1, 1.12) });
    kit.add('head', new THREE.CylinderGeometry(0.093, 0.093, 0.02, 24, 1, true), '#8a3a2a', { matrix: M(0, HY + 0.075, HZ - 0.006, -0.06, 0, 0, 1, 1, 1.12) });
  },

  cowl(kit, o, look) {
    const color = typeof o === 'string' ? o : look.cloak ?? 0x5a4a38;
    kit.add('chest', new THREE.TorusGeometry(1, 0.32, 10, 30).rotateX(Math.PI / 2), color, { jitter: 0.06, matrix: M(0, 1.485, -0.015, 0, 0, 0, 0.15, 0.13, 0.125) });
    kit.add('chest', new THREE.SphereGeometry(1, 16, 10, 0, TAU, 0, Math.PI / 2), color, { jitter: 0.06, matrix: M(0, 1.38, -0.135, -Math.PI / 2, 0, 0, 0.12, 0.05, 0.15) });
  },

};

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

// ------------------------------------------------------------------ NPC

class NPC {
  constructor(def, world, index) {
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.role = def.role;
    this.dialogue = def.dialogue;
    this.world = world;
    this.child = !!def.child;
    this.scale = def.scale ?? (this.child ? CHILD_SCALE : 1);

    const look = parseLook(def.look);
    this.figure = createFigure({
      seed: 11 + index * 7,
      ...look,
      gear: (api) => {
        const kit = new Kit(api, 1000 + index * 17, def.action || null);
        for (const [name, value] of Object.entries(def.outfit || {})) {
          if (value && OUTFIT[name]) OUTFIT[name](kit, value, look);
        }
      },
    });
    this.figure.root.name = `npc:${this.id}`;
    this.figure.root.scale.setScalar(this.scale);
    if (this.child) this.figure.bones.head.scale.setScalar(CHILD_HEAD);

    this.animator = new FigureAnimator(this.figure);
    this.animator.stoop = def.stoop || 0;
    this.baseAction = def.action || null;
    this.walkAction = this.baseAction && this.baseAction === 'staff' ? 'staff' : null;
    this.rng = mulberry32(77 + index * 131);

    // Patrol route: points with optional wait, facing and pose.
    const pts = def.patrol && def.patrol.points && def.patrol.points.length ? def.patrol.points : [{ ...def.position, face: def.heading, wait: 1e9 }];
    this.route = pts.map((p) => ({ x: p.x, z: p.z, wait: p.wait ?? 6, face: p.face ?? null, action: p.action ?? this.baseAction }));
    this.loop = !!(def.patrol && def.patrol.mode === 'loop');
    this.speed = (def.patrol && def.patrol.speed) || 1.2;
    this.index = clamp(Math.floor(def.patrol?.start ?? 0), 0, this.route.length - 1);
    this.step = 1;
    this.state = 'wait';
    this.timer = this.route[this.index].wait * (0.4 + this.rng() * 0.6);

    const start = def.position || this.route[this.index];
    this.position = new THREE.Vector3(start.x, 0, start.z);
    this.position.y = world.getGroundHeight(this.position.x, this.position.z);
    this.heading = def.heading ?? this.route[this.index].face ?? 0;
    this._visualY = this.position.y;
    this.talking = false;
    this.moveSpeed = 0;

    this.animator.action = this.route[this.index].action;
    this.animator.settle();
    this._sync();
  }

  // Height of the head above the feet (lower while seated).
  get headHeight() {
    return (isSeated(this.animator.action) ? 1.16 : 1.6) * this.scale;
  }

  headPosition(out) {
    return out.set(this.position.x, this._visualY + this.headHeight, this.position.z);
  }

  update(dt, player, typing, range) {
    const pos = this.position;
    const pp = player.position;
    const dx = pp.x - pos.x;
    const dz = pp.z - pos.z;
    const dist = Math.hypot(dx, dz);
    const root = this.figure.root;
    root.visible = dist < range || this.talking;
    if (!root.visible) {
      // Out of sight, people keep to their routine without being animated.
      this._walk(dt, dist, dx, dz);
      this._visualY = pos.y;
      this._sync();
      return;
    }
    const shadow = dist < SHADOW_RANGE;
    if (this.figure.mesh.castShadow !== shadow) {
      this.figure.mesh.castShadow = shadow;
      if (this.figure.hair) this.figure.hair.castShadow = shadow;
    }

    let action = this.animator.action;
    if (this.talking) {
      // Someone seated stays put and turns only their head.
      if (!isSeated(action)) this.heading = dampAngle(this.heading, Math.atan2(dx, dz), 6, dt);
      this.moveSpeed = 0;
    } else {
      action = this._walk(dt, dist, dx, dz);
    }

    // Glance at the player when they come close; hold their gaze in a conversation.
    const a = this.animator;
    a.action = action;
    a.talking = this.talking && typing;
    const rel = wrapAngle(Math.atan2(dx, dz) - this.heading);
    if (this.talking || (dist < 5 && Math.abs(rel) < 1.9)) {
      const dy = pp.y + 1.6 - (this._visualY + this.headHeight);
      a.lookAt = { yaw: rel, pitch: Math.atan2(dy, Math.max(dist, 0.5)) };
    } else {
      a.lookAt = null;
    }

    a.update(dt, this.moveSpeed / this.scale);
    this._visualY += (pos.y - this._visualY) * (1 - Math.exp(-12 * dt));
    this._sync();
  }

  // Follows the route: waits at each point (facing its way, in its pose), then walks on.
  // Returns the pose to show.
  _walk(dt, dist, dx, dz) {
    const pos = this.position;
    let moved = 0;
    let action;
    if (this.state === 'wait') {
      const here = this.route[this.index];
      if (here.face !== null) this.heading = dampAngle(this.heading, here.face, 3, dt);
      action = here.action;
      this.timer -= dt;
      if (this.timer <= 0 && this.route.length > 1) {
        this._advance();
        this.state = 'walk';
      }
    } else {
      const target = this.route[this.index];
      const tx = target.x - pos.x;
      const tz = target.z - pos.z;
      const left = Math.hypot(tx, tz);
      action = this.walkAction;
      if (left < 0.06) {
        this.state = 'wait';
        this.timer = target.wait * (0.75 + this.rng() * 0.5);
      } else {
        const want = Math.atan2(tx, tz);
        this.heading = dampAngle(this.heading, want, 5, dt);
        // Turn on the spot first, and wait politely if the player is in the way.
        const facing = Math.abs(wrapAngle(want - this.heading)) < 0.9;
        const blocked = dist < 1.3 && (dx * tx + dz * tz) / (dist * left + 1e-6) > 0.3;
        if (facing && !blocked) {
          const step = Math.min(left, this.speed * dt);
          pos.x += (tx / left) * step;
          pos.z += (tz / left) * step;
          pos.y = this.world.getGroundHeight(pos.x, pos.z);
          moved = step;
        }
      }
    }
    this.moveSpeed = dt > 0 ? moved / dt : 0;
    return action;
  }

  _advance() {
    const n = this.route.length;
    if (this.loop) {
      this.index = (this.index + 1) % n;
      return;
    }
    if (this.index + this.step < 0 || this.index + this.step >= n) this.step = -this.step;
    this.index += this.step;
  }

  _sync() {
    const root = this.figure.root;
    root.position.set(this.position.x, this._visualY, this.position.z);
    root.rotation.y = this.heading;
  }
}

// ------------------------------------------------------------ manager

export class NPCManager {
  constructor(scene, world, defs = []) {
    this.world = world;
    this.range = 120; // people farther away than this are hidden (set per graphics preset)
    this.list = defs.map((def, i) => new NPC(def, world, i));
    for (const npc of this.list) scene.add(npc.figure.root);
    this.byId = new Map(this.list.map((n) => [n.id, n]));
    this._labels = [];
    this._proj = new THREE.Vector3();
  }

  update(dt, player, typing = false) {
    for (const npc of this.list) npc.update(dt, player, typing, this.range);
  }

  // Keeps the player from walking through anyone.
  separate(player) {
    const pos = player.position;
    let pushed = false;
    for (const npc of this.list) {
      const dx = pos.x - npc.position.x;
      const dz = pos.z - npc.position.z;
      const min = NPC_RADIUS * npc.scale + player.radius * 0.85;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min || Math.abs(pos.y - npc.position.y) > 1.6) continue;
      const d = Math.sqrt(d2) || 1e-6;
      pos.x = npc.position.x + (dx / d) * min;
      pos.z = npc.position.z + (dz / d) * min;
      pushed = true;
    }
    if (pushed) {
      this.world.colliders.resolve(pos, player.radius, pos.y + 0.15, pos.y + 1.8);
      pos.y = this.world.getGroundHeight(pos.x, pos.z);
    }
  }

  // The person the player would talk to: close, at their height, preferably in front of them.
  nearest(player) {
    const pos = player.position;
    const fx = Math.sin(player.heading);
    const fz = Math.cos(player.heading);
    let best = null;
    let bestScore = Infinity;
    for (const npc of this.list) {
      const dx = npc.position.x - pos.x;
      const dz = npc.position.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d > TALK_RANGE * Math.max(npc.scale, 0.85) || Math.abs(npc.position.y - pos.y) > 1.6) continue;
      const facing = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
      const score = d + (1 - facing) * 0.6;
      if (score < bestScore) {
        bestScore = score;
        best = npc;
      }
    }
    return best;
  }

  // Screen positions for name labels above nearby heads.
  labels(camera, width, height, focus) {
    const out = this._labels;
    out.length = 0;
    for (const npc of this.list) {
      if (!npc.figure.root.visible || npc.talking) continue;
      const d = camera.position.distanceTo(npc.position);
      if (d > LABEL_RANGE) continue;
      const p = this._proj.set(npc.position.x, npc._visualY + npc.headHeight + 0.4 * npc.scale, npc.position.z).project(camera);
      if (p.z > 1 || p.z < -1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1) continue;
      out.push({
        id: npc.id,
        text: npc.name,
        x: (p.x * 0.5 + 0.5) * width,
        y: (-p.y * 0.5 + 0.5) * height,
        opacity: 1 - smoothstep(LABEL_RANGE - 5, LABEL_RANGE, d),
        focus: npc === focus,
      });
    }
    return out;
  }
}
