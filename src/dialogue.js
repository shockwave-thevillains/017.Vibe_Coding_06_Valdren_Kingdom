/*
 * dialogue.js: runs the branching conversations in data/npcs.json.
 *
 * A tree is { start, nodes }. Each node holds the speaker's line ("text") and
 * 2–3 replies ("choices"); a reply leads to another node ("next") or ends the
 * conversation (no "next"). Nodes and replies may require flags ("if": a list,
 * where "!flag" means the flag must be absent) and may set flags ("set"). The
 * flags are the game's memory of what the player has heard, so one character's
 * answers can open up another's. "start" is a node id or a list of
 * { if, node } tried in order. "met_<npc id>" is set after the first talk.
 * A reply may also ask the game to do something ("do": opening a shop, a culprit
 * bolting, marking the map, handing a captive over); onAction(action, npc) hears it
 * as the reply is chosen, before the next line or the end of the conversation.
 *
 * Text appears with a typewriter effect: click, tap, Space, Enter or E shows it
 * at once. Replies are buttons, also chosen with the number keys; Esc leaves.
 */

const CHARS_PER_SECOND = 52;
const PAUSES = { ',': 0.1, ';': 0.12, ':': 0.12, '.': 0.24, '!': 0.24, '?': 0.24, '—': 0.18 };

export class Dialogue {
  constructor(flags) {
    const $ = (id) => document.getElementById(id);
    this.flags = flags;
    this.el = $('dialogue');
    this.nameEl = $('dlg-name');
    this.roleEl = $('dlg-role');
    this.textEl = $('dlg-text');
    this.choicesEl = $('dlg-choices');

    this.npc = null;
    this.node = null;
    this.onClose = null;
    this.onAction = null;
    this.visited = new Map(); // npc id -> Set of node ids seen
    this._full = '';
    this._shown = 0;
    this._wait = 0;
    this._openedAt = 0;
    this._choicesAt = 0;
    this._buttons = [];

    // Clicks rather than pointer presses, so the click that ends a tap can't land on a
    // reply that the press just revealed; and none right after the box opens.
    this.el.addEventListener('click', (e) => {
      if (!this.isOpen || e.target.closest('button') || performance.now() - this._openedAt < 350) return;
      this.skip();
    });
    window.addEventListener('keydown', (e) => this._onKey(e));
  }

  get isOpen() {
    return this.npc !== null;
  }

  // True while a line is still being typed out (the speaker gestures meanwhile).
  get typing() {
    return this.isOpen && this._shown < this._full.length;
  }

  test(conditions) {
    if (!conditions) return true;
    return conditions.every((c) => (c[0] === '!' ? !this.flags.has(c.slice(1)) : this.flags.has(c)));
  }

  start(npc) {
    const tree = npc.dialogue;
    let id = tree.start;
    if (Array.isArray(id)) {
      const hit = id.find((s) => this.test(s.if));
      id = hit ? hit.node : null;
    }
    if (!id || !tree.nodes[id]) return false;
    this.npc = npc;
    if (!this.visited.has(npc.id)) this.visited.set(npc.id, new Set());
    this.nameEl.textContent = npc.name;
    this.roleEl.textContent = npc.role;
    this.el.classList.remove('hidden');
    this._openedAt = performance.now();
    this._go(id);
    return true;
  }

  // reason: 'choice' (a reply that ends the talk) or 'escape'.
  close(reason = 'choice') {
    if (!this.isOpen) return;
    const npc = this.npc;
    this.flags.add(`met_${npc.id}`);
    this.npc = null;
    this.node = null;
    this.el.classList.add('hidden');
    this.choicesEl.replaceChildren();
    this._buttons = [];
    if (this.onClose) this.onClose(npc, reason);
  }

  // Finishes the line being typed.
  skip() {
    if (!this.typing) return;
    this._shown = this._full.length;
    this.textEl.textContent = this._full;
    this._showChoices();
  }

  update(dt) {
    if (!this.typing) return;
    if (this._wait > 0) {
      this._wait -= dt;
      return;
    }
    const before = Math.floor(this._shown);
    this._shown = Math.min(this._full.length, this._shown + dt * CHARS_PER_SECOND);
    const now = Math.floor(this._shown);
    if (now === before) return;
    this.textEl.textContent = this._full.slice(0, now);
    const pause = PAUSES[this._full[now - 1]];
    if (pause && now < this._full.length) this._wait = pause;
    if (now >= this._full.length) this._showChoices();
  }

  _go(id) {
    const node = this.npc.dialogue.nodes[id];
    if (!node) {
      this.close();
      return;
    }
    this.node = node;
    this.visited.get(this.npc.id).add(id);
    for (const flag of node.set || []) this.flags.add(flag);
    // Spoken lines are quoted (narration inside them closes and reopens the quotes); songs are not.
    this._full = node.text.startsWith('♪') ? node.text : `“${node.text}”`;
    this._shown = 0;
    this._wait = 0.15;
    this.textEl.textContent = '';
    this.choicesEl.replaceChildren();
    this._buttons = [];
  }

  _showChoices() {
    const seen = this.visited.get(this.npc.id);
    this._choicesAt = performance.now();
    let choices = (this.node.choices || []).filter((c) => this.test(c.if));
    if (!choices.length) choices = [{ text: this.node.leave || 'Farewell.' }];
    this._buttons = choices.map((choice, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dlg-choice';
      if (choice.next && seen.has(choice.next)) btn.classList.add('seen');
      if (!choice.next) btn.classList.add('leave');
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = `${i + 1}`;
      btn.append(num, document.createTextNode(choice.text));
      btn.addEventListener('click', () => {
        if (performance.now() - this._choicesAt > 250) this._choose(choice);
      });
      this.choicesEl.append(btn);
      return { btn, choice };
    });
  }

  _choose(choice) {
    if (!this.isOpen) return;
    for (const flag of choice.set || []) this.flags.add(flag);
    if (choice.do && this.onAction) this.onAction(choice.do, this.npc);
    if (choice.next) this._go(choice.next);
    else this.close();
  }

  _onKey(e) {
    if (!this.isOpen || e.repeat) return;
    // Ignore the key press that opened the conversation.
    if (performance.now() - this._openedAt < 200) return;
    const code = e.code;
    if (code === 'Escape') {
      e.preventDefault();
      this.close('escape');
      return;
    }
    if (code === 'Space' || code === 'Enter' || code === 'NumpadEnter' || code === 'KeyE') {
      e.preventDefault();
      if (this.typing) this.skip();
      else if (this._buttons.length === 1) this._choose(this._buttons[0].choice);
      return;
    }
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
    if (m) {
      e.preventDefault();
      if (this.typing) {
        this.skip();
        return;
      }
      const pick = this._buttons[Number(m[1]) - 1];
      if (pick) this._choose(pick.choice);
    }
  }
}
