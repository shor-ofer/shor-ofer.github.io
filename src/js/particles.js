// ---------- Particle systems ----------
// Sparks, dust, drifting motes: a cloud of small dots or tiny sprites, each
// thrown out at a speed and angle, pulled by gravity, slowed by drag, and
// shrinking and changing colour over its life. An object of this class is a
// recipe for one, and it is used two ways:
//
//   placed in a level, it streams from its spot, `rate` particles a frame —
//   a fountain, fireflies, smoke from a chimney — or, with no rate, bursts
//   `count` there every `interval` frames;
//   named by another object's property (a coin's takeParticles, a rock's
//   breakParticles), it bursts once, `count` particles, where that thing went.
//
// Its sprite is optional: without one each particle is a dot of its colour,
// with one each is that sprite's current frame, sized and faded the same way.
const PARTICLE_CAP = 300;            // live particles one system may have
const GUIDE_SPAN = 3;                // blocks across its picture may take on the editor's board

class ParticleSystem extends Entity {
  static bucket = 'emitters';
  static editor = {
    label: 'Particle system',
    code: '0Z',
    groups: ['Emit', 'Motion', 'Look'],
    props: {
      count: { type: 'int', default: 16, label: 'Particles in a burst', group: 'Emit', short: 'Burst', unit: 'particles' },
      rate: { type: 'float', default: 0, label: 'Particles a frame, placed in a level (0 = bursts instead)', group: 'Emit', short: 'Stream', unit: '/ frame' },
      interval: { type: 'int', default: 60, label: 'Frames between bursts, placed with no rate (0 = never)', group: 'Emit', short: 'Every', unit: 'frames' },
      speed: { type: 'float', default: 2, label: 'Speed, px a frame', group: 'Motion', short: 'Speed', unit: 'px / frame' },
      speedJitter: { type: 'float', default: 0.5, label: 'Speed varies by, as a share', group: 'Motion', short: 'Variation', join: true, percent: true },
      angle: { type: 'int', default: -90, label: 'Direction, degrees (0 right, -90 up)', group: 'Motion', short: 'Direction', unit: '°' },
      spread: { type: 'int', default: 360, label: 'Spread round it, degrees', group: 'Motion', short: 'Spread', join: true, unit: '°' },
      gravity: { type: 'float', default: 0.1, label: 'Gravity (negative rises)', group: 'Motion', short: 'Gravity' },
      drag: { type: 'float', default: 0.97, label: 'Speed kept each frame (1 = no drag)', group: 'Motion', short: 'Drag', join: true },
      life: { type: 'int', default: 30, label: 'Life, frames', group: 'Look', short: 'Life', unit: 'frames' },
      lifeJitter: { type: 'float', default: 0.3, label: 'Life varies by, as a share', group: 'Look', short: 'Variation', join: true, percent: true },
      radius: { type: 'float', default: 0, label: 'Starts anywhere within, px', group: 'Emit', short: 'Start within', unit: 'px' },
      sizeStart: { type: 'float', default: 4, label: 'Size at birth, px', group: 'Look', short: 'Size start', unit: 'px' },
      sizeEnd: { type: 'float', default: 0, label: 'Size at death, px', group: 'Look', short: 'End', join: true, unit: 'px' },
      colorStart: { type: 'color', default: '#ffffff', label: 'Colour at birth', group: 'Look', short: 'Colour start' },
      colorEnd: { type: 'color', default: '#ffffff', label: 'Colour at death', group: 'Look', short: 'End', join: true },
      shape: { type: 'choice', options: ['circle', 'square', 'spark'], default: 'circle', label: 'Shape, without a sprite', group: 'Look', short: 'Shape' },
      fade: { type: 'bool', default: true, label: 'Fades out', group: 'Look', short: 'Fades out' },
      glow: { type: 'bool', default: false, label: 'Glows (adds light)', group: 'Look', short: 'Glows', join: true }
    }
  };

  // It may have no art of its own; the level editor marks where it stands.
  static spriteOptional = true;
  static marker = { colour: '#ffb347', letter: '✶' };   // so the editor puts no stand-in under its symbol

  // Its symbol where a level is built: a snapshot of it in the middle of a
  // run — a burst some way through its life, a stream once it has filled
  // out — never drawn larger than the game would. On the board it may spread
  // over the 3x3 blocks round its cell (GUIDE_SPAN), over whatever is
  // there; a palette swatch fits it into the swatch. Each run is seeded,
  // so the picture holds still, and kept until the object's props change.
  static drawGuide(g, view) {
    if (view.mode === 'debug') return;
    const shot = this.snapshot(view.name);
    const panel = view.mode === 'panel';
    const s = panel ? view.size : TILE;
    const unit = panel ? view.size / TILE : 1;                 // game units to what is drawn on
    const cx = panel ? s / 2 : (view.c + 0.5) * TILE, cy = panel ? s / 2 : (view.r + 0.5) * TILE;
    g.save();
    const span = panel ? s : TILE * GUIDE_SPAN;                  // the square it may fill
    g.beginPath();
    g.rect(cx - span / 2, cy - span / 2, span, span);
    g.clip();
    const k = Math.min(1, (panel ? TILE * 0.46 : TILE * GUIDE_SPAN * 0.48) / shot.reach) * unit;
    g.translate(cx, cy);
    g.scale(k, k);
    g.translate(-shot.cloud.x, -shot.cloud.y);
    const art = shot.art;
    const least = 2 / (k * (panel ? 1 : view.px || 1));          // 2 screen pixels
    const paint = () => shot.cloud.paint(g, art && { size: art.size, draw: () => atlas.draw(art.name, 0, 0, 0) }, least);
    // a sprite is drawn by the atlas, onto whatever the page's ctx is
    if (art && typeof withCtx === 'function') withCtx(g, paint); else shot.cloud.paint(g, null, least);
    g.restore();
  }

  static snapshot(name) {
    const props = this.propsFor(name);
    const sprite = refName(props.sprite);
    const d = sprite && atlas.def(sprite);
    const art = d && d.frame ? { name: sprite, size: Math.max(...atlas.size(sprite)) } : null;
    const shot = this.snapshotOf(props);
    return { ...shot, art };
  }

  // The moment of a run that shows it best, from its props alone (so the
  // asset pack creator can draw one too): the run is played out, seeded so it
  // is the same every time, and each frame scored by how much of the picture
  // its particles cover — spread and brightness together, not how many there
  // are — so a burst is caught as it opens rather than as one bright dot or
  // a last few sparks, and a stream once it has filled its path. Kept until
  // the props change.
  static snapshotOf(props) {
    const key = JSON.stringify(props);
    const cache = this.shotCache || (this.shotCache = new Map());
    if (cache.has(key)) return cache.get(key);
    // a small seeded generator (mulberry32), the same pictures every time
    let seed = 0x9e3779b9;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const cloud = new ParticleCloud(props, 0, 0, rand);
    const life = Math.max(1, Math.round(props.life * (1 + (props.lifeJitter || 0))));
    const streams = props.rate > 0;
    const frames = [];                           // every frame worth judging, as copies
    if (streams) {
      // judged once what it throws has had a life to fill its path
      for (let t = 0; t < life * 2.5 && t < 900; t++) {
        cloud.stream(); cloud.step();
        if (t >= life) frames.push(cloud.parts.map(q => ({ ...q })));
      }
    } else {
      cloud.emit(props.count);
      for (let t = 0; t < life && cloud.parts.length; t++) {
        frames.push(cloud.parts.map(q => ({ ...q })));
        cloud.step();
      }
    }
    // the picture is the run's whole reach, so frames are judged on one scale
    let reach = 4;
    for (const f of frames) for (const q of f) reach = Math.max(reach, Math.abs(q.x), Math.abs(q.y));
    const G = 14, cell = (reach * 2) / G;
    const scoreOf = parts => {
      const cov = new Float32Array(G * G);
      for (const q of parts) {
        const t = q.age / q.life;
        const size = Math.max(0, props.sizeStart + (props.sizeEnd - props.sizeStart) * t);
        const alpha = props.fade ? 1 - t : 1;
        if (size <= 0 || alpha <= 0) continue;
        // a particle lights the cells its size covers
        const r = Math.max(0, Math.floor(size / 2 / cell));
        const cx = Math.floor((q.x + reach) / cell), cy = Math.floor((q.y + reach) / cell);
        for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
          if (x >= 0 && y >= 0 && x < G && y < G) cov[y * G + x] += alpha;
        }
      }
      let sc = 0;
      for (const c of cov) sc += Math.min(1, c);
      return sc;
    };
    let best = frames.length ? frames[0] : [], bestScore = -1;
    for (const f of frames) {
      const sc = scoreOf(f);
      if (sc > bestScore) { bestScore = sc; best = f; }
    }
    cloud.parts = best;
    // fitted to the frame chosen, not the whole run, so it fills its picture
    let fit = 4;
    for (const q of best) fit = Math.max(fit, Math.abs(q.x), Math.abs(q.y));
    fit += Math.max(props.sizeStart, props.sizeEnd) / 2;
    const shot = { key, cloud, reach: fit };
    cache.set(key, shot);
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return shot;
  }

  // A few to start a pack with, which the asset pack creator adds to a pack
  // that has none. Codes follow in this order: 0Z0, 0Z1, ...
  static presets = {
    sparkle: { count: 14, speed: 2.2, gravity: 0.04, drag: 0.93, life: 26, sizeStart: 3.5, sizeEnd: 0, colorStart: '#fff6a8', colorEnd: '#ffb300', glow: true },
    gemSparkle: { count: 22, speed: 2.8, gravity: 0, drag: 0.92, life: 34, sizeStart: 3, sizeEnd: 0, colorStart: '#e8fbff', colorEnd: '#b06aff', shape: 'spark', glow: true },
    dust: { count: 12, speed: 2.4, angle: -90, spread: 150, gravity: 0.22, drag: 0.96, life: 30, sizeStart: 4, sizeEnd: 1.5, colorStart: '#b3a28c', colorEnd: '#5e5246', shape: 'square' },
    fireflies: { rate: 0.04, speed: 0.35, gravity: -0.004, drag: 0.995, life: 140, radius: 40, sizeStart: 2.5, sizeEnd: 0, colorStart: '#fffbb0', colorEnd: '#9cff5a', glow: true },
    fountain: { count: 30, rate: 0.7, speed: 4.2, speedJitter: 0.2, angle: -90, spread: 22, gravity: 0.2, drag: 0.99, life: 42, sizeStart: 3, sizeEnd: 1, colorStart: '#d8f6ff', colorEnd: '#3a86d6', fade: true }
  };

  constructor(name, x, y) {
    super(name, x, y);
    this.cloud = new ParticleCloud(this.props, x, y);
    this.streams = true;        // placed in a level; a burst never does
  }

  // One burst of the system an object property names (object::sparkle) at
  // x, y, drawn with the layer it came from. Nothing if it names none.
  static burst(ref, x, y, layer = LAYER_MAIN) {
    const name = refName(ref);
    if (!name || classOf(name) !== ParticleSystem) return;
    const s = new ParticleSystem(name, x, y);
    s.streams = false;
    s.layer = layer;
    s.cloud.emit(s.props.count);
    bursts.push(s);
  }

  // a burst is done once its last particle is
  get done() { return !this.streams && !this.cloud.parts.length; }

  update() {
    // a placed one only adds while it is anywhere near the screen; what it
    // already threw out keeps moving either way
    if (this.streams && this.nearView()) this.cloud.run();
    this.cloud.step();
  }

  nearView() {
    const m = VIEW_W;
    return this.x > cam.x - m && this.x < cam.x + VIEW_W + m && this.y > cam.y - m && this.y < cam.y + VIEW_H + m;
  }

  draw() {
    const n = this.cloud.parts.length;
    if (!n) return;
    const obj = this.obj && atlas.def(this.obj).frame ? this.obj : null;
    const frame = obj ? atlas.frame(obj) : 0;
    this.cloud.paint(ctx, obj && { size: Math.max(...atlas.size(obj)), draw: g => atlas.draw(obj, 0, 0, frame) });
    if (perf.on) perfCount('particles', n);
  }

  reset() { this.cloud.clear(); }

  mapCell() { return this.streams ? super.mapCell() : null; }

  debugShape() { return null; }
}

// The particles themselves: thrown out, moved and drawn by an object's props.
// Kept apart from the class so the asset pack creator can run one for its
// preview, with no level round it.
class ParticleCloud {
  // `rand` is where its randomness comes from: Math.random in play, a seeded
  // one for a snapshot that must come out the same every time it is drawn.
  constructor(props, x, y, rand = Math.random) {
    this.rand = rand;
    this.props = props;
    this.x = x;
    this.y = y;
    this.parts = [];
    this.owed = 0;              // the part of a particle `rate` has built up
    this.wait = 0;              // frames to the next burst, with no rate
    this.rgbStart = particleRgb(props.colorStart);
    this.rgbEnd = particleRgb(props.colorEnd);
  }

  clear() { this.parts.length = 0; this.owed = 0; this.wait = 0; }

  emit(n) {
    const p = this.props;
    const dir = p.angle * Math.PI / 180, spread = p.spread * Math.PI / 180;
    for (let i = 0; i < n && this.parts.length < PARTICLE_CAP; i++) {
      const a = dir + (this.rand() - 0.5) * spread;
      const v = p.speed * (1 + (this.rand() * 2 - 1) * p.speedJitter);
      const r = p.radius * Math.sqrt(this.rand()), ra = this.rand() * Math.PI * 2;
      const life = Math.max(1, Math.round(p.life * (1 + (this.rand() * 2 - 1) * p.lifeJitter)));
      this.parts.push({ x: this.x + Math.cos(ra) * r, y: this.y + Math.sin(ra) * r,
                        vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life });
    }
  }

  // What a placed one throws out this frame: its share of `rate`, or with no
  // rate a burst of `count` every `interval` frames, the first at once.
  run() {
    const p = this.props;
    if (p.rate > 0) { this.stream(); return; }
    if (!(p.interval > 0)) return;
    if (this.wait-- > 0) return;
    this.wait = p.interval - 1;
    this.emit(p.count);
  }

  stream() {
    if (!(this.props.rate > 0)) return;
    this.owed += this.props.rate;
    const n = Math.floor(this.owed);
    this.owed -= n;
    this.emit(n);
  }

  step() {
    const p = this.props, list = this.parts;
    let keep = 0;
    for (let i = 0; i < list.length; i++) {
      const q = list[i];
      if (++q.age >= q.life) continue;
      q.vx *= p.drag;
      q.vy = q.vy * p.drag + p.gravity;
      q.x += q.vx;
      q.y += q.vy;
      list[keep++] = q;
    }
    list.length = keep;
  }

  // On g, in its units. `art`, when the system wears a sprite, is
  // { size: its longer side, draw(g): the frame centred on 0, 0 }; no
  // particle is drawn smaller than `minSize`, for a picture shrunk to fit.
  paint(g, art, minSize = 0) {
    const p = this.props, [r0, g0, b0] = this.rgbStart, [r1, g1, b1] = this.rgbEnd;
    g.save();
    if (p.glow) g.globalCompositeOperation = 'lighter';
    for (const q of this.parts) {
      const t = q.age / q.life;
      let size = p.sizeStart + (p.sizeEnd - p.sizeStart) * t;
      if (size <= 0) continue;
      size = Math.max(size, minSize);
      g.globalAlpha = p.fade ? 1 - t : 1;
      if (art) {
        const k = size / art.size;
        g.save();
        g.translate(q.x, q.y);
        g.scale(k, k);
        art.draw(g);
        g.restore();
        continue;
      }
      g.fillStyle = `rgb(${Math.round(r0 + (r1 - r0) * t)},${Math.round(g0 + (g1 - g0) * t)},${Math.round(b0 + (b1 - b0) * t)})`;
      if (p.shape === 'square') g.fillRect(q.x - size / 2, q.y - size / 2, size, size);
      else if (p.shape === 'spark') {
        // a streak along the way it is going, as long as it is fast
        g.strokeStyle = g.fillStyle;
        g.lineWidth = Math.max(0.5, size / 2);
        g.beginPath();
        g.moveTo(q.x - q.vx * 2, q.y - q.vy * 2);
        g.lineTo(q.x + q.vx, q.y + q.vy);
        g.stroke();
      } else {
        g.beginPath();
        g.arc(q.x, q.y, size / 2, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.restore();
  }
}

function particleRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  return [n >> 16, (n >> 8) & 255, n & 255];
}
