import * as THREE from 'three';
import {
  C, WHITE, TAU, SHAPES, gableWall, frustumGeometry, latticePanel, archPanel, stakesGeometry, hullGeometry, flaredRoof,
} from './district-kit.js';

/*
 * district-styles.js: the buildings of the kingdom's quarters, one family per
 * people who settled them. Every builder takes the toolkit B (district-kit.js), a
 * Frame F whose +Z faces the street, the plot's frontage w and depth d, and a
 * random stream; it builds, adds its collision, and leaves claiming the plot to
 * the caller. Landmarks (castles, halls, gardens) place themselves.
 *
 *   Sakuragawa (Japanese):  machiya townhouses, storehouses, thatched farmhouses,
 *                            a bathhouse, a teahouse, the castle keep, a red bridge.
 *   Jade Lantern Quarter:   courtyard houses, shophouses, a gateway arch, the drum
 *                            tower, the magistrate's hall, a garden with a pavilion.
 *   Hrafnvik (Viking):      turf-roofed longhouses, the mead hall, a palisade,
 *                            watchtowers, longships and boat sheds.
 *   Mudwick (the slums):    shacks of patched planks, stilt huts, tenements.
 *   Saffron Bazaar:         flat-roofed houses with parapets, wind towers and
 *                            lattice bays, awnings, a caravanserai.
 *   Costa Mirra:            whitewashed villas with blue shutters and terracotta
 *                            roofs, a loggia, a lakeside promenade.
 *
 * None of them is a place of worship: no temples, shrines, pagodas or gates of
 * any faith; only homes, shops, inns, halls, walls and gardens.
 */

const pick = (rng, list) => list[Math.floor(rng() * list.length) % list.length];
const vary = (rng, c, amount = 0.08) => c.clone().multiplyScalar(1 - amount + rng() * amount * 2);
const dark = (c, k = 0.75) => c.clone().multiplyScalar(k);

// ------------------------------------------------------------ shared bits

// A walk-in ground floor (the world's openRoom) on a footing.
function walkIn(B, F, o) {
  const { base, bottom } = B.footing(F, o.w / 2, o.d / 2, { tint: o.footTint, lift: o.lift ?? 0.3, key: o.footKey });
  const room = B.kit.openRoom(B.ctx, F, { w: o.w, d: o.d, doorAt: o.doorAt || 0, name: o.name, room: o.furnish }, base, o.h, bottom);
  room.walls(o.wallKey, o.wallTint);
  B.occupy(F, o.w / 2 + 0.4, o.d / 2 + 0.4);
  return { room, base, bottom };
}

// Windows down both side walls of a walk-in room: glass outside, a lit pane inside.
function sideWindows(F, w, d, y, step = 3.2, wTint = WHITE) {
  const n = Math.max(1, Math.floor((d - 2) / step));
  for (let k = 0; k < n; k++) {
    const z = -d / 2 + 1 + ((k + 0.5) * (d - 2)) / n;
    for (const s of [-1, 1]) {
      F.box('glass', s * (w / 2 + 0.02), y, z, 0.05, 1.0, 0.8, wTint);
      F.box('pane', s * (w / 2 - 0.32), y, z, 0.03, 0.98, 0.78, WHITE);
    }
  }
}

// Where a keeper stands behind the counter: recorded as a named spot for data/npcs.json.
function keeperSpot(B, room, name, lx, lz, turn = 0) {
  const [x, z] = room.F.world(lx, lz);
  B.ctx.world.spots[name] = { x, z, heading: room.F.rot + turn };
}

// ================================================================ Sakuragawa

export const JP = {
  dark: C(0x3e332b), wood: C(0x6e5442), pale: C(0xa88a64), plaster: C(0xf1ece2), stone: C(0xa9a59b), base: C(0x77726a),
  roof: [C(0x5c626b), C(0x50565e), C(0x676b72)], noren: [C(0x2c3d6c), C(0x7c2b26), C(0x2f5240), C(0x8a6630), C(0x4a2e5a)],
  red: C(0xb2382c), paper: C(0xf7efdc), thatch: C(0xc6ad86), lantern: [C(0xff5a3a), C(0xfff2d8), C(0xffd070)],
};

// Ridge cap and end tiles along a gabled roof's ridge (ridge along local X, L long).
function ridge(F, L, y, tint, z = 0, ends = true) {
  F.box('kawara', 0, y + 0.08, z, L, 0.26, 0.36, dark(tint, 0.85));
  if (ends) for (const s of [-1, 1]) F.box('kawara', s * (L / 2), y + 0.22, z, 0.14, 0.55, 0.5, dark(tint, 0.7));
}

// A paper lantern hanging at (x, y, z) in F; lit at night (some of them light the street).
function paperLantern(B, F, x, y, z, tint, light = false, s = 1) {
  F.geo('lamp', SHAPES.lantern, x, y, z, 0, 0, 0, 0.36 * s, 0.4 * s, 0.36 * s, tint);
  F.box('timber', x, y + 0.26 * s, z, 0.2 * s, 0.05, 0.2 * s, C(0x2a2018));
  if (light) B.lamp(F, x, y, z);
}

/*
 * A machiya: a narrow, deep townhouse. Its shop front is a dark wooden lattice over
 * paper screens, with a curtain over the door and a pent roof above; the low upper
 * floor is white plaster with a slatted window, under a gabled roof of grey tiles.
 */
export function machiya(B, F, w, d, rng) {
  const { base, bottom } = B.footing(F, w / 2, d / 2, { tint: JP.base, lift: 0.25 });
  const h1 = 2.9;
  const h2 = 2.3;
  const roofT = pick(rng, JP.roof);
  F.box('timber', 0, base + h1 / 2, 0, w, h1, d, JP.dark);
  const doorAt = (rng() < 0.5 ? -1 : 1) * (w / 2 - 1.0);
  const lo = doorAt > 0 ? -w / 2 + 0.3 : doorAt + 0.75;
  const hi = doorAt > 0 ? doorAt - 0.75 : w / 2 - 0.3;
  F.box('paper', (lo + hi) / 2, base + 1.3, d / 2 + 0.012, hi - lo, 1.85, 0.02, JP.paper);
  B.slats(F, hi - lo, 1.9, (lo + hi) / 2, base + 1.3, d / 2 + 0.05, JP.wood, 0.14);
  F.box('planks', doorAt, base + 1.05, d / 2 + 0.02, 1.2, 2.1, 0.05, dark(JP.dark, 0.7));
  F.box('plainCloth', doorAt, base + 2.0, d / 2 + 0.14, 1.3, 0.6, 0.02, pick(rng, JP.noren));
  // Pent roof over the shop front.
  F.box('kawara', 0, base + h1 + 0.12, d / 2 + 0.5, w + 0.2, 0.07, 1.15, roofT, 0.33, 0, 0);
  // Upper floor with its slatted window.
  F.box('plaster', 0, base + h1 + h2 / 2, 0, w, h2, d, JP.plaster);
  F.box('timber', 0, base + h1 + 0.06, 0, w + 0.05, 0.14, d + 0.05, JP.dark);
  const ww = Math.min(2.6, w * 0.5);
  F.box('paper', 0, base + h1 + 1.15, d / 2 + 0.012, ww, 0.66, 0.02, JP.paper);
  B.slats(F, ww, 0.7, 0, base + h1 + 1.15, d / 2 + 0.05, JP.dark, 0.1);
  // Roof: gabled, its ridge along the street.
  const y0 = base + h1 + h2 - 0.05;
  const RW = w + 0.7;
  const RD = d + 1.3;
  const rise = RD * 0.27;
  B.roof(F, 'kawara', RW, RD, rise, y0, roofT, { hip: false, curve: 1.2 });
  for (const s of [-1, 1]) F.geo('plaster', gableWall(d, RD, rise, 1.2), s * (w / 2 - 0.11), y0, 0, 0, 0, 0, 1, 1, 1, JP.plaster);
  ridge(F, RW + 0.1, y0 + rise, roofT);
  paperLantern(B, F, doorAt + (doorAt > 0 ? -0.95 : 0.95), base + 2.35, d / 2 + 0.75, pick(rng, JP.lantern), rng() < 0.3);
  F.collideBox(0, 0, w / 2, d / 2, bottom, y0 + rise + 0.6);
  return { top: y0 + rise };
}

// A kura: a fireproof storehouse, thick white walls on a dark tiled base.
export function kura(B, F, w, d, rng) {
  const { base, bottom } = B.footing(F, w / 2, d / 2, { tint: JP.base, lift: 0.45 });
  const h = 5.0;
  const roofT = pick(rng, JP.roof);
  F.box('plaster', 0, base + h / 2, 0, w, h, d, JP.plaster);
  F.box('stone', 0, base + 0.75, 0, w + 0.08, 1.5, d + 0.08, C(0x4c5056));
  B.lattice(F, w - 0.2, 1.3, 0, base + 0.75, d / 2 + 0.05, JP.plaster, 0.32);
  F.box('timber', 0, base + h - 1.3, d / 2 + 0.06, 0.9, 0.8, 0.12, JP.dark);
  F.box('planks', 0, base + 1.15, d / 2 + 0.06, 1.3, 2.3, 0.12, dark(JP.dark, 0.8));
  const y0 = base + h - 0.05;
  const RD = d + 1.0;
  const rise = RD * 0.33;
  B.roof(F, 'kawara', w + 0.8, RD, rise, y0, roofT, { hip: false, curve: 1.1 });
  for (const s of [-1, 1]) F.geo('plaster', gableWall(d, RD, rise, 1.1), s * (w / 2 - 0.11), y0, 0, 0, 0, 0, 1, 1, 1, JP.plaster);
  ridge(F, w + 0.9, y0 + rise, roofT);
  F.collideBox(0, 0, w / 2, d / 2, bottom, y0 + rise + 0.6);
  return { top: y0 + rise };
}

// A minka: a farmhouse under a steep, thick roof of thatch, with a veranda of planks.
export function minka(B, F, w, d, rng) {
  const { base, bottom } = B.footing(F, w / 2, d / 2, { tint: JP.base, lift: 0.55 });
  const h = 2.6;
  F.box('plaster', 0, base + h / 2, 0, w, h, d, JP.plaster);
  F.box('timber', 0, base + 0.45, 0, w + 0.04, 0.9, d + 0.04, JP.dark);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) F.box('timber', sx * (w / 2), base + h / 2, sz * (d / 2), 0.24, h, 0.24, JP.dark);
  F.box('paper', 0, base + 1.25, d / 2 + 0.012, w - 1.2, 1.7, 0.02, JP.paper);
  B.lattice(F, w - 1.2, 1.7, 0, base + 1.25, d / 2 + 0.04, JP.wood, 0.3);
  F.box('planks', 0, base - 0.1, d / 2 + 0.6, w, 0.1, 1.1, JP.pale);
  const RW = w + 2.2;
  const RD = d + 2.2;
  const rise = Math.min(RW, RD) * 0.62;
  const y0 = base + h - 0.2;
  B.roof(F, 'thatch', RW, RD, rise, y0, vary(rng, JP.thatch, 0.1), { hip: true, curve: 1, skirt: 0.45 });
  const len = Math.max(0.8, Math.abs(RW - RD)) + 0.8;
  F.box('kawara', 0, y0 + rise + 0.1, 0, RW >= RD ? len : 0.9, 0.42, RW >= RD ? 0.9 : len, pick(rng, JP.roof));
  F.collideBox(0, 0, w / 2, d / 2, bottom, y0 + rise + 0.6);
  return { top: y0 + rise };
}

// A sento: the public bathhouse, with its tall chimney and a great curtain at the door.
export function sento(B, F, w, d, rng) {
  const { base, bottom } = B.footing(F, w / 2, d / 2, { tint: JP.base, lift: 0.4 });
  const h = 4.2;
  const roofT = pick(rng, JP.roof);
  F.box('plaster', 0, base + h / 2, 0, w, h, d, JP.plaster);
  F.box('timber', 0, base + 0.9, 0, w + 0.06, 1.8, d + 0.06, JP.dark);
  for (let k = -2; k <= 2; k++) F.box('timber', (k * w) / 5, base + h / 2, d / 2 + 0.06, 0.2, h, 0.12, JP.dark);
  F.box('planks', 0, base + 1.2, d / 2 + 0.05, 2.4, 2.4, 0.06, dark(JP.dark, 0.7));
  F.box('plainCloth', 0, base + 2.0, d / 2 + 0.16, 2.8, 1.0, 0.02, C(0x2c3d6c));
  F.box('plainCloth', 0, base + 2.0, d / 2 + 0.17, 2.82, 0.14, 0.02, JP.plaster);
  const y0 = base + h - 0.05;
  const RW = w + 2.0;
  const RD = d + 2.0;
  const rise = Math.min(RW, RD) * 0.36;
  B.roof(F, 'kawara', RW, RD, rise, y0, roofT, { hip: true, curve: 1.4, up: 0.4 });
  ridge(F, Math.abs(RW - RD) + 0.6, y0 + rise, roofT);
  // The boiler's chimney behind.
  B.cyl(F, 'stone', w / 2 - 1.4, base, -d / 2 + 1.4, 0.7, 14, C(0x8a5a48), 10);
  F.box('metal', w / 2 - 1.4, base + 14.1, -d / 2 + 1.4, 1.5, 0.2, 1.5);
  F.collideBox(0, 0, w / 2, d / 2, bottom, y0 + rise + 0.6);
  F.collideCircle(w / 2 - 1.4, -d / 2 + 1.4, 0.75, bottom, base + 14.5);
  B.occupy(F, w / 2 + 0.3, d / 2 + 0.3);
  return { top: y0 + rise };
}

/*
 * A teahouse you can walk into: tatami-coloured floor, low tables with cushions,
 * a counter with a kettle on its brazier, lanterns. Its keeper's place is a spot.
 */
export function teahouse(B, F, w, d, rng, spot) {
  const K = B.kit.furn;
  const furnish = (room) => {
    const { hw, hd } = room;
    const y = room.y;
    const R0 = K.piece(room, 0, 0);
    R0.box('plainCloth', 0, y + 0.012, 0.4, hw * 2 - 0.4, 0.02, hd * 2 - 2.6, C(0xcdbf88));
    R0.geo('lattice', latticePanel(hw * 2 - 0.4, hd * 2 - 2.6, 1.8), 0, y + 0.026, 0.4, -Math.PI / 2, 0, 0, 1, 1, 1, C(0x5a4a30), true);
    for (const [tx, tz] of [[-hw + 1.6, 0.8], [0.4, 1.4], [hw - 1.6, 0.6]]) {
      const T = K.piece(room, tx, tz);
      T.box('timber', 0, y + 0.3, 0, 1.2, 0.08, 0.8, JP.dark);
      for (const sx of [-1, 1]) T.box('timber', sx * 0.5, y + 0.14, 0, 0.08, 0.28, 0.7, JP.dark);
      for (const [cx, cz] of [[-0.9, 0], [0.9, 0], [0, 0.65]]) T.box('plainCloth', cx, y + 0.05, cz, 0.55, 0.08, 0.55, pick(rng, JP.noren));
      T.geo('plaster', K.MUG, 0.2, y + 0.39, 0.1, 0, 0, 0, 0.9, 0.7, 0.9, C(0x6a7a5a));
      T.collideBox(0, 0, 0.6, 0.4, y - 1, y + 0.35);
    }
    const Cn = K.piece(room, 0, -hd + 1.0);
    Cn.box('timber', 0, y + 0.5, 0, hw * 2 - 2, 1.0, 0.6, JP.wood);
    Cn.box('planks', 0, y + 1.02, 0, hw * 2 - 1.9, 0.06, 0.7, JP.dark);
    Cn.geo('metal', SHAPES.ball, 1.2, y + 1.15, 0, 0, 0, 0, 0.32, 0.26, 0.32);
    Cn.collideBox(0, 0, hw - 1, 0.35, y - 1, y + 1.05);
    for (const lx of [-hw + 1.2, hw - 1.2]) {
      const L = K.piece(room, lx, -0.5);
      L.geo('lamp', SHAPES.lantern, 0, room.ceiling - 0.6, 0, 0, 0, 0, 0.36, 0.42, 0.36, JP.lantern[1]);
      const [x, z] = L.world(0, 0);
      room.lights.push(new THREE.Vector3(x, room.ceiling - 0.7, z));
    }
    keeperSpot(B, room, spot, 0, -hd + 1.8);
  };
  const h = 3.3;
  const { room, base } = walkIn(B, F, { w, d, h, wallKey: 'plaster', wallTint: JP.plaster, footTint: JP.base, name: 'teahouse', furnish });
  F.box('timber', 0, base + 0.5, 0, w + 0.06, 1.0, d + 0.06, JP.dark);
  sideWindows(F, w, d, base + 1.6);
  F.box('plainCloth', 0, base + 2.45, d / 2 + 0.06, 1.6, 0.55, 0.02, JP.noren[1]);
  const y0 = base + h - 0.05;
  const RW = w + 1.8;
  const RD = d + 1.8;
  const rise = Math.min(RW, RD) * 0.34;
  const roofT = pick(rng, JP.roof);
  B.roof(F, 'kawara', RW, RD, rise, y0, roofT, { hip: true, curve: 1.35, up: 0.3 });
  ridge(F, Math.abs(RW - RD) + 0.6, y0 + rise, roofT);
  for (const s of [-1, 1]) paperLantern(B, F, s * 1.6, base + 2.6, d / 2 + 0.7, JP.lantern[0], s > 0, 1.2);
  room.finish(y0 + rise);
  return { top: y0 + rise };
}

// A wooden lamp post with a paper lantern under a little roof.
export function jpLamp(B, F) {
  const g = F.ground(0, 0);
  F.box('stone', 0, g + 0.1, 0, 0.4, 0.3, 0.4, JP.stone);
  F.box('timber', 0, g + 1.3, 0, 0.14, 2.4, 0.14, JP.dark);
  F.box('paper', 0, g + 2.25, 0, 0.34, 0.5, 0.34, JP.paper);
  for (let k = 0; k < 4; k++) B.lattice(F, 0.34, 0.5, Math.sin((k * Math.PI) / 2) * 0.18, g + 2.25, Math.cos((k * Math.PI) / 2) * 0.18, JP.dark, 0.17, (k * Math.PI) / 2);
  F.geo('kawara', SHAPES.cone, 0, g + 2.66, 0, 0, Math.PI / 4, 0, 0.75, 0.3, 0.75, JP.roof[0]);
  B.lamp(F, 0, g + 2.25, 0);
  F.collideCircle(0, 0, 0.22, g - 1, g + 2.8);
}

/*
 * The keep of Sakuragawa's lord: a tower of four storeys, each smaller than the one
 * below, white walls and dark windows under sweeping grey roofs, on a battered
 * stone base; gilded fish ride the top ridge. Round it, a square of stone walls
 * with corner turrets, a gate tower facing the town, and a shallow moat.
 */
export function japaneseCastle(B, x, z) {
  const ctx = B.ctx;
  const F = B.frame(x, z, Math.PI / 2); // facing east, to the town
  const g = F.ground(0, 0);
  const roofT = JP.roof[1];
  // The keep.
  const baseH = 6.5;
  F.geo('stone', frustumGeometry(30, 26, 24.5, 20.5, baseH + 1.5), 0, g - 1.5, 0, 0, 0, 0, 1, 1, 1, JP.stone);
  let y = g + baseH;
  const tiers = [[21, 17, 5.0], [16, 12.5, 4.4], [11.5, 9, 4.0], [8, 6.5, 3.6]];
  tiers.forEach(([w, d, h], i) => {
    F.box('plaster', 0, y + h / 2, 0, w, h, d, JP.plaster);
    F.box('timber', 0, y + 0.15, 0, w + 0.1, 0.3, d + 0.1, JP.dark);
    const n = Math.max(2, Math.round(w / 4));
    for (let k = 0; k < n; k++) {
      const a = -w / 2 + ((k + 0.5) * w) / n;
      for (const s of [-1, 1]) F.box('timber', a, y + h * 0.55, s * (d / 2 + 0.03), 1.0, 1.0, 0.08, JP.dark);
    }
    const m = Math.max(2, Math.round(d / 4));
    for (let k = 0; k < m; k++) {
      const a = -d / 2 + ((k + 0.5) * d) / m;
      for (const s of [-1, 1]) F.box('timber', s * (w / 2 + 0.03), y + h * 0.55, a, 0.08, 1.0, 1.0, JP.dark);
    }
    const top = i === tiers.length - 1;
    const RW = w + (top ? 3.0 : 3.6);
    const RD = d + (top ? 3.0 : 3.6);
    const rise = top ? 3.6 : 2.4;
    B.roof(F, 'kawara', RW, RD, rise, y + h - 0.1, roofT, { hip: true, curve: 1.6, up: top ? 0.8 : 0.65, skirt: 0.24 });
    if (!top) {
      // A small decorative gable on the front slope.
      F.geo('plaster', gableWall(4, 4.6, 1.6, 1.3, 0.3), RW / 2 - 1.2, y + h + 0.25, 0, 0, 0, 0, 1, 1, 1, JP.plaster);
      B.roof(F, 'kawara', 1.6, 5.0, 1.7, y + h + 0.2, roofT, { hip: false, curve: 1.3, up: 0.2 }, RW / 2 - 1.0, 0, Math.PI / 2);
    } else {
      const len = Math.abs(RW - RD) + 0.6;
      F.box('kawara', 0, y + h - 0.1 + rise + 0.1, 0, len, 0.3, 0.4, dark(roofT));
      for (const s of [-1, 1]) {
        F.box('gold', s * (len / 2), y + h + rise + 0.55, 0, 0.3, 0.9, 0.3, WHITE, 0, 0, s * 0.35);
        F.box('gold', s * (len / 2 - 0.25), y + h + rise + 1.0, 0, 0.5, 0.18, 0.22, WHITE, 0, 0, -s * 0.5);
      }
    }
    y += h;
  });
  F.collideBox(0, 0, 15, 13, g - 2, y + 5);
  B.occupy(F, 16, 14);

  // The walls: battered stone with a plastered parapet and tiled coping.
  const R = 40;
  const corners = [[-R, -R], [R, -R], [R, R], [-R, R]];
  for (let k = 0; k < 4; k++) {
    const [ax, az] = corners[k];
    const [bx, bz] = corners[(k + 1) % 4];
    // The side at local +Z faces the town; its gate tower leaves a gap in the wall.
    const runs = k === 2 ? [[R, R, 9.8, R], [-9.8, R, -R, R]] : [[ax, az, bx, bz]];
    for (const [x0, z0, x1, z1] of runs) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const W = B.frame(...F.world((x0 + x1) / 2, (z0 + z1) / 2), F.rot + Math.atan2(-(z1 - z0), x1 - x0));
      const gw = W.ground(0, 0);
      const [lo] = B.span(W, len / 2, 1.5);
      W.geo('stone', frustumGeometry(len, 3.6, len, 2.4, gw - lo + 4.5), 0, lo - 0.8, 0, 0, 0, 0, 1, 1, 1, JP.stone);
      W.box('plaster', 0, gw + 4.9, 0, len, 1.6, 0.5, JP.plaster);
      W.box('kawara', 0, gw + 5.8, 0, len + 0.3, 0.22, 1.1, roofT);
      W.collideBox(0, 0, len / 2, 1.6, lo - 2, gw + 6.5);
      B.occupy(W, len / 2, 2);
    }
    // Corner turret.
    const T = B.frame(...F.world(ax, az), F.rot);
    const gt = T.ground(0, 0);
    T.geo('stone', frustumGeometry(9, 9, 7.6, 7.6, 6.5), 0, gt - 1, 0, 0, 0, 0, 1, 1, 1, JP.stone);
    T.box('plaster', 0, gt + 7.3, 0, 6.4, 3.2, 6.4, JP.plaster);
    T.box('timber', 0, gt + 7.6, 3.23, 1.0, 0.9, 0.06, JP.dark);
    B.roof(T, 'kawara', 8.6, 8.6, 2.6, gt + 8.85, roofT, { hip: true, curve: 1.5, up: 0.55 });
    T.collideBox(0, 0, 4.5, 4.5, gt - 2, gt + 12);
    B.occupy(T, 4.6, 4.6);
  }
  // The gate tower straddling the way in.
  {
    const G = B.frame(...F.world(0, R), F.rot + Math.PI / 2);
    const gt = G.ground(0, 0);
    for (const s of [-1, 1]) {
      G.geo('stone', frustumGeometry(4, 4.2, 3.4, 3.4, 5.5), 0, gt - 1, s * 7.6, 0, 0, 0, 1, 1, 1, JP.stone);
      G.collideBox(0, s * 7.6, 2, 2.1, gt - 2, gt + 10);
    }
    G.box('plaster', 0, gt + 6.6, 0, 4.4, 2.6, 19.2, JP.plaster);
    G.box('timber', 0, gt + 5.45, 0, 4.6, 0.4, 19.4, JP.dark);
    for (let k = -3; k <= 3; k++) G.box('timber', 2.25, gt + 6.8, k * 2.4, 0.06, 0.8, 1.0, JP.dark);
    B.roof(G, 'kawara', 6.6, 21.4, 2.4, gt + 7.85, roofT, { hip: true, curve: 1.5, up: 0.5 }, 0, 0);
    for (const s of [-1, 1]) {
      G.box('timber', 0.5, gt + 2.6, s * 5.0, 0.5, 5.2, 0.5, JP.dark);
      G.box('planks', 1.4, gt + 2.0, s * 4.0, 2.0, 4.0, 0.14, JP.dark, 0, s * 0.9, 0);
    }
    G.collideBox(0, 0, 2.2, 9.6, gt + 4.8, gt + 11);
    B.occupy(G, 2.5, 9.8);
  }
  // A moat outside the walls, broken by the causeway to the gate.
  const M = R + 6.5;
  for (const [cx, cz, sx, sz] of [[0, -M, 2 * M + 6, 5], [-M, 0, 5, 2 * M - 4], [M, 0, 5, 2 * M - 4]]) {
    const W = B.frame(...F.world(cx, cz), F.rot);
    const gw = W.ground(0, 0);
    W.box('pool', 0, gw + 0.12, 0, sx, 0.06, sz, C(0x7aa0a0));
    W.box('stone', 0, gw + 0.05, 0, sx + 1, 0.3, sz + 1, JP.base);
  }
  for (const s of [-1, 1]) {
    const W = B.frame(...F.world(s * (M / 2 + 4), M), F.rot);
    const gw = W.ground(0, 0);
    W.box('pool', 0, gw + 0.12, 0, M - 8, 0.06, 5, C(0x7aa0a0));
    W.box('stone', 0, gw + 0.05, 0, M - 7, 0.3, 6, JP.base);
  }
  ctx.world.castleKeep = { x, z };
}

/*
 * A red-lacquered bridge arching over the river from (x, z0) to (x, z1): its deck
 * is a walkable surface that rises and falls, with rails and posts capped in brass.
 */
export function redBridge(B, x, z0, z1, rise = 3.2, width = 3.6) {
  const ctx = B.ctx;
  const L = z1 - z0;
  const F = B.frame(x, (z0 + z1) / 2, 0);
  const g0 = ctx.ground(x, z0);
  const g1 = ctx.ground(x, z1);
  const deck = (z) => {
    const t = Math.min(1, Math.max(0, (z - z0) / L));
    return g0 + (g1 - g0) * t + rise * Math.sin(Math.PI * t);
  };
  const n = Math.ceil(L / 2);
  for (let i = 0; i < n; i++) {
    const za = z0 + (i * L) / n;
    const zb = z0 + ((i + 1) * L) / n;
    const ya = deck(za);
    const yb = deck(zb);
    const len = Math.hypot(zb - za, yb - ya);
    const tilt = -Math.atan2(yb - ya, zb - za);
    const cz = (za + zb) / 2 - F.z;
    F.box('planks', 0, (ya + yb) / 2 - 0.08, cz, width, 0.16, len + 0.05, C(0x8a5a3a), tilt);
    F.box('timber', 0, (ya + yb) / 2 - 0.3, cz, width + 0.2, 0.3, len + 0.05, JP.red, tilt);
    for (const s of [-1, 1]) F.box('timber', s * (width / 2 + 0.05), (ya + yb) / 2 + 0.85, cz, 0.12, 0.1, len + 0.05, JP.red, tilt);
  }
  for (let i = 0; i <= n; i += 2) {
    const z = z0 + (i * L) / n;
    const y = deck(z);
    for (const s of [-1, 1]) {
      F.box('timber', s * (width / 2 + 0.05), y + 0.45, z - F.z, 0.16, 0.95, 0.16, JP.red);
      F.geo('gold', SHAPES.ball, s * (width / 2 + 0.05), y + 0.98, z - F.z, 0, 0, 0, 0.2, 0.2, 0.2);
    }
    if (i % 4 === 2) {
      const gy = Math.min(ctx.ground(x - width / 2, z), ctx.ground(x + width / 2, z));
      if (y - gy > 1) for (const s of [-1, 1]) B.col(F, 'timber', s * (width / 2 - 0.3), gy - 0.5, z - F.z, 0.18, y - gy + 0.2, dark(JP.red, 0.7));
    }
  }
  for (const s of [-1, 1]) F.collideBox(s * (width / 2 + 0.06), 0, 0.08, L / 2, Math.min(g0, g1) - 3, Math.max(g0, g1) + rise + 1.4);
  // Surface heights are asked for in the surface's own frame (here, z from its middle).
  ctx.world.surfaces.push({ ...B.kit.rect(x, (z0 + z1) / 2, width / 2, L / 2, 0), height: (lx, lz) => deck((z0 + z1) / 2 + lz) });
  ctx.occupy(B.kit.rect(x, (z0 + z1) / 2, width / 2 + 0.4, L / 2 + 1, 0));
}

// A garden pond with stones round it and a little arched bridge across.
export function jpGarden(B, x, z, r = 12) {
  const F = B.frame(x, z, 0.3);
  const g = F.ground(0, 0);
  F.geo('pool', SHAPES.disc, 0, g + 0.15, 0, 0, 0, 0, r * 2, 0.06, r * 1.4, C(0x6a9a8a));
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * TAU;
    const s = 0.7 + ((k * 37) % 7) / 8;
    F.geo('crag', SHAPES.rock, Math.cos(a) * r, g + 0.2, Math.sin(a) * r * 0.7, k, a, 0, s * 1.4, s, s * 1.2, C(0x9a968a));
  }
  // The bridge over its middle.
  for (let i = 0; i < 7; i++) {
    const t = (i + 0.5) / 7;
    const lx = (t - 0.5) * r * 0.9;
    const y = g + 0.3 + Math.sin(Math.PI * t) * 1.2;
    const tilt = Math.cos(Math.PI * t) * 0.5;
    F.box('timber', lx, y, 0, r * 0.9 / 7 + 0.05, 0.12, 1.6, JP.red, 0, 0, tilt);
    for (const s of [-1, 1]) F.box('timber', lx, y + 0.55, s * 0.8, r * 0.9 / 7 + 0.05, 0.08, 0.08, JP.red, 0, 0, tilt);
  }
  for (const [lx, lz] of [[-r - 3, -3], [r + 2, 4], [-2, r * 0.7 + 3], [4, -r * 0.7 - 2]]) B.tree(...F.world(lx, lz), 'sakura', 0.9);
  F.collideBox(0, 0, r, r * 0.7, g - 1, g + 0.4);
  B.occupy(F, r + 1, r * 0.7 + 1);
}

// ======================================================= Jade Lantern Quarter

export const CN = {
  brick: C(0x8f9298), brickDark: C(0x6e7076), red: C(0xa8302a), lacquer: C(0x7e2420), green: C(0x2e6a58), blue: C(0x2c4e7c),
  roofGrey: C(0x575a61), roofGreen: C(0x3f7d52), roofYellow: C(0xd9a62e), roofBlue: C(0x2f5c8a), paper: C(0xf6e8cc),
  stone: C(0xb0aca2), lantern: C(0xff3a26), sign: C(0x2a1a14),
};

function chineseRoof(B, F, w, d, y, tint, o = {}) {
  const RW = w + (o.over ?? 2.0);
  const RD = d + (o.over ?? 2.0);
  const rise = RD * (o.pitch ?? 0.36);
  const hip = o.hip ?? false;
  B.roof(F, 'kawara', RW, RD, rise, y, tint, { hip, curve: 1.7, up: o.up ?? 0.55, skirt: 0.22 }, o.cx || 0, o.cz || 0);
  const len = hip ? Math.abs(RW - RD) + 0.4 : RW;
  const ry = y + rise;
  F.box('kawara', o.cx || 0, ry + 0.15, o.cz || 0, len, 0.36, 0.42, dark(tint, 0.8));
  for (const s of [-1, 1]) F.box('kawara', (o.cx || 0) + s * (len / 2), ry + 0.45, o.cz || 0, 0.3, 0.75, 0.45, dark(tint, 0.65), 0, 0, s * 0.3);
  return { rise, RW, RD, top: ry };
}

/*
 * A hall on a raised platform: red columns along a veranda, lattice doors over paper,
 * a painted beam under the eaves, and a curved tiled roof (gabled or hipped).
 */
export function cnHall(B, F, w, d, rng, o = {}) {
  const lift = o.lift ?? 0.6;
  const { base, bottom } = B.footing(F, w / 2, d / 2, { tint: CN.stone, lift, pad: 0.5 });
  const h = o.h ?? 3.6;
  const inset = 0.9;
  const zf = d / 2 - inset;
  F.box('stone', 0, base + h / 2, (zf - d / 2) / 2, w - 0.4, h, zf + d / 2 - 0.2, CN.brick);
  F.box('timber', 0, base + h / 2, zf - 0.05, w - 0.6, h - 0.1, 0.1, CN.lacquer);
  F.box('paper', 0, base + h / 2 + 0.1, zf + 0.012, w - 1.4, h - 1.1, 0.02, CN.paper);
  B.lattice(F, w - 1.4, h - 1.1, 0, base + h / 2 + 0.1, zf + 0.05, CN.red, 0.32);
  const n = Math.max(2, Math.round(w / 3.2)) + 1;
  for (let k = 0; k < n; k++) {
    const cx = -w / 2 + 0.35 + (k * (w - 0.7)) / (n - 1);
    B.col(F, 'timber', cx, base, d / 2 - 0.35, 0.17, h, CN.red);
    F.collideCircle(cx, d / 2 - 0.35, 0.2, bottom, base + h);
  }
  F.box('timber', 0, base + h - 0.25, d / 2 - 0.35, w - 0.1, 0.42, 0.32, o.beam || (rng() < 0.5 ? CN.green : CN.blue));
  F.box('gold', 0, base + h - 0.48, d / 2 - 0.18, w - 0.1, 0.06, 0.04);
  const roof = chineseRoof(B, F, w, d, base + h - 0.05, o.roof || CN.roofGrey, { hip: o.hip, pitch: o.pitch, up: o.up });
  if (!o.hip) for (const s of [-1, 1]) F.geo('stone', gableWall(d - 0.6, roof.RD, roof.rise, 1.7), s * (w / 2 - 0.31), base + h - 0.05, 0, 0, 0, 0, 1, 1, 1, CN.brick);
  if (lift > 0.3) F.box('stone', 0, base - lift / 2 - 0.05, d / 2 + 0.55, 2.6, lift, 0.9, CN.stone);
  F.collideBox(0, (zf - d / 2) / 2, w / 2 - 0.2, (zf + d / 2) / 2 - 0.1, bottom, roof.top + 0.6);
  B.occupy(F, w / 2 + 0.3, d / 2 + 0.3);
  return { base, top: roof.top };
}

/*
 * A siheyuan: a walled courtyard house. Grey brick walls with tiled coping, a red gate
 * under its own roof in the front corner and a screen wall behind it; inside, the
 * main hall faces the gate side across a courtyard flanked by two side halls.
 */
export function siheyuan(B, F, W, D, rng) {
  const [lo, hi] = B.span(F, W / 2, D / 2);
  const T = 0.5;
  const wallH = 3.0;
  const y0 = lo - 0.6;
  const y1 = hi + wallH;
  const ym = (y0 + y1) / 2;
  const hh = y1 - y0;
  const gx = W / 2 - 2.8;
  const gw = 2.4;
  const runs = [
    [0, -D / 2 + T / 2, W, T],
    [-W / 2 + T / 2, 0, T, D - 2 * T],
    [W / 2 - T / 2, 0, T, D - 2 * T],
    [(-W / 2 + gx - gw / 2) / 2, D / 2 - T / 2, gx - gw / 2 + W / 2, T],
    [(gx + gw / 2 + W / 2) / 2, D / 2 - T / 2, W / 2 - gx - gw / 2, T],
  ];
  for (const [cx, cz, sx, sz] of runs) {
    F.box('stone', cx, ym, cz, sx, hh, sz, CN.brick);
    F.box('kawara', cx, y1 + 0.1, cz, sx + (sx > sz ? 0.2 : 0.7), 0.2, sz + (sz > sx ? 0.2 : 0.7), CN.roofGrey);
    F.collideBox(cx, cz, sx / 2, sz / 2, y0 - 1, y1 + 0.5);
  }
  // The gate.
  const gz = D / 2 - T / 2;
  for (const s of [-1, 1]) F.box('timber', gx + s * (gw / 2 + 0.15), y0 + hh / 2 + 0.2, gz, 0.3, hh + 0.4, T + 0.3, CN.red);
  F.box('timber', gx, y1 - 0.15, gz, gw + 0.6, 0.35, T + 0.35, CN.green);
  for (const s of [-1, 1]) F.box('planks', gx + s * (gw / 2 - 0.08), hi + 1.15, gz - 0.65, 0.1, 2.3, 1.15, CN.red, 0, s * 0.15, 0);
  B.roof(F, 'kawara', gw + 2.0, T + 2.4, 0.9, y1 + 0.25, CN.roofGrey, { hip: false, curve: 1.6, up: 0.25 }, gx, gz);
  F.box('kawara', gx, y1 + 1.2, gz, gw + 2.0, 0.26, 0.3, dark(CN.roofGrey, 0.8));
  // The screen wall inside it.
  F.box('stone', gx, (lo + hi) / 2 + 1.0, D / 2 - 3.0, 3.4, hi - lo + 2.6, 0.45, CN.brick);
  F.box('kawara', gx, hi + 2.4, D / 2 - 3.0, 3.8, 0.2, 0.8, CN.roofGrey);
  F.collideBox(gx, D / 2 - 3.0, 1.7, 0.25, y0 - 1, hi + 2.6);
  // The halls.
  const sub = (lx, lz, turn) => B.frame(...F.world(lx, lz), F.rot + turn);
  const mainD = 6.4;
  cnHall(B, sub(0, -D / 2 + T + mainD / 2 + 0.2, 0), W - 2.6, mainD, rng, { lift: 0.5, h: 3.4 });
  const sideW = Math.max(6, D - 15);
  cnHall(B, sub(-W / 2 + T + 2.4, 0.5, Math.PI / 2), sideW, 4.2, rng, { lift: 0.35, h: 3.0, up: 0.35 });
  cnHall(B, sub(W / 2 - T - 2.4, 0.5, -Math.PI / 2), sideW, 4.2, rng, { lift: 0.35, h: 3.0, up: 0.35 });
  // A tree and a lantern in the courtyard.
  B.tree(...F.world(-1.6, 2.2), rng() < 0.5 ? 'oakB' : 'sakura', 0.55);
  return { top: y1 + 6 };
}

/*
 * A shophouse: an open shop front with a counter of wares between red posts, a lattice
 * upper floor with a balcony, a curved roof, a signboard and two red lanterns.
 */
export function cnShop(B, F, w, d, rng) {
  const { base, bottom } = B.footing(F, w / 2, d / 2, { tint: CN.stone, lift: 0.3 });
  const h1 = 3.2;
  const h2 = 2.8;
  const roofT = rng() < 0.15 ? CN.roofGreen : CN.roofGrey;
  F.box('stone', 0, base + h1 / 2, -0.6, w, h1, d - 1.2, CN.brick);
  F.box('timber', 0, base + 0.5, d / 2 - 1.0, w - 1.2, 1.0, 0.5, CN.lacquer);
  for (let k = 0; k < 4; k++) {
    F.box('plainCloth', -w / 2 + 1.2 + k * ((w - 2.4) / 3), base + 1.12, d / 2 - 1.0, 0.5, 0.25, 0.35, pick(rng, [C(0xd8a830), C(0x6a9a38), C(0xc23a2a), C(0xe8e0d0), C(0x8a5a3a)]));
  }
  for (const s of [-1, 1]) B.col(F, 'timber', s * (w / 2 - 0.2), base, d / 2 - 0.2, 0.16, h1, CN.red);
  F.box('timber', 0, base + h1 + h2 / 2, 0, w, h2, d, CN.lacquer);
  F.box('paper', 0, base + h1 + 1.35, d / 2 + 0.012, w - 1.2, 1.5, 0.02, CN.paper);
  B.lattice(F, w - 1.2, 1.5, 0, base + h1 + 1.35, d / 2 + 0.05, CN.red, 0.25);
  F.box('planks', 0, base + h1 + 0.05, d / 2 + 0.45, w, 0.12, 0.9, CN.lacquer);
  B.slats(F, w, 0.8, 0, base + h1 + 0.5, d / 2 + 0.88, CN.red, 0.22);
  F.box('kawara', 0, base + h1 - 0.15, d / 2 + 0.2, w + 0.2, 0.07, 1.0, roofT, 0.3, 0, 0);
  const y0 = base + h1 + h2 - 0.05;
  const r = chineseRoof(B, F, w, d, y0, roofT, { over: 1.2, pitch: 0.3, up: 0.4 });
  for (const s of [-1, 1]) F.geo('stone', gableWall(d, r.RD, r.rise, 1.7), s * (w / 2 - 0.11), y0, 0, 0, 0, 0, 1, 1, 1, CN.brick);
  // Signboard and lanterns.
  const sx = (rng() < 0.5 ? -1 : 1) * (w / 2 - 0.5);
  F.box('timber', sx, base + h1 - 1.2, d / 2 + 0.3, 0.55, 1.8, 0.06, CN.sign);
  F.box('gold', sx, base + h1 - 1.2, d / 2 + 0.335, 0.4, 1.6, 0.02, WHITE);
  for (const s of [-1, 1]) {
    F.geo('lamp', SHAPES.lantern, s * (w / 2 - 1.2), base + h1 + h2 - 0.6, d / 2 + 0.95, 0, 0, 0, 0.5, 0.55, 0.5, CN.lantern);
    F.box('gold', s * (w / 2 - 1.2), base + h1 + h2 - 0.25, d / 2 + 0.95, 0.24, 0.06, 0.24, WHITE);
  }
  if (rng() < 0.35) B.lamp(F, w / 2 - 1.2, base + h1 + h2 - 0.6, d / 2 + 0.95);
  F.collideBox(0, -0.6, w / 2, d / 2 - 0.6, bottom, r.top + 0.6);
  F.collideBox(0, d / 2 - 1.0, w / 2 - 0.6, 0.25, bottom, base + 1.1);
  return { top: r.top };
}

/*
 * A plain house of the quarter: grey brick under a curved gabled roof, a red door
 * between two lattice windows, and on some a red lantern by the door.
 */
export function cnHouse(B, F, w, d, rng) {
  const { base, bottom } = B.footing(F, w / 2, d / 2, { tint: CN.stone, lift: 0.3 });
  const h = 3.2;
  const roofT = rng() < 0.12 ? CN.roofGreen : CN.roofGrey;
  F.box('stone', 0, base + h / 2, 0, w, h, d, rng() < 0.3 ? CN.brickDark : CN.brick);
  F.box('stone', 0, base + h - 0.2, 0, w + 0.1, 0.4, d + 0.1, CN.brickDark);
  const doorX = (rng() - 0.5) * (w - 3);
  F.box('planks', doorX, base + 1.1, d / 2 + 0.03, 1.2, 2.2, 0.06, CN.red);
  F.box('timber', doorX, base + 2.3, d / 2 + 0.06, 1.6, 0.22, 0.1, CN.lacquer);
  for (const s of [-1, 1]) {
    const wx = doorX + s * 2.0;
    if (Math.abs(wx) > w / 2 - 0.8) continue;
    F.box('paper', wx, base + 1.6, d / 2 + 0.012, 1.1, 1.0, 0.02, CN.paper);
    B.lattice(F, 1.1, 1.0, wx, base + 1.6, d / 2 + 0.05, CN.red, 0.22);
  }
  const y0 = base + h - 0.05;
  const r = chineseRoof(B, F, w, d, y0, roofT, { over: 1.2, pitch: 0.32, up: 0.35 });
  for (const s of [-1, 1]) F.geo('stone', gableWall(d, r.RD, r.rise, 1.7), s * (w / 2 - 0.11), y0, 0, 0, 0, 0, 1, 1, 1, CN.brick);
  if (rng() < 0.4) {
    F.geo('lamp', SHAPES.lantern, doorX + 1.0, base + 2.5, d / 2 + 0.5, 0, 0, 0, 0.45, 0.5, 0.45, CN.lantern);
    if (rng() < 0.4) B.lamp(F, doorX + 1.0, base + 2.5, d / 2 + 0.5);
  }
  F.collideBox(0, 0, w / 2, d / 2, bottom, r.top + 0.6);
  return { top: r.top };
}

// A paifang: a gateway of four posts and three bays, under three little roofs.
export function paifang(B, F, span = 12) {
  const g = F.ground(0, 0);
  const posts = [-span / 2, -span / 6, span / 6, span / 2];
  const H = 6.0;
  for (const px of posts) {
    F.box('stone', px, g + 0.4, 0, 1.0, 0.8, 1.4, CN.stone);
    F.box('timber', px, g + H / 2, 0, 0.55, H, 0.55, CN.red);
    F.collideBox(px, 0, 0.5, 0.7, g - 1, g + H);
  }
  for (const [cx, w, y, r] of [[0, span / 3 + 0.8, g + H + 0.2, 1.2], [-span / 3, span / 3, g + H - 0.8, 1.0], [span / 3, span / 3, g + H - 0.8, 1.0]]) {
    F.box('timber', cx, y - 0.65, 0, w, 0.5, 0.45, CN.green);
    F.box('gold', cx, y - 0.65, 0.24, w * 0.4, 0.38, 0.04, WHITE);
    F.box('timber', cx, y - 0.2, 0, w + 0.3, 0.35, 0.6, CN.blue);
    B.roof(F, 'kawara', w + 1.2, 2.0, r, y, CN.roofGreen, { hip: true, curve: 1.6, up: 0.4 }, cx, 0);
  }
  B.occupy(F, span / 2 + 0.8, 1);
}

/*
 * The drum tower over the north end of the avenue: a brick base with an arched way
 * through it, and on top a two-roofed pavilion of red columns with the great drum.
 */
export function drumTower(B, F) {
  const g = F.ground(0, 0);
  const W = 22;
  const D = 14;
  const H = 8.5;
  const [lo] = B.span(F, W / 2, D / 2);
  F.geo('stone', archPanel(W, H + (g - lo) + 0.5, 5.5, 6.6 + (g - lo), false, D), 0, lo - 0.5, 0, 0, 0, 0, 1, 1, 1, CN.brickDark);
  F.box('stone', 0, g + H + 0.2, 0, W + 0.6, 0.4, D + 0.6, CN.brick);
  for (const s of [-1, 1]) F.collideBox(s * (W / 4 + 1.4), 0, W / 4 - 1.4, D / 2, lo - 2, g + H + 0.5);
  F.collideBox(0, 0, 2.8, D / 2, g + 6.0, g + H + 0.5);
  // The pavilion.
  const y = g + H + 0.4;
  const pw = W - 5;
  const pd = D - 4;
  F.box('timber', 0, y + 2.4, 0, pw - 1.2, 4.8, pd - 1.2, CN.lacquer);
  F.box('paper', 0, y + 2.6, (pd - 1.2) / 2 + 0.012, pw - 2.2, 3.4, 0.02, CN.paper);
  B.lattice(F, pw - 2.2, 3.4, 0, y + 2.6, (pd - 1.2) / 2 + 0.05, CN.red, 0.35);
  for (let k = 0; k < 6; k++) {
    const cx = -pw / 2 + (k * pw) / 5;
    for (const s of [-1, 1]) B.col(F, 'timber', cx, y, s * (pd / 2), 0.25, 5.2, CN.red);
  }
  F.box('timber', 0, y + 5.0, 0, pw + 0.4, 0.45, pd + 0.4, CN.green);
  chineseRoof(B, F, pw, pd, y + 5.15, CN.roofGreen, { hip: true, pitch: 0.12, up: 0.7, over: 3.2 });
  F.box('timber', 0, y + 7.0, 0, pw - 4, 2.4, pd - 3, CN.lacquer);
  chineseRoof(B, F, pw - 4, pd - 3, y + 8.1, CN.roofGreen, { hip: true, pitch: 0.42, up: 0.75, over: 3.0 });
  B.occupy(F, W / 2 + 0.5, D / 2 + 0.5);
  B.lamp(F, 0, y + 3, pd / 2 + 1);
}

// A hexagonal garden pavilion: six red columns under a flared roof.
export function pavilion(B, F, r = 2.6) {
  const g = F.ground(0, 0);
  F.geo('stone', SHAPES.cyl6, 0, g + 0.3, 0, 0, 0, 0, r * 2 + 0.8, 0.6, r * 2 + 0.8, CN.stone);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU;
    B.col(F, 'timber', Math.sin(a) * r, g + 0.6, Math.cos(a) * r, 0.13, 2.8, CN.red);
    F.collideCircle(Math.sin(a) * r, Math.cos(a) * r, 0.18, g - 1, g + 3.4);
  }
  F.geo('timber', SHAPES.cyl6, 0, g + 3.4, 0, 0, 0, 0, r * 2 + 0.4, 0.3, r * 2 + 0.4, CN.green);
  F.geo('kawara', flaredRoof(r + 1.4, 2.6, 6, 0.4), 0, g + 3.55, 0, 0, 0, 0, 1, 1, 1, CN.roofGreen);
  F.geo('gold', SHAPES.ball, 0, g + 6.3, 0, 0, 0, 0, 0.4, 0.5, 0.4);
  ctxSurface(B, F, r + 0.4, g + 0.6);
  B.occupy(F, r + 0.6, r + 0.6);
}

function ctxSurface(B, F, r, y) {
  B.ctx.world.surfaces.push({ ...B.kit.rect(F.x, F.z, r * 0.8, r * 0.8, F.rot), height: () => y });
}

/*
 * A classical garden: a pond with rocks and willows, a zigzag bridge to a pavilion,
 * and a white wall round it pierced by a round moon gate.
 */
export function cnGarden(B, x, z, W = 44, D = 34) {
  const F = B.frame(x, z, 0);
  const g = F.ground(0, 0);
  F.geo('pool', SHAPES.disc, -2, g + 0.15, 2, 0, 0, 0, W * 0.6, 0.06, D * 0.5, C(0x5a8a7a));
  for (let k = 0; k < 22; k++) {
    const a = (k / 22) * TAU;
    const s = 0.8 + ((k * 29) % 9) / 7;
    F.geo('crag', SHAPES.rock, -2 + Math.cos(a) * W * 0.3, g + 0.3, 2 + Math.sin(a) * D * 0.25, k, a * 3, 0, s * 1.2, s * 1.6, s, C(0xb0aca0));
  }
  F.collideBox(-2, 2, W * 0.28, D * 0.22, g - 1, g + 0.3);
  // Zigzag bridge from the south bank to the pavilion on its island.
  let px = -6;
  let pz = D * 0.27;
  for (let k = 0; k < 4; k++) {
    const nx = px + (k % 2 ? -3 : 3);
    const nz = pz - 3.2;
    const len = Math.hypot(nx - px, nz - pz);
    const rot = Math.atan2(nx - px, nz - pz);
    const S = B.frame(...F.world((px + nx) / 2, (pz + nz) / 2), rot);
    S.box('stone', 0, g + 0.3, 0, 1.6, 0.2, len + 0.8, CN.stone);
    for (const s of [-1, 1]) S.box('stone', s * 0.75, g + 0.7, 0, 0.1, 0.5, len + 0.8, CN.stone);
    B.ctx.world.surfaces.push({ ...B.kit.rect(S.x, S.z, 0.8, len / 2 + 0.4, rot), height: () => g + 0.4 });
    px = nx;
    pz = nz;
  }
  pavilion(B, B.frame(...F.world(px, pz - 3), 0), 2.6);
  // The wall with its moon gate (south side) and plain runs on the others.
  const wallH = 3.2;
  const wall = (cx, cz, len, rot, gate) => {
    const Wf = B.frame(...F.world(cx, cz), rot);
    const gw = Wf.ground(0, 0);
    if (gate) {
      Wf.geo('plaster', archPanel(8, wallH + 1, 3.4, 3.6, true, 0.5), 0, gw - 0.5, 0, 0, 0, 0, 1, 1, 1, WHITE);
      for (const s of [-1, 1]) {
        const seg = (len - 8) / 2;
        Wf.box('plaster', s * (4 + seg / 2), gw + (wallH - 0.5) / 2, 0, seg, wallH + 0.5, 0.5, WHITE);
        Wf.collideBox(s * (4 + seg / 2), 0, seg / 2, 0.3, gw - 1, gw + wallH);
        Wf.collideBox(s * 2.75, 0, 1.25, 0.3, gw - 1, gw + wallH);
      }
    } else {
      Wf.box('plaster', 0, gw + (wallH - 0.5) / 2, 0, len, wallH + 0.5, 0.5, WHITE);
      Wf.collideBox(0, 0, len / 2, 0.3, gw - 1, gw + wallH);
    }
    Wf.box('kawara', 0, gw + wallH + 0.1, 0, len + 0.3, 0.22, 1.0, CN.roofGrey);
    B.occupy(Wf, len / 2, 0.5);
  };
  wall(0, D / 2, W, 0, true);
  wall(0, -D / 2, W, 0, false);
  wall(-W / 2, 0, D, Math.PI / 2, false);
  wall(W / 2, 0, D, Math.PI / 2, false);
  for (const [lx, lz] of [[-W / 2 + 4, -D / 2 + 4], [W / 2 - 5, -D / 2 + 5], [W / 2 - 4, D / 2 - 6], [-W / 2 + 6, D / 2 - 5], [8, -4]]) B.tree(...F.world(lx, lz), 'oakB', 0.7);
  B.tree(...F.world(-W / 2 + 10, -D / 2 + 3), 'bamboo', 1);
  B.tree(...F.world(W / 2 - 10, D / 2 - 3), 'bamboo', 1);
  B.occupy(F, W / 2, D / 2);
}

/*
 * The Jade Lantern, the quarter's eating house, which you can walk into: round tables
 * with stools, a counter with steaming baskets, red lanterns hung from the beams.
 */
export function jadeHouse(B, F, rng, spot) {
  const K = B.kit.furn;
  const w = 14;
  const d = 10;
  const h = 3.6;
  const furnish = (room) => {
    const { hw, hd } = room;
    const y = room.y;
    for (const [tx, tz] of [[-hw + 2, 0.6], [0, 1.6], [hw - 2, 0.4], [-2.4, -1.4], [2.6, -1.2]]) {
      const T = K.piece(room, tx, tz);
      T.geo('planks', SHAPES.disc, 0, y + 0.76, 0, 0, 0, 0, 1.3, 0.06, 1.3, CN.lacquer);
      T.geo('timber', SHAPES.col, 0, y + 0.37, 0, 0, 0, 0, 0.16, 0.74, 0.16, CN.lacquer);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * TAU + 0.4;
        T.geo('planks', SHAPES.cyl8, Math.sin(a) * 0.95, y + 0.24, Math.cos(a) * 0.95, 0, 0, 0, 0.38, 0.48, 0.38, CN.red);
        T.collideCircle(Math.sin(a) * 0.95, Math.cos(a) * 0.95, 0.2, y - 1, y + 0.5);
      }
      T.geo('plaster', K.PLATE, 0.2, y + 0.8, 0.1, 0, 0, 0, 1.2, 1, 1.2, C(0xf2eee4));
      T.geo('plaster', SHAPES.cyl8, -0.25, y + 0.85, -0.1, 0, 0, 0, 0.28, 0.12, 0.28, C(0xc8a868));
      T.collideCircle(0, 0, 0.66, y - 1, y + 0.8);
    }
    const Cn = K.piece(room, 1.2, -hd + 1.0);
    Cn.box('timber', 0, y + 0.5, 0, 4.6, 1.0, 0.6, CN.lacquer);
    Cn.box('planks', 0, y + 1.03, 0, 4.7, 0.06, 0.7, C(0x4a2a1a));
    for (let k = 0; k < 3; k++) {
      for (let j = 0; j < 2; j++) Cn.geo('plaster', SHAPES.cyl8, -1.4 + k * 1.2, y + 1.12 + j * 0.15, 0, 0, 0, 0, 0.55, 0.14, 0.55, C(0xc8a868));
    }
    Cn.collideBox(0, 0, 2.3, 0.32, y - 1, y + 1.1);
    for (const [lx, lz] of [[-hw + 2, 0.6], [hw - 2, 0.4], [0, -1.0]]) {
      const L = K.piece(room, lx, lz);
      L.geo('lamp', SHAPES.lantern, 0, room.ceiling - 0.7, 0, 0, 0, 0, 0.5, 0.55, 0.5, CN.lantern);
      const [x, z] = L.world(0, 0);
      room.lights.push(new THREE.Vector3(x, room.ceiling - 0.8, z));
    }
    keeperSpot(B, room, spot, 1.2, -hd + 0.4);
  };
  const { room, base, bottom } = walkIn(B, F, { w, d, h, wallKey: 'stone', wallTint: CN.brick, footTint: CN.stone, name: 'the Jade Lantern', furnish, lift: 0.45 });
  sideWindows(F, w, d, base + 1.7);
  for (let k = 0; k < 5; k++) {
    const cx = -w / 2 + 0.4 + (k * (w - 0.8)) / 4;
    B.col(F, 'timber', cx, base, d / 2 + 0.9, 0.17, h, CN.red);
    F.collideCircle(cx, d / 2 + 0.9, 0.2, bottom, base + h);
  }
  F.box('stone', 0, base - 0.05, d / 2 + 0.7, w, 0.1, 1.6, CN.stone);
  B.ctx.world.surfaces.push({ ...B.kit.rect(...F.world(0, d / 2 + 0.7), w / 2, 0.8, F.rot), height: () => base });
  F.box('timber', 0, base + h - 0.25, d / 2 + 0.9, w + 0.2, 0.42, 0.32, CN.green);
  for (const s of [-1, 1]) {
    F.box('paper', s * 3.6, base + 1.7, d / 2 + 0.012, 1.6, 1.2, 0.02, CN.paper);
    B.lattice(F, 1.6, 1.2, s * 3.6, base + 1.7, d / 2 + 0.05, CN.red, 0.22);
    F.geo('lamp', SHAPES.lantern, s * 1.6, base + h - 0.8, d / 2 + 1.0, 0, 0, 0, 0.55, 0.6, 0.55, CN.lantern);
  }
  F.box('timber', 0, base + h + 0.3, d / 2 + 0.75, 3.4, 0.9, 0.1, CN.sign);
  F.box('gold', 0, base + h + 0.3, d / 2 + 0.81, 3.0, 0.7, 0.02, WHITE);
  B.lamp(F, 1.6, base + h - 0.8, d / 2 + 1.0);
  const r = chineseRoof(B, F, w, d + 1.8, base + h - 0.05, CN.roofGreen, { hip: true, pitch: 0.34, up: 0.6, cz: 0.9 });
  room.finish(r.top);
  return { top: r.top };
}

// A red lantern on a post with a curved arm, lit at night.
export function cnLamp(B, F) {
  const g = F.ground(0, 0);
  F.box('stone', 0, g + 0.15, 0, 0.45, 0.3, 0.45, CN.stone);
  F.box('timber', 0, g + 1.6, 0, 0.14, 3.2, 0.14, CN.lacquer);
  F.box('timber', 0, g + 3.15, 0.35, 0.1, 0.1, 0.8, CN.lacquer);
  F.geo('lamp', SHAPES.lantern, 0, g + 2.6, 0.7, 0, 0, 0, 0.5, 0.55, 0.5, CN.lantern);
  F.box('gold', 0, g + 2.95, 0.7, 0.22, 0.06, 0.22, WHITE);
  B.lamp(F, 0, g + 2.6, 0.7);
  F.collideCircle(0, 0, 0.22, g - 1, g + 3.3);
}

// ================================================================ Hrafnvik

export const VK = {
  tar: C(0x4e4034), wood: C(0x7a6650), pale: C(0x9a8668), stone: C(0x8e8a80), mossy: C(0x7f8a6e),
  turf: [C(0x5c7a34), C(0x66843a), C(0x58723a), C(0x6e8a40), C(0x74804a)], shield: [C(0xa8302a), C(0x2c4e8a), C(0xd8b040), C(0xe8e0d0), C(0x2e6a3a)],
  sail: C(0xb23a2e),
};

// A round shield on a wall at (x, y, z) in F, facing +Z (turn rotates it).
function shield(F, x, y, z, tint, turn = 0, s = 1) {
  F.geo('timber', SHAPES.disc, x, y, z, Math.PI / 2, turn, 0, 0.9 * s, 0.06, 0.9 * s, tint);
  F.geo('metal', SHAPES.ball, x + Math.sin(turn) * 0.04, y, z + Math.cos(turn) * 0.04, 0, 0, 0, 0.18 * s, 0.18 * s, 0.12 * s);
}

// Crossed gable boards above a ridge end at local x = ex, carved into beasts' heads.
function gableBoards(F, ex, ridgeY, tint) {
  for (const t of [-1, 1]) {
    F.box('timber', ex, ridgeY + 0.25, t * 0.25, 0.12, 2.2, 0.24, tint, t * 0.6, 0, 0);
    F.box('timber', ex, ridgeY + 1.2, t * 0.9, 0.14, 0.24, 0.55, tint, t * 0.6 - t * 0.9, 0, 0);
  }
}

/*
 * A longhouse: low plank walls on a stone footing under a deep hipped roof of turf,
 * with crossed gable boards at both ends of the ridge, a porch at the door, and on
 * some the household's shields hung along the front.
 */
export function longhouse(B, F, L, W, rng) {
  const { base, bottom } = B.footing(F, L / 2, W / 2, { tint: VK.stone, lift: 0.15 });
  const h = 2.5;
  F.box('planks', 0, base + h / 2, 0, L, h, W, vary(rng, VK.tar, 0.1));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) F.box('timber', sx * (L / 2), base + h / 2, sz * (W / 2), 0.32, h + 0.1, 0.32, VK.wood);
  const RL = L + 1.4;
  const RW = W + 1.8;
  const rise = RW * 0.5;
  const y0 = base + h - 0.1;
  // Most are roofed with turf, some with tarred shingles.
  if (rng() < 0.75) B.roof(F, 'turf', RL, RW, rise, y0, pick(rng, VK.turf), { hip: true, curve: 0.9, skirt: 0.35 });
  else B.roof(F, 'shingle', RL, RW, rise, y0, C(0x5a4e44), { hip: true, curve: 1, skirt: 0.2 });
  const ex = (RL - RW) / 2;
  for (const s of [-1, 1]) gableBoards(F, s * (ex + 0.15), y0 + rise, VK.pale);
  F.box('planks', 0, y0 + rise + 0.2, 0, 0.9, 0.4, 0.9, VK.tar);
  const doorX = (rng() - 0.5) * L * 0.4;
  F.box('planks', doorX, base + 0.95, W / 2 + 0.05, 1.1, 1.9, 0.08, dark(VK.tar, 0.6));
  for (const s of [-1, 1]) F.box('timber', doorX + s * 0.75, base + 1.2, W / 2 + 1.0, 0.18, 2.4, 0.18, VK.wood);
  F.box('turf', doorX, base + 2.5, W / 2 + 0.7, 2.0, 0.25, 1.5, pick(rng, VK.turf), -0.25, 0, 0);
  if (rng() < 0.5) {
    const n = Math.floor(L / 3.2);
    for (let k = 0; k < n; k++) {
      const sx = -L / 2 + 1.6 + k * 3.2;
      if (Math.abs(sx - doorX) < 1.6) continue;
      shield(F, sx, base + 1.4, W / 2 + 0.08, pick(rng, VK.shield));
    }
  }
  F.collideBox(0, 0, L / 2, W / 2, bottom, y0 + rise + 1);
  return { top: y0 + rise };
}

/*
 * The mead hall of Hrafnvik, which you can walk into: a long hearth burning down the
 * middle, tables and benches either side, the jarl's high seat at the far end, shields
 * on the walls and casks of mead. Its keeper's place is a spot.
 */
export function meadHall(B, F, rng, spot) {
  const K = B.kit.furn;
  const w = 30;
  const d = 12;
  const h = 4.4;
  const furnish = (room) => {
    const { hw, hd } = room;
    const y = room.y;
    const H = K.piece(room, 0, 0.3);
    H.box('stone', 0, y + 0.12, 0, hw * 2 - 10, 0.24, 1.5, VK.stone);
    H.box('crag', 0, y + 0.2, 0, hw * 2 - 10.4, 0.1, 1.1, C(0x3a302a));
    H.box('fire', 0, y + 0.255, 0, hw * 2 - 11, 0.02, 0.7, C(0x6a2a10));
    for (let k = -3; k <= 3; k++) {
      for (const s of [-1, 1]) H.box('timber', k * 2.6 + s * 0.25, y + 0.33, 0, 0.9, 0.14, 0.14, C(0x3a2a1a), 0, s * 0.5, 0);
      H.geo('fire', K.FLAME, k * 2.6, y + 0.55, 0, 0, k, 0, 0.9, 0.9, 0.9);
      H.geo('fire', K.FLAME, k * 2.6 + 0.3, y + 0.48, 0.15, 0, k, 0, 0.5, 0.6, 0.5);
      if (k % 3 === 0) {
        const [lx, lz] = H.world(k * 2.6, 0);
        room.lights.push(new THREE.Vector3(lx, y + 1.0, lz));
      }
    }
    H.collideBox(0, 0, hw - 5, 0.75, y - 1, y + 0.6);
    for (const s of [-1, 1]) {
      for (const tx of [-9, -3, 3, 9]) {
        const T = K.table(room, tx, 0.3 + s * 2.7, 4.2, 0.9);
        K.tableware(T, y + 0.78, 4.2, 0.9, rng, { mugs: 4, candle: false });
        T.geo('timber', K.HORN, 0.8, y + 0.86, 0.1, 0, 0, 1.3, 1, 1, 1, C(0xd8c8a0));
        K.bench(room, tx, 0.3 + s * 3.45, 4.0);
      }
    }
    K.chair(room, 0, -hd + 0.75, 0, VK.shield[0]);
    const Hs = K.piece(room, 0, -hd + 0.75);
    Hs.box('planks', 0, y + 1.3, -0.25, 1.2, 1.6, 0.1, VK.tar);
    for (let k = 0; k < 7; k++) {
      const sx = -hw + 2 + k * ((hw * 2 - 4) / 6);
      if (Math.abs(sx) < 1.5) continue;
      const S = K.piece(room, sx, -hd + 0.05);
      shield(S, 0, y + 2.4, 0.06, pick(rng, VK.shield));
    }
    for (const bx of [-hw + 0.6, -hw + 1.5, hw - 0.6]) K.barrel(room, bx, -hd + 0.6);
    K.barrel(room, hw - 0.6, hd - 0.7);
    keeperSpot(B, room, spot, -hw + 2.2, -hd + 1.6);
  };
  const { room, base } = walkIn(B, F, { w, d, h, wallKey: 'planks', wallTint: VK.tar, footTint: VK.stone, name: 'mead hall', furnish, lift: 0.25 });
  for (let k = 0; k <= 10; k++) {
    for (const s of [-1, 1]) F.box('timber', -w / 2 + (k * w) / 10, base + h / 2, s * (d / 2 + 0.1), 0.3, h, 0.2, VK.wood);
  }
  const RL = w + 2.2;
  const RW = d + 3.0;
  const rise = RW * 0.55;
  const y0 = base + h - 0.1;
  B.roof(F, 'turf', RL, RW, rise, y0, VK.turf[0], { hip: true, curve: 0.9, skirt: 0.4 });
  const ex = (RL - RW) / 2;
  for (const s of [-1, 1]) gableBoards(F, s * (ex + 0.2), y0 + rise, VK.pale);
  // Carved door posts and shields along the front.
  for (const s of [-1, 1]) {
    F.box('timber', s * 1.0, base + 1.7, d / 2 + 0.25, 0.3, 3.4, 0.3, VK.pale);
    F.box('timber', s * 1.0, base + 3.55, d / 2 + 0.35, 0.36, 0.4, 0.5, VK.pale, 0.4, 0, 0);
  }
  for (let k = 0; k < 8; k++) {
    const sx = -w / 2 + 2 + k * ((w - 4) / 7);
    if (Math.abs(sx) < 2.2) continue;
    shield(F, sx, base + 1.9, d / 2 + 0.12, pick(rng, VK.shield));
  }
  for (const s of [-1, 1]) {
    F.box('timber', s * 3.2, base + 1.5, d / 2 + 1.6, 0.2, 3.0, 0.2, VK.wood);
    F.geo('fire', K.FLAME, s * 3.2, base + 3.2, d / 2 + 1.6, 0, 0, 0, 0.8, 0.9, 0.8);
    F.geo('metal', SHAPES.cyl, s * 3.2, base + 3.0, d / 2 + 1.6, 0, 0, 0, 0.45, 0.2, 0.45);
    F.collideCircle(s * 3.2, d / 2 + 1.6, 0.2, base - 1, base + 3.2);
    B.lamp(F, s * 3.2, base + 3.2, d / 2 + 1.6);
  }
  room.finish(y0 + rise);
  return { top: y0 + rise };
}

/*
 * A palisade round a centre: pointed stakes in runs along a ring of radius r, leaving
 * gaps where `gaps` (angles) say, each gap framed by tall posts under a carved beam.
 */
export function palisade(B, cx, cz, r, gaps) {
  const n = Math.round((TAU * r) / 6);
  const gapHalf = 4.2 / r;
  const inGap = (a) => gaps.some((g) => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g))) < gapHalf);
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * TAU;
    const a1 = ((k + 1) / n) * TAU;
    const am = (a0 + a1) / 2;
    if (inGap(am)) continue;
    const x0 = cx + Math.cos(a0) * r;
    const z0 = cz + Math.sin(a0) * r;
    const x1 = cx + Math.cos(a1) * r;
    const z1 = cz + Math.sin(a1) * r;
    const len = Math.hypot(x1 - x0, z1 - z0) + 0.2;
    const F = B.frame((x0 + x1) / 2, (z0 + z1) / 2, Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2);
    const [lo, hi] = B.span(F, len / 2, 0.3);
    F.geo('timber', stakesGeometry(len, hi - lo + 4.2), 0, lo - 0.6, 0, 0, 0, 0, 1, 1, 1, VK.wood);
    F.box('timber', 0, hi + 1.0, -0.25, len, 0.18, 0.12, VK.tar);
    F.collideBox(0, 0, len / 2, 0.25, lo - 2, hi + 4);
    B.occupy(F, len / 2, 0.4);
  }
  for (const a of gaps) {
    for (const s of [-1, 1]) {
      const pa = a + s * gapHalf;
      const F = B.frame(cx + Math.cos(pa) * r, cz + Math.sin(pa) * r, -a);
      const g = F.ground(0, 0);
      F.box('timber', 0, g + 2.8, 0, 0.6, 5.6, 0.6, VK.tar);
      F.box('timber', 0, g + 5.9, 0, 0.5, 0.6, 0.9, VK.pale, 0.5, 0, 0);
      F.collideBox(0, 0, 0.35, 0.35, g - 1, g + 6);
    }
    const F = B.frame(cx + Math.cos(a) * r, cz + Math.sin(a) * r, Math.PI / 2 - a);
    const g = F.ground(0, 0);
    F.box('timber', 0, g + 5.4, 0, 8.6, 0.45, 0.5, VK.tar);
    gableBoards(F, 0, g + 5.5, VK.pale);
    F.collideBox(0, 0, 4.3, 0.3, g + 5.0, g + 7.5);
  }
}

// A watchtower: four posts, a railed platform and a little turf roof.
export function watchtower(B, F) {
  const g = F.ground(0, 0);
  const H = 7;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    F.box('timber', sx * 1.3, g + (H + 2.4) / 2, sz * 1.3, 0.3, H + 2.4, 0.3, VK.wood, sz * 0.04, 0, -sx * 0.04);
    F.collideCircle(sx * 1.3, sz * 1.3, 0.25, g - 1, g + H + 2);
  }
  F.box('planks', 0, g + H, 0, 3.4, 0.2, 3.4, VK.tar);
  for (const [cx, cz, sx, sz] of [[0, 1.6, 3.2, 0.1], [0, -1.6, 3.2, 0.1], [1.6, 0, 0.1, 3.2], [-1.6, 0, 0.1, 3.2]]) F.box('planks', cx, g + H + 0.55, cz, sx, 0.9, sz, VK.wood);
  B.roof(F, 'turf', 4.4, 4.4, 1.6, g + H + 2.3, VK.turf[2], { hip: true, curve: 1 });
  for (let k = 0; k < 7; k++) F.box('timber', 0.9, g + 0.5 + k, 1.75, 0.6, 0.08, 0.08, VK.pale);
  B.occupy(F, 2, 2);
}

/*
 * A longship at rest on the river: a clinker hull with a tall stem and stern, oars
 * shipped, shields along the rail, and the mast with a red-and-white striped sail.
 */
export function longship(B, x, z, rot, waterY) {
  const F = B.frame(x, z, rot);
  const L = 18;
  const Bw = 4.4;
  const H = 1.5;
  const y = waterY - 0.55;
  F.geo('planks', hullGeometry(L, Bw, H), 0, y, 0, 0, 0, 0, 1, 1, 1, VK.tar);
  F.box('planks', 0, y + H - 0.35, 0, L * 0.82, 0.08, Bw * 0.8, VK.pale);
  // Stem and stern posts rising to a carved head and a curled tail.
  for (const s of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      const t = k / 4;
      F.box('timber', s * (L / 2 - 0.2 + t * 0.9), y + H + 0.5 + t * 1.8, 0, 0.5, 0.6, 0.22, VK.tar, 0, 0, -s * (0.3 + t * 0.6));
    }
    F.box('timber', s * (L / 2 + 0.95), y + H + 2.55, 0, s > 0 ? 0.9 : 0.4, 0.45, 0.26, s > 0 ? VK.shield[2] : VK.tar);
  }
  for (const s of [-1, 1]) {
    for (let k = 0; k < 9; k++) shield(F, -L * 0.36 + k * (L * 0.72 / 8), y + H + 0.05, s * (Bw / 2 - 0.1), VK.shield[(k + (s > 0 ? 0 : 2)) % VK.shield.length], s > 0 ? 0 : Math.PI, 0.75);
  }
  B.col(F, 'timber', 0, y + H - 0.3, 0, 0.14, 9, VK.wood);
  F.box('timber', 0, y + H + 7.6, 0, 0.18, 0.18, 7.0, VK.wood);
  for (let k = 0; k < 6; k++) F.box('plainCloth', 0.1, y + H + 5.1, -3 + k * 1.2 + 0.6, 0.04, 4.8, 1.2, k % 2 ? WHITE : VK.sail);
  F.collideBox(0, 0, L / 2, Bw / 2, waterY - 3, waterY + 2.5);
}

// A boat shed by the water: an A-frame of turf over a slipway.
export function boatShed(B, F, L = 20) {
  const g = F.ground(0, 0);
  const W = 7;
  for (const s of [-1, 1]) F.box('planks', 0, g + 1.0, s * (W / 2), L, 2.0, 0.3, VK.tar);
  B.roof(F, 'turf', L + 1, W + 2, 4.2, g + 1.9, VK.turf[1], { hip: false, curve: 1 });
  for (const s of [-1, 1]) F.box('planks', -s * (L / 2), g + 2.6, 0, 0.25, 1.4, W - 1, VK.tar);
  for (const s of [-1, 1]) F.collideBox(0, s * (W / 2), L / 2, 0.2, g - 1, g + 6);
  B.occupy(F, L / 2 + 0.5, W / 2 + 0.6);
}

// A rack of fish drying in the wind.
export function fishRack(B, F, rng) {
  const g = F.ground(0, 0);
  for (const s of [-1, 1]) {
    F.box('timber', s * 2.2, g + 1.1, 0.5, 0.14, 2.4, 0.14, VK.wood, 0.25, 0, 0);
    F.box('timber', s * 2.2, g + 1.1, -0.5, 0.14, 2.4, 0.14, VK.wood, -0.25, 0, 0);
  }
  F.box('timber', 0, g + 2.2, 0, 4.8, 0.1, 0.1, VK.wood);
  for (let k = 0; k < 10; k++) F.box('plainCloth', -2 + k * 0.44, g + 1.75, (rng() - 0.5) * 0.1, 0.12, 0.7, 0.05, C(0xb8a888));
  F.collideBox(0, 0, 2.4, 0.7, g - 1, g + 2.4);
  B.occupy(F, 2.6, 0.9);
}

// A torch on a post, lit day and night.
export function vkTorch(B, F) {
  const g = F.ground(0, 0);
  F.box('timber', 0, g + 1.3, 0, 0.18, 2.6, 0.18, VK.tar);
  F.geo('metal', SHAPES.cyl, 0, g + 2.7, 0, 0, 0, 0, 0.42, 0.22, 0.42);
  F.geo('fire', B.kit.furn.FLAME, 0, g + 2.95, 0, 0, 0, 0, 0.8, 0.9, 0.8);
  B.lamp(F, 0, g + 2.95, 0);
  F.collideCircle(0, 0, 0.2, g - 1, g + 3);
}

// =================================================================== Mudwick

export const SL = {
  wood: [C(0x7c6a56), C(0x6a5a4a), C(0x8a7a62), C(0x5e5246), C(0x948470), C(0x6e5e4c), C(0x77705e)],
  patch: [C(0x9a6a4a), C(0x5a6a7a), C(0x7a8a6a), C(0xa89a7a), C(0x6a4a3a), C(0x8a8a8a)],
  tarp: [C(0x8a7a5a), C(0x5a6a5a), C(0x7a5a4a), C(0x6a6a7a), C(0x9a8a6a), C(0x7a3a2a), C(0x4a5a6a)],
  mud: C(0x5e4a36),
};

/*
 * A shack of patched planks: a lean-to roof of boards, thatch or tarred shingles with a
 * tarpaulin over the leaks, a door of odd boards or a curtain, and clutter at the door.
 * On the river bank (o.stilts) it stands on posts over the mud.
 */
export function shack(B, F, w, d, rng, o = {}) {
  let base;
  let bottom;
  if (o.stilts) {
    const [lo, hi] = B.span(F, w / 2, d / 2);
    base = hi + 0.9;
    bottom = lo - 1.5;
    for (const sx of [-1, 1]) for (const sz of [-1, 0, 1]) B.col(F, 'timber', sx * (w / 2 - 0.2), bottom, sz * (d / 2 - 0.2), 0.12, base - bottom, pick(rng, SL.wood));
    F.box('planks', 0, base - 0.08, 0.6, w + 0.2, 0.16, d + 1.4, pick(rng, SL.wood));
  } else {
    ({ base, bottom } = B.footing(F, w / 2, d / 2, { key: 'planks', tint: dark(pick(rng, SL.wood), 0.7), lift: 0.15, pad: 0.1 }));
  }
  const h = 2.1 + rng() * 0.5;
  const wall = pick(rng, SL.wood);
  F.box('planks', 0, base + h / 2, 0, w, h, d, wall);
  const tilt = 0.15 + rng() * 0.15;
  const rise = Math.sin(tilt) * (d + 0.7);
  const roofKey = pick(rng, ['planks', 'thatch', 'shingle', 'planks']);
  const roofT = roofKey === 'thatch' ? vary(rng, C(0xa89068), 0.15) : roofKey === 'shingle' ? C(0x6a6460) : pick(rng, SL.wood);
  F.box(roofKey, 0, base + h + rise / 2 + 0.02, 0, w + 0.6, 0.1, d + 0.7, roofT, -tilt, 0, (rng() - 0.5) * 0.06);
  F.box('planks', 0, base + h + rise / 4, d / 2 - 0.05, w, rise / 2 + 0.1, 0.1, wall);
  if (rng() < 0.6) F.box('plainCloth', (rng() - 0.5) * w * 0.3, base + h + rise / 2 + 0.1, (rng() - 0.5) * 0.6, w * (0.4 + rng() * 0.4), 0.03, d * 0.6, pick(rng, SL.tarp), -tilt + (rng() - 0.5) * 0.1, (rng() - 0.5) * 0.3, 0);
  for (let k = 0, n = 1 + Math.floor(rng() * 3); k < n; k++) {
    F.box('planks', (rng() - 0.5) * (w - 0.8), base + 0.5 + rng() * (h - 1), d / 2 + 0.03, 0.4 + rng() * 0.6, 0.3 + rng() * 0.5, 0.04, pick(rng, SL.patch));
  }
  const doorX = (rng() - 0.5) * (w - 1.2);
  if (rng() < 0.5) F.box('planks', doorX, base + 0.92, d / 2 + 0.03, 0.85, 1.84, 0.05, dark(pick(rng, SL.wood), 0.6), 0, 0, (rng() - 0.5) * 0.05);
  else F.box('plainCloth', doorX, base + 0.92, d / 2 + 0.04, 0.85, 1.8, 0.02, pick(rng, SL.tarp));
  const wx = doorX > 0 ? doorX - 1.2 : doorX + 1.2;
  if (Math.abs(wx) < w / 2 - 0.4) F.box('stone', wx, base + 1.4, d / 2 + 0.02, 0.6, 0.45, 0.03, C(0x241e1a));
  if (rng() < 0.35) F.geo('metal', SHAPES.cyl, w / 2 - 0.5, base + h + 0.6, -d / 4, 0, 0, (rng() - 0.5) * 0.3, 0.18, 1.4, 0.18, C(0x5a5048));
  const [ox, oz] = [doorX + (doorX > 0 ? -1.0 : 1.0), d / 2 + 0.6];
  if (!o.stilts && rng() < 0.55) {
    const g = F.ground(ox, oz);
    F.inst(rng() < 0.5 ? 'crate' : 'barrel', ox, g, oz, 0, rng() * TAU, 0, 0.8, 0.8, 0.8);
    F.collideCircle(ox, oz, 0.38, g - 1, g + 0.8);
  }
  F.collideBox(0, 0, w / 2, d / 2, bottom, base + h + rise + 0.4);
  return { top: base + h + rise };
}

// A tenement: shacks stacked two or three high, each a little askew, with a stair up the side.
export function tenement(B, F, w, d, rng) {
  const { base, bottom } = B.footing(F, w / 2, d / 2, { tint: SL.mud, lift: 0.15 });
  const floors = 2 + (rng() < 0.4 ? 1 : 0);
  let y = base;
  let ox = 0;
  for (let f = 0; f < floors; f++) {
    const h = 2.5;
    const ww = w - f * 0.5;
    F.box('planks', ox, y + h / 2, 0, ww, h, d - f * 0.3, pick(rng, SL.wood), 0, (rng() - 0.5) * 0.04, 0);
    F.box('planks', ox, y + 0.06, 0, ww + 0.3, 0.12, d - f * 0.3 + 0.3, dark(pick(rng, SL.wood), 0.7));
    for (let k = 0; k < 2; k++) F.box('stone', ox + (k - 0.5) * ww * 0.45, y + 1.5, d / 2 - f * 0.15 + 0.02, 0.6, 0.5, 0.03, C(0x241e1a));
    if (f > 0) F.box('plainCloth', ox + (rng() - 0.5) * 2, y + 0.9, d / 2 - f * 0.15 + 0.4, 2.2, 0.03, 0.5, pick(rng, SL.tarp), 0.2);
    y += h;
    ox += (rng() - 0.5) * 0.5;
  }
  const tilt = 0.18;
  F.box('planks', ox, y + 0.35, 0, w - floors * 0.5 + 1.0, 0.1, d + 0.4, pick(rng, SL.wood), -tilt, 0, 0);
  // The outside stair.
  for (let k = 0; k < 9; k++) F.box('planks', w / 2 + 0.5, base + 0.15 + k * 0.28, d / 2 - 0.4 - k * 0.32, 0.9, 0.06, 0.32, pick(rng, SL.wood));
  F.box('timber', w / 2 + 0.95, base + 1.4, d / 2 - 1.8, 0.08, 2.8, 0.08, SL.wood[0]);
  F.box('planks', 0, base + 0.92, d / 2 + 0.03, 0.9, 1.84, 0.05, dark(SL.wood[3], 0.7));
  F.collideBox(0, 0, w / 2, d / 2, bottom, y + 1);
  F.collideBox(w / 2 + 0.5, d / 2 - 1.8, 0.45, 1.5, bottom, base + 2.8);
  return { top: y + 1 };
}

/*
 * The Leaky Bucket, Mudwick's alehouse and soup kitchen, which you can walk into:
 * crates for tables, a cauldron over the fire, casks along the wall.
 */
export function leakyBucket(B, F, rng, spot) {
  const K = B.kit.furn;
  const w = 11;
  const d = 8;
  const h = 3.0;
  const furnish = (room) => {
    const { hw, hd } = room;
    const y = room.y;
    K.hearth(room, hw - 0.42, -hd / 2 + 0.4, -Math.PI / 2);
    const P = K.piece(room, hw - 1.5, -hd / 2 + 0.4);
    P.geo('metal', SHAPES.ball, 0, y + 0.55, 0, 0, 0, 0, 0.8, 0.6, 0.8, C(0x2a2624));
    P.collideCircle(0, 0, 0.45, y - 1, y + 0.8);
    for (const [tx, tz] of [[-2.6, 0.6], [0.4, 1.4], [-0.8, -1.6]]) {
      const T = K.piece(room, tx, tz, rng());
      T.inst('crate', 0, y, 0, 0, 0, 0, 1.2, 1.0, 1.2);
      T.geo('timber', K.MUG, 0.1, y + 0.86, 0.05, 0, 0, 0, 1, 1, 1, C(0x7a6040));
      T.collideCircle(0, 0, 0.55, y - 1, y + 0.8);
      for (const a of [0, 2.2, 4.2]) K.barrel(room, tx + Math.sin(a) * 1.0, tz + Math.cos(a) * 1.0);
    }
    const Cn = K.piece(room, -1.2, -hd + 0.8);
    Cn.box('planks', 0, y + 0.5, 0, 3.6, 1.0, 0.6, SL.wood[3]);
    Cn.collideBox(0, 0, 1.8, 0.3, y - 1, y + 1);
    keeperSpot(B, room, spot, -1.2, -hd + 0.3 + 0.0);
  };
  const { room, base } = walkIn(B, F, { w, d, h, wallKey: 'planks', wallTint: SL.wood[1], footTint: SL.mud, name: 'the Leaky Bucket', furnish, lift: 0.2 });
  for (let k = 0; k < 4; k++) F.box('planks', -w / 2 + 1 + rng() * (w - 2), base + 0.6 + rng() * 1.6, d / 2 + 0.03, 0.6, 0.4, 0.04, pick(rng, SL.patch));
  const RD = d + 1.2;
  const rise = 2.2;
  const y0 = base + h - 0.1;
  B.roof(F, 'shingle', w + 1.0, RD, rise, y0, C(0x6a6058), { hip: false, curve: 1 });
  for (const s of [-1, 1]) F.geo('planks', gableWall(d, RD, rise, 1), s * (w / 2 - 0.11), y0, 0, 0, 0, 0, 1, 1, 1, SL.wood[1]);
  // A bucket hung over the door for a sign.
  F.box('timber', 0, base + h + 0.2, d / 2 + 0.6, 0.1, 0.1, 1.2, SL.wood[0]);
  F.geo('metal', SHAPES.cyl, 0, base + h - 0.3, d / 2 + 1.1, 0.3, 0, 0, 0.45, 0.5, 0.45, C(0x6a5a48));
  room.finish(y0 + rise);
  return { top: y0 + rise };
}

// A heap of rubbish: rotten boards, broken crates and sacks.
export function junk(B, F, rng) {
  const g = F.ground(0, 0);
  for (let k = 0; k < 5; k++) {
    F.geo('crag', SHAPES.rock, (rng() - 0.5) * 2, g + 0.1, (rng() - 0.5) * 2, rng(), rng() * TAU, 0, 0.8 + rng(), 0.4 + rng() * 0.4, 0.8 + rng(), C(0x5a4a3a));
  }
  for (let k = 0; k < 3; k++) F.box('planks', (rng() - 0.5) * 2, g + 0.3, (rng() - 0.5) * 2, 1.6, 0.06, 0.25, pick(rng, SL.wood), rng() - 0.5, rng() * TAU, rng() - 0.5);
  F.collideCircle(0, 0, 1.4, g - 1, g + 0.8);
}

// A washing line between two poles, hung with rags and shirts.
export function laundry(B, F, rng) {
  const g = F.ground(0, 0);
  for (const s of [-1, 1]) {
    F.box('timber', s * 2.2, g + 1.1, 0, 0.1, 2.2, 0.1, SL.wood[0], 0, 0, s * 0.05);
    F.collideCircle(s * 2.2, 0, 0.12, g - 1, g + 2.2);
  }
  F.box('timber', 0, g + 2.05, 0, 4.4, 0.02, 0.02, C(0x3a3028));
  for (let k = 0; k < 6; k++) {
    const x = -1.8 + k * 0.72 + (rng() - 0.5) * 0.2;
    F.box('plainCloth', x, g + 1.7 - rng() * 0.2, 0, 0.5 + rng() * 0.2, 0.6 + rng() * 0.3, 0.02, pick(rng, SL.tarp).clone().lerp(WHITE, rng() * 0.5));
  }
}

// A brazier made from an old cask, burning at night for the folk gathered round it.
export function fireBarrel(B, F) {
  const g = F.ground(0, 0);
  F.inst('barrel', 0, g, 0, 0, 0, 0, 0.9, 0.9, 0.9);
  F.geo('fire', B.kit.furn.FLAME, 0, g + 1.1, 0, 0, 0, 0, 1.1, 1.0, 1.1);
  B.lamp(F, 0, g + 1.3, 0);
  F.collideCircle(0, 0, 0.4, g - 1, g + 1.2);
}

// ============================================================ Saffron Bazaar

export const DS = {
  walls: [C(0xe6cba0), C(0xdcae74), C(0xf0e4cc), C(0xe8bca0), C(0xf4efe6), C(0xd8b888), C(0xe9d4b0)],
  door: [C(0x2a7a7a), C(0x2a4f8a), C(0x7a4a2a), C(0x8a3a2a), C(0x3a6a3a)],
  awning: [C(0xc23a2a), C(0xe0a020), C(0x2a5a9a), C(0x3a8a5a), C(0xe8e0d0), C(0x9a3a7a)],
  wood: C(0x7a5232), pot: C(0xb5653d), shade: C(0x2a2018), tile: C(0x2a8a9a),
};

// A round-headed opening (door or window) on a front face at z, its sill at y.
function archOpening(F, x, y, z, w, h, tint) {
  F.box('planks', x, y + (h - w / 2) / 2, z, w, h - w / 2, 0.06, tint);
  F.geo('planks', SHAPES.halfDisc, x, y + h - w / 2, z, 0, 0, 0, w, w, 0.06, tint);
}

// The low wall round a flat roof: w x d at z, its top at y + 0.55.
function parapet(F, w, d, cx, cz, y, tint) {
  const t = 0.24;
  F.box('plaster', cx, y + 0.27, cz + d / 2 - t / 2, w, 0.55, t, tint);
  F.box('plaster', cx, y + 0.27, cz - d / 2 + t / 2, w, 0.55, t, tint);
  for (const s of [-1, 1]) F.box('plaster', cx + s * (w / 2 - t / 2), y + 0.27, cz, t, 0.55, d - 2 * t, tint);
}

/*
 * A house of the bazaar: flat-roofed blocks of sun-baked plaster stepping back as they
 * rise, parapets round each roof, round-headed doors and windows, a wooden lattice
 * bay, an awning over the door; on some a wind tower, rugs airing or pots of herbs.
 */
export function dsHouse(B, F, w, d, rng, o = {}) {
  const wallT = pick(rng, DS.walls);
  const { base, bottom } = B.footing(F, w / 2, d / 2, { key: 'plaster', tint: dark(wallT, 0.85), lift: 0.2 });
  const floors = o.floors ?? 1 + Math.floor(rng() * 2.7);
  let y = base;
  let cw = w;
  let cd = d;
  let cx = 0;
  let cz = 0;
  const doorT = pick(rng, DS.door);
  const doorX = (rng() - 0.5) * (w - 2.4);
  archOpening(F, doorX, base, d / 2 + 0.03, 1.2, 2.5, doorT);
  for (let f = 0; f < floors; f++) {
    const h = f === 0 ? 3.4 : 3.0;
    F.box('plaster', cx, y + h / 2, cz, cw, h, cd, wallT);
    if (f > 0) {
      // A window or two, rarely evenly placed, some behind wooden screens.
      const n = cw > 6 && rng() < 0.6 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const wx = cx + (n === 1 ? (rng() - 0.5) * (cw - 2) : (k - 0.5) * cw * 0.55 + (rng() - 0.5) * 0.6);
        if (rng() < 0.3) {
          F.box('timber', wx, y + 1.5, cz + cd / 2 + 0.18, 1.0, 1.4, 0.36, DS.wood);
          B.lattice(F, 0.9, 1.3, wx, y + 1.5, cz + cd / 2 + 0.37, dark(DS.wood, 0.8), 0.14);
        } else archOpening(F, wx, y + 0.9, cz + cd / 2 + 0.02, 0.62, 1.3, DS.shade);
      }
    } else {
      const wx = doorX > 0 ? doorX - 1.8 : doorX + 1.8;
      if (Math.abs(wx) < w / 2 - 0.6) {
        F.box('stone', wx, y + 1.7, d / 2 + 0.015, 0.8, 0.8, 0.02, DS.shade);
        B.lattice(F, 0.8, 0.8, wx, y + 1.7, d / 2 + 0.04, DS.wood, 0.16, 0, 0, Math.PI / 4);
      }
    }
    y += h;
    parapet(F, cw, cd, cx, cz, y, wallT);
    if (f === 0 && floors > 1 && rng() < 0.5) {
      F.box('timber', cx + (rng() - 0.5) * (cw - 3), y + 1.4, cz + cd / 2 + 0.4, 1.8, 1.9, 0.8, DS.wood);
    }
    if (f < floors - 1) {
      const nw = cw * (0.55 + rng() * 0.3);
      const nd = cd * (0.55 + rng() * 0.25);
      cx += (rng() - 0.5) * (cw - nw);
      cz -= (cd - nd) / 2;
      cw = nw;
      cd = nd;
    }
  }
  if (rng() < 0.25) {
    const tx = cx + (rng() - 0.5) * (cw - 2);
    F.box('plaster', tx, y + 1.6, cz, 1.8, 3.2, 1.8, wallT);
    for (const s of [-1, 1]) F.box('stone', tx, y + 2.5, cz + s * 0.91, 1.2, 1.2, 0.03, DS.shade);
    F.box('plaster', tx, y + 3.25, cz, 2.0, 0.15, 2.0, wallT);
  }
  if (rng() < 0.4) F.box('cloth', cx + (rng() - 0.5) * cw * 0.5, y - 0.4, cz + cd / 2 + 0.04, 1.3, 1.6, 0.03, pick(rng, DS.awning));
  if (rng() < 0.4) {
    for (let k = 0; k < 3; k++) {
      const px = cx - cw / 2 + 0.6 + k * 0.7;
      F.geo('plaster', SHAPES.cyl, px, y + 0.25, cz + cd / 2 - 0.5, 0, 0, 0, 0.4, 0.5, 0.4, DS.pot);
      F.geo('plainCloth', SHAPES.blob, px, y + 0.7, cz + cd / 2 - 0.5, 0, k, 0, 0.6, 0.55, 0.6, C(0x4a7a3a));
    }
  }
  F.box('cloth', doorX, base + 3.0, d / 2 + 0.6, 2.2, 0.05, 1.2, pick(rng, DS.awning), 0.28, 0, 0);
  F.collideBox(0, 0, w / 2, d / 2, bottom, y + 1);
  return { top: y };
}

/*
 * The caravanserai, an inn round a courtyard for merchants and their beasts: thick
 * walls with a tall arched gateway, arcades on every side of the court, a fountain
 * and palms in the middle. Its keeper serves at a stall by the fountain.
 */
export function caravanserai(B, F, rng, spot) {
  const S = 44;
  const H = 7.5;
  const T = 1.2;
  const wallT = DS.walls[1];
  const [lo, hi] = B.span(F, S / 2, S / 2);
  const g = hi;
  // Outer walls, the front one broken by the gateway.
  const run = (cx, cz, sx, sz) => {
    F.box('plaster', cx, (lo - 0.8 + g + H) / 2, cz, sx, g + H - lo + 0.8, sz, wallT);
    F.collideBox(cx, cz, sx / 2, sz / 2, lo - 2, g + H + 1);
  };
  run(0, -S / 2 + T / 2, S, T);
  for (const s of [-1, 1]) run(s * (S / 2 - T / 2), 0, T, S - 2 * T);
  for (const s of [-1, 1]) run(s * (S / 4 + 1.6), S / 2 - T / 2, S / 2 - 3.2, T);
  parapet(F, S, S, 0, 0, g + H, wallT);
  // The gateway: a tall block with a deep arched passage.
  const portal = archPanel(9, H + 4.5 + (g - lo), 4.4, 6.8 + (g - lo), false, T + 2.4);
  F.geo('plaster', portal, 0, lo - 0.5, S / 2 - T / 2, 0, 0, 0, 1, 1, 1, dark(wallT, 0.95));
  F.box('plaster', 0, g + H + 4.2, S / 2 - T / 2, 9.4, 0.3, T + 2.6, wallT);
  B.lattice(F, 3.4, 1.4, 0, g + 7.6, S / 2 + 1.06, DS.tile, 0.35);
  for (const s of [-1, 1]) F.collideBox(s * 3.4, S / 2 - T / 2, 1.2, T / 2 + 1.2, lo - 2, g + H + 4.5);
  F.collideBox(0, S / 2 - T / 2, 4.5, T / 2 + 1.2, g + 6.0, g + H + 4.5);
  // Arcades round the court: a row of arches 4 m in from each wall, roofed over.
  const inner = S / 2 - T - 4;
  const arcade = (cx, cz, len, rot) => {
    const A = B.frame(...F.world(cx, cz), F.rot + rot);
    const n = Math.round(len / 4);
    const ps = len / n;
    for (let k = 0; k < n; k++) {
      const ax = -len / 2 + (k + 0.5) * ps;
      A.geo('plaster', archPanel(ps, 4.6, ps - 1.0, 3.6, false, 0.7), ax, g, 0, 0, 0, 0, 1, 1, 1, wallT);
      A.collideBox(-len / 2 + k * ps, 0, 0.5, 0.4, g - 1, g + 4.6);
    }
    A.box('plaster', 0, g + 4.75, -2, len, 0.3, 4.6, wallT);
    A.box('plaster', 0, g + 0.05, -2, len, 0.1, 4.0, dark(wallT, 0.9));
  };
  arcade(0, -inner, 2 * inner, 0);
  arcade(-inner, 0, 2 * inner - 1, Math.PI / 2);
  arcade(inner, 0, 2 * inner - 1, -Math.PI / 2);
  for (const s of [-1, 1]) arcade(s * (inner / 2 + 2.6), inner, inner - 5.2, Math.PI);
  // The court: paving, a fountain, palms, bales and a merchant's stall.
  F.box('stone', 0, g + 0.04, 0, 2 * inner - 0.5, 0.08, 2 * inner - 0.5, C(0xd8c8a8));
  B.ctx.world.surfaces.push({ ...B.kit.rect(F.x, F.z, S / 2 - T, S / 2 - T, F.rot), height: () => g + 0.08 });
  F.geo('stone', SHAPES.cyl8, 0, g + 0.35, 0, 0, 0, 0, 6, 0.7, 6, C(0xe8dcc0));
  F.geo('pool', SHAPES.cyl8, 0, g + 0.62, 0, 0, 0, 0, 5.2, 0.1, 5.2, C(0x5aa0b0));
  F.geo('stone', SHAPES.cyl8, 0, g + 1.2, 0, 0, 0, 0, 0.7, 1.4, 0.7, C(0xe8dcc0));
  F.geo('stone', SHAPES.disc, 0, g + 1.95, 0, 0, 0, 0, 1.8, 0.2, 1.8, DS.tile);
  F.collideCircle(0, 0, 3.0, g - 1, g + 0.75);
  for (const [px, pz] of [[-9, -9], [9, -9], [-9, 8], [9, 8]]) B.tree(...F.world(px, pz), 'palm', 1);
  for (let k = 0; k < 6; k++) {
    const [bx, bz] = [-12 + (k % 3) * 1.2, 4 + Math.floor(k / 3) * 1.1];
    F.box('plainCloth', bx, g + 0.4, bz, 1.0, 0.75, 0.8, C(0xc8b08a), 0, rng() * 0.4, 0);
  }
  F.collideBox(-10.8, 4.6, 1.8, 1.2, g - 1, g + 0.9);
  const St = B.frame(...F.world(7, 6), F.rot + Math.PI);
  St.inst('stallWood', 0, g + 0.08, 0, 0, 0, 0, 1, 1, 1);
  St.inst('stallAwning', 0, g + 0.08, 0, 0, 0, 0, 1, 1, 1, DS.awning[1]);
  St.inst('stallGoods', 0, g + 0.08, 0, 0, 0, 0, 1, 1, 1, DS.awning[0]);
  St.collideBox(0, 0, 1.5, 0.7, g - 1, g + 1.1);
  const [kx, kz] = St.world(0, -1.3);
  B.ctx.world.spots[spot] = { x: kx, z: kz, heading: St.rot };
  B.lamp(F, 0, g + 3, 0);
  B.occupy(F, S / 2 + 0.5, S / 2 + 0.5);
}

// An awning of striped cloth across a street, from wall to wall.
export function streetAwning(B, F, span, rng, y) {
  F.box('cloth', 0, y, 0, span, 0.05, 3.0, pick(rng, DS.awning), 0, 0, (rng() - 0.5) * 0.05);
  F.box('timber', 0, y - 0.05, -1.5, span, 0.08, 0.08, DS.wood);
  F.box('timber', 0, y - 0.05, 1.5, span, 0.08, 0.08, DS.wood);
}

// A lantern of pierced brass on a bracket at the corner of a wall.
export function dsLamp(B, F) {
  const g = F.ground(0, 0);
  F.box('plaster', 0, g + 1.2, 0, 0.5, 2.4, 0.5, DS.walls[0]);
  F.box('metal', 0, g + 2.6, 0, 0.36, 0.5, 0.36, C(0xb08a40));
  F.box('lamp', 0, g + 2.6, 0, 0.26, 0.4, 0.26, C(0xffd890));
  F.geo('metal', SHAPES.cone, 0, g + 3.0, 0, 0, 0, 0, 0.45, 0.35, 0.45, C(0xb08a40));
  B.lamp(F, 0, g + 2.6, 0);
  F.collideCircle(0, 0, 0.3, g - 1, g + 3);
}

// =============================================================== Costa Mirra

export const MD = {
  white: [C(0xf6f4ee), C(0xf2eee4), C(0xfaf7f0), C(0xefe6d6), C(0xf3e2c8), C(0xf4e6d8)],
  blue: [C(0x2a5aa0), C(0x2f6fa8), C(0x3a8ab0), C(0x2a4f7a), C(0x3a7a6a)],
  roof: [C(0xc0623a), C(0xb5583a), C(0xcc7048), C(0xa85434)],
  bougain: [C(0xd23a8a), C(0xe04a6a), C(0xc84ab0)], stone: C(0xc8bca4), iron: C(0x2a2a2c),
};

/*
 * A villa of the lakeside town: whitewashed walls, blue shutters either side of every
 * window, a blue door in a stone frame, a balcony with an iron rail, bougainvillea
 * climbing a corner, and a low hipped roof of terracotta (or a flat roof terrace
 * under a vine pergola).
 */
export function villa(B, F, w, d, rng) {
  const { base, bottom } = B.footing(F, w / 2, d / 2, { tint: MD.stone, lift: 0.3 });
  const wallT = pick(rng, MD.white);
  const blue = pick(rng, MD.blue);
  const floors = rng() < 0.6 ? 2 : 1;
  let y = base;
  for (let f = 0; f < floors; f++) {
    const h = f === 0 ? 3.0 : 2.8;
    F.box('plaster', 0, y + h / 2, 0, w, h, d, wallT);
    const n = Math.max(1, Math.floor(w / 2.6));
    const doorX = f === 0 ? (rng() - 0.5) * (w - 2.6) : null;
    for (let k = 0; k < n; k++) {
      const wx = -w / 2 + ((k + 0.5) * w) / n;
      if (doorX !== null && Math.abs(wx - doorX) < 1.3) continue;
      const wy = y + (f === 0 ? 1.6 : 1.5);
      F.box('glass', wx, wy, d / 2 + 0.02, 0.8, 1.1, 0.04);
      for (const s of [-1, 1]) F.box('planks', wx + s * 0.62, wy, d / 2 + 0.05, 0.42, 1.15, 0.05, blue);
      F.box('stone', wx, wy - 0.62, d / 2 + 0.08, 1.0, 0.08, 0.16, MD.stone);
    }
    if (doorX !== null) {
      F.box('planks', doorX, y + 1.1, d / 2 + 0.03, 1.1, 2.2, 0.06, blue);
      F.box('stone', doorX, y + 2.3, d / 2 + 0.06, 1.5, 0.2, 0.12, MD.stone);
      for (const s of [-1, 1]) F.box('stone', doorX + s * 0.68, y + 1.15, d / 2 + 0.06, 0.18, 2.3, 0.12, MD.stone);
    }
    if (f === 1 && rng() < 0.6) {
      F.box('stone', 0, y + 0.05, d / 2 + 0.5, w * 0.6, 0.12, 1.0, MD.stone);
      B.slats(F, w * 0.6, 0.9, 0, y + 0.55, d / 2 + 0.98, MD.iron, 0.15);
    }
    y += h;
  }
  const flat = rng() < 0.3;
  let top = y;
  if (flat) {
    parapet(F, w, d, 0, 0, y, wallT);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) F.box('timber', sx * (w / 2 - 0.8), y + 1.3, sz * (d / 2 - 0.8), 0.12, 2.6, 0.12, C(0x6a4a30));
    for (let k = 0; k < 5; k++) F.box('timber', 0, y + 2.6, -d / 2 + 0.8 + (k * (d - 1.6)) / 4, w - 1.4, 0.08, 0.1, C(0x6a4a30));
    F.box('plainCloth', 0, y + 2.72, 0, w - 1.4, 0.12, d - 1.4, C(0x5a8a3a));
    F.geo('plainCloth', SHAPES.blob, -w / 4, y + 2.85, 0, 0, 0, 0, w * 0.4, 0.35, d * 0.5, C(0x6a9a42));
    top = y + 2.9;
  } else {
    const RW = w + 0.9;
    const RD = d + 0.9;
    const rise = Math.min(RW, RD) * 0.27;
    B.roof(F, 'kawara', RW, RD, rise, y - 0.05, pick(rng, MD.roof), { hip: true, curve: 1.05, skirt: 0.12 });
    top = y + rise;
  }
  if (rng() < 0.6) {
    // Bougainvillea climbing a front corner: a column of small flowering clumps.
    const sx = (rng() < 0.5 ? -1 : 1) * (w / 2);
    for (let k = 0; k < 7; k++) {
      const s = 0.45 + rng() * 0.3;
      F.geo('plainCloth', SHAPES.ball, sx + (rng() - 0.5) * 0.5, base + 0.5 + k * 0.62 + rng() * 0.2, d / 2 - 0.1 - rng() * 1.2, 0, 0, 0, s, s, s, pick(rng, MD.bougain));
    }
    F.geo('plainCloth', SHAPES.ball, sx, base + 0.4, d / 2 - 0.4, 0, 0, 0, 0.9, 0.7, 0.9, C(0x4a6a32));
  }
  F.collideBox(0, 0, w / 2, d / 2, bottom, top + 0.6);
  return { top };
}

/*
 * The loggia on Costa Mirra's piazza: a long arcade of round arches on columns under a
 * terracotta roof, its walk paved; beside it a fountain.
 */
export function loggia(B, F, len = 24) {
  const g = F.ground(0, 0);
  const [lo, hi] = B.span(F, len / 2, 3.5);
  const y = hi + 0.3;
  F.box('stone', 0, (lo - 0.6 + y) / 2, 0, len + 1, y - lo + 0.6, 7.6, MD.stone);
  B.ctx.world.surfaces.push({ ...B.kit.rect(F.x, F.z, len / 2 + 0.5, 3.8, F.rot), height: () => y });
  const n = Math.round(len / 3.2);
  const ps = len / n;
  F.box('plaster', 0, y + 2.6, -3.2, len, 5.2, 0.6, MD.white[0]);
  for (let k = 0; k < n; k++) F.geo('plaster', archPanel(ps, 5.2, ps - 0.8, 4.1, false, 0.6), -len / 2 + (k + 0.5) * ps, y, 3.2, 0, 0, 0, 1, 1, 1, MD.white[1]);
  for (const s of [-1, 1]) F.box('plaster', s * (len / 2 - 0.3), y + 2.6, 0, 0.6, 5.2, 6.4, MD.white[0]);
  for (let k = 0; k <= n; k++) F.collideBox(-len / 2 + k * ps, 3.2, 0.4, 0.35, lo - 1, y + 5);
  F.collideBox(0, -3.2, len / 2, 0.35, lo - 1, y + 5);
  for (const s of [-1, 1]) F.collideBox(s * (len / 2 - 0.3), 0, 0.35, 3.5, lo - 1, y + 5);
  B.roof(F, 'kawara', len + 1.6, 8.4, 1.8, y + 5.15, MD.roof[0], { hip: true, curve: 1.05 });
  F.collideBox(0, 0, len / 2, 3.4, y + 4.9, y + 7.2);
  B.ctx.world.interiors.push({ ...B.kit.rect(F.x, F.z, len / 2 - 0.6, 2.8, F.rot), ceiling: y + 4.6, top: y + 7.5, floor: y, lights: [], name: 'loggia' });
  B.occupy(F, len / 2 + 0.6, 4);
  return g;
}

// A fountain: a round stone basin with a column and a bowl that spills into it.
export function fountain(B, F, r = 3.2) {
  const g = F.ground(0, 0);
  F.geo('stone', SHAPES.disc, 0, g + 0.35, 0, 0, 0, 0, r * 2 + 0.6, 0.7, r * 2 + 0.6, MD.stone);
  F.geo('pool', SHAPES.disc, 0, g + 0.66, 0, 0, 0, 0, r * 2 - 0.3, 0.05, r * 2 - 0.3, C(0x5a9ab0));
  F.geo('stone', SHAPES.cyl8, 0, g + 1.4, 0, 0, 0, 0, 0.6, 1.6, 0.6, MD.stone);
  F.geo('stone', SHAPES.cone, 0, g + 2.25, 0, Math.PI, 0, 0, 2.2, 0.5, 2.2, MD.stone);
  F.geo('pool', SHAPES.disc, 0, g + 2.5, 0, 0, 0, 0, 1.9, 0.04, 1.9, C(0x5a9ab0));
  F.collideCircle(0, 0, r + 0.3, g - 1, g + 0.8);
  B.occupy(F, r + 0.5, r + 0.5);
}

// An iron lamp post with a glass lantern.
export function mdLamp(B, F) {
  const g = F.ground(0, 0);
  F.box('stone', 0, g + 0.2, 0, 0.4, 0.4, 0.4, MD.stone);
  B.cyl(F, 'metal', 0, g, 0, 0.07, 3.4, MD.iron, 8);
  F.box('metal', 0, g + 3.45, 0, 0.42, 0.06, 0.42, MD.iron);
  F.box('lamp', 0, g + 3.2, 0, 0.3, 0.45, 0.3, C(0xfff0d0));
  F.geo('metal', SHAPES.cone, 0, g + 3.6, 0, 0, Math.PI / 4, 0, 0.55, 0.3, 0.55, MD.iron);
  B.lamp(F, 0, g + 3.2, 0);
  F.collideCircle(0, 0, 0.2, g - 1, g + 3.6);
}

/*
 * The Blue Shutter, Costa Mirra's taverna, which you can walk into: tables with
 * chairs, a counter with jugs of wine, casks, a fireplace and hanging lamps.
 */
export function taverna(B, F, rng, spot) {
  const K = B.kit.furn;
  const w = 12;
  const d = 9;
  const h = 3.3;
  const furnish = (room) => {
    const { hw, hd } = room;
    const y = room.y;
    for (const [tx, tz] of [[-hw + 1.8, 0.4], [0.2, 1.4], [hw - 1.8, 0.2], [-1.6, -1.2]]) {
      const T = K.table(room, tx, tz, 1.1, 1.1);
      K.tableware(T, y + 0.78, 1.1, 1.1, rng, { mugs: 2 });
      T.geo('plaster', K.BOTTLE, 0.25, y + 0.91, -0.2, 0, 0, 0, 1, 1, 1, C(0x5a2a3a));
      K.chair(room, tx - 0.85, tz, Math.PI / 2, MD.blue[0]);
      K.chair(room, tx + 0.85, tz, -Math.PI / 2, MD.blue[0]);
    }
    const Cn = K.piece(room, 1.6, -hd + 1.0);
    Cn.box('stone', 0, y + 0.5, 0, 4.2, 1.0, 0.6, MD.white[3]);
    Cn.box('planks', 0, y + 1.03, 0, 4.3, 0.06, 0.7, C(0x6a4a30));
    for (let k = 0; k < 4; k++) Cn.geo('plaster', K.JAR, -1.5 + k * 1.0, y + 1.2, 0, 0, 0, 0, 1.1, 1.3, 1.1, C(0xb5653d));
    Cn.collideBox(0, 0, 2.1, 0.32, y - 1, y + 1.1);
    for (const bx of [-hw + 0.55, -hw + 1.4]) K.barrel(room, bx, -hd + 0.55);
    K.chandelier(room, -1, 0.5);
    keeperSpot(B, room, spot, 1.6, -hd + 0.4 + 0.0);
  };
  const { room, base } = walkIn(B, F, { w, d, h, wallKey: 'plaster', wallTint: MD.white[0], footTint: MD.stone, name: 'the Blue Shutter', furnish });
  sideWindows(F, w, d, base + 1.6);
  for (const s of [-1, 1]) {
    F.box('glass', s * 3.4, base + 1.6, d / 2 + 0.02, 0.9, 1.1, 0.04);
    for (const t of [-1, 1]) F.box('planks', s * 3.4 + t * 0.66, base + 1.6, d / 2 + 0.05, 0.44, 1.15, 0.05, MD.blue[0]);
  }
  const RW = w + 0.9;
  const RD = d + 0.9;
  const rise = RD * 0.27;
  B.roof(F, 'kawara', RW, RD, rise, base + h - 0.05, MD.roof[1], { hip: true, curve: 1.05 });
  // A vine pergola over tables outside.
  for (const s of [-1, 1]) F.box('timber', s * (w / 2 - 0.5), base + 1.4, d / 2 + 3.4, 0.14, 2.8, 0.14, C(0x6a4a30));
  F.box('timber', 0, base + 2.8, d / 2 + 2.0, w, 0.1, 3.0, C(0x6a4a30));
  F.geo('plainCloth', SHAPES.blob, 0, base + 3.0, d / 2 + 2.0, 0, 0, 0, w - 0.5, 0.4, 3.2, C(0x5a8a3a));
  for (const s of [-1, 1]) F.collideCircle(s * (w / 2 - 0.5), d / 2 + 3.4, 0.15, base - 1, base + 2.8);
  room.finish(base + h + rise);
  return { top: base + h + rise };
}
