import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/*
 * district-kit.js: shapes and helpers shared by the builders of the kingdom's new
 * quarters (district-styles.js): tiled roofs that sweep up at the eaves, gables
 * that follow a roof's curve, battered stone bases, lattices, a longship's hull,
 * and a small toolkit bound to the world's build context for footings, collision,
 * lamps and trees. Shapes are made once per size and cached; the world's Batch
 * copies them into place.
 */

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;
export const C = (hex) => new THREE.Color(hex);
export const WHITE = C(0xffffff);

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new Map();
function cached(key, make) {
  let g = cache.get(key);
  if (!g) cache.set(key, (g = make()));
  return g;
}
const k5 = (v) => (Math.round(v * 20) / 20).toFixed(2);

// ----------------------------------------------------------------- roofs

/*
 * A roof over a w x d plan (w along local X), its eaves at y = 0 and its ridge at
 * `rise`: hipped (four slopes) or gabled (two, ridge along X). o.curve > 1 makes the
 * slopes concave, flat at the eaves and steep at the ridge, as the roofs of the
 * East are; o.up lifts the eave corners. The surface is a grid whose cells follow
 * the hip creases, with normals from each slope's own shape, UVs running down the
 * slope (2.4 m across, 2 m down per texture tile) and a fascia of o.skirt round
 * the edge. Drawn double-sided, so its underside shows from below.
 */
export function roofGeometry(w, d, rise, o = {}) {
  const hip = o.hip !== false;
  const curve = o.curve ?? 1;
  const up = o.up ?? 0;
  const skirt = o.skirt ?? 0.16;
  const key = `roof|${k5(w)}|${k5(d)}|${k5(rise)}|${hip}|${curve}|${up}|${skirt}`;
  return cached(key, () => {
    if (hip && w < d) return roofGeometry(d, w, rise, o).clone().rotateY(Math.PI / 2);
    return buildRoof(w, d, rise, hip, curve, up, skirt);
  });
}

function buildRoof(w, d, rise, hip, curve, up, skirt) {
  const a = w / 2;
  const b = d / 2;
  const kz = Math.max(2, Math.ceil(b / (curve > 1.3 || up > 0.3 ? 1.1 : 1.7)));
  const s = b / kz;
  // Grid lines: from each end inward every s (so the hip creases pass through
  // vertices), and evenly along the middle.
  const xs = [];
  if (hip) {
    const mid = a - b;
    for (let i = 0; i <= kz; i++) xs.push(-a + i * s);
    const n = Math.max(1, Math.round(mid / s));
    for (let i = 1; i < n; i++) xs.push(-mid + (2 * mid * i) / n);
    for (let i = kz; i >= 0; i--) xs.push(a - i * s);
  } else {
    // Lifted corners need lines near the ends only: space them closer there.
    const n = up > 0 ? Math.min(10, Math.max(6, Math.ceil(w / 2))) : Math.max(1, Math.ceil(w / 4));
    for (let i = 0; i <= n; i++) xs.push(up > 0 ? -a * Math.cos((Math.PI * i) / n) : -a + (w * i) / n);
  }
  const zs = [];
  for (let i = 0; i <= 2 * kz; i++) zs.push(-b + i * s);
  const xq = [...new Set(xs.map((v) => +v.toFixed(5)))].sort((p, q) => p - q);

  const lift = (x, z) => up * Math.pow(Math.abs(x) / a, 4) * Math.pow(Math.abs(z) / b, hip ? 4 : 2);
  // Height and slope on one sheet: 'z' (front and back) or 'x' (the hip ends).
  const sheet = (x, z, kind, sx, sz, out) => {
    // Both sheets reach the ridge over b (a >= b for a hip).
    const m = b;
    const e = kind === 'z' ? (b - Math.abs(z)) / m : (a - Math.abs(x)) / m;
    const t = clamp(e, 0, 1);
    const base = rise * Math.pow(t, curve);
    const dfdt = rise * curve * Math.pow(Math.max(t, 1e-3), curve - 1);
    let dx = 0;
    let dz = 0;
    if (kind === 'z') dz = dfdt * (-sz / m);
    else dx = dfdt * (-sx / m);
    if (up) {
      const px = Math.abs(x) / a;
      const pz = Math.abs(z) / b;
      const q = hip ? 4 : 2;
      dx += up * 4 * px ** 3 * (sx / a) * pz ** q;
      dz += up * px ** 4 * q * pz ** (q - 1) * (sz / b);
    }
    out.y = base + (up ? lift(x, z) : 0);
    out.nx = -dx;
    out.nz = -dz;
    return out;
  };
  const tmp = { y: 0, nx: 0, nz: 0 };
  const pos = [];
  const nor = [];
  const uv = [];
  const push = (x, z, kind, sx, sz) => {
    sheet(x, z, kind, sx, sz, tmp);
    const l = Math.hypot(tmp.nx, 1, tmp.nz);
    pos.push(x, tmp.y, z);
    nor.push(tmp.nx / l, 1 / l, tmp.nz / l);
    if (kind === 'z') uv.push(x / 2.4, (b - Math.abs(z)) / 2);
    else uv.push(z / 2.4, (a - Math.abs(x)) / 2);
  };
  for (let i = 0; i < xq.length - 1; i++) {
    for (let j = 0; j < zs.length - 1; j++) {
      const x0 = xq[i];
      const x1 = xq[i + 1];
      const z0 = zs[j];
      const z1 = zs[j + 1];
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const sx = Math.sign(cx) || 1;
      const sz = Math.sign(cz) || 1;
      // Split each cell along the crease direction of its quarter.
      const main = sx * sz > 0;
      const tri = main ? [[x0, z0], [x0, z1], [x1, z1], [x0, z0], [x1, z1], [x1, z0]] : [[x0, z0], [x0, z1], [x1, z0], [x1, z0], [x0, z1], [x1, z1]];
      for (let t = 0; t < 6; t += 3) {
        // Each triangle wholly on one sheet: decide by its own centroid.
        const tx = (tri[t][0] + tri[t + 1][0] + tri[t + 2][0]) / 3;
        const tz = (tri[t][1] + tri[t + 1][1] + tri[t + 2][1]) / 3;
        const tk = hip && a - Math.abs(tx) < b - Math.abs(tz) ? 'x' : 'z';
        for (let k = 0; k < 3; k++) push(tri[t + k][0], tri[t + k][1], tk, sx, sz);
      }
    }
  }
  // The fascia round the eaves (and the verges of a gable).
  if (skirt > 0) {
    const edge = (p0, p1, nx, nz) => {
      const h0 = heightAt(p0[0], p0[1]);
      const h1 = heightAt(p1[0], p1[1]);
      const quad = [[p0, h0], [p1, h1], [p1, h1 - skirt], [p0, h0], [p1, h1 - skirt], [p0, h0 - skirt]];
      const flip = (p1[0] - p0[0]) * nz - (p1[1] - p0[1]) * nx > 0;
      const order = flip ? [0, 2, 1, 3, 5, 4] : [0, 1, 2, 3, 4, 5];
      for (const k of order) {
        const [p, y] = quad[k];
        pos.push(p[0], y, p[1]);
        nor.push(nx, 0, nz);
        uv.push((p[0] + p[1]) / 2.4, y / 2);
      }
    };
    const heightAt = (x, z) => {
      const kind = hip && a - Math.abs(x) < b - Math.abs(z) ? 'x' : 'z';
      return sheet(x, z, kind, Math.sign(x) || 1, Math.sign(z) || 1, tmp).y;
    };
    for (let i = 0; i < xq.length - 1; i++) {
      edge([xq[i], b], [xq[i + 1], b], 0, 1);
      edge([xq[i + 1], -b], [xq[i], -b], 0, -1);
    }
    for (let j = 0; j < zs.length - 1; j++) {
      edge([a, zs[j + 1]], [a, zs[j]], 1, 0);
      edge([-a, zs[j]], [-a, zs[j + 1]], -1, 0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

// Height of such a roof's surface at (x, z), for placing ridges and finials.
export function roofHeight(w, d, rise, o, x, z) {
  const hip = o.hip !== false;
  const curve = o.curve ?? 1;
  const up = o.up ?? 0;
  let a = w / 2;
  let b = d / 2;
  if (hip && a < b) {
    [a, b] = [b, a];
    [x, z] = [z, x];
  }
  const e = hip && a - Math.abs(x) < b - Math.abs(z) ? (a - Math.abs(x)) / b : (b - Math.abs(z)) / b;
  return rise * Math.pow(clamp(e, 0, 1), curve) + up * Math.pow(Math.abs(x) / a, 4) * Math.pow(Math.abs(z) / b, hip ? 4 : 2);
}

/*
 * The end wall under a gabled roof: its base wd wide at y = 0, its top following the
 * roof's curve (w x d, rise, curve as given to roofGeometry) a little below it, in
 * the frame's Z-Y plane and t thick along X.
 */
export function gableWall(wd, d, rise, curve, t = 0.22) {
  return cached(`gable|${k5(wd)}|${k5(d)}|${k5(rise)}|${curve}|${t}`, () => {
    const b = d / 2;
    const s = new THREE.Shape();
    const h = (z) => rise * Math.pow(clamp((b - Math.abs(z)) / b, 0, 1), curve) - 0.08;
    s.moveTo(-wd / 2, 0);
    s.lineTo(wd / 2, 0);
    const n = 10;
    for (let i = 0; i <= n; i++) {
      const z = wd / 2 - (wd * i) / n;
      s.lineTo(z, Math.max(0, h(z)));
    }
    const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
    g.translate(0, 0, -t / 2);
    g.rotateY(Math.PI / 2);
    return g;
  });
}

// A frustum of a box: wb x db at the bottom (y = 0), wt x dt at the top (y = h).
export function frustumGeometry(wb, db, wt, dt, h) {
  return cached(`frustum|${k5(wb)}|${k5(db)}|${k5(wt)}|${k5(dt)}|${k5(h)}`, () => {
    const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const top = p.getY(i) > 0;
      p.setXYZ(i, p.getX(i) * (top ? wt : wb), (p.getY(i) + 0.5) * h, p.getZ(i) * (top ? dt : db));
    }
    g.computeVertexNormals();
    return g;
  });
}

/*
 * Lattices are flat panels textured with bars that have gaps between them (the
 * world's 'slats' and 'lattice' materials cut the gaps out), so a screen of a
 * hundred bars costs two triangles. slatPanel: upright bars `gap` apart;
 * latticePanel: a square grid of `gap`. Both face +Z, w x h, centred.
 */
export function slatPanel(w, h, gap = 0.16) {
  return cached(`slats|${k5(w)}|${k5(h)}|${gap}`, () => {
    const g = new THREE.PlaneGeometry(w, h).toNonIndexed();
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / gap, uv.getY(i));
    return g;
  });
}

export function latticePanel(w, h, gap = 0.24) {
  return cached(`lattice|${k5(w)}|${k5(h)}|${gap}`, () => {
    const g = new THREE.PlaneGeometry(w, h).toNonIndexed();
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / gap, (uv.getY(i) * h) / gap);
    return g;
  });
}

// A flat panel with a round-headed opening (a door or a moon gate), w x h, t thick.
export function archPanel(w, h, holeW, holeTop, round = false, t = 0.3) {
  return cached(`arch|${k5(w)}|${k5(h)}|${k5(holeW)}|${k5(holeTop)}|${round}|${t}`, () => {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    s.lineTo(w / 2, 0);
    s.lineTo(w / 2, h);
    s.lineTo(-w / 2, h);
    s.lineTo(-w / 2, 0);
    const r = holeW / 2;
    const hole = new THREE.Path();
    if (round) {
      hole.absarc(0, holeTop - r, r, 0, TAU, false);
    } else {
      hole.moveTo(-r, 0.001);
      hole.lineTo(r, 0.001);
      hole.lineTo(r, holeTop - r);
      hole.absarc(0, holeTop - r, r, 0, Math.PI, false);
      hole.lineTo(-r, 0.001);
    }
    s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 14 });
    g.translate(0, 0, -t / 2);
    return g;
  });
}

// Pointed palisade stakes along X: w long, h tall, as one sawtooth slab.
export function stakesGeometry(w, h, pitch = 0.42, t = 0.32) {
  return cached(`stakes|${k5(w)}|${k5(h)}|${pitch}|${t}`, () => {
    const s = new THREE.Shape();
    const n = Math.max(1, Math.round(w / pitch));
    const p = w / n;
    s.moveTo(-w / 2, 0);
    s.lineTo(w / 2, 0);
    for (let i = n; i > 0; i--) {
      const x = -w / 2 + i * p;
      s.lineTo(x, h - 0.45);
      s.lineTo(x - p / 2, h);
    }
    s.lineTo(-w / 2, h - 0.45);
    s.lineTo(-w / 2, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
    g.translate(0, 0, -t / 2);
    return g;
  });
}

/*
 * A clinker-built hull L long and B wide, H deep amidships, keel at y = 0, bow
 * towards +X; its stem and stern rise in a sweep. Open at the top (a deck covers it).
 */
export function hullGeometry(L, B, H) {
  return cached(`hull|${k5(L)}|${k5(B)}|${k5(H)}`, () => {
    const nu = 24;
    const nv = 8;
    const pos = [];
    const pt = (u, v) => {
      const x = (u - 0.5) * L;
      const e = Math.abs(u - 0.5) * 2;
      const half = (B / 2) * Math.pow(Math.max(0, 1 - e * e), 0.55);
      const a = (v / nv) * Math.PI; // 0 = one gunwale, pi = the other
      const yg = H + 0.9 * e ** 3.2;  // the gunwale sweeps up to stem and stern
      const yk = H * 0.55 * e * e;     // and so does the keel
      return [x, yg - (yg - yk) * Math.sin(a) ** 0.8, Math.cos(a) * half];
    };
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const p00 = pt(i / nu, j);
        const p10 = pt((i + 1) / nu, j);
        const p01 = pt(i / nu, j + 1);
        const p11 = pt((i + 1) / nu, j + 1);
        pos.push(...p00, ...p11, ...p10, ...p00, ...p01, ...p11);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  });
}

// A flared roof turned round an axis (a pavilion's or a lantern's), `sides` sided.
export function flaredRoof(r, h, sides, flare = 0.35) {
  return cached(`flare|${k5(r)}|${k5(h)}|${sides}|${flare}`, () => {
    const pts = [];
    const n = 8;
    for (let i = 0; i <= n; i++) {
      const t = i / n; // 0 at the eave, 1 at the tip
      const rad = r * (1 - t) ** (1 + flare * 2);
      pts.push(new THREE.Vector2(Math.max(0.001, rad), h * t + flare * 0.5 * (1 - t) ** 6 * r * 0.25));
    }
    pts.reverse();
    const g = new THREE.LatheGeometry(pts, sides);
    return g.toNonIndexed();
  });
}

// Shared small shapes.
export const SHAPES = {
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
  // Columns and posts: open at both ends (their ends are hidden), eight-sided.
  col: new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1, true),
  cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
  cyl8: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
  ball: new THREE.SphereGeometry(0.5, 6, 4),
  lantern: new THREE.CylinderGeometry(0.46, 0.5, 1, 8),
  cone: new THREE.ConeGeometry(0.5, 1, 8),
  disc: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
  // The top half of a disc facing +Z (an arch's head), 1 wide and 1 thick.
  halfDisc: new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2),
  rock: new THREE.IcosahedronGeometry(0.5, 0),
  blob: new THREE.IcosahedronGeometry(0.5, 0),
};

// --------------------------------------------------------------- toolkit

/*
 * Binds the shapes to the world's build context: kit carries the world's Frame,
 * rect and tints. Everything is placed in a Frame (x, z, rot): +Z is the front,
 * towards the street.
 */
export function makeBuilder(ctx, kit) {
  const { Frame, rect } = kit;
  const B = {
    ctx,
    kit,
    frame: (x, z, rot = 0) => new Frame(ctx, x, z, rot),
    // Lowest and highest ground under a hw x hd footprint.
    span(F, hw, hd) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd], [0, 0]]) {
        const g = F.ground(lx, lz);
        lo = Math.min(lo, g);
        hi = Math.max(hi, g);
      }
      return [lo, hi];
    },
    // A footing under a building; returns its floor height (base) and its bottom.
    footing(F, hw, hd, o = {}) {
      const [lo, hi] = B.span(F, hw, hd);
      const base = hi + (o.lift ?? 0.3);
      const bottom = lo - 0.7;
      const pad = o.pad ?? 0.2;
      F.box(o.key || 'stone', 0, (base + bottom) / 2, 0, hw * 2 + pad, base - bottom, hd * 2 + pad, o.tint || kit.TINT.plinth);
      return { base, bottom };
    },
    roof(F, key, w, d, rise, y, tint, o = {}, cx = 0, cz = 0, ry = 0) {
      F.geo(key, roofGeometry(w, d, rise, o), cx, y, cz, 0, ry, 0, 1, 1, 1, tint, true);
    },
    cyl(F, key, x, y0, z, r, h, tint, sides = 10) {
      F.geo(key, sides === 6 ? SHAPES.cyl6 : sides === 8 ? SHAPES.cyl8 : SHAPES.cyl, x, y0 + h / 2, z, 0, 0, 0, r * 2, h, r * 2, tint);
    },
    // An open-ended post or column (its ends hidden under a beam and in the ground).
    col(F, key, x, y0, z, r, h, tint) {
      F.geo(key, SHAPES.col, x, y0 + h / 2, z, 0, 0, 0, r * 2, h, r * 2, tint);
    },
    slats(F, w, h, x, y, z, tint, gap = 0.16, ry = 0) {
      F.geo('slats', slatPanel(w, h, gap), x, y, z, 0, ry, 0, 1, 1, 1, tint, true);
    },
    lattice(F, w, h, x, y, z, tint, gap = 0.24, ry = 0, rx = 0, rz = 0) {
      F.geo('lattice', latticePanel(w, h, gap), x, y, z, rx, ry, rz, 1, 1, 1, tint, true);
    },
    lamp(F, lx, y, lz) {
      const [x, z] = F.world(lx, lz);
      ctx.world.lampHeads.push(new THREE.Vector3(x, y, z));
    },
    tree(x, z, kind, s = 1) {
      ctx.trees.push({ x, z, kind, s });
    },
    occupy(F, hw, hd, cx = 0, cz = 0) {
      const [x, z] = F.world(cx, cz);
      ctx.occupy(rect(x, z, hw, hd, F.rot));
    },
  };
  return B;
}
