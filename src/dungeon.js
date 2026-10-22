import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createFigure, FigureAnimator, dampAngle } from './player.js';

/*
 * dungeon.js: the dungeons of Valdren, seven places under the ground that monsters
 * have taken, each with monsters of its own:
 *
 *   Gloomhollow Mine        rats, spiders, slimes, goblins          the cave troll
 *   Frostfang Cavern        frost bats, ice wolves, ice slimes      the frost giant
 *   The Sunken Vault        scorpions, jackals, sand slimes         the sand golem
 *   The Jade Hollow         crystal beetles, cave bats, jade slimes the jade golem
 *   The Mistveil Grotto     ronin, giant centipedes, mist wolves    the ronin warlord
 *   The Serpent Grotto      giant crabs, cave serpents, brine slimes the crab queen
 *   Red Garrick's Cellars   thugs, cutthroats, guard dogs, rats     Red Garrick
 *
 * Each is a place of its own: a scene of its own (dark, lit by torches), lying far
 * out east of the land (x > minX), so the world's height and collision queries reach
 * it without touching anything above ground. Going in swaps the scene that is drawn
 * and carries the traveller (and whatever they hold) down into it. A dungeon is
 * built the first time it is entered.
 *
 * Monsters wake when the traveller comes near, chase them, and strike after a short
 * wind-up that can be seen coming (step back, or strike first). Each one that falls
 * drops crowns that fly into the traveller's purse; the chest behind the boss holds
 * more. They are all back, and the chest full again, every time a dungeon is
 * entered. Everything is built in code: the caves from the world's own stone,
 * timber and rock; the beasts from a few merged shapes; goblins, giants, golems,
 * ronin and bandits from the same skinned figure as every person.
 */

const OX = 3000;                // the first dungeon's origin, far east of the land
const SPACING = 400;            // and the next ones' further east still
const FLOOR = 20;               // their floor height
const HEIGHT = 4.4;             // from floor to ceiling
const WALL = 0.9;
const LEASH = 28;               // a monster this far from home gives up the chase
const COIN_COUNT = 24;          // coin sprites in flight at once, at most

// ------------------------------------------------------------- monsters

const KINDS = {
  // Gloomhollow Mine.
  rat: { name: 'Giant rat', health: 30, damage: 5, speed: 4.4, reach: 1.25, windup: 0.32, rest: 0.9, aggro: 10, radius: 0.4, coins: [2, 4], shape: 'rat' },
  spider: { name: 'Cave spider', health: 48, damage: 8, speed: 3.9, reach: 1.6, windup: 0.4, rest: 1.1, aggro: 11, radius: 0.6, coins: [4, 7], shape: 'spider' },
  slime: { name: 'Slime', health: 40, damage: 6, speed: 2.5, reach: 1.35, windup: 0.5, rest: 1.2, aggro: 9, radius: 0.55, coins: [3, 6], shape: 'slime', color: 0x5cc850 },
  goblin: { name: 'Goblin', health: 60, damage: 10, speed: 3.6, reach: 1.7, windup: 0.45, rest: 1.2, aggro: 13, radius: 0.36, coins: [6, 10], shape: 'brute', look: 'goblin' },
  troll: { name: 'Cave troll', health: 420, damage: 22, speed: 3.0, reach: 2.9, windup: 0.8, rest: 1.7, aggro: 15, radius: 0.95, coins: [55, 70], boss: true, shape: 'brute', look: 'troll' },
  // Frostfang Cavern.
  frostbat: { name: 'Frost bat', health: 26, damage: 6, speed: 5.0, reach: 1.4, windup: 0.3, rest: 0.8, aggro: 12, radius: 0.35, coins: [3, 5], shape: 'bat', color: 0xc8dcf0 },
  icewolf: { name: 'Ice wolf', health: 70, damage: 11, speed: 4.8, reach: 1.6, windup: 0.4, rest: 1.0, aggro: 14, radius: 0.55, coins: [7, 11], shape: 'wolf', fur: 0xe8eef6, dark: 0x8aa8c8 },
  iceslime: { name: 'Ice slime', health: 44, damage: 7, speed: 2.4, reach: 1.35, windup: 0.5, rest: 1.2, aggro: 9, radius: 0.55, coins: [4, 6], shape: 'slime', color: 0x9ad8ff },
  giant: { name: 'Frost giant', health: 520, damage: 26, speed: 2.8, reach: 3.1, windup: 0.85, rest: 1.8, aggro: 16, radius: 1.0, coins: [70, 90], boss: true, shape: 'brute', look: 'giant' },
  // The Sunken Vault.
  scorpion: { name: 'Giant scorpion', health: 62, damage: 10, speed: 3.7, reach: 1.8, windup: 0.45, rest: 1.1, aggro: 12, radius: 0.7, coins: [6, 10], shape: 'scorpion', color: 0x8a5a2a },
  jackal: { name: 'Jackal', health: 45, damage: 8, speed: 5.2, reach: 1.45, windup: 0.32, rest: 0.9, aggro: 13, radius: 0.45, coins: [4, 7], shape: 'wolf', fur: 0xc8a068, dark: 0x6a4a2a, scale: 0.8 },
  sandslime: { name: 'Sand slime', health: 46, damage: 7, speed: 2.4, reach: 1.35, windup: 0.5, rest: 1.2, aggro: 9, radius: 0.55, coins: [4, 6], shape: 'slime', color: 0xe0c070 },
  golem: { name: 'Sand golem', health: 560, damage: 24, speed: 2.6, reach: 3.0, windup: 0.9, rest: 1.9, aggro: 15, radius: 1.0, coins: [75, 95], boss: true, shape: 'brute', look: 'sandgolem' },
  // The Jade Hollow.
  beetle: { name: 'Crystal beetle', health: 55, damage: 9, speed: 3.6, reach: 1.5, windup: 0.42, rest: 1.0, aggro: 11, radius: 0.6, coins: [6, 9], shape: 'beetle', color: 0x2fae6a },
  cavebat: { name: 'Cave bat', health: 24, damage: 6, speed: 5.2, reach: 1.4, windup: 0.3, rest: 0.8, aggro: 12, radius: 0.35, coins: [3, 5], shape: 'bat', color: 0x4a3a3a },
  jadeslime: { name: 'Jade slime', health: 48, damage: 7, speed: 2.5, reach: 1.35, windup: 0.5, rest: 1.2, aggro: 9, radius: 0.55, coins: [5, 7], shape: 'slime', color: 0x3adf8a },
  jadegolem: { name: 'Jade golem', health: 600, damage: 25, speed: 2.6, reach: 3.0, windup: 0.9, rest: 1.9, aggro: 15, radius: 1.0, coins: [80, 100], boss: true, shape: 'brute', look: 'jadegolem' },
  // The Mistveil Grotto.
  ronin: { name: 'Ronin', health: 80, damage: 12, speed: 3.8, reach: 1.9, windup: 0.42, rest: 1.1, aggro: 14, radius: 0.36, coins: [9, 14], shape: 'brute', look: 'ronin' },
  centipede: { name: 'Giant centipede', health: 50, damage: 8, speed: 4.2, reach: 1.5, windup: 0.38, rest: 1.0, aggro: 11, radius: 0.5, coins: [5, 8], shape: 'snake', color: 0x8a2a1a, legs: true },
  mistwolf: { name: 'Mist wolf', health: 66, damage: 10, speed: 4.8, reach: 1.6, windup: 0.4, rest: 1.0, aggro: 14, radius: 0.55, coins: [6, 10], shape: 'wolf', fur: 0x9aa0a8, dark: 0x4a5058 },
  warlord: { name: 'Ronin warlord', health: 540, damage: 28, speed: 3.4, reach: 2.6, windup: 0.62, rest: 1.5, aggro: 16, radius: 0.8, coins: [80, 100], boss: true, shape: 'brute', look: 'warlord' },
  // The Serpent Grotto.
  crab: { name: 'Giant crab', health: 65, damage: 10, speed: 3.2, reach: 1.6, windup: 0.45, rest: 1.1, aggro: 11, radius: 0.7, coins: [6, 10], shape: 'crab', color: 0xb8402a },
  serpent: { name: 'Cave serpent', health: 55, damage: 9, speed: 4.4, reach: 1.6, windup: 0.38, rest: 1.0, aggro: 12, radius: 0.5, coins: [5, 9], shape: 'snake', color: 0x2a6a6a },
  brine: { name: 'Brine slime', health: 44, damage: 7, speed: 2.5, reach: 1.35, windup: 0.5, rest: 1.2, aggro: 9, radius: 0.55, coins: [4, 6], shape: 'slime', color: 0x3aa0a8 },
  crabqueen: { name: 'Crab queen', health: 580, damage: 25, speed: 2.8, reach: 3.0, windup: 0.8, rest: 1.7, aggro: 15, radius: 1.5, coins: [80, 100], boss: true, shape: 'crab', color: 0xd85a2a, scale: 2.6 },
  // Red Garrick's Cellars.
  thug: { name: 'Thug', health: 75, damage: 11, speed: 3.6, reach: 1.8, windup: 0.45, rest: 1.2, aggro: 13, radius: 0.38, coins: [8, 12], shape: 'brute', look: 'thug' },
  cutthroat: { name: 'Cutthroat', health: 60, damage: 13, speed: 4.2, reach: 1.8, windup: 0.36, rest: 1.0, aggro: 14, radius: 0.36, coins: [9, 13], shape: 'brute', look: 'cutthroat' },
  dog: { name: 'Guard dog', health: 50, damage: 9, speed: 5.2, reach: 1.45, windup: 0.32, rest: 0.9, aggro: 14, radius: 0.45, coins: [4, 7], shape: 'wolf', fur: 0x6a4a2a, dark: 0x3a2a1a, scale: 0.85 },
  garrick: { name: 'Red Garrick', health: 520, damage: 24, speed: 3.6, reach: 2.3, windup: 0.55, rest: 1.4, aggro: 16, radius: 0.6, coins: [90, 120], boss: true, shape: 'brute', look: 'garrick' },
};

// ------------------------------------------------------------- dungeons

/*
 * Each dungeon: its rooms and tunnels (metres from its origin, x east, z south;
 * edges on whole metres; the first is the hall with the way out), who lives
 * where (offsets from a room's centre), its look (theme), where its chest stands
 * (behind the boss) and what the toasts say.
 */
export const DUNGEONS = [
  {
    id: 'mine', name: 'Gloomhollow Mine', icon: '⛏️', theme: 'mine', where: 'North-west hills, west of the castle road',
    about: 'Rats, spiders, slimes and goblins lurk below, and a cave troll in the deepest hall.',
    treasure: 'The miners’ silver!', chestCoins: [30, 45], chest: ['lair', 0, -9.6],
    areas: [
      ['hall', -6, 6, -6, 6, true], ['c1', -2, 2, -18, -6], ['nest', -8, 8, -34, -18, true], ['c2', 8, 21, -28, -24],
      ['webs', 21, 39, -35, -17, true], ['c3', -20, -8, -28, -24], ['pools', -36, -20, -33, -19, true], ['c4', 28, 32, -55, -35],
      ['camp', 19, 41, -77, -55, true], ['c5', 0, 19, -68, -64], ['lair', -24, 0, -78, -54, true],
    ],
    spawns: [
      ['nest', 'rat', [[-4, -3], [3, -5], [5, 3], [-5, 4], [0, 1], [2, -1]]],
      ['webs', 'spider', [[-4, -4], [5, -3], [-3, 5], [4, 5]]],
      ['pools', 'slime', [[-4, -3], [3, -2], [-2, 3], [4, 3]]],
      ['camp', 'goblin', [[-5, -4], [4, -6], [6, 3], [-6, 5], [0, -1]]],
      ['lair', 'goblin', [[6, 6], [6, -6]]],
      ['lair', 'troll', [[-3, -2]]],
    ],
  },
  {
    id: 'frost', name: 'Frostfang Cavern', icon: '❄️', theme: 'frost', where: 'Under the western peaks, beyond Hrafnvik',
    about: 'Frost bats, ice wolves and ice slimes haunt the frozen caves, and a frost giant sits in the deepest one.',
    treasure: 'A hoard frozen into the ice!', chestCoins: [45, 70], chest: ['throne', 0, -11.5],
    areas: [
      ['hall', -6, 6, -6, 6, true], ['c1', -2, 2, -20, -6], ['den', -10, 10, -40, -20, true], ['c2', 10, 24, -34, -30],
      ['roost', 24, 42, -46, -22, true], ['c3', -24, -10, -34, -30], ['pond', -40, -24, -44, -24, true], ['c4', -2, 2, -56, -40],
      ['throne', -14, 14, -84, -56, true],
    ],
    spawns: [
      ['den', 'icewolf', [[-5, -4], [5, -5], [0, 4], [-4, 5]]],
      ['roost', 'frostbat', [[-4, -6], [4, -4], [-3, 4], [4, 6], [0, 0]]],
      ['pond', 'iceslime', [[-4, -5], [3, -3], [-3, 4], [4, 5]]],
      ['throne', 'icewolf', [[8, 8], [-8, 8]]],
      ['throne', 'giant', [[0, -3]]],
    ],
  },
  {
    id: 'vault', name: 'The Sunken Vault', icon: '🦂', theme: 'vault', where: 'Half buried in the sand, west of the Saffron Bazaar',
    about: 'Scorpions, jackals and sand slimes nest in the buried halls, guarded by a golem of living sandstone.',
    treasure: 'The vault’s old gold!', chestCoins: [50, 75], chest: ['treasury', 0, -10.5],
    areas: [
      ['hall', -6, 6, -6, 6, true], ['c1', -2, 2, -16, -6], ['gallery', -12, 12, -32, -16, true], ['c2', -26, -12, -26, -22],
      ['cistern', -42, -26, -36, -14, true], ['c3', 12, 28, -26, -22], ['pit', 28, 46, -36, -14, true], ['c4', -2, 2, -48, -32],
      ['treasury', -14, 14, -76, -48, true],
    ],
    spawns: [
      ['gallery', 'scorpion', [[-6, -3], [6, -4], [0, 4], [-7, 4]]],
      ['cistern', 'sandslime', [[-3, -6], [3, -3], [-3, 5], [3, 7]]],
      ['pit', 'jackal', [[-5, -6], [5, -4], [-4, 4], [5, 6], [0, 0]]],
      ['treasury', 'scorpion', [[9, 7], [-9, 7]]],
      ['treasury', 'golem', [[0, -3]]],
    ],
  },
  {
    id: 'jade', name: 'The Jade Hollow', icon: '💎', theme: 'jade', where: 'In the hills north of the Jade Lantern Quarter',
    about: 'Crystal beetles, cave bats and jade slimes crawl among glowing crystals, and a golem of jade guards the heart of the hollow.',
    treasure: 'A heap of raw jade and old coin!', chestCoins: [55, 80], chest: ['heart', 0, -11],
    areas: [
      ['hall', -6, 6, -6, 6, true], ['c1', -2, 2, -18, -6], ['grove', -12, 12, -36, -18, true], ['c2', 12, 26, -30, -26],
      ['geode', 26, 46, -44, -18, true], ['c3', 34, 38, -60, -44], ['heart', 22, 50, -88, -60, true], ['c5', -26, -12, -30, -26],
      ['nest', -42, -26, -40, -20, true],
    ],
    spawns: [
      ['grove', 'beetle', [[-6, -4], [5, -3], [-4, 4], [6, 5]]],
      ['geode', 'jadeslime', [[-5, -6], [5, -5], [-4, 6], [5, 6]]],
      ['nest', 'cavebat', [[-4, -5], [4, -3], [-3, 5], [4, 5], [0, 0]]],
      ['heart', 'beetle', [[9, 8], [-9, 8]]],
      ['heart', 'jadegolem', [[0, -3]]],
    ],
  },
  {
    id: 'mist', name: 'The Mistveil Grotto', icon: '🎋', theme: 'mist', where: 'Up the river, west of Sakuragawa',
    about: 'Ronin bandits, giant centipedes and mist wolves hide among the bamboo in the grotto, led by a ronin warlord.',
    treasure: 'The ronin’s plunder!', chestCoins: [50, 75], chest: ['dojo', 0, -11],
    areas: [
      ['hall', -6, 6, -6, 6, true], ['c1', -2, 2, -18, -6], ['bamboo', -14, 14, -38, -18, true], ['c2', -28, -14, -30, -26],
      ['camp', -48, -28, -44, -16, true], ['c3', -40, -36, -62, -44], ['dojo', -54, -22, -90, -62, true], ['c4', 14, 26, -30, -26],
      ['den', 26, 42, -40, -18, true],
    ],
    spawns: [
      ['bamboo', 'centipede', [[-7, -4], [6, -5], [-5, 5], [7, 4]]],
      ['camp', 'ronin', [[-5, -6], [5, -5], [-4, 6], [5, 5]]],
      ['den', 'mistwolf', [[-4, -5], [4, -4], [0, 5]]],
      ['dojo', 'ronin', [[10, 8], [-10, 8]]],
      ['dojo', 'warlord', [[0, -3]]],
    ],
  },
  {
    id: 'serpent', name: 'The Serpent Grotto', icon: '🦀', theme: 'serpent', where: 'On the north-east shore of Mirrormere',
    about: 'Giant crabs, cave serpents and brine slimes lurk in the flooded caves, and the crab queen rules the deepest pool.',
    treasure: 'Pearls and drowned sailors’ gold!', chestCoins: [55, 80], chest: ['lair', 0, -11],
    areas: [
      ['hall', -6, 6, -6, 6, true], ['c1', -2, 2, -18, -6], ['pools', -12, 12, -34, -18, true], ['c2', 12, 24, -28, -24],
      ['channel', 24, 44, -42, -12, true], ['c3', -24, -12, -28, -24], ['shells', -40, -24, -38, -16, true], ['c4', -2, 2, -50, -34],
      ['lair', -16, 16, -80, -50, true],
    ],
    spawns: [
      ['pools', 'crab', [[-6, -3], [6, -4], [-4, 4], [5, 5]]],
      ['channel', 'serpent', [[-4, -8], [4, -2], [-3, 6], [4, 10]]],
      ['shells', 'brine', [[-4, -5], [4, -3], [-3, 5], [4, 6]]],
      ['lair', 'crab', [[9, 8], [-9, 8]]],
      ['lair', 'crabqueen', [[0, -4]]],
    ],
  },
  {
    id: 'cellars', name: 'Red Garrick’s Cellars', icon: '🗡️', theme: 'cellars', where: 'Under Mudwick, by the river (a trapdoor)',
    about: 'Thugs, cutthroats, guard dogs and rats hold the old cellars, and Red Garrick, the bandit king, counts his loot in the last vault.',
    treasure: 'Red Garrick’s stolen hoard!', chestCoins: [60, 90], chest: ['vault', 0, -9.5],
    areas: [
      ['hall', -6, 6, -6, 6, true], ['c1', -2, 2, -16, -6], ['store', -10, 10, -30, -16, true], ['c2', 10, 22, -26, -22],
      ['kennel', 22, 36, -34, -16, true], ['c3', -22, -10, -26, -22], ['dice', -38, -22, -34, -14, true], ['c4', -2, 2, -44, -30],
      ['vault', -14, 14, -66, -44, true],
    ],
    spawns: [
      ['store', 'thug', [[-5, -3], [5, -4], [0, 4]]],
      ['store', 'rat', [[-7, 4], [7, 3]]],
      ['kennel', 'dog', [[-3, -5], [4, -3], [-3, 5], [4, 6]]],
      ['dice', 'cutthroat', [[-4, -5], [4, -4], [-3, 5], [4, 5]]],
      ['vault', 'thug', [[9, 7], [-9, 7]]],
      ['vault', 'garrick', [[0, -3]]],
    ],
  },
];

// How each kind of place looks: floor, ceiling and wall tints, the walls' material,
// the fog and light, and the torches' colour.
const THEMES = {
  mine: { floor: 0x8a8070, roof: 0x6a6258, wall: 0x9a9284, wallKey: 'crag', rock: 0x8a8276, fog: 0x050404, hemi: [0x8a90b0, 0x3a2a1c, 0.9], ambient: [0x4a3c30, 0.6], torch: 0xffa050, plan: ['#3a3128', '#d9c9a0'] },
  frost: { floor: 0xc8d4dc, roof: 0x9aaab8, wall: 0xc0d0dc, wallKey: 'crag', rock: 0xb8c8d8, fog: 0x0a1220, hemi: [0xa8c8f0, 0x3a4a5a, 1.1], ambient: [0x5a6a80, 0.7], torch: 0x9ad0ff, plan: ['#2a3440', '#d8e4ee'] },
  vault: { floor: 0xc8a878, roof: 0xa08860, wall: 0xd8b888, wallKey: 'stone', rock: 0xc0a070, fog: 0x0e0a06, hemi: [0xc0a888, 0x4a3a28, 0.9], ambient: [0x6a5038, 0.6], torch: 0xffb060, plan: ['#3a3020', '#e8d4a8'] },
  jade: { floor: 0x5a6a60, roof: 0x3a4a44, wall: 0x5a7064, wallKey: 'crag', rock: 0x4a6a5a, fog: 0x031008, hemi: [0x80c0a0, 0x1a3a2a, 0.8], ambient: [0x2a5a40, 0.6], torch: 0x9affc0, plan: ['#1e3028', '#b8e0c8'] },
  mist: { floor: 0x6a7058, roof: 0x4a5244, wall: 0x7a8468, wallKey: 'crag', rock: 0x6a7a5a, fog: 0x2a302c, hemi: [0xa8b0a8, 0x3a4030, 1.0], ambient: [0x5a6050, 0.7], torch: 0xffc080, plan: ['#2a3026', '#d0d8c0'] },
  serpent: { floor: 0x4a5a5e, roof: 0x34444a, wall: 0x506468, wallKey: 'crag', rock: 0x4a6064, fog: 0x041014, hemi: [0x70a8b8, 0x1a2a30, 0.9], ambient: [0x2a4a54, 0.6], torch: 0xffb070, plan: ['#1a2a30', '#b8d4d8'] },
  cellars: { floor: 0x7a6a5a, roof: 0x5a4a40, wall: 0xa87a62, wallKey: 'stone', rock: 0x8a6a58, fog: 0x080504, hemi: [0xa89080, 0x3a2a20, 0.9], ambient: [0x5a4030, 0.6], torch: 0xffa050, plan: ['#3a2a22', '#e0c8b0'] },
};

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
const shade = (hex, k) => new THREE.Color(hex).multiplyScalar(k).getHex();

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
  return { body, eyes };
}

// One spider-like leg, from the body outwards along +x: up to the knee, then down to the floor.
function legShape(hex, len = 1) {
  return mergeGeometries([rod([0, 0, 0], [0.5 * len, 0.32 * len, 0], 0.035 * len, hex), rod([0.5 * len, 0.32 * len, 0], [0.95 * len, -0.5 * len, 0], 0.028 * len, shade(hex, 0.85))]);
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
  return { body, eyes, legs: { geo: legShape(0x2a231f), n: 4, y: 0.5, z0: 0.16, dz: 0.13, x: 0.18 } };
}

function slimeShapes(color) {
  const body = new THREE.SphereGeometry(0.55, 18, 12).translate(0, 0.5, 0);
  const eyes = mergeGeometries([-1, 1].map((s) => tinted(SPHERE, 0x101810, M(s * 0.16, 0.66, 0.43, 0, 0, 0, 0.07, 0.09, 0.05))));
  const core = tinted(SPHERE, shade(color, 0.45), M(0, 0.45, 0, 0, 0, 0, 0.22, 0.2, 0.22));
  return { body, eyes, core };
}

// A bat: a furry body with big ears, and two wings that flap.
function batShapes(color) {
  const body = mergeGeometries([
    tinted(SPHERE, color, M(0, 0, 0, 0, 0, 0, 0.16, 0.18, 0.22)),
    tinted(SPHERE, shade(color, 0.9), M(0, 0.06, 0.2, 0, 0, 0, 0.11, 0.1, 0.1)),
    ...[-1, 1].map((s) => tinted(new THREE.ConeGeometry(0.04, 0.14, 5), shade(color, 0.8), M(s * 0.06, 0.18, 0.18, 0, 0, -s * 0.3))),
  ]);
  const eyes = mergeGeometries([-1, 1].map((s) => tinted(SPHERE, 0xff5020, M(s * 0.045, 0.08, 0.29, 0, 0, 0, 0.02, 0.02, 0.02))));
  // One wing reaching out along +x: a fan of three fingers with skin between.
  const s = new THREE.Shape();
  s.moveTo(0, 0.1);
  s.lineTo(0.35, 0.2);
  s.lineTo(0.62, 0.05);
  s.lineTo(0.48, -0.05);
  s.lineTo(0.3, -0.12);
  s.lineTo(0.12, -0.12);
  s.lineTo(0, -0.08);
  const wing = tinted(new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2), shade(color, 0.65));
  return { body, eyes, wing };
}

// A wolf (or jackal, or dog): body, head, snout, ears, tail; four legs that stride.
function wolfShapes(fur, dark) {
  const body = mergeGeometries([
    tinted(SPHERE, fur, M(0, 0.78, -0.05, 0, 0, 0, 0.27, 0.3, 0.66)),
    tinted(SPHERE, fur, M(0, 0.86, 0.42, 0, 0, 0, 0.26, 0.3, 0.3)),
    tinted(SPHERE, fur, M(0, 1.05, 0.72, 0, 0, 0, 0.18, 0.17, 0.2)),
    tinted(new THREE.ConeGeometry(0.1, 0.3, 8).rotateX(Math.PI / 2), shade(fur, 0.9), M(0, 1.0, 0.95)),
    tinted(SPHERE, 0x1a1412, M(0, 1.01, 1.1, 0, 0, 0, 0.04, 0.035, 0.035)),
    ...[-1, 1].map((s) => tinted(new THREE.ConeGeometry(0.06, 0.16, 5), dark, M(s * 0.09, 1.24, 0.66, 0, 0, -s * 0.2))),
    rod([0, 0.9, -0.62], [0, 0.6, -1.15], 0.07, dark),
  ]);
  const eyes = mergeGeometries([-1, 1].map((s) => tinted(SPHERE, 0xffc040, M(s * 0.08, 1.1, 0.86, 0, 0, 0, 0.025, 0.025, 0.02))));
  const leg = tinted(new THREE.CylinderGeometry(0.06, 0.05, 0.62, 6).translate(0, -0.31, 0), dark);
  return { body, eyes, quad: leg };
}

// A scorpion: a segmented body, two pincers and a tail curled over its back.
function scorpionShapes(color) {
  const parts = [
    tinted(SPHERE, color, M(0, 0.42, 0.25, 0, 0, 0, 0.3, 0.18, 0.32)),
    tinted(SPHERE, shade(color, 0.9), M(0, 0.4, -0.18, 0, 0, 0, 0.28, 0.17, 0.3)),
    tinted(SPHERE, shade(color, 0.85), M(0, 0.4, -0.5, 0, 0, 0, 0.22, 0.15, 0.22)),
  ];
  // Pincers on arms reaching forward.
  for (const s of [-1, 1]) {
    parts.push(rod([s * 0.2, 0.42, 0.45], [s * 0.42, 0.38, 0.8], 0.05, color));
    parts.push(tinted(SPHERE, shade(color, 1.1), M(s * 0.45, 0.38, 0.92, 0, 0, 0, 0.12, 0.08, 0.16)));
    parts.push(tinted(new THREE.ConeGeometry(0.035, 0.18, 5).rotateX(Math.PI / 2), shade(color, 0.7), M(s * 0.4, 0.4, 1.1, 0, s * 0.3, 0)));
    parts.push(tinted(new THREE.ConeGeometry(0.035, 0.18, 5).rotateX(Math.PI / 2), shade(color, 0.7), M(s * 0.5, 0.36, 1.1, 0, -s * 0.3, 0)));
  }
  // The tail: segments rising up and over, ending in the sting.
  let prev = [0, 0.45, -0.68];
  for (let k = 1; k <= 6; k++) {
    const a = (k / 6) * Math.PI * 0.95;
    const p = [0, 0.45 + Math.sin(a) * 0.85, -0.68 - Math.sin(a * 0.5) * 0.35 + (1 - Math.cos(a)) * 0.32];
    parts.push(rod(prev, p, 0.07 - k * 0.006, shade(color, 0.95)));
    prev = p;
  }
  parts.push(tinted(new THREE.ConeGeometry(0.05, 0.22, 6), 0x2a1a10, M(prev[0], prev[1] - 0.05, prev[2] + 0.08, 2.4, 0, 0)));
  const eyes = mergeGeometries([-1, 1].map((s) => tinted(SPHERE, 0x101010, M(s * 0.07, 0.56, 0.48, 0, 0, 0, 0.03, 0.03, 0.03))));
  return { body: mergeGeometries(parts), eyes, legs: { geo: legShape(shade(color, 0.8), 0.85), n: 4, y: 0.4, z0: 0.18, dz: 0.16, x: 0.22 } };
}

// A crystal beetle: a glossy domed shell, a horn, six legs.
function beetleShapes(color) {
  const body = mergeGeometries([
    tinted(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), color, M(0, 0.32, -0.08, 0, 0, 0, 0.42, 0.42, 0.55)),
    tinted(SPHERE, shade(color, 0.6), M(0, 0.3, 0.45, 0, 0, 0, 0.2, 0.16, 0.16)),
    tinted(new THREE.ConeGeometry(0.05, 0.35, 6).rotateX(-1.2), shade(color, 1.2), M(0, 0.42, 0.62)),
    tinted(new THREE.OctahedronGeometry(0.12), shade(color, 1.4), M(0.12, 0.72, -0.1)),
    tinted(new THREE.OctahedronGeometry(0.09), shade(color, 1.4), M(-0.15, 0.66, -0.25)),
  ]);
  const eyes = mergeGeometries([-1, 1].map((s) => tinted(SPHERE, 0xc0ffd0, M(s * 0.09, 0.36, 0.58, 0, 0, 0, 0.03, 0.03, 0.03))));
  return { body, eyes, legs: { geo: legShape(shade(color, 0.4), 0.7), n: 3, y: 0.3, z0: 0.2, dz: 0.2, x: 0.25 } };
}

// A crab: a wide shell, eyes on stalks, two great claws and eight legs.
function crabShapes(color) {
  const parts = [tinted(SPHERE, color, M(0, 0.42, 0, 0, 0, 0, 0.55, 0.22, 0.42))];
  for (const s of [-1, 1]) {
    parts.push(rod([s * 0.08, 0.55, 0.3], [s * 0.1, 0.72, 0.36], 0.025, shade(color, 0.8)));
    parts.push(rod([s * 0.42, 0.45, 0.3], [s * 0.62, 0.55, 0.62], 0.07, color));
    parts.push(tinted(SPHERE, shade(color, 1.1), M(s * 0.66, 0.58, 0.78, 0, 0, 0, 0.18, 0.13, 0.22)));
    parts.push(tinted(new THREE.ConeGeometry(0.06, 0.2, 5).rotateX(Math.PI / 2), shade(color, 0.9), M(s * 0.6, 0.62, 0.98)));
  }
  const eyes = mergeGeometries([-1, 1].map((s) => tinted(SPHERE, 0x101010, M(s * 0.1, 0.74, 0.37, 0, 0, 0, 0.04, 0.04, 0.04))));
  return { body: mergeGeometries(parts), eyes, legs: { geo: legShape(shade(color, 0.85), 0.8), n: 4, y: 0.38, z0: 0.16, dz: 0.12, x: 0.3 } };
}

// A serpent (or centipede): a head and a chain of segments that wind behind it.
function snakeShapes(color, legs) {
  const head = mergeGeometries([
    tinted(SPHERE, color, M(0, 0.22, 0, 0, 0, 0, 0.2, 0.15, 0.28)),
    tinted(SPHERE, shade(color, 1.2), M(0, 0.17, 0.12, 0, 0, 0, 0.14, 0.08, 0.2)),
    ...[-1, 1].map((s) => tinted(new THREE.ConeGeometry(0.02, 0.1, 5).rotateX(Math.PI), 0xe8e0d0, M(s * 0.05, 0.1, 0.24))),
  ]);
  const eyes = mergeGeometries([-1, 1].map((s) => tinted(SPHERE, 0xffd030, M(s * 0.1, 0.28, 0.13, 0, 0, 0, 0.03, 0.03, 0.03))));
  const seg = [tinted(SPHERE, color, M(0, 0.18, 0, 0, 0, 0, 0.17, 0.14, 0.2))];
  if (legs) for (const s of [-1, 1]) seg.push(rod([s * 0.12, 0.15, 0], [s * 0.32, 0.0, 0.05], 0.02, shade(color, 0.6)));
  return { head, eyes, seg: mergeGeometries(seg) };
}

// The figures that fight with weapons: how each looks, what it carries and how big it is.
const BRUTES = {
  goblin: { skin: 0x6f8f3a, eyes: 0xe0b020, lips: 0x4f6a2a, tunic: [0x5a4a32, 0x4a3a2a, 0x6a5232], trousers: 0x3a3024, ears: true, weapon: 'club', scale: 0.78, age: 0.3 },
  troll: { skin: 0x7d8a72, eyes: 0xd0a030, lips: 0x5a5a48, tunic: [0x4a3a2a], sleeves: 0x3a2e22, trousers: 0x3a2e22, ears: true, tusks: true, weapon: 'club', scale: 1.9, belly: 0.95, age: 0.6 },
  giant: { skin: 0xc8d4e0, eyes: 0x60b0ff, lips: 0x8a98a8, hair: 0xe8eef4, hairStyle: 'long', beard: 'full', tunic: [0xe8eef4], sleeves: 0xd0dce8, trousers: 0x9aaab8, weapon: 'club', scale: 2.0, belly: 0.6, age: 0.7 },
  sandgolem: { skin: 0xc8a070, eyes: 0xffa020, lips: 0xa88050, tunic: [0xb89060], sleeves: 0xb89060, trousers: 0xa88050, boots: 0x8a6a40, weapon: 'fist', scale: 2.0, belly: 0.4, rocks: 0xa88050 },
  jadegolem: { skin: 0x3a9a6a, eyes: 0xc0ffe0, lips: 0x2a7a50, tunic: [0x2f8a5a], sleeves: 0x2f8a5a, trousers: 0x2a7a50, boots: 0x1f6a44, weapon: 'fist', scale: 2.0, belly: 0.4, rocks: 0x6affb0 },
  ronin: { skin: 0xd0a080, eyes: 0x2a1a10, lips: 0xa06a5a, hair: 0x1a1612, hairStyle: 'bun', tunic: [0x2a2a3a, 0x3a2a2a, 0x2a3a3a], sleeves: 0x1e1e28, trousers: 0x1e1e28, weapon: 'sword', scale: 1.0, mask: 0x1a1a1a, age: 0.35 },
  warlord: { skin: 0xc89878, eyes: 0x2a1a10, lips: 0x905a4a, hair: 0x1a1612, hairStyle: 'bun', beard: 'short', tunic: [0x6a1a1a], sleeves: 0x2a1a1a, trousers: 0x2a1a1a, cloak: 0x3a1010, weapon: 'sword', scale: 1.35, age: 0.5, helm: true },
  thug: { skin: 0xc89070, eyes: 0x3a2a1a, lips: 0xa0605a, hair: 0x3a2a1a, hairStyle: 'short', beard: 'short', tunic: [0x5a4a3a, 0x4a4a3a, 0x6a4a2a], trousers: 0x3a3024, weapon: 'club', scale: 1.05, belly: 0.5, age: 0.4 },
  cutthroat: { skin: 0xd0a080, eyes: 0x3a2a1a, lips: 0xa06a5a, hair: 0x2a1c12, hairStyle: 'long', tunic: [0x2a2a2a, 0x3a2a3a], trousers: 0x2a2420, cloak: 0x2a2a2a, weapon: 'sword', scale: 0.98, age: 0.3, mask: 0x3a1a1a },
  garrick: { skin: 0xd09070, eyes: 0x3a2a1a, lips: 0xa0605a, hair: 0xb8401a, hairStyle: 'long', beard: 'full', tunic: [0x8a1e1a], sleeves: 0x5a1612, trousers: 0x2a2020, cloak: 0x6a1410, cloakTrim: 0xd4a640, weapon: 'sword', scale: 1.3, belly: 0.4, age: 0.45 },
};

function brute(kind, seed) {
  const B = BRUTES[kind];
  const look = {
    seed,
    skin: B.skin,
    hair: B.hair ?? 0x2a2418,
    hairStyle: B.hairStyle ?? 'bald',
    beard: B.beard ?? null,
    stubble: false,
    eyes: B.eyes,
    brows: 0x2a2418,
    lips: B.lips,
    tunic: B.tunic[seed % B.tunic.length],
    sleeves: B.sleeves ?? null,
    trousers: B.trousers,
    boots: B.boots ?? 0x2a2018,
    belt: 0x2a1a10,
    pouch: null,
    trim: 0x5a4a32,
    cloak: B.cloak ?? null,
    cloakTrim: B.cloakTrim ?? null,
    belly: B.belly ?? 0.1,
    age: B.age ?? 0.3,
    gear: (api) => {
      const add = (bone, geometry, hex, matrix, metal = false) => {
        const g = geometry.clone().applyMatrix4(matrix);
        const c = new THREE.Color(hex);
        api.add(bone, g, () => c, metal);
        g.dispose();
      };
      if (B.ears) for (const s of [-1, 1]) add('head', new THREE.ConeGeometry(0.028, kind === 'troll' ? 0.12 : 0.15, 6), B.skin, M(s * 0.092, 1.68, 0.0, 0, 0, -s * 1.15));
      if (B.tusks) for (const s of [-1, 1]) add('head', new THREE.ConeGeometry(0.012, 0.05, 5), 0xe8e0c8, M(s * 0.03, 1.6, 0.095, 0.25));
      // A cloth over the lower face.
      if (B.mask) add('head', new THREE.CylinderGeometry(0.095, 0.1, 0.07, 14, 1, true, -1.2, 2.4), B.mask, M(0, 1.6, 0.0));
      if (B.helm) {
        add('head', new THREE.SphereGeometry(0.13, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0x2a1a1a, M(0, 1.71, -0.01), true);
        for (const s of [-1, 1]) add('head', new THREE.BoxGeometry(0.02, 0.16, 0.05), 0xd4a640, M(s * 0.06, 1.86, 0.06, 0, 0, s * 0.5), true);
      }
      // Lumps of stone or crystal on a golem's shoulders and head.
      if (B.rocks) {
        for (const [bone, x, y, z, r] of [['head', 0.05, 1.82, 0, 0.06], ['head', -0.06, 1.8, -0.03, 0.05], ['chest', 0.15, 1.45, 0, 0.08], ['chest', -0.15, 1.45, -0.02, 0.09]]) {
          add(bone, new THREE.OctahedronGeometry(r), B.rocks, M(x, y, z, 0.4, 0.7, 0.2));
        }
      }
      const held = (m) => api.grip('handR', 'sword').multiply(M(0, 0, 0, 0.6)).multiply(m);
      if (B.weapon === 'club') {
        add('handR', new THREE.CylinderGeometry(0.018, 0.022, 0.5, 7), 0x5a3e26, held(M(0, 0.16, 0)));
        add('handR', new THREE.CylinderGeometry(0.035, 0.052, 0.24, 7), 0x6a4a30, held(M(0, 0.47, 0)));
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          add('handR', new THREE.ConeGeometry(0.013, 0.05, 4), 0x9a9a92, held(M(Math.cos(a) * 0.05, 0.47 + (k % 2) * 0.06, Math.sin(a) * 0.05, 0, -a, -Math.PI / 2)), true);
        }
      } else if (B.weapon === 'sword') {
        add('handR', new THREE.CylinderGeometry(0.016, 0.016, 0.2, 6), 0x2a1a10, held(M(0, 0.02, 0)));
        add('handR', new THREE.BoxGeometry(0.1, 0.02, 0.03), 0xb09040, held(M(0, 0.13, 0)), true);
        add('handR', new THREE.BoxGeometry(0.035, 0.75, 0.008), 0xd8dce2, held(M(0, 0.52, 0)), true);
      }
    },
  };
  const figure = createFigure(look);
  figure.root.scale.setScalar(B.scale);
  return figure;
}

// --------------------------------------------------------------- monster

class Monster {
  constructor(kind, home, index, materials, shapes) {
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
    this.shape = this.spec.shape;
    this._fling = null;
    this._lift = 0;
    const s = shapes(kind);
    if (this.shape === 'brute') {
      this.figure = brute(this.spec.look, 300 + index * 13);
      this.root = this.figure.root;
      this.animator = new FigureAnimator(this.figure);
      this.animator.action = 'sword';
      this.animator.settle();
      this.figure.mesh.castShadow = true;
      this.material = null;
    } else {
      this.root = new THREE.Group();
      this.material = materials.critter.clone();
      const slime = this.shape === 'slime';
      if (slime) {
        this.material = materials.slime.clone();
        this.material.color.set(this.spec.color);
        this.material.emissive.set(this.spec.color).multiplyScalar(0.25);
        this._glow = this.material.emissive.clone();
      }
      if (s.body) {
        this.body = new THREE.Mesh(s.body, this.material);
        this.body.castShadow = true;
        this.root.add(this.body);
      }
      const eyes = new THREE.Mesh(s.eyes, materials.eyes);
      if (!s.seg) this.root.add(eyes);
      if (s.core) this.root.add(new THREE.Mesh(s.core, materials.critter));
      if (s.legs) {
        this.legs = [];
        const L = s.legs;
        for (let i = 0; i < L.n * 2; i++) {
          const side = i < L.n ? 1 : -1;
          const k = i % L.n;
          const leg = new THREE.Mesh(L.geo, this.material);
          leg.position.set(side * L.x, L.y, L.z0 - k * L.dz);
          leg.userData.base = side > 0 ? 0.75 - k * (1.5 / L.n) : Math.PI - (0.75 - k * (1.5 / L.n));
          leg.userData.k = k + (side > 0 ? 0 : 0.5);
          this.legs.push(leg);
          this.root.add(leg);
        }
      }
      if (s.wing) {
        this.wings = [-1, 1].map((side) => {
          const m = new THREE.Mesh(s.wing, materials.wing);
          m.scale.set(side, 1, 1);
          m.position.set(side * 0.1, 0.02, 0);
          this.root.add(m);
          return m;
        });
      }
      if (s.quad) {
        this.quadLegs = [[-1, 0.3], [1, 0.3], [-1, -0.38], [1, -0.38]].map(([sx, z], i) => {
          const m = new THREE.Mesh(s.quad, this.material);
          m.position.set(sx * 0.16, 0.66, z);
          m.userData.k = i === 0 || i === 3 ? 0 : Math.PI;
          this.root.add(m);
          return m;
        });
      }
      if (s.seg) {
        this.headMesh = new THREE.Mesh(s.head, this.material);
        this.headMesh.add(eyes);
        this.root.add(this.headMesh);
        this.segments = [];
        for (let i = 0; i < 9; i++) {
          const m = new THREE.Mesh(s.seg, this.material);
          const k = 1 - i * 0.07;
          m.scale.setScalar(k);
          this.root.add(m);
          this.segments.push(m);
        }
      }
      const base = { rat: 1.3, spider: 1.35, scorpion: 1.15, beetle: 1.2, crab: 1.1, bat: 1.6, wolf: 1.0, snake: 1.4 }[this.shape] ?? 1;
      this.root.scale.setScalar(base * (this.spec.scale ?? 1));
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
      this.fell = true; // the dungeon pays out its crowns on its next update
      this.state = 'dying';
      this.t = 0;
      if (this.animator) this.animator.action = 'downed';
      return 'dead';
    }
    // A light shove back (a boss hardly moves).
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
        // A weapon comes down at the end of the wind-up: start the swing so it lands then.
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
    if (this.material && this.material.emissive) {
      if (this._glow) this.material.emissive.copy(this._glow).lerp(_red, this.hurt);
      else this.material.emissive.setRGB(this.hurt * 0.8, this.hurt * 0.08, this.hurt * 0.05);
    }
    const shape = this.shape;
    if (shape === 'rat') {
      this.body.position.y = Math.abs(Math.sin(p * 2.2)) * 0.05 * Math.min(1, speed);
      this.body.rotation.x = -lunge * 0.35;
      this.body.position.z = lunge * 0.15;
    } else if (this.legs) {
      // Spiders, scorpions, beetles and crabs: legs stepping in waves.
      for (const leg of this.legs) {
        const w = Math.sin(p * 2.4 + leg.userData.k * 1.7) * Math.min(1, speed * 0.6 + 0.08);
        leg.rotation.set(0, leg.userData.base + w * 0.28, Math.max(0, w) * 0.25);
      }
      this.body.rotation.x = -lunge * 0.45;
      this.body.position.y = Math.sin(p * 1.3) * 0.02 + lunge * 0.12;
    } else if (shape === 'bat') {
      // Flapping, bobbing in the air, diving at the traveller to bite.
      const flap = Math.sin(p * 9) * 0.9;
      this.wings[0].rotation.z = flap;
      this.wings[1].rotation.z = -flap;
      this._hover = 1.0 + Math.sin(p * 1.7) * 0.15 - lunge * 0.55;
      this.root.children[0].rotation.x = -lunge * 0.6;
    } else if (shape === 'wolf') {
      const stride = Math.min(1, speed * 0.35);
      for (const leg of this.quadLegs) leg.rotation.x = Math.sin(p * 2.6 + leg.userData.k) * 0.7 * stride;
      this.body.position.y = Math.abs(Math.sin(p * 2.6)) * 0.05 * stride - lunge * 0.06;
      this.body.rotation.x = -lunge * 0.25;
      this.body.position.z = lunge * 0.3;
    } else if (shape === 'snake') {
      // The body winds behind the head; it rears up to strike.
      const amp = 0.18 + Math.min(1, speed * 0.3) * 0.1;
      this.headMesh.position.set(Math.sin(p * 1.4) * amp * 0.4, lunge * 0.35, lunge * 0.25);
      this.segments.forEach((m, i) => {
        m.position.set(Math.sin(p * 1.4 - (i + 1) * 0.7) * amp, 0, -(i + 1) * 0.3);
      });
    } else {
      // A slime wobbles and hops as it goes, and swells before it lunges.
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
      if (shape === 'bat') this._hover = Math.max(0, (this._hover || 1) - this.t);
    }
  }

  _sync() {
    const hover = this.shape === 'bat' ? this._hover ?? 1 : 0;
    this.root.position.set(this.position.x, FLOOR + this._lift + hover - (this.state === 'dying' ? this._sink || 0 : 0), this.position.z);
    this.root.rotation.y = this.heading;
    if (this.state !== 'dying') this.root.rotation.z = 0;
  }
}

const _red = new THREE.Color(0.8, 0.08, 0.05);

// ------------------------------------------------------------ a dungeon

class Dungeon {
  constructor(world, def, index, parent) {
    this.world = world;
    this.def = def;
    this.id = def.id;
    this.name = def.name;
    this.parent = parent;
    this.ox = OX + index * SPACING;
    this.theme = THEMES[def.theme];
    this.areas = def.areas.map(([id, x0, x1, z0, z1, room]) => ({ id, x0, x1, z0, z1, room: !!room }));
    this.area = Object.fromEntries(this.areas.map((a) => [a.id, a]));
    this.bounds = {
      x0: Math.min(...this.areas.map((a) => a.x0)) - 1,
      x1: Math.max(...this.areas.map((a) => a.x1)) + 1,
      z0: Math.min(...this.areas.map((a) => a.z0)) - 1,
      z1: Math.max(...this.areas.map((a) => a.z1)) + 1,
    };
    this.built = false;
    this.monsters = [];
    this.torches = [];
    this.lights = [];
    this.chestOpen = false;
    this._proj = new THREE.Vector3();
    this._lightTimer = 0;
    this._boss = null;
    this.start = { x: this.ox, z: 3.5, heading: Math.PI };
    this.exit = { x: this.ox, z: 4.6 };
    const [aid, cx, cz] = def.chest;
    const a = this.area[aid];
    this.chest = { x: this.ox + (a.x0 + a.x1) / 2 + cx, z: (a.z0 + a.z1) / 2 + cz };
  }

  centre(a) {
    return [(a.x0 + a.x1) / 2, (a.z0 + a.z1) / 2];
  }

  // ------------------------------------------------------------- build

  // Builds the scene the first time the traveller goes down (behind the fade).
  build(quality) {
    if (this.built) return;
    this.built = true;
    const T = this.theme;
    const scene = new THREE.Scene();
    this.scene = scene;
    scene.background = new THREE.Color(T.fog);
    scene.fog = new THREE.Fog(T.fog, this.def.theme === 'mist' ? 6 : 9, this.def.theme === 'mist' ? 30 : 40);
    scene.add(new THREE.HemisphereLight(...T.hemi));
    scene.add(new THREE.AmbientLight(...T.ambient));

    const B = this.world.builder();
    const grid = this._grid();
    this.glow = [];
    this._rooms(B, grid);
    this._props(B);
    B.finish(scene);
    this._glowMesh(scene);
    this._exitGlow(scene);
    this._chest(scene);
    this._spawn(scene);
    this._coins(scene);
    this.setQuality(quality);
    this.minimap = this._paintMap(grid);

    // The camera keeps under the dungeon's ceilings, as in any room.
    for (const a of this.areas) {
      const hw = (a.x1 - a.x0) / 2;
      const hd = (a.z1 - a.z0) / 2;
      this.world.interiors.push({ x: this.ox + a.x0 + hw, z: a.z0 + hd, hw, hd, rot: 0, cos: 1, sin: 0, ceiling: FLOOR + HEIGHT - 0.15, top: FLOOR + HEIGHT + 1, floor: FLOOR, lights: [], name: 'dungeon' });
    }
  }

  // Which whole-metre cells are floor.
  _grid() {
    const { x0, x1, z0, z1 } = this.bounds;
    const h = z1 - z0;
    const cells = new Uint8Array((x1 - x0) * h);
    for (const a of this.areas) {
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
    const T = this.theme;
    const F = B.frame(this.ox, 0, 0);
    const floorTint = new THREE.Color(T.floor);
    const roofTint = new THREE.Color(T.roof);
    const wallTint = new THREE.Color(T.wall);
    const paved = this.def.theme === 'vault' || this.def.theme === 'cellars';
    for (const a of this.areas) {
      const [cx, cz] = this.centre(a);
      const w = a.x1 - a.x0;
      const d = a.z1 - a.z0;
      F.box(a.id === 'hall' || paved ? 'stoneFloor' : 'crag', cx, FLOOR - 0.15, cz, w, 0.3, d, floorTint);
      F.box(paved ? 'stone' : 'crag', cx, FLOOR + HEIGHT + 0.25, cz, w + 1, 0.5, d + 1, roofTint);
    }
    // Wall runs: for each edge between a floor cell and rock.
    const runs = [];
    const { x0, x1, z0, z1 } = this.bounds;
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
      F.box(T.wallKey, cx, FLOOR + HEIGHT / 2, cz, sx, HEIGHT + 0.6, sz, wallTint);
      F.collideBox(cx, cz, sx / 2, sz / 2, FLOOR - 3, FLOOR + HEIGHT + 3);
      // Rough rock bulging from the wall (or, in built vaults, pilasters), and a torch now and then.
      for (let t = r.a + 1.2; t < r.b - 0.6; t += 2.6) {
        n++;
        const ox = r.alongX ? t : face - r.dx * 0.15;
        const oz = r.alongX ? face - r.dz * 0.15 : t;
        if (paved) {
          if (n % 2 === 0) F.box('stone', ox, FLOOR + HEIGHT / 2, oz, r.alongX ? 0.6 : 0.4, HEIGHT, r.alongX ? 0.4 : 0.6, wallTint.clone().multiplyScalar(0.85));
          continue;
        }
        const s = 0.55 + ((n * 37) % 10) / 14;
        F.geo('crag', rock, ox, FLOOR + 0.15 + ((n * 13) % 7) / 4, oz, n, n * 2.1, n * 0.7, s, s * (1.1 + (n % 3) * 0.4), s, new THREE.Color(T.rock).multiplyScalar(0.75 + (n % 5) * 0.07));
      }
      if (len >= 5) {
        for (let t = r.a + 2.5; t < r.b - 1.5; t += 9) {
          const tx = r.alongX ? t : face - r.dx * 0.12;
          const tz = r.alongX ? face - r.dz * 0.12 : t;
          this._torch(F, B, tx, tz, r.dx, r.dz);
        }
      }
    }

    // Props along the tunnels: timber in mines and cellars, nothing in the natural caves.
    if (this.def.theme === 'mine' || this.def.theme === 'cellars') {
      const tunnels = this.areas.filter((a) => !a.room);
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
    }
    // Steps up to the way out.
    for (let k = 0; k < 4; k++) F.box('stone', 0, FLOOR + 0.12 + k * 0.24, 5.2 + k * 0.2, 3.2, 0.24 + k * 0.48, 1.2 - k * 0.25, new THREE.Color(T.wall));
    F.collideBox(0, 5.4, 1.6, 0.6, FLOOR - 1, FLOOR + 1.8);
  }

  // A torch on the wall at (x, z), the wall lying towards (dx, dz).
  _torch(F, B, x, z, dx, dz) {
    const y = FLOOR + 2.3;
    F.box('metal', x - dx * 0.12, y - 0.1, z - dz * 0.12, 0.28 * Math.abs(dz) + 0.06, 0.05, 0.28 * Math.abs(dx) + 0.06, new THREE.Color(0x3a3632));
    F.box('timber', x - dx * 0.25, y, z - dz * 0.25, 0.07, 0.45, 0.07, new THREE.Color(0x4a3624), dz * 0.3, 0, -dx * 0.3);
    F.geo('fire', B.flame, x - dx * 0.3, y + 0.32, z - dz * 0.3, 0, 0, 0, 0.45, 0.6, 0.45);
    this.torches.push(new THREE.Vector3(this.ox + x - dx * 0.5, y + 0.35, z - dz * 0.5));
  }

  // Glowing things (ice, crystals, lanterns) gathered into one mesh of their own.
  _glowMesh(scene) {
    if (!this.glow.length) return;
    const geo = mergeGeometries(this.glow);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.1, emissive: 0xffffff, emissiveIntensity: 0.55 });
    mat.onBeforeCompile = (shader) => {
      // Each piece glows in its own colour.
      shader.fragmentShader = shader.fragmentShader.replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive * vColor.rgb;');
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'glow';
    scene.add(mesh);
  }

  // Adds a glowing shape at (x, y, z) (local to the dungeon).
  _shine(geometry, hex, x, y, z, rx = 0, ry = 0, rz = 0, s = 1, sy = s) {
    const g = tinted(geometry, hex, M(this.ox + x, y, z, rx, ry, rz, s, sy, s));
    if (!g.attributes.normal) g.computeVertexNormals();
    this.glow.push(g);
  }

  // What lies about in each kind of place.
  _props(B) {
    const F = B.frame(this.ox, 0, 0);
    const C = (h) => new THREE.Color(h);
    const rock = B.rock;
    const room = (id) => this.area[id];
    const at = (id) => this.centre(this.area[id]);
    // The hall: crates and barrels left by whoever came before.
    for (const [x, z, s] of [[-4.3, -3.8, 1], [-4.6, -2.6, 0.8], [4.4, -4.2, 0.9], [4.2, 2.6, 1]]) {
      F.box('planks', x, FLOOR + 0.4 * s, z, 0.8 * s, 0.8 * s, 0.8 * s, C(0x8a6a4a));
      F.collideBox(x, z, 0.42 * s, 0.42 * s, FLOOR - 1, FLOOR + 0.8 * s);
    }
    const scatter = (id, n, fn) => {
      const a = room(id);
      for (let k = 0; k < n; k++) {
        const u = ((k * 0.618034 + 0.31) % 1) * 0.84 + 0.08;
        const v = ((k * 0.414214 + 0.17) % 1) * 0.84 + 0.08;
        fn(a.x0 + u * (a.x1 - a.x0), a.z0 + v * (a.z1 - a.z0), k);
      }
    };
    const boulders = (id, n, tint) => scatter(id, n, (x, z, k) => {
      const s = 0.6 + (k % 4) * 0.25;
      const [cx, cz] = at(id);
      if (Math.hypot(x - cx, z - cz) < 3) return;
      F.geo('crag', rock, x, FLOOR + 0.2, z, k, k * 2.3, 0, s, s * 0.8, s, C(tint));
      F.collideCircle(x, z, s * 0.7, FLOOR - 1, FLOOR + s);
    });
    const theme = this.def.theme;
    if (theme === 'mine') return this._mineProps(F, rock, at, B);
    if (theme === 'frost') {
      // Icicles from the ceilings, ice crystals, drifts of snow, a throne of ice.
      for (const a of this.areas) {
        const n = a.room ? 10 : 3;
        for (let k = 0; k < n; k++) {
          const x = a.x0 + 0.8 + ((k * 0.618 + a.x0 * 0.13) % 1) * (a.x1 - a.x0 - 1.6);
          const z = a.z0 + 0.8 + ((k * 0.414 + a.z0 * 0.07) % 1) * (a.z1 - a.z0 - 1.6);
          const len = 0.5 + (k % 4) * 0.35;
          this._shine(new THREE.ConeGeometry(0.12, 1, 6), 0x9ad0ff, x, FLOOR + HEIGHT - len / 2, z, Math.PI, 0, 0, 1, len);
        }
      }
      for (const id of ['den', 'roost', 'pond', 'throne']) {
        scatter(id, 6, (x, z, k) => {
          const [cx, cz] = at(id);
          if (Math.hypot(x - cx, z - cz) < 3.5) return;
          for (let j = 0; j < 3; j++) this._shine(new THREE.OctahedronGeometry(0.3), 0x7ac0ff, x + (j - 1) * 0.3, FLOOR + 0.35 + j * 0.1, z + (j % 2) * 0.3, 0.3 * j, k, 0.2, 0.9 + j * 0.3, 1.8);
          F.collideCircle(x, z, 0.6, FLOOR - 1, FLOOR + 1.2);
        });
        boulders(id, 3, 0xe8f0f8);
      }
      F.box('pool', ...this._centreOf('pond'), 9, 0.04, 9, C(0xb8e0ff));
      const [tx, tz] = at('throne');
      this._shine(new THREE.BoxGeometry(2.4, 2.6, 1.2), 0x8ac8ff, tx, FLOOR + 1.3, tz - 11.6);
      return;
    }
    if (theme === 'vault') {
      // Sandstone columns, sand drifting in, broken jars, heaps of old gold.
      for (const id of ['gallery', 'treasury', 'cistern', 'pit']) {
        const a = room(id);
        for (const fx of [0.25, 0.75]) {
          for (const fz of [0.25, 0.75]) {
            const x = a.x0 + fx * (a.x1 - a.x0);
            const z = a.z0 + fz * (a.z1 - a.z0);
            F.geo('stone', new THREE.CylinderGeometry(0.45, 0.5, HEIGHT, 10), x, FLOOR + HEIGHT / 2, z, 0, 0, 0, 1, 1, 1, C(0xd0b080));
            F.collideCircle(x, z, 0.55, FLOOR - 1, FLOOR + HEIGHT);
          }
        }
        scatter(id, 5, (x, z, k) => {
          F.geo('crag', rock, x, FLOOR - 0.1, z, 0, k, 0, 1.6, 0.35, 1.3, C(0xe0c890));
        });
        scatter(id, 4, (x, z, k) => {
          F.geo('plaster', new THREE.CylinderGeometry(0.2, 0.28, 0.6, 8), x + 0.5, FLOOR + 0.3, z, k % 2 ? 1.4 : 0, k, 0, 1, 1, 1, C(0xb5653d));
        });
      }
      F.box('pool', ...this._centreOf('cistern'), 8, 0.04, 10, C(0x7aa0a0));
      const [tx, tz] = at('treasury');
      for (let k = 0; k < 20; k++) {
        const a = k * 2.4;
        const r = 0.6 + (k % 5) * 0.3;
        F.box('gold', tx + 2.4 + Math.cos(a) * r, FLOOR + 0.06 + (k % 4) * 0.05, tz - 10 + Math.sin(a) * r * 0.5, 0.18, 0.06, 0.12, C(0xffe2a0), 0, a, 0);
      }
      return;
    }
    if (theme === 'jade') {
      // Clusters of glowing jade crystal everywhere, thickest in the heart.
      for (const a of this.areas) {
        const n = a.room ? (a.id === 'heart' ? 14 : 7) : 2;
        for (let k = 0; k < n; k++) {
          const along = k / n;
          const side = k % 2 ? a.x0 + 0.7 : a.x1 - 0.7;
          const z = a.z0 + 0.8 + along * (a.z1 - a.z0 - 1.6);
          const tint = [0x3aff9a, 0x2ad07a, 0x6affc0][k % 3];
          for (let j = 0; j < 3; j++) this._shine(new THREE.OctahedronGeometry(0.28), tint, side + (j - 1) * 0.25, FLOOR + 0.4 + j * 0.15, z + (j % 2) * 0.25, 0.2 * j, k, 0.3, 0.8 + j * 0.25, 2.2 - j * 0.3);
          F.collideCircle(side, z, 0.5, FLOOR - 1, FLOOR + 1.5);
        }
      }
      for (const id of ['grove', 'geode', 'nest', 'heart']) boulders(id, 4, 0x4a6a5a);
      return;
    }
    if (theme === 'mist') {
      // Clumps of bamboo, mossy rocks, paper lanterns, the ronin's mats and tents.
      for (const id of ['bamboo', 'camp', 'den', 'dojo']) {
        scatter(id, id === 'bamboo' ? 8 : 4, (x, z, k) => {
          const [cx, cz] = at(id);
          if (Math.hypot(x - cx, z - cz) < 3.5) return;
          for (let j = 0; j < 6; j++) {
            const a = j * 1.1 + k;
            F.geo('timber', new THREE.CylinderGeometry(0.05, 0.06, HEIGHT - 0.2, 6), x + Math.cos(a) * 0.35, FLOOR + (HEIGHT - 0.2) / 2, z + Math.sin(a) * 0.35, 0, 0, 0, 1, 1, 1, C(0x6a8a3a));
          }
          F.geo('plainCloth', new THREE.IcosahedronGeometry(0.8, 0), x, FLOOR + HEIGHT - 0.8, z, 0, k, 0, 1, 0.6, 1, C(0x5a7a3a));
          F.collideCircle(x, z, 0.6, FLOOR - 1, FLOOR + HEIGHT);
        });
        boulders(id, 3, 0x6a7a5a);
      }
      const [gx, gz] = at('camp');
      for (const [x, z, rot] of [[gx - 6, gz - 7, 0.4], [gx + 6, gz - 7.5, -0.5], [gx - 7, gz + 7, 2.6]]) {
        const T = B.frame(this.ox + x, z, rot);
        for (const s of [-1, 1]) T.box('plainCloth', s * 0.75, FLOOR + 0.95, 0, 0.06, 2.2, 2.6, C(0x3a3a4a), 0, 0, s * 0.62);
        T.collideBox(0, 0, 1.4, 1.4, FLOOR - 1, FLOOR + 2);
      }
      for (const id of ['camp', 'dojo', 'hall']) {
        const [x, z] = at(id);
        for (const s of [-1, 1]) this._shine(new THREE.CylinderGeometry(0.22, 0.24, 0.5, 8), 0xffc890, x + s * 3, FLOOR + 2.6, z - 2);
      }
      const [dx, dz] = at('dojo');
      F.box('planks', dx, FLOOR + 0.03, dz, 14, 0.06, 12, C(0x8a6a44));
      return;
    }
    if (theme === 'serpent') {
      // Tidal pools, shells and wet rock, a deep pool in the queen's lair.
      for (const id of ['pools', 'channel', 'shells', 'lair']) {
        scatter(id, 4, (x, z, k) => {
          const [cx, cz] = at(id);
          if (Math.hypot(x - cx, z - cz) < 3) return;
          F.box('pool', x, FLOOR + 0.02, z, 2.2 + (k % 3), 0.04, 1.8 + (k % 2), C(0x3a7a8a));
        });
        scatter(id, 6, (x, z, k) => {
          this._shine(new THREE.SphereGeometry(0.16, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), [0xf0d8c8, 0xe8b8a8, 0xd8e0f0][k % 3], x, FLOOR, z, 0, k, 0, 1, 0.6);
        });
        boulders(id, 4, 0x3a5054);
      }
      const [lx, lz] = at('lair');
      F.box('pool', lx, FLOOR + 0.02, lz + 6, 14, 0.04, 8, C(0x2a5a6a));
      return;
    }
    if (theme === 'cellars') {
      // Barrels and crates of stolen goods, tables of dice and cards, straw beds, a strongroom.
      for (const id of ['store', 'vault']) {
        scatter(id, 9, (x, z, k) => {
          const [cx, cz] = at(id);
          if (Math.hypot(x - cx, z - cz) < 3.5) return;
          if (k % 2) F.geo('planks', new THREE.CylinderGeometry(0.38, 0.38, 0.95, 10), x, FLOOR + 0.48, z, 0, 0, 0, 1, 1, 1, C(0x6a4a2a));
          else F.box('planks', x, FLOOR + 0.4, z, 0.8, 0.8, 0.8, C(0x8a6a44), 0, k, 0);
          F.collideCircle(x, z, 0.5, FLOOR - 1, FLOOR + 1);
        });
      }
      const [dx, dz] = at('dice');
      for (const [x, z] of [[dx - 3, dz - 3], [dx + 3, dz + 2]]) {
        F.box('planks', x, FLOOR + 0.75, z, 1.8, 0.08, 1.0, C(0x6a4a2a));
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) F.box('timber', x + sx * 0.8, FLOOR + 0.37, z + sz * 0.4, 0.08, 0.74, 0.08, C(0x4a3424));
        for (let k = 0; k < 4; k++) F.box('plainCloth', x - 0.5 + k * 0.3, FLOOR + 0.8, z, 0.1, 0.01, 0.14, C(0xf2eee4), 0, k, 0);
        F.collideBox(x, z, 0.9, 0.5, FLOOR - 1, FLOOR + 0.8);
      }
      const [kx, kz] = at('kennel');
      for (let k = 0; k < 4; k++) F.geo('thatch', rock, kx - 4 + k * 2.6, FLOOR - 0.1, kz + 6, 0, k, 0, 1.4, 0.4, 1.0, C(0xb89a5a));
      const [vx, vz] = at('vault');
      for (let k = 0; k < 16; k++) {
        const a = k * 2.4;
        const r = 0.5 + (k % 5) * 0.25;
        F.box('gold', vx + 2 + Math.cos(a) * r, FLOOR + 0.06 + (k % 4) * 0.05, vz - 9 + Math.sin(a) * r * 0.5, 0.18, 0.06, 0.12, C(0xffe2a0), 0, a, 0);
      }
    }
  }

  // A room's centre and the floor height for a thin flat box there.
  _centreOf(id) {
    const [x, z] = this.centre(this.area[id]);
    return [x, FLOOR + 0.02, z];
  }

  // The Gloomhollow Mine's own furnishings: the rats' nest, the spiders' webs, the goblin camp.
  _mineProps(F, rock, at, B) {
    const C = (h) => new THREE.Color(h);
    for (const [x, z, s] of [[-5, -29, 1.4], [4, -31, 1.2], [5.5, -21, 1.1], [-6, -21.5, 1]]) F.geo('thatch', rock, x, FLOOR - 0.1, z, 0, x, 0, s * 1.3, s * 0.45, s * 1.1, C(0xb89a5a));
    F.box('planks', -2.5, FLOOR + 0.5, -32.6, 1.2, 0.7, 1.6, C(0x6a4a30), 0.4, 0.3, 1.9);
    F.collideCircle(-2.5, -32.6, 0.9, FLOOR - 1, FLOOR + 1);
    const web = C(0xe8e4dc);
    for (const [cx, cz, a] of [[22.5, -33.5, 0.78], [37.5, -33.5, -0.78], [37.5, -18.5, -2.36], [22.5, -18.5, 2.36]]) {
      for (let k = 0; k < 6; k++) F.box('plainCloth', cx, FLOOR + 2.8, cz, 0.02, 0.02, 3.4, web, (k - 2.5) * 0.28, a, 0);
      for (let r = 0.6; r < 1.7; r += 0.5) F.box('plainCloth', cx + Math.sin(a) * r, FLOOR + 2.8 + r * 0.2, cz + Math.cos(a) * r, 0.02, r * 1.4, 0.02, web, 0, a, Math.PI / 2);
    }
    for (const [x, z] of [[24, -31], [25, -30.4], [35.5, -21], [36.2, -21.8], [33, -33]]) F.geo('crag', rock, x, FLOOR + 0.25, z, 0, x, 0, 0.32, 0.4, 0.3, C(0xe0dccf));
    const [gx, gz] = at('camp');
    for (const [x, z, rot, tint] of [[gx - 7, gz - 7, 0.4, 0x6a5a3a], [gx + 7, gz - 7.5, -0.5, 0x5a4a2e], [gx - 7.5, gz + 6.5, 2.6, 0x4a5a3a]]) {
      const T = B.frame(this.ox + x, z, rot);
      for (const s of [-1, 1]) T.box('plainCloth', s * 0.75, FLOOR + 0.95, 0, 0.06, 2.2, 2.6, C(tint), 0, 0, s * 0.62);
      T.box('timber', 0, FLOOR + 1.8, 0, 0.08, 0.08, 2.8, C(0x4a3624));
      T.collideBox(0, 0, 1.4, 1.4, FLOOR - 1, FLOOR + 2);
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      F.geo('crag', rock, gx + Math.cos(a) * 0.9, FLOOR + 0.05, gz + Math.sin(a) * 0.9, 0, a, 0, 0.22, 0.2, 0.22, C(0x7a746a));
    }
    for (const a of [0.3, 1.9]) F.box('timber', gx, FLOOR + 0.12, gz, 1.1, 0.14, 0.14, C(0x3a2a1a), 0, a, 0);
    this.torches.push(new THREE.Vector3(this.ox + gx, FLOOR + 1.0, gz));
    F.box('timber', gx + 9.5, FLOOR + 1.5, gz + 9.5, 0.12, 3, 0.12, C(0x4a3624));
    F.box('plainCloth', gx + 9.5, FLOOR + 2.4, gz + 9.05, 0.04, 1.1, 0.8, C(0x8a2a1a));
    for (const [x, z] of [[gx + 8, gz - 1], [gx + 8.5, gz + 0.3], [gx - 9, gz - 1.5]]) {
      F.box('planks', x, FLOOR + 0.35, z, 0.7, 0.7, 0.7, C(0x7a5a3a));
      F.collideBox(x, z, 0.36, 0.36, FLOOR - 1, FLOOR + 0.7);
    }
    F.collideCircle(gx, gz, 0.9, FLOOR - 1, FLOOR + 0.6);
    const [lx, lz] = at('lair');
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
    glow.position.set(this.ox, FLOOR + 2.2, 6 - 0.05);
    glow.rotation.y = Math.PI;
    scene.add(glow);
    const light = new THREE.PointLight(0xcfd8ff, 12, 12, 1.6);
    light.position.set(this.ox, FLOOR + 2.4, 4.6);
    scene.add(light);
  }

  // The chest behind the boss; its lid opens.
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
    const materials = this.parent.materials();
    const shapes = (kind) => this.parent.shapes(kind);
    for (const [aid, kind, spots] of this.def.spawns) {
      const [cx, cz] = this.centre(this.area[aid]);
      for (const [ox, oz] of spots) {
        const m = new Monster(kind, { x: this.ox + cx + ox, z: cz + oz }, this.parent.nextIndex++, materials, shapes);
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
    if (!this.scene) return;
    // Torch lights follow the presets' lantern lights, but even Low gets two down here.
    const want = Math.max(2, q.lampLights);
    while (this.lights.length < want) {
      const light = new THREE.PointLight(this.theme.torch, 0, 15, 1.5);
      this.scene.add(light);
      this.lights.push(light);
    }
    while (this.lights.length > want) this.scene.remove(this.lights.pop());
    this._lightTimer = 0;
  }

  // A plan of the dungeon in its theme's colours, for the minimap.
  _paintMap(grid) {
    const { x0, x1, z0, z1 } = this.bounds;
    const span = Math.max(x1 - x0, z1 - z0) + 10;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const S = 512;
    const k = S / span;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = this.theme.plan[0];
    g.fillRect(0, 0, S, S);
    g.fillStyle = this.theme.plan[1];
    for (let x = x0; x < x1; x++) {
      for (let z = z0; z < z1; z++) {
        if (grid.floor(x, z)) g.fillRect((x - cx + span / 2) * k, (z - cz + span / 2) * k, k + 0.6, k + 0.6);
      }
    }
    g.fillStyle = '#f6e7b0';
    g.fillRect((-1.5 - cx + span / 2) * k, (5 - cz + span / 2) * k, 3 * k, k);
    return { image: c, half: span / 2, cx: this.ox + cx, cz };
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
    const t = performance.now() * 0.001;
    const mat = this.world.mat;
    if (mat && mat.fire) mat.fire.emissiveIntensity = 2.6 + Math.sin(t * 13) * 0.35 + Math.sin(t * 7.3) * 0.25;
    const P = this.parent;
    const events = (type, monster, value) => {
      if (type === 'blow' && P.onBlow) {
        P._sfx('thud');
        P.onBlow(monster, value);
      } else if (type === 'roused') {
        P._sfx('growl');
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
    // The boss's health bar, while it fights.
    const boss = this.boss && this.boss.alive && this.boss.state !== 'idle' && this.boss.state !== 'return' ? this.boss : null;
    if (boss !== this._boss || boss) {
      this._boss = boss;
      if (P.onBoss) P.onBoss(boss);
    }
  }

  _fallen(m) {
    const coins = rint(m.spec.coins);
    m.say(`+${coins} crowns`, 1.8);
    this._burstCoins(m.position.x, FLOOR + 1, m.position.z, Math.min(10, Math.max(3, Math.round(coins / 2))));
    this.parent._sfx('coin');
    if (this.parent.onLoot) this.parent.onLoot(m, coins);
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
    const p = player.position;
    if (Math.hypot(p.x - this.exit.x, p.z - this.exit.z) < 2.2) return { exit: true, dungeon: this };
    if (Math.hypot(p.x - this.chest.x, p.z - this.chest.z) < 2.0) return this.chestOpen ? null : { chest: true, dungeon: this };
    return null;
  }

  // Opens the chest if its guardian has fallen. Returns { coins } or { text }.
  openChest() {
    if (this.chestOpen) return null;
    if (this.boss && this.boss.alive) return { text: `The ${this.boss.name.toLowerCase()} guards the chest. Defeat it first!` };
    this.chestOpen = true;
    const coins = rint(this.def.chestCoins);
    this._burstCoins(this.chest.x, FLOOR + 1.2, this.chest.z, 12);
    this.parent._sfx('coin');
    return { coins, text: this.def.treasure };
  }

  // Names and health bars over the monsters near the camera.
  labels(camera, width, height) {
    const out = [];
    for (const m of this.monsters) {
      if (!m.root.visible) continue;
      const d = camera.position.distanceTo(m.position);
      const hurt = m.health < m.spec.health;
      if (d > (m.said ? 24 : hurt || m.state !== 'idle' ? 18 : 9)) continue;
      const top = m.animator ? 1.95 * m.root.scale.x : m.shape === 'bat' ? 1.6 : m.shape === 'wolf' ? 1.35 * m.root.scale.x : m.shape === 'spider' || m.shape === 'scorpion' ? 1.3 * m.root.scale.x / 1.2 : 1.05 * Math.max(1, m.root.scale.x * 0.8);
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
}

// ------------------------------------------------------------ the lot

/*
 * All the dungeons. main.js talks to this: select(id) picks the one being entered,
 * and while one is active everything (update, blows, labels, the minimap, the
 * chest) goes to it. Hooks: onBlow(monster, damage), onLoot(monster, coins),
 * onBoss(monster or null), and audio() for the sound effects (an AudioContext and
 * a noise buffer, or null).
 */
export class Dungeons {
  constructor(world, quality) {
    this.world = world;
    this.quality = quality;
    this.minX = OX - 300;
    world.dungeon = this;
    this.list = DUNGEONS.map((def, i) => new Dungeon(world, def, i, this));
    this.byId = Object.fromEntries(this.list.map((d) => [d.id, d]));
    this.current = this.list[0];
    this.active = false;
    this.nextIndex = 0;
    this.onBlow = null;
    this.onLoot = null;
    this.onBoss = null;
    this.audio = () => null;
    this._materials = null;
    this._shapes = new Map();
  }

  // Ground height anywhere below: one level floor.
  ground() {
    return FLOOR;
  }

  // Picks the dungeon being entered and builds it if it has not been yet.
  select(id) {
    this.current = this.byId[id] || this.list[0];
    this.current.build(this.quality);
    return this.current;
  }

  get scene() {
    return this.current.scene;
  }

  get minimap() {
    return this.current.minimap;
  }

  get alive() {
    return this.active ? this.current.monsters.filter((m) => m.alive) : [];
  }

  // Shared materials and shapes (built once, reused by every dungeon).
  materials() {
    if (!this._materials) {
      this._materials = {
        critter: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
        slime: new THREE.MeshStandardMaterial({ color: 0x5cc850, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.78, emissive: 0x153a10 }),
        eyes: new THREE.MeshBasicMaterial({ vertexColors: true }),
        wing: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }),
      };
    }
    return this._materials;
  }

  shapes(kind) {
    const s = KINDS[kind];
    const key = `${s.shape}|${s.color ?? ''}|${s.fur ?? ''}|${s.legs ? 1 : 0}`;
    let shapes = this._shapes.get(key);
    if (!shapes) {
      shapes = {
        rat: () => ratShapes(),
        spider: () => spiderShapes(),
        slime: () => slimeShapes(s.color),
        bat: () => batShapes(s.color),
        wolf: () => wolfShapes(s.fur, s.dark),
        scorpion: () => scorpionShapes(s.color),
        beetle: () => beetleShapes(s.color),
        crab: () => crabShapes(s.color),
        snake: () => snakeShapes(s.color, s.legs),
        brute: () => ({}),
      }[s.shape]();
      this._shapes.set(key, shapes);
    }
    return shapes;
  }

  build() {
    this.current.build(this.quality);
  }

  reset() {
    return this.current.reset();
  }

  setQuality(q) {
    this.quality = q;
    for (const d of this.list) d.setQuality(q);
  }

  update(dt, player) {
    if (this.active) this.current.update(dt, player);
  }

  separate(player) {
    if (this.active) this.current.separate(player);
  }

  struck(player, reach, sweep) {
    return this.active ? this.current.struck(player, reach, sweep) : [];
  }

  reachable(player) {
    return this.active ? this.current.reachable(player) : null;
  }

  openChest() {
    return this.current.openChest();
  }

  labels(camera, width, height) {
    return this.active ? this.current.labels(camera, width, height) : [];
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
