// A moving ledge. Its block's digit is its way of moving: 0= and 1= run
// sideways, setting off right and left; 2= and 3= up and down, setting off up
// and down. game.js builds them after the terrain, since how far one travels
// depends on what is around it.
const PLATFORM_GUIDE = '#6fd3ff';   // the colour its guides are drawn in

const PLATFORM_DIRS = [
  { axis: 'x', sign: 1 },    // 0  right
  { axis: 'x', sign: -1 },   // 1  left
  { axis: 'y', sign: -1 },   // 2  up
  { axis: 'y', sign: 1 }     // 3  down
];

class Platform extends Entity {
  static editor = {
    label: 'Platform',
    code: 'n=',
    digit: 'direction (0 right, 1 left, 2 up, 3 down)',
    groups: ['Motion', 'Look'],
    props: {
      speed: { type: 'float', default: 0.04, label: 'Speed (over a 2.5-tile run; longer runs take longer)', group: 'Motion', short: 'Speed' }
    }
  };

  static cellAnchor = [0, 0];   // placed by its left end, on the cell's top

  // The first and last cell a platform at (r, c) may cover along `axis`: out
  // both ways until a cell that blocks (blocks(r, c), which answers true off
  // the map too). The game sizes its travel from this, and drawGuide draws it,
  // so what the editor shows is where it goes.
  static run(blocks, r, c, axis) {
    const dr = axis === 'y' ? 1 : 0, dc = 1 - dr;
    const out = step => {
      let rr = r, cc = c;
      do { rr += dr * step; cc += dc * step; } while (!blocks(rr, cc));
      return axis === 'x' ? cc - dc * step : rr - dr * step;
    };
    return [out(-1), out(1)];
  }

  // Its stretch of travel on the board and in the game's collision view, and
  // on the board and its swatch an arrow the way it sets off.
  static drawGuide(g, view) {
    const way = PLATFORM_DIRS[view.digit] || PLATFORM_DIRS[0];
    const ux = way.axis === 'x' ? way.sign : 0, uy = way.axis === 'y' ? way.sign : 0;
    if (view.mode === 'panel') {
      const s = view.size;
      this.drawArrow(g, s / 2, s / 2, ux, uy, s * 0.3, 1);
      return;
    }
    const [lo, hi] = view.run || this.run(view.blocks, view.r, view.c, way.axis);
    const px = view.px || 1;
    const along = way.axis === 'x';
    const x = along ? lo * TILE : view.c * TILE, y = along ? view.r * TILE : lo * TILE;
    const w = along ? (hi - lo + 1) * TILE : TILE, h = along ? TILE : (hi - lo + 1) * TILE;
    g.save();
    g.fillStyle = 'rgba(111,211,255,0.14)';
    g.fillRect(x, y, w, h);
    g.strokeStyle = PLATFORM_GUIDE;
    g.lineWidth = 1.5 / px;
    g.setLineDash([4 / px, 3 / px]);
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    g.setLineDash([]);
    // a bar across each end, where it turns
    g.lineWidth = 3 / px;
    g.beginPath();
    if (along) {
      g.moveTo(x + 1, y + 4); g.lineTo(x + 1, y + h - 4);
      g.moveTo(x + w - 1, y + 4); g.lineTo(x + w - 1, y + h - 4);
    } else {
      g.moveTo(x + 4, y + 1); g.lineTo(x + w - 4, y + 1);
      g.moveTo(x + 4, y + h - 1); g.lineTo(x + w - 4, y + h - 1);
    }
    g.stroke();
    g.restore();
    if (view.mode === 'board') this.drawArrow(g, (view.c + 0.5) * TILE, (view.r + 0.5) * TILE, ux, uy, TILE * 0.36, px);
  }

  // An arrow centred on (cx, cy) pointing along (ux, uy), `len` from its
  // middle to its tip: one outline — shaft and head together, corners rounded
  // — filled light, edged dark, with a soft shadow so it reads over any art.
  static drawArrow(g, cx, cy, ux, uy, len, px) {
    const shaft = len * 0.17, head = len * 0.5, neck = len * 0.12;
    g.save();
    g.translate(cx, cy);
    g.rotate(Math.atan2(uy, ux));
    g.beginPath();
    g.moveTo(-len, -shaft);
    g.lineTo(neck, -shaft);
    g.lineTo(neck, -head);
    g.lineTo(len, 0);
    g.lineTo(neck, head);
    g.lineTo(neck, shaft);
    g.lineTo(-len, shaft);
    g.closePath();
    g.lineJoin = 'round';
    g.shadowColor = 'rgba(0,0,0,0.45)';
    g.shadowBlur = 3;          // in screen pixels, whatever the zoom
    g.shadowOffsetY = 1;
    g.fillStyle = PLATFORM_GUIDE;
    g.fill();
    g.shadowColor = 'transparent';
    // a lighter top half, as if lit from above
    g.save();
    g.clip();
    g.fillStyle = 'rgba(255,255,255,0.28)';
    g.fillRect(-len, -head, len * 2, head);
    g.restore();
    g.strokeStyle = '#0b1830';
    g.lineWidth = 1.6 / px;
    g.stroke();
    g.restore();
  }


  constructor(name, baseX, baseY, wTiles, axis, amplitude, speed) {
    super(name, baseX, baseY);
    this.baseX = baseX;
    this.baseY = baseY;
    this.prevX = baseX;
    this.prevY = baseY;
    this.w = wTiles * TILE;
    this.h = atlas.hit(this.obj).h;
    this.axis = axis;
    this.amplitude = amplitude;
    this.speed = speed;
    this.phase = Math.random() * Math.PI * 2;
    this.t0 = platformTimer;   // so phase is measured from this platform's own birth
  }

  update() {
    this.prevX = this.x;
    this.prevY = this.y;
    const t = (platformTimer - this.t0) * this.speed + this.phase;
    if (this.axis === 'x') this.x = this.baseX + Math.sin(t) * this.amplitude;
    else this.y = this.baseY + Math.sin(t) * this.amplitude;
  }

  // Solid only from the top — she can stand on and ride it, but it doesn't
  // block her from the sides or below. It moves her only as far as she fits:
  // carried into a wall she stays against it and the platform slides on
  // under her, and lifted into a ceiling she stops below it — the platform
  // never pushes her into the terrain.
  carry() {
    const left = this.x, right = this.x + this.w, top = this.y;
    if (warm.vy >= 0 &&
        warm.x + R > left && warm.x - R < right &&
        warm.y + R >= top - 2 && warm.y + R <= top + 16) {
      const dx = this.x - this.prevX;
      if (dx && wormFitsAt(warm.x + dx, warm.y)) warm.x += dx;
      const y = top - R;
      if (y >= warm.y || wormFitsAt(warm.x, y)) {
        warm.y = y;
        warm.vy = 0;
        warm.grounded = true;
      }
    }
  }

  draw() { atlas.draw(this.obj, this.x, this.y, atlas.frame(this.obj), this.w); }

  mapCell() {
    const code = codesOf(atlas.object(this.name))[0] || 'n=0';
    return { ch: code[1], data: this.axis === 'x' ? 0 : 3, x: this.baseX, y: this.baseY };
  }

  // stood on rather than touched, so it reads like terrain
  debugShape() { return { stroke: '#7dff9b', fill: 'rgba(120,255,150,0.45)', box: true }; }
}
