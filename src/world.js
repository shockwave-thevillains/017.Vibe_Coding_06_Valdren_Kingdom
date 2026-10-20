import * as THREE from 'three';

/*
 * world.js: the land of Valdren.
 *
 * Owns the height-function terrain, the river surface, the sky dome with its
 * time-of-day lighting and fog, scattered boulders, and the collision grid
 * that every actor resolves against.
 *
 * Units are metres. North is -Z, east is +X, Y is up.
 */

// ------------------------------------------------------------------ layout

export const WORLD_HALF = 400;        // terrain spans [-400, 400] on X and Z
export const PLAY_HALF = 335;         // actors are kept inside this square
export const WATER_LEVEL = 0.8;       // river surface height
export const MAX_WADE_DEPTH = 0.95;   // deeper water cannot be walked into
const RIVERBED_Y = -1.6;
const MAX_GRADE = 1.0;                // rise over run above which a step is refused (45°)
const TERRAIN_SEGMENTS = 200;         // 4 m grid
const SUN_TILT = 0.5;                 // tilts the sun's arc towards the south

// Landmarks shared by every phase (castle, town, farms, ruins, spawn point).
export const SITES = {
  castle: { x: 0, z: -190, r: 40, y: 32 },
  town: { x: 0, z: 10, r: 78, y: 6 },
  farmland: { x: 40, z: 222, hw: 105, hd: 55, y: 3.2 },
  ruins: { x: -240, z: -40 },
  spawn: { x: 0, z: 104, heading: Math.PI },
};

// ------------------------------------------------------------- math helpers

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

// ------------------------------------------------------------ height field

// Centre line of the river, which flows west to east south of the town.
export function riverZ(x) {
  return 128 + 18 * Math.sin(x * 0.012) + 8 * Math.sin(x * 0.031 + 1.3);
}

// The analytic shape of the land. The terrain mesh samples this on a grid;
// gameplay queries go through Terrain.getHeight so they match the mesh exactly.
export function heightAt(x, z) {
  // Rolling meadows with small bumps.
  let h = 3 + fbm(x * 0.0055, z * 0.0055, 4) * 9 + (fbm(x * 0.03 + 50, z * 0.03 - 20, 2) - 0.5) * 1.2;

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
  h = lerp(h, t.y + (t.z - z) * 0.025, town);

  // Farmland south of the river.
  const f = SITES.farmland;
  const fd = Math.max(Math.abs(x - f.x) / f.hw, Math.abs(z - f.z) / f.hd);
  const farm = 1 - smoothstep(0.85, 1.15, fd);
  h = lerp(h, f.y + (fbm(x * 0.01, z * 0.01, 2) - 0.5) * 1.5, farm);

  // Mountains ring the kingdom.
  const edge = Math.max(Math.abs(x), Math.abs(z)) + (fbm(x * 0.008 + 7, z * 0.008 + 3, 3) - 0.5) * 50;
  const mountain = smoothstep(300, 385, edge);
  if (mountain > 0) {
    const ridge = 1 - Math.abs(fbm(x * 0.012 + 3, z * 0.012 - 5, 4) * 2 - 1);
    h += mountain * (30 + ridge * 55);
  }

  // River channel, cut last so it carves gorges through the mountains.
  const bank = smoothstep(5, 17, Math.abs(z - riverZ(x)));
  return lerp(RIVERBED_Y, h, bank);
}

// ------------------------------------------------------------------ terrain

const PAL = {
  grassA: new THREE.Color(0x4e8a32),
  grassB: new THREE.Color(0x84b24c),
  dry: new THREE.Color(0xb0a85c),
  sand: new THREE.Color(0xb09a68),
  mud: new THREE.Color(0x6e6446),
  rock: new THREE.Color(0x8a8476),
  rockDark: new THREE.Color(0x5f5b54),
  snow: new THREE.Color(0xeef2f4),
};

class Terrain {
  constructor(segments) {
    const n = segments;
    const row = n + 1;
    const step = (WORLD_HALF * 2) / n;
    const count = row * row;
    const heights = new Float32Array(count);
    const positions = new Float32Array(count * 3);

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
      }
    }

    // Each cell is split along the (i+1, j)–(i, j+1) diagonal; getHeight relies on this.
    const index = new Uint16Array(n * n * 6);
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
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.computeVertexNormals();
    geometry.setAttribute('color', new THREE.BufferAttribute(Terrain.colours(positions, geometry.attributes.normal.array, count), 3));
    geometry.computeBoundingSphere();

    this.n = n;
    this.row = row;
    this.step = step;
    this.heights = heights;
    this.mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.mesh.name = 'terrain';
    this.mesh.receiveShadow = true;
  }

  static colours(pos, nrm, count) {
    const out = new Float32Array(count * 3);
    const col = new THREE.Color();
    const rock = new THREE.Color();
    for (let k = 0; k < count; k++) {
      const x = pos[k * 3];
      const h = pos[k * 3 + 1];
      const z = pos[k * 3 + 2];
      const ny = nrm[k * 3 + 1];

      col.copy(PAL.grassA).lerp(PAL.grassB, fbm(x * 0.021, z * 0.021, 3));
      col.lerp(PAL.dry, smoothstep(0.56, 0.74, fbm(x * 0.007 + 20, z * 0.007 + 40, 2)) * 0.5);
      col.lerp(PAL.sand, 1 - smoothstep(WATER_LEVEL + 0.25, WATER_LEVEL + 1.5, h));
      col.lerp(PAL.mud, 1 - smoothstep(WATER_LEVEL - 1.4, WATER_LEVEL - 0.1, h));

      const rocky = Math.max(1 - smoothstep(0.66, 0.84, ny), smoothstep(36, 50, h));
      if (rocky > 0) col.lerp(rock.copy(PAL.rock).lerp(PAL.rockDark, fbm(x * 0.05, z * 0.05, 2)), rocky);
      col.lerp(PAL.snow, smoothstep(64, 76, h) * smoothstep(0.55, 0.8, ny));

      const jitter = 0.9 + hash2(k, 7) * 0.2;
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
}

// -------------------------------------------------------------------- water

function createWater() {
  const geometry = new THREE.PlaneGeometry(WORLD_HALF * 2, 116, 160, 24);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, WATER_LEVEL, 128);

  const uniforms = { uTime: { value: 0 } };
  const material = new THREE.MeshPhongMaterial({
    color: 0x2f6f86,
    specular: 0x8fb8c8,
    shininess: 70,
    flatShading: true,
    transparent: true,
    opacity: 0.84,
  });
  // Gentle low-poly ripples, displaced on the GPU.
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        transformed.y += sin(position.x * 0.42 + uTime * 1.5) * 0.05
                       + sin(position.z * 0.66 - uTime * 1.1 + position.x * 0.13) * 0.045;`,
      );
  };

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'river';
  return { mesh, uniforms };
}

// ---------------------------------------------------------------------- sky

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
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), material);
    this.mesh.name = 'sky';
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
  }
}

// Keyframes: hour, zenith, horizon (= fog), sun glow, hemi sky, hemi ground,
// hemi intensity, directional light colour, star visibility.
const SKY_KEYS = [
  [0, 0x060a1a, 0x18203c, 0xc8d4ff, 0x34446e, 0x0c0f16, 1.2, 0x8aa2dc, 1.0],
  [4.8, 0x0a1028, 0x1f2846, 0xc8d4ff, 0x38486f, 0x0e1118, 1.2, 0x8aa2dc, 0.9],
  [5.8, 0x2a3f78, 0xd98a64, 0xffa060, 0x8c92b6, 0x3a3028, 1.4, 0xffa870, 0.2],
  [7.0, 0x4a82cc, 0xf0cfa8, 0xffd9a0, 0xaec6e6, 0x56493a, 1.5, 0xffe2b8, 0.0],
  [9.0, 0x3f7fd6, 0xbfd8ee, 0xfff1d6, 0xc0d8f2, 0x5c533c, 1.7, 0xfff1dc, 0.0],
  [15.5, 0x3f7fd6, 0xbfd8ee, 0xfff1d6, 0xc0d8f2, 0x5c533c, 1.7, 0xfff1dc, 0.0],
  [17.2, 0x4a6fb8, 0xf2c08c, 0xffc070, 0xb3b8d6, 0x544434, 1.7, 0xffd09a, 0.0],
  [18.1, 0x34437e, 0xec7f45, 0xff7a3c, 0x9a94b8, 0x3a2c24, 1.5, 0xff9858, 0.0],
  [19.2, 0x0f1636, 0x3a2d55, 0xc8d4ff, 0x3a4570, 0x0f1118, 1.2, 0x8ea2d8, 0.6],
  [24, 0x060a1a, 0x18203c, 0xc8d4ff, 0x34446e, 0x0c0f16, 1.2, 0x8aa2dc, 1.0],
].map(([t, zenith, horizon, sun, hemiSky, hemiGround, hemi, light, stars]) => ({
  t,
  zenith: new THREE.Color(zenith),
  horizon: new THREE.Color(horizon),
  sun: new THREE.Color(sun),
  hemiSky: new THREE.Color(hemiSky),
  hemiGround: new THREE.Color(hemiGround),
  hemi,
  light: new THREE.Color(light),
  stars,
}));

// --------------------------------------------------------------- colliders

const CIRCLE = 0;
const BOX = 1;

// Static 2D obstacles (circles and rotated boxes) in a uniform spatial grid.
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

  addCircle(x, z, r) {
    return this._insert({ type: CIRCLE, x, z, r, mark: 0 }, x - r, z - r, x + r, z + r);
  }

  // Box centred at (x, z) with half extents (hw along local X, hd along local Z),
  // rotated by rotY exactly like an Object3D's rotation.y.
  addBox(x, z, hw, hd, rotY = 0) {
    const cos = Math.cos(rotY);
    const sin = Math.sin(rotY);
    const ex = Math.abs(hw * cos) + Math.abs(hd * sin);
    const ez = Math.abs(hw * sin) + Math.abs(hd * cos);
    return this._insert({ type: BOX, x, z, hw, hd, cos, sin, mark: 0 }, x - ex, z - ez, x + ex, z + ez);
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

  // Pushes a circle of the given radius at pos (x/z) out of every obstacle.
  resolve(pos, radius) {
    for (let iter = 0; iter < 3; iter++) {
      const list = this.query(pos.x, pos.z, radius + 0.5);
      let moved = false;
      for (let n = 0; n < list.length; n++) {
        if (list[n].type === CIRCLE ? pushOutOfCircle(list[n], pos, radius) : pushOutOfBox(list[n], pos, radius)) moved = true;
      }
      if (!moved) return;
    }
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

// ------------------------------------------------------------------ props

function makeRockGeometry() {
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

const ROCK_TINTS = [0x8f897c, 0x7d796f, 0x958d7a, 0x6f6e68].map((c) => new THREE.Color(c));

// ---------------------------------------------------------------- the world

const _ax = new THREE.Vector3();
const _ay = new THREE.Vector3();
const _centre = new THREE.Vector3();

export class World {
  constructor(scene, { mobile = false } = {}) {
    this.scene = scene;
    this.colliders = new Colliders(16);
    this.timeOfDay = 9.5;

    this.terrain = new Terrain(TERRAIN_SEGMENTS);
    scene.add(this.terrain.mesh);

    this.water = createWater();
    scene.add(this.water.mesh);

    this.sky = new SkyDome();
    scene.add(this.sky.mesh);

    this.fog = new THREE.Fog(0xbfd8ee, 80, 650);
    scene.fog = this.fog;

    this.hemi = new THREE.HemisphereLight(0xc0d8f2, 0x5c533c, 1.7);
    scene.add(this.hemi);

    // The one shadow-casting light. It follows the player so the shadow map stays sharp.
    this.sun = new THREE.DirectionalLight(0xfff1dc, 3);
    this.sun.castShadow = true;
    this.shadowExtent = mobile ? 32 : 42;
    const shadowCam = this.sun.shadow.camera;
    shadowCam.left = -this.shadowExtent;
    shadowCam.right = this.shadowExtent;
    shadowCam.top = this.shadowExtent;
    shadowCam.bottom = -this.shadowExtent;
    shadowCam.near = 1;
    shadowCam.far = 320;
    shadowCam.updateProjectionMatrix();
    this.sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    scene.add(this.sun, this.sun.target);
    this.lightDir = new THREE.Vector3(0, 1, 0);

    this._scatterBoulders(mulberry32(1337));
    this.setTime(this.timeOfDay);
  }

  // ------------------------------------------------------------- queries

  getHeight(x, z) {
    return this.terrain.getHeight(x, z);
  }

  // Height an actor stands at. Walkable structures (bridges, floors) join the terrain here.
  getGroundHeight(x, z) {
    return this.terrain.getHeight(x, z);
  }

  waterDepth(x, z) {
    return WATER_LEVEL - this.getGroundHeight(x, z);
  }

  // Whether an actor may step from (x0, z0) to (x1, z1): no deep water, no cliffs.
  canStep(x0, z0, x1, z1) {
    const g0 = this.getGroundHeight(x0, z0);
    const g1 = this.getGroundHeight(x1, z1);
    const depth1 = WATER_LEVEL - g1;
    if (depth1 > MAX_WADE_DEPTH && depth1 >= WATER_LEVEL - g0) return false;
    const run = Math.hypot(x1 - x0, z1 - z0);
    return run < 1e-5 || (g1 - g0) / run <= MAX_GRADE;
  }

  // True where nothing is planned: used to keep props off roads, the river and settlements.
  isOpenGround(x, z) {
    const { castle, town, farmland, ruins } = SITES;
    if (Math.hypot(x - town.x, z - town.z) < town.r + 26) return false;
    if (Math.hypot(x - castle.x, z - castle.z) < castle.r + 34) return false;
    if (Math.abs(x) < 14 && z > castle.z) return false;
    if (Math.abs(z - riverZ(x)) < 24) return false;
    if (Math.max(Math.abs(x - farmland.x) / farmland.hw, Math.abs(z - farmland.z) / farmland.hd) < 1.15) return false;
    if (Math.hypot(x - ruins.x, z - ruins.z) < 15) return false;
    return this.getHeight(x, z) < 40;
  }

  // -------------------------------------------------------- time of day

  setTime(hours) {
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
    this.sun.intensity = day ? 3.0 * smoothstep(-0.03, 0.14, sunDir.y) : 0.7 * smoothstep(0.03, 0.3, moonDir.y);
  }

  // --------------------------------------------------------------- frame

  update(dt, focus, camera) {
    this.water.uniforms.uTime.value += dt;
    this.sky.mesh.position.copy(camera.position);
    this._placeSun(focus);
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
    this.sun.position.copy(centre).addScaledVector(d, 150);
  }

  // -------------------------------------------------------------- props

  _scatterBoulders(rng) {
    const max = 120;
    const mesh = new THREE.InstancedMesh(makeRockGeometry(), new THREE.MeshLambertMaterial({ flatShading: true }), max);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const col = new THREE.Color();

    let placed = 0;
    for (let tries = 0; placed < max && tries < 5000; tries++) {
      let x;
      let z;
      if (rng() < 0.3) {
        // Rubble gathers around the ruined watchtower.
        const a = rng() * Math.PI * 2;
        const d = 16 + rng() * 55;
        x = SITES.ruins.x + Math.cos(a) * d;
        z = SITES.ruins.z + Math.sin(a) * d;
      } else {
        x = (rng() * 2 - 1) * (PLAY_HALF - 5);
        z = (rng() * 2 - 1) * (PLAY_HALF - 5);
      }
      if (!this.isOpenGround(x, z)) continue;

      const size = 0.45 + rng() * rng() * 2.4;
      const sx = size * (0.8 + rng() * 0.5);
      const sy = size * (0.55 + rng() * 0.45);
      const sz = size * (0.8 + rng() * 0.5);
      p.set(x, this.getHeight(x, z) + 0.05 * sy, z);
      e.set((rng() - 0.5) * 0.4, rng() * Math.PI * 2, (rng() - 0.5) * 0.4);
      m.compose(p, q.setFromEuler(e), s.set(sx, sy, sz));
      mesh.setMatrixAt(placed, m);
      mesh.setColorAt(placed, col.copy(ROCK_TINTS[Math.floor(rng() * ROCK_TINTS.length)]).multiplyScalar(0.85 + rng() * 0.2));
      if (size > 0.7) this.colliders.addCircle(x, z, Math.max(sx, sz) * 0.85);
      placed++;
    }

    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'boulders';
    this.scene.add(mesh);
    this.boulders = mesh;
  }
}
