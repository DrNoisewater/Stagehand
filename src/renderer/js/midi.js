/**
 * A piano keyboard plugged in by USB (or Bluetooth): which keys go down and
 * up, and when. The piano plays its own sound; Stagehand only listens to the
 * keys. Opened only while the Piano part is on (or while you try it in
 * Settings), let go when nobody needs it.
 *
 * Events: 'note' { midi, vel, on, at } (at: page time in ms, as performance.now()),
 * 'pedal' { down }, 'change' (keyboards plugged or unplugged, or picked).
 */
const KEY = 'stagehand.midi';

function saved() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch (_) {
    return {};
  }
}

export const keyboard = new (class extends EventTarget {
  constructor() {
    super();
    this.on = false;
    this.access = null;
    this.input = null;
    this.error = null;
    this.held = new Map(); // key → velocity, for drawing
    this.pedal = false;
    this.users = new Set();
    this._msg = (e) => this._message(e);
  }

  /** The keyboard you picked ('' = the first one found). */
  get deviceId() {
    return saved().id || '';
  }
  /** The name of the keyboard being listened to, or ''. */
  get name() {
    return this.input ? this.input.name || 'Keyboard' : '';
  }

  /** Keyboards that are plugged in: [{ id, label }]. */
  async devices() {
    const acc = await this._access().catch(() => null);
    if (!acc) return [];
    return [...acc.inputs.values()].map((i) => ({ id: i.id, label: i.name || 'Keyboard' }));
  }

  async setDevice(id, label = '') {
    try {
      localStorage.setItem(KEY, JSON.stringify({ id: id || '', label }));
    } catch (_) {}
    if (this.on) this._pick();
    this.dispatchEvent(new Event('change'));
  }

  async _access() {
    if (this.access) return this.access;
    if (!navigator.requestMIDIAccess) throw new Error('Keyboards aren’t supported here.');
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    this.access.onstatechange = () => {
      if (this.on) this._pick();
      this.dispatchEvent(new Event('change'));
    };
    return this.access;
  }

  /** Start listening for `who`; the keyboard stays open while anyone uses it. */
  async start(who = 'keys') {
    this.users.add(who);
    if (this.on) return !!this.input;
    this.error = null;
    try {
      await this._access();
      this.on = true;
      this._pick();
    } catch (e) {
      this.error = /Security|NotAllowed|Permission/i.test(e.name || '') ? 'Windows isn’t letting Stagehand use the keyboard.' : e.message || 'The keyboard couldn’t be opened.';
    }
    this.dispatchEvent(new Event('change'));
    return !!this.input;
  }

  /** `who` is done; the keyboard is let go when nobody uses it. */
  stop(who = 'keys') {
    this.users.delete(who);
    if (this.users.size) return;
    if (this.input) this.input.removeEventListener('midimessage', this._msg);
    this.input = null;
    this.on = false;
    this.held.clear();
    this.pedal = false;
    this.dispatchEvent(new Event('change'));
  }

  /** Listens to the keyboard you picked, or the first one there is. */
  _pick() {
    if (!this.access) return;
    const all = [...this.access.inputs.values()].filter((i) => i.state !== 'disconnected');
    const want = all.find((i) => i.id === this.deviceId) || all.find((i) => i.name && i.name === saved().label) || all[0] || null;
    if (want === this.input) return;
    if (this.input) this.input.removeEventListener('midimessage', this._msg);
    this.input = want;
    this.held.clear();
    if (want) want.addEventListener('midimessage', this._msg);
    else this.error = 'No keyboard found. Plug the piano in by USB and turn it on.';
  }

  _message(e) {
    const d = e.data;
    if (!d || d.length < 2) return;
    const kind = d[0] & 0xf0;
    const at = e.timeStamp || performance.now();
    if (kind === 0x90 && d[2] > 0) {
      this.held.set(d[1], d[2]);
      this.dispatchEvent(Object.assign(new Event('note'), { midi: d[1], vel: d[2], on: true, at }));
    } else if (kind === 0x80 || (kind === 0x90 && d[2] === 0)) {
      this.held.delete(d[1]);
      this.dispatchEvent(Object.assign(new Event('note'), { midi: d[1], vel: 0, on: false, at }));
    } else if (kind === 0xb0 && d[1] === 64) {
      this.pedal = d[2] >= 64;
      this.dispatchEvent(Object.assign(new Event('pedal'), { down: this.pedal }));
    }
  }
})();
