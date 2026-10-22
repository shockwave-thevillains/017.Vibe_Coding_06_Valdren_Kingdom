import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createFigure, FigureAnimator, dampAngle } from './player.js';

/*
 * dungeon.js: the Gloomhollow Mine, an old silver mine that monsters have taken
 * over. Its way in is in the hills north-west of the town. Inside, tunnels and
 * caverns lead past a rats' nest, a spiders' cavern and a cave of slimes to a goblin
 * camp and the hall of the cave troll who rules them, with a chest of the miners'
 * silver behind him.
 *
 * The mine is a place of its own: a scene of its own (dark, lit by torches), lying
 * far out east of the land (x > minX), so the world's height and collision queries
 * reach it without touching anything above ground. Going in swaps the scene that is
 * drawn and carries the traveller (and whatever they hold) down into it.
 *
 * Monsters wake when the traveller comes near, chase them, and strike after a short
 * wind-up that can be seen coming (step back, or strike first). Each one that falls
 * drops crowns that fly into the traveller's purse. They are all back, and the chest
 * full again, every time the mine is entered. Everything is built in code: the rooms
 * from the world's own stone, timber and rock; the critters from a few merged shapes;
 * goblins and the troll from the same skinned figure as every person.
 */

const OX = 3000;                // the mine's origin, far east of the land
const FLOOR = 20;               // its floor height
const HEIGHT = 4.4;             // from floor to ceiling
const WALL = 0.9;
const LEASH = 28;               // a monster this far from home gives up the chase
const COIN_COUNT = 24;          // coin sprites in flight at once, at most
const CHEST_COINS = [30, 45];

// Rooms and tunnels, in metres from the mine's origin (x east, z south); edges on whole metres.
const AREAS = [
  { id: 'hall', x0: -6, x1: 6, z0: -6, z1: 6, room: true },
  { id: 'c1', x0: -2, x1: 2, z0: -18, z1: -6 },
  { id: 'nest', x0: -8, x1: 8, z0: -34, z1: -18, room: true },
  { id: 'c2', x0: 8, x1: 21, z0: -28, z1: -24 },
  { id: 'webs', x0: 21, x1: 39, z0: -35, z1: -17, room: true },
  { id: 'c3', x0: -20, x1: -8, z0: -28, z1: -24 },
  { id: 'pools', x0: -36, x1: -20, z0: -33, z1: -19, room: true },
  { id: 'c4', x0: 28, x1: 32, z0: -55, z1: -35 },
  { id: 'camp', x0: 19, x1: 41, z0: -77, z1: -55, room: true },
  { id: 'c5', x0: 0, x1: 19, z0: -68, z1: -64 },
  { id: 'lair', x0: -24, x1: 0, z0: -78, z1: -54, room: true },
];
const BOUNDS = { x0: -37, x1: 42, z0: -79, z1: 7 };

const KINDS = {
  rat: { name: 'Giant rat', health: 30, damage: 5, speed: 4.4, reach: 1.25, windup: 0.32, rest: 0.9, aggro: 10, radius: 0.4, coins: [2, 4] },
  spider: { name: 'Cave spider', health: 48, damage: 8, speed: 3.9, reach: 1.6, windup: 0.4, rest: 1.1, aggro: 11, radius: 0.6, coins: [4, 7] },
  slime: { name: 'Slime', health: 40, damage: 6, speed: 2.5, reach: 1.35, windup: 0.5, rest: 1.2, aggro: 9, radius: 0.55, coins: [3, 6] },
  goblin: { name: 'Goblin', health: 60, damage: 10, speed: 3.6, reach: 1.7, windup: 0.45, rest: 1.2, aggro: 13, radius: 0.36, coins: [6, 10] },
  troll: { name: 'Cave troll', health: 420, damage: 22, speed: 3.0, reach: 2.9, windup: 0.8, rest: 1.7, aggro: 15, radius: 0.95, coins: [55, 70], boss: true },
};

// Who lives where (offsets from the area's centre).
const SPAWNS = [
  ['nest', 'rat', [[-4, -3], [3, -5], [5, 3], [-5, 4], [0, 1], [2, -1]]],
  ['webs', 'spider', [[-4, -4], [5, -3], [-3, 5], [4, 5]]],
  ['pools', 'slime', [[-4, -3], [3, -2], [-2, 3], [4, 3]]],
  ['camp', 'goblin', [[-5, -4], [4, -6], [6, 3], [-6, 5], [0, -1]]],
  ['lair', 'goblin', [[6, 6], [6, -6]]],
  ['lair', 'troll', [[-3, -2]]],
];

const AREA = Object.fromEntries(AREAS.map((a) => [a.id, a]));
const centre = (a) => [(a.x0 + a.x1) / 2, (a.z0 + a.z1) / 2];
const rnd = (a, b) => a + Math.random() * (b - a);
const rint = ([a, b]) => Math.floor(rnd(a, b + 1));

// --------------------------------------------------------------- shapes

// Colours a geometry (vertex colours), ready to merge with others.
function tinted(geometry, hex, matrix = null) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  if (matrix) g.applyMatrix4(matrix);
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(col, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}

const M = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(
  new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

// A rod from a to b (arrays), radius r.
function rod(a, b, r, hex) {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const g = new THREE.CylinderGeometry(r * 0.8, r, len, 6);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  return tinted(g, hex, new THREE.Matrix4().compose(va.clone().add(vb).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
}

const SPHERE = new THREE.SphereGeometry(1, 12, 8);

function ratShapes() {
  const body = mergeGeometries([
    tinted(SPHERE, 0x6b5d52, M(0, 0.22, 0, 0, 0, 0, 0.21, 0.18, 0.38)),
    tinted(new THREE.ConeGeometry(0.12, 0.32, 8).rotateX(Math.PI / 2), 0x77685c, M(0, 0.24, 0.44)),
    tinted(SPHERE, 0xd08a8a, M(0, 0.24, 0.6, 0, 0, 0, 0.035, 0.035, 0.035)),
    tinted(SPHERE, 0xc88a84, M(-0.08, 0.34, 0.34, 0, 0, 0, 0.065, 0.075, 0.02)),
    tinted(SPHERE, 0xc88a84, M(0.08, 0.34, 0.34, 0, 0, 0, 0.065, 0.075, 0.02)),
    rod([0, 0.2, -0.34], [0, 0.12, -0.95], 0.03, 0xc49088),
    ...[[-1, 1], [1, 1], [-1, -1], [1, -1]].map(([sx, sz]) => tinted(new THREE.BoxGeometry(0.06, 0.14, 0.07), 0x54483f, M(sx * 0.12, 0.07, sz * 0.18))),
  ]);
  const eyes = mergeGeometries([-1, 1].map((s) => tinted(SPHERE, 0xff3020, M(s * 0.065, 0.29, 0.5, 0, 0, 0, 0.025, 0.025, 0.025))));
  return { body, eyes, legs: null };
}

function spiderShapes() {
  const body = mergeGeometries([
    tinted(SPHERE, 0x2a231f, M(0, 0.55, -0.42, 0, 0, 0, 0.38, 0.32, 0.48)),
    tinted(SPHERE, 0x6a1c18, M(0, 0.82, -0.45, 0, 0, 0, 0.12, 0.05, 0.2)),
    tinted(SPHERE, 0x352b25, M(0, 0.5, 0.1, 0, 0, 0, 0.25, 0.2, 0.27)),
    tinted(new THREE.ConeGeometry(0.03, 0.14, 5).rotateX(Math.PI), 0x15100c, M(-0.06, 0.38, 0.32)),
    tinted(new THREE.ConeGeometry(0.03, 0.14, 5).rotateX(Math.PI), 0x15100c, M(0.06, 0.38, 0.32)),
  ]);
  const eyes = mergeGeometries([[-0.07, 0.58], [0.07, 0.58], [-0.12, 0.54], [0.12, 0.54], [-0.04, 0.63], [0.04, 0.63]]
    .map(([x, y]) => tinted(SPHERE, 0xff2a1a, M(x, y, 0.33, 0, 0, 0, 0.03, 0.03, 0.03))));
  // One leg, from the body outwards along +x: up to the knee, then down to the floor.
  const leg = mergeGeometries([rod([0, 0, 0], [0.5, 0.32, 0], 0.035, 0x2a231f), rod([0.5, 0.32, 0], [0.95, -0.5, 0], 0.028, 0x231d1a)]);
  return { body, eyes, legs: leg };
}

function slimeShapes() {
  const body = new THREE.SphereGeometry(0.55, 18, 12).translate(0, 0.5, 0);
  const eyes = mergeGeometries([-1, 1].map((s) => tinted(SPHERE, 0x101810, M(s * 0.16, 0.66, 0.43, 0, 0, 0, 0.07, 0.09, 0.05))));
  const core = tinted(SPHERE, 0x2f6a24, M(0, 0.45, 0, 0, 0, 0, 0.22, 0.2, 0.22));
  return { body, eyes, core };
}

// Goblins and the troll are figures with skin and eyes to suit, ears, and a club.
function brute(kind, seed) {
  const troll = kind === 'troll';
  const skin = troll ? 0x7d8a72 : 0x6f8f3a;
  const look = {
    seed,
    skin,
    hair: 0x2a2418,
    hairStyle: 'bald',
    beard: null,
    stubble: false,
    eyes: troll ? 0xd0a030 : 0xe0b020,
    brows: 0x2a2418,
    lips: troll ? 0x5a5a48 : 0x4f6a2a,
    tunic: troll ? 0x4a3a2a : [0x5a4a32, 0x4a3a2a, 0x6a5232][seed % 3],
    sleeves: troll ? 0x3a2e22 : null,
    trousers: troll ? 0x3a2e22 : 0x3a3024,
    boots: 0x2a2018,
    belt: 0x2a1a10,
    pouch: null,
    trim: 0x5a4a32,
    cloak: null,
    belly: troll ? 0.95 : 0.1,
    age: troll ? 0.6 : 0.3,
    gear: (api) => {
      const add = (bone, geometry, hex, matrix, metal = false) => {
        const g = geometry.clone().applyMatrix4(matrix);
        const c = new THREE.Color(hex);
        api.add(bone, g, () => c, metal);
        g.dispose();
      };
      // Pointed ears, and for the troll two tusks.
      for (const s of [-1, 1]) add('head', new THREE.ConeGeometry(0.028, troll ? 0.12 : 0.15, 6), skin, M(s * 0.092, 1.68, 0.0, 0, 0, -s * 1.15));
      if (troll) for (const s of [-1, 1]) add('head', new THREE.ConeGeometry(0.012, 0.05, 5), 0xe8e0c8, M(s * 0.03, 1.6, 0.095, 0.25));
      // The club, held ready: built upright round the grip, then tipped forward.
      const club = (m) => api.grip('handR', 'sword').multiply(M(0, 0, 0, 0.6)).multiply(m);
      add('handR', new THREE.CylinderGeometry(0.018, 0.022, 0.5, 7), 0x5a3e26, club(M(0, 0.16, 0)));
      add('handR', new THREE.CylinderGeometry(0.035, 0.052, 0.24, 7), 0x6a4a30, club(M(0, 0.47, 0)));
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        add('handR', new THREE.ConeGeometry(0.013, 0.05, 4), 0x9a9a92, club(M(Math.cos(a) * 0.05, 0.47 + (k % 2) * 0.06, Math.sin(a) * 0.05, 0, -a, -Math.PI / 2)), true);
      }
    },
  };
  const figure = createFigure(look);
  figure.root.scale.setScalar(troll ? 1.9 : 0.78);
  return figure;
}

// --------------------------------------------------------------- monster

class Monster {
  constructor(kind, home, index, shapes, materials) {
    this.kind = kind;
    this.spec = KINDS[kind];
    this.name = this.spec.name;
    this.id = `mon-${index}`;
    this.isMonster = true;
    this.home = home;
    this.position = new THREE.Vector3(home.x, FLOOR, home.z);
    this.radius = this.spec.radius;
    this.heading = Math.random() * Math.PI * 2;
    this.phase = Math.random() * 10;
    this._fling = null;
    this._lift = 0;
    if (kind === 'goblin' || kind === 'troll') {
      this.figure = brute(kind, 300 + index * 13);
      this.root = this.figure.root;
      this.animator = new FigureAnimator(this.figure);
      this.animator.action = 'sword';
      this.animator.settle();
      this.figure.mesh.castShadow = true;
      this.material = null;
    } else {
      const s = shapes[kind];
      this.root = new THREE.Group();
      this.material = materials.critter.clone();
      this.body = new THREE.Mesh(s.body, kind === 'slime' ? materials.slime.clone() : this.material);
      if (kind === 'slime') this.material = this.body.material;
      this.body.castShadow = true;
      this.root.add(this.body, new THREE.Mesh(s.eyes, materials.eyes));
      if (s.core) this.root.add(new THREE.Mesh(s.core, materials.critter));
      if (s.legs) {
        this.legs = [];
        for (let i = 0; i < 8; i++) {
          const side = i < 4 ? 1 : -1;
          const leg = new THREE.Mesh(s.legs, this.material);
          const k = i % 4;
          leg.position.set(side * 0.18, 0.5, 0.16 - k * 0.13);
          leg.userData.base = side > 0 ? 0.75 - k * 0.45 : Math.PI - (0.75 - k * 0.45);
          leg.userData.k = k + (side > 0 ? 0 : 0.5);
          this.legs.push(leg);
          this.root.add(leg);
        }
      }
      this.root.scale.setScalar(kind === 'rat' ? 1.3 : kind === 'spider' ? 1.35 : 1);
    }
    this.root.name = `monster:${kind}`;
    this.reset();
  }

  get calm() {
    return false;
  }

  reset() {
    this.health = this.spec.health;
    this.alive = true;
    this.state = 'idle';
    this.t = 0;
    this.hurt = 0;
    this.said = null;
    this.sayTimer = 0;
    this._fling = null;
    this._lift = 0;
    this._sink = 0;
    this._swung = false;
    this.fell = false;
    this._wander = null;
    this.position.set(this.home.x, FLOOR, this.home.z);
    this.root.visible = true;
    this.root.rotation.set(0, this.heading, 0);
    if (this.animator) {
      this.animator.action = 'sword';
      this.animator.hurt = 0;
      this.animator.settle();
    }
    this._sync();
  }

  /*
   * Struck by the traveller from `from` for `damage`. Returns 'hurt' or 'dead' (or
   * null if already dead). A struck monster is always roused.
   */
  hit(damage, from) {
    if (!this.alive) return null;
    this.health -= damage;
    this.hurt = 1;
    if (this.animator) this.animator.hurt = 1;
    this.state = this.state === 'windup' ? 'windup' : 'chase';
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.fell = true; // the mine pays out its crowns on its next update
      this.state = 'dying';
      this.t = 0;
      if (this.animator) this.animator.action = 'downed';
      return 'dead';
    }
    // A light shove back (the troll hardly moves).
    if (!this.spec.boss) this.fling(from, 0.6);
    return 'hurt';
  }

  // Thrown back `distance` metres from `from`, sliding to a stop with a hop.
  fling(from, distance) {
    const dx = this.position.x - from.x;
    const dz = this.position.z - from.z;
    const d = Math.hypot(dx, dz) || 1;
    const k = this.spec.boss ? 0.35 : 1;
    const dur = 0.45;
    const speed = (2 * distance * k) / dur;
    this._fling = { vx: (dx / d) * speed, vz: (dz / d) * speed, t: 0, dur, hop: Math.min(0.9, distance * k * 0.18) };
  }

  say(text, seconds = 1.6) {
    this.said = text;
    this.sayTimer = seconds;
  }

  /*
   * player: the traveller; world: for walls; events(type, monster, value): 'blow' when
   * a strike lands on the traveller, 'roused' when the boss first notices them.
   */
  update(dt, player, world, events) {
    if (this.sayTimer > 0 && (this.sayTimer -= dt) <= 0) this.said = null;
    this.hurt = Math.max(0, this.hurt - dt * 4);
    if (this.state === 'dead') return;
    if (this._fling) this._flight(dt, world);
    const s = this.spec;
    const pos = this.position;
    const pp = player.position;
    const dx = pp.x - pos.x;
    const dz = pp.z - pos.z;
    const dist = Math.hypot(dx, dz);
    const reachable = pp.y - FLOOR < 2.2 + (s.boss ? 1.5 : 0);
    const toPlayer = Math.atan2(dx, dz);
    let moving = 0;

    switch (this.state) {
      case 'dying':
        this.t += dt;
        if (this.t > 1.6) {
          this.state = 'dead';
          this.root.visible = false;
        }
        break;
      case 'idle': {
        // Pottering about at home until the traveller comes close.
        if (dist < s.aggro && reachable) {
          this.state = 'chase';
          if (s.boss) events('roused', this);
          break;
        }
        if (!this._wander || this._wander.t <= 0) this._wander = { x: this.home.x + rnd(-2.5, 2.5), z: this.home.z + rnd(-2.5, 2.5), t: rnd(2, 5) };
        this._wander.t -= dt;
        moving = this._move(this._wander.x, this._wander.z, s.speed * 0.3, dt, world);
        break;
      }
      case 'return':
        moving = this._move(this.home.x, this.home.z, s.speed, dt, world);
        if (Math.hypot(this.home.x - pos.x, this.home.z - pos.z) < 1) this.state = 'idle';
        else if (dist < s.aggro * 0.6 && reachable) this.state = 'chase';
        break;
      case 'chase':
        if (Math.hypot(this.home.x - pos.x, this.home.z - pos.z) > LEASH) {
          this.state = 'return';
          break;
        }
        if (dist <= s.reach && reachable) {
          this.state = 'windup';
          this.t = s.windup;
          this._swung = false;
          break;
        }
        moving = this._move(pp.x, pp.z, s.speed, dt, world, s.reach * 0.8);
        break;
      case 'windup':
        this.heading = dampAngle(this.heading, toPlayer, 8, dt);
        this.t -= dt;
        // A club comes down at the end of the wind-up: start the swing so it lands then.
        if (this.animator && !this._swung && this.t <= 0.29) {
          this._swung = true;
          this.animator.strike('slash');
        }
        if (this.t <= 0) {
          if (dist <= s.reach + 0.5 && reachable) events('blow', this, s.damage);
          this.state = 'rest';
          this.t = s.rest;
        }
        break;
      case 'rest':
        this.heading = dampAngle(this.heading, toPlayer, 5, dt);
        this.t -= dt;
        if (this.t <= 0) this.state = 'chase';
        break;
      default:
        break;
    }
    this._animate(dt, moving);
    this._sync();
  }

  // Walks towards (tx, tz) at `speed`, stopping `stop` short; walls block. Returns the speed moved.
  _move(tx, tz, speed, dt, world, stop = 0.2) {
    const pos = this.position;
    const dx = tx - pos.x;
    const dz = tz - pos.z;
    const d = Math.hypot(dx, dz);
    if (d <= stop) return 0;
    this.heading = dampAngle(this.heading, Math.atan2(dx, dz), 7, dt);
    const step = Math.min(d - stop, speed * dt);
    const ox = pos.x;
    const oz = pos.z;
    pos.x += Math.sin(this.heading) * step;
    pos.z += Math.cos(this.heading) * step;
    world.colliders.resolve(pos, this.radius, FLOOR + 0.1, FLOOR + 1.6);
    return dt > 0 ? Math.hypot(pos.x - ox, pos.z - oz) / dt : 0;
  }

  _flight(dt, world) {
    const f = this._fling;
    f.t += dt;
    const u = Math.min(1, f.t / f.dur);
    const k = 1 - u;
    this.position.x += f.vx * k * dt;
    this.position.z += f.vz * k * dt;
    world.colliders.resolve(this.position, this.radius, FLOOR + 0.1, FLOOR + 1.6);
    this._lift = Math.sin(Math.PI * u) * f.hop;
    if (u >= 1) {
      this._fling = null;
      this._lift = 0;
    }
  }

  _animate(dt, speed) {
    this.phase += dt * (2 + speed * 3);
    const p = this.phase;
    const dying = this.state === 'dying';
    if (this.animator) {
      this.animator.update(dt, dying ? 0 : speed / this.root.scale.x);
      if (dying && this.t > 0.9) this._sink = (this.t - 0.9) * 1.2;
      return;
    }
    const lunge = this.state === 'windup' ? Math.sin((1 - this.t / this.spec.windup) * Math.PI) : 0;
    if (this.material && this.material.emissive) this.material.emissive.setRGB(this.hurt * 0.8, this.hurt * 0.08, this.hurt * 0.05);
    if (this.kind === 'rat') {
      this.body.position.y = Math.abs(Math.sin(p * 2.2)) * 0.05 * Math.min(1, speed);
      this.body.rotation.x = -lunge * 0.35;
      this.body.position.z = lunge * 0.15;
    } else if (this.kind === 'spider') {
      for (const leg of this.legs) {
        const w = Math.sin(p * 2.4 + leg.userData.k * 1.7) * Math.min(1, speed * 0.6 + 0.08);
        leg.rotation.set(0, leg.userData.base + w * 0.28, Math.max(0, w) * 0.25);
      }
      this.body.rotation.x = -lunge * 0.45;
      this.body.position.y = Math.sin(p * 1.3) * 0.02 + lunge * 0.12;
    } else {
      // The slime wobbles and hops as it goes, and swells before it lunges.
      const hop = Math.abs(Math.sin(p * 1.6)) * Math.min(1, speed * 0.5);
      const squash = 1 + Math.sin(p * 3.2) * 0.06 - hop * 0.12 + lunge * 0.25;
      this.root.children.forEach((c) => {
        c.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
        c.position.y = hop * 0.35;
      });
    }
    if (dying) {
      this.root.rotation.z = Math.min(Math.PI * 0.9, this.t * 5);
      this._sink = Math.max(0, this.t - 0.6) * 0.8;
    }
  }

  _sync() {
    this.root.position.set(this.position.x, FLOOR + this._lift - (this.state === 'dying' ? this._sink || 0 : 0), this.position.z);
    this.root.rotation.y = this.heading;
    if (this.state !== 'dying') this.root.rotation.z = 0;
  }
}

// --------------------------------------------------------------- the mine

export class Dungeon {
  constructor(world, quality) {
    this.world = world;
    this.minX = OX - 300;
    world.dungeon = this;
    this.built = false;
    this.active = false;
    this.quality = quality;
    this.monsters = [];
    this.torches = [];
    this.lights = [];
    this.chestOpen = false;
    // Hooks: onBlow(monster, damage), onLoot(monster, coins), onBoss(monster or null),
    // and audio() for the sound effects (an AudioContext and a noise buffer, or null).
    this.onBlow = null;
    this.onLoot = null;
    this.onBoss = null;
    this.audio = () => null;
    this._proj = new THREE.Vector3();
    this._lightTimer = 0;
    this._boss = null;
    this.start = { x: OX, z: 3.5, heading: Math.PI };
    this.exit = { x: OX, z: 4.6 };
    const [lx, lz] = centre(AREA.lair);
    this.chest = { x: OX + lx, z: lz - 9.6 };
  }

  // Ground height anywhere in the mine: one level floor.
  ground() {
    return FLOOR;
  }

  get alive() {
    return this.active ? this.monsters.filter((m) => m.alive) : [];
  }

  // ------------------------------------------------------------- build

  // Builds the scene the first time the traveller goes down (behind the fade).
  build() {
    if (this.built) return;
    this.built = true;
    const scene = new THREE.Scene();
    this.scene = scene;
    scene.background = new THREE.Color(0x050404);
    scene.fog = new THREE.Fog(0x050404, 9, 40);
    scene.add(new THREE.HemisphereLight(0x8a90b0, 0x3a2a1c, 0.9));
    scene.add(new THREE.AmbientLight(0x4a3c30, 0.6));

    const B = this.world.builder();
    const grid = this._grid();
    this._rooms(B, grid);
    this._props(B);
    B.finish(scene);
    this._exitGlow(scene);
    this._chest(scene);
    this._spawn(scene);
    this._coins(scene);
    this.setQuality(this.quality);
    this.minimap = this._paintMap(grid);

    // The camera keeps under the mine's ceilings, as in any room.
    for (const a of AREAS) {
      const hw = (a.x1 - a.x0) / 2;
      const hd = (a.z1 - a.z0) / 2;
      this.world.interiors.push({ x: OX + a.x0 + hw, z: a.z0 + hd, hw, hd, rot: 0, cos: 1, sin: 0, ceiling: FLOOR + HEIGHT - 0.15, top: FLOOR + HEIGHT + 1, floor: FLOOR, lights: [], name: 'mine' });
    }
  }

  // Which whole-metre cells are floor.
  _grid() {
    const { x0, x1, z0, z1 } = BOUNDS;
    const w = x1 - x0;
    const h = z1 - z0;
    const cells = new Uint8Array(w * h);
    for (const a of AREAS) {
      for (let x = a.x0; x < a.x1; x++) for (let z = a.z0; z < a.z1; z++) cells[(x - x0) * h + (z - z0)] = 1;
    }
    const floor = (x, z) => x >= x0 && x < x1 && z >= z0 && z < z1 && cells[(x - x0) * h + (z - z0)] === 1;
    return { floor };
  }

  /*
   * Floors, ceilings and the walls round every edge where floor meets rock, merged
   * into runs; rough rock along the walls; timber props in the tunnels; and torches.
   */
  _rooms(B, grid) {
    const F = B.frame(OX, 0, 0);
    const floorTint = new THREE.Color(0x8a8070);
    const roofTint = new THREE.Color(0x6a6258);
    const wallTint = new THREE.Color(0x9a9284);
    for (const a of AREAS) {
      const [cx, cz] = centre(a);
      const w = a.x1 - a.x0;
      const d = a.z1 - a.z0;
      F.box(a.id === 'hall' ? 'stoneFloor' : 'crag', cx, FLOOR - 0.15, cz, w, 0.3, d, floorTint);
      F.box('crag', cx, FLOOR + HEIGHT + 0.25, cz, w + 1, 0.5, d + 1, roofTint);
    }
    // Wall runs: for each edge between a floor cell and rock.
    const runs = [];
    const { x0, x1, z0, z1 } = BOUNDS;
    for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const alongX = dz !== 0;
      const outer = alongX ? [z0, z1] : [x0, x1];
      const inner = alongX ? [x0, x1] : [z0, z1];
      for (let u = outer[0]; u < outer[1]; u++) {
        let start = null;
        for (let v = inner[0]; v <= inner[1]; v++) {
          const x = alongX ? v : u;
          const z = alongX ? u : v;
          const edge = v < inner[1] && grid.floor(x, z) && !grid.floor(x + dx, z + dz);
          if (edge && start === null) start = v;
          if (!edge && start !== null) {
            runs.push({ alongX, u, a: start, b: v, dx, dz });
            start = null;
          }
        }
      }
    }
    const rock = B.rock;
    let n = 0;
    for (const r of runs) {
      const len = r.b - r.a;
      const mid = (r.a + r.b) / 2;
      // The wall face lies on the cell's outer edge.
      const face = r.u + (r.dx > 0 || r.dz > 0 ? 1 : 0);
      const cx = r.alongX ? mid : face + (r.dx * WALL) / 2;
      const cz = r.alongX ? face + (r.dz * WALL) / 2 : mid;
      const sx = r.alongX ? len + WALL * 2 : WALL;
      const sz = r.alongX ? WALL : len + WALL * 2;
      F.box('crag', cx, FLOOR + HEIGHT / 2, cz, sx, HEIGHT + 0.6, sz, wallTint);
      F.collideBox(cx, cz, sx / 2, sz / 2, FLOOR - 3, FLOOR + HEIGHT + 3);
      // Rough rock bulging from the wall, and a torch now and then.
      for (let t = r.a + 1.2; t < r.b - 0.6; t += 2.6) {
        n++;
        const s = 0.55 + ((n * 37) % 10) / 14;
        const ox = r.alongX ? t : face - r.dx * 0.15;
        const oz = r.alongX ? face - r.dz * 0.15 : t;
        F.geo('crag', rock, ox, FLOOR + 0.15 + ((n * 13) % 7) / 4, oz, n, n * 2.1, n * 0.7, s, s * (1.1 + (n % 3) * 0.4), s, new THREE.Color(0x8a8276).multiplyScalar(0.75 + (n % 5) * 0.07));
      }
      if (len >= 5) {
        for (let t = r.a + 2.5; t < r.b - 1.5; t += 9) {
          const tx = r.alongX ? t : face - r.dx * 0.12;
          const tz = r.alongX ? face - r.dz * 0.12 : t;
          this._torch(F, B, tx, tz, r.dx, r.dz);
        }
      }
    }

    // Timber props along the tunnels, and rails down the first and the last.
    const tunnels = AREAS.filter((a) => !a.room);
    const beam = new THREE.Color(0x6a5440);
    for (const a of tunnels) {
      const alongZ = a.z1 - a.z0 > a.x1 - a.x0;
      const len = alongZ ? a.z1 - a.z0 : a.x1 - a.x0;
      for (let t = 2; t < len - 1; t += 4) {
        const px = alongZ ? (a.x0 + a.x1) / 2 : a.x0 + t;
        const pz = alongZ ? a.z0 + t : (a.z0 + a.z1) / 2;
        for (const s of [-1, 1]) {
          const ox = alongZ ? px + s * 1.75 : px;
          const oz = alongZ ? pz : pz + s * 1.75;
          F.box('timber', ox, FLOOR + HEIGHT / 2, oz, 0.3, HEIGHT, 0.3, beam);
        }
        F.box('timber', px, FLOOR + HEIGHT - 0.25, pz, alongZ ? 4 : 0.32, 0.34, alongZ ? 0.32 : 4, beam);
      }
    }
    for (const a of [AREA.c1, AREA.c5]) {
      const alongZ = a.z1 - a.z0 > a.x1 - a.x0;
      const len = alongZ ? a.z1 - a.z0 : a.x1 - a.x0;
      const [cx, cz] = centre(a);
      for (const s of [-1, 1]) F.box('metal', alongZ ? cx + s * 0.45 : cx, FLOOR + 0.06, alongZ ? cz : cz + s * 0.45, alongZ ? 0.07 : len, 0.08, alongZ ? len : 0.07, new THREE.Color(0x3a3632));
      for (let t = 0.5; t < len; t += 0.8) F.box('timber', alongZ ? cx : a.x0 + t, FLOOR + 0.02, alongZ ? a.z0 + t : cz, alongZ ? 1.3 : 0.2, 0.05, alongZ ? 0.2 : 1.3, beam);
    }
  }

  // A torch on the wall at (x, z), the wall lying towards (dx, dz).
  _torch(F, B, x, z, dx, dz) {
    const y = FLOOR + 2.3;
    F.box('metal', x - dx * 0.12, y - 0.1, z - dz * 0.12, 0.28 * Math.abs(dz) + 0.06, 0.05, 0.28 * Math.abs(dx) + 0.06, new THREE.Color(0x3a3632));
    F.box('timber', x - dx * 0.25, y, z - dz * 0.25, 0.07, 0.45, 0.07, new THREE.Color(0x4a3624), dz * 0.3, 0, -dx * 0.3);
    F.geo('fire', B.flame, x - dx * 0.3, y + 0.32, z - dz * 0.3, 0, 0, 0, 0.45, 0.6, 0.45);
    this.torches.push(new THREE.Vector3(OX + x - dx * 0.5, y + 0.35, z - dz * 0.5));
  }

  // What lies about in each cave.
  _props(B) {
    const F = B.frame(OX, 0, 0);
    const C = (h) => new THREE.Color(h);
    const rock = B.rock;
    // The hall: crates and barrels the miners left, and steps up to the way out.
    for (const [x, z, s] of [[-4.3, -3.8, 1], [-4.6, -2.6, 0.8], [4.4, -4.2, 0.9], [4.2, 2.6, 1]]) {
      F.box('planks', x, FLOOR + 0.4 * s, z, 0.8 * s, 0.8 * s, 0.8 * s, C(0x8a6a4a));
      F.collideBox(x, z, 0.42 * s, 0.42 * s, FLOOR - 1, FLOOR + 0.8 * s);
    }
    for (let k = 0; k < 4; k++) F.box('stone', 0, FLOOR + 0.12 + k * 0.24, 5.2 + k * 0.2, 3.2, 0.24 + k * 0.48, 1.2 - k * 0.25, C(0x9a9284));
    F.collideBox(0, 5.4, 1.6, 0.6, FLOOR - 1, FLOOR + 1.8);
    // The nest: heaps of straw and gnawed crates, and an overturned ore cart.
    for (const [x, z, s] of [[-5, -29, 1.4], [4, -31, 1.2], [5.5, -21, 1.1], [-6, -21.5, 1]]) F.geo('thatch', rock, x, FLOOR - 0.1, z, 0, x, 0, s * 1.3, s * 0.45, s * 1.1, C(0xb89a5a));
    F.box('planks', -2.5, FLOOR + 0.5, -32.6, 1.2, 0.7, 1.6, C(0x6a4a30), 0.4, 0.3, 1.9);
    F.collideCircle(-2.5, -32.6, 0.9, FLOOR - 1, FLOOR + 1);
    // The spiders' cavern: webs across the corners and egg sacs.
    const web = C(0xe8e4dc);
    for (const [cx, cz, a] of [[22.5, -33.5, 0.78], [37.5, -33.5, -0.78], [37.5, -18.5, -2.36], [22.5, -18.5, 2.36]]) {
      for (let k = 0; k < 6; k++) F.box('plainCloth', cx, FLOOR + 2.8, cz, 0.02, 0.02, 3.4, web, (k - 2.5) * 0.28, a, 0);
      for (let r = 0.6; r < 1.7; r += 0.5) F.box('plainCloth', cx + Math.sin(a) * r, FLOOR + 2.8 + r * 0.2, cz + Math.cos(a) * r, 0.02, r * 1.4, 0.02, web, 0, a, Math.PI / 2);
    }
    for (const [x, z] of [[24, -31], [25, -30.4], [35.5, -21], [36.2, -21.8], [33, -33]]) F.geo('crag', rock, x, FLOOR + 0.25, z, 0, x, 0, 0.32, 0.4, 0.3, C(0xe0dccf));
    // The goblins' camp: tents, a fire ringed with stones, crates, a ragged banner.
    const [gx, gz] = centre(AREA.camp);
    for (const [x, z, rot, tint] of [[gx - 7, gz - 7, 0.4, 0x6a5a3a], [gx + 7, gz - 7.5, -0.5, 0x5a4a2e], [gx - 7.5, gz + 6.5, 2.6, 0x4a5a3a]]) {
      const T = B.frame(OX + x, z, rot);
      for (const s of [-1, 1]) T.box('plainCloth', s * 0.75, FLOOR + 0.95, 0, 0.06, 2.2, 2.6, C(tint), 0, 0, s * 0.62);
      T.box('timber', 0, FLOOR + 1.8, 0, 0.08, 0.08, 2.8, C(0x4a3624));
      T.collideBox(0, 0, 1.4, 1.4, FLOOR - 1, FLOOR + 2);
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      F.geo('crag', rock, gx + Math.cos(a) * 0.9, FLOOR + 0.05, gz + Math.sin(a) * 0.9, 0, a, 0, 0.22, 0.2, 0.22, C(0x7a746a));
    }
    for (const a of [0.3, 1.9]) F.box('timber', gx, FLOOR + 0.12, gz, 1.1, 0.14, 0.14, C(0x3a2a1a), 0, a, 0);
    F.geo('fire', B.flame, gx, FLOOR + 0.4, gz, 0, 0, 0, 1.2, 1.4, 1.2);
    F.geo('fire', B.flame, gx + 0.2, FLOOR + 0.3, gz - 0.1, 0, 0, 0, 0.7, 0.9, 0.7);
    this.torches.push(new THREE.Vector3(OX + gx, FLOOR + 1.0, gz));
    F.box('timber', gx + 9.5, FLOOR + 1.5, gz + 9.5, 0.12, 3, 0.12, C(0x4a3624));
    F.box('plainCloth', gx + 9.5, FLOOR + 2.4, gz + 9.05, 0.04, 1.1, 0.8, C(0x8a2a1a));
    for (const [x, z] of [[gx + 8, gz - 1], [gx + 8.5, gz + 0.3], [gx - 9, gz - 1.5]]) {
      F.box('planks', x, FLOOR + 0.35, z, 0.7, 0.7, 0.7, C(0x7a5a3a));
      F.collideBox(x, z, 0.36, 0.36, FLOOR - 1, FLOOR + 0.7);
    }
    F.collideCircle(gx, gz, 0.9, FLOOR - 1, FLOOR + 0.6);
    // The troll's hall: rubble, and the miners' silver heaped by the chest.
    const [lx, lz] = centre(AREA.lair);
    for (const [x, z, s] of [[lx - 9, lz - 9, 1.8], [lx + 8, lz - 9.5, 1.5], [lx - 9.5, lz + 8, 1.6], [lx + 9, lz + 8.5, 1.4], [lx - 4, lz + 9.5, 1.1]]) {
      F.geo('crag', rock, x, FLOOR + 0.2, z, s, x, 0, s, s * 0.9, s, C(0x7a7266));
      F.collideCircle(x, z, s * 0.8, FLOOR - 1, FLOOR + s);
    }
    for (let k = 0; k < 14; k++) {
      const a = k * 2.4;
      const r = 0.5 + (k % 5) * 0.25;
      F.box(k % 3 ? 'metal' : 'gold', lx + 2 + Math.cos(a) * r, FLOOR + 0.06 + (k % 4) * 0.05, lz - 10 + Math.sin(a) * r * 0.5, 0.18, 0.06, 0.12, k % 3 ? C(0xd8dce2) : C(0xffe2a0), 0, a, 0);
    }
  }

  // Daylight at the top of the steps: the way out.
  _exitGlow(scene) {
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(3, 2.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.35, 1.2), fog: false }));
    glow.position.set(OX, FLOOR + 2.2, 6 - 0.05);
    glow.rotation.y = Math.PI;
    scene.add(glow);
    const light = new THREE.PointLight(0xcfd8ff, 12, 12, 1.6);
    light.position.set(OX, FLOOR + 2.4, 4.6);
    scene.add(light);
  }

  // The chest of silver at the back of the troll's hall; its lid opens.
  _chest(scene) {
    const paint = (g, hex) => tinted(g, hex);
    const base = mergeGeometries([
      paint(new THREE.BoxGeometry(1.4, 0.75, 0.9).translate(0, 0.375, 0), 0x7a5232),
      paint(new THREE.BoxGeometry(1.44, 0.08, 0.94).translate(0, 0.2, 0), 0x3a3632),
      paint(new THREE.BoxGeometry(1.44, 0.08, 0.94).translate(0, 0.6, 0), 0x3a3632),
    ]);
    const lidGeo = mergeGeometries([
      paint(new THREE.BoxGeometry(1.42, 0.3, 0.92).translate(0, 0.15, 0.46), 0x7a5232),
      paint(new THREE.BoxGeometry(0.16, 0.18, 0.06).translate(0, 0.0, 0.94), 0xd4a640),
    ]);
    const wood = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.15 });
    this.chestMesh = new THREE.Mesh(base, wood);
    this.chestMesh.position.set(this.chest.x, FLOOR, this.chest.z);
    this.lid = new THREE.Mesh(lidGeo, wood);
    this.lid.position.set(0, 0.75, -0.46);
    this.chestMesh.add(this.lid);
    this.chestMesh.castShadow = true;
    scene.add(this.chestMesh);
    this.world.colliders.addBox(this.chest.x, this.chest.z, 0.75, 0.5, 0, FLOOR - 1, FLOOR + 0.9);
  }

  _spawn(scene) {
    const materials = {
      critter: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
      slime: new THREE.MeshStandardMaterial({ color: 0x5cc850, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.78, emissive: 0x153a10 }),
      eyes: new THREE.MeshBasicMaterial({ vertexColors: true }),
    };
    const shapes = { rat: ratShapes(), spider: spiderShapes(), slime: slimeShapes() };
    let n = 0;
    for (const [area, kind, spots] of SPAWNS) {
      const [cx, cz] = centre(AREA[area]);
      for (const [ox, oz] of spots) {
        const m = new Monster(kind, { x: OX + cx + ox, z: cz + oz }, n++, shapes, materials);
        this.monsters.push(m);
        scene.add(m.root);
      }
    }
    this.boss = this.monsters.find((m) => m.spec.boss);
  }

  // Crowns that burst from a fallen monster and fly to the traveller.
  _coins(scene) {
    const geo = new THREE.CylinderGeometry(0.07, 0.07, 0.016, 12).rotateX(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffd060, metalness: 0.9, roughness: 0.3, emissive: 0x5a3a00 });
    this.coinPool = [];
    for (let i = 0; i < COIN_COUNT; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.coinPool.push({ mesh, t: -1, v: new THREE.Vector3() });
    }
  }

  _burstCoins(x, y, z, count) {
    let made = 0;
    for (const c of this.coinPool) {
      if (made >= count) break;
      if (c.t >= 0) continue;
      c.t = 0;
      c.mesh.visible = true;
      c.mesh.position.set(x, y, z);
      c.v.set(rnd(-2, 2), rnd(3, 5), rnd(-2, 2));
      made++;
    }
  }

  _updateCoins(dt, player) {
    const p = player.position;
    for (const c of this.coinPool) {
      if (c.t < 0) continue;
      c.t += dt;
      const m = c.mesh;
      m.rotation.y += dt * 12;
      if (c.t < 0.45) {
        c.v.y -= 12 * dt;
        m.position.addScaledVector(c.v, dt);
      } else {
        // Then into the traveller's purse.
        const k = 1 - Math.exp(-(8 + c.t * 10) * dt);
        m.position.x += (p.x - m.position.x) * k;
        m.position.y += (p.y + 1.0 - m.position.y) * k;
        m.position.z += (p.z - m.position.z) * k;
        if (m.position.distanceTo(_v.set(p.x, p.y + 1, p.z)) < 0.25 || c.t > 2) {
          c.t = -1;
          m.visible = false;
        }
      }
    }
  }

  setQuality(q) {
    this.quality = q;
    if (!this.scene) return;
    // Torch lights follow the presets' lantern lights, but even Low gets two down here.
    const want = Math.max(2, q.lampLights);
    while (this.lights.length < want) {
      const light = new THREE.PointLight(0xffa050, 0, 15, 1.5);
      this.scene.add(light);
      this.lights.push(light);
    }
    while (this.lights.length > want) this.scene.remove(this.lights.pop());
    this._lightTimer = 0;
  }

  // A parchment-coloured plan of the mine for the minimap.
  _paintMap(grid) {
    const { x0, x1, z0, z1 } = BOUNDS;
    const span = Math.max(x1 - x0, z1 - z0) + 10;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const S = 512;
    const k = S / span;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = '#3a3128';
    g.fillRect(0, 0, S, S);
    g.fillStyle = '#d9c9a0';
    for (let x = x0; x < x1; x++) {
      for (let z = z0; z < z1; z++) {
        if (grid.floor(x, z)) g.fillRect((x - cx + span / 2) * k, (z - cz + span / 2) * k, k + 0.6, k + 0.6);
      }
    }
    g.fillStyle = '#f6e7b0';
    g.fillRect((-1.5 - cx + span / 2) * k, (5 - cz + span / 2) * k, 3 * k, k);
    return { image: c, half: span / 2, cx: OX + cx, cz };
  }

  // ------------------------------------------------------------- visits

  // Everyone back at home, the chest full again; returns where the traveller starts.
  reset() {
    for (const m of this.monsters) m.reset();
    this.chestOpen = false;
    if (this.lid) this.lid.rotation.x = 0;
    this._boss = null;
    for (const c of this.coinPool || []) {
      c.t = -1;
      c.mesh.visible = false;
    }
    return this.start;
  }

  update(dt, player) {
    if (!this.active) return;
    const t = performance.now() * 0.001;
    const mat = this.world.mat;
    if (mat && mat.fire) mat.fire.emissiveIntensity = 2.6 + Math.sin(t * 13) * 0.35 + Math.sin(t * 7.3) * 0.25;
    const events = (type, monster, value) => {
      if (type === 'blow' && this.onBlow) {
        this._sfx('thud');
        this.onBlow(monster, value);
      } else if (type === 'roused') {
        this._sfx('growl');
        monster.say('RAAARGH!', 2);
      }
    };
    for (const m of this.monsters) {
      m.update(dt, player, this.world, events);
      if (m.fell) {
        m.fell = false;
        this._fallen(m);
      }
    }
    this._separate();
    this._updateCoins(dt, player);
    if (this.lid && this.chestOpen && this.lid.rotation.x > -1.9) this.lid.rotation.x = Math.max(-1.9, this.lid.rotation.x - dt * 4);
    this._updateLights(dt, player.position, t);
    // The troll's health bar, while it fights.
    const boss = this.boss && this.boss.alive && this.boss.state !== 'idle' && this.boss.state !== 'return' ? this.boss : null;
    if (boss !== this._boss || boss) {
      this._boss = boss;
      if (this.onBoss) this.onBoss(boss);
    }
  }

  _fallen(m) {
    const coins = rint(m.spec.coins);
    m.say(`+${coins} crowns`, 1.8);
    this._burstCoins(m.position.x, FLOOR + 1, m.position.z, Math.min(10, Math.max(3, Math.round(coins / 2))));
    this._sfx('coin');
    if (this.onLoot) this.onLoot(m, coins);
  }

  // Monsters keep out of each other.
  _separate() {
    const list = this.monsters;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.alive) continue;
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const min = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) / 2;
        a.position.x -= (dx / d) * push;
        a.position.z -= (dz / d) * push;
        b.position.x += (dx / d) * push;
        b.position.z += (dz / d) * push;
      }
    }
  }

  // Keeps the traveller from walking through monsters.
  separate(player) {
    if (!this.active) return;
    const pos = player.position;
    for (const m of this.monsters) {
      if (!m.alive) continue;
      const dx = pos.x - m.position.x;
      const dz = pos.z - m.position.z;
      const min = m.radius + player.radius * 0.85;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min || pos.y - FLOOR > 1.6) continue;
      const d = Math.sqrt(d2) || 1e-6;
      pos.x = m.position.x + (dx / d) * min;
      pos.z = m.position.z + (dz / d) * min;
    }
  }

  // Torch lights go to the torches nearest the traveller; they flicker.
  _updateLights(dt, focus, t) {
    this._lightTimer -= dt;
    if (this._lightTimer <= 0) {
      this._lightTimer = 0.4;
      const near = this.torches.map((p) => ({ p, d: p.distanceToSquared(focus) })).sort((a, b) => a.d - b.d);
      this.lights.forEach((l, i) => {
        if (near[i]) l.position.copy(near[i].p);
      });
    }
    this.lights.forEach((l, i) => {
      l.intensity = 14 * (1 + Math.sin(t * 9 + i * 2.1) * 0.08 + Math.sin(t * 23 + i) * 0.04);
    });
  }

  /*
   * Whom a blow from the traveller lands on: monsters within reach in front (the
   * nearest for a punch, all of them for a sword's sweep).
   */
  struck(player, reach, sweep) {
    if (!this.active) return [];
    const pos = player.position;
    const fx = Math.sin(player.heading);
    const fz = Math.cos(player.heading);
    const hits = [];
    for (const m of this.monsters) {
      if (!m.alive) continue;
      const dx = m.position.x - pos.x;
      const dz = m.position.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d > reach + m.radius || pos.y - FLOOR > 2.4 + (m.spec.boss ? 2 : 0)) continue;
      if (d > 0.3 && (dx * fx + dz * fz) / d < 0.35) continue;
      hits.push({ m, d });
    }
    hits.sort((a, b) => a.d - b.d);
    return (sweep ? hits : hits.slice(0, 1)).map((h) => h.m);
  }

  // What E would do here: climb out, or open the chest.
  reachable(player) {
    if (!this.active) return null;
    const p = player.position;
    if (Math.hypot(p.x - this.exit.x, p.z - this.exit.z) < 2.2) return { exit: true };
    if (Math.hypot(p.x - this.chest.x, p.z - this.chest.z) < 2.0) return this.chestOpen ? null : { chest: true };
    return null;
  }

  // Opens the chest if its guardian has fallen. Returns { coins } or { text }.
  openChest() {
    if (this.chestOpen) return null;
    if (this.boss && this.boss.alive) return { text: 'The cave troll guards the chest. Defeat him first!' };
    this.chestOpen = true;
    const coins = rint(CHEST_COINS);
    this._burstCoins(this.chest.x, FLOOR + 1.2, this.chest.z, 12);
    this._sfx('coin');
    return { coins };
  }

  // Names and health bars over the monsters near the camera.
  labels(camera, width, height) {
    const out = [];
    if (!this.active) return out;
    for (const m of this.monsters) {
      if (!m.root.visible) continue;
      const d = camera.position.distanceTo(m.position);
      const hurt = m.health < m.spec.health;
      if (d > (m.said ? 24 : hurt || m.state !== 'idle' ? 18 : 9)) continue;
      const top = m.animator ? 1.95 * m.root.scale.x : m.kind === 'spider' ? 1.3 : 1.05;
      const p = this._proj.set(m.position.x, FLOOR + top, m.position.z).project(camera);
      if (p.z > 1 || p.z < -1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1) continue;
      out.push({
        id: m.id,
        text: m.name,
        say: m.said,
        health: m.alive && hurt ? m.health / m.spec.health : null,
        x: (p.x * 0.5 + 0.5) * width,
        y: (-p.y * 0.5 + 0.5) * height,
        opacity: m.alive ? 1 : Math.max(0, 1 - m.t / 1.6),
        focus: false,
      });
    }
    return out;
  }

  // ------------------------------------------------------------- sound

  _sfx(type) {
    const a = this.audio();
    if (!a) return;
    const { ctx: c, noise } = a;
    const now = c.currentTime;
    const out = c.createGain();
    out.connect(c.destination);
    if (type === 'coin') {
      out.gain.value = 0.18;
      [1568, 2093, 2637].forEach((f, i) => {
        const o = c.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        const g = c.createGain();
        const t0 = now + i * 0.07;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(1, t0 + 0.005);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
        o.connect(g).connect(out);
        o.start(t0);
        o.stop(t0 + 0.4);
      });
    } else if (type === 'thud') {
      out.gain.value = 0.35;
      const src = c.createBufferSource();
      src.buffer = noise;
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 600;
      const g = c.createGain();
      g.gain.setValueAtTime(1, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      src.connect(f).connect(g).connect(out);
      src.start(now, Math.random() * 0.5);
      src.stop(now + 0.25);
    } else if (type === 'growl') {
      out.gain.value = 0.3;
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(70, now);
      o.frequency.linearRampToValueAtTime(52, now + 1.2);
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 380;
      const g = c.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(1, now + 0.15);
      g.gain.exponentialRampToValueAtTime(0.001, now + 1.3);
      const lfo = c.createOscillator();
      lfo.frequency.value = 18;
      const lg = c.createGain();
      lg.gain.value = 0.4;
      lfo.connect(lg).connect(g.gain);
      o.connect(f).connect(g).connect(out);
      o.start(now);
      lfo.start(now);
      o.stop(now + 1.35);
      lfo.stop(now + 1.35);
    }
  }
}

const _v = new THREE.Vector3();
