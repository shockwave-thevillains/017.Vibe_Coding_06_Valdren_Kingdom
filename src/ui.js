/*
 * ui.js: DOM overlays and HUD. The start screen, pause menu, toasts, the
 * pointer-lock hint, the talk prompt, name labels and the debug readout all
 * live here (the dialogue box has its own module). Game logic calls in; the UI
 * calls back out only through the onBegin / onResume hooks.
 */

export class UI {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.body = document.body;
    this.startEl = $('start');
    this.statusEl = $('load-status');
    this.beginBtn = $('btn-begin');
    this.pauseEl = $('pause');
    this.resumeBtn = $('btn-resume');
    this.toastEl = $('toast');
    this.hintEl = $('hint');
    this.debugEl = $('debug');
    this.promptEl = $('prompt');
    this.labelsEl = $('labels');
    this.interactBtn = $('btn-interact');
    this._labels = new Map();
    this._prompt = null;

    this.onBegin = null;
    this.onResume = null;
    this._toastTimer = 0;
    this._hint = null;

    const template = $('tpl-controls');
    document.querySelectorAll('.controls-slot').forEach((slot) => {
      slot.replaceWith(template.content.cloneNode(true));
    });

    this.beginBtn.addEventListener('click', () => {
      if (!this.beginBtn.disabled && this.onBegin) this.onBegin();
    });
    this.resumeBtn.addEventListener('click', () => {
      if (this.onResume) this.onResume();
    });
  }

  // ------------------------------------------------------- start screen

  setStatus(text, isError = false) {
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle('error', isError);
  }

  setReady() {
    window.__valdrenReady = true;
    this.setStatus('The gates of Valdren stand open.');
    this.beginBtn.disabled = false;
    try {
      this.beginBtn.focus({ preventScroll: true });
    } catch {
      // Focus is a convenience only.
    }
  }

  hideStart() {
    this.startEl.classList.add('hidden');
  }

  showFatal(message) {
    this.startEl.classList.remove('hidden');
    this.pauseEl.classList.add('hidden');
    this.beginBtn.disabled = true;
    this.setStatus(message, true);
  }

  // --------------------------------------------------------------- pause

  showPause() {
    this.pauseEl.classList.remove('hidden');
    try {
      this.resumeBtn.focus({ preventScroll: true });
    } catch {
      // Focus is a convenience only.
    }
  }

  hidePause() {
    this.pauseEl.classList.add('hidden');
  }

  // ----------------------------------------------------------------- HUD

  setPlaying(playing) {
    this.body.classList.toggle('playing', playing);
  }

  setTouchMode(on) {
    this.body.classList.toggle('touch', on);
  }

  setHint(text) {
    if (text === this._hint) return;
    this._hint = text;
    this.hintEl.textContent = text || '';
    this.hintEl.classList.toggle('hidden', !text);
  }

  // "Talk to …" prompt for whoever is in reach (null hides it).
  setPrompt(name, touch) {
    const key = name ? `${touch ? 't' : 'k'}:${name}` : null;
    if (key === this._prompt) return;
    this._prompt = key;
    this.interactBtn.classList.toggle('ready', !!name);
    this.promptEl.classList.toggle('hidden', !name);
    if (!name) return;
    const who = document.createElement('b');
    who.textContent = name;
    if (touch) {
      this.promptEl.replaceChildren('Tap ', Object.assign(document.createElement('b'), { textContent: 'Interact' }), ' to talk to ', who);
    } else {
      this.promptEl.replaceChildren(Object.assign(document.createElement('kbd'), { textContent: 'E' }), ' Talk to ', who);
    }
  }

  // Floating names: list of { id, text, x, y, opacity, focus } in CSS pixels.
  updateLabels(list) {
    const seen = new Set();
    for (const l of list) {
      let el = this._labels.get(l.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'npc-label';
        el.textContent = l.text;
        this.labelsEl.append(el);
        this._labels.set(l.id, el);
      }
      seen.add(l.id);
      el.style.transform = `translate(${l.x.toFixed(1)}px, ${l.y.toFixed(1)}px) translate(-50%, -100%)`;
      el.style.opacity = l.opacity.toFixed(2);
      el.classList.toggle('focus', l.focus);
      el.hidden = false;
    }
    for (const [id, el] of this._labels) if (!seen.has(id)) el.hidden = true;
  }

  toast(text, ms = 2400) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  get debugVisible() {
    return !this.debugEl.classList.contains('hidden');
  }

  setDebugVisible(visible) {
    this.debugEl.classList.toggle('hidden', !visible);
  }

  setDebugText(text) {
    this.debugEl.textContent = text;
  }
}
