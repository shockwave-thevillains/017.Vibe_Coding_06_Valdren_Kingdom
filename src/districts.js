import { mulberry32, makeBuilder } from './district-kit.js';
import * as S from './district-styles.js';

/*
 * districts.js: the quarters of Valdren beyond the old town, where the woods used
 * to be. Each was settled by a people of its own and is built in their manner
 * (district-styles.js):
 *
 *   Hrafnvik             the Viking hold up the western river, inside its palisade
 *   Mudwick              the slums between the old watchtower's hill and the river
 *   Sakuragawa           the Japanese town south of the river, under its castle keep
 *   Saffron Bazaar       the desert merchants' town in the south-west
 *   Jade Lantern Quarter the Chinese town in the north-east
 *   Costa Mirra          the whitewashed lakeside town south of Mirrormere
 *
 * This module holds the plan: where each quarter lies (so the forest keeps out
 * of it), its streets (added to the world's roads, so the land is graded under
 * them and they show on the map), the flat terraces its great buildings stand
 * on, and the builder that lines the streets with houses and raises the
 * landmarks. Everything is placed from fixed seeds, so the quarters are the same
 * on every load.
 */

export const DISTRICTS = [
  { id: 'viking', name: 'Hrafnvik', x0: -538, x1: -370, z0: -238, z1: 114, label: [-455, -120] },
  { id: 'slums', name: 'Mudwick', x0: -366, x1: -126, z0: 20, z1: 114, label: [-250, 78] },
  { id: 'japan', name: 'Sakuragawa', x0: -538, x1: -132, z0: 150, z1: 346, label: [-262, 236] },
  { id: 'desert', name: 'Saffron Bazaar', x0: -538, x1: -132, z0: 366, z1: 535, label: [-262, 436] },
  { id: 'china', name: 'Jade Lantern Quarter', x0: 172, x1: 528, z0: -528, z1: -182, label: [318, -330] },
  { id: 'medi', name: 'Costa Mirra', x0: 326, x1: 534, z0: 188, z1: 430, label: [452, 330] },
];

// Named places in the quarters, for the map.
export const DISTRICT_PLACES = [
  ...DISTRICTS.map((d) => ({ name: d.name, x: d.label[0], z: d.label[1], size: 2 })),
  { name: 'Mead Hall', x: -455, z: -62, size: 0 },
  { name: 'Sakuragawa Keep', x: -440, z: 228, size: 1 },
  { name: 'Red Bridge', x: -300, z: 128, size: 0 },
  { name: 'Bathhouse', x: -238, z: 176, size: 0 },
  { name: 'Caravanserai', x: -330, z: 474, size: 1 },
  { name: 'Drum Tower', x: 350, z: -455, size: 0 },
  { name: 'Magistrate’s Hall', x: 350, z: -520, size: 0 },
  { name: 'Moon Garden', x: 240, z: -255, size: 0 },
  { name: 'Piazza', x: 452, z: 300, size: 0 },
];

// The river's centre line (the same curve as world.js's riverZ).
const riverZ = (x) => 128 + 18 * Math.sin(x * 0.012) + 8 * Math.sin(x * 0.031 + 1.3);
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// 0 outside every quarter, 1 well inside one: the forest gives way where this is high.
export function districtWeight(x, z) {
  let w = 0;
  for (const D of DISTRICTS) {
    const d = Math.min(x - D.x0, D.x1 - x, z - D.z0, D.z1 - z);
    if (d > -30) w = Math.max(w, smooth(-30, 6, d));
  }
  return w;
}

// Flat ground for the great buildings: { x, z, r, fade } (y is filled in by world.js).
export const TERRACES = [
  { x: -455, z: -45, r: 24, fade: 18 },   // the mead hall
  { x: -440, z: 255, r: 54, fade: 24 },   // the keep and its walls
  { x: -440, z: 318, r: 14, fade: 10 },   // the keep's garden
  { x: -330, z: 449, r: 31, fade: 14 },   // the caravanserai
  { x: 350, z: -472, r: 16, fade: 12 },   // the drum tower
  { x: 350, z: -508, r: 20, fade: 12 },   // the magistrate's hall
  { x: 240, z: -232, r: 28, fade: 12 },   // the moon garden
  { x: 452, z: 286, r: 20, fade: 12 },    // the piazza
];

// ---------------------------------------------------------------- streets

const ROADS = [];
const road = (culture, kind, w, pts) => ROADS.push({ kind, w, culture, pts });
// Deterministic wobble for the crooked lanes.
const wob = (a, b, amp) => (Math.sin(a * 12.9898 + b * 78.233) * 43758.5453 % 1) * amp;

// Hrafnvik: a ring road round the mead hall inside the palisade, the way in from
// Mudwick, paths down to the boats and up to the farms.
export const VIKING = { x: -455, z: -45, ring: 40, wall: 60 };
road('viking', 'dirt', 5, [[-366, 44], [-392, 32], [-420, 14], [-446, -6], [-455, -24]]);
road('viking', 'dirt', 4, [[-455, -24], [-459, 20], [-465, 66], [-470, 106]]);
road('viking', 'dirt', 4, [[-478, -48], [-472, -96], [-462, -150], [-450, -232]]);
road('viking', 'dirt', 4, Array.from({ length: 17 }, (_, k) => {
  const a = (k / 16) * Math.PI * 2;
  return [VIKING.x + Math.cos(a) * VIKING.ring, VIKING.z + Math.sin(a) * VIKING.ring];
}));
road('viking', 'dirt', 3.6, [[-532, -152], [-482, -153], [-424, -146], [-376, -140]]);
road('viking', 'dirt', 3.6, [[-528, -206], [-466, -201], [-392, -194]]);
road('viking', 'dirt', 3.6, [[-530, 64], [-492, 58], [-462, 56], [-420, 62], [-380, 72]]);

// Mudwick: one muddy main lane, crooked alleys down to the river and a lane along the bank.
road('slums', 'dirt', 4.5, [[-136, 2], [-150, 28], [-185, 46], [-230, 55], [-275, 51], [-320, 46], [-366, 44]]);
for (const x of [-166, -198, -230, -262, -292, -322, -350]) {
  const zb = riverZ(x) - 22;
  road('slums', 'dirt', 3.2, [[x + wob(x, 1, 6) - 3, 28], [x + wob(x, 2, 6) - 3, 50], [x + wob(x, 3, 8) - 4, (50 + zb) / 2], [x + wob(x, 4, 6) - 3, zb]]);
}
road('slums', 'dirt', 3.2, Array.from({ length: 15 }, (_, k) => {
  const x = -150 - k * 15;
  return [x, riverZ(x) - 21 + wob(x, 5, 3) - 1.5];
}));
road('slums', 'dirt', 3.2, [[-170, 31], [-215, 34], [-260, 32], [-305, 31], [-348, 34]]);

// Sakuragawa: a grid of streets east of the keep, an avenue from the keep's gate,
// a lane past the farms to the west, links to the farmstead and the bazaar.
const JZ = [176, 211, 256, 296, 331];
const JX = [-150, -185, -220, -255, -300, -335, -370];
for (const z of JZ) road('japan', 'dirt', z === 256 ? 7 : 4, [[z === 256 ? -398 : -372, z], [-142, z]]);
for (const x of JX) road('japan', 'dirt', x === -300 ? 6 : 4, [[x, x === -300 ? 150 : 172], [x, 335]]);
road('japan', 'dirt', 3.6, [[-504, 176], [-508, 230], [-506, 290], [-500, 338], [-440, 340], [-372, 334]]);
road('japan', 'dirt', 3.6, [[-142, 211], [-95, 208], [-55, 203], [-30, 194]]);

// Saffron Bazaar: the long bazaar street, three cross streets and lanes between them,
// with a road on to Millbrook.
const DZ = [388, 478, 512];
const DX = [-170, -210, -250, -290, -375, -415, -455, -495];
road('desert', 'dirt', 7, [[-128, 420], [-330, 420], [-522, 420]]);
for (const z of DZ) road('desert', 'dirt', 4, [[z === 388 ? -505 : -515, z], [z === 512 ? -170 : -150, z]]);
for (const x of DX) road('desert', 'dirt', 4, [[x, 384], [x, 512]]);
road('desert', 'dirt', 4, [[-22, 380], [-60, 398], [-100, 414], [-128, 420]]);
road('desert', 'dirt', 4, [[-150, 333], [-158, 360], [-170, 386]]);

// The Jade Lantern Quarter: the paved axis from the south gate through the drum tower
// to the magistrate's hall, the cross street, and a grid of lanes.
road('china', 'cobble', 8, [[350, -186], [350, -497]]);
road('china', 'cobble', 7, [[185, -305], [515, -305]]);
for (const z of [-205, -260, -350, -395, -440, -485]) road('china', 'cobble', 4.5, [[185, z], [515, z]]);
for (const x of [195, 285, 415, 460, 505]) road('china', 'cobble', 4.5, [[x, -205], [x, -485]]);
road('china', 'cobble', 4.5, [[240, -260], [240, -485]]);
road('china', 'dirt', 5, [[226, -4], [255, -60], [300, -125], [338, -170], [350, -186]]);
road('china', 'dirt', 4, [[52, -186], [100, -196], [150, -204], [185, -205]]);

// Costa Mirra: the promenade along the shore, terraced streets climbing from it, the
// piazza, and roads to Aldra's Haven and to Millbrook.
road('medi', 'cobble', 6, [[338, 205], [378, 178], [420, 196], [470, 212], [530, 208]]);
for (const z of [240, 272, 304, 336, 368, 400]) road('medi', 'cobble', 4.5, [[336, z], [400, z + 4], [470, z - 3], [528, z + 2]]);
for (const x of [350, 390, 475, 515]) road('medi', 'cobble', 4, [[x, 240], [x + 3, 320], [x - 2, 404]]);
road('medi', 'cobble', 5, [[430, 199], [432, 300], [428, 404]]);
road('medi', 'cobble', 14, [[438, 290], [466, 290]]);
road('medi', 'cobble', 4.5, [[350, 82], [342, 140], [338, 205]]);
road('medi', 'dirt', 3.6, [[104, 372], [170, 380], [260, 360], [336, 336]]);

export const DISTRICT_ROADS = ROADS;

// ------------------------------------------------------------ the builder

// Road edges near a point, from a grid of every road's segments.
class SegGrid {
  constructor(roads, cell = 16) {
    this.cell = cell;
    this.map = new Map();
    for (const r of roads) {
      const p = r.pts;
      for (let i = 0; i < p.length - 1; i++) {
        const s = { ax: p[i].x, az: p[i].z, bx: p[i + 1].x, bz: p[i + 1].z, hw: r.w / 2, road: r };
        const pad = s.hw + 10;
        for (let ix = Math.floor((Math.min(s.ax, s.bx) - pad) / cell); ix <= Math.floor((Math.max(s.ax, s.bx) + pad) / cell); ix++) {
          for (let iz = Math.floor((Math.min(s.az, s.bz) - pad) / cell); iz <= Math.floor((Math.max(s.az, s.bz) + pad) / cell); iz++) {
            const key = ix * 100003 + iz;
            const list = this.map.get(key);
            if (list) list.push(s);
            else this.map.set(key, [s]);
          }
        }
      }
    }
  }

  // Distance from (x, z) to the nearest road edge (negative on a road; 99 if none is near).
  clear(x, z, skip = null) {
    const list = this.map.get(Math.floor(x / this.cell) * 100003 + Math.floor(z / this.cell));
    if (!list) return 99;
    let best = 99;
    for (const s of list) {
      if (s.road === skip) continue;
      const dx = s.bx - s.ax;
      const dz = s.bz - s.az;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / l2));
      const d = Math.hypot(x - s.ax - dx * t, z - s.az - dz * t) - s.hw;
      if (d < best) best = d;
    }
    return best;
  }
}

/*
 * Builds every quarter into the world. ctx is the world's build context (with its
 * own random stream for the quarters); kit hands over the world's Frame, rect
 * helpers, tints, roads, room and furniture builders. Returns counts.
 */
export function buildDistricts(ctx, kit) {
  const B = makeBuilder(ctx, kit);
  const segs = new SegGrid(kit.ROADS);
  const stats = { buildings: 0, walkIn: 0 };
  const env = {
    B,
    ctx,
    kit,
    segs,
    stats,
    dry(x, z, wet = false) {
      const g = ctx.ground(x, z);
      if (kit.lakeWeight(x, z) > (wet ? 0.3 : 0.01)) return false;
      if (wet) return g > kit.WATER_LEVEL - 0.5;
      return g > kit.WATER_LEVEL + 0.9 && (x > 410 || Math.abs(z - riverZ(x)) > 19);
    },
    inZone(D, x, z, m = 2) {
      return x > D.x0 + m && x < D.x1 - m && z > D.z0 + m && z < D.z1 - m;
    },
    // Whether a building's footprint r fits: inside the quarter, on dry and not too
    // steep ground, off every road, clear of everything built.
    fits(D, r, o = {}) {
      // The corners, the middle, and points every few metres along the edges (a
      // street may cross a long wall between its corners).
      const corners = kit.rectCorners(r, 0.3);
      const pts = [[r.x, r.z]];
      for (let k = 0; k < 4; k++) {
        const [ax, az] = corners[k];
        const [bx, bz] = corners[(k + 1) % 4];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 3));
        for (let i = 0; i < n; i++) pts.push([ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n]);
      }
      let lo = Infinity;
      let hi = -Infinity;
      for (const [x, z] of pts) {
        if (!env.inZone(D, x, z)) return false;
        if (!env.dry(x, z, o.wet)) return false;
        if (segs.clear(x, z) < (o.roadPad ?? 0.5) || ctx.world.pathClearance(x, z) < 0.9) return false;
        const g = ctx.ground(x, z);
        lo = Math.min(lo, g);
        hi = Math.max(hi, g);
      }
      if (hi - lo > (o.slope ?? 3.2) || hi > 42) return false;
      return !ctx.overlaps(r, o.pad ?? 0.4);
    },
  };
  for (const D of DISTRICTS) LAYOUT[D.id](env, D, mulberry32(9000 + D.id.length * 131 + D.id.charCodeAt(0)));
  return stats;
}

// Position and direction at arc length s along a resampled road.
function along(road, cum, s) {
  const p = road.pts;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
  const tx = p[i].x - p[i - 1].x;
  const tz = p[i].z - p[i - 1].z;
  const tl = Math.hypot(tx, tz) || 1;
  return { x: p[i - 1].x + tx * t, z: p[i - 1].z + tz * t, tx: tx / tl, tz: tz / tl };
}

function lengths(road) {
  const cum = [0];
  for (let i = 1; i < road.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(road.pts[i].x - road.pts[i - 1].x, road.pts[i].z - road.pts[i - 1].z));
  return cum;
}

/*
 * Lines the quarter's streets with buildings facing them. o.pick(rng, row, road)
 * gives { w, d, build } for the next plot; o.rows: how many rows deep (the second
 * stands behind the first, o.depth in from the street); o.gap(rng): space between
 * neighbours; o.setback: from the road's edge.
 */
function lineStreets(env, D, roads, rng, o) {
  const { B, ctx, kit } = env;
  for (let row = 0; row < (o.rows || 1); row++) {
    for (const road of roads) {
      const cum = lengths(road);
      const total = cum[cum.length - 1];
      for (const side of [1, -1]) {
        let s = 1 + rng() * 3;
        while (s < total - 2) {
          const spec = o.pick(rng, row, road);
          if (!spec) {
            s += 4;
            continue;
          }
          const at = along(road, cum, Math.min(total, s + spec.w / 2));
          const nx = -at.tz * side;
          const nz = at.tx * side;
          const off = road.w / 2 + (o.setback ?? 1.0) + row * ((o.depth ?? 12) + 1.2) + spec.d / 2;
          const cx = at.x + nx * off;
          const cz = at.z + nz * off;
          const rot = Math.atan2(-nx, -nz) + (o.skew ? (rng() - 0.5) * o.skew : 0);
          const r = kit.rect(cx, cz, spec.w / 2, spec.d / 2, rot);
          if (env.fits(D, r, spec.fit || o.fit)) {
            spec.build(B, B.frame(cx, cz, rot), spec.w, spec.d, rng, { row, road, side });
            ctx.occupy(kit.rect(cx, cz, spec.w / 2 + 0.15, spec.d / 2 + 0.15, rot));
            env.stats.buildings++;
            s += spec.w + (o.gap ? o.gap(rng) : 1);
          } else {
            s += 2.5;
          }
        }
      }
    }
  }
}

// Street furniture every `spacing` metres along the roads, alternating sides.
function streetLamps(env, D, roads, spacing, build, inset = 0.7) {
  const { B, ctx, kit, segs } = env;
  for (const road of roads) {
    const cum = lengths(road);
    const total = cum[cum.length - 1];
    let side = 1;
    for (let s = spacing / 2; s < total; s += spacing) {
      side = -side;
      const at = along(road, cum, s);
      const nx = -at.tz * side;
      const nz = at.tx * side;
      const x = at.x + nx * (road.w / 2 + inset);
      const z = at.z + nz * (road.w / 2 + inset);
      if (!env.inZone(D, x, z, 0) || !env.dry(x, z)) continue;
      if (ctx.occupied(x, z, 0.4) || segs.clear(x, z, road) < 0.3 || ctx.world.pathClearance(x, z) < 1.0) continue;
      build(B, B.frame(x, z, Math.atan2(-nx, -nz)));
      ctx.occupy(kit.rect(x, z, 0.45, 0.45));
    }
  }
}

// Trees in the open ground of a quarter: up to n of them, of kinds chosen by kind(rng).
function plantTrees(env, D, rng, n, kind, spacing = 9) {
  const { B, ctx, kit, segs } = env;
  let planted = 0;
  for (let tries = 0; planted < n && tries < n * 12; tries++) {
    const x = D.x0 + 4 + rng() * (D.x1 - D.x0 - 8);
    const z = D.z0 + 4 + rng() * (D.z1 - D.z0 - 8);
    if (!env.dry(x, z) || segs.clear(x, z) < 2 || ctx.occupied(x, z, spacing / 3) || ctx.world.pathClearance(x, z) < 1.8) continue;
    const g = ctx.ground(x, z);
    if (Math.abs(ctx.ground(x + 2, z) - g) > 1.2 || Math.abs(ctx.ground(x, z + 2) - g) > 1.2) continue;
    B.tree(x, z, kind(rng), 0.8 + rng() * 0.45);
    ctx.occupy(kit.rect(x, z, 1.2, 1.2));
    planted++;
  }
}

// Things dotted about the open ground (junk heaps, racks, braziers).
function scatter(env, D, rng, n, build, pad = 2) {
  const { B, ctx, kit, segs } = env;
  for (let tries = 0, made = 0; made < n && tries < n * 15; tries++) {
    const x = D.x0 + 4 + rng() * (D.x1 - D.x0 - 8);
    const z = D.z0 + 4 + rng() * (D.z1 - D.z0 - 8);
    if (!env.dry(x, z) || segs.clear(x, z) < 0.8 || ctx.occupied(x, z, pad) || ctx.world.pathClearance(x, z) < pad + 0.8) continue;
    build(B, B.frame(x, z, rng() * Math.PI * 2), rng);
    ctx.occupy(kit.rect(x, z, pad, pad));
    made++;
  }
}

const range = (rng, a, b) => a + rng() * (b - a);
const of = (env, id, test = null) => env.kit.ROADS.filter((r) => r.culture === id && (!test || test(r)));

const LAYOUT = {
  viking(env, D, rng) {
    const { B, ctx, kit } = env;
    const V = VIKING;
    S.meadHall(B, B.frame(V.x, V.z, 0), rng, 'meadKeeper');
    env.stats.walkIn++;
    // Where the paths cross the palisade, it leaves a gate.
    const gaps = [];
    for (const r of of(env, 'viking')) {
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = Math.hypot(r.pts[i].x - V.x, r.pts[i].z - V.z) - V.wall;
        const b = Math.hypot(r.pts[i + 1].x - V.x, r.pts[i + 1].z - V.z) - V.wall;
        if (a * b <= 0) {
          const ang = Math.atan2(r.pts[i].z - V.z, r.pts[i].x - V.x);
          if (!gaps.some((g) => Math.abs(Math.atan2(Math.sin(g - ang), Math.cos(g - ang))) < 0.2)) gaps.push(ang);
        }
      }
    }
    S.palisade(B, V.x, V.z, V.wall, gaps);
    for (const a of [0.9, 2.5, -2.4, -0.8]) {
      if (gaps.some((g) => Math.abs(Math.atan2(Math.sin(g - a), Math.cos(g - a))) < 0.35)) continue;
      const x = V.x + Math.cos(a) * (V.wall - 4.5);
      const z = V.z + Math.sin(a) * (V.wall - 4.5);
      S.watchtower(B, B.frame(x, z, -a));
    }
    // Boats on the river, a pier, sheds and racks on the bank.
    for (const [x, dz] of [[-500, -8.5], [-440, -9]]) S.longship(B, x, riverZ(x) + dz, 0.06 * (x > -470 ? 1 : -1), kit.WATER_LEVEL);
    kit.pier(ctx, -470, 107, 0, 15, 3, kit.WATER_LEVEL + 0.7, 0);
    S.boatShed(B, B.frame(-520, 100, Math.PI / 2), 18);
    S.boatShed(B, B.frame(-432, 112, Math.PI / 2), 16);
    for (const [x, z, r] of [[-488, 92, 0.2], [-448, 98, -0.3], [-500, 78, 0.5]]) S.fishRack(B, B.frame(x, z, r), rng);
    // Longhouses along the paths, the ring road and the farm lanes.
    lineStreets(env, D, of(env, 'viking'), rng, {
      setback: 2.5,
      gap: (r) => range(r, 5, 11),
      pick: (r) => ({ w: range(r, 15, 26), d: range(r, 7.5, 9), build: S.longhouse }),
    });
    streetLamps(env, D, of(env, 'viking'), 28, S.vkTorch, 1.0);
    plantTrees(env, D, rng, 140, (r) => (r() < 0.55 ? 'pine' : r() < 0.5 ? 'oakA' : 'oakB'), 10);
  },

  slums(env, D, rng) {
    const { B } = env;
    S.leakyBucket(B, B.frame(-245, 62.5, Math.PI), rng, 'bucketKeeper');
    env.stats.walkIn++;
    S.redBridge(B, -300, 104, 151);
    const roads = of(env, 'slums');
    lineStreets(env, D, roads, rng, {
      rows: 4,
      depth: 5.2,
      setback: 0.3,
      skew: 0.22,
      gap: (r) => range(r, 0.2, 0.9),
      pick: (r, row) => {
        const w = range(r, 3.4, 6.0);
        const d = range(r, 3.4, 5.0);
        if (row < 2 && r() < 0.2) return { w: range(r, 5, 7), d: range(r, 4.5, 5.2), build: S.tenement, fit: { slope: 3.5, pad: 0.25 } };
        return { w, d, build: S.shack, fit: { slope: 3.5, pad: 0.25 } };
      },
    });
    // On the bank below the riverside lane: huts on stilts over the mud.
    lineStreets(env, D, roads.filter((r) => r.pts.length > 30), rng, {
      rows: 2,
      depth: 5.0,
      setback: 0.4,
      skew: 0.2,
      gap: (r) => range(r, 0.4, 1.2),
      pick: (r) => ({ w: range(r, 3.6, 5.5), d: range(r, 3.6, 5), build: (b, F, w, d, rr) => S.shack(b, F, w, d, rr, { stilts: true }), fit: { wet: true, slope: 4, pad: 0.25 } }),
    });
    scatter(env, D, rng, 40, S.junk, 1.6);
    scatter(env, D, rng, 18, S.fireBarrel, 1.2);
    scatter(env, D, rng, 22, S.laundry, 2.6);
    plantTrees(env, D, rng, 30, () => 'oakB', 14);
  },

  japan(env, D, rng) {
    const { B } = env;
    S.japaneseCastle(B, -440, 255);
    S.jpGarden(B, -440, 318, 11);
    S.teahouse(B, B.frame(-318, 265, Math.PI), 12, 9, rng, 'teaKeeper');
    env.stats.walkIn++;
    S.sento(B, B.frame(-238, 189, Math.PI), 14, 18, rng);
    lineStreets(env, D, of(env, 'japan'), rng, {
      rows: 2,
      depth: 12,
      setback: 0.8,
      gap: (r) => range(r, 0.2, 0.8),
      pick: (r, row, road) => {
        const rural = road.pts.some((p) => p.x < -480) || road.pts[0].x > -145;
        if (rural) return r() < 0.7 ? { w: range(r, 9, 12), d: range(r, 7, 9), build: S.minka } : null;
        if (row === 1) return r() < 0.35 ? { w: range(r, 5, 6.5), d: range(r, 5, 6.5), build: S.kura } : { w: range(r, 5.5, 7.5), d: range(r, 8, 10), build: S.machiya };
        return { w: range(r, 5.5, 8), d: range(r, 9, 12.5), build: S.machiya };
      },
    });
    streetLamps(env, D, of(env, 'japan'), 22, S.jpLamp);
    plantTrees(env, D, rng, 150, (r) => (r() < 0.6 ? 'sakura' : r() < 0.5 ? 'pine' : 'bamboo'), 8);
  },

  desert(env, D, rng) {
    const { B } = env;
    S.caravanserai(B, B.frame(-330, 449, Math.PI), rng, 'seraiKeeper');
    const roads = of(env, 'desert');
    lineStreets(env, D, roads, rng, {
      rows: 3,
      depth: 9,
      setback: 0.5,
      gap: (r) => range(r, 0, 0.5),
      pick: (r, row) => ({ w: range(r, 5.5, 10), d: range(r, 6.5, 9), build: S.dsHouse, fit: { pad: row ? 0.2 : 0.4 } }),
    });
    // Awnings across the bazaar street.
    const main = roads.find((r) => r.w === 7);
    if (main) {
      const cum = lengths(main);
      for (let s = 10; s < cum[cum.length - 1] * 0.55; s += 7) {
        const at = along(main, cum, s);
        // Its frame's X runs across the street.
        const F = B.frame(at.x, at.z, Math.atan2(-at.tx, -at.tz));
        const y = Math.max(F.ground(-4.5, 0), F.ground(4.5, 0)) + 4.0;
        S.streetAwning(B, F, 10.5, rng, y);
      }
    }
    streetLamps(env, D, roads, 24, S.dsLamp);
    plantTrees(env, D, rng, 120, () => 'palm', 9);
  },

  china(env, D, rng) {
    const { B } = env;
    S.drumTower(B, B.frame(350, -470, 0));
    S.cnHall(B, B.frame(350, -508, 0), 28, 16, rng, { lift: 1.2, h: 4.6, hip: true, roof: S.CN.roofYellow, beam: S.CN.blue, pitch: 0.34 });
    S.cnGarden(B, 240, -232, 44, 34);
    S.paifang(B, B.frame(350, -192, 0), 16);
    S.paifang(B, B.frame(190, -305, Math.PI / 2), 14);
    S.jadeHouse(B, B.frame(380, -314.5, 0), rng, 'jadeKeeper');
    env.stats.walkIn++;
    const roads = of(env, 'china', (r) => r.kind === 'cobble');
    const main = roads.filter((r) => r.w >= 7);
    lineStreets(env, D, main, rng, {
      setback: 0.8,
      gap: (r) => range(r, 0.2, 0.6),
      pick: (r) => ({ w: range(r, 7, 10), d: range(r, 9, 12), build: S.cnShop }),
    });
    lineStreets(env, D, roads.filter((r) => r.w < 7), rng, {
      rows: 2,
      depth: 12,
      setback: 1.0,
      gap: (r) => range(r, 0.4, 1.2),
      pick: (r, row) => (row === 0 && r() < 0.32 ? { w: range(r, 18, 21), d: range(r, 21, 24), build: S.siheyuan } : { w: range(r, 7, 10), d: range(r, 7, 10), build: S.cnHouse }),
    });
    streetLamps(env, D, main, 12, S.cnLamp);
    streetLamps(env, D, roads.filter((r) => r.w < 7), 26, S.cnLamp);
    plantTrees(env, D, rng, 120, (r) => (r() < 0.45 ? 'oakB' : r() < 0.5 ? 'sakura' : 'bamboo'), 9);
  },

  medi(env, D, rng) {
    const { B, ctx, kit } = env;
    S.loggia(B, B.frame(452, 279, 0), 24);
    S.fountain(B, B.frame(452, 291, 0), 3.2);
    S.taverna(B, B.frame(400, 197, Math.PI), rng, 'tavernaKeeper');
    env.stats.walkIn++;
    for (const x of [455, 505]) {
      const shore = 92 + 108 * Math.sqrt(Math.max(0, 1 - ((x - 482) / 122) ** 2));
      kit.pier(ctx, x, shore + 6, Math.PI, 20, 3, kit.WATER_LEVEL + 0.7, 0);
    }
    const roads = of(env, 'medi');
    lineStreets(env, D, roads.filter((r) => r.w < 10), rng, {
      rows: 2,
      depth: 10,
      setback: 1.2,
      gap: (r) => range(r, 1.0, 3.2),
      pick: (r) => ({ w: range(r, 7, 11), d: range(r, 7, 10), build: S.villa }),
    });
    streetLamps(env, D, roads, 18, S.mdLamp);
    plantTrees(env, D, rng, 150, (r) => (r() < 0.5 ? 'cypress' : 'olive'), 8);
  },
};
