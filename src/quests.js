/*
 * quests.js: the traveller's purse and bag, the market's shops, and the bounties of
 * the Wardens' Guild.
 *
 * Shops open from a shopkeeper's conversation (a reply with "do": "shop"). Food
 * heals; keepsakes are just nice to have; Brannoc's steel sword hits harder.
 *
 * Each bounty is a case: the guildmaster names it, a witness describes the culprit,
 * and the traveller must pick the right person out of the crowd by their looks and
 * accuse them. The culprit runs; caught and beaten until they yield, they can be
 * bound (E) and led back to the guild for the reward. The state of every case lives
 * in the dialogue flags (see the guild section of data/npcs.json), so it is saved
 * with them; coins and the bag are saved here.
 */

export const START_COINS = 30;
const LAG_SECONDS = 2.5;   // a captive left this long far behind catches up out of sight
const HAND_OVER_RANGE = 8; // how close to the guildmaster a captive must stand

export const ITEMS = {
  apple: { name: 'Apple', icon: '🍎', price: 2, heal: 10, verb: 'Eat', about: 'Crisp and sweet, from the orchards past the river.' },
  pear: { name: 'Pear', icon: '🍐', price: 3, heal: 15, verb: 'Eat', about: 'Wynn Hollis grows the best pears. Don’t tell Jory.' },
  berries: { name: 'Punnet of berries', icon: '🍓', price: 4, heal: 20, verb: 'Eat', about: 'Wild berries from the Greywood.' },
  bread: { name: 'Loaf of bread', icon: '🍞', price: 3, heal: 20, verb: 'Eat', about: 'Still warm from Hilde’s oven.' },
  cake: { name: 'Honey cake', icon: '🍰', price: 5, heal: 30, verb: 'Eat', about: 'Made with the hermit’s honey. Sticky and wonderful.' },
  pie: { name: 'Mutton pie', icon: '🥧', price: 7, heal: 45, verb: 'Eat', about: 'A proper pie: thick crust, rich gravy. Keeps you going all day.' },
  ale: { name: 'Mug of ale', icon: '🍺', price: 3, heal: 12, verb: 'Drink', about: 'Brown, foaming, and warming on a cold night.' },
  cheese: { name: 'Wedge of cheese', icon: '🧀', price: 5, heal: 25, verb: 'Eat', about: 'Sharp ewe’s-milk cheese from Millbrook.' },
  salve: { name: 'Healing salve', icon: '🏺', price: 9, heal: 70, verb: 'Apply', about: 'A little pot of salve from the coast. Soothes cuts and bruises in moments.' },
  sausage: { name: 'Smoked sausage', icon: '🌭', price: 4, heal: 22, verb: 'Eat', about: 'Hung in Martha’s chimney for a month. Salty and filling.' },
  honey: { name: 'Pot of honey', icon: '🍯', price: 5, heal: 25, verb: 'Eat', about: 'The hermit’s honey, sold by the spoonful or the pot.' },
  eggs: { name: 'Boiled eggs', icon: '🥚', price: 3, heal: 16, verb: 'Eat', about: 'Three of them, still warm, with a pinch of salt.' },
  fish: { name: 'Grilled perch', icon: '🐟', price: 5, heal: 30, verb: 'Eat', about: 'Caught in Mirrormere this morning and grilled on the quay.' },
  eel: { name: 'Smoked eel', icon: '🍢', price: 7, heal: 40, verb: 'Eat', about: 'A harbour favourite: rich, smoky and oddly delicious.' },
  stew: { name: 'Mutton stew', icon: '🍲', price: 6, heal: 45, verb: 'Eat', about: 'Gwen’s stew, in a crock with a lid. Hearty enough for a troll hunt.' },
  // The quarters' eating houses.
  mead: { name: 'Horn of mead', icon: '🍯', price: 4, heal: 15, verb: 'Drink', about: 'Sigrun’s mead: honey, heather and a kick like a mule.' },
  boar: { name: 'Roast boar', icon: '🍖', price: 8, heal: 50, verb: 'Eat', about: 'A slab of boar off the mead-hall spit, crackling and all.' },
  skyr: { name: 'Bowl of skyr', icon: '🥣', price: 3, heal: 18, verb: 'Eat', about: 'Thick soured milk with lingonberries. Vikings swear by it.' },
  tea: { name: 'Bowl of green tea', icon: '🍵', price: 2, heal: 12, verb: 'Drink', about: 'Bitter, grassy and calming, whisked by Haru herself.' },
  onigiri: { name: 'Rice ball', icon: '🍙', price: 3, heal: 22, verb: 'Eat', about: 'Rice pressed round pickled plum, wrapped in seaweed.' },
  udon: { name: 'Bowl of udon', icon: '🍜', price: 6, heal: 40, verb: 'Eat', about: 'Thick noodles in a hot, clear broth with spring onion.' },
  dango: { name: 'Dango', icon: '🍡', price: 3, heal: 16, verb: 'Eat', about: 'Three sweet rice dumplings on a stick, glazed and grilled.' },
  dumplings: { name: 'Steamed dumplings', icon: '🥟', price: 5, heal: 32, verb: 'Eat', about: 'Pork and ginger dumplings from Mei’s bamboo baskets.' },
  noodles: { name: 'Pulled noodles', icon: '🍝', price: 6, heal: 40, verb: 'Eat', about: 'Hand-pulled noodles with chilli oil. Mei pulls them as you watch.' },
  mooncake: { name: 'Mooncake', icon: '🥮', price: 4, heal: 24, verb: 'Eat', about: 'Lotus paste and a salted yolk in a tender crust.' },
  jasmine: { name: 'Jasmine tea', icon: '🫖', price: 2, heal: 12, verb: 'Drink', about: 'A pot of jasmine tea that perfumes the whole table.' },
  flatbread: { name: 'Flatbread', icon: '🫓', price: 2, heal: 15, verb: 'Eat', about: 'Hot from the clay oven, brushed with oil and herbs.' },
  wrap: { name: 'Lamb wrap', icon: '🥙', price: 7, heal: 45, verb: 'Eat', about: 'Spiced lamb, yoghurt and herbs rolled in warm bread.' },
  sherbet: { name: 'Pomegranate sherbet', icon: '🍹', price: 3, heal: 15, verb: 'Drink', about: 'Cool and tart, chilled with snow carried down from the peaks.' },
  dates: { name: 'Bowl of dates', icon: '🌰', price: 3, heal: 18, verb: 'Eat', about: 'Sticky sweet dates from the far side of the mountains.' },
  olives: { name: 'Dish of olives', icon: '🫒', price: 2, heal: 12, verb: 'Eat', about: 'Green and black olives in oil and lemon.' },
  seastew: { name: 'Lakeside stew', icon: '🥘', price: 7, heal: 48, verb: 'Eat', about: 'Lucia’s fish stew with tomatoes, garlic and a lot of bread for dipping.' },
  wine: { name: 'Cup of wine', icon: '🍷', price: 3, heal: 10, verb: 'Drink', about: 'Red, rough and cheerful.' },
  lemoncake: { name: 'Lemon cake', icon: '🍋', price: 4, heal: 22, verb: 'Eat', about: 'Sticky, sharp and sunny. Sofia brings the lemons.' },
  gruel: { name: 'Bowl of gruel', icon: '🥣', price: 1, heal: 10, verb: 'Eat', about: 'Hot, grey and filling. Old Nan’s gruel has fed half of Mudwick.' },
  ribbon: { name: 'Silk ribbon', icon: '🎀', price: 6, keepsake: 'You tie the ribbon round your wrist. It flutters prettily.', about: 'Bright silk, dyed in Saltmere.' },
  horse: { name: 'Wooden horse', icon: '🐴', price: 8, keepsake: 'You trot the little horse along your palm. Mila’s father has a gift.', about: 'Carved and painted by Mila’s father.' },
  top: { name: 'Spinning top', icon: '🌀', price: 4, keepsake: 'You spin the top on your palm. It hums as it turns.', about: 'A painted top that hums as it spins.' },
  horseshoe: { name: 'Lucky horseshoe', icon: '🧲', price: 2, keepsake: 'You turn the horseshoe over in your hand. It feels lucky.', about: 'Brannoc swears it brings luck. He has a barrel of them.' },
  steel: { name: 'Steel sword', icon: '⚔️', price: 40, unique: true, about: 'Brannoc’s best blade: longer, keener and better balanced than your old sword. Its strokes bite harder.' },
};

/*
 * Who sells what. icon and kind ('food' or 'goods') mark the place on the map and
 * the minimap; where and sells describe it in the map's list of places to eat and shop.
 */
export const SHOPS = {
  jory: { title: 'Jory’s Fruit Stall', greeting: 'Fresh today, every one of them!', items: ['apple', 'pear', 'berries'], icon: '🍎', kind: 'food', where: 'Market', sells: 'Fruit' },
  martha: { title: 'Brindle’s Provisions', greeting: 'A bit of everything, and all of it good.', items: ['bread', 'sausage', 'eggs', 'cheese', 'honey'], icon: '🧺', kind: 'food', where: 'Market', sells: 'Grocer: bread, sausage, eggs, cheese, honey' },
  hilde: { title: 'Hilde’s Bakery', greeting: 'Bread, cakes and pies, straight from the oven.', items: ['bread', 'cake', 'pie'], icon: '🍞', kind: 'food', where: 'Fountain Square', sells: 'Bakery: bread, honey cake, pies' },
  maera: { title: 'The Broken Oar', greeting: 'Ale’s brown, the pie’s hot.', items: ['ale', 'pie', 'cheese'], icon: '🍺', kind: 'food', where: 'By the market', sells: 'Tavern: ale, pies, cheese' },
  gwen: { title: 'The Millstone', greeting: 'Sit down, eat up, and don’t mind the ducks.', items: ['stew', 'pie', 'ale'], icon: '🍺', kind: 'food', where: 'Millbrook', sells: 'Inn: mutton stew, pies, ale' },
  dob: { title: 'Haddock’s Fish Stall', greeting: 'Caught this morning, grilled this minute!', items: ['fish', 'eel'], icon: '🐟', kind: 'food', where: 'Aldra’s Haven', sells: 'Fish stall: grilled perch, smoked eel' },
  tobias: { title: 'Tobias Fenn, Merchant of Saltmere', greeting: 'Wonders from the coast, at honest prices!', items: ['salve', 'cheese', 'ribbon'], icon: '🏺', kind: 'goods', where: 'Market', sells: 'Merchant: healing salve, cheese, ribbons' },
  mila: { title: 'Mila’s Toys and Ribbons', greeting: 'Something pretty, or something for the little ones?', items: ['ribbon', 'horse', 'top'], icon: '🎀', kind: 'goods', where: 'Fountain Square', sells: 'Toys and ribbons' },
  sigrun: { title: 'The Mead Hall of Hrafnvik', greeting: 'Mead, boar and skyr, and a seat by the fire.', items: ['mead', 'boar', 'skyr'], icon: '🍖', kind: 'food', where: 'Hrafnvik', sells: 'Mead hall: mead, roast boar, skyr' },
  haru: { title: 'Haru’s Teahouse', greeting: 'Tea first, then food. Always tea first.', items: ['tea', 'onigiri', 'udon', 'dango'], icon: '🍵', kind: 'food', where: 'Sakuragawa', sells: 'Teahouse: tea, rice balls, udon, dango' },
  mei: { title: 'The Jade Lantern', greeting: 'Dumplings are hot, noodles are pulled!', items: ['dumplings', 'noodles', 'mooncake', 'jasmine'], icon: '🥟', kind: 'food', where: 'Jade Lantern Quarter', sells: 'Eating house: dumplings, noodles, mooncakes, tea' },
  tariq: { title: 'The Caravanserai', greeting: 'Bread, lamb and sherbet for the road.', items: ['flatbread', 'wrap', 'dates', 'sherbet'], icon: '🥙', kind: 'food', where: 'Saffron Bazaar', sells: 'Caravanserai: flatbread, lamb wraps, dates, sherbet' },
  lucia: { title: 'The Blue Shutter', greeting: 'Sit by the window and eat like family.', items: ['olives', 'seastew', 'lemoncake', 'wine'], icon: '🥘', kind: 'food', where: 'Costa Mirra', sells: 'Taverna: olives, fish stew, lemon cake, wine' },
  nan: { title: 'The Leaky Bucket', greeting: 'It’s hot and it’s cheap. Don’t ask what else.', items: ['gruel', 'bread', 'ale'], icon: '🥣', kind: 'food', where: 'Mudwick', sells: 'Alehouse: gruel, bread, ale' },
  smith: { title: 'Brannoc’s Forge', greeting: 'Good steel isn’t cheap. Cheap steel isn’t good.', items: ['steel', 'horseshoe'], icon: '⚒️', kind: 'goods', where: 'North-west of the market', sells: 'Forge: the steel sword' },
};

export const CASES = [
  {
    id: 'case1', title: 'The Market Cutpurse', culprit: 'wat', witness: 'Bartholomew the crier', who: 'Bartholomew', place: 'the market', bounty: 25,
    at: { x: -2, z: 17 },
    brief: 'Purses are being cut at the market in broad daylight. Bartholomew the crier saw the thief make off.',
    clue: 'A skinny young man, no beard, a green hat with a red feather and a patched brown cloak.',
  },
  {
    id: 'case2', title: 'The Smuggler of Aldra’s Haven', culprit: 'silas', witness: 'Nessa the fisherwoman', who: 'Nessa', place: 'the harbour at Aldra’s Haven', bounty: 40,
    at: { x: 362, z: 52 },
    brief: 'Barrels of Saltmere wine keep vanishing off the night boats. Nessa the fisherwoman is out before dawn.',
    clue: 'A young, clean-shaven dockhand in a grey cowl, with a scar right across his cheek.',
  },
  {
    id: 'case3', title: 'The Sheep Thief of Millbrook', culprit: 'dunstan', witness: 'Old Tom on the Millbrook green', who: 'Tom', place: 'Millbrook', bounty: 55,
    at: { x: 40, z: 371 },
    brief: 'Sheep are vanishing from Hob’s flock and being driven south through Millbrook. Old Tom sits on the green all day.',
    clue: 'A big man with a bushy red beard and a straw hat, carrying a sack that bleats.',
  },
];
const CASE_BY_ID = new Map(CASES.map((c) => [c.id, c]));

export class Quests {
  constructor(flags, npcs) {
    this.flags = flags;
    this.npcs = npcs;
    this.coins = START_COINS;
    this.bag = new Map(); // item id -> count
    this._lag = 0;
    this.touch = false; // the controls to name in hints

    // Hooks for what the rest of the game does: heal(amount) -> false at full health,
    // equip(item id), say(text), purse(coins), and onShopClose(reason).
    this.heal = () => true;
    this.equip = () => {};
    this.say = () => {};
    this.purse = () => {};
    this.onShopClose = null;

    const $ = (id) => document.getElementById(id);
    this.shopEl = $('shop');
    this.shopTitle = $('shop-title');
    this.shopGreeting = $('shop-greeting');
    this.shopList = $('shop-list');
    this.shopCoins = $('shop-coins');
    this.shopNote = $('shop-note');
    this.shopId = null;
    $('shop-close').addEventListener('click', () => this.onShopClose && this.onShopClose('click'));
  }

  // ---------------------------------------------------------------- saving

  snapshot() {
    return { coins: this.coins, bag: Object.fromEntries(this.bag) };
  }

  restore(data, player) {
    this.coins = Number.isFinite(data && data.coins) ? Math.max(0, Math.floor(data.coins)) : START_COINS;
    this.bag.clear();
    for (const [id, n] of Object.entries((data && data.bag) || {})) if (ITEMS[id] && Number.isFinite(n) && n > 0) this.bag.set(id, Math.floor(n));
    this.equip(this.bag.has('steel') ? 'steel' : null);
    this.purse(this.coins);
    // Culprits already handed over stay in the cells; one being led to the guild
    // follows the traveller again.
    for (const c of CASES) {
      const npc = this.npcs.byId.get(c.culprit);
      if (!npc) continue;
      this.flags.delete(`${c.id}_here`);
      if (this.flags.has(`${c.id}_done`)) {
        npc.leave();
        continue;
      }
      if (npc.mood) npc.goHome();
      if (this.flags.has(`${c.id}_bound`)) {
        npc.bind(true);
        this._behind(npc, player);
      }
    }
  }

  // ------------------------------------------------------------ the purse

  addCoins(n) {
    this.coins += n;
    this.purse(this.coins);
  }

  // A guard's fine: as much of it as the purse holds.
  fine(n) {
    const paid = Math.min(this.coins, n);
    this.coins -= paid;
    this.purse(this.coins);
    return paid;
  }

  count(id) {
    return this.bag.get(id) || 0;
  }

  // Uses something from the bag; returns what happened, to show the player.
  use(id) {
    const item = ITEMS[id];
    if (!item || !this.count(id)) return null;
    if (item.keepsake) return item.keepsake;
    if (item.heal) {
      if (!this.heal(item.heal)) return 'You are hale and hearty already. Save it for later.';
      this._take(id);
      return `${item.verb === 'Drink' ? 'You drink' : item.verb === 'Apply' ? 'You rub in' : 'You eat'} the ${item.name.toLowerCase()}. (+${item.heal} health)`;
    }
    return null;
  }

  _take(id) {
    const n = this.count(id) - 1;
    if (n > 0) this.bag.set(id, n);
    else this.bag.delete(id);
  }

  // ---------------------------------------------------------------- shops

  hasShop(npcId) {
    return Object.hasOwn(SHOPS, npcId);
  }

  get shopOpen() {
    return !this.shopEl.classList.contains('hidden');
  }

  showShop(npcId) {
    const shop = SHOPS[npcId];
    if (!shop) return false;
    this.shopId = npcId;
    this.shopTitle.textContent = shop.title;
    this.shopGreeting.textContent = `“${shop.greeting}”`;
    this.shopNote.textContent = '';
    this._renderShop();
    this.shopEl.classList.remove('hidden');
    return true;
  }

  hideShop() {
    this.shopEl.classList.add('hidden');
    this.shopId = null;
  }

  _renderShop() {
    const shop = SHOPS[this.shopId];
    this.shopCoins.textContent = String(this.coins);
    this.shopList.replaceChildren(...shop.items.map((id) => {
      const item = ITEMS[id];
      const li = document.createElement('li');
      const icon = Object.assign(document.createElement('span'), { className: 'item-icon', textContent: item.icon });
      icon.setAttribute('aria-hidden', 'true');
      const text = document.createElement('div');
      text.className = 'item-text';
      const name = Object.assign(document.createElement('b'), { textContent: item.name });
      const about = Object.assign(document.createElement('span'), { textContent: item.heal ? `${item.about} +${item.heal} health.` : item.about });
      text.append(name, about);
      const owned = item.unique && this.count(id) > 0;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'buy';
      btn.textContent = owned ? 'Yours' : `${item.price}`;
      btn.disabled = owned || this.coins < item.price;
      if (!owned) btn.prepend(Object.assign(document.createElement('span'), { className: 'coin' }));
      btn.setAttribute('aria-label', owned ? `${item.name}: already yours` : `Buy ${item.name} for ${item.price} crowns`);
      btn.addEventListener('click', () => this.buy(id));
      li.append(icon, text, btn);
      return li;
    }));
  }

  buy(id) {
    const item = ITEMS[id];
    if (!item || this.coins < item.price || (item.unique && this.count(id))) return false;
    this.coins -= item.price;
    this.bag.set(id, this.count(id) + 1);
    this.purse(this.coins);
    if (item.unique) this.equip(id);
    this.shopNote.textContent = item.unique
      ? `The ${item.name.toLowerCase()} is yours. Draw it with ${this.touch ? 'the Sword button' : 'R'}.`
      : `${item.name} bought: it’s in your bag (Journal → Bag).`;
    this._renderShop();
    return true;
  }

  // ---------------------------------------------------------------- cases

  caseOf(npc) {
    return npc && npc.criminal ? CASE_BY_ID.get(npc.criminal) : null;
  }

  // The captive being led to the guild, if any.
  get captive() {
    for (const c of CASES) {
      const npc = this.npcs.byId.get(c.culprit);
      if (npc && npc.mood === 'bound') return npc;
    }
    return null;
  }

  // Before a conversation: is a captive standing by the guildmaster?
  prepareTalk(npc) {
    if (npc.id !== 'guildmaster') return;
    for (const c of CASES) {
      const culprit = this.npcs.byId.get(c.culprit);
      const here = culprit && culprit.mood === 'bound' && Math.hypot(culprit.position.x - npc.position.x, culprit.position.z - npc.position.z) < HAND_OVER_RANGE;
      if (here) this.flags.add(`${c.id}_here`);
      else this.flags.delete(`${c.id}_here`);
    }
  }

  // Binds a culprit who has yielded. Returns the case.
  bind(npc) {
    const c = this.caseOf(npc);
    npc.bind();
    if (c) this.flags.add(`${c.id}_bound`);
    return c;
  }

  // Hands a bound culprit over at the guild. Returns the case, or null.
  handOver(caseId) {
    const c = CASE_BY_ID.get(caseId);
    if (!c || this.flags.has(`${caseId}_done`)) return null;
    const npc = this.npcs.byId.get(c.culprit);
    if (npc) npc.leave();
    this.flags.add(`${caseId}_done`);
    this.flags.delete(`${caseId}_bound`);
    this.flags.delete(`${caseId}_here`);
    this.addCoins(c.bounty);
    return c;
  }

  // The cases taken and not yet closed, for the map.
  get openCases() {
    return CASES.filter((c) => this.flags.has(`${c.id}_open`) && !this.flags.has(`${c.id}_done`));
  }

  // A captive who falls far behind (stuck at a corner, or left while the traveller
  // flew) catches up a moment later, out of sight behind the traveller.
  update(dt, player, standable) {
    const npc = this.captive;
    if (!npc || player.flying || player.airborne) {
      this._lag = 0;
      return;
    }
    const d = Math.hypot(npc.position.x - player.position.x, npc.position.z - player.position.z);
    this._lag = d > 12 ? this._lag + dt : 0;
    if (this._lag > LAG_SECONDS) {
      this._lag = 0;
      this._behind(npc, player, standable);
    }
  }

  _behind(npc, player, standable = () => true) {
    const p = player.position;
    for (const [back, side] of [[1.8, 0], [1.6, 0.9], [1.6, -0.9], [0.4, 1.2], [0.4, -1.2], [0, 0]]) {
      const a = player.heading + Math.PI;
      const x = p.x + Math.sin(a) * back + Math.cos(a) * side;
      const z = p.z + Math.cos(a) * back - Math.sin(a) * side;
      if (!standable(x, z) && back + side !== 0) continue;
      npc.placeAt(x, z, player.heading);
      return;
    }
  }

  // ------------------------------------------------------- journal pages

  // The Bag page: the purse, the sword, and everything bought.
  renderBag(page, refresh) {
    page.replaceChildren();
    const h = Object.assign(document.createElement('h3'), { textContent: 'Your bag' });
    const purse = document.createElement('p');
    purse.className = 'bag-purse';
    purse.append(Object.assign(document.createElement('span'), { className: 'coin' }), ` ${this.coins} crown${this.coins === 1 ? '' : 's'}`);
    const sword = Object.assign(document.createElement('p'), {
      className: 'meta',
      textContent: this.count('steel') ? 'At your hip: Brannoc’s steel sword.' : 'At your hip: your old sword. (Brannoc at the forge sells a better one.)',
    });
    page.append(h, purse, sword);
    const items = [...this.bag.keys()].filter((id) => !ITEMS[id].unique);
    if (!items.length) {
      page.append(Object.assign(document.createElement('p'), { textContent: 'Nothing else yet. The market sells food to mend your wounds, and keepsakes besides. Ask a shopkeeper what they have for sale.' }));
      return;
    }
    const ul = document.createElement('ul');
    ul.className = 'bag-list';
    for (const id of items) {
      const item = ITEMS[id];
      const li = document.createElement('li');
      const icon = Object.assign(document.createElement('span'), { className: 'item-icon', textContent: item.icon });
      icon.setAttribute('aria-hidden', 'true');
      const text = document.createElement('div');
      text.className = 'item-text';
      text.append(Object.assign(document.createElement('b'), { textContent: `${item.name}${this.count(id) > 1 ? ` ×${this.count(id)}` : ''}` }),
        Object.assign(document.createElement('span'), { textContent: item.heal ? `${item.about} +${item.heal} health.` : item.about }));
      const btn = Object.assign(document.createElement('button'), { type: 'button', className: 'buy', textContent: item.keepsake ? 'Look' : item.verb });
      btn.addEventListener('click', () => {
        const text = this.use(id);
        if (text) this.say(text);
        refresh();
      });
      li.append(icon, text, btn);
      ul.append(li);
    }
    page.append(ul);
  }

  // The Bounties page: every case taken, what the witness said, and where it stands.
  renderBounties(page) {
    page.replaceChildren();
    page.append(Object.assign(document.createElement('h3'), { textContent: 'Bounties' }));
    const taken = CASES.filter((c) => this.flags.has(`${c.id}_open`));
    if (!taken.length) {
      page.append(Object.assign(document.createElement('p'), {
        textContent: 'The Wardens’ Guild, on the street west of the market, pays bounties for catching wrongdoers. Its guildmaster stands by the notice board at the door.',
      }));
      return;
    }
    for (const c of taken) {
      const culprit = this.npcs.byId.get(c.culprit);
      const div = document.createElement('div');
      div.className = 'case';
      const done = this.flags.has(`${c.id}_done`);
      const head = Object.assign(document.createElement('h4'), { textContent: `${c.title}${done ? ' (closed)' : ''}` });
      const reward = Object.assign(document.createElement('p'), { className: 'meta', textContent: `Bounty: ${c.bounty} crowns · ${c.place}` });
      div.append(head, reward, Object.assign(document.createElement('p'), { textContent: c.brief }));
      if (this.flags.has(`${c.id}_clue`)) div.append(Object.assign(document.createElement('p'), { className: 'clue', textContent: `What ${c.who} saw: ${c.clue}` }));
      let status;
      if (done) status = `Closed: ${culprit ? culprit.name : 'the culprit'} is in the guild’s cells. You were paid ${c.bounty} crowns.`;
      else if (this.flags.has(`${c.id}_bound`)) status = `${culprit.name} is bound. Lead them to the guildmaster at the Wardens’ Guild.`;
      else if (culprit && culprit.mood === 'yield') status = `${culprit.name} has yielded. Bind them (E) before they slip away.`;
      else if (culprit && (culprit.mood === 'flee' || culprit.mood === 'fight')) status = `${culprit.name} is running! Catch them and beat them until they yield.`;
      else if (this.flags.has(`${c.id}_exposed`)) status = `${culprit.name} got away once. Find them again and confront them.`;
      else if (this.flags.has(`${c.id}_clue`)) status = 'Find whoever matches the description, and accuse them to their face.';
      else status = `Ask ${c.witness} what they saw.`;
      div.append(Object.assign(document.createElement('p'), { className: 'status', textContent: status }));
      page.append(div);
    }
  }
}
