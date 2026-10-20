/*
 * ui.js: DOM overlays and HUD. The start screen, pause menu, toasts, the
 * pointer-lock hint and the debug readout all live here. Game logic calls in;
 * the UI calls back out only through the onBegin / onResume hooks.
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
