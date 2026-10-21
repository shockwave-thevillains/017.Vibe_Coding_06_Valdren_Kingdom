import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/*
 * world.js: the kingdom of Valdren.
 *
 * Everything static in the world is generated here at load time, with no
 * external assets: the height-field terrain and river, procedural textures,
 * the sky with its time-of-day lighting, the castle, the walled town, the
 * bridge, the farms, the forest and the ruins, plus the collision data used
 * by actors and the camera.
 *
 * Units are metres. North is -Z, east is +X, Y is up.
 */

// =================================================================== layout

export const WORLD_HALF = 400;        // terrain spans [-400, 400] on X and Z
export const PLAY_HALF = 335;         // actors are kept inside this square
export const WATER_LEVEL = 0.8;       // river surface height
export const MAX_WADE_DEPTH = 0.95;   // deeper water cannot be walked into
const RIVERBED_Y = -1.6;
const MAX_GRADE = 1.0;                // rise over run above which a step is refused (45°)
const STEP_UP = 0.45;                 // stairs and kerbs up to this height can be climbed
const TERRAIN_SEGMENTS = 256;         // ~3.1 m grid
const SUN_TILT = 0.5;                 // tilts the sun's arc towards the south
const DAY_MINUTES = 24;               // one full day at daytime speed; nights pass twice as fast
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

// Landmarks shared by every phase.
export const SITES = {
  castle: { x: 0, z: -190, r: 40, y: 32 },
  hall: { x: 0, z: -200, w: 16, d: 28 },
  town: { x: 0, z: 10, r: 78, y: 6 },
  market: { x: 0, z: 12, w: 40, d: 32 },
  tavern: { x: 12, z: -13 },
  chapel: { x: -22, z: -26 },
  smithy: { x: -17, z: 35 },
  graveyard: { x: -40, z: -28 },
  farmland: { x: 40, z: 222, hw: 105, hd: 55, y: 3.2 },
  farmhouse: { x: -24, z: 199 },
  windmill: { x: 72, z: 194 },
  ruins: { x: -240, z: -40 },
  hermitCamp: { x: -226, z: -27 },
  spawn: { x: 1, z: 100, heading: Math.PI },
};

// ============================================================ math helpers

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x, z) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + 1013904223) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

// Fractal value noise in [0, 1].
export function fbm(x, z, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * f + i * 17.31, z * f - i * 9.17) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

let SEG_T = 0; // parameter of the closest point found by segDistance

function segDistance(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1) : 0;
  SEG_T = t;
  const qx = ax + dx * t - px;
  const qz = az + dz * t - pz;
  return Math.sqrt(qx * qx + qz * qz);
}

function pointInPolygon(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function distToPolygonEdge(x, z, pts) {
  let d = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    d = Math.min(d, segDistance(x, z, a[0], a[1], b[0], b[1]));
  }
  return d;
}

// ================================================================ the plan

// Centre line of the river, which flows west to east south of the town.
export function riverZ(x) {
  return 128 + 18 * Math.sin(x * 0.012) + 8 * Math.sin(x * 0.031 + 1.3);
}

function townY(z) {
  return SITES.town.y + (SITES.town.z - z) * 0.025;
}

// Town wall: 12 corners; gates in the middle of segments 2 (south), 5 (west) and 8 (north).
const TOWN_WALL = Array.from({ length: 12 }, (_, k) => {
  const a = (15 + 30 * k) * DEG;
  const r = [2, 3, 5, 6, 8, 9].includes(k) ? 72 : 70 + hash2(k, 99) * 4;
  return [SITES.town.x + Math.cos(a) * r, SITES.town.z + Math.sin(a) * r];
});
const TOWN_GATES = new Map([[2, 'south'], [5, 'west'], [8, 'north']]);
const TOWN_INNER = 72 * Math.cos(15 * DEG); // distance from the centre to the gate midpoints

// Castle curtain wall: 8 corners, gatehouse in the middle of segment 1 (south).
const CASTLE_WALL = Array.from({ length: 8 }, (_, k) => {
  const a = (22.5 + 45 * k) * DEG;
  return [SITES.castle.x + Math.cos(a) * 34, SITES.castle.z + Math.sin(a) * 34];
});
const CASTLE_GATES = new Map([[1, 'castle']]);
const CASTLE_GATE_Z = SITES.castle.z + 34 * Math.cos(22.5 * DEG);

const MARKET = { x0: -20, x1: 20, z0: -4, z1: 28 };

// Fields south of the river: centre, size, rotation and crop.
const FIELDS = [
  { x: 40, z: 231, w: 36, d: 34, rot: 0, crop: 'wheat' },
  { x: 92, z: 238, w: 36, d: 40, rot: 0.05, crop: 'wheat' },
  { x: 35, z: 263, w: 30, d: 17, rot: 0, crop: 'cabbage' },
  { x: -22, z: 245, w: 30, d: 30, rot: -0.04, crop: 'plowed' },
  { x: 125, z: 196, w: 24, d: 36, rot: 0, crop: 'barley' },
];

const RIVER_MID = riverZ(0);
export const BRIDGE = { x: 0, zN: RIVER_MID - 17, zS: RIVER_MID + 17, halfWidth: 3.1, rise: 1.6, hN: 0, hS: 0 };

// Named places for the map.
export const PLACES = [
  { name: 'Castle Valdren', x: 0, z: -168, size: 2 },
  { name: 'Throne Hall', x: 0, z: -200, size: 0 },
  { name: 'Valdren', x: 34, z: 36, size: 2 },
  { name: 'Market', x: 0, z: 18, size: 0 },
  { name: 'The Broken Oar', x: 12, z: -13, size: 0 },
  { name: 'Chapel', x: -22, z: -26, size: 0 },
  { name: 'Forge', x: -17, z: 35, size: 0 },
  { name: 'Old Bridge', x: 14, z: RIVER_MID, size: 1 },
  { name: 'Farmstead', x: -24, z: 208, size: 1 },
  { name: 'Windmill', x: 72, z: 186, size: 0 },
  { name: 'The Greywatch', x: -240, z: -52, size: 1 },
  { name: 'Western Woods', x: -200, z: 60, size: 1 },
];

const ROAD_DEFS = [
  // Town streets.
  { kind: 'cobble', town: true, w: 6, pts: [[0, TOWN_INNER + 10], [4, 64], [-3, 46], [0, 27]] },
  { kind: 'cobble', town: true, w: 5.5, pts: [[0, -3], [-6, -22], [5, -42], [0, 10 - TOWN_INNER]] },
  { kind: 'cobble', town: true, w: 4.5, pts: [[-19, 10], [-38, 4], [-56, 12], [-TOWN_INNER, 10]] },
  { kind: 'cobble', town: true, w: 4.5, pts: [[19, 10], [38, 18], [52, 4], [46, -18], [26, -30], [5, -42]] },
  { kind: 'cobble', town: true, w: 4, pts: [[-3, 46], [-22, 52], [-40, 38], [-56, 12]] },
  // The royal road up the castle hill.
  { kind: 'cobble', w: 5, pts: [[0, 10 - TOWN_INNER], [-4, -74], [-22, -90], [-20, -110], [8, -124], [20, -140], [8, -152], [0, CASTLE_GATE_Z - 5]] },
  // Country roads.
  { kind: 'dirt', w: 5, pts: [[0, TOWN_INNER + 10], [1, 98], [0, BRIDGE.zN + 0.3]] },
  { kind: 'dirt', w: 4.5, pts: [[0, BRIDGE.zS - 0.3], [2, 170], [6, 190], [12, 205], [40, 205], [66, 199]] },
  { kind: 'dirt', w: 3.5, pts: [[6, 190], [-8, 196], [-19.5, 199]] },
  { kind: 'dirt', w: 3.2, pts: [[-TOWN_INNER, 10], [-100, 4], [-140, -8], [-180, -22], [-212, -34], [-233, -38]] },
];

// ============================================================ height field

const FIELD = { road: 0, dirt: 0, town: 0, farm: 0 }; // masks left behind by the last heightAt call

function baseHeight(x, z) {
  // Rolling meadows with small bumps.
  let h = 3 + fbm(x * 0.005, z * 0.005, 4) * 13 + (fbm(x * 0.03 + 50, z * 0.03 - 20, 2) - 0.5) * 1.6;

  // Castle hill: a flat crown rising out of the meadows north of the town.
  const c = SITES.castle;
  const hill = 1 - smoothstep(c.r, c.r + 72, Math.hypot(x - c.x, z - c.z));
  h = lerp(h, c.y, hill) + (fbm(x * 0.05, z * 0.05, 2) - 0.5) * 6 * hill * (1 - hill);

  // Knoll carrying the ruined watchtower at the forest edge.
  const r = SITES.ruins;
  h += (1 - smoothstep(8, 55, Math.hypot(x - r.x, z - r.z))) * 13;

  // Town shelf, tilting gently down towards the river.
  const t = SITES.town;
  const town = 1 - smoothstep(t.r, t.r + 18, Math.hypot(x - t.x, z - t.z));
  h = lerp(h, townY(z), town);

  // Farmland south of the river, with a mound for the windmill.
  const f = SITES.farmland;
  const fd = Math.max(Math.abs(x - f.x) / f.hw, Math.abs(z - f.z) / f.hd);
  const farm = 1 - smoothstep(0.85, 1.15, fd);
  h = lerp(h, f.y + (fbm(x * 0.01, z * 0.01, 2) - 0.5) * 1.5, farm);
  const wm = SITES.windmill;
  h += (1 - smoothstep(7, 18, Math.hypot(x - wm.x, z - wm.z))) * 2.4;

  // Mountains ring the kingdom.
  const edge = Math.max(Math.abs(x), Math.abs(z)) + (fbm(x * 0.008 + 7, z * 0.008 + 3, 3) - 0.5) * 50;
  const mountain = smoothstep(300, 385, edge);
  if (mountain > 0) {
    const ridge = 1 - Math.abs(fbm(x * 0.012 + 3, z * 0.012 - 5, 4) * 2 - 1);
    h += mountain * (30 + ridge * 55);
  }

  FIELD.town = town;
  FIELD.farm = farm;
  return h;
}

// Roads, resampled every ~2 m, each with a smoothed height profile to cut and fill to.
const ROADS = ROAD_DEFS.map((def) => {
  const curve = new THREE.CatmullRomCurve3(def.pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const n = Math.max(2, Math.ceil(curve.getLength() / 2));
  const pts = curve.getSpacedPoints(n).map((p) => ({ x: p.x, z: p.z }));
  const raw = pts.map((p) => baseHeight(p.x, p.z));
  const prof = raw.map((_, i) => {
    let s = 0;
    let c = 0;
    for (let k = -6; k <= 6; k++) {
      if (raw[i + k] !== undefined) {
        s += raw[i + k];
        c++;
      }
    }
    return s / c;
  });
  const xs = pts.map((p) => p.x);
  const zs = pts.map((p) => p.z);
  const pad = def.w / 2 + 6;
  return {
    ...def,
    pts,
    prof,
    minX: Math.min(...xs) - pad,
    maxX: Math.max(...xs) + pad,
    minZ: Math.min(...zs) - pad,
    maxZ: Math.max(...zs) + pad,
  };
});

function applyRoads(h, x, z) {
  let best = Infinity;
  let bh = 0;
  let road = null;
  for (const r of ROADS) {
    if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue;
    const p = r.pts;
    for (let i = 0; i < p.length - 1; i++) {
      const d = segDistance(x, z, p[i].x, p[i].z, p[i + 1].x, p[i + 1].z) - r.w / 2;
      if (d < best) {
        best = d;
        bh = lerp(r.prof[i], r.prof[i + 1], SEG_T);
        road = r;
      }
    }
  }
  FIELD.road = 0;
  FIELD.dirt = 0;
  if (!road) return h;
  FIELD.road = 1 - smoothstep(-0.3, 1.2, best);
  FIELD.dirt = road.kind === 'dirt' ? FIELD.road : 0;
  return lerp(h, bh, 1 - smoothstep(0.6, 5, best));
}

// Distance from (x, z) to the nearest road edge (negative on the road).
function roadClearance(x, z, filter) {
  let best = Infinity;
  for (const r of ROADS) {
    if (filter && !filter(r)) continue;
    if (x < r.minX - 20 || x > r.maxX + 20 || z < r.minZ - 20 || z > r.maxZ + 20) continue;
    const p = r.pts;
    for (let i = 0; i < p.length - 1; i++) {
      best = Math.min(best, segDistance(x, z, p[i].x, p[i].z, p[i + 1].x, p[i + 1].z) - r.w / 2);
    }
  }
  return best;
}

function preRiverHeight(x, z) {
  return applyRoads(baseHeight(x, z), x, z);
}

// The analytic shape of the land. The terrain mesh samples this on a grid;
// gameplay queries go through Terrain.getHeight so they match the mesh exactly.
export function heightAt(x, z) {
  const h = preRiverHeight(x, z);
  const bank = smoothstep(5, 17, Math.abs(z - riverZ(x)));
  return lerp(RIVERBED_Y, h, bank);
}

BRIDGE.hN = preRiverHeight(0, BRIDGE.zN);
BRIDGE.hS = preRiverHeight(0, BRIDGE.zS);

function deckHeight(z) {
  const t = clamp((z - BRIDGE.zN) / (BRIDGE.zS - BRIDGE.zN), 0, 1);
  return lerp(BRIDGE.hN, BRIDGE.hS, t) + BRIDGE.rise * Math.sin(Math.PI * t);
}

// 0..1: how wooded a place is.
export function forestDensity(x, z) {
  const n = (fbm(x * 0.012 + 40, z * 0.012 - 13, 3) - 0.5) * 60;
  let f = smoothstep(-125, -175, x + n);
  f = Math.max(f, smoothstep(160, 210, x - n) * smoothstep(-110, -160, z + n));
  f = Math.max(f, smoothstep(-110, -150, x + n) * smoothstep(165, 200, z - n));
  f *= smoothstep(26, 42, Math.hypot(x - SITES.ruins.x, z - SITES.ruins.z));
  f *= smoothstep(16, 26, Math.abs(z - riverZ(x)));
  return f;
}

// ======================================================= procedural textures

let ANISOTROPY = 4;

function tileNoise(x, y, px, py, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const x0 = ((ix % px) + px) % px;
  const y0 = ((iy % py) + py) % py;
  const x1 = (x0 + 1) % px;
  const y1 = (y0 + 1) % py;
  const s = seed * 7919;
  const a = hash2(x0 + s, y0);
  const b = hash2(x1 + s, y0);
  const c = hash2(x0 + s, y1);
  const d = hash2(x1 + s, y1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

// Seamless fractal noise over u, v in [0, 1); p is the base number of cells.
function tileFbm(u, v, p, octaves, seed) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let per = p;
  for (let i = 0; i < octaves; i++) {
    sum += tileNoise(u * per, v * per, per, per, seed + i) * amp;
    norm += amp;
    amp *= 0.5;
    per *= 2;
  }
  return sum / norm;
}

const CELL = { d1: 0, d2: 0, id: 0 };

// Seamless cellular noise with `cells` jittered points per side.
function cellular(u, v, cells, seed) {
  const x = u * cells;
  const y = v * cells;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let d1 = 9;
  let d2 = 9;
  let id = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx;
      const cy = iy + dy;
      const wx = ((cx % cells) + cells) % cells;
      const wy = ((cy % cells) + cells) % cells;
      const px = cx + 0.15 + hash2(wx + seed * 131, wy) * 0.7;
      const py = cy + 0.15 + hash2(wx, wy + seed * 173) * 0.7;
      const d = Math.hypot(x - px, y - py);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = wy * cells + wx;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  CELL.d1 = d1;
  CELL.d2 = d2;
  CELL.id = id;
  return CELL;
}

function heightToNormal(h, S, strength) {
  const out = new Uint8Array(S * S * 4);
  const k = (strength * S) / 256;
  for (let j = 0; j < S; j++) {
    const jr = j * S;
    const jm = ((j - 1 + S) % S) * S;
    const jp = ((j + 1) % S) * S;
    for (let i = 0; i < S; i++) {
      const im = (i - 1 + S) % S;
      const ip = (i + 1) % S;
      const nx = (h[jr + im] - h[jr + ip]) * k;
      const ny = (h[jm + i] - h[jp + i]) * k;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const o = (jr + i) * 4;
      out[o] = (nx * inv * 0.5 + 0.5) * 255;
      out[o + 1] = (ny * inv * 0.5 + 0.5) * 255;
      out[o + 2] = (inv * 0.5 + 0.5) * 255;
      out[o + 3] = 255;
    }
  }
  return out;
}

function dataTexture(data, S, srgb) {
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = ANISOTROPY;
  t.needsUpdate = true;
  return t;
}

// Runs painter(u, v, px) for every texel; px receives r, g, b (sRGB 0..1) and h (height).
function makeTexture(S, painter, normalStrength = 0) {
  const color = new Uint8Array(S * S * 4);
  const height = new Float32Array(S * S);
  const px = { r: 0, g: 0, b: 0, h: 0 };
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      painter(i / S, j / S, px);
      const k = j * S + i;
      color[k * 4] = clamp(px.r, 0, 1) * 255;
      color[k * 4 + 1] = clamp(px.g, 0, 1) * 255;
      color[k * 4 + 2] = clamp(px.b, 0, 1) * 255;
      color[k * 4 + 3] = 255;
      height[k] = px.h;
    }
  }
  return {
    map: dataTexture(color, S, true),
    normal: normalStrength > 0 ? dataTexture(heightToNormal(height, S, normalStrength), S, false) : null,
  };
}

// Dressed stone in courses of irregular blocks.
function paintStone(seed) {
  const rows = 6;
  const courses = [];
  for (let r = 0; r < rows; r++) {
    const cuts = [];
    let acc = 0;
    while (acc < 0.999) {
      cuts.push(acc);
      acc += 0.2 + hash2(r * 31 + cuts.length, seed) * 0.24;
    }
    courses.push({ cuts: cuts.map((c) => c / acc), off: hash2(r, seed + 7) });
  }
  return (u, v, px) => {
    const fr = v * rows;
    const r = Math.min(rows - 1, Math.floor(fr));
    const fv = fr - r;
    const course = courses[r];
    let uu = u + course.off;
    uu -= Math.floor(uu);
    const c = course.cuts;
    let b = c.length - 1;
    for (let k = 1; k < c.length; k++) {
      if (c[k] > uu) {
        b = k - 1;
        break;
      }
    }
    const c1 = b + 1 < c.length ? c[b + 1] : 1;
    const e = Math.min(Math.min(uu - c[b], c1 - uu) * rows, fv, 1 - fv);
    const id = hash2(r * 97 + b, seed + 3);
    const grain = tileFbm(u, v, 24, 3, seed + 11);
    const blotch = tileFbm(u, v, 6, 2, seed + 5 + b);
    const bevel = smoothstep(0.025, 0.1, e);
    px.h = bevel * (0.75 + 0.25 * blotch) + grain * 0.08;
    const tone = (0.5 + id * 0.3) * (0.84 + 0.28 * grain) * (0.88 + 0.24 * blotch);
    const warm = hash2(r * 13 + b, seed + 9) - 0.5;
    const mortar = 0.56 + grain * 0.08;
    const ao = 0.8 + 0.2 * bevel;
    px.r = lerp(mortar, tone * (1.04 + warm * 0.1), bevel) * ao;
    px.g = lerp(mortar * 0.97, tone, bevel) * ao;
    px.b = lerp(mortar * 0.9, tone * (0.9 - warm * 0.08), bevel) * ao;
  };
}

function paintCobble(seed) {
  return (u, v, px) => {
    const { d1, d2, id } = cellular(u, v, 9, seed);
    const edge = d2 - d1;
    const stone = smoothstep(0.04, 0.3, edge);
    const grain = tileFbm(u, v, 32, 2, seed + 9);
    px.h = stone * (0.85 + 0.15 * grain) * (1 - d1 * 0.35);
    const t = 0.42 + hash2(id, seed + 1) * 0.24;
    const warm = hash2(id, seed + 2);
    const g = 0.85 + grain * 0.3;
    px.r = lerp(0.2, t * (0.95 + warm * 0.12) * g, stone);
    px.g = lerp(0.17, t * (0.93 + warm * 0.05) * g, stone);
    px.b = lerp(0.13, t * (0.88 - warm * 0.06) * g, stone);
  };
}

function paintPlaster(seed) {
  return (u, v, px) => {
    const n = tileFbm(u, v, 4, 3, seed);
    const f = tileFbm(u, v, 48, 2, seed + 1);
    const stain = smoothstep(0.5, 0.8, tileFbm(u, v, 3, 3, seed + 2));
    const t = (0.9 + n * 0.1) * (0.95 + f * 0.07) - stain * 0.13;
    px.r = t * 0.97;
    px.g = t * 0.94;
    px.b = t * 0.86 - stain * 0.03;
    px.h = f * 0.55 + n * 0.45;
  };
}

function paintWood(seed) {
  return (u, v, px) => {
    const w = tileFbm(u, v, 3, 2, seed);
    const streak = Math.sin((v * 22 + w * 5) * TAU) * 0.5 + 0.5;
    const f = tileFbm(u, v, 40, 2, seed + 1);
    const t = 0.72 + streak * 0.16 + f * 0.16;
    px.r = 0.46 * t;
    px.g = 0.34 * t;
    px.b = 0.23 * t;
    px.h = streak * 0.5 + f * 0.5;
  };
}

function paintPlanks(seed) {
  const boards = 6;
  return (u, v, px) => {
    const fb = v * boards;
    const b = Math.floor(fb);
    const fv = fb - b;
    const gap = smoothstep(0, 0.07, fv) * smoothstep(1, 0.93, fv);
    let uu = u - hash2(b, seed);
    uu -= Math.floor(uu);
    const joint = smoothstep(0, 0.01, uu) * smoothstep(1, 0.99, uu);
    const grain = tileFbm(u, v, 2, 3, seed + b);
    const streak = Math.sin((v * boards * 7 + grain * 4) * Math.PI) * 0.5 + 0.5;
    const tone = 0.8 + hash2(b, seed + 4) * 0.25;
    const t = tone * (0.84 + streak * 0.12 + grain * 0.12) * (0.35 + 0.65 * gap * joint);
    px.r = 0.58 * t;
    px.g = 0.43 * t;
    px.b = 0.29 * t;
    px.h = gap * joint * (0.9 + streak * 0.1);
  };
}

// One course of barrel tiles, eight across; tinted per roof.
function paintTileRow(seed) {
  return (u, v, px) => {
    const fx = u * 8;
    const i = Math.floor(fx);
    const t = fx - i;
    const barrel = Math.sin(t * Math.PI);
    const gap = smoothstep(0, 0.08, t) * smoothstep(1, 0.92, t);
    const id = hash2(i, seed);
    const grain = tileFbm(u, v, 16, 2, seed + 1);
    const tone = (0.8 + id * 0.18) * (0.88 + grain * 0.2) * (0.55 + 0.45 * barrel) * (0.45 + 0.55 * gap) * (0.72 + 0.28 * smoothstep(1, 0.7, v));
    px.r = tone * 1.02;
    px.g = tone;
    px.b = tone * 0.96;
    px.h = barrel * gap * 0.9 + grain * 0.1;
  };
}

// Rows of overlapping tiles for cones, ridges and spires.
function paintShingles(seed) {
  const rows = 8;
  return (u, v, px) => {
    const fr = v * rows;
    const r = Math.floor(fr);
    const fv = fr - r;
    const fx = u * 8 + (r % 2) * 0.5;
    const i = Math.floor(fx);
    const t = fx - i;
    const round = Math.sin(t * Math.PI);
    const gap = smoothstep(0, 0.06, t) * smoothstep(1, 0.94, t);
    const lip = smoothstep(0, 0.25, fv);
    const id = hash2(i + r * 17, seed);
    const grain = tileFbm(u, v, 16, 2, seed + 1);
    const tone = (0.78 + id * 0.2) * (0.86 + grain * 0.2) * (0.6 + 0.4 * round) * (0.45 + 0.55 * gap) * (0.55 + 0.45 * lip);
    px.r = tone;
    px.g = tone;
    px.b = tone;
    px.h = lip * gap * (0.7 + 0.3 * round);
  };
}

function paintThatch(seed) {
  return (u, v, px) => {
    const s = tileNoise(u * 96, v * 6, 96, 6, seed) * 0.6 + tileNoise(u * 48, v * 3, 48, 3, seed + 1) * 0.4;
    const band = (v * 5) % 1;
    const shade = 0.62 + 0.38 * smoothstep(0, 0.85, band);
    const t = (0.55 + s * 0.5) * shade;
    px.r = 0.74 * t;
    px.g = 0.61 * t;
    px.b = 0.38 * t;
    px.h = s * shade;
  };
}

function paintDirt(seed) {
  return (u, v, px) => {
    const n = tileFbm(u, v, 6, 3, seed);
    const f = tileFbm(u, v, 40, 2, seed + 1);
    const { d1, id } = cellular(u, v, 26, seed + 2);
    const pebble = smoothstep(0.17, 0.07, d1) * (hash2(id, seed) > 0.62 ? 1 : 0);
    const rut = tileFbm(u, v, 2, 2, seed + 3);
    const t = (0.74 + n * 0.3 + f * 0.14) * (0.9 + rut * 0.15);
    px.r = lerp(0.47 * t, 0.5, pebble * 0.35);
    px.g = lerp(0.38 * t, 0.46, pebble * 0.35);
    px.b = lerp(0.28 * t, 0.41, pebble * 0.35);
    px.h = n * 0.45 + f * 0.25 + pebble * 0.3;
  };
}

// Near-white detail that breaks up the terrain's vertex colours.
function paintGround(seed) {
  return (u, v, px) => {
    const n = tileFbm(u, v, 8, 4, seed);
    const f = tileFbm(u, v, 64, 2, seed + 1);
    const speck = smoothstep(0.76, 0.9, tileFbm(u, v, 96, 1, seed + 2));
    const hue = tileFbm(u, v, 4, 2, seed + 3) - 0.5;
    const t = 0.8 + n * 0.2 + f * 0.1 - speck * 0.12;
    px.r = t * (1 + hue * 0.1);
    px.g = t;
    px.b = t * (1 - hue * 0.1) * 0.97;
    px.h = n * 0.6 + f * 0.4;
  };
}

function paintSoil(seed) {
  return (u, v, px) => {
    const fur = 0.5 + 0.5 * Math.cos(v * 12 * TAU + tileFbm(u, v, 4, 2, seed) * 1.5);
    const clump = tileFbm(u, v, 32, 3, seed + 1);
    const t = (0.55 + 0.45 * fur) * (0.8 + clump * 0.35);
    px.r = 0.42 * t;
    px.g = 0.31 * t;
    px.b = 0.21 * t;
    px.h = fur * 0.8 + clump * 0.2;
  };
}

function paintBark(seed) {
  return (u, v, px) => {
    const w = tileFbm(u, v, 4, 2, seed);
    const ridge = Math.abs(Math.sin((u * 10 + w * 1.5) * Math.PI));
    const fine = tileFbm(u, v, 32, 2, seed + 1);
    const t = (0.45 + 0.55 * Math.pow(ridge, 0.6)) * (0.85 + fine * 0.3);
    px.r = 0.4 * t;
    px.g = 0.33 * t;
    px.b = 0.26 * t;
    px.h = ridge * 0.8 + fine * 0.2;
  };
}

function paintRipples(seed) {
  return (u, v, px) => {
    px.h = tileFbm(u, v, 4, 4, seed) * 0.6 + tileFbm(u, v, 12, 3, seed + 1) * 0.4;
    px.r = px.g = px.b = 0.5;
  };
}

function paintStripes(seed) {
  return (u, v, px) => {
    const stripe = Math.floor(u * 8) % 2 === 0 ? 1 : 0.62;
    const f = tileFbm(u, v, 32, 2, seed);
    px.r = px.g = px.b = stripe * (0.9 + 0.1 * f);
    px.h = f;
  };
}

// Valdren's arms: a white tower above three waves, gold crown, blue field.
function makeBannerTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const g = c.getContext('2d');
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(256, 0);
  g.lineTo(256, 512);
  g.lineTo(128, 430);
  g.lineTo(0, 512);
  g.closePath();
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#27468a');
  grad.addColorStop(1, '#172d5e');
  g.fillStyle = grad;
  g.fill();
  g.save();
  g.clip();
  g.lineWidth = 26;
  g.strokeStyle = '#d6ac4c';
  g.stroke();
  g.restore();

  g.fillStyle = '#ecebe2';
  g.fillRect(92, 180, 72, 150);
  for (let k = 0; k < 4; k++) g.fillRect(92 + k * 20, 160, 14, 22);
  g.fillStyle = '#172d5e';
  g.beginPath();
  g.moveTo(116, 330);
  g.lineTo(116, 292);
  g.arc(128, 292, 12, Math.PI, 0);
  g.lineTo(140, 330);
  g.fill();
  g.fillRect(124, 214, 8, 26);

  g.strokeStyle = '#d9dde4';
  g.lineWidth = 9;
  g.lineCap = 'round';
  for (let w = 0; w < 3; w++) {
    g.beginPath();
    for (let x = 60; x <= 196; x += 4) {
      const y = 352 + w * 24 + Math.sin((x - 60) * 0.09) * 6;
      if (x === 60) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }

  g.fillStyle = '#d6ac4c';
  g.font = 'bold 21px Georgia, "Times New Roman", serif';
  g.textAlign = 'center';
  g.fillText('PONTE ET PANE', 128, 427);
  g.beginPath();
  g.moveTo(96, 132);
  g.lineTo(96, 96);
  g.lineTo(112, 114);
  g.lineTo(128, 88);
  g.lineTo(144, 114);
  g.lineTo(160, 96);
  g.lineTo(160, 132);
  g.closePath();
  g.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = ANISOTROPY;
  return tex;
}

// Aged paper covered in lines of handwriting, for scrolls, ledgers and letters.
function makeParchmentTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 320;
  const g = c.getContext('2d');
  const rand = mulberry32(404);
  const grad = g.createRadialGradient(128, 150, 40, 128, 160, 220);
  grad.addColorStop(0, '#efe2c0');
  grad.addColorStop(1, '#c9b07c');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 320);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(120,85,40,${rand() * 0.08})`;
    g.fillRect(rand() * 256, rand() * 320, 2 + rand() * 6, 1 + rand() * 4);
  }
  g.strokeStyle = 'rgba(60,38,20,0.75)';
  g.lineWidth = 1.4;
  for (let y = 34; y < 296; y += 15) {
    let x = 22 + (y === 34 ? 30 : 0);
    const end = 230 - rand() * (y > 270 ? 120 : 20);
    g.beginPath();
    while (x < end) {
      const w = 6 + rand() * 22;
      g.moveTo(x, y);
      for (let k = 0; k <= w; k += 3) g.lineTo(x + k, y + Math.sin((x + k) * 0.9) * 1.6 - rand() * 2.5);
      x += w + 5;
    }
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = ANISOTROPY;
  return tex;
}

// What is left of the Greywatch standard: a grey tower and a wheat sheaf, burnt ragged.
function makeStandardTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 384;
  const g = c.getContext('2d');
  const rand = mulberry32(271);
  g.fillStyle = '#4a5560';
  g.fillRect(0, 0, 256, 384);
  for (let i = 0; i < 300; i++) {
    g.fillStyle = `rgba(0,0,0,${rand() * 0.12})`;
    g.fillRect(rand() * 256, rand() * 384, 3 + rand() * 10, 2 + rand() * 6);
  }
  g.fillStyle = '#b8bcc2';
  g.fillRect(96, 120, 64, 150);
  for (let k = 0; k < 4; k++) g.fillRect(96 + k * 18, 102, 12, 20);
  g.fillStyle = '#4a5560';
  g.fillRect(120, 230, 16, 40);
  g.strokeStyle = '#c9a24a';
  g.lineWidth = 6;
  g.lineCap = 'round';
  for (let k = -3; k <= 3; k++) {
    g.beginPath();
    g.moveTo(128 + k * 6, 300);
    g.quadraticCurveTo(128 + k * 10, 230, 128 + k * 22, 170);
    g.stroke();
  }
  g.lineWidth = 10;
  g.beginPath();
  g.moveTo(98, 240);
  g.lineTo(158, 240);
  g.stroke();
  // Scorch towards the edges, then burn the edges away (alpha 0 is cut by the alpha test).
  const img = g.getImageData(0, 0, 256, 384);
  const d = img.data;
  for (let y = 0; y < 384; y++) {
    for (let x = 0; x < 256; x++) {
      const edge = Math.min(x, 255 - x, 383 - y) / 60 + (y < 20 ? 1 : 0);
      const n = fbm(x * 0.035, y * 0.035, 3) * 1.4 - 0.2;
      const burn = clamp(1.25 - edge - n * 0.6, 0, 1);
      const k = (y * 256 + x) * 4;
      const char = burn * burn;
      d[k] *= 1 - char * 0.85;
      d[k + 1] *= 1 - char * 0.88;
      d[k + 2] *= 1 - char * 0.9;
      d[k + 3] = burn > 0.82 ? 0 : 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = ANISOTROPY;
  return tex;
}

function makeSignTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#5b3d24';
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = '#c9a04a';
  g.lineWidth = 8;
  g.strokeRect(6, 6, 244, 116);
  g.fillStyle = '#e8c76a';
  g.font = 'bold 30px Georgia, "Times New Roman", serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('THE', 128, 36);
  g.fillText('BROKEN OAR', 128, 82);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = ANISOTROPY;
  return tex;
}

// ================================================================= palette

const C = (hex) => new THREE.Color(hex);
const WHITE = C(0xffffff);
const TINT = {
  plinth: C(0x8f8a7e),
  stone: C(0xdcd5c6),
  castle: C(0xd3cab6),
  darkStone: C(0xa29b8e),
  mossy: C(0xa9b08f),
  plaster: [C(0xf6eedc), C(0xeee2c6), C(0xf3e4c4), C(0xe9d2a6), C(0xf0dcd0), C(0xe2ddd0)],
  beam: C(0x8a6e56),
  door: C(0xa47f5c),
  shutter: [C(0x6b8a5c), C(0x9c4a38), C(0x56739a), C(0xa88a52)],
  roof: [C(0xc0694c), C(0xae5d44), C(0xa06c52), C(0xc8774f), C(0x9a5040)],
  slate: C(0x7c838c),
  boards: C(0xa8957c),
  natural: C(0xffffff),
  carpet: C(0x8e1f22),
  gold: C(0xffe2a0),
};

// =============================================================== geometry

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
const RIDGE_GEO = new THREE.CylinderGeometry(0.17, 0.17, 1, 7, 1, false, 0, Math.PI);
const UP = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _local = new THREE.Matrix4();
const _world = new THREE.Matrix4();
const _m1 = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();

// UVs projected in world space so textures keep their real-world scale on any surface.
function projectUV(g, scale) {
  const p = g.attributes.position.array;
  const n = p.length / 3;
  const uv = new Float32Array(n * 2);
  const inv = 1 / scale;
  for (let i = 0; i + 2 < n; i += 3) {
    const a = i * 3;
    const e1x = p[a + 3] - p[a];
    const e1y = p[a + 4] - p[a + 1];
    const e1z = p[a + 5] - p[a + 2];
    const e2x = p[a + 6] - p[a];
    const e2y = p[a + 7] - p[a + 1];
    const e2z = p[a + 8] - p[a + 2];
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    const flat = Math.abs(ny) > 0.75;
    const tl = Math.hypot(nz, nx) || 1;
    const tx = nz / tl;
    const tz = -nx / tl;
    const bx = ny * tz;
    const by = nz * tx - nx * tz;
    const bz = -ny * tx;
    for (let k = 0; k < 3; k++) {
      const o = (i + k) * 3;
      const x = p[o];
      const y = p[o + 1];
      const z = p[o + 2];
      const w = (i + k) * 2;
      if (flat) {
        uv[w] = x * inv;
        uv[w + 1] = z * inv;
      } else {
        uv[w] = (x * tx + z * tz) * inv;
        uv[w + 1] = (x * bx + y * by + z * bz) * inv;
      }
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function withColor(g, color = WHITE) {
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    c[i * 3] = color.r;
    c[i * 3 + 1] = color.g;
    c[i * 3 + 2] = color.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

// A wall outline with arched openings, extruded through its thickness.
function archShape(w, h, holes = []) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, h);
  s.lineTo(-w / 2, h);
  s.lineTo(-w / 2, 0);
  for (const o of holes) {
    const r = o.w / 2;
    const path = new THREE.Path();
    path.moveTo(o.x - r, o.y0);
    path.lineTo(o.x + r, o.y0);
    path.lineTo(o.x + r, o.spring);
    path.absarc(o.x, o.spring, r, 0, Math.PI, false);
    path.lineTo(o.x - r, o.y0);
    s.holes.push(path);
  }
  return s;
}

function extrude(shape, depth, curveSegments = 10) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments });
  g.translate(0, 0, -depth / 2);
  return g;
}

// Static geometry merged per material and per ~90 m chunk, so the whole town is a few dozen draw calls.
const KEEP_ATTRS = ['position', 'normal', 'uv', 'color'];

class Batch {
  constructor(uvScales, chunk = 90) {
    this.uvScales = uvScales;
    this.chunk = chunk;
    this.buckets = new Map();
  }

  add(key, geometry, matrix, tint, keepUV = false) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (matrix) g.applyMatrix4(matrix);
    const n = g.attributes.position.count;
    if (!keepUV) projectUV(g, this.uvScales[key] || 2);
    else if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    withColor(g, tint || WHITE);
    for (const name of Object.keys(g.attributes)) {
      if (!KEEP_ATTRS.includes(name)) g.deleteAttribute(name);
    }
    g.morphAttributes = {};
    g.clearGroups();
    const cx = matrix ? matrix.elements[12] : g.attributes.position.array[0];
    const cz = matrix ? matrix.elements[14] : g.attributes.position.array[2];
    const bucket = `${key}|${Math.floor(cx / this.chunk)}|${Math.floor(cz / this.chunk)}`;
    let list = this.buckets.get(bucket);
    if (!list) this.buckets.set(bucket, (list = []));
    list.push(g);
  }

  build(scene, materials, noShadow) {
    let count = 0;
    for (const [bucket, list] of this.buckets) {
      const key = bucket.slice(0, bucket.indexOf('|'));
      const geo = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!geo) continue;
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, materials[key]);
      mesh.name = key;
      mesh.castShadow = !noShadow.has(key);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      scene.add(mesh);
      count++;
    }
    this.buckets.clear();
    return count;
  }
}

// A local frame (position + yaw) for placing parts of one structure.
class Frame {
  constructor(ctx, x, z, rot = 0) {
    this.ctx = ctx;
    this.x = x;
    this.z = z;
    this.rot = rot;
    this.c = Math.cos(rot);
    this.s = Math.sin(rot);
    this.m = new THREE.Matrix4().makeRotationY(rot).setPosition(x, 0, z);
  }

  world(lx, lz) {
    return [this.x + lx * this.c + lz * this.s, this.z - lx * this.s + lz * this.c];
  }

  matrix(cx, cy, cz, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, out = new THREE.Matrix4()) {
    _local.compose(_p.set(cx, cy, cz), _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ')), _s.set(sx, sy, sz));
    return out.multiplyMatrices(this.m, _local);
  }

  box(key, cx, cy, cz, sx, sy, sz, tint, rx = 0, ry = 0, rz = 0) {
    this.ctx.batch.add(key, UNIT_BOX, this.matrix(cx, cy, cz, rx, ry, rz, sx, sy, sz, _world), tint);
  }

  geo(key, geometry, cx, cy, cz, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, tint = WHITE, keepUV = false) {
    this.ctx.batch.add(key, geometry, this.matrix(cx, cy, cz, rx, ry, rz, sx, sy, sz, _world), tint, keepUV);
  }

  inst(kind, cx, cy, cz, rx, ry, rz, sx, sy, sz, color) {
    this.ctx.addInstance(kind, this.matrix(cx, cy, cz, rx, ry, rz, sx, sy, sz), color);
  }

  collideBox(cx, cz, hw, hd, y0, y1, rot = 0) {
    const [x, z] = this.world(cx, cz);
    this.ctx.colliders.addBox(x, z, hw, hd, this.rot + rot, y0, y1);
  }

  collideCircle(cx, cz, r, y0, y1) {
    const [x, z] = this.world(cx, cz);
    this.ctx.colliders.addCircle(x, z, r, y0, y1);
  }

  ground(cx, cz) {
    const [x, z] = this.world(cx, cz);
    return this.ctx.ground(x, z);
  }
}

// ================================================================ terrain

const PAL = {
  grassA: C(0x4a8530),
  grassB: C(0x86b04a),
  dry: C(0xb2aa5e),
  forest: C(0x3c5326),
  trampled: C(0x7d7a50),
  dirt: C(0x7a6446),
  sand: C(0xb39c6a),
  mud: C(0x6e6446),
  rock: C(0x8d877a),
  rockDark: C(0x625e56),
  snow: C(0xf0f4f6),
};

class Terrain {
  constructor(segments) {
    const n = segments;
    const row = n + 1;
    const step = (WORLD_HALF * 2) / n;
    const count = row * row;
    const heights = new Float32Array(count);
    const positions = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const masks = new Float32Array(count * 4); // road, dirt, town, farm

    for (let j = 0; j < row; j++) {
      const z = -WORLD_HALF + j * step;
      for (let i = 0; i < row; i++) {
        const x = -WORLD_HALF + i * step;
        const k = j * row + i;
        const h = heightAt(x, z);
        heights[k] = h;
        positions[k * 3] = x;
        positions[k * 3 + 1] = h;
        positions[k * 3 + 2] = z;
        uvs[k * 2] = x / 3;
        uvs[k * 2 + 1] = z / 3;
        masks[k * 4] = FIELD.road;
        masks[k * 4 + 1] = FIELD.dirt;
        masks[k * 4 + 2] = FIELD.town;
        masks[k * 4 + 3] = FIELD.farm;
      }
    }

    // Each cell is split along the (i+1, j)–(i, j+1) diagonal; getHeight relies on this.
    const index = new Uint32Array(n * n * 6);
    let p = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * row + i;
        const b = a + row;
        const c = a + 1;
        const d = b + 1;
        index[p++] = a; index[p++] = b; index[p++] = c;
        index[p++] = c; index[p++] = b; index[p++] = d;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.computeVertexNormals();
    this.colors = Terrain.colours(positions, geometry.attributes.normal.array, masks, count);
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geometry.computeBoundingSphere();

    this.n = n;
    this.row = row;
    this.step = step;
    this.heights = heights;
    this.geometry = geometry;
  }

  static colours(pos, nrm, masks, count) {
    const out = new Float32Array(count * 3);
    const col = new THREE.Color();
    const rock = new THREE.Color();
    for (let k = 0; k < count; k++) {
      const x = pos[k * 3];
      const h = pos[k * 3 + 1];
      const z = pos[k * 3 + 2];
      const ny = nrm[k * 3 + 1];

      col.copy(PAL.grassA).lerp(PAL.grassB, fbm(x * 0.021, z * 0.021, 3));
      col.lerp(PAL.dry, smoothstep(0.56, 0.74, fbm(x * 0.007 + 20, z * 0.007 + 40, 2)) * 0.45);
      col.lerp(PAL.forest, forestDensity(x, z) * 0.75);
      col.lerp(PAL.trampled, masks[k * 4 + 2] * 0.3);
      col.lerp(PAL.dirt, Math.max(masks[k * 4 + 1], masks[k * 4] * 0.85));
      col.lerp(PAL.sand, 1 - smoothstep(WATER_LEVEL + 0.25, WATER_LEVEL + 1.5, h));
      col.lerp(PAL.mud, 1 - smoothstep(WATER_LEVEL - 1.4, WATER_LEVEL - 0.1, h));

      const rocky = Math.max(1 - smoothstep(0.66, 0.84, ny), smoothstep(38, 52, h));
      if (rocky > 0) col.lerp(rock.copy(PAL.rock).lerp(PAL.rockDark, fbm(x * 0.05, z * 0.05, 2)), rocky);
      col.lerp(PAL.snow, smoothstep(64, 76, h) * smoothstep(0.55, 0.8, ny));

      const jitter = 0.92 + hash2(k, 7) * 0.16;
      out[k * 3] = col.r * jitter;
      out[k * 3 + 1] = col.g * jitter;
      out[k * 3 + 2] = col.b * jitter;
    }
    return out;
  }

  // Height of the rendered surface at (x, z), interpolated on the mesh triangles.
  getHeight(x, z) {
    const n = this.n;
    const gx = clamp((x + WORLD_HALF) / this.step, 0, n - 1e-4);
    const gz = clamp((z + WORLD_HALF) / this.step, 0, n - 1e-4);
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const H = this.heights;
    const k = j * this.row + i;
    if (fx + fz <= 1) {
      return H[k] + (H[k + 1] - H[k]) * fx + (H[k + this.row] - H[k]) * fz;
    }
    const h11 = H[k + this.row + 1];
    return h11 + (H[k + this.row] - h11) * (1 - fx) + (H[k + 1] - h11) * (1 - fz);
  }

  // Terrain colour (linear) at (x, z), bilinear on the vertex grid.
  colourAt(x, z, out) {
    const n = this.n;
    const gx = clamp((x + WORLD_HALF) / this.step, 0, n - 1e-4);
    const gz = clamp((z + WORLD_HALF) / this.step, 0, n - 1e-4);
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const c = this.colors;
    const k = (j * this.row + i) * 3;
    const r = this.row * 3;
    for (let ch = 0; ch < 3; ch++) {
      const a = lerp(c[k + ch], c[k + 3 + ch], fx);
      const b = lerp(c[k + r + ch], c[k + r + 3 + ch], fx);
      out[ch] = lerp(a, b, fz);
    }
    return out;
  }
}

// ===================================================================== sky

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uSunVis;
uniform float uMoonVis;
uniform float uStars;
uniform float uDesat;
varying vec3 vDir;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

void main() {
  vec3 d = normalize(vDir);
  float up = max(d.y, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));

  float s = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(s, 900.0) * 8.0 + pow(s, 24.0) * 0.35 + pow(s, 4.0) * 0.12) * uSunVis;

  float m = dot(d, uMoonDir);
  col += vec3(0.85, 0.9, 1.0) * (smoothstep(0.99955, 0.9997, m) * 1.4 + pow(max(m, 0.0), 60.0) * 0.08) * uMoonVis;

  if (uStars > 0.0) {
    vec3 cell = floor(d * 420.0);
    float star = step(0.9975, hash13(cell)) * (0.55 + 0.45 * hash13(cell + 7.0));
    col += vec3(star * uStars * smoothstep(0.02, 0.25, d.y));
  }

  col = mix(col, vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), uDesat);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

class SkyDome {
  constructor() {
    this.uniforms = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uSunVis: { value: 1 },
      uMoonVis: { value: 0 },
      uStars: { value: 0 },
      uDesat: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), this.material);
    this.mesh.name = 'sky';
    // Same sky, partly desaturated, for image-based lighting: shade stays cool but not blue.
    this.envMaterial = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, uDesat: { value: 0.45 } },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
  }
}

// Keyframes: hour, zenith, horizon (= fog), sun glow, hemi sky, hemi ground,
// hemi intensity, directional light colour, star visibility.
const SKY_KEYS = [
  [0, 0x060a1a, 0x18203c, 0xc8d4ff, 0x34446e, 0x0c0f16, 0.5, 0x8aa2dc, 1.0],
  [4.8, 0x0a1028, 0x1f2846, 0xc8d4ff, 0x38486f, 0x0e1118, 0.5, 0x8aa2dc, 0.9],
  [5.8, 0x2a3f78, 0xd98a64, 0xffa060, 0x8c92b6, 0x3a3028, 0.45, 0xffa870, 0.2],
  [7.0, 0x4a82cc, 0xf0cfa8, 0xffd9a0, 0xaec6e6, 0x56493a, 0.4, 0xffe2b8, 0.0],
  [9.0, 0x3f7fd6, 0xbfd8ee, 0xfff1d6, 0xc0d8f2, 0x5c533c, 0.4, 0xfff1dc, 0.0],
  [15.5, 0x3f7fd6, 0xbfd8ee, 0xfff1d6, 0xc0d8f2, 0x5c533c, 0.4, 0xfff1dc, 0.0],
  [17.2, 0x4a6fb8, 0xf2c08c, 0xffc070, 0xb3b8d6, 0x544434, 0.4, 0xffd09a, 0.0],
  [18.1, 0x34437e, 0xec7f45, 0xff7a3c, 0x9a94b8, 0x3a2c24, 0.45, 0xff9858, 0.0],
  [19.2, 0x0f1636, 0x3a2d55, 0xc8d4ff, 0x3a4570, 0x0f1118, 0.5, 0x8ea2d8, 0.6],
  [24, 0x060a1a, 0x18203c, 0xc8d4ff, 0x34446e, 0x0c0f16, 0.5, 0x8aa2dc, 1.0],
].map(([t, zenith, horizon, sun, hemiSky, hemiGround, hemi, light, stars]) => ({
  t,
  zenith: C(zenith),
  horizon: C(horizon),
  sun: C(sun),
  hemiSky: C(hemiSky),
  hemiGround: C(hemiGround),
  hemi,
  light: C(light),
  stars,
}));

// =============================================================== colliders

const CIRCLE = 0;
const BOX = 1;

// Static 2D obstacles (circles and rotated boxes) with a vertical extent, in a uniform grid.
export class Colliders {
  constructor(cellSize = 16) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.items = [];
    this._stamp = 0;
    this._found = [];
  }

  _key(ix, iz) {
    return (ix + 2048) * 4096 + (iz + 2048);
  }

  _insert(item, minX, minZ, maxX, maxZ) {
    const cs = this.cellSize;
    for (let ix = Math.floor(minX / cs); ix <= Math.floor(maxX / cs); ix++) {
      for (let iz = Math.floor(minZ / cs); iz <= Math.floor(maxZ / cs); iz++) {
        const key = this._key(ix, iz);
        let cell = this.cells.get(key);
        if (!cell) this.cells.set(key, (cell = []));
        cell.push(item);
      }
    }
    this.items.push(item);
    return item;
  }

  addCircle(x, z, r, y0 = -Infinity, y1 = Infinity) {
    return this._insert({ type: CIRCLE, x, z, r, y0, y1, mark: 0 }, x - r, z - r, x + r, z + r);
  }

  // Box centred at (x, z) with half extents (hw along local X, hd along local Z),
  // rotated by rotY exactly like an Object3D's rotation.y.
  addBox(x, z, hw, hd, rotY = 0, y0 = -Infinity, y1 = Infinity) {
    const cos = Math.cos(rotY);
    const sin = Math.sin(rotY);
    const ex = Math.abs(hw * cos) + Math.abs(hd * sin);
    const ez = Math.abs(hw * sin) + Math.abs(hd * cos);
    return this._insert({ type: BOX, x, z, hw, hd, cos, sin, y0, y1, mark: 0 }, x - ex, z - ez, x + ex, z + ez);
  }

  query(x, z, radius) {
    const out = this._found;
    out.length = 0;
    const stamp = ++this._stamp;
    const cs = this.cellSize;
    for (let ix = Math.floor((x - radius) / cs); ix <= Math.floor((x + radius) / cs); ix++) {
      for (let iz = Math.floor((z - radius) / cs); iz <= Math.floor((z + radius) / cs); iz++) {
        const cell = this.cells.get(this._key(ix, iz));
        if (!cell) continue;
        for (let n = 0; n < cell.length; n++) {
          const item = cell[n];
          if (item.mark === stamp) continue;
          item.mark = stamp;
          out.push(item);
        }
      }
    }
    return out;
  }

  // Pushes a circle at pos (x/z), spanning heights y0..y1, out of every obstacle it overlaps.
  resolve(pos, radius, y0 = -Infinity, y1 = Infinity) {
    for (let iter = 0; iter < 3; iter++) {
      const list = this.query(pos.x, pos.z, radius + 0.5);
      let moved = false;
      for (let n = 0; n < list.length; n++) {
        const c = list[n];
        if (c.y1 < y0 || c.y0 > y1) continue;
        if (c.type === CIRCLE ? pushOutOfCircle(c, pos, radius) : pushOutOfBox(c, pos, radius)) moved = true;
      }
      if (!moved) return;
    }
  }

  // True if the point (x, y, z), padded by pad, is inside any obstacle.
  contains(x, y, z, pad) {
    const list = this.query(x, z, pad + 0.5);
    for (let n = 0; n < list.length; n++) {
      const c = list[n];
      if (y < c.y0 || y > c.y1) continue;
      const dx = x - c.x;
      const dz = z - c.z;
      if (c.type === CIRCLE) {
        if (dx * dx + dz * dz < (c.r + pad) * (c.r + pad)) return true;
      } else {
        const lx = dx * c.cos - dz * c.sin;
        const lz = dx * c.sin + dz * c.cos;
        if (Math.abs(lx) < c.hw + pad && Math.abs(lz) < c.hd + pad) return true;
      }
    }
    return false;
  }
}

function pushOutOfCircle(c, pos, radius) {
  const dx = pos.x - c.x;
  const dz = pos.z - c.z;
  const min = c.r + radius;
  const d2 = dx * dx + dz * dz;
  if (d2 >= min * min) return false;
  const d = Math.sqrt(d2);
  if (d < 1e-6) {
    pos.x += min;
    return true;
  }
  const push = (min - d) / d;
  pos.x += dx * push;
  pos.z += dz * push;
  return true;
}

function pushOutOfBox(b, pos, radius) {
  const dx = pos.x - b.x;
  const dz = pos.z - b.z;
  const lx = dx * b.cos - dz * b.sin;
  const lz = dx * b.sin + dz * b.cos;
  const ox = lx - clamp(lx, -b.hw, b.hw);
  const oz = lz - clamp(lz, -b.hd, b.hd);
  const d2 = ox * ox + oz * oz;
  if (d2 >= radius * radius) return false;
  let nx;
  let nz;
  let push;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    nx = ox / d;
    nz = oz / d;
    push = radius - d;
  } else {
    // Centre is inside the box: leave through the nearest face.
    const px = b.hw - Math.abs(lx);
    const pz = b.hd - Math.abs(lz);
    if (px < pz) {
      nx = lx < 0 ? -1 : 1;
      nz = 0;
      push = px + radius;
    } else {
      nx = 0;
      nz = lz < 0 ? -1 : 1;
      push = pz + radius;
    }
  }
  pos.x += (nx * b.cos + nz * b.sin) * push;
  pos.z += (-nx * b.sin + nz * b.cos) * push;
  return true;
}

// Rotated rectangle helpers used for placement and walkable surfaces.
function rect(x, z, hw, hd, rot = 0) {
  return { x, z, hw, hd, rot, cos: Math.cos(rot), sin: Math.sin(rot) };
}

function rectLocal(r, x, z) {
  const dx = x - r.x;
  const dz = z - r.z;
  return [dx * r.cos - dz * r.sin, dx * r.sin + dz * r.cos];
}

function rectContains(r, x, z, pad = 0) {
  const [lx, lz] = rectLocal(r, x, z);
  return Math.abs(lx) <= r.hw + pad && Math.abs(lz) <= r.hd + pad;
}

function rectCorners(r, pad = 0) {
  const out = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const lx = sx * (r.hw + pad);
    const lz = sz * (r.hd + pad);
    out.push([r.x + lx * r.cos + lz * r.sin, r.z - lx * r.sin + lz * r.cos]);
  }
  return out;
}

function rectsOverlap(a, b, pad = 0) {
  const axes = [[a.cos, -a.sin], [a.sin, a.cos], [b.cos, -b.sin], [b.sin, b.cos]];
  const ca = rectCorners(a, pad);
  const cb = rectCorners(b, pad);
  for (const [ax, az] of axes) {
    let minA = Infinity;
    let maxA = -Infinity;
    let minB = Infinity;
    let maxB = -Infinity;
    for (const [x, z] of ca) {
      const p = x * ax + z * az;
      minA = Math.min(minA, p);
      maxA = Math.max(maxA, p);
    }
    for (const [x, z] of cb) {
      const p = x * ax + z * az;
      minB = Math.min(minB, p);
      maxB = Math.max(maxB, p);
    }
    if (maxA < minB || maxB < minA) return false;
  }
  return true;
}

// ========================================================= build context

class BuildContext {
  constructor(world, rng) {
    this.world = world;
    this.batch = world.batch;
    this.colliders = world.colliders;
    this.rng = rng;
    this.instances = new Map();
    this.footprints = [];
    this.lamps = [];
  }

  ground(x, z) {
    return this.world.terrain.getHeight(x, z);
  }

  addInstance(kind, matrix, color) {
    let list = this.instances.get(kind);
    if (!list) this.instances.set(kind, (list = []));
    list.push({ m: matrix, c: color ? color.clone() : null });
  }

  occupy(r) {
    this.footprints.push(r);
    return r;
  }

  occupied(x, z, pad = 0) {
    for (const r of this.footprints) if (rectContains(r, x, z, pad)) return true;
    return false;
  }

  pick(list) {
    return list[Math.floor(this.rng() * list.length) % list.length];
  }

  vary(color, amount = 0.08) {
    return color.clone().multiplyScalar(1 - amount + this.rng() * amount * 2);
  }
}

// Records a place the lore can point at: stand near (x, z); the glint sparkles at gx, gy, gz.
function anchor(ctx, name, x, z, glint) {
  ctx.world.anchors[name] = { x, y: ctx.world.getGroundHeight(x, z), z, glint };
}

// A sheet of written parchment: w x h, its writing facing +Z before rotation.
const PAGE_GEO = new THREE.PlaneGeometry(1, 1);

// ================================================================ houses

/*
 * A storey's openings and (for half-timbered walls) its framing.
 * Faces are addressed by their outward normal in the frame: front (+z), back, left, right.
 */
function storeyDetails(F, o) {
  const { w, d, z, y, h, ground, timber, style } = o;
  const faces = [
    { nx: 0, nz: 1, len: w },
    { nx: 0, nz: -1, len: w },
    { nx: 1, nz: 0, len: d },
    { nx: -1, nz: 0, len: d },
  ];
  const frameKey = style === 'stone' ? 'stone' : 'timber';
  const frameTint = style === 'stone' ? TINT.darkStone : TINT.beam;
  for (const f of faces) {
    const along = f.nz !== 0;
    const place = (a, up, out, la, lu, lt, key, tint, tilt = 0) => {
      if (along) F.box(key, a, up, z + f.nz * (d / 2 + out), la, lu, lt, tint, 0, 0, tilt);
      else F.box(key, f.nx * (w / 2 + out), up, z + a, lt, lu, la, tint, tilt, 0, 0);
    };

    // Openings along this face.
    const openings = [];
    const isFront = f.nz === 1;
    if (ground && isFront && o.door) openings.push({ at: o.doorAt || 0, half: 0.75, door: true });
    const usable = f.len - 1.6;
    const slots = Math.max(f.nz !== 0 ? 1 : 0, Math.floor(usable / 2.3));
    for (let k = 0; k < slots; k++) {
      const at = -usable / 2 + ((k + 0.5) * usable) / slots;
      if (openings.some((op) => Math.abs(op.at - at) < op.half + 0.75)) continue;
      openings.push({ at, half: 0.55, door: false });
    }

    for (const op of openings) {
      if (op.door) {
        place(op.at, y + 1.08, 0.04, 1.1, 2.16, 0.08, 'planks', TINT.door);
        place(op.at, y + 2.25, 0.08, 1.45, 0.16, 0.16, frameKey, frameTint);
        place(op.at - 0.65, y + 1.1, 0.08, 0.16, 2.2, 0.16, frameKey, frameTint);
        place(op.at + 0.65, y + 1.1, 0.08, 0.16, 2.2, 0.16, frameKey, frameTint);
        place(op.at, y - 0.1, 0.35, 1.5, 0.2, 0.6, 'stone', TINT.darkStone);
      } else {
        const wy = y + (ground ? 1.55 : 1.35);
        place(op.at, wy, 0.02, 0.78, 0.98, 0.05, 'glass', WHITE);
        place(op.at, wy + 0.55, 0.06, 1.0, 0.12, 0.12, frameKey, frameTint);
        place(op.at, wy - 0.55, 0.09, 1.05, 0.08, 0.2, 'stone', TINT.darkStone);
        place(op.at - 0.45, wy, 0.06, 0.1, 1.1, 0.12, frameKey, frameTint);
        place(op.at + 0.45, wy, 0.06, 0.1, 1.1, 0.12, frameKey, frameTint);
        place(op.at, wy, 0.06, 0.06, 0.98, 0.08, frameKey, frameTint);
        if (o.shutter) {
          place(op.at - 0.78, wy, 0.04, 0.46, 1.0, 0.05, 'planks', o.shutter);
          place(op.at + 0.78, wy, 0.04, 0.46, 1.0, 0.05, 'planks', o.shutter);
        }
      }
    }

    if (!timber) continue;
    // Half-timbering: sill and head plates, posts, studs between openings, corner braces.
    const L = f.len;
    place(0, y + 0.1, 0.05, L + 0.12, 0.2, 0.16, 'timber', TINT.beam);
    place(0, y + h - 0.1, 0.05, L + 0.12, 0.2, 0.16, 'timber', TINT.beam);
    if (!ground) place(0, y + 0.95, 0.05, L, 0.14, 0.14, 'timber', TINT.beam);
    for (const e of [-1, 1]) place(e * (L / 2 - 0.06), y + h / 2, 0.06, 0.22, h, 0.18, 'timber', TINT.beam);
    const bays = Math.max(2, Math.round(L / 1.35));
    for (let k = 1; k < bays; k++) {
      const a = -L / 2 + (k * L) / bays;
      if (openings.some((op) => Math.abs(op.at - a) < op.half + 0.25)) continue;
      place(a, y + h / 2, 0.05, 0.16, h - 0.2, 0.14, 'timber', TINT.beam);
    }
    const bay = L / bays;
    if (!openings.some((op) => Math.abs(op.at) > L / 2 - bay - op.half - 0.2)) {
      const len = Math.hypot(bay, h - 0.3);
      const tilt = Math.atan2(h - 0.3, bay);
      for (const e of [-1, 1]) {
        const tl = along ? e * tilt : -e * tilt;
        place(e * (L / 2 - bay / 2), y + h / 2, 0.05, len, 0.14, 0.13, 'timber', TINT.beam, tl);
      }
    }
  }
}

/*
 * Gable roof with its ridge along the frame's X axis over a w x d storey
 * centred at local z, eaves at height y. Tile and slate roofs get real courses
 * of tiles (instanced); thatch is one thick textured slab per side.
 */
function gableRoof(ctx, F, o) {
  const { w, d, z, y, pitch, over, kind, tint } = o;
  const tan = Math.tan(pitch);
  const run = d / 2 + over;
  const rise = (d / 2) * tan;
  const ridgeY = y + rise;
  const L = run / Math.cos(pitch);
  const W = w + over * 2;
  const thatch = kind === 'thatch';
  const slabT = thatch ? 0.45 : 0.12;

  for (const side of [1, -1]) {
    const mz = z + (side * run) / 2;
    const my = ridgeY - (run / 2) * tan;
    F.box(thatch ? 'thatch' : 'planks', 0, my, mz, W, slabT, L, thatch ? WHITE : TINT.boards, side * pitch, 0, 0);
    if (thatch) continue;
    for (const sx of [1, -1]) F.box('timber', sx * (W / 2 + 0.03), my, mz, 0.06, 0.3, L, TINT.beam, side * pitch, 0, 0);
    const base = F.matrix(0, my, mz, side * pitch, 0, 0);
    const n = Math.max(3, Math.ceil(L / 0.3));
    for (let k = 0; k < n; k++) {
      const s = -L / 2 + 0.22 + (k / (n - 1)) * (L - 0.4);
      const m = new THREE.Matrix4()
        .copy(base)
        .multiply(_m1.makeTranslation(0, slabT / 2 + 0.035, side * s))
        .multiply(_m2.makeRotationX(-side * 0.075))
        .multiply(_m1.makeScale(W + 0.06, 1, 0.42));
      ctx.addInstance('tile', m, ctx.vary(tint, 0.06));
    }
  }

  if (thatch) {
    F.geo('thatch', RIDGE_GEO, 0, ridgeY + 0.12, z, 0, 0, Math.PI / 2, 2.2, W, 2.2);
  } else {
    F.geo('shingle', RIDGE_GEO, 0, ridgeY + 0.07, z, 0, 0, Math.PI / 2, 1, W + 0.08, 1, tint.clone().multiplyScalar(0.85));
  }

  // Gable ends.
  const gable = gableGeometry(d, rise);
  for (const sx of [1, -1]) {
    F.geo(o.gableKey, gable, sx * (w / 2 - 0.12), y, z, 0, 0, 0, 1, 1, 1, o.gableTint);
    if (o.gableTimber) {
      F.box('timber', sx * (w / 2 + 0.02), y + rise / 2, z, 0.14, rise, 0.16, TINT.beam);
      F.box('timber', sx * (w / 2 + 0.02), y + rise * 0.45, z, 0.14, 0.14, d * 0.55, TINT.beam);
    }
  }
  return ridgeY;
}

const gableCache = new Map();

function gableGeometry(d, rise) {
  const key = `${d.toFixed(2)}|${rise.toFixed(2)}`;
  let g = gableCache.get(key);
  if (!g) {
    const s = new THREE.Shape();
    s.moveTo(-d / 2, 0);
    s.lineTo(d / 2, 0);
    s.lineTo(0, rise);
    s.lineTo(-d / 2, 0);
    g = extrude(s, 0.24, 1);
    g.rotateY(Math.PI / 2);
    gableCache.set(key, g);
  }
  return g;
}

/*
 * A house on a stone plinth. o: x, z, rot, w (frontage), d (depth), floors,
 * style ('timber' | 'plaster' | 'stone' | 'planks'), roof ('tile' | 'slate' |
 * 'thatch'), plus optional tints, jetty, chimney, heights.
 */
function buildHouse(ctx, o) {
  const F = new Frame(ctx, o.x, o.z, o.rot);
  const hw = o.w / 2;
  const hd = o.d / 2;
  let gMin = Infinity;
  let gMax = -Infinity;
  for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd], [0, 0]]) {
    const g = F.ground(lx, lz);
    gMin = Math.min(gMin, g);
    gMax = Math.max(gMax, g);
  }
  const base = gMax + 0.35;
  const bottom = gMin - 0.8;
  F.box('stone', 0, (bottom + base) / 2, 0, o.w + 0.3, base - bottom, o.d + 0.3, TINT.plinth);

  const style = o.style;
  const wallKey = style === 'stone' ? 'stone' : style === 'planks' ? 'planks' : 'plaster';
  const heights = o.heights || [2.9, 2.6];
  let y = base;
  let sw = o.w;
  let sd = o.d;
  let sz = 0;
  for (let s = 0; s < o.floors; s++) {
    const h = heights[s];
    if (s > 0 && o.jetty) {
      sw = o.w + 0.3;
      sd = o.d + 0.5;
      sz = 0.25;
      F.box('timber', 0, y - 0.1, o.d / 2 + 0.25, sw, 0.22, 0.5, TINT.beam);
    }
    F.box(wallKey, 0, y + h / 2, sz, sw, h, sd, o.wallTint || WHITE);
    storeyDetails(F, {
      w: sw,
      d: sd,
      z: sz,
      y,
      h,
      ground: s === 0,
      timber: style === 'timber',
      style,
      door: o.door !== false,
      doorAt: o.doorAt,
      shutter: o.shutter,
    });
    y += h;
  }

  const roofKind = o.roof || 'tile';
  const ridgeY = gableRoof(ctx, F, {
    w: sw,
    d: sd,
    z: sz,
    y,
    pitch: (o.pitch || 47) * DEG,
    over: 0.45,
    kind: roofKind,
    tint: roofKind === 'slate' ? TINT.slate : o.roofTint || TINT.roof[0],
    gableKey: wallKey,
    gableTint: o.wallTint || WHITE,
    gableTimber: style === 'timber',
  });

  if (o.chimney) {
    const cx = sw / 2 - 1.1;
    const cz = sz - sd / 4;
    const top = ridgeY + 0.9;
    F.box('stone', cx, (y - 0.5 + top) / 2, cz, 0.85, top - y + 0.5, 0.85, TINT.darkStone);
    F.box('stone', cx, top + 0.08, cz, 1.0, 0.16, 1.0, TINT.plinth);
  }

  F.collideBox(0, 0, hw + 0.15, hd + 0.15, bottom, ridgeY + 1);
  ctx.occupy(rect(o.x, o.z, hw + 0.3, hd + 0.3, o.rot));
  return { F, base, ridgeY };
}

// ========================================================= walls & towers

function roundTower(ctx, x, z, o) {
  const g = ctx.ground(x, z);
  const F = new Frame(ctx, x, z, Math.atan2(x - o.cx, z - o.cz));
  const top = g + o.height;
  F.geo('stone', new THREE.CylinderGeometry(o.r, o.r * 1.08, o.height + 1.6, 16), 0, g + o.height / 2 - 0.8, 0, 0, 0, 0, 1, 1, 1, o.tint);
  // Corbelled parapet and crenellations.
  F.geo('stone', new THREE.CylinderGeometry(o.r + 0.35, o.r, 0.6, 16), 0, top - 0.3, 0, 0, 0, 0, 1, 1, 1, o.tint);
  F.geo('stone', new THREE.CylinderGeometry(o.r + 0.35, o.r + 0.35, 0.5, 16), 0, top + 0.25, 0, 0, 0, 0, 1, 1, 1, o.tint);
  const merlons = 10;
  for (let k = 0; k < merlons; k++) {
    const a = (k / merlons) * TAU;
    F.box('stone', Math.sin(a) * (o.r + 0.05), top + 1.05, Math.cos(a) * (o.r + 0.05), 1.0, 1.1, 0.55, o.tint, 0, a, 0);
  }
  // Arrow slits facing outward.
  for (const a of [-0.5, 0, 0.5]) {
    F.box('glass', Math.sin(a) * (o.r + 0.02), g + o.height * 0.55, Math.cos(a) * (o.r + 0.02), 0.16, 1.3, 0.1, WHITE, 0, a, 0);
  }
  if (o.roof) {
    const h = o.r * 2.4;
    F.geo('shingle', new THREE.ConeGeometry(o.r + 0.7, h, 16, 1, true), 0, top + 0.5 + h / 2, 0, 0, 0, 0, 1, 1, 1, o.roofTint);
    F.geo('gold', new THREE.ConeGeometry(0.12, 1.2, 6), 0, top + 0.5 + h + 0.5, 0);
  }
  ctx.colliders.addCircle(x, z, o.r + 0.1, g - 2, top + 6);
  ctx.occupy(rect(x, z, o.r + 0.4, o.r + 0.4));
}

// Wall from a to b following the ground in steps, with merlons on the outer edge.
function wallRun(ctx, a, b, o) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  if (len < 0.5) return;
  const rot = Math.atan2(dx, dz);
  const mx = (a[0] + b[0]) / 2;
  const mz = (a[1] + b[1]) / 2;
  const outward = Math.sign((dz / len) * (mx - o.cx) - (dx / len) * (mz - o.cz)) || 1;
  const n = Math.ceil(len / 6);
  const piece = len / n;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const cx = a[0] + dx * t;
    const cz = a[1] + dz * t;
    const F = new Frame(ctx, cx, cz, rot);
    const g0 = F.ground(0, -piece / 2);
    const g1 = F.ground(0, piece / 2);
    const gm = F.ground(0, 0);
    const bottom = Math.min(g0, g1, gm) - 1.5;
    const top = (g0 + g1 + gm) / 3 + o.H;
    F.box('stone', 0, (bottom + top) / 2, 0, o.T, top - bottom, piece + 0.06, o.tint);
    F.box('stone', outward * (o.T / 2 + 0.06), top - 0.45, 0, 0.18, 0.3, piece + 0.06, o.tint);
    F.box('stone', -outward * (o.T / 2 - 0.2), top + 0.35, 0, 0.4, 0.7, piece + 0.06, o.tint);
    const m = Math.max(1, Math.floor(piece / 1.7));
    for (let j = 0; j < m; j++) {
      F.box('stone', outward * (o.T / 2 - 0.3), top + 0.55, -piece / 2 + ((j + 0.5) * piece) / m, 0.6, 1.1, 0.95, o.tint);
    }
    ctx.colliders.addBox(cx, cz, o.T / 2, piece / 2, rot, bottom, top + 1.2);
    ctx.occupy(rect(cx, cz, o.T / 2 + 0.5, piece / 2, rot));
  }
}

// Twin-towered gate with an arched passage straddling the wall line.
function gatehouse(ctx, mid, dir, o) {
  const rot = Math.atan2(dir[0], dir[1]);
  const F = new Frame(ctx, mid[0], mid[1], rot);
  const outward = Math.sign(dir[1] * (mid[0] - o.cx) - dir[0] * (mid[1] - o.cz)) || 1;
  const g = F.ground(0, 0);
  const D = o.T + 2.6;
  const gw = o.gateW;
  const tw = o.gateTowerW;
  const H = o.gateH;
  for (const s of [-1, 1]) {
    const cz = s * (gw / 2 + tw / 2);
    const gt = F.ground(0, cz);
    F.box('stone', 0, (gt - 1.5 + gt + H) / 2, cz, D, H + 1.5, tw, o.tint);
    F.box('stone', 0, gt + H - 0.4, cz, D + 0.4, 0.5, tw + 0.4, o.tint);
    for (let k = 0; k < 3; k++) {
      F.box('stone', (k - 1) * (D / 3), gt + H + 0.5, cz + s * (tw / 2 - 0.25), 0.9, 1.1, 0.5, o.tint);
      F.box('stone', (k - 1) * (D / 3), gt + H + 0.5, cz - s * (tw / 2 - 0.25), 0.9, 1.1, 0.5, o.tint);
    }
    for (const side of [-1, 1]) F.box('stone', side * (D / 2 - 0.25), gt + H + 0.5, cz, 0.5, 1.1, 0.9, o.tint);
    F.box('glass', outward * (D / 2 + 0.01), gt + H * 0.6, cz, 0.08, 1.3, 0.18);
    F.collideBox(0, cz, D / 2, tw / 2, gt - 2, gt + H + 2);
    ctx.occupy(rect(...F.world(0, cz), D / 2 + 0.5, tw / 2 + 0.5, rot));
    if (o.banners) F.geo('banner', BANNER_GEO, outward * (D / 2 + 0.06), gt + H - 3.2, cz, 0, outward > 0 ? Math.PI / 2 : -Math.PI / 2, 0, 1, 1, 1, WHITE, true);
  }

  // Arch over the passage: shape in the wall plane, extruded through the gate depth.
  const archH = o.H + 1.2;
  const shape = archShape(gw + 1.0, archH + 1, [{ x: 0, w: gw, y0: 1, spring: 1 + o.spring }]);
  const arch = extrude(shape, D - 0.1, 12);
  arch.rotateY(Math.PI / 2);
  F.geo('stone', arch, 0, g - 1, 0, 0, 0, 0, 1, 1, 1, o.tint);
  const archTop = g + o.spring + gw / 2;
  F.collideBox(0, 0, D / 2, gw / 2, archTop - 0.6, g + archH + 2);

  // Gate leaves standing open against the passage walls.
  for (const s of [-1, 1]) {
    F.box('planks', -outward * (D / 2 - gw / 4 - 0.4), g + o.spring / 2 + 0.6, s * (gw / 2 - 0.12), gw / 2 - 0.1, o.spring + 1.2, 0.14, TINT.door);
  }
  if (o.portcullis) {
    for (let k = -3; k <= 3; k++) F.box('metal', outward * 0.4, archTop - 0.4, (k * gw) / 8, 0.1, 1.6, 0.1);
    F.box('metal', outward * 0.4, archTop - 0.6, 0, 0.12, 0.12, gw);
    F.box('metal', outward * 0.4, archTop + 0.2, 0, 0.12, 0.12, gw);
  }
  for (const s of [-1, 1]) {
    const [lx, lz] = F.world(-outward * (D / 2 + 1.6), s * (gw / 2 + 1.4));
    ctx.lamps.push([lx, lz, rot]);
  }
}

function wallRing(ctx, pts, gates, o) {
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k];
    const b = pts[(k + 1) % pts.length];
    if (gates.has(k)) {
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      const dir = [dx / len, dz / len];
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const off = o.gateW / 2 + o.gateTowerW;
      wallRun(ctx, a, [mid[0] - dir[0] * off, mid[1] - dir[1] * off], o);
      wallRun(ctx, [mid[0] + dir[0] * off, mid[1] + dir[1] * off], b, o);
      gatehouse(ctx, mid, dir, o);
    } else {
      wallRun(ctx, a, b, o);
    }
    roundTower(ctx, a[0], a[1], {
      cx: o.cx,
      cz: o.cz,
      r: o.towerR,
      height: o.towerH,
      tint: o.tint,
      roof: o.roofs(k),
      roofTint: o.roofTint,
    });
  }
}

// =============================================================== the town

const BANNER_GEO = new THREE.PlaneGeometry(1.6, 3.2);

function buildLamp(ctx, x, z, rot) {
  const F = new Frame(ctx, x, z, rot);
  const g = ctx.ground(x, z);
  F.box('stone', 0, g + 0.15, 0, 0.45, 0.4, 0.45, TINT.darkStone);
  F.box('timber', 0, g + 1.85, 0, 0.15, 3.3, 0.15, TINT.beam);
  F.box('metal', 0, g + 3.45, 0.3, 0.05, 0.05, 0.75);
  F.box('metal', 0, g + 3.15, 0.08, 0.04, 0.6, 0.04, WHITE, 0.6, 0, 0);
  F.box('metal', 0, g + 3.2, 0.62, 0.34, 0.06, 0.34);
  F.box('lamp', 0, g + 2.97, 0.62, 0.24, 0.38, 0.24);
  F.box('metal', 0, g + 2.75, 0.62, 0.28, 0.05, 0.28);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) F.box('metal', sx * 0.13, g + 2.97, 0.62 + sz * 0.13, 0.03, 0.42, 0.03);
  const [hx, hz] = F.world(0, 0.62);
  ctx.world.lampHeads.push(new THREE.Vector3(hx, g + 2.97, hz));
  ctx.colliders.addCircle(x, z, 0.25, g - 1, g + 3.6);
  ctx.occupy(rect(x, z, 0.4, 0.4));
}

function buildMarket(ctx) {
  const { rng } = ctx;
  ctx.occupy(rect((MARKET.x0 + MARKET.x1) / 2, (MARKET.z0 + MARKET.z1) / 2, (MARKET.x1 - MARKET.x0) / 2, (MARKET.z1 - MARKET.z0) / 2));

  // Stalls around the square (instanced), facing inward.
  const stalls = [
    [-15, 1, Math.PI / 2], [-15, 10, Math.PI / 2], [-15, 19, Math.PI / 2],
    [15, 1, -Math.PI / 2], [15, 10, -Math.PI / 2], [15, 19, -Math.PI / 2],
    [-8, 24.5, Math.PI], [8, 24.5, Math.PI],
  ];
  for (const [x, z, rot] of stalls) {
    const F = new Frame(ctx, x, z, rot);
    const g = ctx.ground(x, z);
    F.inst('stallWood', 0, g, 0);
    F.inst('stallAwning', 0, g, 0, 0, 0, 0, 1, 1, 1, ctx.pick(TINT.awning));
    F.inst('stallGoods', 0, g, 0, 0, 0, 0, 1, 1, 1, ctx.pick(GOODS_TINTS));
    F.collideBox(0, 0, 1.5, 1.2, g - 1, g + 3);
    for (let k = 0; k < 2; k++) {
      const bx = (rng() - 0.5) * 2.4;
      F.inst(rng() < 0.5 ? 'barrel' : 'crate', bx, g, -1.9 - rng() * 0.4, 0, rng() * TAU, 0, 1, 1, 1);
    }
  }

  // Well.
  {
    const x = 8;
    const z = 15;
    const F = new Frame(ctx, x, z, 0.3);
    const g = ctx.ground(x, z);
    F.geo('stone', new THREE.CylinderGeometry(1.15, 1.25, 1.0, 16, 1, true), 0, g + 0.45, 0, 0, 0, 0, 1, 1, 1, TINT.stone);
    F.geo('stone', new THREE.CylinderGeometry(0.9, 0.9, 1.0, 16, 1, true), 0, g + 0.45, 0, 0, 0, 0, 1, 1, 1, TINT.darkStone);
    F.geo('stone', new THREE.RingGeometry(0.9, 1.25, 16).rotateX(-Math.PI / 2), 0, g + 0.95, 0, 0, 0, 0, 1, 1, 1, TINT.stone);
    F.geo('glass', new THREE.CircleGeometry(0.9, 16).rotateX(-Math.PI / 2), 0, g + 0.2, 0);
    for (const s of [-1, 1]) F.box('timber', s * 1.05, g + 1.5, 0, 0.16, 2.2, 0.16, TINT.beam);
    F.box('timber', 0, g + 2.45, 0, 2.4, 0.14, 0.14, TINT.beam);
    F.geo('timber', new THREE.CylinderGeometry(0.06, 0.06, 2.1, 6), 0, g + 2.2, 0, 0, 0, Math.PI / 2, 1, 1, 1, TINT.beam);
    F.box('planks', 0, g + 2.85, 0.55, 2.8, 0.08, 1.35, TINT.boards, 0.55, 0, 0);
    F.box('planks', 0, g + 2.85, -0.55, 2.8, 0.08, 1.35, TINT.boards, -0.55, 0, 0);
    F.geo('planks', new THREE.CylinderGeometry(0.17, 0.14, 0.3, 8), 0.2, g + 1.55, 0, 0, 0, 0, 1, 1, 1, TINT.door);
    ctx.colliders.addCircle(x, z, 1.3, g - 1, g + 3);
    ctx.occupy(rect(x, z, 1.6, 1.6));
  }

  // Statue of a crowned king on a stepped plinth.
  {
    const x = 0;
    const z = 5;
    const F = new Frame(ctx, x, z, 0);
    const g = ctx.ground(x, z);
    const t = TINT.stone;
    F.box('stone', 0, g + 0.2, 0, 3.2, 0.6, 3.2, TINT.darkStone);
    F.box('stone', 0, g + 1.1, 0, 2.2, 1.4, 2.2, t);
    F.box('stone', 0, g + 1.9, 0, 2.5, 0.2, 2.5, TINT.darkStone);
    const y = g + 2.0;
    F.geo('stone', new THREE.CylinderGeometry(0.42, 0.66, 1.9, 12), 0, y + 0.95, 0, 0, 0, 0, 1, 1, 1, t);
    F.geo('stone', new THREE.CylinderGeometry(0.38, 0.42, 0.75, 12), 0, y + 2.25, 0, 0, 0, 0, 1, 1, 1, t);
    F.geo('stone', new THREE.SphereGeometry(0.25, 12, 10), 0, y + 2.9, 0, 0, 0, 0, 1, 1.12, 1, t);
    F.geo('stone', new THREE.CylinderGeometry(0.27, 0.25, 0.14, 12), 0, y + 3.18, 0, 0, 0, 0, 1, 1, 1, t);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU;
      F.box('stone', Math.sin(a) * 0.23, y + 3.31, Math.cos(a) * 0.23, 0.08, 0.16, 0.08, t);
    }
    F.box('stone', 0, y + 1.5, 0.48, 0.08, 2.2, 0.06, t);
    F.box('stone', 0, y + 2.25, 0.48, 0.5, 0.07, 0.08, t);
    F.box('stone', -0.22, y + 1.95, 0.42, 0.14, 0.5, 0.14, t, -0.5, 0, 0);
    F.box('stone', 0.22, y + 1.95, 0.42, 0.14, 0.5, 0.14, t, -0.5, 0, 0);
    F.box('stone', 0, y + 1.3, -0.35, 1.0, 2.2, 0.12, t, 0.08, 0, 0);
    ctx.colliders.addCircle(x, z, 1.75, g - 1, g + 6);
    ctx.occupy(rect(x, z, 1.8, 1.8));
    // A bronze plaque on the plinth's south face.
    F.box('gold', 0, g + 1.15, 1.115, 1.3, 0.55, 0.03);
    anchor(ctx, 'statue', x, z + 2.4, [x, g + 1.25, z + 1.2]);
  }

  for (const [x, z] of [[-19, -3], [19, -3], [-19, 27], [19, 27]]) ctx.lamps.push([x, z, Math.atan2(-x, 12 - z)]);
  for (let k = 0; k < 10; k++) {
    const x = (rng() - 0.5) * 34;
    const z = MARKET.z0 + 2 + rng() * 26;
    if (ctx.occupied(x, z, 0.8)) continue;
    const F = new Frame(ctx, x, z, rng() * TAU);
    F.inst(rng() < 0.6 ? 'crate' : 'barrel', 0, ctx.ground(x, z), 0, 0, 0, 0, 1, 1, 1);
    ctx.colliders.addCircle(x, z, 0.45, -Infinity, Infinity);
  }
}

const GOODS_TINTS = [C(0xc23a2a), C(0x6a9a38), C(0xd9a441), C(0x9a7a5a), C(0xb05a8a), C(0xe0d4b0)];
TINT.awning = [C(0xb83a32), C(0x2f5f9a), C(0x3d7a45), C(0xc9932f), C(0x7a3f86), C(0xe2dacb)];

function buildTavern(ctx) {
  const { x, z } = SITES.tavern;
  const { F, base } = buildHouse(ctx, {
    x, z, rot: 0, w: 14, d: 9, floors: 2, style: 'timber', roof: 'tile', jetty: true, chimney: true,
    wallTint: TINT.plaster[1], roofTint: TINT.roof[2], shutter: TINT.shutter[1], doorAt: -2.5,
  });
  // Hanging sign, benches and tables out front.
  F.box('metal', 5.6, base + 3.3, 5.6, 0.06, 0.06, 1.6);
  // Two single-sided faces back to back, so the sign reads correctly from both sides.
  F.geo('sign', SIGN_GEO, 5.605, base + 2.75, 6.1, 0, Math.PI / 2, 0, 1, 1, 1, WHITE, true);
  F.geo('sign', SIGN_GEO, 5.595, base + 2.75, 6.1, 0, -Math.PI / 2, 0, 1, 1, 1, WHITE, true);
  F.box('metal', 5.6, base + 3.1, 6.1, 0.04, 0.05, 1.3);
  for (const bx of [1.5, 4.5]) {
    F.box('planks', bx, base - 0.25, 6.2, 1.6, 0.08, 0.8, TINT.door);
    for (const sx of [-0.65, 0.65]) F.box('timber', bx + sx, base - 0.62, 6.2, 0.1, 0.7, 0.7, TINT.beam);
    for (const sz of [5.4, 7.0]) F.box('planks', bx, base - 0.6, sz, 1.6, 0.06, 0.32, TINT.door);
    F.collideBox(bx, 6.2, 0.9, 1.0, base - 2, base + 0.5);
  }
  for (const [bx, bz] of [[-6, 5.6], [-5.2, 5.9], [6.8, -5.2]]) F.inst('barrel', bx, F.ground(bx, bz), bz, 0, ctx.rng() * TAU, 0, 1, 1, 1);
  // A song sheet left on the far table, under a tankard.
  const top = base - 0.205;
  F.geo('parchment', PAGE_GEO, 4.3, top, 6.1, -Math.PI / 2, 0.35, 0, 0.24, 0.32, 1, WHITE, true);
  F.geo('timber', new THREE.CylinderGeometry(0.045, 0.05, 0.13, 10), 4.55, top + 0.065, 5.92, 0, 0, 0, 1, 1, 1, TINT.door);
  const [ax, az] = F.world(4.4, 7.7);
  const [gx, gz] = F.world(4.3, 6.1);
  anchor(ctx, 'ballad', ax, az, [gx, top + 0.25, gz]);
}

const SIGN_GEO = new THREE.PlaneGeometry(1.3, 0.65);

function buildSmithy(ctx) {
  const { x, z } = SITES.smithy;
  const rot = Math.PI / 2;
  const { F, base, ridgeY } = buildHouse(ctx, {
    x, z, rot, w: 9, d: 8, floors: 1, style: 'stone', roof: 'slate', door: true, doorAt: 2.6,
    wallTint: TINT.stone, shutter: TINT.shutter[3], heights: [3.4],
  });
  // Open-fronted forge shed.
  const fz = 4 + 3.4;
  for (const sx of [-4.2, 0, 4.2]) {
    F.box('timber', sx, base + 1.4, fz, 0.24, 2.9, 0.24, TINT.beam);
    F.collideCircle(sx, fz, 0.2, base - 1, base + 3);
  }
  F.box('timber', 0, base + 2.9, fz, 9, 0.24, 0.24, TINT.beam);
  F.box('planks', 0, base + 3.2, 5.7, 9.6, 0.1, 3.9, TINT.boards, 0.2, 0, 0);
  // Forge, bellows hood and chimney, anvil, quench barrel, grindstone and weapon rack.
  F.box('stone', -2.4, base + 0.5, 5.4, 1.8, 1.0, 1.4, TINT.darkStone);
  F.box('fire', -2.4, base + 1.03, 5.4, 1.2, 0.08, 0.8, WHITE);
  F.geo('fire', new THREE.ConeGeometry(0.35, 0.6, 6), -2.4, base + 1.3, 5.4);
  F.box('stone', -2.4, base + 2.4, 5.0, 1.2, 1.0, 0.9, TINT.darkStone, 0.15, 0, 0);
  F.box('stone', -2.4, (base + 3 + ridgeY + 1.2) / 2, 4.3, 0.8, ridgeY + 1.2 - base - 3, 0.8, TINT.darkStone);
  F.collideBox(-2.4, 5.4, 0.95, 0.75, base - 1, base + 3);
  F.geo('timber', new THREE.CylinderGeometry(0.3, 0.35, 0.6, 8), 0.4, base + 0.3, 6.4, 0, 0, 0, 1, 1, 1, TINT.beam);
  F.box('metal', 0.4, base + 0.72, 6.4, 0.9, 0.24, 0.35);
  F.geo('metal', new THREE.ConeGeometry(0.17, 0.5, 4), 1.05, base + 0.72, 6.4, 0, 0, -Math.PI / 2);
  F.collideCircle(0.4, 6.4, 0.5, base - 1, base + 1.2);
  F.inst('barrel', 2.2, base - 0.35, 6.6, 0, 0, 0, 1, 1, 1);
  F.geo('stone', new THREE.CylinderGeometry(0.45, 0.45, 0.16, 14), 3.4, base + 0.8, 5.6, 0, 0, Math.PI / 2, 1, 1, 1, TINT.stone);
  F.box('timber', 3.4, base + 0.4, 5.3, 0.1, 0.8, 0.1, TINT.beam);
  F.box('timber', 3.4, base + 0.4, 5.9, 0.1, 0.8, 0.1, TINT.beam);
  F.box('timber', -4.0, base + 1.0, 4.4, 0.12, 1.8, 0.12, TINT.beam);
  F.box('timber', -4.0, base + 1.6, 5.4, 0.1, 0.1, 2.0, TINT.beam);
  for (let k = 0; k < 4; k++) F.box('metal', -3.95, base + 1.05, 4.7 + k * 0.42, 0.04, 1.3, 0.07);
  // Notices nailed to the street-side post; the framed one is an old ledger page.
  F.box('timber', 4.2, base + 1.55, fz + 0.13, 0.3, 0.4, 0.02, TINT.door);
  F.geo('parchment', PAGE_GEO, 4.2, base + 1.55, fz + 0.145, 0, 0, 0, 0.25, 0.34, 1, WHITE, true);
  F.geo('parchment', PAGE_GEO, 4.18, base + 1.12, fz + 0.13, 0, 0, 0.12, 0.18, 0.22, 1, WHITE, true);
  F.geo('parchment', PAGE_GEO, 4.24, base + 1.95, fz + 0.13, 0, 0, -0.08, 0.16, 0.14, 1, WHITE, true);
  const [lx, lz] = F.world(4.2, fz + 1.1);
  const [px, pz] = F.world(4.2, fz + 0.3);
  anchor(ctx, 'ledger', lx, lz, [px, base + 1.6, pz]);
  ctx.occupy(rect(...F.world(0, 6), 5, 2.4, rot));
}

function buildChapel(ctx) {
  const { x, z } = SITES.chapel;
  const F = new Frame(ctx, x, z, 0);
  const w = 10;
  const d = 18;
  let g = Infinity;
  let gMax = -Infinity;
  for (const [lx, lz] of [[-5, -9], [5, -9], [-5, 9], [5, 9], [0, 12]]) {
    g = Math.min(g, F.ground(lx, lz));
    gMax = Math.max(gMax, F.ground(lx, lz));
  }
  const base = gMax + 0.4;
  const H = 7.5;
  F.box('stone', 0, (g - 1 + base) / 2, 1.2, w + 0.6, base - g + 1, d + 3.2, TINT.plinth);
  // Nave walls with tall pointed windows.
  const holes = [-6, -2, 2, 6].map((a) => ({ x: a, w: 1.3, y0: 2.2, spring: 5.0 }));
  const side = extrude(archShape(d, H, holes), 0.9, 10);
  side.rotateY(Math.PI / 2);
  for (const s of [-1, 1]) {
    F.geo('stone', side, s * (w / 2 - 0.45), base, 0, 0, 0, 0, 1, 1, 1, TINT.stone);
    for (const a of [-6, -2, 2, 6]) F.box('glass', s * (w / 2 - 0.45), base + 4.1, a, 0.06, 3.9, 1.25, ctx.pick(STAINED));
    for (const a of [-8, -4, 0, 4, 8]) F.box('stone', s * (w / 2 + 0.2), base + 2.6, a, 0.6, 5.2, 0.7, TINT.darkStone);
  }
  F.box('stone', 0, base + H / 2, -d / 2 + 0.45, w, H, 0.9, TINT.stone);
  F.geo('glass', new THREE.CircleGeometry(1.1, 16), 0, base + 5, -d / 2 - 0.02, 0, Math.PI, 0, 1, 1, 1, STAINED[0]);
  F.box('stone', 0, base + H / 2, d / 2 - 0.45, w, H, 0.9, TINT.stone);
  gableRoof(ctx, new Frame(ctx, x, z, Math.PI / 2), {
    w: d, d: w, z: 0, y: base + H, pitch: 52 * DEG, over: 0.5, kind: 'slate', tint: TINT.slate,
    gableKey: 'stone', gableTint: TINT.stone, gableTimber: false,
  });
  // Bell tower over the door, open belfry, pyramid spire.
  const tz = d / 2 + 1.5;
  F.box('stone', 0, base + 4, tz, 4.4, 8, 4.4, TINT.stone);
  const belfry = extrude(archShape(4.4, 3.4, [{ x: 0, w: 1.6, y0: 0.6, spring: 2.2 }]), 0.6, 10);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    F.geo('stone', belfry, Math.sin(a) * 1.9, base + 8, tz + Math.cos(a) * 1.9, 0, a, 0, 1, 1, 1, TINT.stone);
  }
  F.box('stone', 0, base + 11.6, tz, 4.8, 0.4, 4.8, TINT.darkStone);
  F.geo('shingle', new THREE.ConeGeometry(3.3, 6, 4, 1, true), 0, base + 14.8, tz, 0, Math.PI / 4, 0, 1, 1, 1, TINT.slate);
  F.geo('gold', new THREE.CylinderGeometry(0.06, 0.06, 1.6, 6), 0, base + 18.4, tz);
  F.box('gold', 0, base + 18.7, tz, 0.7, 0.08, 0.08);
  F.geo('gold', new THREE.SphereGeometry(0.45, 12, 8, 0, TAU, 0, Math.PI / 2), 0, base + 9.2, tz, Math.PI, 0, 0);
  // Arched door.
  F.box('stone', 0, base + 1.6, tz + 2.21, 2.2, 3.4, 0.1, TINT.darkStone);
  F.box('planks', 0, base + 1.4, tz + 2.26, 1.4, 2.8, 0.08, TINT.door);
  F.box('stone', 0, base - 0.15, tz + 3.0, 2.6, 0.3, 1.4, TINT.darkStone);
  F.collideBox(0, 0, w / 2 + 0.3, d / 2 + 0.3, g - 1, base + 14);
  F.collideBox(0, tz, 2.3, 2.3, g - 1, base + 18);
  ctx.occupy(rect(x, z + 1.5, w / 2 + 0.6, d / 2 + 4));
}

const STAINED = [C(0x3a64c8), C(0xc83a3a), C(0xd8b040), C(0x3aa060), C(0x8a4ac0)];

function buildGraveyard(ctx) {
  const { x, z } = SITES.graveyard;
  const hw = 7;
  const hd = 9;
  const g = ctx.ground(x, z);
  const F = new Frame(ctx, x, z, 0);
  const runs = [
    [[-hw, -hd], [hw, -hd]], [[-hw, hd], [hw, hd]], [[-hw, -hd], [-hw, hd]],
    [[hw, -hd], [hw, -1.6]], [[hw, 1.6], [hw, hd]],
  ];
  for (const [[ax, az], [bx, bz]] of runs) {
    const len = Math.hypot(bx - ax, bz - az);
    const along = bx !== ax;
    F.box('stone', (ax + bx) / 2, g + 0.45, (az + bz) / 2, along ? len + 0.6 : 0.6, 1.3, along ? 0.6 : len, TINT.mossy);
    F.collideBox((ax + bx) / 2, (az + bz) / 2, along ? len / 2 + 0.3 : 0.3, along ? 0.3 : len / 2, g - 1, g + 1.2);
  }
  for (const s of [-1, 1]) F.box('stone', hw, g + 0.8, s * 1.6, 0.8, 1.8, 0.8, TINT.darkStone);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 5; c++) {
      const tx = -4.5 + c * 2.2 + (ctx.rng() - 0.5) * 0.4;
      const tz = -5.5 + r * 4 + (ctx.rng() - 0.5) * 0.5;
      if (r === 0 && c === 0) continue;
      const tilt = (ctx.rng() - 0.5) * 0.18;
      F.inst(ctx.rng() < 0.25 ? 'cross' : 'tomb', tx, F.ground(tx, tz) - 0.05, tz, tilt, Math.PI / 2 + (ctx.rng() - 0.5) * 0.15, 0, 1, 1, 1, ctx.vary(TINT.mossy, 0.1));
      F.collideCircle(tx, tz, 0.35, g - 1, g + 1.2);
    }
  }
  // An old tomb beneath a yew in the north-west corner.
  F.box('stone', -4.5, g + 0.35, -6.3, 1.4, 0.7, 2.4, TINT.darkStone);
  F.box('stone', -4.5, g + 0.78, -6.3, 1.6, 0.16, 2.6, TINT.mossy);
  F.collideBox(-4.5, -6.3, 0.8, 1.3, g - 1, g + 1);
  // A fresh bunch of wild heather on the lid, tied with bark.
  const heather = C(0x8e5a9e);
  for (let k = 0; k < 9; k++) {
    const hx = -4.5 + (ctx.rng() - 0.5) * 0.3;
    const hz = -5.55 + k * 0.045;
    F.geo('plainCloth', new THREE.IcosahedronGeometry(0.045 + ctx.rng() * 0.02, 0), hx, g + 0.89, hz - 0.1, 0, 0, 0, 1, 0.7, 1.6, ctx.vary(heather, 0.15));
  }
  for (let k = 0; k < 5; k++) F.box('plainCloth', -4.5 + (k - 2) * 0.03, g + 0.875, -5.18, 0.012, 0.012, 0.42, C(0x4a5a2e), 0, (k - 2) * 0.12, 0);
  F.box('timber', -4.5, g + 0.885, -5.25, 0.14, 0.03, 0.04, TINT.beam);
  anchor(ctx, 'grave', x - 4.5, z - 4.2, [x - 4.5, g + 1.1, z - 5.6]);
  ctx.occupy(rect(x, z, hw + 0.5, hd + 0.5));
  ctx.trees.push({ x: x - 5.8, z: z - 8, kind: 'pine', s: 0.75 });
}

// Houses lining the streets, wherever they fit.
function placeTownHouses(ctx) {
  const { rng } = ctx;
  const streets = ROADS.filter((r) => r.town);
  const gates = [[0, 10 + TOWN_INNER], [0, 10 - TOWN_INNER], [-TOWN_INNER, 10]];
  let count = 0;
  for (const road of streets) {
    const pts = road.pts;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    const total = cum[cum.length - 1];
    for (const side of [1, -1]) {
      let s = 3 + rng() * 3;
      while (s < total - 3) {
        const w = 6.5 + rng() * 3;
        const d = 7 + rng() * 2.5;
        let i = 1;
        while (i < cum.length - 1 && cum[i] < s) i++;
        const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
        const px = lerp(pts[i - 1].x, pts[i].x, t);
        const pz = lerp(pts[i - 1].z, pts[i].z, t);
        const tx = pts[i].x - pts[i - 1].x;
        const tz = pts[i].z - pts[i - 1].z;
        const tl = Math.hypot(tx, tz) || 1;
        const nx = (-tz / tl) * side;
        const nz = (tx / tl) * side;
        const off = road.w / 2 + 1.3 + d / 2;
        const hx = px + nx * off;
        const hz = pz + nz * off;
        const rot = Math.atan2(-nx, -nz);
        const r = rect(hx, hz, w / 2, d / 2, rot);
        let ok = true;
        for (const [cx, cz] of rectCorners(r, 0.3)) {
          if (!pointInPolygon(cx, cz, TOWN_WALL) || distToPolygonEdge(cx, cz, TOWN_WALL) < 5.5) ok = false;
          if (roadClearance(cx, cz, (rr) => rr.town || rr.kind === 'cobble') < 0.6) ok = false;
        }
        if (ok && roadClearance(hx, hz) < 0.6) ok = false;
        if (ok && gates.some(([gx, gz]) => Math.hypot(hx - gx, hz - gz) < 11)) ok = false;
        if (ok && ctx.footprints.some((f) => rectsOverlap(f, r, 0.6))) ok = false;
        if (ok) {
          const floors = rng() < 0.6 ? 2 : 1;
          const style = rng() < 0.75 ? 'timber' : 'plaster';
          buildHouse(ctx, {
            x: hx, z: hz, rot, w, d, floors, style,
            roof: rng() < 0.85 ? 'tile' : 'slate',
            jetty: floors === 2 && style === 'timber' && rng() < 0.7,
            chimney: rng() < 0.7,
            wallTint: ctx.pick(TINT.plaster),
            roofTint: ctx.pick(TINT.roof),
            shutter: rng() < 0.7 ? ctx.pick(TINT.shutter) : null,
            doorAt: (rng() - 0.5) * (w - 3),
          });
          count++;
          s += w + 1 + rng() * 2;
        } else {
          s += 2;
        }
      }
    }
  }
  return count;
}

// Lamp posts at the kerb every `spacing` metres, alternating sides.
function streetLamps(ctx, filter, spacing) {
  for (const road of ROADS.filter(filter)) {
    const pts = road.pts;
    let next = 6;
    let acc = 0;
    let side = 1;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      acc += len;
      if (acc < next) continue;
      next += spacing;
      side = -side;
      const nx = (-(b.z - a.z) / len) * side;
      const nz = ((b.x - a.x) / len) * side;
      const x = b.x + nx * (road.w / 2 + 0.5);
      const z = b.z + nz * (road.w / 2 + 0.5);
      if (ctx.occupied(x, z, 0.3)) continue;
      if (roadClearance(x, z, (r) => r !== road) < 0.3) continue;
      if (x > MARKET.x0 - 1 && x < MARKET.x1 + 1 && z > MARKET.z0 - 1 && z < MARKET.z1 + 1) continue;
      ctx.lamps.push([x, z, Math.atan2(-nx, -nz)]);
      ctx.occupy(rect(x, z, 0.4, 0.4));
    }
  }
}

// ============================================================== the castle

function buildCastle(ctx) {
  const c = SITES.castle;
  const F0 = c.y + 0.15; // hall floor level
  wallRing(ctx, CASTLE_WALL, CASTLE_GATES, {
    cx: c.x, cz: c.z, H: 10, T: 2.8, towerR: 4.4, towerH: 15.5,
    gateW: 5, gateTowerW: 6.5, gateH: 17, spring: 3.4,
    tint: TINT.castle, roofs: (k) => k % 2 === 0, roofTint: TINT.slate, portcullis: true, banners: true,
  });

  buildThroneHall(ctx, F0);

  // Donjon: the great tower against the hall's north-west corner.
  {
    const x = -12.5;
    const z = -209.5;
    const F = new Frame(ctx, x, z, 0);
    const top = c.y + 26;
    F.box('stone', 0, (c.y - 1 + top) / 2, 0, 9, top - c.y + 1, 9, TINT.castle);
    for (const yy of [c.y + 9, c.y + 18]) F.box('stone', 0, yy, 0, 9.3, 0.3, 9.3, TINT.darkStone);
    F.box('stone', 0, top + 0.2, 0, 9.8, 0.5, 9.8, TINT.castle);
    for (let k = 0; k < 4; k++) {
      for (let j = -2; j <= 2; j++) {
        const a = (k * Math.PI) / 2;
        F.box('stone', Math.sin(a) * 4.6 + Math.cos(a) * j * 1.9, top + 1.0, Math.cos(a) * 4.6 - Math.sin(a) * j * 1.9, 1.1, 1.2, 0.6, TINT.castle, 0, a, 0);
      }
    }
    for (const yy of [c.y + 13, c.y + 21]) {
      F.box('glass', 0, yy, 4.52, 0.2, 1.6, 0.06);
      F.box('glass', -4.52, yy, 0, 0.06, 1.6, 0.2);
    }
    F.box('timber', 0, top + 4, 0, 0.16, 7, 0.16, TINT.beam);
    ctx.flags.push({ x, y: top + 6.2, z, rot: 0, scale: 1.4 });
    // The sealed door in its south face.
    const dz = 4.5;
    F.geo('stone', extrude(archShape(2.6, 3.8, [{ x: 0, w: 1.6, y0: 0.3, spring: 2.3 }]), 0.5, 10), 0, c.y - 0.3, dz + 0.2, 0, 0, 0, 1, 1, 1, TINT.darkStone);
    F.box('planks', 0, c.y + 1.4, dz + 0.04, 1.6, 2.8, 0.1, C(0x5a4232));
    for (const yy of [c.y + 0.6, c.y + 1.4, c.y + 2.2]) F.box('metal', 0, yy, dz + 0.11, 1.6, 0.12, 0.04);
    F.box('metal', 0, c.y + 1.4, dz + 0.16, 1.9, 0.08, 0.06, WHITE, 0, 0, 0.62);
    F.box('metal', 0, c.y + 1.4, dz + 0.16, 1.9, 0.08, 0.06, WHITE, 0, 0, -0.62);
    F.box('gold', 0, c.y + 1.35, dz + 0.22, 0.3, 0.36, 0.12);
    // The lintel inscription and a lead-filled lock.
    F.box('stone', 0, c.y + 3.0, dz + 0.36, 2.2, 0.32, 0.06, TINT.stone);
    F.box('metal', 0, c.y + 1.35, dz + 0.29, 0.12, 0.12, 0.02, C(0x8a8e94));
    anchor(ctx, 'door', x, z + dz + 1.6, [x, c.y + 1.5, z + dz + 0.5]);
    F.collideBox(0, 0, 4.5, 4.5, c.y - 2, top + 3);
    ctx.occupy(rect(x, z, 5, 5));
  }

  // Barracks along the west wall.
  buildHouse(ctx, {
    x: -19, z: -182, rot: Math.PI / 2, w: 13, d: 8, floors: 2, style: 'stone', roof: 'slate', chimney: true,
    wallTint: TINT.castle, shutter: TINT.shutter[2], heights: [3, 2.8],
  });

  // Stables along the east wall.
  {
    const F = new Frame(ctx, 21, -198, 0);
    const g = c.y;
    F.box('planks', 2.6, g + 1.7, 0, 0.3, 3.4, 12, TINT.boards);
    for (const pz of [-6, -2, 2, 6]) {
      F.box('timber', -2.8, g + 1.3, pz, 0.24, 2.6, 0.24, TINT.beam);
      F.collideCircle(-2.8, pz, 0.2, g - 1, g + 3);
      F.box('planks', 0, g + 0.6, pz, 5, 1.2, 0.1, TINT.boards);
    }
    F.box('timber', -2.8, g + 2.6, 0, 0.2, 0.2, 12.4, TINT.beam);
    F.box('thatch', 0, g + 3.15, 0, 6.6, 0.35, 12.8, WHITE, 0, 0, 0.16);
    for (const pz of [-4, 0, 4]) F.geo('thatch', new THREE.SphereGeometry(0.9, 8, 6, 0, TAU, 0, Math.PI / 2), 1.2, g, pz, 0, 0, 0, 1, 0.8, 1);
    F.box('planks', -1.2, g + 0.35, 0, 0.7, 0.5, 3, TINT.boards);
    F.collideBox(2.6, 0, 0.3, 6, g - 1, g + 4);
    ctx.occupy(rect(21, -198, 3.4, 6.6));
  }

  // Well, training dummies, cart and stores in the courtyard.
  {
    const F = new Frame(ctx, 13, -176, 0);
    const g = c.y;
    F.geo('stone', new THREE.CylinderGeometry(1.1, 1.2, 0.95, 14, 1, true), 0, g + 0.45, 0, 0, 0, 0, 1, 1, 1, TINT.castle);
    F.geo('stone', new THREE.RingGeometry(0.85, 1.2, 14).rotateX(-Math.PI / 2), 0, g + 0.93, 0, 0, 0, 0, 1, 1, 1, TINT.castle);
    F.geo('glass', new THREE.CircleGeometry(0.85, 14).rotateX(-Math.PI / 2), 0, g + 0.2, 0);
    for (const s of [-1, 1]) F.box('timber', s * 1.0, g + 1.4, 0, 0.15, 2, 0.15, TINT.beam);
    F.box('timber', 0, g + 2.35, 0, 2.3, 0.14, 0.14, TINT.beam);
    F.collideCircle(0, 0, 1.25, g - 1, g + 2.6);
    ctx.occupy(rect(13, -176, 1.5, 1.5));
  }
  for (const [x, z] of [[-6, -171], [-2.5, -168.5]]) {
    const F = new Frame(ctx, x, z, 0.4);
    const g = c.y;
    F.box('timber', 0, g + 1.0, 0, 0.14, 2.0, 0.14, TINT.beam);
    F.box('timber', 0, g + 1.45, 0, 1.4, 0.12, 0.12, TINT.beam);
    F.geo('plainCloth', new THREE.CylinderGeometry(0.28, 0.32, 0.8, 8), 0, g + 1.35, 0, 0, 0, 0, 1, 1, 1, C(0xb59a6a));
    F.geo('plainCloth', new THREE.SphereGeometry(0.22, 8, 6), 0, g + 1.95, 0, 0, 0, 0, 1, 1, 1, C(0xb59a6a));
    F.collideCircle(0, 0, 0.35, g - 1, g + 2.2);
  }
  buildCart(ctx, 16, -167, -0.6);
  for (let k = 0; k < 7; k++) {
    const x = -24 + (k % 3) * 1.1;
    const z = -170 + Math.floor(k / 3) * 1.1;
    const F = new Frame(ctx, x, z, ctx.rng() * TAU);
    F.inst(k % 2 ? 'crate' : 'barrel', 0, c.y, 0, 0, 0, 0, 1, 1, 1);
  }
  ctx.colliders.addBox(-23, -169, 2, 2, 0, c.y - 1, c.y + 2);

  // Banners flanking the hall door, lamps around the courtyard.
  for (const s of [-1, 1]) {
    const F = new Frame(ctx, s * 3.6, -184.2, 0);
    F.box('timber', 0, c.y + 3.5, 0, 0.16, 7, 0.16, TINT.beam);
    F.collideCircle(0, 0, 0.2, c.y - 1, c.y + 7);
    ctx.flags.push({ x: s * 3.6, y: c.y + 6.2, z: -184.2, rot: 0, scale: 1 });
  }
  anchor(ctx, 'arms', -3.6, -182.8, [-3.6, c.y + 2.4, -184.0]);
  for (const [x, z] of [[-5.5, -185], [5.5, -185], [-12, -166], [12, -166], [20, -184], [-20, -192]]) ctx.lamps.push([x, z, Math.atan2(-x, -190 - z)]);
  ctx.occupy(rect(c.x, c.z, 32, 32));
}

function buildThroneHall(ctx, F0) {
  const { x, z, w, d } = SITES.hall;
  const F = new Frame(ctx, x, z, 0);
  const H = 11.5;
  const T = 1.2;
  const tint = TINT.castle;

  // Floor (with a threshold through the door) and plinth.
  F.box('stoneFloor', 0, (F0 - 1.2 + F0) / 2, 0.6, w - 0.4, 1.2, d + 1.2, TINT.stone);
  ctx.world.surfaces.push({ ...rect(x, z + 0.6, w / 2 - 0.4, d / 2 + 0.6), height: () => F0 });

  // South wall with the arched great door; side walls with tall windows.
  const south = extrude(archShape(w, H, [{ x: 0, w: 3.6, y0: 0.5, spring: 4.1 }]), T, 14);
  F.geo('stone', south, 0, F0 - 0.5, d / 2 - T / 2, 0, 0, 0, 1, 1, 1, tint);
  F.box('stone', 0, F0 + H / 2 - 0.5, -d / 2 + T / 2, w, H, T, tint);
  const winX = [-9, -3, 3, 9];
  const sideWall = extrude(archShape(d, H, winX.map((a) => ({ x: a, w: 1.5, y0: 3.7, spring: 7.4 }))), T, 12);
  sideWall.rotateY(Math.PI / 2);
  for (const s of [-1, 1]) {
    F.geo('stone', sideWall, s * (w / 2 - T / 2), F0 - 0.5, 0, 0, 0, 0, 1, 1, 1, tint);
    for (const a of winX) {
      const tint = ctx.pick(STAINED);
      F.box('stained', s * (w / 2 - T + 0.15), F0 + 5.3, -a, 0.04, 4.4, 1.45, tint);
      F.box('glass', s * (w / 2 - 0.15), F0 + 5.3, -a, 0.04, 4.4, 1.45, tint);
    }
    for (const a of [-12, -6, 0, 6, 12]) F.box('stone', s * (w / 2 + 0.3), F0 + 4.5, a, 0.6, 10, 0.9, TINT.darkStone);
  }
  // String course and crenellated eaves.
  for (const s of [-1, 1]) F.box('stone', s * (w / 2 + 0.1), F0 + H - 0.7, 0, 0.4, 0.3, d + 0.4, TINT.darkStone);

  // Roof: ridge along the hall's length.
  const roofFrame = new Frame(ctx, x, z, Math.PI / 2);
  const ridgeY = gableRoof(ctx, roofFrame, {
    w: d, d: w, z: 0, y: F0 + H - 0.5, pitch: 42 * DEG, over: 0.6, kind: 'slate', tint: TINT.slate,
    gableKey: 'stone', gableTint: tint, gableTimber: false,
  });

  // Trusses, columns, carpet, dais, throne, banners, braziers and a chandelier.
  const beamY = F0 + H - 0.9;
  for (const bz of [-11, -5.5, 0, 5.5, 11]) {
    F.box('timber', 0, beamY, bz, w - T * 2, 0.4, 0.4, TINT.beam);
    F.box('timber', 0, (beamY + ridgeY) / 2, bz, 0.3, ridgeY - beamY, 0.3, TINT.beam);
    for (const s of [-1, 1]) F.box('timber', s * 3.2, beamY + 1.6, bz, 0.25, 3.8, 0.25, TINT.beam, 0, 0, s * 0.95);
  }
  for (const s of [-1, 1]) {
    for (const cz of [8.5, 3.5, -1.5, -6.5]) {
      F.box('stone', s * 4.3, F0 + 0.25, cz, 1.2, 0.5, 1.2, TINT.darkStone);
      F.geo('stone', new THREE.CylinderGeometry(0.42, 0.48, H - 1.8, 12), s * 4.3, F0 + (H - 1.8) / 2 + 0.4, cz, 0, 0, 0, 1, 1, 1, tint);
      F.box('stone', s * 4.3, F0 + H - 1.3, cz, 1.2, 0.4, 1.2, TINT.darkStone);
      F.collideCircle(s * 4.3, cz, 0.6, F0 - 1, F0 + H);
      // Wall torch on the aisle side of each column.
      F.box('timber', s * 3.78, F0 + 2.8, cz, 0.08, 0.5, 0.08, TINT.beam, 0, 0, s * 0.4);
      F.geo('fire', new THREE.ConeGeometry(0.09, 0.28, 6), s * 3.68, F0 + 3.15, cz);
    }
  }
  F.box('plainCloth', 0, F0 + 0.012, 1.5, 2.6, 0.025, 21, TINT.carpet);
  for (const s of [-1, 1]) F.box('plainCloth', s * 1.35, F0 + 0.014, 1.5, 0.12, 0.025, 21, TINT.gold);

  ctx.world.surfaces.push({ ...rect(x, z - 10.4, 5.4, 2.4), height: () => F0 + 0.3 });
  ctx.world.surfaces.push({ ...rect(x, z - 11.5, 3.4, 1.3), height: () => F0 + 0.6 });
  F.box('stone', 0, F0 + 0.15, -10.4, 10.8, 0.3, 4.8, TINT.stone);
  F.box('stone', 0, F0 + 0.45, -11.5, 6.8, 0.3, 2.6, TINT.stone);
  F.box('plainCloth', 0, F0 + 0.62, -11.5, 4, 0.02, 2, TINT.carpet);
  // Throne.
  {
    const ty = F0 + 0.6;
    const tz = -11.8;
    F.box('timber', 0, ty + 0.25, tz, 1.4, 0.5, 1.1, C(0x5a3a26));
    F.box('plainCloth', 0, ty + 0.55, tz + 0.05, 1.2, 0.1, 0.9, TINT.carpet);
    F.box('timber', 0, ty + 1.6, tz - 0.5, 1.5, 2.6, 0.2, C(0x5a3a26));
    F.box('plainCloth', 0, ty + 1.35, tz - 0.38, 1.1, 1.6, 0.05, TINT.carpet);
    F.geo('gold', new THREE.ConeGeometry(0.75, 0.7, 4), 0, ty + 3.25, tz - 0.5, 0, Math.PI / 4, 0, 1, 1, 0.3);
    for (const s of [-1, 1]) {
      F.box('timber', s * 0.68, ty + 0.85, tz, 0.16, 0.6, 1.1, C(0x5a3a26));
      F.box('gold', s * 0.68, ty + 1.17, tz, 0.2, 0.06, 1.15);
      F.geo('gold', new THREE.SphereGeometry(0.1, 8, 6), s * 0.75, ty + 2.95, tz - 0.5);
    }
    F.collideBox(0, tz - 0.1, 0.8, 0.7, F0 - 1, F0 + 4);
  }
  // Banners behind the throne and between the windows.
  for (const s of [-1, 1]) {
    F.box('metal', s * 4.6, F0 + 9.15, -d / 2 + T + 0.12, 1.9, 0.06, 0.06);
    F.geo('banner', BANNER_GEO, s * 4.6, F0 + 7.5, -d / 2 + T + 0.08, 0, 0, 0, 1, 1, 1, WHITE, true);
    for (const a of [-6, 0, 6]) {
      F.geo('banner', BANNER_GEO, s * (w / 2 - T - 0.08), F0 + 6.0, a, 0, -s * Math.PI / 2, 0, 0.8, 0.8, 0.8, WHITE, true);
    }
  }
  // Braziers before the dais.
  for (const s of [-1, 1]) {
    const bx = s * 4.4;
    const bz = -7.4;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU;
      F.box('metal', bx + Math.sin(a) * 0.25, F0 + 0.5, bz + Math.cos(a) * 0.25, 0.05, 1.0, 0.05, WHITE, Math.cos(a) * 0.25, 0, -Math.sin(a) * 0.25);
    }
    F.geo('metal', new THREE.CylinderGeometry(0.45, 0.25, 0.3, 10, 1, true), bx, F0 + 1.1, bz);
    F.geo('fire', new THREE.ConeGeometry(0.32, 0.8, 7), bx, F0 + 1.55, bz);
    F.collideCircle(bx, bz, 0.5, F0 - 1, F0 + 2);
  }
  // Iron chandelier on a chain.
  F.geo('metal', new THREE.TorusGeometry(1.4, 0.06, 6, 24), 0, F0 + 7.2, 1, Math.PI / 2, 0, 0);
  F.box('metal', 0, (F0 + 7.2 + beamY) / 2, 1, 0.05, beamY - F0 - 7.2, 0.05);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    F.geo('plaster', new THREE.CylinderGeometry(0.04, 0.04, 0.25, 6), Math.sin(a) * 1.4, F0 + 7.37, 1 + Math.cos(a) * 1.4);
    F.geo('fire', new THREE.ConeGeometry(0.04, 0.12, 5), Math.sin(a) * 1.4, F0 + 7.56, 1 + Math.cos(a) * 1.4);
  }
  // A lectern by the west aisle with the royal chronicle open on it.
  {
    const lx = -5.8;
    const lz = 6;
    const tilt = 0.35;
    F.box('timber', lx, F0 + 0.03, lz, 0.5, 0.06, 0.42, C(0x5a3a26));
    F.box('timber', lx, F0 + 0.55, lz, 0.12, 1.0, 0.12, C(0x5a3a26));
    F.geo('timber', new THREE.BoxGeometry(0.45, 0.04, 0.62).rotateZ(-tilt), lx, F0 + 1.08, lz, 0, 0, 0, 1, 1, 1, C(0x5a3a26));
    for (const side of [-1, 1]) {
      const page = new THREE.PlaneGeometry(0.27, 0.36).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2).rotateZ(-tilt);
      F.geo('parchment', page, lx + 0.008, F0 + 1.106 + 0.004 * side, lz + side * 0.145, 0, 0, 0, 1, 1, 1, WHITE, true);
    }
    F.collideCircle(lx, lz, 0.35, F0 - 1, F0 + 1.5);
    anchor(ctx, 'chronicle', x + lx + 1.0, z + lz, [x + lx, F0 + 1.35, z + lz]);
  }

  // Great doors standing open inward.
  for (const s of [-1, 1]) F.box('planks', s * 1.75, F0 + 2.15, d / 2 - T - 0.95, 0.12, 4.3, 1.75, C(0x6a4a32));

  // Collision: walls (with the door gap), lintel above the door for the camera.
  F.collideBox(0, -d / 2 + T / 2, w / 2, T / 2, F0 - 1, F0 + H + 6);
  for (const s of [-1, 1]) {
    F.collideBox(s * (w / 2 - T / 2), 0, T / 2, d / 2, F0 - 1, F0 + H + 6);
    F.collideBox(s * (w / 4 + 0.9), d / 2 - T / 2, w / 4 - 0.9, T / 2, F0 - 1, F0 + H + 6);
  }
  F.collideBox(0, d / 2 - T / 2, 1.8, T / 2, F0 + 5.6, F0 + H + 6);
  ctx.world.interiors.push({ ...rect(x, z, w / 2 - T, d / 2 - T), ceiling: beamY - 0.3 });
  ctx.world.hallLight = { x, y: F0 + 6.5, z: z + 1 };
  ctx.occupy(rect(x, z, w / 2 + 0.5, d / 2 + 0.5));
}

// ============================================================== the bridge

function buildBridge(ctx) {
  const B = BRIDGE;
  const L = B.zS - B.zN;
  const midZ = (B.zN + B.zS) / 2;
  const deck = (u) => deckHeight(midZ + u);
  const spring = WATER_LEVEL + 0.5;
  const rMid = clamp(deck(0) - spring - 1.2, 2, 3.6);
  const rSide = clamp(deck(10.5) - spring - 1.1, 1.8, 3.1);

  const s = new THREE.Shape();
  s.moveTo(-L / 2, -3.2);
  s.lineTo(L / 2, -3.2);
  for (let i = 0; i <= 24; i++) {
    const u = L / 2 - (i / 24) * L;
    s.lineTo(u, deck(u) - 0.05);
  }
  s.lineTo(-L / 2, -3.2);
  for (const [cu, r] of [[-10.5, rSide], [0, rMid], [10.5, rSide]]) {
    const path = new THREE.Path();
    path.moveTo(cu - r, -3.0);
    path.lineTo(cu + r, -3.0);
    path.lineTo(cu + r, spring);
    path.absarc(cu, spring, r, 0, Math.PI, false);
    path.lineTo(cu - r, -3.0);
    s.holes.push(path);
  }
  const body = extrude(s, B.halfWidth * 2, 14);
  body.rotateY(-Math.PI / 2);
  const F = new Frame(ctx, 0, midZ, 0);
  F.geo('stone', body, 0, 0, 0, 0, 0, 0, 1, 1, 1, TINT.stone);

  // Parapets with copings, following the deck.
  const segs = 22;
  for (let i = 0; i < segs; i++) {
    const u0 = -L / 2 + (i / segs) * L;
    const u1 = -L / 2 + ((i + 1) / segs) * L;
    const um = (u0 + u1) / 2;
    const y = deck(um);
    const slope = Math.atan2(deck(u1) - deck(u0), u1 - u0);
    for (const sx of [-1, 1]) {
      F.box('stone', sx * (B.halfWidth - 0.3), y + 0.5, um, 0.55, 1.1, u1 - u0 + 0.06, TINT.stone, -slope, 0, 0);
      F.box('stone', sx * (B.halfWidth - 0.3), y + 1.1, um, 0.7, 0.14, u1 - u0 + 0.06, TINT.darkStone, -slope, 0, 0);
    }
  }
  // Cutwaters on the piers, both upstream and downstream.
  for (const pu of [-5.5, 5.5]) {
    for (const sx of [-1, 1]) {
      F.box('stone', sx * B.halfWidth, -1.0, pu, 2.6, 4.8, 2.6, TINT.darkStone, 0, Math.PI / 4, 0);
    }
  }
  ribbon(ctx, 'cobbleRoad', ROAD_PATH_BRIDGE, (x, z) => deckHeight(z) + 0.02, [-B.halfWidth + 0.6, 0, B.halfWidth - 0.6], 2.4);
  for (const sx of [-1, 1]) {
    ctx.colliders.addBox(sx * (B.halfWidth - 0.3), midZ, 0.32, L / 2, 0, -10, B.hN + B.rise + 3);
  }
  ctx.world.surfaces.push({ ...rect(0, midZ, B.halfWidth - 0.55, L / 2), height: (lx, lz) => deckHeight(midZ + lz) });
  ctx.lamps.push([-B.halfWidth - 0.9, B.zN - 1.5, Math.PI / 2], [B.halfWidth + 0.9, B.zS + 1.5, -Math.PI / 2]);
  ctx.occupy(rect(0, midZ, B.halfWidth + 0.5, L / 2 + 1));

  // Queen Aldra's founding stone, its inscription facing the road.
  {
    const sx = -B.halfWidth - 1.9;
    const sz = B.zS + 2.6;
    const g = ctx.ground(sx, sz);
    const S = new Frame(ctx, sx, sz, Math.PI / 2);
    S.box('stone', 0, g + 0.25, 0, 1.2, 0.5, 0.75, TINT.darkStone);
    S.box('stone', 0, g + 0.95, 0, 0.95, 1.0, 0.5, TINT.stone);
    S.geo('stone', new THREE.CylinderGeometry(0.475, 0.475, 0.5, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), 0, g + 1.45, 0, 0, 0, 0, 1, 1, 1, TINT.stone);
    S.box('stone', 0, g + 1.0, 0.255, 0.7, 0.62, 0.02, TINT.darkStone);
    ctx.colliders.addCircle(sx, sz, 0.75, g - 1, g + 2);
    ctx.occupy(rect(sx, sz, 0.8, 0.8));
    anchor(ctx, 'bridgeStone', sx + 1.3, sz, [sx + 0.3, g + 1.3, sz]);
  }
}

const ROAD_PATH_BRIDGE = [
  { x: 0, z: BRIDGE.zN },
  ...Array.from({ length: 16 }, (_, i) => ({ x: 0, z: BRIDGE.zN + ((i + 1) / 17) * (BRIDGE.zS - BRIDGE.zN) })),
  { x: 0, z: BRIDGE.zS },
];

// ============================================================== the farms

function buildCart(ctx, x, z, rot) {
  const F = new Frame(ctx, x, z, rot);
  const g = ctx.ground(x, z);
  F.box('planks', 0, g + 0.95, 0, 1.6, 0.12, 2.6, TINT.door);
  for (const s of [-1, 1]) {
    F.box('planks', s * 0.78, g + 1.25, 0, 0.08, 0.5, 2.6, TINT.door);
    F.geo('timber', new THREE.CylinderGeometry(0.55, 0.55, 0.12, 14), s * 0.95, g + 0.55, 0.2, 0, 0, Math.PI / 2, 1, 1, 1, TINT.beam);
    F.box('timber', s * 0.4, g + 0.75, 2.2, 0.08, 0.08, 2.2, TINT.beam, -0.2, 0, 0);
  }
  F.geo('metal', new THREE.CylinderGeometry(0.05, 0.05, 2.0, 6), 0, g + 0.55, 0.2, 0, 0, Math.PI / 2);
  F.collideBox(0, 0.3, 1.0, 1.6, g - 1, g + 1.6);
}

function buildWindmill(ctx) {
  const { x, z } = SITES.windmill;
  const F = new Frame(ctx, x, z, -2.3);
  const g = ctx.ground(x, z);
  F.geo('stone', new THREE.CylinderGeometry(3.6, 3.8, 1.2, 8), 0, g - 0.2, 0, 0, Math.PI / 8, 0, 1, 1, 1, TINT.darkStone);
  F.geo('plaster', new THREE.CylinderGeometry(2.4, 3.3, 9.5, 8), 0, g + 5.1, 0, 0, Math.PI / 8, 0, 1, 1, 1, TINT.plaster[0]);
  F.geo('thatch', new THREE.ConeGeometry(3.0, 3.6, 8, 1, true), 0, g + 11.65, 0, 0, Math.PI / 8, 0);
  const apothem = (yy) => (3.3 - ((yy - 0.35) * 0.9) / 9.5) * Math.cos(Math.PI / 8);
  F.box('planks', 0, g + 1.5, apothem(1.5) + 0.02, 1.2, 2.2, 0.12, TINT.door, -0.095, 0, 0);
  for (const wy of [4.5, 7.5]) F.box('glass', 0, g + wy, apothem(wy) + 0.02, 0.6, 0.8, 0.06, WHITE, -0.095, 0, 0);
  F.box('timber', 0, g + 10.2, 2.4, 0.5, 0.5, 1.6, TINT.beam);
  ctx.colliders.addCircle(x, z, 3.5, g - 2, g + 13);
  ctx.occupy(rect(x, z, 4, 4));

  // The sails are their own object so they can turn.
  const wood = [];
  const cloth = [];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU;
    const arm = (list, w, h, d, ox, oy, oz) => {
      const b = new THREE.BoxGeometry(w, h, d).toNonIndexed();
      b.translate(ox, oy, oz);
      b.rotateZ(a);
      list.push(b);
    };
    arm(wood, 0.22, 7.6, 0.22, 0, 3.8, 0);
    for (let j = 0; j < 6; j++) arm(wood, 1.6, 0.08, 0.08, 0.7, 1.6 + j * 1.15, 0.05);
    arm(wood, 0.08, 6, 0.08, 1.45, 4.5, 0.05);
    arm(cloth, 1.35, 5.8, 0.02, 0.72, 4.5, 0.1);
  }
  const hub = new THREE.CylinderGeometry(0.4, 0.4, 0.6, 10).toNonIndexed();
  hub.rotateX(Math.PI / 2);
  wood.push(hub);
  const woodGeo = mergeGeometries(wood);
  projectUV(woodGeo, 2);
  const clothGeo = mergeGeometries(cloth);
  projectUV(clothGeo, 1.5);
  ctx.world.sails = { geometry: [withColor(woodGeo, TINT.beam), withColor(clothGeo, C(0xe8e0cc))], matrix: F.matrix(0, g + 10.2, 3.35) };
}

function fenceAround(ctx, f, gapSide) {
  const F = new Frame(ctx, f.x, f.z, f.rot);
  const hw = f.w / 2 + 1.2;
  const hd = f.d / 2 + 1.2;
  const sides = [
    { a: [-hw, -hd], b: [hw, -hd], name: 'north' },
    { a: [hw, -hd], b: [hw, hd], name: 'east' },
    { a: [hw, hd], b: [-hw, hd], name: 'south' },
    { a: [-hw, hd], b: [-hw, -hd], name: 'west' },
  ];
  for (const sd of sides) {
    const len = Math.hypot(sd.b[0] - sd.a[0], sd.b[1] - sd.a[1]);
    const dir = [(sd.b[0] - sd.a[0]) / len, (sd.b[1] - sd.a[1]) / len];
    const runs = sd.name === gapSide ? [[0, len / 2 - 2.5], [len / 2 + 2.5, len]] : [[0, len]];
    for (const [s0, s1] of runs) {
      const n = Math.max(1, Math.round((s1 - s0) / 2.4));
      const step = (s1 - s0) / n;
      for (let i = 0; i <= n; i++) {
        const s = s0 + i * step;
        const lx = sd.a[0] + dir[0] * s;
        const lz = sd.a[1] + dir[1] * s;
        const g = F.ground(lx, lz);
        F.inst('fencePost', lx, g, lz, 0, ctx.rng() * TAU, 0, 1, 1, 1);
        if (i < n) {
          const mx = lx + dir[0] * step * 0.5;
          const mz = lz + dir[1] * step * 0.5;
          const gm = F.ground(mx, mz);
          const ry = Math.atan2(dir[0], dir[1]) + Math.PI / 2;
          for (const ry0 of [0.55, 1.0]) F.inst('fenceRail', mx, gm + ry0, mz, 0, ry, 0, step + 0.1, 1, 1);
        }
      }
      const cs = (s0 + s1) / 2;
      const cx = sd.a[0] + dir[0] * cs;
      const cz = sd.a[1] + dir[1] * cs;
      const along = Math.abs(dir[0]) > Math.abs(dir[1]);
      F.collideBox(cx, cz, along ? (s1 - s0) / 2 : 0.12, along ? 0.12 : (s1 - s0) / 2, F.ground(cx, cz) - 1, F.ground(cx, cz) + 1.3);
    }
  }
}

function buildFarm(ctx, q) {
  const { rng } = ctx;
  for (const f of FIELDS) {
    groundPatch(ctx, f.crop === 'cabbage' || f.crop === 'plowed' ? 'soil' : 'soilCrop', rect(f.x, f.z, f.w / 2, f.d / 2, f.rot), 2, 0.05, (lx, lz) => [lx / 3, lz / 3]);
    ctx.occupy(rect(f.x, f.z, f.w / 2 + 1.5, f.d / 2 + 1.5, f.rot));
    fenceAround(ctx, f, f.z > 225 ? 'north' : 'west');
    const F = new Frame(ctx, f.x, f.z, f.rot);
    if (f.crop === 'wheat' || f.crop === 'barley') {
      const sp = q.cropSparse ? 1.15 : 0.82;
      for (let lz = -f.d / 2 + 0.5; lz <= f.d / 2 - 0.5; lz += sp) {
        for (let lx = -f.w / 2 + 0.5; lx <= f.w / 2 - 0.5; lx += sp) {
          const jx = lx + (rng() - 0.5) * sp * 0.5;
          const jz = lz + (rng() - 0.5) * sp * 0.4;
          const s = (f.crop === 'barley' ? 0.72 : 1) * (0.85 + rng() * 0.3);
          F.inst(f.crop, jx, F.ground(jx, jz) + 0.03, jz, 0, rng() * TAU, 0, s * (q.cropSparse ? 1.25 : 1), s, s * (q.cropSparse ? 1.25 : 1), ctx.vary(f.crop === 'barley' ? C(0xb8c070) : C(0xffe2a0), 0.08));
        }
      }
    } else if (f.crop === 'cabbage') {
      for (let lz = -f.d / 2 + 0.8; lz <= f.d / 2 - 0.8; lz += 1.0) {
        for (let lx = -f.w / 2 + 0.8; lx <= f.w / 2 - 0.8; lx += 0.95) {
          const s = 0.8 + rng() * 0.4;
          F.inst('cabbage', lx, F.ground(lx, lz), lz, 0, rng() * TAU, 0, s, s, s, ctx.vary(WHITE, 0.1));
        }
      }
    }
  }
  // Scarecrow in the first wheat field.
  {
    const F = new Frame(ctx, FIELDS[0].x + 4, FIELDS[0].z - 3, 0.4);
    const g = F.ground(0, 0);
    F.box('timber', 0, g + 1.3, 0, 0.12, 2.6, 0.12, TINT.beam);
    F.box('timber', 0, g + 1.9, 0, 1.8, 0.1, 0.1, TINT.beam);
    F.geo('plainCloth', new THREE.CylinderGeometry(0.28, 0.4, 0.95, 8), 0, g + 1.6, 0, 0, 0, 0, 1, 1, 0.7, C(0x6a5a8a));
    F.geo('plainCloth', new THREE.SphereGeometry(0.22, 8, 6), 0, g + 2.35, 0, 0, 0, 0, 1, 1, 1, C(0xd8c49a));
    F.geo('thatch', new THREE.ConeGeometry(0.42, 0.35, 10), 0, g + 2.6, 0);
    F.geo('thatch', new THREE.CylinderGeometry(0.5, 0.5, 0.03, 12), 0, g + 2.45, 0);
  }

  buildHouse(ctx, {
    x: SITES.farmhouse.x, z: SITES.farmhouse.z, rot: Math.PI / 2, w: 10, d: 7.5, floors: 1, style: 'plaster',
    roof: 'thatch', chimney: true, wallTint: TINT.plaster[3], shutter: TINT.shutter[0], heights: [3.0], pitch: 50,
  });
  buildHouse(ctx, {
    x: -30, z: 216, rot: Math.PI, w: 14, d: 9, floors: 1, style: 'planks', roof: 'thatch', door: true,
    wallTint: TINT.natural, heights: [4.4], pitch: 48,
  });
  for (const [hx, hz] of [[-18, 211], [-16, 215.5], [-19, 219.5]]) {
    const F = new Frame(ctx, hx, hz, rng() * TAU);
    const g = ctx.ground(hx, hz);
    F.geo('thatch', new THREE.CylinderGeometry(1.5, 1.7, 1.8, 12), 0, g + 0.9, 0);
    F.geo('thatch', new THREE.ConeGeometry(1.65, 1.9, 12), 0, g + 2.75, 0);
    ctx.colliders.addCircle(hx, hz, 1.7, g - 1, g + 3.5);
    ctx.occupy(rect(hx, hz, 2, 2));
  }
  buildCart(ctx, -14, 205, 1.2);
  ctx.occupy(rect(-14, 205, 1.8, 2));
  {
    const F = new Frame(ctx, -19.4, 196.6, 0.3);
    const g = F.ground(0, 0);
    F.inst('crate', 0, g, 0, 0, 0, 0, 1, 1, 1);
    F.geo('parchment', PAGE_GEO, 0.02, g + 0.706, 0.03, -Math.PI / 2, 0.4, 0, 0.22, 0.3, 1, WHITE, true);
    F.geo('stone', new THREE.IcosahedronGeometry(0.06, 0), 0.08, g + 0.73, -0.02, 0, 0, 0, 1.3, 0.7, 1, TINT.darkStone);
    ctx.colliders.addCircle(-19.4, 196.6, 0.5, g - 1, g + 0.8);
    anchor(ctx, 'letter', -18.4, 196.6, [-19.4, g + 0.95, 196.6]);
  }
  buildWindmill(ctx);
}

// ============================================================== the ruins

function buildRuins(ctx) {
  const { rng } = ctx;
  const R = SITES.ruins;
  const g = ctx.ground(R.x, R.z);
  const segs = 16;
  const rOut = 4.6;
  const T = 1.1;
  const rc = rOut - T / 2;
  const segLen = (TAU * rOut) / segs + 0.12;
  for (let k = 0; k < segs; k++) {
    const a = ((k + 0.5) / segs) * TAU;
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.3) continue; // doorway facing east
    const collapse = 0.5 + 0.5 * Math.cos(a - 2.3);
    const h = 1.2 + (1 - collapse) * 9 * (0.55 + rng() * 0.45);
    const cx = R.x + Math.cos(a) * rc;
    const cz = R.z + Math.sin(a) * rc;
    const rot = -a;
    const F = new Frame(ctx, cx, cz, rot);
    const gb = ctx.ground(cx, cz);
    F.box('stone', 0, (gb - 1 + gb + h) / 2, 0, T, h + 1, segLen, TINT.mossy);
    for (let j = 0; j < 2; j++) {
      const bh = 0.4 + rng() * 0.8;
      F.box('stone', (rng() - 0.5) * 0.3, gb + h + bh / 2 - 0.1, (rng() - 0.5) * segLen * 0.6, T * (0.6 + rng() * 0.3), bh, segLen * (0.3 + rng() * 0.3), TINT.mossy, 0, 0, (rng() - 0.5) * 0.3);
    }
    ctx.colliders.addBox(cx, cz, T / 2, segLen / 2, rot, gb - 2, gb + h + 1);
  }
  // Door jambs and a fallen lintel.
  for (const s of [-1, 1]) {
    const a = s * 0.32;
    const F = new Frame(ctx, R.x + Math.cos(a) * rc, R.z + Math.sin(a) * rc, -a);
    F.box('stone', 0, g + 1.6, 0, T + 0.2, 3.2, 0.6, TINT.darkStone);
  }
  new Frame(ctx, R.x + rOut + 1.8, R.z + 0.6, 0.3).box('stone', 0, g - 0.4, 0, 0.8, 0.6, 2.6, TINT.darkStone, 0.1, 0, 0.05);
  // A broken curtain wall running north-east from the tower.
  for (let k = 0; k < 6; k++) {
    const cx = R.x + 6 + k * 3.1;
    const cz = R.z - 4 - k * 2.2;
    const h = Math.max(0.5, 3.4 - k * 0.55 + rng() * 0.6);
    const F = new Frame(ctx, cx, cz, Math.atan2(3.1, -2.2));
    const gb = ctx.ground(cx, cz);
    F.box('stone', 0, gb + h / 2 - 0.5, 0, 1.0, h + 1, 3.3, TINT.mossy);
    ctx.colliders.addBox(cx, cz, 0.5, 1.65, Math.atan2(3.1, -2.2), gb - 1, gb + h);
  }
  // Rubble.
  for (let k = 0; k < 46; k++) {
    const a = rng() * TAU;
    const d = 5 + rng() * 12;
    const x = R.x + Math.cos(a) * d;
    const z = R.z + Math.sin(a) * d;
    const s = 0.3 + rng() * rng() * 1.2;
    const F = new Frame(ctx, x, z, rng() * TAU);
    F.box('stone', 0, ctx.ground(x, z) + s * 0.2, 0, s * 1.4, s, s, rng() < 0.5 ? TINT.darkStone : TINT.mossy, (rng() - 0.5) * 0.5, 0, (rng() - 0.5) * 0.5);
    if (s > 0.7) ctx.colliders.addCircle(x, z, s * 0.7, -Infinity, Infinity);
  }
  ctx.occupy(rect(R.x, R.z, rOut + 2, rOut + 2));

  // Inside, the prince's standard has been set up again on a pole.
  {
    const px = R.x - 1.6;
    const pz = R.z - 1.2;
    const pg = ctx.ground(px, pz);
    const F = new Frame(ctx, px, pz, 0);
    F.box('timber', 0, pg + 1.7, 0, 0.1, 3.4, 0.1, TINT.beam);
    F.box('timber', 0.06, pg + 3.22, 0, 0.06, 0.06, 1.15, TINT.beam);
    F.geo('standard', new THREE.PlaneGeometry(1.0, 1.5), 0.1, pg + 2.45, 0, 0, Math.PI / 2, 0, 1, 1, 1, WHITE, true);
    ctx.colliders.addCircle(px, pz, 0.15, pg - 1, pg + 3.5);
    anchor(ctx, 'standard', px + 1.6, pz, [px + 0.15, pg + 2.3, pz]);
  }

  // The hermit's camp: a lean-to, a fire ring, a pot and log seats.
  const H = SITES.hermitCamp;
  const F = new Frame(ctx, H.x, H.z, 2.2);
  const hg = ctx.ground(H.x, H.z);
  for (const sx of [-1.4, 1.4]) F.box('timber', sx, hg + 1.0, -1.2, 0.14, 2.0, 0.14, TINT.beam);
  F.box('timber', 0, hg + 2.0, -1.2, 3.2, 0.14, 0.14, TINT.beam);
  F.box('thatch', 0, hg + 1.15, -0.25, 3.4, 0.2, 2.4, WHITE, 0.85, 0, 0);
  F.box('plainCloth', 0, hg + 0.03, -0.3, 2.2, 0.05, 1.6, C(0x6a5440));
  F.collideBox(0, -0.6, 1.6, 0.9, hg - 1, hg + 2.2);
  const fx = 0;
  const fz = 2.2;
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * TAU;
    F.box('stone', fx + Math.sin(a) * 0.65, hg + 0.1, fz + Math.cos(a) * 0.65, 0.3, 0.22, 0.24, TINT.darkStone, 0, a, 0);
  }
  for (const a of [0.3, 1.9, 3.6]) F.geo('timber', new THREE.CylinderGeometry(0.06, 0.07, 0.9, 6), fx + Math.sin(a) * 0.15, hg + 0.18, fz + Math.cos(a) * 0.15, 1.3, a, 0, 1, 1, 1, TINT.beam);
  F.geo('fire', new THREE.ConeGeometry(0.22, 0.55, 6), fx, hg + 0.4, fz);
  for (const s of [-1, 1]) F.box('timber', fx + s * 0.55, hg + 0.6, fz, 0.05, 1.2, 0.05, TINT.beam, 0, 0, s * 0.3);
  F.geo('metal', new THREE.CylinderGeometry(0.22, 0.17, 0.3, 10), fx, hg + 0.85, fz);
  F.collideCircle(fx, fz, 0.8, hg - 1, hg + 1.2);
  ctx.instancesLog.push({ x: H.x + 2.2, z: H.z + 3.4, rot: 0.3, s: 0.45 }, { x: H.x - 2.0, z: H.z + 3.6, rot: 1.4, s: 0.45 });
  ctx.occupy(rect(H.x, H.z + 1, 3.5, 3.5));
}

// ================================================================== ground

// Ribbon of quads along a path, conforming to height(x, z); offsets across the path in metres.
function ribbon(ctx, key, pts, height, offsets, texScale, alphas = null) {
  const cols = offsets.length;
  const n = pts.length;
  const pos = new Float32Array(n * cols * 3);
  const uv = new Float32Array(n * cols * 2);
  const col = new Float32Array(n * cols * 4);
  let arc = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    if (i > 0) arc += Math.hypot(p.x - a.x, p.z - a.z);
    let tx = b.x - a.x;
    let tz = b.z - a.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    for (let c = 0; c < cols; c++) {
      const x = p.x - tz * offsets[c];
      const z = p.z + tx * offsets[c];
      const k = i * cols + c;
      pos[k * 3] = x;
      pos[k * 3 + 1] = height(x, z);
      pos[k * 3 + 2] = z;
      uv[k * 2] = offsets[c] / texScale;
      uv[k * 2 + 1] = arc / texScale;
      col[k * 4] = 1;
      col[k * 4 + 1] = 1;
      col[k * 4 + 2] = 1;
      col[k * 4 + 3] = alphas ? alphas[c] : 1;
    }
  }
  const index = [];
  for (let i = 0; i < n - 1; i++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = i * cols + c;
      const b = a + cols;
      index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  g.setIndex(index);
  g.computeVertexNormals();
  ctx.world.addGround(key, g);
}

// A grid patch inside a rectangle (or any `contains` test), draped over the terrain.
function groundPatch(ctx, key, r, step, lift, uvOf, contains = null) {
  const nx = Math.max(1, Math.ceil((r.hw * 2) / step));
  const nz = Math.max(1, Math.ceil((r.hd * 2) / step));
  const pos = [];
  const uv = [];
  const col = [];
  const ok = [];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const lx = -r.hw + (i / nx) * r.hw * 2;
      const lz = -r.hd + (j / nz) * r.hd * 2;
      const x = r.x + lx * r.cos + lz * r.sin;
      const z = r.z - lx * r.sin + lz * r.cos;
      pos.push(x, ctx.ground(x, z) + lift, z);
      const [u, v] = uvOf(lx, lz, x, z);
      uv.push(u, v);
      col.push(1, 1, 1, 1);
      ok.push(!contains || contains(x, z));
    }
  }
  const index = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + nx + 1;
      if (!(ok[a] && ok[a + 1] && ok[b] && ok[b + 1])) continue;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(index);
  g.computeVertexNormals();
  ctx.world.addGround(key, g);
}

function buildRoads(ctx) {
  ROADS.forEach((road, idx) => {
    const lift = 0.05 + idx * 0.004;
    if (road.kind === 'dirt') {
      const hw = road.w / 2;
      ribbon(ctx, 'dirtRoad', road.pts, (x, z) => ctx.ground(x, z) + lift, [-hw - 1, -hw + 0.6, 0, hw - 0.6, hw + 1], 2.5, [0, 1, 1, 1, 0]);
      return;
    }
    const hw = road.w / 2;
    ribbon(ctx, 'cobbleRoad', road.pts, (x, z) => ctx.ground(x, z) + lift, [-hw, -hw / 2, 0, hw / 2, hw], 2.4);
    // Kerbs, except where they would cut across another street or a square.
    const pts = road.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const rot = Math.atan2(b.x - a.x, b.z - a.z);
      for (const side of [-1, 1]) {
        const mx = (a.x + b.x) / 2 + Math.cos(rot) * side * (hw + 0.12);
        const mz = (a.z + b.z) / 2 - Math.sin(rot) * side * (hw + 0.12);
        if (roadClearance(mx, mz, (r) => r !== road && r.kind === 'cobble') < 0.5) continue;
        if (mx > MARKET.x0 - 1 && mx < MARKET.x1 + 1 && mz > MARKET.z0 - 1 && mz < MARKET.z1 + 1) continue;
        if (Math.hypot(mx - SITES.castle.x, mz - SITES.castle.z) < 31) continue;
        const F = new Frame(ctx, mx, mz, rot);
        const y0 = F.ground(0, -len / 2);
        const y1 = F.ground(0, len / 2);
        F.box('stone', 0, (y0 + y1) / 2 + 0.04, 0, 0.26, 0.2, Math.hypot(len, y1 - y0) + 0.05, TINT.darkStone, -Math.atan2(y1 - y0, len), 0, 0);
      }
    }
  });
  groundPatch(ctx, 'cobbleRoad', rect(0, (MARKET.z0 + MARKET.z1) / 2, (MARKET.x1 - MARKET.x0) / 2, (MARKET.z1 - MARKET.z0) / 2), 2, 0.09, (lx, lz, x, z) => [x / 2.4, z / 2.4]);
  const c = SITES.castle;
  const hall = rect(SITES.hall.x, SITES.hall.z, SITES.hall.w / 2, SITES.hall.d / 2);
  groundPatch(ctx, 'cobbleRoad', rect(c.x, c.z, 31, 31), 2, 0.09, (lx, lz, x, z) => [x / 2.4, z / 2.4], (x, z) => Math.hypot(x - c.x, z - c.z) < 31.5 && !rectContains(hall, x, z, -1.0));
}

// ============================================================= vegetation

function canopyGeometry(rng, blobs, detail, size, lightCol, darkCol) {
  const parts = [];
  for (let i = 0; i < blobs; i++) {
    const g = new THREE.IcosahedronGeometry(1, detail);
    const r = size * (0.5 + rng() * 0.3);
    g.scale(r, r * (0.8 + rng() * 0.2), r);
    g.translate((rng() - 0.5) * size * 0.95, (rng() - 0.35) * size * 0.6, (rng() - 0.5) * size * 0.95);
    g.deleteAttribute('uv');
    parts.push(g);
  }
  const geo = mergeVertices(mergeGeometries(parts));
  const pos = geo.attributes.position;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    minY = Math.min(minY, pos.getY(i));
    maxY = Math.max(maxY, pos.getY(i));
  }
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = hash2(Math.round(x * 100), Math.round(z * 100) + Math.round(y * 100) * 7);
    pos.setXYZ(i, x + (n - 0.5) * size * 0.16, y + (hash2(i, 3) - 0.5) * size * 0.1, z + (hash2(i, 5) - 0.5) * size * 0.16);
    const t = (y - minY) / (maxY - minY || 1);
    c.copy(darkCol).lerp(lightCol, Math.pow(t, 0.8)).multiplyScalar(0.82 + n * 0.3);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

function trunkGeometry(rng, height, r0, r1, branches, segments = 8) {
  const parts = [];
  const t = new THREE.CylinderGeometry(r1, r0, height, segments, 2);
  t.translate(0, height / 2, 0);
  parts.push(t);
  for (let i = 0; i < branches; i++) {
    const b = new THREE.CylinderGeometry(r1 * 0.35, r1 * 0.6, height * 0.45, 5);
    b.translate(0, height * 0.22, 0);
    b.rotateZ(0.7 + rng() * 0.3);
    b.rotateY((i / branches) * TAU + rng());
    b.translate(0, height * (0.65 + rng() * 0.2), 0);
    parts.push(b);
  }
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * height * 0.5);
  return g;
}

function pineGeometry(rng, tiers, segments = 9) {
  const parts = [];
  const span = 5 * 1.45;
  for (let i = 0; i < tiers; i++) {
    const r = 2.5 * (1 - (i * 0.85) / tiers);
    const h = 2.8 * (5 / tiers) ** 0.4;
    const g = new THREE.ConeGeometry(r, h, segments * 2, 1, false);
    const cp = g.attributes.position;
    for (let v = 0; v < cp.count; v++) {
      if (Math.abs(cp.getY(v) + h / 2) > 1e-4) continue;
      const k = Math.round((Math.atan2(cp.getZ(v), cp.getX(v)) / TAU) * segments * 2);
      const tip = ((k % 2) + 2) % 2 === 0;
      cp.setXYZ(v, cp.getX(v) * (tip ? 1.18 : 0.78), cp.getY(v) - (tip ? 0.35 : 0), cp.getZ(v) * (tip ? 1.18 : 0.78));
    }
    g.translate(0, 2.2 + (i * span) / tiers, 0);
    g.deleteAttribute('uv');
    parts.push(g);
  }
  const geo = mergeVertices(mergeGeometries(parts));
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const dark = C(0x1d3a1e);
  const light = C(0x4a7a3a);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = hash2(Math.round(x * 100) + i, Math.round(z * 100));
    pos.setXYZ(i, x * (0.9 + n * 0.2), y + (n - 0.5) * 0.25, z * (0.9 + n * 0.2));
    const tier = span / tiers;
    const tierT = (((y - 2.2 + 1.4) % tier) + tier) % tier / tier;
    c.copy(dark).lerp(light, clamp(tierT * 0.6 + (y / 10) * 0.4, 0, 1)).multiplyScalar(0.85 + n * 0.25);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

// One mesh per tree: bark-coloured trunk plus crown, so a tree costs a single draw per chunk.
function treeGeometry(trunk, crown, crownY, bark) {
  const t = trunk.index ? trunk.toNonIndexed() : trunk.clone();
  t.deleteAttribute('uv');
  withColor(t, bark);
  const c = crown.index ? crown.toNonIndexed() : crown.clone();
  c.translate(0, crownY, 0);
  return mergeGeometries([t, c]);
}

function wheatGeometry() {
  const pos = [];
  const col = [];
  const stem = C(0x9aa04a);
  const head = C(0xe8c060);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU + hash2(k, 3);
    const r = 0.06 + hash2(k, 5) * 0.14;
    const bx = Math.sin(a) * r;
    const bz = Math.cos(a) * r;
    const h = 0.85 + hash2(k, 7) * 0.3;
    const lean = 0.08;
    const tx = bx + Math.sin(a) * lean;
    const tz = bz + Math.cos(a) * lean;
    const w = 0.035;
    const px = Math.cos(a) * w;
    const pz = -Math.sin(a) * w;
    const hy = h * 0.72;
    // Stem quad, then a fatter seed head.
    const quad = (x0, y0, z0, x1, y1, z1, wx, wz, c0, c1) => {
      pos.push(x0 - wx, y0, z0 - wz, x0 + wx, y0, z0 + wz, x1 + wx, y1, z1 + wz, x0 - wx, y0, z0 - wz, x1 + wx, y1, z1 + wz, x1 - wx, y1, z1 - wz);
      for (const cc of [c0, c0, c1, c0, c1, c1]) col.push(cc.r, cc.g, cc.b);
    };
    const mx = lerp(bx, tx, 0.72);
    const mz = lerp(bz, tz, 0.72);
    quad(bx, 0, bz, mx, hy, mz, px * 0.5, pz * 0.5, stem.clone().multiplyScalar(0.6), stem);
    quad(mx, hy, mz, tx, h, tz, px * 1.6, pz * 1.6, head.clone().multiplyScalar(0.85), head);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const n = new Float32Array(pos.length);
  for (let i = 0; i < n.length; i += 3) n[i + 1] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  return g;
}

// ===================================================================== grass

const GRASS_VERT_PARS = /* glsl */ `
uniform sampler2D uHeightMap;
uniform sampler2D uGrassMap;
uniform vec3 uCenter;
uniform float uTile;
uniform float uTime;
uniform float uWorldHalf;
uniform float uHeightTexel;
attribute vec4 aSeed;
`;

const GRASS_VERT_MAIN = /* glsl */ `
vec2 rel = mod(aSeed.xy - uCenter.xz + 0.5 * uTile, uTile) - 0.5 * uTile;
vec2 wxz = uCenter.xz + rel;
vec2 guv = (wxz + uWorldHalf) / (2.0 * uWorldHalf);
vec4 gm = texture2D(uGrassMap, guv);
float fade = 1.0 - smoothstep(uTile * 0.3, uTile * 0.48, length(rel));
float keep = step(aSeed.w, gm.a) * fade;
float s = keep * (0.6 + 0.6 * fract(aSeed.w * 7.13));
float cr = cos(aSeed.z);
float sr = sin(aSeed.z);
vec3 p = vec3(position.x * cr - position.z * sr, position.y, position.x * sr + position.z * cr) * s;
float tip = position.y / 0.5;
float bend = tip * tip;
float gust = sin(uTime * 1.7 + wxz.x * 0.21 + wxz.y * 0.17) * 0.5 + sin(uTime * 3.1 + wxz.x * 0.63 - wxz.y * 0.4) * 0.22;
p.x += gust * 0.2 * bend * s;
p.z += gust * 0.09 * bend * s;
vec2 huv = guv * (1.0 - uHeightTexel) + 0.5 * uHeightTexel;
float ground = texture2D(uHeightMap, huv).r;
vec3 transformed = vec3(wxz.x + p.x, ground + p.y - 0.04, wxz.y + p.z);
vColor.rgb *= gm.rgb;
float fl = fract(aSeed.w * 13.7);
if (fl < 0.02) {
  vec3 bloom = fl < 0.008 ? vec3(0.85, 0.72, 0.2) : fl < 0.014 ? vec3(0.8, 0.8, 0.75) : vec3(0.45, 0.32, 0.7);
  vColor.rgb = mix(vColor.rgb, bloom, step(0.85, tip));
}
`;

function grassBladeGeometry() {
  const pos = [];
  const col = [];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI + hash2(k, 11) * 0.6;
    const ox = (hash2(k, 13) - 0.5) * 0.18;
    const oz = (hash2(k, 17) - 0.5) * 0.18;
    const h = 0.26 + hash2(k, 19) * 0.22;
    const w = 0.04 + hash2(k, 23) * 0.02;
    const lx = Math.cos(a);
    const lz = Math.sin(a);
    const lean = (hash2(k, 29) - 0.5) * 0.25;
    const tipX = ox - lz * lean;
    const tipZ = oz + lx * lean;
    const midX = ox - lz * lean * 0.4;
    const midZ = oz + lx * lean * 0.4;
    const b0 = [ox - lx * w, 0, oz - lz * w];
    const b1 = [ox + lx * w, 0, oz + lz * w];
    const m0 = [midX - lx * w * 0.65, h * 0.55, midZ - lz * w * 0.65];
    const m1 = [midX + lx * w * 0.65, h * 0.55, midZ + lz * w * 0.65];
    const t = [tipX, h, tipZ];
    for (const v of [b0, b1, m1, b0, m1, m0, m0, m1, t]) {
      pos.push(...v);
      const shade = 0.36 + (v[1] / 0.5) * 0.6;
      col.push(shade, shade, shade);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const n = new Float32Array(pos.length);
  for (let i = 0; i < n.length; i += 3) n[i + 1] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  return g;
}

// =========================================================== wind shaders

function windMaterial(material, uTime, amount, key) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 ip = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
        #else
          vec2 ip = vec2(0.0);
        #endif
        float sway = sin(uTime * 1.4 + ip.x * 0.13 + ip.y * 0.09) * 0.7 + sin(uTime * 2.6 + ip.y * 0.31) * 0.3;
        float bendW = max(position.y, 0.0);
        transformed.x += sway * ${amount.toFixed(3)} * bendW;
        transformed.z += sway * ${(amount * 0.6).toFixed(3)} * bendW;`,
      );
  };
  material.customProgramCacheKey = () => key;
  return material;
}

// Trees exist twice (full and low detail); each copy keeps only the instances on its side of
// uLodRadius from the camera, so detail changes per tree rather than per chunk.
function lodMaterial(material, lod, key) {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (previous) previous(shader, renderer);
    shader.uniforms.uLodCenter = lod.uLodCenter;
    shader.uniforms.uLodRadius = lod.uLodRadius;
    const keep = key.endsWith('hi') ? 'dd < uLodRadius' : 'dd >= uLodRadius';
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uLodCenter;\nuniform float uLodRadius;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float dd = distance(instanceMatrix[3].xz, uLodCenter.xz);
        if (!(${keep})) transformed *= 0.0;`,
      );
  };
  material.customProgramCacheKey = () => key;
  return material;
}

// Foliage within a few metres of the camera dissolves (screen-door) so it never fills the view.
function nearFade(material, key) {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (previous) previous(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <clipping_planes_fragment>',
      `#include <clipping_planes_fragment>
      float camD = length(vViewPosition);
      if (camD < 4.5) {
        float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        if (ign > (camD - 1.5) / 3.0) discard;
      }`,
    );
  };
  material.customProgramCacheKey = () => key;
  return material;
}

// Normals stay as authored (up) on both faces, so thin foliage lights like the ground it grows from.
function upNormals(material, key) {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (previous) previous(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      '#include <normal_fragment_begin>\n  normal = normalize( vNormal );',
    );
  };
  material.customProgramCacheKey = () => key;
  return material;
}

// ================================================================ the world

const _ax = new THREE.Vector3();
const _ay = new THREE.Vector3();
const _centre = new THREE.Vector3();
const UV_SCALES = { stone: 3.3, stoneFloor: 3.6, plaster: 3, timber: 1.5, planks: 2, shingle: 2.4, thatch: 2.5, cloth: 1.2, plainCloth: 2, metal: 1, gold: 1, glass: 1, stained: 1, lamp: 1, fire: 1 };
const NO_SHADOW = new Set(['glass', 'stained', 'lamp', 'fire']);

export class World {
  constructor(scene, renderer, quality) {
    this.scene = scene;
    this.renderer = renderer;
    this.quality = quality;
    this.colliders = new Colliders(16);
    this.surfaces = [];
    this.interiors = [];
    // Where the kingdom's secrets lie: { x, y, z } to stand near and a glint point to sparkle at.
    this.anchors = {};
    this.lampHeads = [];
    this.lampLights = [];
    this._lampTimer = 0;
    this._envSig = null;
    this.batch = new Batch(UV_SCALES, 160);
    this.uTime = { value: 0 };
    this.timeOfDay = 9.5;
    this.night = 0;
    this.stats = { houses: 0, trees: 0, meshes: 0 };
    ANISOTROPY = quality.anisotropy;

    this.sky = new SkyDome();
    scene.add(this.sky.mesh);
    this.fog = new THREE.Fog(0xbfd8ee, 90, 700);
    scene.fog = this.fog;
    this.hemi = new THREE.HemisphereLight(0xc0d8f2, 0x5c533c, 0.4);
    scene.add(this.hemi);

    // The one shadow-casting light. It follows the player so the shadow map stays sharp.
    this.sun = new THREE.DirectionalLight(0xfff1dc, 3);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 340;
    this._setShadows(quality);
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);
    this.lightDir = new THREE.Vector3(0, 1, 0);

    // Image-based lighting from the sky.
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), this.sky.envMaterial));
    this.envTarget = null;
    scene.environmentIntensity = 0.9;
  }

  // Generates the world in stages; progress(text) is awaited between them so the page can repaint.
  async build(progress) {
    const q = this.quality;
    const rng = mulberry32(20241);

    await progress('Weaving textures…');
    this._textures(q.textureSize);
    this._materials();

    await progress('Raising the land…');
    this.terrain = new Terrain(TERRAIN_SEGMENTS);
    const terrainMesh = new THREE.Mesh(this.terrain.geometry, this.mat.terrain);
    terrainMesh.name = 'terrain';
    terrainMesh.receiveShadow = true;
    this.scene.add(terrainMesh);
    this._water();
    this.setTime(this.timeOfDay);

    const ctx = new BuildContext(this, rng);
    ctx.flags = [];
    ctx.trees = [];
    ctx.instancesLog = [];

    await progress('Building the town…');
    buildRoads(ctx);
    buildMarket(ctx);
    buildTavern(ctx);
    buildSmithy(ctx);
    buildChapel(ctx);
    buildGraveyard(ctx);
    wallRing(ctx, TOWN_WALL, TOWN_GATES, {
      cx: SITES.town.x, cz: SITES.town.z, H: 6.5, T: 2.2, towerR: 3.3, towerH: 9.5,
      gateW: 4.6, gateTowerW: 5, gateH: 11, spring: 2.6,
      tint: TINT.stone, roofs: (k) => k % 3 !== 1, roofTint: TINT.roof[1], portcullis: false, banners: true,
    });
    this.stats.houses = placeTownHouses(ctx);
    streetLamps(ctx, (r) => r.town, 19);

    await progress('Fortifying the castle…');
    buildCastle(ctx);
    streetLamps(ctx, (r) => r.kind === 'cobble' && !r.town, 26);

    await progress('Spanning the river, tilling the fields…');
    buildBridge(ctx);
    buildFarm(ctx, q);

    await progress('Planting the forest…');
    buildRuins(ctx);
    for (const [x, z, rot] of ctx.lamps) buildLamp(ctx, x, z, rot);
    this._vegetation(ctx, rng, q);
    this._boulders(ctx, mulberry32(1337));

    await progress('Sowing the meadows…');
    this._flags(ctx);
    this._instances(ctx);
    this.stats.meshes = this.batch.build(this.scene, this.mat, NO_SHADOW);
    if (this.sails) this._buildSails();
    if (this.hallLight) {
      this.torchLight = new THREE.PointLight(0xffa860, 40, 28, 2);
      this.torchLight.position.set(this.hallLight.x, this.hallLight.y, this.hallLight.z);
      this.scene.add(this.torchLight);
    }
    this._grass(ctx, q);
    this._setLampLights(q.lampLights);
    this.setTime(this.timeOfDay);
  }

  /*
   * Applies the parts of a quality preset that can change while playing: shadows,
   * grass density, lantern lights and tree detail distance. Textures, tree meshes
   * and crops keep the values the world was built with (this.quality) until the
   * next load. Changing the number of shadows or lights recompiles the lit
   * materials once.
   */
  setQuality(q) {
    this._setShadows(q);
    this._setLampLights(q.lampLights);
    if (this.lod) this.lod.uLodRadius.value = q.lodRadius;
    if (this.grass) this._setGrass(q.grass, q.grassTile);
  }

  // The one shadow map: on or off, its resolution and how far around the player it reaches.
  _setShadows(q) {
    const shadow = this.sun.shadow;
    this.renderer.shadowMap.enabled = q.shadows;
    this.sun.castShadow = q.shadows;
    if (shadow.mapSize.x !== q.shadowMap) {
      shadow.mapSize.set(q.shadowMap, q.shadowMap);
      if (shadow.map) {
        shadow.map.dispose();
        shadow.map = null;
      }
    }
    this.shadowExtent = q.shadowExtent;
    const cam = shadow.camera;
    cam.left = -q.shadowExtent;
    cam.right = q.shadowExtent;
    cam.top = q.shadowExtent;
    cam.bottom = -q.shadowExtent;
    cam.updateProjectionMatrix();
  }

  // A few warm lights follow the player from lantern to lantern after dark.
  _setLampLights(count = 0) {
    const pool = this.lampLights;
    while (pool.length < count) {
      const light = new THREE.PointLight(0xffb468, 0, 15, 2);
      this.scene.add(light);
      pool.push({ light, fade: 0 });
    }
    while (pool.length > count) {
      const { light } = pool.pop();
      this.scene.remove(light);
      light.dispose();
    }
    this._lampTimer = 0;
  }

  // Blade positions within the grass tile that wraps around the player.
  _grassSeeds(count, tile) {
    const seeds = new Float32Array(count * 4);
    const grng = mulberry32(4242);
    for (let i = 0; i < count; i++) {
      seeds[i * 4] = grng() * tile;
      seeds[i * 4 + 1] = grng() * tile;
      seeds[i * 4 + 2] = grng() * TAU;
      seeds[i * 4 + 3] = grng();
    }
    return new THREE.InstancedBufferAttribute(seeds, 4);
  }

  _setGrass(count, tile) {
    const { mesh, uniforms } = this.grass;
    const geo = mesh.geometry;
    if (geo.instanceCount === count && uniforms.uTile.value === tile) return;
    geo.setAttribute('aSeed', this._grassSeeds(count, tile));
    geo.instanceCount = count;
    uniforms.uTile.value = tile;
    // Frees the old buffers; the blade is uploaded again with the new seeds on the next frame.
    geo.dispose();
  }

  // ------------------------------------------------------------ textures

  _textures(S) {
    const half = Math.max(128, S / 2);
    this.tex = {
      stone: makeTexture(S, paintStone(11), 2.2),
      cobble: makeTexture(S, paintCobble(21), 2.6),
      plaster: makeTexture(half, paintPlaster(31), 0.8),
      wood: makeTexture(half, paintWood(41), 1.2),
      planks: makeTexture(S, paintPlanks(51), 2),
      tileRow: makeTexture(half, paintTileRow(61), 2.2),
      shingle: makeTexture(half, paintShingles(71), 2),
      thatch: makeTexture(half, paintThatch(81), 2.4),
      dirt: makeTexture(half, paintDirt(91), 1.6),
      ground: makeTexture(S, paintGround(101), 1.4),
      soil: makeTexture(half, paintSoil(111), 2.4),
      bark: makeTexture(half, paintBark(121), 2.2),
      ripples: makeTexture(half, paintRipples(131), 1.6),
      stripes: makeTexture(128, paintStripes(141), 0.4),
    };
    this.tex.banner = makeBannerTexture();
    this.tex.sign = makeSignTexture();
    this.tex.parchment = makeParchmentTexture();
    this.tex.standard = makeStandardTexture();
  }

  _materials() {
    const T = this.tex;
    const n = (s) => new THREE.Vector2(s, s);
    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...o });
    const cobble = { map: T.cobble.map, normalMap: T.cobble.normal, normalScale: n(1.1), vertexColors: true, roughness: 0.88 };
    this.mat = {
      terrain: std({ map: T.ground.map, normalMap: T.ground.normal, normalScale: n(0.9), vertexColors: true, roughness: 0.97 }),
      stone: std({ map: T.stone.map, normalMap: T.stone.normal, normalScale: n(1.1), vertexColors: true, roughness: 0.92 }),
      plaster: std({ map: T.plaster.map, normalMap: T.plaster.normal, normalScale: n(0.6), vertexColors: true, roughness: 0.96 }),
      timber: std({ map: T.wood.map, normalMap: T.wood.normal, normalScale: n(0.8), vertexColors: true, roughness: 0.85 }),
      planks: std({ map: T.planks.map, normalMap: T.planks.normal, normalScale: n(1), vertexColors: true, roughness: 0.84 }),
      shingle: std({ map: T.shingle.map, normalMap: T.shingle.normal, vertexColors: true, roughness: 0.78, side: THREE.DoubleSide }),
      thatch: std({ map: T.thatch.map, normalMap: T.thatch.normal, normalScale: n(1.3), vertexColors: true, roughness: 1, side: THREE.DoubleSide }),
      cloth: std({ map: T.stripes.map, vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }),
      plainCloth: std({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }),
      metal: std({ color: 0x5c5e63, metalness: 0.8, roughness: 0.45, vertexColors: true }),
      gold: std({ color: 0xd8ae52, metalness: 1, roughness: 0.3, vertexColors: true }),
      glass: std({ color: 0x1a2430, roughness: 0.12, metalness: 0.4, emissive: 0xffa040, emissiveIntensity: 0, vertexColors: true }),
      stained: new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffffff, side: THREE.DoubleSide }),
      lamp: std({ color: 0xfff1d0, roughness: 0.3, emissive: 0xffb050, emissiveIntensity: 0.2, vertexColors: true }),
      fire: std({ color: 0x000000, emissive: 0xff7a28, emissiveIntensity: 3, roughness: 1, vertexColors: true }),
      banner: std({ map: T.banner, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.92, vertexColors: true }),
      sign: std({ map: T.sign, roughness: 0.8, vertexColors: true }),
      parchment: std({ map: T.parchment, roughness: 0.85, vertexColors: true, side: THREE.DoubleSide }),
      standard: std({ map: T.standard, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95, vertexColors: true }),
      soil: std({ map: T.soil.map, normalMap: T.soil.normal, normalScale: n(1.4), vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      soilCrop: std({ map: T.soil.map, normalMap: T.soil.normal, color: 0xb8a070, vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      dirtRoad: std({ map: T.dirt.map, normalMap: T.dirt.normal, vertexColors: true, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
      cobbleRoad: std({ ...cobble, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
      tile: std({ map: T.tileRow.map, normalMap: T.tileRow.normal, roughness: 0.75 }),
      bark: std({ map: T.bark.map, normalMap: T.bark.normal, roughness: 0.95 }),
      leaves: nearFade(windMaterial(std({ vertexColors: true, roughness: 0.82 }), this.uTime, 0.012, 'wind-leaves'), 'leaves-fade'),
      crop: upNormals(windMaterial(std({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }), this.uTime, 0.07, 'wind-crop'), 'wind-crop-up'),
      cabbage: std({ color: 0x6f9a48, roughness: 0.75 }),
      rock: std({ map: T.ground.map, normalMap: T.ground.normal, normalScale: n(1.6), roughness: 0.95 }),
    };
    this.mat.stoneFloor = this.mat.stone;
    const foliage = (amount, key) => nearFade(windMaterial(std({ vertexColors: true, roughness: 0.85 }), this.uTime, amount, `${key}-wind`), `${key}-fade`);
    this.lod = { uLodCenter: { value: new THREE.Vector3() }, uLodRadius: { value: this.quality.lodRadius } };
    this.mat.leavesHi = lodMaterial(foliage(0.012, 'leaves-hi'), this.lod, 'leaves-lod-hi');
    this.mat.leavesLo = lodMaterial(foliage(0.012, 'leaves-lo'), this.lod, 'leaves-lod-lo');
    this.mat.needlesHi = lodMaterial(foliage(0.006, 'needles-hi'), this.lod, 'needles-lod-hi');
    this.mat.needlesLo = lodMaterial(foliage(0.006, 'needles-lod-lo'), this.lod, 'needles-lod-lo');
    // Tile courses are instanced unit strips: stretch the texture with each instance's length.
    this.mat.tile.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        float courseLen = length(instanceMatrix[0].xyz);
        vMapUv.x *= courseLen * 0.5;
        vNormalMapUv.x *= courseLen * 0.5;`,
      );
    };
    this.mat.tile.customProgramCacheKey = () => 'tile-course';
  }

  // --------------------------------------------------------------- water

  _water() {
    const geometry = new THREE.PlaneGeometry(WORLD_HALF * 2, 116, 200, 28);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, WATER_LEVEL, 128);
    const uv = geometry.attributes.uv;
    const pos = geometry.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 14, pos.getZ(i) / 14);
    const normalMap = this.tex.ripples.normal;
    const material = new THREE.MeshStandardMaterial({
      color: 0x1f4a57,
      roughness: 0.07,
      metalness: 0,
      normalMap,
      normalScale: new THREE.Vector2(0.5, 0.5),
      transparent: true,
      opacity: 0.88,
    });
    const uTime = this.uTime;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          transformed.y += sin(position.x * 0.42 + uTime * 1.5) * 0.04
                         + sin(position.z * 0.66 - uTime * 1.1 + position.x * 0.13) * 0.035;`,
        );
    };
    material.customProgramCacheKey = () => 'river';
    this.water = new THREE.Mesh(geometry, material);
    this.water.name = 'river';
    this.water.receiveShadow = true;
    this.scene.add(this.water);
  }

  // Ground-hugging meshes (roads, squares, fields) are kept separate from the batch.
  addGround(key, geometry) {
    const mesh = new THREE.Mesh(geometry, this.mat[key]);
    mesh.name = key;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = key === 'dirtRoad' ? 1 : 0;
    this.scene.add(mesh);
  }

  // ---------------------------------------------------------- instances

  _instances(ctx) {
    const geos = instanceGeometries();
    const kinds = {
      tile: [geos.tile, this.mat.tile, true],
      stallWood: [geos.stallWood, this.mat.planks, true],
      stallAwning: [geos.stallAwning, this.mat.cloth, true],
      stallGoods: [geos.stallGoods, this.mat.plainCloth, true],
      barrel: [geos.barrel, this.mat.timber, true],
      crate: [geos.crate, this.mat.planks, true],
      fencePost: [geos.fencePost, this.mat.timber, true],
      fenceRail: [geos.fenceRail, this.mat.timber, true],
      tomb: [geos.tomb, this.mat.stone, true],
      cross: [geos.cross, this.mat.stone, true],
      wheat: [geos.wheat, this.mat.crop, false],
      barley: [geos.wheat, this.mat.crop, false],
      cabbage: [geos.cabbage, this.mat.cabbage, false],
    };
    const chunked = new Set(['tile', 'wheat', 'barley', 'cabbage']);
    for (const [kind, list] of ctx.instances) {
      const spec = kinds[kind];
      if (spec) makeInstanced(this.scene, list, spec[0], spec[1], spec[2], kind, null, chunked.has(kind) ? CHUNK : Infinity);
    }
  }

  _flags(ctx) {
    const geo = new THREE.PlaneGeometry(1.4, 2.2, 8, 8);
    geo.translate(0.7, -1.1, 0);
    const material = new THREE.MeshStandardMaterial({ map: this.tex.banner, side: THREE.DoubleSide, roughness: 0.9, alphaTest: 0.5 });
    const uTime = this.uTime;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float fw = position.x / 1.4;
          transformed.z += sin(uTime * 4.0 - position.x * 3.0 + position.y * 0.8) * 0.2 * fw;`,
        );
    };
    material.customProgramCacheKey = () => 'flag';
    for (const f of ctx.flags) {
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.set(f.x + 0.1, f.y, f.z);
      mesh.rotation.y = f.rot + 0.6;
      mesh.scale.setScalar(f.scale);
      mesh.castShadow = true;
      this.scene.add(mesh);
    }
  }

  _buildSails() {
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    group.matrix.copy(this.sails.matrix);
    const spinner = new THREE.Group();
    const wood = new THREE.Mesh(this.sails.geometry[0], this.mat.timber);
    const cloth = new THREE.Mesh(this.sails.geometry[1], this.mat.plainCloth);
    wood.castShadow = cloth.castShadow = true;
    spinner.add(wood, cloth);
    group.add(spinner);
    this.scene.add(group);
    this.sailSpinner = spinner;
  }

  // -------------------------------------------------------- vegetation

  _canPlant(ctx, x, z, pad) {
    const h = this.terrain.getHeight(x, z);
    if (h < WATER_LEVEL + 0.5) return false;
    if (pointInPolygon(x, z, TOWN_WALL) || distToPolygonEdge(x, z, TOWN_WALL) < 5) return false;
    if (Math.hypot(x - SITES.castle.x, z - SITES.castle.z) < 46) return false;
    if (Math.hypot(x - SITES.ruins.x, z - SITES.ruins.z) < 14) return false;
    if (Math.abs(x) < BRIDGE.halfWidth + 4 && z > BRIDGE.zN - 4 && z < BRIDGE.zS + 4) return false;
    if (ctx.occupied(x, z, pad)) return false;
    if (roadClearance(x, z) < pad) return false;
    const g = Math.hypot(this.terrain.getHeight(x + 1, z) - h, this.terrain.getHeight(x, z + 1) - h);
    return g < 0.9;
  }

  _vegetation(ctx, rng, q) {
    const vrng = mulberry32(777);
    const detail = q.treeDetail;
    const bark = C(0x5a4636);
    const oakLight = C(0x6a9a40);
    const oakDark = C(0x24401a);
    const kinds = {
      oakA: {
        hi: treeGeometry(trunkGeometry(vrng, 3.6, 0.42, 0.24, 3, 7), canopyGeometry(vrng, detail ? 5 : 4, detail, 2.9, oakLight, oakDark), 4.6, bark),
        lo: treeGeometry(trunkGeometry(vrng, 3.6, 0.42, 0.24, 0, 4), canopyGeometry(vrng, 3, 0, 2.9, oakLight, oakDark), 4.6, bark),
      },
      oakB: {
        hi: treeGeometry(trunkGeometry(vrng, 3.1, 0.36, 0.2, 2, 7), canopyGeometry(vrng, detail ? 4 : 3, detail, 2.4, C(0x7aa848), C(0x2a4a1e)), 3.9, bark),
        lo: treeGeometry(trunkGeometry(vrng, 3.1, 0.36, 0.2, 0, 4), canopyGeometry(vrng, 2, 0, 2.4, C(0x7aa848), C(0x2a4a1e)), 3.9, bark),
      },
      pine: {
        hi: treeGeometry(trunkGeometry(vrng, 3.2, 0.3, 0.16, 0, 6), pineGeometry(vrng, 5, detail ? 9 : 7), 0, bark),
        lo: treeGeometry(trunkGeometry(vrng, 3.2, 0.3, 0.16, 0, 4), pineGeometry(vrng, 3, 6), 0, bark),
      },
    };
    const bushGeo = canopyGeometry(vrng, 3, 0, 0.9, C(0x5e8a38), C(0x22381a));
    bushGeo.translate(0, 0.55, 0);
    const lists = { oakA: [], oakB: [], pine: [], bush: [], log: [], stump: [] };
    const place = (kind, x, z, s, rot) => {
      const h = this.terrain.getHeight(x, z);
      const m = new THREE.Matrix4().compose(_p.set(x, h - 0.15, z), _q.setFromAxisAngle(UP, rot), _s.set(s, s * (0.9 + vrng() * 0.25), s));
      lists[kind].push({ m, c: ctx.vary(WHITE, 0.12) });
      if (Math.max(Math.abs(x), Math.abs(z)) < PLAY_HALF + 3 && kind !== 'bush') {
        this.colliders.addCircle(x, z, (kind === 'pine' ? 0.3 : 0.42) * s, h - 1, h + 3.5);
      }
    };

    for (const t of ctx.trees) place(t.kind, t.x, t.z, t.s, vrng() * TAU);
    const step = 7.5;
    for (let gx = -395; gx < 395; gx += step) {
      for (let gz = -395; gz < 395; gz += step) {
        const x = gx + vrng() * step;
        const z = gz + vrng() * step;
        const edge = Math.max(Math.abs(x), Math.abs(z));
        const forest = forestDensity(x, z);
        const h = this.terrain.getHeight(x, z);
        const dr = Math.abs(z - riverZ(x));
        // Pines climb the lower mountain slopes but stop well short of the ridges.
        const mountain = smoothstep(285, 320, edge) * (1 - smoothstep(34, 44, h)) * (edge < 372 ? 1 : 0);
        let p = forest * 0.9;
        if (dr > 19 && dr < 32) p = Math.max(p, 0.1);
        if (edge < 300) p = Math.max(p, 0.014);
        p = Math.max(p, mountain * 0.5);
        if (vrng() > p) continue;
        if (!this._canPlant(ctx, x, z, 2.5)) continue;
        const pineChance = mountain > 0.3 ? 0.9 : forest > 0.5 ? 0.4 : 0.12;
        const kind = vrng() < pineChance ? 'pine' : vrng() < 0.5 ? 'oakA' : 'oakB';
        place(kind, x, z, 0.8 + vrng() * 0.5, vrng() * TAU);
        if (forest > 0.25 && vrng() < 0.45) {
          const bx = x + (vrng() - 0.5) * 6;
          const bz = z + (vrng() - 0.5) * 6;
          if (this._canPlant(ctx, bx, bz, 1.5)) place('bush', bx, bz, 0.8 + vrng() * 0.8, vrng() * TAU);
        }
        if (forest > 0.6 && vrng() < 0.04) {
          const lx = x + 3;
          const lz = z + 1;
          if (this._canPlant(ctx, lx, lz, 2)) {
            const hh = this.terrain.getHeight(lx, lz);
            lists.log.push({ m: new THREE.Matrix4().compose(_p.set(lx, hh + 0.2, lz), _q.setFromEuler(_e.set(0, vrng() * TAU, Math.PI / 2, 'YXZ')), _s.set(1, 1, 1)), c: null });
            this.colliders.addCircle(lx, lz, 1.2, hh - 1, hh + 0.8);
          }
        } else if (forest > 0.4 && vrng() < 0.05) {
          const hh = this.terrain.getHeight(x + 2, z + 2);
          lists.stump.push({ m: new THREE.Matrix4().makeTranslation(x + 2, hh + 0.2, z + 2), c: null });
        }
      }
    }
    for (const lg of ctx.instancesLog) {
      const hh = this.terrain.getHeight(lg.x, lg.z);
      lists.log.push({ m: new THREE.Matrix4().compose(_p.set(lg.x, hh + 0.12, lg.z), _q.setFromEuler(_e.set(0, lg.rot, Math.PI / 2, 'YXZ')), _s.set(lg.s * 1.2, lg.s, lg.s * 1.2)), c: null });
    }

    this.lods = [];
    for (const kind of ['oakA', 'oakB', 'pine']) {
      const pine = kind === 'pine';
      makeInstanced(this.scene, lists[kind], kinds[kind].hi, pine ? this.mat.needlesHi : this.mat.leavesHi, true, `${kind}-hi`, this.lods, 64);
      makeInstanced(this.scene, lists[kind], kinds[kind].lo, pine ? this.mat.needlesLo : this.mat.leavesLo, false, `${kind}-lo`, null, 256);
    }
    makeInstanced(this.scene, lists.bush, bushGeo, this.mat.leaves, true, 'bushes', null, 256);
    makeInstanced(this.scene, lists.log, new THREE.CylinderGeometry(0.32, 0.36, 4.2, 9), this.mat.bark, true, 'logs', null, Infinity);
    makeInstanced(this.scene, lists.stump, new THREE.CylinderGeometry(0.38, 0.48, 0.6, 9), this.mat.bark, true, 'stumps', null, Infinity);
    this.stats.trees = lists.oakA.length + lists.oakB.length + lists.pine.length;
  }

  _boulders(ctx, rng) {
    const geometry = rockGeometry();
    const list = [];
    for (let tries = 0; list.length < 110 && tries < 5000; tries++) {
      let x;
      let z;
      if (rng() < 0.3) {
        const a = rng() * TAU;
        const d = 16 + rng() * 55;
        x = SITES.ruins.x + Math.cos(a) * d;
        z = SITES.ruins.z + Math.sin(a) * d;
      } else {
        x = (rng() * 2 - 1) * (PLAY_HALF - 5);
        z = (rng() * 2 - 1) * (PLAY_HALF - 5);
      }
      if (!this.isOpenGround(x, z) || ctx.occupied(x, z, 2)) continue;
      const size = 0.45 + rng() * rng() * 2.4;
      const sx = size * (0.8 + rng() * 0.5);
      const sy = size * (0.55 + rng() * 0.45);
      const sz = size * (0.8 + rng() * 0.5);
      const h = this.terrain.getHeight(x, z);
      const m = new THREE.Matrix4().compose(_p.set(x, h + 0.05 * sy, z), _q.setFromEuler(_e.set((rng() - 0.5) * 0.4, rng() * TAU, (rng() - 0.5) * 0.4)), _s.set(sx, sy, sz));
      list.push({ m, c: ROCK_TINTS[Math.floor(rng() * ROCK_TINTS.length)].clone().multiplyScalar(0.85 + rng() * 0.2) });
      if (size > 0.7) this.colliders.addCircle(x, z, Math.max(sx, sz) * 0.85, h - 1, h + sy);
    }
    makeInstanced(this.scene, list, geometry, this.mat.rock, true, 'boulders', null, Infinity);
    this.boulderCount = list.length;
  }

  // ------------------------------------------------------------- grass

  _grass(ctx, q) {
    const t = this.terrain;
    const n = t.row;
    const hdata = new Uint16Array(n * n);
    for (let k = 0; k < n * n; k++) hdata[k] = THREE.DataUtils.toHalfFloat(t.heights[k]);
    const heightTex = new THREE.DataTexture(hdata, n, n, THREE.RedFormat, THREE.HalfFloatType);
    heightTex.magFilter = THREE.LinearFilter;
    heightTex.minFilter = THREE.LinearFilter;
    heightTex.needsUpdate = true;

    // Density mask: paint exclusions with the 2D canvas, then fold in water, slope and rock.
    const S = 512;
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const g = canvas.getContext('2d');
    const px = (v) => ((v + WORLD_HALF) / (WORLD_HALF * 2)) * S;
    const scale = S / (WORLD_HALF * 2);
    g.fillStyle = '#fff';
    g.fillRect(0, 0, S, S);
    g.fillStyle = '#000';
    g.strokeStyle = '#000';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.globalAlpha = 0.72;
    g.beginPath();
    TOWN_WALL.forEach(([x, z], i) => (i ? g.lineTo(px(x), px(z)) : g.moveTo(px(x), px(z))));
    g.closePath();
    g.fill();
    g.globalAlpha = 1;
    for (const r of ROADS) {
      g.lineWidth = (r.w + 1) * scale;
      g.beginPath();
      r.pts.forEach((p, i) => (i ? g.lineTo(px(p.x), px(p.z)) : g.moveTo(px(p.x), px(p.z))));
      g.stroke();
    }
    for (const f of ctx.footprints) {
      g.save();
      g.translate(px(f.x), px(f.z));
      g.rotate(-f.rot);
      g.fillRect(-f.hw * scale, -f.hd * scale, f.hw * 2 * scale, f.hd * 2 * scale);
      g.restore();
    }
    const img = g.getImageData(0, 0, S, S).data;
    const data = new Uint8Array(S * S * 4);
    const col = [0, 0, 0];
    for (let j = 0; j < S; j++) {
      const z = -WORLD_HALF + ((j + 0.5) / S) * WORLD_HALF * 2;
      for (let i = 0; i < S; i++) {
        const x = -WORLD_HALF + ((i + 0.5) / S) * WORLD_HALF * 2;
        const k = j * S + i;
        const h = t.getHeight(x, z);
        const slope = Math.hypot(t.getHeight(x + 1.5, z) - h, t.getHeight(x, z + 1.5) - h) / 1.5;
        let d = img[k * 4] / 255;
        d *= smoothstep(WATER_LEVEL + 0.15, WATER_LEVEL + 0.6, h);
        d *= 1 - smoothstep(0.55, 0.85, slope);
        d *= 1 - smoothstep(36, 46, h);
        d *= 1 - forestDensity(x, z) * 0.45;
        t.colourAt(x, z, col);
        data[k * 4] = clamp(col[0] * 0.95, 0, 1) * 255;
        data[k * 4 + 1] = clamp(col[1] * 1.0, 0, 1) * 255;
        data[k * 4 + 2] = clamp(col[2] * 0.9, 0, 1) * 255;
        data[k * 4 + 3] = clamp(d, 0, 1) * 255;
      }
    }
    const grassTex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
    grassTex.magFilter = THREE.LinearFilter;
    grassTex.minFilter = THREE.LinearFilter;
    grassTex.needsUpdate = true;

    const blade = grassBladeGeometry();
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', blade.attributes.position);
    geo.setAttribute('normal', blade.attributes.normal);
    geo.setAttribute('color', blade.attributes.color);
    geo.setAttribute('aSeed', this._grassSeeds(q.grass, q.grassTile));
    geo.instanceCount = q.grass;

    const uniforms = {
      uHeightMap: { value: heightTex },
      uGrassMap: { value: grassTex },
      uCenter: { value: new THREE.Vector3() },
      uTile: { value: q.grassTile },
      uTime: this.uTime,
      uWorldHalf: { value: WORLD_HALF },
      uHeightTexel: { value: 1 / n },
    };
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${GRASS_VERT_PARS}`)
        .replace('#include <begin_vertex>', GRASS_VERT_MAIN);
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\n  normal = normalize( vNormal );',
      );
    };
    material.customProgramCacheKey = () => 'grass';
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.name = 'grass';
    this.scene.add(mesh);
    this.grass = { mesh, uniforms };
  }

  // ------------------------------------------------------------- queries

  getHeight(x, z) {
    return this.terrain.getHeight(x, z);
  }

  // Height an actor stands at: the terrain, or a walkable structure above it.
  getGroundHeight(x, z) {
    let h = this.terrain.getHeight(x, z);
    for (const s of this.surfaces) {
      const [lx, lz] = rectLocal(s, x, z);
      if (Math.abs(lx) <= s.hw && Math.abs(lz) <= s.hd) h = Math.max(h, s.height(lx, lz));
    }
    return h;
  }

  _onSurface(x, z) {
    for (const s of this.surfaces) if (rectContains(s, x, z)) return true;
    return false;
  }

  waterDepth(x, z) {
    return WATER_LEVEL - this.getGroundHeight(x, z);
  }

  // Whether an actor may step from (x0, z0) to (x1, z1): no deep water, no cliffs; stairs are fine.
  canStep(x0, z0, x1, z1) {
    const g0 = this.getGroundHeight(x0, z0);
    const g1 = this.getGroundHeight(x1, z1);
    const depth1 = WATER_LEVEL - g1;
    if (depth1 > MAX_WADE_DEPTH && depth1 >= WATER_LEVEL - g0) return false;
    const rise = g1 - g0;
    if (rise <= 0) return true;
    if (rise <= STEP_UP && (this._onSurface(x1, z1) || this._onSurface(x0, z0))) return true;
    const run = Math.hypot(x1 - x0, z1 - z0);
    return run < 1e-5 || rise / run <= MAX_GRADE;
  }

  // Lowest ceiling above (x, z), for keeping the camera inside roofed rooms.
  ceilingAt(x, z) {
    let c = Infinity;
    for (const r of this.interiors) if (rectContains(r, x, z)) c = Math.min(c, r.ceiling);
    return c;
  }

  cameraBlocked(x, y, z, pad) {
    return this.colliders.contains(x, y, z, pad);
  }

  // True where nothing is planned: keeps loose props off roads, the river and settlements.
  isOpenGround(x, z) {
    const { castle, town, farmland, ruins } = SITES;
    if (Math.hypot(x - town.x, z - town.z) < town.r + 26) return false;
    if (Math.hypot(x - castle.x, z - castle.z) < castle.r + 34) return false;
    if (roadClearance(x, z) < 4) return false;
    if (Math.abs(z - riverZ(x)) < 24) return false;
    if (Math.max(Math.abs(x - farmland.x) / farmland.hw, Math.abs(z - farmland.z) / farmland.hd) < 1.15) return false;
    if (Math.hypot(x - ruins.x, z - ruins.z) < 15) return false;
    return this.getHeight(x, z) < 40;
  }

  // -------------------------------------------------------- time of day

  // Moves the clock on: a day takes DAY_MINUTES, the night half as long again.
  advanceTime(dt) {
    const rate = (24 / (DAY_MINUTES * 60)) * (1 + this.night);
    this.setTime(this.timeOfDay + dt * rate, false);
  }

  // refreshSky: rebuild the image-based lighting now; otherwise only when the hour has moved on.
  setTime(hours, refreshSky = true) {
    const h = ((hours % 24) + 24) % 24;
    this.timeOfDay = h;

    let i = 0;
    while (i < SKY_KEYS.length - 2 && SKY_KEYS[i + 1].t <= h) i++;
    const a = SKY_KEYS[i];
    const b = SKY_KEYS[i + 1];
    const t = smoothstep(0, 1, (h - a.t) / (b.t - a.t));

    const u = this.sky.uniforms;
    u.uZenith.value.copy(a.zenith).lerp(b.zenith, t);
    u.uHorizon.value.copy(a.horizon).lerp(b.horizon, t);
    u.uSunColor.value.copy(a.sun).lerp(b.sun, t);
    u.uStars.value = lerp(a.stars, b.stars, t);
    this.fog.color.copy(u.uHorizon.value);
    this.hemi.color.copy(a.hemiSky).lerp(b.hemiSky, t);
    this.hemi.groundColor.copy(a.hemiGround).lerp(b.hemiGround, t);
    this.hemi.intensity = lerp(a.hemi, b.hemi, t);

    // The sun rises in the east (+X), culminates in the south (+Z) and sets in the west.
    const angle = ((h - 6) / 12) * Math.PI;
    const sunDir = u.uSunDir.value.set(
      Math.cos(angle),
      Math.sin(angle) * Math.cos(SUN_TILT),
      Math.sin(angle) * Math.sin(SUN_TILT),
    ).normalize();
    const moonDir = u.uMoonDir.value.copy(sunDir).negate();
    u.uSunVis.value = smoothstep(-0.12, 0.02, sunDir.y);
    u.uMoonVis.value = smoothstep(-0.02, 0.12, moonDir.y);

    // Sun by day, moon by night; the light never drops below ~12° so shadows stay usable.
    const day = sunDir.y > -0.03;
    const src = day ? sunDir : moonDir;
    this.lightDir.set(src.x, Math.max(src.y, 0.2), src.z).normalize();
    this.sun.color.copy(a.light).lerp(b.light, t);
    this.sun.intensity = day ? 3.2 * smoothstep(-0.03, 0.14, sunDir.y) : 0.6 * smoothstep(0.03, 0.3, moonDir.y);

    // Lanterns and windows glow after dusk; stained glass dims.
    this.night = 1 - smoothstep(-0.08, 0.1, sunDir.y);
    if (this.mat) {
      this.mat.lamp.emissiveIntensity = 0.2 + this.night * 3.2;
      this.mat.glass.emissiveIntensity = this.night * 0.9;
      this.mat.stained.color.setScalar(lerp(1.0, 0.25, this.night));
    }
    // Rebuild the sky lighting only when the sky has visibly changed: often at dawn
    // and dusk, rarely at noon or midnight.
    const sig = [...u.uZenith.value.toArray(), ...u.uHorizon.value.toArray(), this.hemi.intensity * 0.2, this.sun.intensity * 0.05];
    const change = this._envSig ? sig.reduce((sum, v, i) => sum + Math.abs(v - this._envSig[i]), 0) : Infinity;
    if (this.terrain && (refreshSky || change > 0.08)) {
      this._envSig = sig;
      this._updateEnvironment();
    }
  }

  _updateEnvironment() {
    const target = this.pmrem.fromScene(this.envScene, 0, 0.1, 100);
    if (this.envTarget) this.envTarget.dispose();
    this.envTarget = target;
    this.scene.environment = target.texture;
  }

  // --------------------------------------------------------------- frame

  update(dt, focus, camera) {
    this.uTime.value += dt;
    const t = this.uTime.value;
    this.sky.mesh.position.copy(camera.position);
    if (this.water) this.water.material.normalMap.offset.set(t * 0.012, t * 0.03);
    if (this.grass) this.grass.uniforms.uCenter.value.copy(focus);
    if (this.sailSpinner) this.sailSpinner.rotation.z -= dt * 0.55;
    if (this.mat) this.mat.fire.emissiveIntensity = 2.6 + Math.sin(t * 13) * 0.35 + Math.sin(t * 7.3) * 0.25;
    if (this.torchLight) this.torchLight.intensity = 38 + Math.sin(t * 11) * 4 + Math.sin(t * 5.7) * 3;
    if (this.lods) this.updateLods(camera.position);
    this._updateLampLights(dt, focus, t);
    this._placeSun(focus);
  }

  // Hands the pooled lights to the lanterns nearest the player; they fade in at dusk.
  _updateLampLights(dt, focus, t) {
    const pool = this.lampLights;
    if (!pool.length) return;
    this._lampTimer -= dt;
    if (this._lampTimer <= 0 && this.night > 0.01) {
      this._lampTimer = 0.5;
      const near = this.lampHeads
        .map((p) => ({ p, d: p.distanceToSquared(focus) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, pool.length);
      pool.forEach((slot, i) => {
        const pick = near[i];
        if (!pick) return;
        if (!slot.light.position.equals(pick.p)) {
          slot.light.position.copy(pick.p);
          slot.fade = 0;
        }
      });
    }
    for (const slot of pool) {
      const d = slot.light.position.distanceTo(focus);
      slot.fade = Math.min(1, slot.fade + dt * 1.5);
      const flicker = 1 + Math.sin(t * 9 + slot.light.position.x) * 0.05;
      slot.light.intensity = this.night * 9 * slot.fade * flicker * (1 - smoothstep(32, 45, d));
    }
  }

  // ----------------------------------------------------------------- map

  /*
   * Paints a parchment map of the whole terrain (size x size pixels, north up):
   * hill-shaded land in the terrain's own colours, the river, forests as tree
   * marks, fields, and every wall and building as the colliders know them.
   */
  paintMap(size = 1024) {
    const R = 320;
    const span = WORLD_HALF * 2;
    const raster = document.createElement('canvas');
    raster.width = raster.height = R;
    const rg = raster.getContext('2d');
    const img = rg.createImageData(R, R);
    const d = img.data;
    const col = [0, 0, 0];
    const paper = [0.93, 0.86, 0.7];
    const water = [0.42, 0.58, 0.68];
    const T = this.terrain;
    const srgb = (v) => Math.pow(clamp(v, 0, 1), 1 / 2.2);
    for (let j = 0; j < R; j++) {
      const z = -WORLD_HALF + ((j + 0.5) / R) * span;
      for (let i = 0; i < R; i++) {
        const x = -WORLD_HALF + ((i + 0.5) / R) * span;
        T.colourAt(x, z, col);
        const h = T.getHeight(x, z);
        const hx = T.getHeight(x + 2.5, z) - T.getHeight(x - 2.5, z);
        const hz = T.getHeight(x, z + 2.5) - T.getHeight(x, z - 2.5);
        const shade = clamp(1 + (-hx - hz) * 0.06, 0.62, 1.25);
        const wet = 1 - smoothstep(WATER_LEVEL - 0.6, WATER_LEVEL + 0.05, h);
        const k = (j * R + i) * 4;
        for (let ch = 0; ch < 3; ch++) {
          let v = srgb(col[ch]) * 0.55 + paper[ch] * 0.45;
          v = v * shade;
          v += (water[ch] - v) * wet;
          d[k + ch] = clamp(v, 0, 1) * 255;
        }
        d[k + 3] = 255;
      }
    }
    rg.putImageData(img, 0, 0);

    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(raster, 0, 0, size, size);
    const s = size / span;
    const X = (x) => (x + WORLD_HALF) * s;
    const box = (r, fill, stroke, min = 0) => {
      g.save();
      g.translate(X(r.x), X(r.z));
      g.rotate(-r.rot);
      g.fillStyle = fill;
      g.fillRect(-Math.max(r.hw * s, min), -Math.max(r.hd * s, min), Math.max(r.hw * s, min) * 2, Math.max(r.hd * s, min) * 2);
      if (stroke) {
        g.strokeStyle = stroke;
        g.lineWidth = 1;
        g.strokeRect(-r.hw * s, -r.hd * s, r.hw * s * 2, r.hd * s * 2);
      }
      g.restore();
    };

    // Forests: little tree marks where the woods are thick.
    const rand = mulberry32(17);
    g.fillStyle = 'rgba(48,72,40,0.55)';
    for (let z = -WORLD_HALF; z < WORLD_HALF; z += 5) {
      for (let x = -WORLD_HALF; x < WORLD_HALF; x += 5) {
        const jx = x + rand() * 4;
        const jz = z + rand() * 4;
        if (forestDensity(jx, jz) < 0.45 || T.getHeight(jx, jz) > 46) continue;
        g.beginPath();
        g.arc(X(jx), X(jz), 1.1 + rand() * 0.9, 0, TAU);
        g.fill();
      }
    }
    // Fields, with furrows.
    const crops = { wheat: '#d8bc6a', barley: '#c4c47a', cabbage: '#7a9a52', plowed: '#8a6a48' };
    for (const f of FIELDS) {
      const r = rect(f.x, f.z, f.w / 2, f.d / 2, f.rot);
      box(r, crops[f.crop], 'rgba(70,50,30,0.6)');
      g.save();
      g.translate(X(f.x), X(f.z));
      g.rotate(-f.rot);
      g.strokeStyle = 'rgba(70,50,30,0.25)';
      for (let u = -f.w / 2 + 1.5; u < f.w / 2; u += 3) {
        g.beginPath();
        g.moveTo(u * s, (-f.d / 2) * s);
        g.lineTo(u * s, (f.d / 2) * s);
        g.stroke();
      }
      g.restore();
    }
    // Paved floors and the bridge deck.
    for (const r of this.surfaces) box(r, '#b8ab94', 'rgba(60,45,30,0.5)');
    // Buildings, walls and fences; big round things (towers, wells) too. Trees and posts are left out.
    for (const it of this.colliders.items) {
      if (it.type === CIRCLE) {
        if (it.r < 0.7) continue;
        g.fillStyle = it.r > 2.5 ? '#5a4632' : '#7d705e';
        g.beginPath();
        g.arc(X(it.x), X(it.z), it.r * s, 0, TAU);
        g.fill();
      } else {
        const thin = Math.min(it.hw, it.hd) < 0.2;
        box({ x: it.x, z: it.z, hw: it.hw, hd: it.hd, rot: Math.atan2(it.sin, it.cos) }, thin ? 'rgba(90,70,45,0.7)' : '#5a4632', null, 0.5);
      }
    }
    return c;
  }

  // Full-detail tree chunks are drawn only when some of their trees are within the LOD radius.
  updateLods(pos) {
    this.lod.uLodCenter.value.copy(pos);
    const r = this.lod.uLodRadius.value + 4;
    for (const l of this.lods) {
      const dx = Math.max(Math.abs(pos.x - l.x) - l.half, 0);
      const dz = Math.max(Math.abs(pos.z - l.z) - l.half, 0);
      l.mesh.visible = dx * dx + dz * dz < r * r;
    }
  }

  // Centres the shadow frustum on the focus, snapped to whole shadow-map texels
  // in light space so shadows do not shimmer as the player moves.
  _placeSun(focus) {
    const d = this.lightDir;
    const ax = _ax.set(d.z, 0, -d.x).normalize(); // cross(up, d): the shadow camera's X axis
    const ay = _ay.crossVectors(d, ax);
    const texel = (this.shadowExtent * 2) / this.sun.shadow.mapSize.x;
    const px = Math.round(focus.dot(ax) / texel) * texel;
    const py = Math.round(focus.dot(ay) / texel) * texel;
    const centre = _centre.set(0, 0, 0).addScaledVector(ax, px).addScaledVector(ay, py).addScaledVector(d, focus.dot(d));
    this.sun.target.position.copy(centre);
    this.sun.position.copy(centre).addScaledVector(d, 160);
  }
}

// ======================================================== instance helpers

const ROCK_TINTS = [0xa39d90, 0x8f8b82, 0xa69d88, 0x7f7e78].map((c) => C(c));

function rockGeometry() {
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // Same jitter for every copy of a shared corner keeps the surface closed.
    const k = 0.8 + hash2(Math.round(x * 1000) * 31 + Math.round(z * 1000), Math.round(y * 1000)) * 0.38;
    pos.setXYZ(i, x * k, Math.max(y * k, -0.3), z * k);
  }
  geometry.computeVertexNormals();
  return geometry;
}

// Instanced meshes, split into chunks so off-screen groups are culled. Chunks
// pushed to `near` are only shown when the camera is close (see updateLods).
const CHUNK = 96;

function makeInstanced(scene, list, geometry, material, shadow, name, near = null, chunk = CHUNK) {
  if (!list.length) return;
  const groups = new Map();
  for (const it of list) {
    const key = `${Math.floor(it.m.elements[12] / chunk)},${Math.floor(it.m.elements[14] / chunk)}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(it);
  }
  for (const [key, items] of groups) {
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    items.forEach((it, i) => {
      mesh.setMatrixAt(i, it.m);
      if (it.c) mesh.setColorAt(i, it.c);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.name = name;
    scene.add(mesh);
    if (near) {
      const [cx, cz] = key.split(',').map((v) => (Number(v) + 0.5) * chunk);
      near.push({ x: cx, z: cz, half: chunk / 2, mesh });
    }
  }
}

function instanceGeometries() {
  const boxes = (list, scaleUV) => {
    const parts = list.map(([w, h, d, x, y, z, rx = 0]) => {
      const b = new THREE.BoxGeometry(w, h, d).toNonIndexed();
      if (rx) b.rotateX(rx);
      b.translate(x, y, z);
      return b;
    });
    const g = mergeGeometries(parts);
    projectUV(g, scaleUV);
    return withColor(g);
  };

  const tile = withColor(new THREE.BoxGeometry(1, 0.05, 1));

  const stallWood = boxes([
    [2.8, 0.85, 0.8, 0, 0.425, 0.7], [2.95, 0.06, 0.95, 0, 0.88, 0.72], [2.6, 0.7, 0.6, 0, 0.35, -0.75],
    [0.1, 2.3, 0.1, -1.4, 1.15, 1.1], [0.1, 2.3, 0.1, 1.4, 1.15, 1.1],
    [0.1, 2.75, 0.1, -1.4, 1.375, -1.05], [0.1, 2.75, 0.1, 1.4, 1.375, -1.05],
    [2.9, 0.08, 0.08, 0, 2.3, 1.1], [2.9, 0.08, 0.08, 0, 2.75, -1.05],
    [0.5, 0.35, 0.4, -0.9, 1.08, 0.6], [0.5, 0.35, 0.4, 0.6, 1.08, 0.75],
  ], 2);
  const slope = Math.atan2(0.45, 2.5);
  const stallAwning = boxes([
    [3.1, 0.03, Math.hypot(2.5, 0.45), 0, 2.58, 0.12, slope],
    [3.1, 0.32, 0.03, 0, 2.2, 1.37],
  ], 1.2);
  const goodsParts = [];
  for (let k = 0; k < 5; k++) {
    const g = new THREE.IcosahedronGeometry(0.17, 0);
    g.deleteAttribute('uv');
    g.scale(1.5, 0.8, 1.2);
    g.translate(-1.1 + k * 0.55, 0.98, 0.72 + (k % 2) * 0.12);
    goodsParts.push(g);
  }
  const stallGoods = mergeGeometries(goodsParts);
  stallGoods.computeVertexNormals();
  projectUV(stallGoods, 1);
  withColor(stallGoods);

  const barrelProfile = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    barrelProfile.push(new THREE.Vector2(0.3 + Math.sin(t * Math.PI) * 0.06, t * 0.95));
  }
  const barrel = withColor(new THREE.LatheGeometry(barrelProfile, 12));
  const uv = barrel.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * 0.6, uv.getX(i) * 2.3);
  const crate = boxes([[0.7, 0.7, 0.7, 0, 0.35, 0]], 1.4);

  const fencePost = withColor(new THREE.CylinderGeometry(0.07, 0.085, 1.3, 6).translate(0, 0.6, 0));
  const fenceRail = boxes([[1, 0.09, 0.06, 0, 0, 0]], 1.5);

  const tombShape = new THREE.Shape();
  tombShape.moveTo(-0.32, 0);
  tombShape.lineTo(0.32, 0);
  tombShape.lineTo(0.32, 0.75);
  tombShape.absarc(0, 0.75, 0.32, 0, Math.PI, false);
  tombShape.lineTo(-0.32, 0);
  const tomb = extrude(tombShape, 0.16, 8);
  tomb.translate(0, -0.15, 0);
  projectUV(tomb, 1.5);
  withColor(tomb);
  const cross = boxes([[0.16, 1.3, 0.14, 0, 0.5, 0], [0.7, 0.14, 0.14, 0, 0.85, 0]], 1.5);

  const cabbageParts = [];
  for (let k = 0; k < 4; k++) {
    const g = new THREE.IcosahedronGeometry(k === 0 ? 0.2 : 0.17, 0);
    g.deleteAttribute('uv');
    if (k === 0) g.translate(0, 0.17, 0);
    else {
      const a = (k / 3) * TAU;
      g.scale(1.3, 0.45, 1.0);
      g.translate(Math.sin(a) * 0.17, 0.07, Math.cos(a) * 0.17);
    }
    cabbageParts.push(g);
  }
  const cabbage = mergeGeometries(cabbageParts);
  cabbage.computeVertexNormals();

  return { tile, stallWood, stallAwning, stallGoods, barrel, crate, fencePost, fenceRail, tomb, cross, wheat: wheatGeometry(), cabbage };
}
