import * as THREE from 'three';

/*
 * lore.js: the kingdom's secrets and the player's record of them.
 *
 *   Lore      the ten discoverables from data/lore.json, placed at named spots
 *             the world provides (world.anchors), with a glint over each one
 *             not yet found
 *   Reader    the parchment view that opens when something is read
 *   Journal   discoveries, rumours heard in conversation, and the truth once
 *             all ten are found
 *   Progress  saving to localStorage; every call is wrapped so the game still
 *             works where storage is blocked or full
 */

export const LORE_COMPLETE = 'lore_complete';

// ------------------------------------------------------------------ Lore

function glintTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,250,225,1)');
  grd.addColorStop(0.18, 'rgba(255,226,150,0.85)');
  grd.addColorStop(0.5, 'rgba(255,190,90,0.22)');
  grd.addColorStop(1, 'rgba(255,170,60,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  // A faint four-pointed star.
  g.strokeStyle = 'rgba(255,240,200,0.55)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(32, 4);
  g.lineTo(32, 60);
  g.moveTo(4, 32);
  g.lineTo(60, 32);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Lore {
  constructor(scene, world, data) {
    this.data = data;
    this.kinds = data.kinds || {};
    this.entries = (data.entries || []).filter((e) => world.anchors[e.anchor]);
    this.byId = new Map(this.entries.map((e) => [e.id, e]));
    for (const e of this.entries) {
      const a = world.anchors[e.anchor];
      e.pos = new THREE.Vector3(a.x, a.y, a.z);
      e.glint = new THREE.Vector3(...a.glint);
    }
    this.found = [];          // ids, in the order they were found

    const positions = new Float32Array(this.entries.length * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.material = new THREE.PointsMaterial({
      map: glintTexture(),
      color: 0xffe6b0,
      size: 0.8,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);
    this._time = 0;
    this._placeGlints();
  }

  get total() {
    return this.entries.length;
  }

  get complete() {
    return this.total > 0 && this.found.length >= this.total;
  }

  isFound(id) {
    return this.found.includes(id);
  }

  kindOf(entry) {
    return this.kinds[entry.kind] || { label: entry.kind, verb: 'Examine' };
  }

  // Marks an entry found; returns true the first time.
  discover(id, flags) {
    if (!this.byId.has(id) || this.isFound(id)) return false;
    this.found.push(id);
    flags.add(`lore_${id}`);
    if (this.complete) flags.add(LORE_COMPLETE);
    this._placeGlints();
    return true;
  }

  // Restores saved discoveries (unknown ids are dropped), keeping their order.
  restore(ids, flags) {
    this.found = [];
    for (const id of ids || []) if (this.byId.has(id) && !this.found.includes(id)) this.found.push(id);
    for (const id of this.found) flags.add(`lore_${id}`);
    if (this.complete) flags.add(LORE_COMPLETE);
    this._placeGlints();
  }

  // The entry the player is standing by, if any (the closest one in reach).
  nearest(player) {
    let best = null;
    let bestD = Infinity;
    const p = player.position;
    for (const e of this.entries) {
      const d = Math.hypot(e.pos.x - p.x, e.pos.z - p.z);
      if (d > (e.radius || 2.6) || Math.abs(e.pos.y - p.y) > 2.2) continue;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best ? { entry: best, distance: bestD } : null;
  }

  // Glints breathe; found entries have none.
  update(dt) {
    this._time += dt;
    const t = this._time;
    this.material.size = 0.75 + Math.sin(t * 2.3) * 0.2;
    this.material.opacity = 0.75 + Math.sin(t * 3.1) * 0.2;
    this.points.position.y = Math.sin(t * 1.4) * 0.06;
  }

  _placeGlints() {
    const pos = this.geometry.attributes.position;
    this.entries.forEach((e, i) => {
      if (this.isFound(e.id)) pos.setXYZ(i, 0, -1000, 0);
      else pos.setXYZ(i, e.glint.x, e.glint.y, e.glint.z);
    });
    pos.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- shared

function paragraphs(el, text, className) {
  el.replaceChildren();
  for (const line of Array.isArray(text) ? text : [text]) {
    const p = document.createElement('p');
    if (className) p.className = className;
    if (line.startsWith('♪')) {
      p.classList.add('song');
      // Song lines are separated by " / ".
      line.split(' / ').forEach((part, i) => {
        if (i) p.append(document.createElement('br'));
        p.append(part);
      });
    } else {
      p.textContent = line;
    }
    el.append(p);
  }
}

// ---------------------------------------------------------------- Reader

export class Reader {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = $('reader');
    this.newEl = $('reader-new');
    this.kindEl = $('reader-kind');
    this.titleEl = $('reader-title');
    this.placeEl = $('reader-place');
    this.textEl = $('reader-text');
    this.noteEl = $('reader-note');
    this.closeBtn = $('reader-close');
    this.onClose = null;
    this.closeBtn.addEventListener('click', () => this.onClose && this.onClose('click'));
  }

  get isOpen() {
    return !this.el.classList.contains('hidden');
  }

  show(entry, kind, info) {
    this.kindEl.textContent = kind.label;
    this.titleEl.textContent = entry.title;
    this.placeEl.textContent = entry.place;
    paragraphs(this.textEl, entry.text);
    this.noteEl.textContent = entry.note;
    this.newEl.classList.toggle('hidden', !info.first);
    this.newEl.textContent = info.first ? `New discovery · added to your journal (${info.count} of ${info.total})` : '';
    this.el.classList.remove('hidden');
    this.el.scrollTop = 0;
    try {
      this.closeBtn.focus({ preventScroll: true });
    } catch {
      // Focus is a convenience only.
    }
  }

  hide() {
    this.el.classList.add('hidden');
  }
}

// --------------------------------------------------------------- Journal

export class Journal {
  constructor(lore, flags) {
    const $ = (id) => document.getElementById(id);
    this.lore = lore;
    this.flags = flags;
    this.el = $('journal');
    this.countEl = $('journal-count');
    this.listEl = $('journal-list');
    this.pageEl = $('journal-page');
    this.tabs = [...this.el.querySelectorAll('[data-tab]')];
    this.tab = 'finds';
    this.selected = null;
    this.onClose = null;
    // Pages other modules write: tab name -> render(pageEl, refresh).
    this.pages = {};
    $('journal-close').addEventListener('click', () => this.onClose && this.onClose('click'));
    for (const t of this.tabs) t.addEventListener('click', () => this.show(t.dataset.tab));
  }

  get isOpen() {
    return !this.el.classList.contains('hidden');
  }

  // Opens on a tab ('finds', 'heard', 'truth' or one of this.pages); the truth tab exists once
  // everything is found.
  show(tab = this.tab) {
    const lore = this.lore;
    if (tab === 'truth' && !lore.complete) tab = 'finds';
    this.tab = tab;
    this.countEl.textContent = `${lore.found.length}/${lore.total}`;
    for (const t of this.tabs) {
      t.classList.toggle('active', t.dataset.tab === tab);
      t.setAttribute('aria-selected', t.dataset.tab === tab ? 'true' : 'false');
      if (t.dataset.tab === 'truth') t.classList.toggle('hidden', !lore.complete);
    }
    if (this.pages[tab]) {
      this.el.classList.add('single');
      this.listEl.replaceChildren();
      this.pages[tab](this.pageEl, () => this.show(tab));
    } else if (tab === 'finds') this._finds();
    else if (tab === 'heard') this._heard();
    else this._truth();
    this.el.classList.remove('hidden');
  }

  hide() {
    this.el.classList.add('hidden');
  }

  _finds() {
    const lore = this.lore;
    this.el.classList.remove('single');
    this.listEl.replaceChildren();
    if (!lore.found.length) {
      this.el.classList.add('single');
      this._page('Nothing yet', [
        'The pages are blank. Valdren keeps its secrets on stones and scrolls, in banners and behind doors; when something catches the light, take a closer look.',
        'Talking to people helps too: what they let slip is written under Rumours.',
      ]);
      return;
    }
    if (!lore.found.includes(this.selected)) this.selected = lore.found[lore.found.length - 1];
    lore.found.forEach((id, i) => {
      const e = lore.byId.get(id);
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = id === this.selected ? 'active' : '';
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = `${i + 1}`;
      btn.append(num, e.title);
      btn.addEventListener('click', () => {
        this.selected = id;
        this._finds();
      });
      li.append(btn);
      this.listEl.append(li);
    });
    const e = lore.byId.get(this.selected);
    this._page(e.title, e.text, `${lore.kindOf(e).label} · ${e.place}`, e.note);
  }

  _heard() {
    this.el.classList.add('single');
    this.listEl.replaceChildren();
    const lines = (this.lore.data.rumours || []).filter((r) => this.flags.has(r.flag)).map((r) => r.text);
    if (!lines.length) {
      this._page('Rumours', ['You have not heard anything worth writing down yet. The people of Valdren know more than they say at first.']);
      return;
    }
    this.pageEl.replaceChildren();
    const h = document.createElement('h3');
    h.textContent = 'What people have told me';
    const ul = document.createElement('ul');
    ul.className = 'rumours';
    for (const line of lines) {
      const li = document.createElement('li');
      li.textContent = line;
      ul.append(li);
    }
    this.pageEl.append(h, ul);
  }

  _truth() {
    this.el.classList.add('single');
    this.listEl.replaceChildren();
    const { truth, epilogue } = this.lore.data;
    this._page(truth.title, truth.text, null, epilogue && this.flags.has(epilogue.flag) ? null : truth.hint);
    if (epilogue && this.flags.has(epilogue.flag)) {
      const h = document.createElement('h3');
      h.textContent = epilogue.title;
      const body = document.createElement('div');
      paragraphs(body, epilogue.text);
      this.pageEl.append(h, body);
    }
  }

  _page(title, text, meta = null, note = null) {
    this.pageEl.replaceChildren();
    const h = document.createElement('h3');
    h.textContent = title;
    this.pageEl.append(h);
    if (meta) {
      const m = document.createElement('p');
      m.className = 'meta';
      m.textContent = meta;
      this.pageEl.append(m);
    }
    const body = document.createElement('div');
    paragraphs(body, text);
    this.pageEl.append(body);
    if (note) {
      const n = document.createElement('p');
      n.className = 'note';
      n.textContent = note;
      this.pageEl.append(n);
    }
    this.pageEl.scrollTop = 0;
  }
}

// -------------------------------------------------------------- Progress

const KEY = 'valdren.save.v1';

export class Progress {
  constructor() {
    this.available = false;
    try {
      const probe = `${KEY}.probe`;
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      this.available = true;
    } catch {
      this.available = false;
    }
  }

  load() {
    if (!this.available) return null;
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return data && data.v === 1 ? data : null;
    } catch {
      return null;
    }
  }

  // Returns false (and keeps quiet) when the browser refuses, e.g. storage full or blocked.
  save(state) {
    if (!this.available) return false;
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ v: 1, savedAt: Date.now(), ...state }));
      return true;
    } catch {
      return false;
    }
  }

  clear() {
    if (!this.available) return;
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      // Nothing to clear.
    }
  }
}
