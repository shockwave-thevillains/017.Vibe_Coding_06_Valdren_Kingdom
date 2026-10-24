/*
 * wanted.js: what a person looks like, in words, and how well that fits a description.
 *
 * Looking someone over (T) reads their looks from the same data their figure was
 * built from (data/npcs.json): man or woman, young or old, hair, beard, what they
 * wear on their head, their cloak, a scar, a big build. A wanted notice or a
 * witness's account is a handful of the same traits; comparing the two says which
 * details fit and which don't, so lookalikes can be told apart.
 */

// The details a description can name, in the order they are read out.
export const TRAITS = ['sex', 'age', 'build', 'hair', 'beard', 'head', 'cloak', 'scar'];

const LABEL = { sex: 'Sex', age: 'Age', build: 'Build', hair: 'Hair', beard: 'Beard', head: 'Head', cloak: 'Cloak', scar: 'Face' };

function hsl(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-6) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

// A plain colour word for cloth: what a witness would say.
export function clothColour(hex) {
  if (hex === null || hex === undefined) return null;
  if (typeof hex === 'number') hex = `#${hex.toString(16).padStart(6, '0')}`;
  const { h, s, l } = hsl(hex);
  if (l < 0.18) return 'black';
  if (l > 0.8) return 'white';
  if (s < 0.12) return 'grey';
  if (h < 15 || h >= 340) return l < 0.3 && s < 0.5 ? 'brown' : 'red';
  if (h < 38) return l < 0.45 ? 'brown' : 'orange';
  if (h < 70) return l < 0.35 ? 'brown' : 'yellow';
  if (h < 170) return 'green';
  if (h < 200) return 'teal';
  if (h < 255) return 'blue';
  if (h < 290) return 'purple';
  return l < 0.35 ? 'purple' : 'pink';
}

// Hair has its own words: black, brown, red, blond, grey, white.
export function hairColour(hex) {
  const { h, s, l } = hsl(hex || '#3a2a1e');
  if (l < 0.16) return 'black';
  if (s < 0.15) return l > 0.8 ? 'white' : 'grey';
  if (l > 0.55 && h >= 25 && h < 65) return 'blond';
  if (h < 25 && s > 0.45 && l > 0.3) return 'red';
  return 'brown';
}

/*
 * A person's looks as words, from their figure's definition: { sex, age, build,
 * hair, beard, head, cloak, scar }, every value a short phrase.
 */
export function traitsOf(def) {
  const look = def.look || {};
  const outfit = def.outfit || {};
  const age = look.age ?? 0.4;
  const hair = hairColour(look.hair);
  let head = 'bare-headed';
  if (outfit.crown) head = 'a crown';
  else if (outfit.tiara) head = 'a tiara';
  else if (outfit.helmet) head = 'a helmet';
  else if (outfit.strawHat) head = 'a straw hat';
  else if (outfit.hat) head = `a ${clothColour(typeof outfit.hat === 'string' ? outfit.hat : '#2f4a2c')} hat`;
  else if (outfit.cowl) head = `a ${clothColour(typeof outfit.cowl === 'string' ? outfit.cowl : look.cloak ?? '#5a4a38')} cowl`;
  const beard = !look.female && !def.child && look.beard ? `a ${look.beard === 'full' ? 'full' : 'short'} ${hair} beard` : 'no beard';
  return {
    sex: def.child ? 'a child' : look.female ? 'a woman' : 'a man',
    age: def.child ? 'a child' : age < 0.3 ? 'young' : age >= 0.6 ? 'old' : 'middle-aged',
    build: (look.belly ?? 0) >= 0.3 || (def.scale ?? 1) >= 1.08 ? 'big' : 'slight',
    hair: `${hair} hair`,
    beard,
    head,
    cloak: look.cloak ? `a ${clothColour(look.cloak)} cloak` : 'no cloak',
    scar: look.scar ? 'a scar across the cheek' : 'no scar',
  };
}

/*
 * How a person's traits fit a description (spec: some of the same keys and values).
 * Returns { rows: [{ key, label, want, have, ok }], hits, total, full }.
 */
export function compare(spec, traits) {
  const rows = [];
  for (const key of TRAITS) {
    if (!(key in spec)) continue;
    rows.push({ key, label: LABEL[key], want: spec[key], have: traits[key], ok: spec[key] === traits[key] });
  }
  const hits = rows.filter((r) => r.ok).length;
  return { rows, hits, total: rows.length, full: hits === rows.length && rows.length > 0 };
}

// A description read out as a sentence: "A man, no beard, a green hat, a brown cloak."
export function describe(spec) {
  const parts = TRAITS.filter((k) => k in spec).map((k) => spec[k]);
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}
