// ---------- Sound ----------
// Every noise the game makes is data, in a manifest like an asset pack's
// sounds/default.json, which is where the shape of a def is written down.
// Everything else names a sound by its id and knows nothing about where it
// comes from — a waveform, a recorded one-shot or a looping track are all just
// ids.
//
// A level or pack may name its own manifest; it is laid over the root set
// rather than replacing it, so a level that wants one sound changed says only
// that, and nothing it leaves out goes quiet by accident.
const ROOT_SOUNDS_URL = window.SOUNDS_URL || '/assetpacks/old/garden/sounds/default.json';
const DEFAULT_TRACK = 'theme';

const SOUND_TAIL = 0.02;   // an oscillator runs this long past its envelope
const SILENT = 0.001;      // an exponential ramp can't reach zero

// Owns everything that makes noise: the synthesized effects, the recorded
// clips they're swapped for, and whichever track is looping behind them.
class SoundBoard {
  constructor(musicId) {
    this.defs = {};
    this.root = null;
    this.manifests = new Map();   // one entry per file, however many levels name it
    this.musicEl = document.getElementById(musicId);
    this.ctx = null;
    this.effectsGain = null;
    this.clips = new Map();     // decoded `src` files, by url
    this.effectsOn = true;
    this.effectsVolume = 1;
    this.musicOn = true;
    this.trackId = DEFAULT_TRACK;
    this.noiseSeed = 1;
  }

  // A def's `src` is resolved here, while the file that named it is still
  // known, so a pack can carry its own clips.
  async loadManifest(url, base) {
    const href = new URL(url, base || location.href).href;
    if (this.manifests.has(href)) return this.manifests.get(href);
    const res = await fetch(href);
    if (!res.ok) throw new Error(`${href}: HTTP ${res.status}`);
    const data = await res.json();
    if (!data || !data.sounds) throw new Error(`${href}: no sounds`);
    const defs = {};
    for (const [name, def] of Object.entries(data.sounds)) {
      defs[name] = def && def.src ? { ...def, src: new URL(def.src, href).href } : def;
    }
    const entry = { defs };
    this.manifests.set(href, entry);
    return entry;
  }

  async loadRoot(url = ROOT_SOUNDS_URL) {
    this.root = await this.loadManifest(url);
    this.use(this.root);
  }

  // An entry of null in a level's manifest silences that one noise, since
  // play() has nothing to build from.
  use(entry) {
    this.defs = { ...(this.root ? this.root.defs : {}), ...(entry ? entry.defs : {}) };
    if (this.ctx) this.loadClips();
    this.applyTrack();          // the same id may now point at a different file
  }

  // Noise runs on its own generator: filling a buffer from Math.random() would
  // pull thousands of values out from under the game, whose own randomness
  // shares that stream — so a sound could change where an enemy spawns.
  noise() {
    this.noiseSeed = (this.noiseSeed * 1664525 + 1013904223) >>> 0;
    return this.noiseSeed / 4294967296;
  }

  // Browsers won't open an audio context without a real gesture, so the first
  // call after one is what actually starts everything.
  resume() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.effectsGain = this.ctx.createGain();
      this.effectsGain.gain.value = this.effectsVolume;
      this.effectsGain.connect(this.ctx.destination);
      this.loadClips();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  // A track is streamed rather than decoded into memory, so only the one-shots
  // are fetched here.
  loadClips() {
    for (const def of Object.values(this.defs)) {
      if (!def || !def.src || def.loop || this.clips.has(def.src)) continue;
      this.clips.set(def.src, null);        // claimed, so it's only fetched once
      fetch(def.src)
        .then(res => res.arrayBuffer())
        .then(bytes => this.ctx.decodeAudioData(bytes))
        .then(buf => this.clips.set(def.src, buf))
        .catch(() => this.clips.delete(def.src));
    }
  }

  // `name` is a sound id, or a reference to one: "sound::coin".
  play(name) {
    const id = String(name ?? '').replace(/^sound::/, '');
    const def = this.defs[id];
    if (!def || def.loop || !this.effectsOn) return;
    if (def.shake && navigator.vibrate) navigator.vibrate(def.shake);
    try {
      const ctx = this.resume();
      const t0 = ctx.currentTime;
      if (def.src) { this.playClip(def, t0); return; }
      // A def is either one shape or a list of them. One shape is the same
      // thing with a single layer, so a manifest written before this plays
      // unchanged.
      for (const layer of (def.layers || [def])) this.playLayer(layer, t0 + (layer.delay || 0));
    } catch (e) { /* audio not available — fail silently */ }
  }

  // An oscillator, a burst of noise, or both at once.
  playLayer(layer, t) {
    if (layer.wave) {
      // a sweep is one note that bends; notes is a run of separate ones
      const run = layer.notes || [0];
      run.forEach((hz, i) => this.playNote(layer, hz, t + i * (layer.step || 0)));
    }
    if (layer.noise) this.playNoise(layer.noise, t);
  }

  playNote(def, hz, t) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = def.wave;
    if (def.sweep) {
      osc.frequency.setValueAtTime(def.sweep[0][0], t);
      for (let i = 1; i < def.sweep.length; i++) {
        osc.frequency.exponentialRampToValueAtTime(def.sweep[i][0], t + def.sweep[i][1]);
      }
    } else {
      osc.frequency.setValueAtTime(hz, t);
    }
    if (def.attack) {
      gain.gain.setValueAtTime(SILENT, t);
      gain.gain.linearRampToValueAtTime(def.gain, t + def.attack);
    } else {
      gain.gain.setValueAtTime(def.gain, t);
    }
    gain.gain.exponentialRampToValueAtTime(SILENT, t + def.decay);
    osc.connect(gain).connect(this.effectsGain);
    osc.start(t);
    osc.stop(t + def.decay + SOUND_TAIL);
  }

  // a burst of static that fades out across its own length
  playNoise(spec, t) {
    const len = Math.floor(this.ctx.sampleRate * spec.decay);
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (this.noise() * 2 - 1) * (1 - i / len);
    const node = this.ctx.createBufferSource();
    node.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(spec.gain, t);
    gain.gain.exponentialRampToValueAtTime(SILENT, t + spec.decay);
    // A lowpass closing over the burst is what turns a hiss into a thud, so
    // static can be tuned rather than only made louder or longer.
    let tail = node;
    if (spec.from) {
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(spec.from, t);
      filter.frequency.exponentialRampToValueAtTime(Math.max(1, spec.to || spec.from), t + spec.decay);
      node.connect(filter);
      tail = filter;
    }
    tail.connect(gain).connect(this.effectsGain);
    node.start(t);
  }

  playClip(def, t) {
    const buffer = this.clips.get(def.src);
    if (!buffer) return;        // still decoding, or it failed to load
    const node = this.ctx.createBufferSource();
    node.buffer = buffer;
    if (def.gain === undefined) {
      node.connect(this.effectsGain);
    } else {
      const gain = this.ctx.createGain();
      gain.gain.value = def.gain;
      node.connect(gain).connect(this.effectsGain);
    }
    node.start(t);
  }

  setEffects(on) { this.effectsOn = on; }

  setEffectsVolume(v) {
    this.effectsVolume = v;
    if (this.effectsGain) this.effectsGain.gain.value = v;
  }

  setMusic(on) {
    this.musicOn = on;
    if (on) this.startMusic(); else this.musicEl.pause();
  }

  setMusicVolume(v) { this.musicEl.volume = v; }

  // A level names its track by id, like any other sound; which file that is is
  // the manifest's business.
  setTrack(id) {
    this.trackId = id || DEFAULT_TRACK;
    this.applyTrack();
  }

  applyTrack() {
    const def = this.defs[this.trackId] || this.defs[DEFAULT_TRACK];
    const src = def && def.loop ? def.src : null;
    if (!src || src === this.musicEl.src) return;   // nothing named, or already on it
    const wasPlaying = !this.musicEl.paused;
    this.musicEl.src = src;
    this.musicEl.load();
    if (wasPlaying) this.startMusic();
  }

  startMusic() {
    if (!this.musicOn || !this.musicEl.src) return;
    if (!this.musicEl.paused) return;
    this.musicEl.play().catch(err => console.warn('bgMusic: play() rejected —', err));
  }
}

const sound = new SoundBoard('bgMusic');
const playSound = name => sound.play(name);
