// ---------- Tile map ----------
// Empty until loadCustomLevel() parses one; it replaces all of this wholesale.
const TILE = 32;
let cols = 0;
let rows = 0;
let grid = [];
let backGrid = null;    // optional decorative layer drawn behind the terrain
let frontGrid = null;   // optional decorative layer drawn over everything
// Glyph/data/tint for each drawn layer, straight off the parsed 3x3 blocks.
let gridMeta = null;
let backMeta = null;
let frontMeta = null;

// The sheet a level's terrain is drawn from, and the five strings describing
// it, both live in Tileset (js/tileset.js). Replaced wholesale on every load.
let tileset = new Tileset();

const asDigit = ch => (ch >= '0' && ch <= '9') ? +ch : 0;

// A ramp cell is '/', and its data digit picks which corner the solid right
// angle sits in:  0 lower-right, 1 lower-left, 2 upper-right, 3 upper-left.
// 0 and 1 are floors you walk along; 2 and 3 are the same wedges as ceilings.
// A floor ramp's collision height changes gradually across its tile, so
// chaining several makes one continuous incline. For a slope that is only
// scenery, put '/' in the back layer instead.
const RAMP = '/';
const rampIsFloor = dir => dir < 2;

// Is the wedge solid at this point within its cell? localX/localY are both
// measured from the cell's top-left corner, 0..TILE.
function rampSolid(dir, localX, localY) {
  switch (dir) {
    case 0: return localX >= TILE - localY;
    case 1: return localX <= localY;
    case 2: return localY <= localX;
    default: return localY <= TILE - localX;
  }
}

// The y of the wedge's diagonal face at this x within the cell — the walking
// surface for a floor ramp, the underside for a ceiling one.
function rampFaceY(dir, row, localX) {
  return (dir === 0 || dir === 3) ? (row + 1) * TILE - localX : row * TILE + localX;
}

// locked doors: solid gates that only open once she's carrying a key. A door
// is an object, not a tile — the grid never holds one. It stamps its own cell
// solid in the collision grid and clears it again when opened.
let lockedDoorSpots = [];
const doorAt = new Map();    // 'row:col' -> door

// What each cell collides as, taken from its tileset row.
let collideGrid = [];

function applyDoorCollision() {
  doorAt.clear();
  for (const d of lockedDoorSpots) {
    doorAt.set(d.row + ':' + d.col, d);
    if (d.row < collideGrid.length && d.col < collideGrid[d.row].length) {
      collideGrid[d.row][d.col] = d.open ? HIT_NONE : HIT_SOLID;
    }
  }
}

// Out of bounds keeps its own rules: the sides and top are walls, the bottom
// is open so falling off the map triggers a respawn instead of landing.
function hitAt(col, row) {
  if (row >= rows) return HIT_NONE;
  if (row < 0 || col < 0 || col >= cols) return HIT_SOLID;
  return collideGrid[row][col];
}

function solidAt(col, row) {
  return hitAt(col, row) === HIT_SOLID;
}

// Whether her head, a circle of R about (x, y), clears every solid tile and
// the solid top of every half tile — with a pixel to spare, so resting
// against a wall counts as fitting. What a platform checks before it moves her.
function wormFitsAt(x, y) {
  const c0 = Math.floor((x - R) / TILE), c1 = Math.floor((x + R) / TILE);
  const r0 = Math.floor((y - R) / TILE), r1 = Math.floor((y + R) / TILE);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const hit = hitAt(c, r);
      if (hit !== HIT_SOLID && hit !== HIT_HALF) continue;
      const bottom = hit === HIT_HALF ? r * TILE + TILE / 2 : (r + 1) * TILE;
      const nx = Math.max(c * TILE, Math.min(x, (c + 1) * TILE));
      const ny = Math.max(r * TILE, Math.min(y, bottom));
      if (Math.hypot(x - nx, y - ny) < R - 1) return false;
    }
  }
  return true;
}

// topY/botY are the moving body's real vertical extent this frame; edgeX is
// the exact x of the edge being tested, so a wedge is sampled against its
// diagonal at the right x rather than just "somewhere in this column".
function blocksHorizontally(col, row, topY, botY, edgeX) {
  const hit = hitAt(col, row);
  if (hit === HIT_SOLID) return true;
  if (hit === HIT_HALF) return topY < row * TILE + TILE / 2;
  if (!isRampHit(hit)) return false;
  const dir = +hit;
  const rowTop = row * TILE;
  // the body's deepest point into the wedge: its bottom for a floor ramp,
  // its top for a ceiling one
  const probeY = rampIsFloor(dir)
    ? Math.min(botY, rowTop + TILE)
    : Math.max(topY, rowTop);
  if (probeY <= rowTop || probeY >= rowTop + TILE) return false; // no real overlap
  return rampSolid(dir, edgeX - col * TILE, probeY - rowTop);
}

// Keys and doors carry an id 1..9. Id 0 — no digit at all — is the wildcard:
// a master key opens any door, and an unmarked door accepts any key. The
// colour that makes the pairing readable is KEY_COLORS, over in atlas.js
// beside the mask it fills.
let keysHeld = [];           // ids of the keys she is carrying

function keyOpensDoor(keyId, doorId) {
  return keyId === 0 || doorId === 0 || keyId === doorId;
}

// open the door permanently (for the rest of this run), and report success
// so the caller lets her through instead of blocking. Otherwise no-op.
function tryOpenDoor(col, row) {
  const door = doorAt.get(row + ':' + col);
  if (!door || door.open) return false;
  const slot = keysHeld.findIndex(k => keyOpensDoor(k, door.id));
  if (slot < 0) return false;
  keysHeld.splice(slot, 1);
  door.open = true;
  collideGrid[row][col] = HIT_NONE;
  updateHud();
  playSound(door.props.openSound);
  return true;
}

// For a given world x, find the sloped ground height if x sits over a floor
// ramp. If the column has more than one (e.g. a staircase reusing a column),
// refY picks whichever is actually closest to the caller's current height, so
// a distant, unrelated ramp in the same column can't be mistaken for the one
// under their feet. Returns null if there's no floor ramp there at all.
function rampSurfaceY(x, refY) {
  const col = Math.floor(x / TILE);
  if (col < 0 || col >= cols) return null;
  const localX = x - col * TILE;      // 0 (left edge) .. TILE (right edge)
  let best = null, bestDist = Infinity;
  for (let r = 0; r < rows; r++) {
    const hit = collideGrid[r][col];
    if (!isRampHit(hit) || !rampIsFloor(+hit)) continue;
    const y = rampFaceY(+hit, r, localX);
    if (refY === undefined) return y; // no reference given — first match is fine
    const d = Math.abs(y - refY);
    if (d < bestDist) { bestDist = d; best = y; }
  }
  return best;
}

// The ramp surface actually underfoot for a body whose feet are at feetY —
// or null if the nearest ramp in that column is out of reach. The bounds
// matter in both directions: without an upper one a body walking the ground
// beneath a slope gets yanked up onto it, and without a lower one it gets
// pulled down through the air onto a slope far below.
const RAMP_REACH = TILE * 0.6;
function rampUnderfoot(x, feetY) {
  const y = rampSurfaceY(x, feetY);
  if (y === null) return null;
  return Math.abs(feetY - y) <= RAMP_REACH ? y : null;
}

// The mirror of rampUnderfoot for the ceiling wedges: the underside of the
// nearest one overhead, but only while the head has actually risen into it.
function rampOverhead(x, headY) {
  const col = Math.floor(x / TILE);
  if (col < 0 || col >= cols) return null;
  const localX = x - col * TILE;
  let best = null, bestDist = Infinity;
  for (let r = 0; r < rows; r++) {
    const hit = collideGrid[r][col];
    if (!isRampHit(hit) || rampIsFloor(+hit)) continue;
    const y = rampFaceY(+hit, r, localX);
    const d = y - headY;
    if (d >= 0 && d <= RAMP_REACH && d < bestDist) { bestDist = d; best = y; }
  }
  return best;
}

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const stageEl = document.getElementById('stage');

// The art is drawn at twice a game unit — a 32-unit tile is 64 pixels on the
// sheet — and the game shows it at that size, a pixel of art to a pixel of
// screen, so it is as sharp as it was drawn. A bigger window sees more of the
// level rather than bigger tiles. Only a screen too small to show
// MIN_LONG_TILES along its long side draws smaller, so a phone still sees
// enough to play.
const ART_SCALE = 2;              // screen pixels (CSS) per game unit
const MIN_LONG_TILES = 12;
let VIEW_W, VIEW_H;
let PIXEL_X = 1, PIXEL_Y = 1;
let mapWidthPx = cols * TILE;
let mapHeightPx = rows * TILE;

function layoutStage() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const scale = Math.min(ART_SCALE, Math.max(vw, vh) / (MIN_LONG_TILES * TILE));
  VIEW_W = vw / scale;
  VIEW_H = vh / scale;
  stageEl.style.width = vw + 'px';
  stageEl.style.height = vh + 'px';

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(vw * dpr));
  canvas.height = Math.max(1, Math.round(vh * dpr));
  PIXEL_X = canvas.width / VIEW_W;
  PIXEL_Y = canvas.height / VIEW_H;
}

layoutStage();
window.addEventListener('resize', layoutStage);
window.addEventListener('orientationchange', layoutStage);

// ---------- Camera ----------
const cam = { x: 0, y: 0 };
const camScroll = { active: false, fromX: 0, fromY: 0, toX: 0, toY: 0, t: 0, duration: 45 };

// Where the free camera would sit for a worm at (x, y). A scroll has to land
// exactly here, or the follow camera snaps the moment it takes back over.
function camTargetFor(x, y) {
  const cx = mapWidthPx <= VIEW_W
    ? 0   // level narrower than the screen — no horizontal scrolling needed
    : Math.max(0, Math.min(mapWidthPx - VIEW_W, x - VIEW_W / 2));
  const cy = mapHeightPx <= VIEW_H
    ? 0
    : Math.max(0, Math.min(mapHeightPx - VIEW_H, y - VIEW_H / 2));
  return { x: cx, y: cy };
}

function updateCamera() {
  if (camScroll.active) {
    camScroll.t++;
    const frac = Math.min(1, camScroll.t / camScroll.duration);
    const eased = frac < 0.5 ? 2 * frac * frac : -1 + (4 - 2 * frac) * frac; // ease-in-out
    cam.x = camScroll.fromX + (camScroll.toX - camScroll.fromX) * eased;
    cam.y = camScroll.fromY + (camScroll.toY - camScroll.fromY) * eased;
    if (frac >= 1) camScroll.active = false;
    return;
  }
  const t = camTargetFor(warm.x, warm.y);
  cam.x = t.x;
  cam.y = t.y;
}

// ---------- Warm (the worm) ----------
let START = { x: 3 * TILE + TILE / 2, y: 2 * TILE };
// Her look and her moves are the pack's Worm object's (js/worm.js), taken
// again whenever a level's objects are: useWorm() below. These are what she
// has until then.
let WORM = { sprite: 'worm', body: 'body', tail: 'tail', head: 'headRight', headLeft: 'headLeft' };
let R = 11;                 // head radius: her sprite's collision, what hits the tiles
const GRAVITY = 0.55;
const MAX_FALL = 12;
let SPEED = 3.0;
let JUMP_V = -10.5;

const warm = { x: START.x, y: START.y, vx: 0, vy: 0, grounded: false, face: 1 };

// ---------- Checkpoints ----------
// Touching one moves the respawn point to it, so losing a life afterward
// doesn't send her back to START. The most recently touched one wins.
let checkpoints = [];   // { x, y, r, activated } — '!' glyphs
let respawnPoint = { x: START.x, y: START.y };

// ---------- Finish tile + level campaign ----------
let finishPoints = [];        // one {x,y,r,id} per 'F' in the level text
let campaignActive = false;   // true while playing through BUILTIN_LEVELS in order
let currentLevelIndex = 0;
let returnStack = [];         // levels left by a round-trip flag, newest last
let flagBlocked = null;       // the flag she came back out of, inert until she steps clear
let currentPack = null;       // the pack record of the level in play, to notice crossings
let levelTransition = null;   // { phase: 'out'|'welcome'|'swap'|'in', t, welcome, action, ready }
let levelDeathOccurred = false; // reset each time a level starts; set true by any loseLife() this level

// ---------- Stars (per campaign level) ----------
// Sized to the level chain once it loads, so a saved array from a shorter
// or longer campaign can't leave holes that poison the stars total.
let levelStars = [];
try {
  const saved = localStorage.getItem('warmWormLevelStars');
  if (saved) levelStars = JSON.parse(saved);
} catch (e) { /* ignore */ }

function fitLevelStars(count) {
  for (let i = 0; i < count; i++) levelStars[i] = levelStars[i] || 0;
  levelStars.length = count;
}

function saveLevelStars() {
  try { localStorage.setItem('warmWormLevelStars', JSON.stringify(levelStars)); } catch (e) { /* ignore */ }
}

function computeStarsForCurrentLevel() {
  let stars = 1; // awarded just for reaching the finish
  const total = coins.length;
  const collected = coins.filter(c => c.collected).length;
  if (total > 0 && collected === total) stars++;
  if (!levelDeathOccurred) stars++;
  return stars;
}

// ---------- Achievements ----------
const ACHIEVEMENT_LIST = [
  { key: 'firstSteps', title: 'First Steps', desc: 'Complete Level 1' },
  { key: 'coinCollector', title: 'Coin Collector', desc: 'Collect 50 coins total' },
  { key: 'gemHunter', title: 'Gem Hunter', desc: 'Collect 10 gems total' },
  { key: 'beetleSquasher', title: 'Beetle Squasher', desc: 'Stomp 20 enemies total' },
  { key: 'untouchable', title: 'Untouchable', desc: 'Finish a level without losing a life' },
  { key: 'campaignComplete', title: 'Campaign Complete', desc: 'Win the game' },
];

let achievements = {};
let stats = { coins: 0, gems: 0, stomps: 0 };
try {
  const savedA = localStorage.getItem('warmWormAchievements');
  const savedS = localStorage.getItem('warmWormStats');
  if (savedA) achievements = JSON.parse(savedA);
  if (savedS) stats = JSON.parse(savedS);
} catch (e) { /* ignore */ }

function saveAchievements() {
  try { localStorage.setItem('warmWormAchievements', JSON.stringify(achievements)); } catch (e) { /* ignore */ }
}
function saveStats() {
  try { localStorage.setItem('warmWormStats', JSON.stringify(stats)); } catch (e) { /* ignore */ }
}

function unlockAchievement(key) {
  if (achievements[key]) return;
  achievements[key] = true;
  saveAchievements();
  const def = ACHIEVEMENT_LIST.find(a => a.key === key);
  if (def) showAchievementToast(def.title);
}

function checkStatAchievements() {
  if (stats.coins >= 50) unlockAchievement('coinCollector');
  if (stats.gems >= 10) unlockAchievement('gemHunter');
  if (stats.stomps >= 20) unlockAchievement('beetleSquasher');
}

// body: longer now. Each part's distance from the part before it is capped
// at its own radius, but parts have NO collision with each other — they can
// freely overlap/pass through one another when the worm curls up.
let SEGMENT_COUNT = 14;
let TAIL_SCALE = 0.32;      // the tail's radius, as a share of the head's
const taper = () => Array.from({ length: SEGMENT_COUNT }, (_, i) => {
  const t = i / Math.max(1, SEGMENT_COUNT - 1);
  return R * (1 - t * (1 - TAIL_SCALE)); // tapers from full head radius down to the tail
});
let RADII = taper();
let segments = RADII.map(r => ({ x: START.x, y: START.y, vy: 0, r }));

// Takes her settings from the objects in use. A change of size or length
// rebuilds her body where her head is.
function useWorm() {
  const w = Worm.current();
  WORM = w;
  SPEED = +w.speed || 3;
  JUMP_V = -(+w.jump || 10.5);
  const count = Math.max(2, Math.min(40, Math.round(+w.segments) || 14));
  const tail = Math.max(0.05, Math.min(2, Number.isFinite(+w.tailScale) ? +w.tailScale : 0.32));
  if (w.r === R && count === SEGMENT_COUNT && tail === TAIL_SCALE) return;
  R = w.r;
  SEGMENT_COUNT = count;
  TAIL_SCALE = tail;
  RADII = taper();
  segments = RADII.map(r => ({ x: warm.x, y: warm.y, vy: 0, r }));
}

let leftPressed = false, rightPressed = false, jumpPressed = false;
let jumpPressedPrev = false;
let jumpsUsed = 0;
const MAX_JUMPS = 2;
let touchingWall = 0; // -1 = left wall, 0 = none, 1 = right wall (only meaningful while airborne)
const WALL_JUMP_PUSH = 4;
let duckPressed = false;
let isDucking = false;

// Puts her body back together, whole and still, at a given spot.
function placeWormAt(x, y) {
  warm.x = x; warm.y = y; warm.vx = 0; warm.vy = 0;
  segments = RADII.map(r => ({ x, y, vy: 0, r }));
  teleportAnim = null;
  jumpsUsed = 0;
  touchingWall = 0;
}

// only resets her position/body — does NOT touch score or lives.
// Respawns at the last checkpoint reached, or START if none yet.
function resetPosition() {
  placeWormAt(respawnPoint.x, respawnPoint.y);
  hasShield = false;
}

// ---------- Death animation ----------
// On death, her body's segments become independent debris that pop apart
// and tumble under gravity for a moment before whatever happens next
// (respawn or game over) actually takes effect.
const DEATH_ANIM_DURATION = 55;
let deathAnim = null;

function startDeathAnimation(onDone) {
  const pieces = [segments[0], ...segments.slice(1)].map((seg, i) => ({
    x: seg.x, y: seg.y, r: seg.r,
    vx: (Math.random() - 0.5) * 7,
    vy: -(Math.random() * 3 + 1.5) - i * 0.15,
    rot: 0,
    rotSpeed: (Math.random() - 0.5) * 0.3,
    shade: bodyShade(i / segments.length)
  }));
  deathAnim = { pieces, t: 0, onDone };
}

function updateDeathAnimation() {
  const anim = deathAnim;
  anim.t++;
  for (const p of anim.pieces) {
    p.vy += GRAVITY * 0.7;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.rotSpeed;
  }
  if (anim.t >= DEATH_ANIM_DURATION) {
    const done = anim.onDone;
    deathAnim = null;
    done();
  }
}

function drawDeathAnimation() {
  const anim = deathAnim;
  const alpha = Math.max(0, 1 - anim.t / DEATH_ANIM_DURATION);
  ctx.save();
  ctx.globalAlpha = alpha;
  for (const p of anim.pieces) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.scale(p.r / R, p.r / R);
    atlas.draw(WORM.sprite, 0, 0, p.shade);
    ctx.restore();
  }
  ctx.restore();
}

// ---------- Score, lives, game state, and generative sound ----------
let score = 0;
let lives = 3;
let hasShield = false;
let shieldWorn = null;     // the worn sprite of the shield she holds, drawn over her head
let gameState = 'start'; // 'start' | 'playing' | 'gameover'

const scoreEl = document.getElementById('score');
const livesEl = document.getElementById('lives');
const shieldBadge = document.getElementById('shieldBadge');
const keyBadge = document.getElementById('keyBadge');
const startScreen = document.getElementById('startScreen');
const gameOverScreen = document.getElementById('gameOverScreen');
const finalScoreLine = document.getElementById('finalScoreLine');
const bestScoreLine = document.getElementById('bestScoreLine');
const winScreen = document.getElementById('winScreen');
const winScoreLine = document.getElementById('winScoreLine');
const winBestLine = document.getElementById('winBestLine');
const hiscoreLineWin = document.getElementById('hiscoreLineWin');
const transitionOverlay = document.getElementById('transitionOverlay');
const transitionWelcome = document.getElementById('transitionWelcome');
const transitionName = document.getElementById('transitionName');
const levelTitle = document.getElementById('levelTitle');
const levelTitleWelcome = document.getElementById('levelTitleWelcome');
const levelTitleName = document.getElementById('levelTitleName');
const achievementToast = document.getElementById('achievementToast');
const signMessage = document.getElementById('signMessage');
let toastTimer = null;
let signTimer = null;

// A signpost's words, held long enough to read and then gone.
const SIGN_MESSAGE_MS = 5000;
function showSignMessage(text) {
  if (!text) return;
  signMessage.textContent = text;
  signMessage.classList.remove('hidden');
  signMessage.style.animation = 'none';
  void signMessage.offsetWidth;
  signMessage.style.animation = '';
  if (signTimer) clearTimeout(signTimer);
  signTimer = setTimeout(() => signMessage.classList.add('hidden'), SIGN_MESSAGE_MS);
}

function hideSignMessage() {
  if (signTimer) clearTimeout(signTimer);
  signMessage.classList.add('hidden');
}

// The card names the level you have arrived in, and greets you by name the
// first time a pack takes over.
function showLevelTitle(name, welcome) {
  levelTitleName.textContent = name;
  levelTitleWelcome.textContent = welcome ? 'Welcome to ' + welcome : '';
  levelTitleWelcome.classList.toggle('hidden', !welcome);
  levelTitle.classList.remove('hidden');
  levelTitle.style.animation = 'none';
  void levelTitle.offsetWidth;     // so a replayed level announces itself again
  levelTitle.style.animation = '';
}
levelTitle.addEventListener('animationend', () => levelTitle.classList.add('hidden'));

function showAchievementToast(title) {
  achievementToast.textContent = '🏆 Achievement Unlocked: ' + title;
  achievementToast.classList.remove('hidden');
  // restart the pop animation each time
  achievementToast.style.animation = 'none';
  void achievementToast.offsetWidth;
  achievementToast.style.animation = '';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => achievementToast.classList.add('hidden'), 3000);
}
const hiscoreLine = document.getElementById('hiscoreLine');
const hiscoreLineGameOver = document.getElementById('hiscoreLineGameOver');
const nameInput = document.getElementById('nameInput');

let playerName = 'Player';
try {
  const savedName = localStorage.getItem('warmWormPlayerName');
  if (savedName) { playerName = savedName; nameInput.value = savedName; }
} catch (e) { /* ignore */ }

function getHighScore() {
  try { return parseInt(localStorage.getItem('warmWormHighScore') || '0', 10); }
  catch (e) { return 0; }
}
function setHighScore(v) {
  try { localStorage.setItem('warmWormHighScore', String(v)); } catch (e) { /* ignore */ }
}

// ---------- Shared leaderboard (works on claude.ai AND GitHub Pages) ----------
// Which backend to use is decided purely by the URL this file is running
// on — not by probing whether a capability happens to exist:
//   - on claude.ai, published Artifacts can't make arbitrary outbound
//     network requests, so we use the platform's built-in `db` capability
//   - anywhere else (github.io, etc.), that capability doesn't exist at
//     all, so we talk to Supabase directly over fetch()
const ON_CLAUDE = window.location.hostname.endsWith('claude.ai') ||
                  window.location.hostname.endsWith('claude.site');

const SUPABASE_URL = 'https://rqwgltjoygomqfcmrtdh.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Bq61t2RzKsn5K9pv9bWzyQ_sh8U-xoi';

let dbPromise = null;
function getDb() {
  if (!dbPromise) dbPromise = claude.use('db');
  return dbPromise;
}

// submits the score in the background; never awaited by the caller
async function submitScoreToLeaderboard(finalScore) {
  try {
    if (ON_CLAUDE) {
      const db = await getDb();
      if (!db) return; // capability not available in this view
      await db.collection('scores').add({ name: playerName, score: finalScore });
    } else {
      await fetch(SUPABASE_URL + '/rest/v1/leaderboard', {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ score: finalScore, name: playerName })
      });
    }
  } catch (e) { /* offline or unavailable — local high score still stands */ }
}

// fetches the top 5 scores; resolves to null on any failure/unavailability
async function fetchTopScores() {
  try {
    if (ON_CLAUDE) {
      const db = await getDb();
      if (!db) return null;
      const snap = await db.collection('scores').orderBy('score', 'desc').limit(5).get();
      return snap.docs.map(d => d.data());
    } else {
      const res = await fetch(
        SUPABASE_URL + '/rest/v1/leaderboard?select=name,score&order=score.desc&limit=5',
        { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
      );
      if (!res.ok) return null;
      return await res.json();
    }
  } catch (e) {
    return null;
  }
}

function updateHud() {
  scoreEl.textContent = 'Score: ' + score;
  livesEl.textContent = '♥ x' + lives;
  shieldBadge.classList.toggle('hidden', !hasShield);
  keyBadge.textContent = '🔑';
  for (const id of keysHeld) {
    const pip = document.createElement('span');
    pip.className = 'keyPip';
    pip.style.background = KEY_COLORS[id] || KEY_COLORS[0];
    keyBadge.appendChild(pip);
  }
  keyBadge.classList.toggle('hidden', keysHeld.length === 0);
}

// called when she touches an enemy from the side, or falls off the map
function loseLife() {
  lives--;
  levelDeathOccurred = true;
  playSound('hurt');
  updateHud();
  startDeathAnimation(() => {
    if (lives <= 0) {
      gameState = 'gameover';
      const best = Math.max(score, getHighScore());
      setHighScore(best);
      finalScoreLine.textContent = 'Score: ' + score;
      bestScoreLine.textContent = 'Best: ' + best;
      gameOverScreen.classList.remove('hidden');
      submitScoreToLeaderboard(score); // fire-and-forget — doesn't hold up the screen above
    } else {
      resetPosition();
    }
  });
}

// ---------- Custom levels ----------
// '=' is a moving platform, and its digit picks both the axis and the way it
// first sets off: 0 right, 1 left, 2 up, 3 down (PLATFORM_DIRS). 'x' marks a travel boundary it turns at;
// where none is given the nearest solid tile does the same job. Both may be
// written straight into the terrain layer (they are void there) or into an
// optional same-shape "info" layer, whichever keeps the map readable.
// Angular speed is quoted for a reference travel distance; makeRangedPlatform
// rescales it per platform so they all cross at the same px/frame.
const PLATFORM_REF_AMPLITUDE = 2.5 * TILE;

// A platform's run stops at a platform stop ('x' in marks, from any layer),
// at any cell that collides at all, or at the map's edge (Platform.run).
// `hits` is the collision grid, not the glyphs.
function makeRangedPlatform(hits, gRows, gCols, marks, row, col, axis, dir, name, digit) {
  const p = new Platform(name, col * TILE, row * TILE, 1, axis, 0, 0.02);
  const blocks = (r, c) => r < 0 || c < 0 || r >= gRows || c >= gCols || marks[r][c] === 'x' || hits[r][c] !== HIT_NONE;
  const run = Platform.run(blocks, row, col, axis);
  const lo = run[0] - 1, hi = run[1] + 1;          // the cells that stop it
  p.guide = { r: row, c: col, digit, run };        // what the collision view draws

  const size = axis === 'x' ? p.w : p.h;
  let min = (lo + 1) * TILE;
  let max = hi * TILE - size;
  const spawn = (axis === 'x' ? col : row) * TILE;
  if (max < min) { min = max = spawn; }   // no room to move — park it

  const base = (min + max) / 2;
  const amplitude = (max - min) / 2;
  const from = Math.max(min, Math.min(max, spawn));

  // Start at the spawn cell already travelling the way the arrow points.
  const backwards = dir < 0;
  let phase = 0;
  if (amplitude > 0.001) {
    const u = Math.max(-1, Math.min(1, (from - base) / amplitude));
    phase = backwards ? Math.PI - Math.asin(u) : Math.asin(u);
  }

  // Frequency scales inversely with travel, so a long run takes
  // proportionally longer and every platform crosses at the same px/frame.
  p.speed = amplitude > 0.001
    ? p.props.speed * PLATFORM_REF_AMPLITUDE / amplitude
    : p.props.speed;
  p.amplitude = amplitude;
  p.phase = phase;
  if (axis === 'x') { p.baseX = base; p.x = p.prevX = from; }
  else { p.baseY = base; p.y = p.prevY = from; }
  return p;
}

// Parses a level written as a grid of 3x3 character blocks, one block per
// map cell. The three lines of a block are the back, main and front layer;
// the three characters of a line are data, glyph and tint:
//
//     ...      back  — empty
//     3#1      main  — wall, look 3, tinted brown
//     ...      front — empty
//
// So a W x H map is 3H lines of 3W characters. A block's first two characters
// are the tile's name, matched against the sheet's row_0/row_1 to get its row;
// the third is its colour, looked up in col_0 to get the column. row_C gives
// each row its collision. All four live in the level JSON, so renaming a tile
// or changing what it collides as is data, not code.
//
// '.' and ' ' are blanks: in the id or colour slot they both mean 0, so
// '.C.', ' C ' and '0C0' are the same cell. The id doubles as the tile's
// info: it means whatever its glyph says it means (wall look under '#', ramp
// direction under '/', enemy kind under 'E', key/door/portal id under 'K'
// 'L' 'O'). An empty cell is '...'.
// Only the main layer is ever consulted for collision.
//
// Levels repeat each tileset cell into all three lines, so a block reads as a
// little picture of the map rather than one glyph floating between two rows
// of dots. A back or front cell identical to the main one says nothing new
// and is dropped below, so the repeats cost nothing.
const BLOCK = 3;
// Which of a block's three lines a thing came from. Terrain draws from the
// layer it is written in; an entity now does too, so scenery can be put
// behind the walls or in front of them by choosing a line.
const LAYER_BACK = 0;
const LAYER_MAIN = 1;
const LAYER_FRONT = 2;
// Glyphs that draw from the tileset instead of spawning something.
const TERRAIN = new Set(['#', RAMP, 'T', 'U', '*', 'o', '$', '~']);

function makeMapLayer(gRows, gCols) {
  return {
    glyphs: Array.from({ length: gRows }, () => Array(gCols).fill('.')),
    data: Array.from({ length: gRows }, () => Array(gCols).fill(0)),
    tint: Array.from({ length: gRows }, () => Array(gCols).fill(0)),
    variant: Array.from({ length: gRows }, () => Array(gCols).fill('0')),   // an object's third char
    row: Array.from({ length: gRows }, () => Array(gCols).fill(-1)),
    collide: Array.from({ length: gRows }, () => Array(gCols).fill(HIT_NONE))
  };
}

// Glyphs that once had a class of their own and now name an object of a
// shared one: a G block was a gem before gems were Treasure.
const LEGACY_GLYPHS = { G: 'gem' };

// The object a block names, or what an old glyph meant when nothing has it.
function objectFor(glyph, digit, variant) {
  const name = atlas.objectAt(glyph, digit, variant);
  if (name) return name;
  const old = LEGACY_GLYPHS[glyph];
  return old && atlas.object(old) ? old : null;
}

function parseBlockMap(text, sheet) {
  const lines = text.replace(/\r/g, '').split('\n');
  while (lines.length && lines[0].trim() === '') lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  if (lines.length === 0) return null;
  while (lines.length % BLOCK) lines.push('');   // a clipped final block is all air

  const gRows = lines.length / BLOCK;
  const gCols = Math.ceil(Math.max(...lines.map(l => l.length)) / BLOCK);
  const layers = [makeMapLayer(gRows, gCols), makeMapLayer(gRows, gCols), makeMapLayer(gRows, gCols)];

  for (let r = 0; r < gRows; r++) {
    for (let i = 0; i < BLOCK; i++) {
      const line = lines[r * BLOCK + i] || '';
      const layer = layers[i];
      for (let c = 0; c < gCols; c++) {
        const rawId = line[c * BLOCK];
        const rawCol = line[c * BLOCK + 2];
        const glyph = line[c * BLOCK + 1] || '.';
        const idCh = isBlank(rawId) ? sheet.firstTint() : rawId;
        layer.glyphs[r][c] = glyph === ' ' ? '.' : glyph;
        layer.data[r][c] = asDigit(idCh);
        layer.tint[r][c] = isBlank(rawCol) ? 0 : sheet.tintIndex(rawCol);
        layer.variant[r][c] = variantOf(rawCol);
        const sheetRow = sheet.row(idCh, glyph);
        layer.row[r][c] = sheetRow;
        layer.collide[r][c] = sheet.collideAt(sheetRow);
      }
    }
  }
  const [back, main, front] = layers;
  for (let r = 0; r < gRows; r++) {
    for (let c = 0; c < gCols; c++) {
      for (const layer of [back, front]) {
        if (layer.glyphs[r][c] !== main.glyphs[r][c]) continue;
        if (layer.data[r][c] !== main.data[r][c]) continue;
        if (layer.tint[r][c] !== main.tint[r][c]) continue;
        if (layer.variant[r][c] !== main.variant[r][c]) continue;
        layer.glyphs[r][c] = '.';
        layer.data[r][c] = 0;
        layer.tint[r][c] = 0;
        layer.row[r][c] = -1;
        layer.collide[r][c] = HIT_NONE;
      }
    }
  }
  return { rows: gRows, cols: gCols, back, main, front };
}

function loadCustomLevel(text, opts = {}) {
  // A level brings its own object manifest, whose objects' codes say what
  // each block spawns; a pasted one falls back to the root manifest.
  atlas.use(opts.manifest || atlas.root);
  useWorm();
  const sheet = new Tileset(opts.tileset);
  const map = parseBlockMap(text, sheet);
  if (!map) return { ok: false, error: 'That looks empty — paste a level first.' };

  const newRows = map.rows;
  const newCols = map.cols;
  if (newRows > 60 || newCols > 400) {
    return { ok: false, error: 'That level is too large (max 60 rows, 400 columns).' };
  }
  const all = [map.back, map.main, map.front];

  const newGrid = Array.from({ length: newRows }, () => Array(newCols).fill('.'));
  // A platform stop (js/platform-stop.js, glyph x) counts from any layer, so
  // a map can carry its platform limits wherever they read best.
  const stop = PlatformStop.codes[0][1];
  const markGrid = Array.from({ length: newRows }, (_, r) => {
    let out = '';
    for (let c = 0; c < newCols; c++) out += all.some(l => l.glyphs[r][c] === stop) ? 'x' : '.';
    return out;
  });

  // Each class says which list it lands in, so this never names a kind.
  const spawned = {
    enemies: [], coins: [], keyPickups: [], shieldPickups: [],
    portals: [], checkpoints: [], plants: [], rockSpawners: [],
    lockedDoorSpots: [], finishPoints: [], signs: [], lanterns: [], decorations: [], emitters: []
  };
  const newPlatforms = [];
  const platformSpots = [];
  let startPos = null;

  // A block's three characters name an object through the objects' codes —
  // digit and glyph its class's, the third the object's own — and the object
  // names its class. Entities spawn into the one world whichever layer their
  // block sits in, carrying that block's own digit — and the layer itself,
  // which is all that decides when they are drawn.
  const spawnEntity = (ch, d, v, r, c, layer, onMain) => {
    if (ch === 'P') { startPos = { x: c * TILE + TILE / 2, y: r * TILE }; return; }
    const name = objectFor(ch, d, v);
    const Cls = name && classOf(name);
    if (!Cls) return;
    if (Cls.editorOnly) return;      // a mark for building levels: read above, never put in the world
    // a door is the one thing that only counts in the solid layer
    if (Cls.mainLayerOnly && !onMain) return;
    // platforms wait for the terrain, since how far they travel depends on it
    if (Cls === Platform) {
      const way = PLATFORM_DIRS[d] || PLATFORM_DIRS[0];
      platformSpots.push({ row: r, col: c, axis: way.axis, dir: way.sign, name, layer, digit: PLATFORM_DIRS[d] ? d : 0 });
      return;
    }
    const into = spawned[Cls.bucket];
    const e = Cls.spawn(r, c, d, name, into.length);
    e.layer = layer;
    into.push(e);
  };

  for (let r = 0; r < newRows; r++) {
    for (let c = 0; c < newCols; c++) {
      for (let li = 0; li < all.length; li++) {
        const layer = all[li];
        const ch = layer.glyphs[r][c];
        const d = layer.data[r][c];
        if (TERRAIN.has(ch)) continue;              // drawn from the layer, inert
        spawnEntity(ch, d, layer.variant[r][c], r, c, li, layer === map.main);
      }
      // only the main layer is solid, and only its terrain glyphs are
      const mid = map.main.glyphs[r][c];
      if (TERRAIN.has(mid)) newGrid[r][c] = mid;
    }
  }

  // Doors are objects, so they stamp their own cell solid. This has to happen
  // before the platform ranges below, which stop at anything that collides.
  for (const d of spawned.lockedDoorSpots) map.main.collide[d.row][d.col] = HIT_SOLID;

  // Platform ranges read the finished terrain, so they wait for the grid.
  for (const s of platformSpots) {
    const p = makeRangedPlatform(map.main.collide, newRows, newCols, markGrid, s.row, s.col, s.axis, s.dir, s.name, s.digit);
    p.layer = s.layer;
    newPlatforms.push(p);
  }

  if (!startPos) startPos = { x: TILE + TILE / 2, y: 0 };

  grid = newGrid;
  portals = spawned.portals;
  checkpoints = spawned.checkpoints;
  portalBlocked = null;
  portalCooldown = 0;
  portalCooldownId = null;
  teleportAnim = null;
  tileset = sheet;
  backGrid = map.back.glyphs;
  frontGrid = map.front.glyphs;
  collideGrid = map.main.collide;
  gridMeta = map.main;
  backMeta = map.back;
  frontMeta = map.front;
  cols = newCols;
  rows = newRows;
  mapWidthPx = cols * TILE;
  mapHeightPx = rows * TILE;
  START = startPos;
  background = opts.background || DEFAULT_BACKGROUND;
  levelMusic = opts.music || null;
  sound.use(opts.sounds || sound.root);   // before the track, which is an id into it
  sound.setTrack(levelMusic);

  enemies = spawned.enemies;
  coins = spawned.coins;
  keyPickups = spawned.keyPickups;
  shieldPickups = spawned.shieldPickups;
  lanterns = spawned.lanterns;
  decorations = spawned.decorations;
  lightReach = 0;
  lockedDoorSpots = spawned.lockedDoorSpots;
  applyDoorCollision();
  movingPlatforms = newPlatforms;
  plants = spawned.plants;
  rockSpawners = spawned.rockSpawners;
  rocks = [];
  emitters = spawned.emitters;
  bursts = [];
  finishPoints = spawned.finishPoints;
  signs = spawned.signs;
  levelMessages = Array.isArray(opts.messages) ? opts.messages : [];
  levelPicks = Array.isArray(opts.pick) ? opts.pick : [];
  applyPicks();
  hideSignMessage();
  campaignActive = false;

  return { ok: true };
}

// What a level has her holding before she has done anything. Each entry of
// "pick" is a block written the way the map writes it — "0N2" is the small
// lantern, "0C0" a coin — and is taken without ever being placed, so a level
// can open in a state the player would otherwise have to walk into. Anything
// that isn't a pickup is ignored. Lighting is just the usual case: no entry
// leaves the level in the full light "0N0" would give it.
function applyPicks() {
  const effects = sound.effectsOn;
  sound.effectsOn = false;         // she didn't just do these, so they make no noise
  for (const block of levelPicks) {
    if (typeof block !== 'string' || block.length < 2) continue;
    const data = asDigit(block[0]);
    const glyph = block[1];
    const name = objectFor(glyph, data, block[2]);
    const Cls = name && classOf(name);
    if (!Cls || !(Cls.prototype instanceof Pickup)) continue;
    Cls.spawn(0, 0, data, name, 0).take();
  }
  sound.effectsOn = effects;
  lightRadius = lightTarget();     // a level opens at its own reach rather than easing into it
  updateHud();
}

// ---------- Debug: export the live level back to block-map text ----------
// Reconstructs the format loadCustomLevel() reads: the back and front layers
// as they were parsed, and a main layer of terrain plus every currently-
// remaining entity stamped at its present tile (a live snapshot, not
// necessarily the original spawn text).
function exportCurrentLevelAscii() {
  const mid = grid.map(row => row.slice());
  const blank = () => Array.from({ length: rows }, () => Array(cols).fill(0));
  const midData = gridMeta ? gridMeta.data.map(row => row.slice()) : blank();
  const midTint = gridMeta ? gridMeta.tint.map(row => row.slice()) : blank();
  const put = (px, py, ch, d = 0) => {
    const c = Math.floor(px / TILE), r = Math.floor(py / TILE);
    if (r >= 0 && r < rows && c >= 0 && c < cols) { mid[r][c] = ch; midData[r][c] = d; midTint[r][c] = 0; }
  };
  for (const group of entityGroups()) {
    for (const e of group) {
      const cell = e.mapCell();
      if (cell) put(cell.x, cell.y, cell.ch, cell.data);
    }
  }
  put(START.x, START.y, 'P');
  const colName = i => tileset.tintName(i);
  const cell = (glyph, d, tint) =>
    glyph === '.' ? '...' : `${d}${glyph}${colName(tint)}`;
  const layerLine = (glyphs, data, tint, r, echoTerrain) => {
    let out = '';
    for (let c = 0; c < cols; c++) {
      const own = glyphs ? glyphs[r][c] : '.';
      // repeat the terrain into the outer lines so the text reads as a map
      const echo = echoTerrain && own === '.' && TERRAIN.has(mid[r][c]);
      out += echo
        ? cell(mid[r][c], midData[r][c], midTint[r][c])
        : cell(own, data ? data[r][c] : 0, tint ? tint[r][c] : 0);
    }
    return out;
  };
  const out = [];
  for (let r = 0; r < rows; r++) {
    out.push(layerLine(backGrid, backMeta && backMeta.data, backMeta && backMeta.tint, r, true));
    out.push(layerLine(mid, midData, midTint, r, false));
    out.push(layerLine(frontGrid, frontMeta && frontMeta.data, frontMeta && frontMeta.tint, r, true));
  }
  return out.join('\n');
}


// ---------- Level background ----------
// What sits behind the tile layers: a flat colour, optionally with a sprite
// tiled over it. `scroll` is how much of the camera the sprite takes — 0 pins
// it to the window, 1 pins it to the world — so a low number reads as distance.
//
//   "background": "#1b2a4a"
//   "background": { "color": "#140c1c", "texture": "bg-stars.png", "scroll": 0.25 }
const DEFAULT_BACKGROUND = { color: '#6bb8e8', texture: null, scroll: 0.3 };
let background = DEFAULT_BACKGROUND;
let levelMusic = null;    // the id of the track this level asked for, out of its sound manifest

function parseBackground(spec, base) {
  if (!spec) return null;
  if (typeof spec === 'string') return { color: spec, texture: null, scroll: 0 };
  return {
    color: spec.color || DEFAULT_BACKGROUND.color,
    texture: resolveTexture(spec.texture, base),
    scroll: spec.scroll === undefined ? DEFAULT_BACKGROUND.scroll : +spec.scroll
  };
}

const bgPatterns = new Map();   // one repeating fill per texture, however many levels name it

// A textured background, painted once — its colour and the texture repeated
// over it — into an image the size of the screen plus one texture each way,
// so each frame copies the window the scroll asks for, a pixel to a pixel.
// Measured on an Intel HD 4600, filling the screen with the repeating pattern
// every frame took it from 60 fps to about 25; one full-screen image costs
// next to nothing. Kept as an Image, which draws faster than a canvas would.
// Rebuilt when the texture, its colour or the screen changes; null until it
// has decoded, and the pattern is drawn meanwhile.
let bgPlate = null;   // { key, img, ready, tw, th } — tw, th: one texture, in screen pixels
function backgroundPlate(tex) {
  const key = [background.texture, background.color, canvas.width, canvas.height, PIXEL_X].join('|');
  if (bgPlate && bgPlate.key === key) return bgPlate.ready ? bgPlate : null;
  // a whole number of screen pixels per repeat, so the copy wraps seamlessly
  const tw = Math.max(1, Math.round(tex.naturalWidth * PIXEL_X)), th = Math.max(1, Math.round(tex.naturalHeight * PIXEL_Y));
  const c = document.createElement('canvas');
  c.width = canvas.width + tw;
  c.height = canvas.height + th;
  const g = c.getContext('2d');
  g.fillStyle = background.color;
  g.fillRect(0, 0, c.width, c.height);
  const pattern = g.createPattern(tex, 'repeat');
  pattern.setTransform(new DOMMatrix([tw / tex.naturalWidth, 0, 0, th / tex.naturalHeight, 0, 0]));
  g.fillStyle = pattern;
  g.fillRect(0, 0, c.width, c.height);
  const img = new Image();
  const plate = { key, img, ready: false, tw, th };
  img.onload = () => { plate.ready = true; };
  img.src = c.toDataURL();
  bgPlate = plate;
  return null;
}

function drawBackground() {
  // The level is the whole world, so nothing is painted past its edges: a
  // level smaller than the window sits in the surround instead of bleeding
  // sky across it.
  const left = Math.max(0, -cam.x);
  const top = Math.max(0, -cam.y);
  const right = Math.min(VIEW_W, mapWidthPx - cam.x);
  const bottom = Math.min(VIEW_H, mapHeightPx - cam.y);
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);
  if (right <= left || bottom <= top) return;

  const tex = background.texture ? loadTexture(background.texture) : null;
  const plate = tex && tex.complete && tex.naturalWidth ? backgroundPlate(tex) : null;
  if (plate) {
    // the part of the level on screen, in screen pixels, copied from where
    // the scroll has got to in the plate
    const L = Math.round(left * PIXEL_X), T = Math.round(top * PIXEL_Y);
    const W = Math.round(right * PIXEL_X) - L, H = Math.round(bottom * PIXEL_Y) - T;
    const mod = (v, m) => ((v % m) + m) % m;
    const sx = Math.round(mod(cam.x * background.scroll * PIXEL_X, plate.tw));
    const sy = Math.round(mod(cam.y * background.scroll * PIXEL_Y, plate.th));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(plate.img, sx + L, sy + T, W, H, L, T, W, H);
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, right - left, bottom - top);
  ctx.clip();
  ctx.fillStyle = background.color;
  ctx.fillRect(left, top, right - left, bottom - top);

  const img = background.texture ? loadTexture(background.texture) : null;
  if (img && img.complete && img.naturalWidth) {
    let pattern = bgPatterns.get(background.texture);
    if (!pattern) {
      pattern = ctx.createPattern(img, 'repeat');
      bgPatterns.set(background.texture, pattern);
    }
    // the fill starts a whole tile back so the offset can't leave a seam
    const w = img.naturalWidth, h = img.naturalHeight;
    const ox = ((-cam.x * background.scroll) % w + w) % w - w;
    const oy = ((-cam.y * background.scroll) % h + h) % h - h;
    ctx.translate(ox, oy);
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, VIEW_W + w, VIEW_H + h);
  }
  ctx.restore();
}

// ---------- Lantern darkness ----------
// One gradient over the whole screen, clear where she stands and solid
// everywhere past its reach. A radial gradient paints its last stop over
// everything outside the outer circle, so the one fill is both the dark and
// the hole in it.
//
// `lightReach` is what the last lamp gave her, in tiles, with 0 meaning full
// light; `lightRadius` is the radius actually drawn, which eases toward it so
// swapping lamps opens or closes rather than snapping.
let lightReach = 0;
let lightRadius = 0;

const LIGHT_EASE = 0.09;         // share of the gap closed each tick
const LIGHT_CORE = 0.45;         // where the gradient stops being wholly clear

// Full light is drawn as a hole wider than the window rather than as no
// gradient at all, so it is one more radius to ease toward instead of a case
// of its own. The whole window has to fit inside the clear core.
function fullLightRadius() {
  return Math.hypot(VIEW_W, VIEW_H) / LIGHT_CORE;
}

function lightTarget() {
  return lightReach > 0 ? lightReach * TILE : fullLightRadius();
}

// Eased in proportion rather than in pixels: two tiles to six should read
// like six to full, and in raw pixels it would not.
function easeLight() {
  const target = lightTarget();
  if (lightRadius <= 1 || Math.abs(Math.log(target / lightRadius)) < 0.01) {
    lightRadius = target;
    return;
  }
  lightRadius *= Math.pow(target / lightRadius, LIGHT_EASE);
}

function drawDarkness() {
  if (lightRadius >= fullLightRadius()) return;
  const x = warm.x - cam.x, y = warm.y - cam.y;
  const glow = ctx.createRadialGradient(x, y, lightRadius * LIGHT_CORE, x, y, lightRadius);
  glow.addColorStop(0, 'rgba(6,4,14,0)');
  glow.addColorStop(0.75, 'rgba(6,4,14,0.6)');
  glow.addColorStop(1, 'rgba(6,4,14,1)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

// ---------- Level packs ----------
// A pack is a folder that stands on its own: levelpack.json names the tileset
// and objects every level in it shares, points at the first level, and sits
// beside its own copy of the art those two name. So a pack can be zipped up
// and handed over whole.
//
//   levelpack.json   { name, first, tileset { ... }, objects { manifest, glyphs } }
//   <level>.json     { name?, exit?, pick?, map }
//
// A level inherits the pack's tileset and objects, and may override either —
// its own paths then resolve against the level file rather than the pack.
// "pick" lists blocks the level counts as already taken, so it can open with
// the small lantern lit ("1N0") or a coin already scored ("0C0"); a level that
// names none opens in full light, the same as "0N0".
// "exit" lists where each of its flags leads, relative to the file it appears
// in: the flag written '0F' takes the first entry, '1F' the second. An exit
// naming another pack's levelpack.json crosses into that pack at its first
// level, so packs chain into a campaign without either knowing the other's
// insides. A flag with no exit behind it ends the run, so a pack needs no end
// marker.
//
// An exit may also be a share link (…/share/?from=<id>&get=<name>&v=…): a
// level pack kept in another player's browser. The flag stays shut until
// that pack can be had, here already or from a browser that answers; going
// through fetches it into this browser and plays it from its first level.
//
// An exit written { "to": ..., "return": true } is a round trip: diving into
// that flag remembers this level, exactly as it stands, and the first flag
// over there with no exit behind it comes back out of this very flag. That is
// what lets a bonus level be entered from three different places — or from
// another bonus level — without it knowing where home is.
// fetch() is blocked on file:// URLs, so the page must be served over http.
const ROOT_PACK_URL = window.PACK_URL || '/levelpacks/garden/levelpack.json';
const PACK_FILE = 'levelpack.json';
const MAX_LEVELS = 64;
let BUILTIN_LEVELS = [];

// Paths in levelpack.json are relative to the pack, so they're resolved here
// while that's still known. The sheets they name are left unfetched: a pack
// reached only through some far-off flag shouldn't cost anything up front.
async function loadLevelPack(url) {
  if (url.origin !== location.origin) throw new Error(`${url.href} is off-origin`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url.pathname}: HTTP ${res.status}`);
  const data = await res.json();
  if (!data.first) throw new Error(`${url.pathname}: no first level`);
  const sheet = data.tileset || {};
  const objects = data.objects || {};
  return {
    name: typeof data.name === 'string' ? data.name : '',
    first: new URL(data.first, url),
    tileset: { ...sheet, texture: resolveTexture(sheet.texture, url) },
    background: parseBackground(data.background, url),
    music: typeof data.music === 'string' ? data.music : null,
    manifestUrl: objects.manifest ? new URL(objects.manifest, url) : null,
    soundsUrl: data.sounds ? new URL(data.sounds, url) : null
  };
}

// One record per pack, however many flags lead into it.
const levelPacks = new Map();
function packAt(url) {
  if (!levelPacks.has(url.href)) levelPacks.set(url.href, loadLevelPack(url));
  return levelPacks.get(url.href);
}

// Where a flag leads, and which pack's definitions the level there wears.
async function exitTarget(path, from, pack) {
  const url = new URL(path, from);
  if (!url.pathname.endsWith('/' + PACK_FILE)) return { url, pack };
  const next = await packAt(url);
  return { url: next.first, pack: next };
}

// The sheets a level draws from, fetched the first time it is reached. Packs
// share their art, so crossing between levels of one pack asks for nothing new
// while crossing into another brings in everything that pack owns.
async function loadLevelResources(level) {
  if (!level.manifest) {
    level.manifest = level.manifestUrl ? await atlas.loadManifest(level.manifestUrl) : atlas.root;
  }
  if (!level.sounds) {
    level.sounds = level.soundsUrl ? await sound.loadManifest(level.soundsUrl) : sound.root;
  }
  const sheets = [loadTexture(level.tileset.texture || DEFAULT_TEXTURE)];
  if (level.background.texture) sheets.push(loadTexture(level.background.texture));
  await Promise.all(sheets.map(textureReady));
}

async function loadBuiltinLevels() {
  const root = await packAt(new URL(ROOT_PACK_URL, location.href));
  const levels = [];
  const indexByUrl = new Map();
  const unresolved = [];          // [level index, exit targets] until every file is known
  const queue = [{ url: root.first, pack: root }];

  while (queue.length) {
    const { url, pack } = queue.shift();
    if (indexByUrl.has(url.href)) continue;     // already loaded, or two exits share a target
    if (url.origin !== location.origin) throw new Error(`${url.href} is off-origin`);
    if (levels.length >= MAX_LEVELS) throw new Error(`campaign exceeds ${MAX_LEVELS} levels`);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url.pathname}: HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.map) || data.map.length === 0) throw new Error(`${url.pathname}: no map`);

    const exits = [];
    const returns = [];
    const links = [];              // by flag: a pack in another browser, instead
    for (const entry of (Array.isArray(data.exit) ? data.exit : [])) {
      const path = typeof entry === 'string' ? entry : entry && entry.to;
      if (!path) throw new Error(`${url.pathname}: exit ${exits.length} names no level`);
      const link = shareLinkOf(path);
      if (link) { links[exits.length] = link; exits.push(null); returns.push(false); continue; }
      exits.push(await exitTarget(path, url, pack));
      returns.push(typeof entry === 'object' && !!entry.return);
    }
    // A level may override what the pack gave it; anything it leaves out it
    // inherits, already resolved against the pack.
    const sheet = data.tileset || {};
    const objects = data.objects || {};
    const tileset = { ...pack.tileset, ...sheet };
    if (sheet.texture) tileset.texture = resolveTexture(sheet.texture, url);

    indexByUrl.set(url.href, levels.length);
    unresolved.push([levels.length, exits]);
    levels.push({
      map: data.map.join('\n'),
      name: typeof data.name === 'string' ? data.name : '',
      messages: Array.isArray(data.messages) ? data.messages : [],
      pick: Array.isArray(data.pick) ? data.pick : [],
      pack,
      tileset,
      background: parseBackground(data.background, url) || pack.background || DEFAULT_BACKGROUND,
      music: (typeof data.music === 'string' ? data.music : null) || pack.music || null,
      manifestUrl: objects.manifest ? new URL(objects.manifest, url) : pack.manifestUrl,
      manifest: null,
      soundsUrl: data.sounds ? new URL(data.sounds, url) : pack.soundsUrl,
      sounds: null,
      exits: [],
      returns,
      links
    });
    queue.push(...exits.filter(Boolean));
  }

  for (const [i, exits] of unresolved) levels[i].exits = exits.map(t => t ? indexByUrl.get(t.url.href) : undefined);
  if (levels.length === 0) throw new Error('no levels in pack');
  BUILTIN_LEVELS = levels;
  await loadLevelResources(levels[0]);
}

// Leaving a level: the screen fades to black, a between-packs greeting can sit
// in the dark, then the next level fades up. `wait` lets the dark double as a
// loading screen — it holds until the next level's sheets have landed.
const FADE_FRAMES = 24;
const WELCOME_FRAMES = 100;

function startLevelTransition(welcome, action, wait) {
  const t = levelTransition = { phase: 'out', t: 0, welcome, action, ready: !wait };
  if (wait) wait.catch(err => console.error(err)).then(() => { t.ready = true; });
  transitionWelcome.classList.add('hidden');
  transitionOverlay.style.opacity = '0';
  transitionOverlay.classList.remove('hidden');
}

function endLevelTransition() {
  transitionOverlay.classList.add('hidden');
  transitionWelcome.classList.add('hidden');
  levelTransition = null;
}

function updateLevelTransition() {
  const t = levelTransition;
  t.t++;

  if (t.phase === 'out') {
    transitionOverlay.style.opacity = String(Math.min(1, t.t / FADE_FRAMES));
    if (t.t < FADE_FRAMES) return;
    t.t = 0;
    t.phase = t.welcome ? 'welcome' : 'swap';
    if (t.welcome) {
      transitionName.textContent = t.welcome;
      transitionWelcome.classList.remove('hidden');
    }
    return;
  }

  if (t.phase === 'welcome') {
    if (t.t < WELCOME_FRAMES) return;
    t.t = 0;
    t.phase = 'swap';
    return;
  }

  if (t.phase === 'swap') {
    if (!t.ready) return;
    transitionWelcome.classList.add('hidden');
    t.action();
    if (gameState !== 'playing') { endLevelTransition(); return; }  // a full screen took over, nothing to fade up
    t.t = 0;
    t.phase = 'in';
    return;
  }

  transitionOverlay.style.opacity = String(Math.max(0, 1 - t.t / FADE_FRAMES));
  if (t.t >= FADE_FRAMES) endLevelTransition();
}

// ---------- Round trips ----------
// A level is kept alive rather than remembered: loading the next one replaces
// these variables instead of emptying them, so the lists captured here stop
// changing the moment she leaves and are still true when she comes back.
// Keys, score and shield are hers, not the level's, so they travel with her.
function captureWorld(flag) {
  return {
    index: currentLevelIndex, flag, respawnPoint, died: levelDeathOccurred,
    grid, backGrid, frontGrid, collideGrid, gridMeta, backMeta, frontMeta, tileset,
    cols, rows, mapWidthPx, mapHeightPx, START, background, levelMusic,
    enemies, coins, keyPickups, shieldPickups, lockedDoorSpots,
    movingPlatforms, plants, rockSpawners, rocks, emitters,
    portals, checkpoints, finishPoints, signs, levelMessages, levelPicks, lanterns, decorations, lightReach, lightRadius
  };
}

function restoreWorld(w) {
  const level = BUILTIN_LEVELS[w.index];
  atlas.use(level.manifest || atlas.root);   // the cast this world was built from
  useWorm();
  grid = w.grid; backGrid = w.backGrid; frontGrid = w.frontGrid;
  collideGrid = w.collideGrid; gridMeta = w.gridMeta; backMeta = w.backMeta; frontMeta = w.frontMeta;
  tileset = w.tileset;
  cols = w.cols; rows = w.rows; mapWidthPx = w.mapWidthPx; mapHeightPx = w.mapHeightPx;
  START = w.START;
  background = w.background;
  levelMusic = w.levelMusic;
  sound.use(level.sounds || sound.root);
  sound.setTrack(levelMusic);
  enemies = w.enemies; coins = w.coins;
  keyPickups = w.keyPickups; shieldPickups = w.shieldPickups;
  lanterns = w.lanterns; lightReach = w.lightReach; lightRadius = w.lightRadius;
  decorations = w.decorations;
  lockedDoorSpots = w.lockedDoorSpots;
  movingPlatforms = w.movingPlatforms; plants = w.plants;
  rockSpawners = w.rockSpawners; rocks = w.rocks;
  emitters = w.emitters || []; bursts = [];
  portals = w.portals; checkpoints = w.checkpoints;
  finishPoints = w.finishPoints; signs = w.signs;
  levelMessages = w.levelMessages;
  levelPicks = w.levelPicks;
  applyDoorCollision();        // the door lookup is keyed by cell, so it is rebuilt
  hideSignMessage();
  portalBlocked = null;
  portalCooldown = 0;
  portalCooldownId = null;
  currentLevelIndex = w.index;
  currentPack = level.pack;
  campaignActive = true;
  levelDeathOccurred = w.died;
  respawnPoint = w.respawnPoint;
  updateHud();
}

// Back out of the flag she went in by, which is left inert until she steps
// off it so arriving on top of it doesn't send her straight back.
function returnToCaller() {
  const home = returnStack.pop();
  const level = BUILTIN_LEVELS[home.index];
  restoreWorld(home);
  placeWormAt(home.flag.x, home.flag.y);
  flagBlocked = home.flag;
  showLevelTitle(level.name || ('Level ' + (home.index + 1)), '');
}

// `greeted` is set when the curtain has already named the pack she's entering.
function loadLevelByIndex(i, greeted) {
  const level = BUILTIN_LEVELS[i];
  const result = loadCustomLevel(level.map, level);
  currentLevelIndex = i;
  campaignActive = true;
  levelDeathOccurred = false;
  flagBlocked = null;
  showLevelTitle(level.name || ('Level ' + (i + 1)),
    greeted || level.pack === currentPack ? '' : level.pack.name);
  currentPack = level.pack;
  return result;
}

function checkFinish() {
  if (flagBlocked && Math.hypot(warm.x - flagBlocked.x, warm.y - flagBlocked.y) >= R + flagBlocked.r) {
    flagBlocked = null;
  }
  const flag = finishPoints.find(f => f !== flagBlocked && Math.hypot(warm.x - f.x, warm.y - f.y) < R + f.r);
  if (!flag) return;
  // the flag stays in the world so she can be seen diving into it; the dive
  // and the transition that follows both freeze update(), so it can't re-fire

  const level = campaignActive ? BUILTIN_LEVELS[currentLevelIndex] : null;
  // a way into another browser's pack that can't be had just now stays shut
  const link = level && level.links && level.links[flag.id];
  if (link && linkState(link).state !== 'open') {
    flagBlocked = flag;
    const s = linkState(link);
    showSignMessage(s.state === 'checking' ? 'Looking for the way through…'
      : `This way leads to ${s.title || link.name}, in another player's browser — it can't be reached right now.`);
    checkLink(link);
    return;
  }
  // a round trip isn't finishing the level — she is coming back to it
  const roundTrip = !!(level && level.returns && level.returns[flag.id]);

  if (campaignActive && !roundTrip) {
    const stars = computeStarsForCurrentLevel();
    if (stars > (levelStars[currentLevelIndex] || 0)) {
      levelStars[currentLevelIndex] = stars;
      saveLevelStars();
    }
    if (currentLevelIndex === 0) unlockAchievement('firstSteps');
    if (!levelDeathOccurred) unlockAchievement('untouchable');
  }

  if (link) { triggerExitDive(flag, () => enterSharedPack(link)); return; }

  // which flag she touched picks the exit; with no exit behind it she goes
  // back wherever she came in from, or the run ends if she came from nowhere
  const nextIndex = level ? level.exits[flag.id] : undefined;
  if (nextIndex === undefined) {
    if (!returnStack.length) {
      triggerExitDive(flag, () => startLevelTransition('', () => showWinScreen()));
      return;
    }
    const home = BUILTIN_LEVELS[returnStack[returnStack.length - 1].index];
    const welcome = home.pack === currentPack ? '' : home.pack.name;
    triggerExitDive(flag, () => startLevelTransition(welcome, returnToCaller));
    return;
  }

  const next = BUILTIN_LEVELS[nextIndex];
  const welcome = next.pack === currentPack ? '' : next.pack.name;
  const loading = loadLevelResources(next);
  const home = roundTrip ? captureWorld(flag) : null;
  triggerExitDive(flag, () => startLevelTransition(welcome, () => {
    if (home) returnStack.push(home);
    loadLevelByIndex(nextIndex, !!welcome);
    respawnPoint = { x: START.x, y: START.y };
    resetPosition();
  }, loading));
}

// ---------- Ways into other browsers' level packs ----------
// A share link as a flag's exit: { href, from, name, v }, or null for any
// other exit.
function shareLinkOf(text) {
  if (typeof text !== 'string' || !/^https?:\/\//.test(text)) return null;
  let u;
  try { u = new URL(text); } catch (e) { return null; }
  const from = u.searchParams.get('from'), name = u.searchParams.get('get');
  if (!from || !name) return null;
  return { href: u.href, from, name, v: u.searchParams.get('v') || '' };
}

// What is known of each: state 'checking', 'open' (here already, or a
// browser answers for it) or 'closed'; its title once heard; whether a copy
// is here. Looked for in the background: playing never waits on it.
const linkStates = new Map();
const LINK_RECHECK_MS = 20000;
function linkState(link) {
  if (!linkStates.has(link.href)) { linkStates.set(link.href, { state: 'checking', title: '', here: false, busy: false, at: 0 }); checkLink(link); }
  return linkStates.get(link.href);
}
// what a flag shows: '' open (or no link behind it), 'checking' or 'closed'
function flagShut(flag) {
  const level = campaignActive ? BUILTIN_LEVELS[currentLevelIndex] : null;
  const link = level && level.links && level.links[flag.id];
  if (!link) return '';
  const s = linkState(link);
  return s.state === 'open' ? '' : s.state;
}

async function checkLink(link) {
  const s = linkState(link);
  if (s.busy) return;
  s.busy = true;
  s.at = Date.now();
  try {
    const C = window.wtwShare ? await window.wtwShare.code() : null;
    if (!C) { s.state = 'closed'; return; }
    const name = C.clean(link.name);
    const kept = (await C.listPacks()).find(p => p.name === name);
    s.here = !!kept;
    if (kept) s.title = kept.title;
    // its very version here: nothing to ask anybody
    if (kept && link.v && kept.v === link.v) { s.state = 'open'; return; }
    if (link.from === C.shareId()) { s.state = kept ? 'open' : 'closed'; return; }
    try {
      const r = await C.fetchPack({ from: link.from, name, v: link.v, diff: true });
      s.title = r.title || s.title;
      s.state = 'open';
    } catch (e) {
      // nobody answers: a copy here, of any version, still does
      s.state = kept ? 'open' : 'closed';
    }
  } catch (e) {
    s.state = 'closed';
  } finally {
    s.busy = false;
  }
}

// Every way out of this level that is still shut is looked for again now
// and then, while she plays.
setInterval(() => {
  if (gameState !== 'playing' || !campaignActive) return;
  const level = BUILTIN_LEVELS[currentLevelIndex];
  for (const link of (level && level.links) || []) {
    if (!link) continue;
    const s = linkState(link);
    if (s.state !== 'open' && Date.now() - s.at >= LINK_RECHECK_MS) checkLink(link);
  }
}, 5000);

// Through the flag: the pack comes into this browser (only what isn't here
// already), with its name and a bar on the screen, then its own page takes
// over and starts at its first level.
const downloadScreen = document.getElementById('downloadScreen');
const downloadTitle = document.getElementById('downloadTitle');
const downloadNote = document.getElementById('downloadNote');
const downloadBar = document.getElementById('downloadBar').firstElementChild;
const downloadBack = document.getElementById('downloadBack');
async function enterSharedPack(link) {
  const s = linkState(link);
  gameState = 'download';
  downloadTitle.textContent = s.title || link.name;
  downloadNote.textContent = 'Finding the way…';
  downloadBar.style.width = '0%';
  downloadBack.classList.add('hidden');
  downloadScreen.classList.remove('hidden');
  try {
    const C = await window.wtwShare.code();
    const name = C.clean(link.name);
    let key = 'idb:' + name;
    try {
      const r = await C.fetchPack({ from: link.from, name, v: link.v }, d => {
        if (d.title) downloadTitle.textContent = d.title;
        if (d.note) downloadNote.textContent = d.note;
        else if (d.text) downloadNote.textContent = d.text;
        if (d.total) downloadBar.style.width = `${(100 * d.got / d.total).toFixed(1)}%`;
      });
      key = r.key;
    } catch (err) {
      // nobody answers now: a copy here, of any version, will do
      if (!s.here) throw err;
      downloadNote.textContent = "Its browser isn't answering — playing the copy you have.";
    }
    downloadBar.style.width = '100%';
    downloadNote.textContent = 'Starting it…';
    // its own page (or this engine, for a page from before ?play)
    const page = await C.startUrl(key);
    // a pack kept in the browser is served by its service worker
    if (page.startsWith(packStore.PREFIX) || page.includes(encodeURIComponent(packStore.PREFIX))) {
      packStore.boot();
      if (!await packStore.ready()) throw new Error('this browser will not keep games here');
    }
    location.href = page;
  } catch (err) {
    s.state = s.here ? 'open' : 'closed';
    downloadNote.textContent = 'Could not get it: ' + err.message;
    downloadBack.classList.remove('hidden');
    downloadBack.focus();
  }
}
// back to the level she dived out of, at her last checkpoint
downloadBack.addEventListener('click', () => {
  downloadScreen.classList.add('hidden');
  resetPosition();
  gameState = 'playing';
});

function showWinScreen() {
  gameState = 'win';
  const best = Math.max(score, getHighScore());
  setHighScore(best);
  winScoreLine.textContent = 'Score: ' + score;
  winBestLine.textContent = 'Best: ' + best;
  winScreen.classList.remove('hidden');
  submitScoreToLeaderboard(score);
  unlockAchievement('campaignComplete');
}

function startCampaign() {
  levelDeathOccurred = false;
  currentPack = null;          // so a fresh run is welcomed into its first pack
  // the opening level is entered the same way as any other pack: the screen in
  // front of it fades out, the pack names itself in the dark, then level one
  // fades up. The curtain rides update(), so the loop has to be running first.
  gameState = 'playing';
  startLevelTransition(BUILTIN_LEVELS[0].pack.name, () => {
    loadLevelByIndex(0, true);
    startGame(true);
  });
}

// `keepCurtain` is set when a transition is mid-sequence and still owes a fade-up.
function startGame(keepCurtain) {
  const typed = nameInput.value.trim();
  playerName = (typed || 'Player').slice(0, 14);
  try { localStorage.setItem('warmWormPlayerName', playerName); } catch (e) { /* ignore */ }

  score = 0;
  lives = 3;
  deathAnim = null;
  respawnPoint = { x: START.x, y: START.y };
  resetPosition();
  for (const group of entityGroups()) {
    for (const e of group) e.reset();
  }
  rocks = [];
  bursts = [];
  keysHeld = [];
  lightReach = 0;
  returnStack = [];
  flagBlocked = null;
  applyPicks();          // the resets above put the level back before its own pick list
  applyDoorCollision();
  portalBlocked = null;
  portalCooldown = 0;
  portalCooldownId = null;
  teleportAnim = null;
  camScroll.active = false;
  if (!keepCurtain) {
    levelTransition = null;
    transitionOverlay.classList.add('hidden');
  }
  updateHud();
  startScreen.classList.add('hidden');
  document.getElementById('hiscoreScreen').classList.add('hidden');
  document.getElementById('customLevelScreen').classList.add('hidden');
  document.getElementById('optionsScreen').classList.add('hidden');
  document.getElementById('achievementsScreen').classList.add('hidden');
  document.getElementById('pauseScreen').classList.add('hidden');
  document.getElementById('pauseConfirm').classList.add('hidden');
  document.getElementById('pauseMainButtons').classList.remove('hidden');
  gameOverScreen.classList.add('hidden');
  winScreen.classList.add('hidden');
  hiscoreLine.textContent = '';
  hiscoreLineGameOver.textContent = '';
  hiscoreLineWin.textContent = '';
  gameState = 'playing';
}

// ---------- Enemies ----------

// ---------- Entities ----------
// One file per kind under js/, loaded by the script tags in the page. What
// the world currently holds lives here, since the engine is what empties and
// refills it on every level load.
let enemies = [];
let movingPlatforms = [];
let platformTimer = 0;
let rockSpawners = [];
let rocks = [];
let plants = [];
let coins = [];     // every Treasure, coins and gems alike
let shieldPickups = [];
let keyPickups = [];
let lanterns = [];
let decorations = [];     // scenery; drawn first so it sits behind everything
let emitters = [];        // particle systems placed in the level (js/particles.js)
let bursts = [];          // one-off particle bursts, a coin's sparkle; gone once done
let signs = [];
let levelMessages = [];   // what each 'M' block says, picked by its info digit
let levelPicks = [];      // blocks the level counts as already taken, e.g. "1N0"

function checkEnemyCollisions() {
  for (const e of enemies) {
    if (!e.alive) continue;
    const dx = warm.x - e.x;
    const dy = warm.y - e.y;
    const dist = Math.hypot(dx, dy);
    if (dist < R + e.r) {
      if (warm.vy > 0 && warm.y < e.y - e.r * 0.3) {
        // stomped from above
        e.alive = false;
        ParticleSystem.burst(e.props.stompParticles, e.x, e.y, e.layer);
        warm.vy = JUMP_V * e.props.stompBounce;
        score += e.props.stompScore;
        stats.stomps++;
        saveStats();
        checkStatAchievements();
        updateHud();
        playSound(e.props.stompSound);
      } else if (hasShield) {
        // the shield absorbs one side hit AND takes the enemy out with it
        hasShield = false;
        e.alive = false;
        ParticleSystem.burst(e.props.stompParticles, e.x, e.y, e.layer);
        score += e.props.stompScore;
        stats.stomps++;
        saveStats();
        checkStatAchievements();
        updateHud();
        playSound('shieldBreak');
        warm.vx = (warm.x < e.x ? -1 : 1) * 4; // small knockback
      } else {
        loseLife();
      }
      return;
    }
  }
}

// ---------- Teleporters ----------
// A linked pair: touching either pad sends her to the other, with the
// camera doing a smooth scroll to the new area instead of an instant cut.
// A short cooldown after arriving stops her from immediately bouncing
// straight back.
let portals = [];        // { x, y, r, id } — 'O' glyphs, paired by id
let portalBlocked = null; // the portal she arrived at, inert until she steps clear of it
let portalCooldown = 0;
let portalCooldownId = null;
const PORTAL_COOLDOWN = 60;
// Teleporting plays out in two phases: the whole body is reeled into the pad
// she entered, then it pops back out of the far pad part by part.
let teleportAnim = null; // { entry, dest, phase: 'in'|'out', t }
const TELE_STEP = 3;     // frames one part takes to reappear
const telePhase = () => SEGMENT_COUNT * TELE_STEP + TELE_STEP;
const TELE_REEL = 3.2;   // px a part is dragged along the chain per frame
const TELE_MAX_IN = 180; // safety cap on the suction phase

function triggerTeleport(entry, dest) {
  warm.vx = 0;
  warm.vy = 0;
  teleportAnim = { entry, dest, phase: 'in', t: 0 };
  playSound('teleport');
}

// Reaching a flag reels her in exactly as a portal does; what's on the far
// side is the next level, so the suction phase hands over instead of popping
// the body back out.
function triggerExitDive(entry, onSwallowed) {
  warm.vx = 0;
  warm.vy = 0;
  teleportAnim = { entry, dest: null, phase: 'in', t: 0, onSwallowed };
  playSound('teleport');
}

function dragToward(seg, tx, ty, speed) {
  const dx = tx - seg.x;
  const dy = ty - seg.y;
  const d = Math.hypot(dx, dy);
  if (d <= speed) { seg.x = tx; seg.y = ty; return; }
  seg.x += (dx / d) * speed;
  seg.y += (dy / d) * speed;
}

// Going in, the head is drawn into the pad and every other part is dragged
// along after the one in front of it, each only fading once it reaches the
// mouth of the hole. Coming out, the parts swell back up at the far pad in
// the same order, with the camera scroll starting as the body goes under.
function updateTeleportAnimation() {
  const a = teleportAnim;
  a.t++;

  if (a.phase === 'in') {
    const e = a.entry;
    dragToward(segments[0], e.x, e.y, TELE_REEL);
    for (let i = 1; i < segments.length; i++) {
      dragToward(segments[i], segments[i - 1].x, segments[i - 1].y, TELE_REEL);
    }
    let swallowed = true;
    for (const seg of segments) {
      seg.vy = 0;
      seg.vis = Math.max(0, Math.min(1, Math.hypot(seg.x - e.x, seg.y - e.y) / e.r));
      if (seg.vis > 0) swallowed = false;
    }
    if (!swallowed && a.t < TELE_MAX_IN) return;

    if (a.onSwallowed) {
      segments.forEach(s => { s.vis = 0; });
      teleportAnim = null;
      a.onSwallowed();
      return;
    }

    const dest = a.dest;
    warm.x = dest.x;
    warm.y = dest.y;
    segments = RADII.map(r => ({ x: dest.x, y: dest.y, vy: 0, r, vis: 0 }));
    portalBlocked = dest;
    portalCooldown = PORTAL_COOLDOWN;
    portalCooldownId = dest.id;
    const to = camTargetFor(dest.x, dest.y);
    camScroll.active = true;
    camScroll.fromX = cam.x;
    camScroll.fromY = cam.y;
    camScroll.toX = to.x;
    camScroll.toY = to.y;
    camScroll.t = 0;
    a.phase = 'out';
    a.t = 0;
    return;
  }

  for (let i = 0; i < segments.length; i++) {
    segments[i].vis = Math.max(0, Math.min(1, (a.t - i * TELE_STEP) / TELE_STEP));
  }
  if (a.t >= telePhase() && !camScroll.active) {
    segments.forEach(s => { s.vis = 1; });
    teleportAnim = null;
  }
}

// Two independent guards, both of which must clear: she has to step out of
// the portal she arrived at, and that portal's id also waits out a timer.
// Portals on any other id stay usable throughout.
function updateTeleporters() {
  if (portalCooldown > 0) portalCooldown--;
  if (portalBlocked &&
      Math.hypot(warm.x - portalBlocked.x, warm.y - portalBlocked.y) >= R + portalBlocked.r) {
    portalBlocked = null;
  }
  for (const p of portals) {
    if (p === portalBlocked) continue;
    if (portalCooldown > 0 && p.id === portalCooldownId) continue;
    if (Math.hypot(warm.x - p.x, warm.y - p.y) >= R + p.r) continue;
    // pair up with the next portal sharing this id, wrapping round, so three
    // or more on one id form a ring rather than a broken pair
    const ring = portals.filter(q => q.id === p.id);
    if (ring.length < 2) continue;
    const dest = ring[(ring.indexOf(p) + 1) % ring.length];
    triggerTeleport(p, dest);
    return;
  }
}

function update() {
  easeLight();      // purely visual, so it keeps running through the freezes below

  // between levels, or on winning: freeze everything and just run the
  // transition-banner timer until it hands off to the next level/screen
  if (levelTransition) { updateLevelTransition(); return; }

  // while she's falling apart, freeze everything else and just run the
  // debris animation until it hands off to whatever happens next
  if (deathAnim) { updateDeathAnimation(); return; }

  // while she's travelling between pads, freeze everything else so the
  // part-by-part vanish and reappear read cleanly
  if (teleportAnim) { updateTeleportAnimation(); updateCamera(); return; }

  // while the camera is doing its teleport scroll, freeze everything else
  // so the transition reads as a clean cut rather than jittery movement
  if (camScroll.active) { updateCamera(); return; }

  // gravity
  const tPhysics = perfNow();
  warm.vy += GRAVITY;
  if (warm.vy > MAX_FALL) warm.vy = MAX_FALL;

  // horizontal input
  warm.vx = 0;
  if (leftPressed) warm.vx = -SPEED;
  if (rightPressed) warm.vx = SPEED;
  if (warm.vx !== 0) warm.face = Math.sign(warm.vx);

  if (warm.grounded) jumpsUsed = 0;

  const jumpJustPressed = jumpPressed && !jumpPressedPrev;
  if (jumpJustPressed) {
    if (warm.grounded) {
      warm.vy = JUMP_V;
      jumpsUsed = 1;
      warm.grounded = false;
    } else if (touchingWall !== 0) {
      // wall jump: pushes off the wall and refreshes one air jump
      warm.vy = JUMP_V;
      warm.vx = -touchingWall * WALL_JUMP_PUSH;
      jumpsUsed = 1;
      warm.grounded = false;
      touchingWall = 0;
    } else if (jumpsUsed < MAX_JUMPS) {
      warm.vy = JUMP_V * 0.85; // air jump a touch weaker
      jumpsUsed++;
    }
  }
  jumpPressedPrev = jumpPressed;

  // ducking: shrinks her effective collision size so she can fit under
  // low gaps. Only while grounded — no ducking mid-air.
  isDucking = duckPressed && warm.grounded;
  const R_EFF = isDucking ? R * 0.55 : R;

  // --- horizontal move + collide (only the head collides with tiles) ---
  // While she's actually resting on a ramp surface (feet close to it),
  // skip the ordinary wall check: her y hasn't caught up to the ramp's
  // rising surface yet within this same frame, so treating the plateau
  // ahead as a flat wall would clip her circle and stop her dead right
  // where the ramp meets it. The ramp/vertical-collision code below is
  // what actually places her correctly. Away from any ramp — or merely
  // sharing a column with an unrelated one far above/below — this is
  // false, so the real triangular/rectangular collision below applies.
  const nearRampY = rampUnderfoot(warm.x, warm.y + R);
  const wasOnRamp = nearRampY !== null;
  warm.x += warm.vx;
  // Stepping onto a ramp from adjoining flat ground: her leading edge reaches
  // into the ramp tile a frame before her centre does, and at foot level that
  // tile's solid triangle spans nearly the whole width — so the wall check
  // would stop her dead at the seam.
  const enteringRamp = warm.vx !== 0 &&
    rampUnderfoot(warm.x + Math.sign(warm.vx) * R_EFF, warm.y + R) !== null;
  touchingWall = 0;
  if (!wasOnRamp && !enteringRamp) {
    const topY = warm.y - R_EFF + 2;
    const botY = warm.y + R_EFF - 2;
    const topRow = Math.floor(topY / TILE);
    const botRow = Math.floor(botY / TILE);
    if (warm.vx > 0) {
      const edgeX = warm.x + R_EFF;
      const col = Math.floor(edgeX / TILE);
      for (let r = topRow; r <= botRow; r++) {
        if (blocksHorizontally(col, r, topY, botY, edgeX) && !tryOpenDoor(col, r)) {
          warm.x = col * TILE - R_EFF;
          if (!warm.grounded) touchingWall = 1;
          break;
        }
      }
    } else if (warm.vx < 0) {
      const edgeX = warm.x - R_EFF;
      const col = Math.floor(edgeX / TILE);
      for (let r = topRow; r <= botRow; r++) {
        if (blocksHorizontally(col, r, topY, botY, edgeX) && !tryOpenDoor(col, r)) {
          warm.x = (col + 1) * TILE + R_EFF;
          if (!warm.grounded) touchingWall = -1;
          break;
        }
      }
    }
  }

  // --- vertical move + collide ---
  warm.y += warm.vy;
  warm.grounded = false;
  const leftCol = Math.floor((warm.x - R + 2) / TILE);
  const rightCol = Math.floor((warm.x + R - 2) / TILE);
  if (warm.vy > 0) {
    const row = Math.floor((warm.y + R) / TILE);
    for (let c = leftCol; c <= rightCol; c++) {
      if (solidAt(c, row) && !tryOpenDoor(c, row)) {
        warm.y = row * TILE - R;
        warm.vy = 0;
        warm.grounded = true;
        break;
      }
    }
  } else if (warm.vy < 0) {
    const row = Math.floor((warm.y - R) / TILE);
    for (let c = leftCol; c <= rightCol; c++) {
      if (solidAt(c, row) && !tryOpenDoor(c, row)) { warm.y = (row + 1) * TILE + R; warm.vy = 0; break; }
    }
    // ceiling ramps slope the same way underfoot ramps do, just overhead
    const ceilY = rampOverhead(warm.x, warm.y - R);
    if (ceilY !== null) { warm.y = ceilY + R; warm.vy = 0; }
  }

  // --- ramp support: '/' floor slopes are climbable even though solidAt()
  // says they're not solid. If she's falling/resting and her feet are close
  // to (or below) the ramp's sloped surface at her x, snap her onto it —
  // this is what lets her walk smoothly up and down an incline.
  if (warm.vy >= 0) {
    const rampY = rampUnderfoot(warm.x, warm.y + R);
    if (rampY !== null) {
      warm.y = rampY - R;
      warm.vy = 0;
      warm.grounded = true;
    }
  }

  // fell off the map
  if (warm.y > mapHeightPx + 150) loseLife();

  perfAdd('physics', tPhysics);
  const tObjects = perfNow();
  // Order matters: every platform has to have moved before one can carry her,
  // and she has to be where she ends up before anything reads her position.
  platformTimer++;
  for (const p of movingPlatforms) p.update();
  for (const p of movingPlatforms) p.carry();
  for (const s of rockSpawners) s.update();
  for (const rock of rocks) rock.update();
  if (rocks.length > 40) rocks = rocks.filter(r => r.alive);
  for (const list of [plants, enemies]) for (const e of list) e.update();
  checkEnemyCollisions();
  for (const list of [coins, shieldPickups, keyPickups, lanterns, checkpoints, signs]) for (const e of list) e.update();
  for (const list of [emitters, bursts]) for (const e of list) e.update();
  if (bursts.length) bursts = bursts.filter(b => !b.done);
  updateTeleporters();
  checkFinish();

  perfAdd('objects', tObjects);
  const tBody = perfNow();
  // --- body chain ---
  segments[0].x = warm.x;
  segments[0].y = warm.y;
  segments[0].vy = 0;

  // Each other part falls under its own gravity and lands on the ground/
  // platforms/ramps independently — this is what lets the whole worm settle
  // flat on the ground when idle, instead of clumping up near the head.
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    seg.vy += GRAVITY;
    if (seg.vy > MAX_FALL) seg.vy = MAX_FALL;
    seg.y += seg.vy;

    const row = Math.floor((seg.y + seg.r) / TILE);
    const col = Math.floor(seg.x / TILE);
    if (seg.vy >= 0 && solidAt(col, row) && seg.y + seg.r >= row * TILE) {
      seg.y = row * TILE - seg.r;
      seg.vy = 0;
    }
    if (seg.vy >= 0) {
      const rampY = rampUnderfoot(seg.x, seg.y + seg.r);
      if (rampY !== null) {
        seg.y = rampY - seg.r;
        seg.vy = 0;
      }
    }
  }

  // Distance constraint: no part may end up farther from the part before it
  // than its own radius. Parts are NOT checked against each other for
  // overlap, so the worm can curl up and pass through itself.
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1];
    const cur = segments[i];
    let dx = cur.x - prev.x;
    let dy = cur.y - prev.y;
    let dist = Math.hypot(dx, dy) || 0.0001;
    const maxDist = cur.r;
    if (dist > maxDist) {
      const ratio = maxDist / dist;
      cur.x = prev.x + dx * ratio;
      cur.y = prev.y + dy * ratio;
      cur.vy = 0; // getting tugged by the chain, not falling freely right now
    }
  }

  updateCamera();
  perfAdd('body', tBody);
}

// ---------- Rendering ----------
// The draw routines take the layer to render, so the decorative back and
// front layers reuse them wholesale. Only the middle layer is ever asked
// about collision.

// Every cell the sheet has a row for, whatever its glyph means elsewhere:
// walls, tunnels, ramps, low ceilings and scenery are all just art here. What
// a tile collides as is row_C's business, so a new kind of tile is a sheet
// change rather than another branch.
function drawTileLayer(meta) {
  const firstCol = Math.max(0, Math.floor(cam.x / TILE) - 1);
  const lastCol = Math.min(cols - 1, Math.ceil((cam.x + VIEW_W) / TILE) + 1);
  const firstRow = Math.max(0, Math.floor(cam.y / TILE) - 1);
  const lastRow = Math.min(rows - 1, Math.ceil((cam.y + VIEW_H) / TILE) + 1);

  // A layer showing enough tiles is one WebGL pass (js/tilegl.js), from the
  // camera's whole-pixel position as the loop translated it. That pass costs
  // about the same however many tiles it draws, while a few tiles cost less in
  // 2D — measured, the back and front layers usually lose by going through it.
  if (tileGL.on) {
    let shown = 0;
    for (let r = firstRow; r <= lastRow && shown < TILE_GL_MIN; r++) {
      for (let c = firstCol; c <= lastCol; c++) if (meta.row[r][c] >= 0 && ++shown >= TILE_GL_MIN) break;
    }
    if (shown >= TILE_GL_MIN &&
        drawTileLayerGL(meta, tileset, Math.round(cam.x * PIXEL_X) / PIXEL_X, Math.round(cam.y * PIXEL_Y) / PIXEL_Y)) {
      perfCount('glLayers');
      return;
    }
  }

  // A tile is rarely a whole number of screen pixels, so each edge is put on
  // the nearest one; neighbours then share an edge exactly, and no sky shows
  // through the seam between them.
  const m = ctx.getTransform();
  const snapX = u => (Math.round(m.a * u + m.e) - m.e) / m.a;
  const snapY = u => (Math.round(m.d * u + m.f) - m.f) / m.d;
  for (let r = firstRow; r <= lastRow; r++) {
    const y0 = snapY(r * TILE), y1 = snapY((r + 1) * TILE);
    for (let c = firstCol; c <= lastCol; c++) {
      const sheetRow = meta.row[r][c];
      if (sheetRow < 0) continue;
      const x0 = snapX(c * TILE), x1 = snapX((c + 1) * TILE);
      tileset.drawCell(sheetRow, meta.tint[r][c], x0, y0, x1 - x0, y1 - y0);
      if (perf.on) perf.counts.tiles = (perf.counts.tiles || 0) + 1;
    }
  }
}

// Everything the level spawned, back to front within one layer. A kind of
// thing appears here once; what it looks like is its own draw().
function entityGroups() {
  return [decorations, lockedDoorSpots, portals, checkpoints, finishPoints, signs, movingPlatforms,
          coins, shieldPickups, keyPickups, lanterns, rocks, plants, enemies, emitters, bursts];
}

// One pass per block line, so a thing is drawn with the terrain it was
// written beside. No argument means every layer, for the collision view.
function drawEntities(layer) {
  for (const group of entityGroups()) {
    for (const e of group) if (layer === undefined || e.layer === layer) { e.draw(); if (perf.on) perfCount('drawn'); }
  }
}

// Her ramp runs head-shade to tail-shade; t is how far down the chain we are.
function bodyShade(t) {
  const [first, last] = atlas.partSpan(WORM.sprite, WORM.body) || [0, 0];
  return first + Math.min(last - first, Math.floor(t * (last - first + 1)));
}

// Every body segment's art, scaled once to the size it is drawn at and to the
// screen's own pixels and packed side by side into one image, so a frame
// draws each 1:1 at a whole pixel. It is kept as an Image rather than the
// canvas it is painted on: measured in Chrome, drawing from a canvas (or an
// ImageBitmap) costs twice what the scaled original did, from an Image a
// third less. Rebuilt when her shape, the sheet or the screen scale changes;
// null — so she is drawn the old way — until the sheet has loaded and the
// image decoded.
let segmentAtlas = null;    // { img, ready, key, sheet, arts: [{ sx, sw, sh, w, h, ax, ay }] by segment }
function ensureSegmentAtlas(last) {
  const sheet = atlas.sheet, d = atlas.def(WORM.sprite);
  if (!d.frame || !sheet || !sheet.complete || !sheet.naturalWidth) return null;
  const key = [WORM.sprite, PIXEL_X, last, R, TAIL_SCALE, sheet.src].join('|');
  if (segmentAtlas && segmentAtlas.key === key && segmentAtlas.sheet === sheet) return segmentAtlas.ready ? segmentAtlas : null;
  const f = d.frame, arts = [];
  let x = 0, hMax = 1;
  for (let i = 1; i < last; i++) {
    const k = segments[i].r / R, s = (d.scale || 1) * k * PIXEL_X;
    const sw = Math.max(1, Math.round(f.w * s)), sh = Math.max(1, Math.round(f.h * s));
    arts[i] = { frame: bodyShade(i / last), sx: x, sw, sh, w: sw / PIXEL_X, h: sh / PIXEL_X, ax: d.anchor[0] * k, ay: d.anchor[1] * k };
    x += sw + 1;
    hMax = Math.max(hMax, sh);
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, x);
  canvas.height = hMax;
  const g = canvas.getContext('2d');
  g.imageSmoothingQuality = 'high';
  for (const a of arts) if (a) g.drawImage(sheet, f.x + (a.frame % d.frames) * f.w, f.y, f.w, f.h, a.sx, 0, a.sw, a.sh);
  const img = new Image();
  const built = { img, ready: false, key, sheet, arts };
  img.onload = () => { built.ready = true; };
  img.src = canvas.toDataURL();
  segmentAtlas = built;
  return null;
}

// Her parts are drawn at the head's radius, so each segment scales to its own.
function drawWorm() {
  const parts = atlas.def(WORM.sprite).parts;
  if (!parts) return; // the loop runs before the manifest lands
  const last = segments.length - 1;
  const packed = ensureSegmentAtlas(last);
  const snap = v => Math.round(v * PIXEL_X) / PIXEL_X;   // the camera already sits on a whole pixel
  for (let i = last; i >= 1; i--) {
    const p = segments[i];
    const vis = p.vis ?? 1;
    if (vis <= 0) continue;
    // a whole body segment, the usual case, from its pre-scaled art; the tail
    // turns and a fading segment changes size, so those are drawn as before
    const a = vis === 1 && packed ? packed.arts[i] : null;
    if (a) {
      ctx.drawImage(packed.img, a.sx, 0, a.sw, a.sh, snap(p.x - a.ax), snap(p.y - a.ay), a.w, a.h);
      continue;
    }
    ctx.save();
    ctx.globalAlpha = vis;
    ctx.translate(p.x, p.y);
    ctx.scale((p.r / R) * vis, (p.r / R) * vis);
    if (i === last) {
      const prev = segments[i - 1];
      ctx.rotate(Math.atan2(p.y - prev.y, p.x - prev.x)); // tip trails the body
      atlas.draw(WORM.sprite, 0, 0, atlas.partFrame(WORM.sprite, WORM.tail) ?? 0);
    } else {
      atlas.draw(WORM.sprite, 0, 0, bodyShade(i / last));
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // head
  const head = segments[0];
  const headVis = head.vis ?? 1;
  if (headVis <= 0) return;
  const squish = isDucking ? 0.6 : 1;

  // the shield's worn sprite if it has one, or a plain ring behind her
  const worn = hasShield ? shieldWorn : null;
  if (hasShield && !worn) {
    ctx.beginPath();
    ctx.arc(head.x, head.y, head.r + 5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(111,227,255,0.8)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  ctx.save();
  ctx.globalAlpha = headVis;
  ctx.translate(head.x, head.y + head.r * (1 - squish));
  // facing is a frame, so the head keeps the last direction while standing
  // still; without a left one, the right one turned round
  const left = warm.face < 0 ? atlas.partFrame(WORM.sprite, WORM.headLeft) : null;
  const turn = warm.face < 0 && left === null ? -1 : 1;
  ctx.scale(headVis * turn, squish * headVis);
  atlas.draw(WORM.sprite, 0, 0, left ?? atlas.partFrame(WORM.sprite, WORM.head) ?? 0);
  ctx.restore();

  // worn art goes over her head, centred on it by its own pivot, playing on
  // its own clock: art the size of the head would vanish behind it
  if (worn) {
    ctx.save();
    ctx.globalAlpha = headVis;
    atlas.draw(worn, head.x, head.y, atlas.frame(worn));
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

// ---------- Debug: collision-shape view ----------
// Draws the *actual* collision geometry instead of the normal art, straight
// from the same grid the collision code reads, so it's easy to verify a
// sheet's row_C says what you meant.
let debugCollisionView = false;
function drawCollisionDebug() {
  // what each class shows of itself in this view: a platform its run
  for (const p of movingPlatforms) if (p.guide) Platform.drawGuide(ctx, { mode: 'debug', ...p.guide, px: PIXEL_X });

  const firstCol = Math.max(0, Math.floor(cam.x / TILE) - 1);
  const lastCol = Math.min(cols - 1, Math.ceil((cam.x + VIEW_W) / TILE) + 1);
  const firstRow = Math.max(0, Math.floor(cam.y / TILE) - 1);
  const lastRow = Math.min(rows - 1, Math.ceil((cam.y + VIEW_H) / TILE) + 1);

  ctx.fillStyle = 'rgba(255,80,80,0.55)';
  ctx.strokeStyle = 'rgba(255,120,120,0.9)';
  ctx.lineWidth = 1;
  for (let r = firstRow; r <= lastRow; r++) {
    for (let c = firstCol; c <= lastCol; c++) {
      const hit = collideGrid[r][c];
      const x = c * TILE, y = r * TILE;
      if (hit === HIT_SOLID) {
        ctx.fillRect(x, y, TILE, TILE);
        ctx.strokeRect(x, y, TILE, TILE);
      } else if (hit === HIT_HALF) {
        ctx.fillRect(x, y, TILE, TILE / 2);
        ctx.strokeRect(x, y, TILE, TILE / 2);
      } else if (isRampHit(hit)) {
        // same four corner wedges rampSolid() tests against
        const corners = [
          [[TILE, 0], [TILE, TILE], [0, TILE]],
          [[0, 0], [0, TILE], [TILE, TILE]],
          [[0, 0], [TILE, 0], [TILE, TILE]],
          [[0, 0], [TILE, 0], [0, TILE]]
        ][+hit];
        ctx.beginPath();
        ctx.moveTo(x + corners[0][0], y + corners[0][1]);
        ctx.lineTo(x + corners[1][0], y + corners[1][1]);
        ctx.lineTo(x + corners[2][0], y + corners[2][1]);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  // faint grid lines for orientation
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let c = firstCol; c <= lastCol + 1; c++) {
    ctx.beginPath(); ctx.moveTo(c * TILE, firstRow * TILE); ctx.lineTo(c * TILE, (lastRow + 1) * TILE); ctx.stroke();
  }
  for (let r = firstRow; r <= lastRow + 1; r++) {
    ctx.beginPath(); ctx.moveTo(firstCol * TILE, r * TILE); ctx.lineTo((lastCol + 1) * TILE, r * TILE); ctx.stroke();
  }

  // Each entity names its own colour and shape, so nothing here has to know
  // what kinds exist.
  ctx.lineWidth = 2;
  for (const group of entityGroups()) {
    for (const e of group) {
      const shape = e.debugShape();
      if (!shape || shape.skip) continue;
      ctx.strokeStyle = shape.stroke;
      if (shape.box) {
        ctx.fillStyle = shape.fill;
        ctx.fillRect(e.x, e.y, e.w, e.h);
        ctx.strokeRect(e.x, e.y, e.w, e.h);
      } else {
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  ctx.strokeStyle = '#5cf0ff';
  const dR = isDucking ? R * 0.55 : R;
  ctx.beginPath(); ctx.arc(warm.x, warm.y, dR, 0, Math.PI * 2); ctx.stroke();
}
// refreshes at (60Hz, 90Hz, 120Hz...), but the physics/game logic in
// update() always advances in fixed 1/60s steps. Without this, the game
// would visibly run faster on high-refresh-rate phones, since
// requestAnimationFrame — and therefore update() — would fire more often
// per real second on those screens.
const FIXED_STEP_MS = 1000 / 60;
let lastFrameTime = null;
let stepAccumulator = 0;
const MAX_STEPS_PER_FRAME = 5; // avoid a death-spiral after a long tab-switch pause

function loop(now) {
  if (lastFrameTime === null) lastFrameTime = now;
  let delta = now - lastFrameTime;
  lastFrameTime = now;
  if (delta > 250) delta = 250; // clamp huge gaps (backgrounded tab, etc.)
  if (gameState === 'playing') atlas.clock += delta / 1000;
  stepAccumulator += delta;

  const tFrame = perfNow();
  let steps = 0;
  while (stepAccumulator >= FIXED_STEP_MS && steps < MAX_STEPS_PER_FRAME) {
    if (gameState === 'playing') update();
    stepAccumulator -= FIXED_STEP_MS;
    steps++;
  }
  perfAdd('update', tFrame);
  if (perf.on) {
    perfCount('steps', steps);
    perfCount('objects', entityGroups().reduce((n, g) => n + g.length, 0));
  }

  const tDraw = perfNow();
  ctx.setTransform(PIXEL_X, 0, 0, PIXEL_Y, 0, 0);   // game units from here on
  let t = perfNow();
  drawBackground();
  perfAdd('background', t);
  // each stage timed on its own; perfAdd is a no-op while timing is off
  const timed = (stage, fn) => { const t0 = perfNow(); fn(); perfAdd(stage, t0); };
  ctx.save();
  // the camera on a whole screen pixel, so the art isn't resampled between two
  ctx.translate(-Math.round(cam.x * PIXEL_X) / PIXEL_X, -Math.round(cam.y * PIXEL_Y) / PIXEL_Y);
  if (debugCollisionView) {
    // Objects stay, the tile layers don't — terrain is what the red overlay is
    // describing, so drawing it twice only makes the shapes harder to read.
    ctx.fillStyle = '#14101c';
    ctx.fillRect(cam.x, cam.y, VIEW_W, VIEW_H);
    drawEntities();
    if (deathAnim) drawDeathAnimation(); else drawWorm();
    drawCollisionDebug();
  } else {
    if (backMeta) timed('tilesBack', () => drawTileLayer(backMeta));
    timed('entities', () => drawEntities(LAYER_BACK));
    timed('tilesMain', () => drawTileLayer(gridMeta));
    timed('entities', () => drawEntities(LAYER_MAIN));
    timed('worm', () => { if (deathAnim) drawDeathAnimation(); else drawWorm(); });
    if (frontMeta) timed('tilesFront', () => drawTileLayer(frontMeta));
    timed('entities', () => drawEntities(LAYER_FRONT));
  }
  ctx.restore();
  t = perfNow();
  drawDarkness();
  perfAdd('dark', t);
  perfAdd('draw', tDraw);
  perfAdd('frame', tFrame);
  perfFrame(now);
  drawPerf();
  requestAnimationFrame(loop);
}

// ---------- Input: keyboard ----------
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') leftPressed = true;
  if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') rightPressed = true;
  if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W' || e.key === ' ') jumpPressed = true;
  if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') duckPressed = true;
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') leftPressed = false;
  if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') rightPressed = false;
  if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W' || e.key === ' ') jumpPressed = false;
  if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') duckPressed = false;
});

// ---------- Input: touch/mouse buttons ----------
function bindHold(el, onDown, onUp) {
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); onDown(); });
  el.addEventListener('pointerup', (e) => { e.preventDefault(); onUp(); });
  el.addEventListener('pointerleave', () => onUp());
  el.addEventListener('pointercancel', () => onUp());
}

// Joystick: the knob follows your finger within the base (clamped to a max
// radius), and direction is read from which side of center it's sitting on.
// Sliding smoothly between left and right just works, since it's one
// continuous drag rather than separate buttons.
const joystickBase = document.getElementById('joystickBase');
const joystickKnob = document.getElementById('joystickKnob');
let joyPointerId = null;
const JOY_DEADZONE = 2; // px of knob travel before it counts as a direction

function updateJoystick(clientX, clientY) {
  const rect = joystickBase.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let dx = clientX - cx;
  let dy = clientY - cy;
  const dist = Math.hypot(dx, dy);
  const maxDist = rect.width / 2 - joystickKnob.offsetWidth / 2;
  if (dist > maxDist) {
    const scale = maxDist / dist;
    dx *= scale;
    dy *= scale;
  }
  joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;

  if (dx < -JOY_DEADZONE) { leftPressed = true; rightPressed = false; }
  else if (dx > JOY_DEADZONE) { rightPressed = true; leftPressed = false; }
  else { leftPressed = false; rightPressed = false; }

  duckPressed = dy > 22; // pushing the stick down ducks her
}

function resetJoystick() {
  joystickKnob.classList.remove('dragging');
  joystickKnob.style.transform = 'translate(0, 0)';
  leftPressed = false;
  rightPressed = false;
  duckPressed = false;
}

joystickBase.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  joyPointerId = e.pointerId;
  joystickBase.setPointerCapture(e.pointerId);
  joystickKnob.classList.add('dragging');
  updateJoystick(e.clientX, e.clientY);
});
joystickBase.addEventListener('pointermove', (e) => {
  if (e.pointerId !== joyPointerId) return;
  updateJoystick(e.clientX, e.clientY);
});
function endJoystickDrag(e) {
  if (e.pointerId !== joyPointerId) return;
  joyPointerId = null;
  resetJoystick();
}
joystickBase.addEventListener('pointerup', endJoystickDrag);
joystickBase.addEventListener('pointercancel', endJoystickDrag);

bindHold(document.getElementById('jumpBtn'), () => jumpPressed = true, () => jumpPressed = false);

// ---------- Sound settings (persisted) ----------
// The board does the audio; this is the part that remembers the choices.
let musicEnabled = true;
let effectsEnabled = true;
let musicVolume = 0.16;
let effectsVolume = 1.0;
let debugEnabled = false;
try {
  const savedMusic = localStorage.getItem('warmWormMusicEnabled');
  const savedFx = localStorage.getItem('warmWormEffectsEnabled');
  const savedMV = localStorage.getItem('warmWormMusicVolume');
  const savedEV = localStorage.getItem('warmWormEffectsVolume');
  const savedDebug = localStorage.getItem('warmWormDebug');
  if (savedMusic !== null) musicEnabled = savedMusic === 'true';
  if (savedFx !== null) effectsEnabled = savedFx === 'true';
  if (savedMV !== null) musicVolume = parseFloat(savedMV);
  if (savedEV !== null) effectsVolume = parseFloat(savedEV);
  if (savedDebug !== null) debugEnabled = savedDebug === 'true';
} catch (e) { /* ignore */ }
// ?debug=1 — the level editor's Test asks for it — turns Debug on for this
// visit only, leaving the player's own setting as it was saved
if (new URLSearchParams(location.search).get('debug') === '1') debugEnabled = true;
sound.musicOn = musicEnabled;
sound.effectsOn = effectsEnabled;
sound.setMusicVolume(musicVolume);
sound.setEffectsVolume(effectsVolume);

function remember(key, value) {
  try { localStorage.setItem(key, String(value)); } catch (e) { /* ignore */ }
}

function setMusicEnabled(on) {
  musicEnabled = on;
  remember('warmWormMusicEnabled', on);
  sound.setMusic(on);
}
function setEffectsEnabled(on) {
  effectsEnabled = on;
  remember('warmWormEffectsEnabled', on);
  sound.setEffects(on);
}
function setMusicVolume(v) {
  musicVolume = v;
  remember('warmWormMusicVolume', v);
  sound.setMusicVolume(v);
}
function setEffectsVolume(v) {
  effectsVolume = v;
  remember('warmWormEffectsVolume', v);
  sound.setEffectsVolume(v);
}

// browsers require a real user gesture before audio can play — this primes
// it the first time she taps or presses anything
function unlockAudioOnce() {
  sound.resume();
  sound.startMusic();
  window.removeEventListener('keydown', unlockAudioOnce);
  window.removeEventListener('pointerdown', unlockAudioOnce);
}
window.addEventListener('keydown', unlockAudioOnce);
window.addEventListener('pointerdown', unlockAudioOnce);

// ---------- Start / game-over screen buttons ----------
document.getElementById('playBtn').addEventListener('click', () => {
  sound.resume();
  sound.startMusic();
  startCampaign();
});
document.getElementById('againBtn').addEventListener('click', () => {
  sound.resume();
  sound.startMusic();
  startCampaign();
});
document.getElementById('winAgainBtn').addEventListener('click', () => {
  sound.resume();
  sound.startMusic();
  winScreen.classList.add('hidden');
  startCampaign();
});

const pauseScreen = document.getElementById('pauseScreen');
const pauseMainButtons = document.getElementById('pauseMainButtons');
const pauseConfirm = document.getElementById('pauseConfirm');

document.getElementById('pauseBtn').addEventListener('click', () => {
  if (gameState !== 'playing') return;
  gameState = 'paused';
  pauseMainButtons.classList.remove('hidden');
  pauseConfirm.classList.add('hidden');
  pauseScreen.classList.remove('hidden');
});
document.getElementById('resumeBtn').addEventListener('click', () => {
  pauseScreen.classList.add('hidden');
  gameState = 'playing';
});
document.getElementById('restartBtn').addEventListener('click', () => {
  pauseMainButtons.classList.add('hidden');
  pauseConfirm.classList.remove('hidden');
});
document.getElementById('confirmMenuYes').addEventListener('click', () => {
  pauseScreen.classList.add('hidden');
  gameState = 'start';
  refreshStarsSummary();
  goToScreen(startScreen2);
});
document.getElementById('confirmMenuNo').addEventListener('click', () => {
  pauseConfirm.classList.add('hidden');
  pauseMainButtons.classList.remove('hidden');
});

const startScreen2 = startScreen; // alias for clarity below
const hiscoreScreen = document.getElementById('hiscoreScreen');
const customLevelScreen = document.getElementById('customLevelScreen');
const optionsScreen = document.getElementById('optionsScreen');
const achievementsScreen = document.getElementById('achievementsScreen');

function goToScreen(screen) {
  document.documentElement.classList.remove('play-run');   // a menu shown on purpose: the menu again
  [startScreen2, hiscoreScreen, customLevelScreen, optionsScreen, achievementsScreen].forEach(s => s.classList.add('hidden'));
  screen.classList.remove('hidden');
}

document.querySelectorAll('.backBtn').forEach(btn => {
  btn.addEventListener('click', () => {
    goToScreen(document.getElementById(btn.dataset.backTo));
  });
});

const customLevelInput = document.getElementById('customLevelInput');
const customLevelMsg = document.getElementById('customLevelMsg');

const achievementsList = document.getElementById('achievementsList');
function renderAchievementsList() {
  achievementsList.innerHTML = ACHIEVEMENT_LIST.map(a => {
    const unlocked = !!achievements[a.key];
    return '<div class="achievementRow' + (unlocked ? ' unlocked' : '') + '">' +
      '<span class="achievementIcon">' + (unlocked ? '🏆' : '🔒') + '</span>' +
      '<span class="achievementText"><b>' + escapeHtml(a.title) + '</b><br>' + escapeHtml(a.desc) + '</span>' +
      '</div>';
  }).join('');
}
document.getElementById('achievementsBtn').addEventListener('click', () => {
  renderAchievementsList();
  goToScreen(achievementsScreen);
});

const starsSummary = document.getElementById('starsSummary');
function refreshStarsSummary() {
  const total = levelStars.reduce((a, b) => a + b, 0);
  starsSummary.textContent = total > 0 ? ('⭐ Stars: ' + total + ' / ' + (BUILTIN_LEVELS.length * 3)) : '';
}

// Object definitions, the sound set and campaign levels all come off disk, so
// Play stays disabled until they land.
const playBtn = document.getElementById('playBtn');
const levelLoadMsg = document.getElementById('levelLoadMsg');
playBtn.disabled = true;
playBtn.textContent = '⏳ Loading levels…';
Promise.all([atlas.loadRoot(), sound.loadRoot()]).then(loadBuiltinLevels).then(() => {
  fitLevelStars(BUILTIN_LEVELS.length);
  playBtn.disabled = false;
  playBtn.textContent = '▶ Play';
  refreshStarsSummary();
  // every way into another browser's pack, looked for while the menu is up
  for (const level of BUILTIN_LEVELS) for (const link of level.links || []) if (link) linkState(link);
  // come through a flag from another pack (?play): straight into level one.
  // (wtw:play — the mark a pack's page is looked for by, to know it can.)
  // Sound waits for her first key or touch, as browsers want.
  if (new URLSearchParams(location.search).has('play')) {
    const wake = () => { sound.resume(); removeEventListener('keydown', wake); removeEventListener('pointerdown', wake); };
    addEventListener('keydown', wake);
    addEventListener('pointerdown', wake);
    sound.resume();
    sound.startMusic();
    startCampaign();
  }
}).catch(err => {
  console.error('game data load failed:', err);
  document.documentElement.classList.remove('play-run');
  playBtn.textContent = '⚠ Game data unavailable';
  levelLoadMsg.textContent = location.protocol === 'file:'
    ? 'Objects and levels load from the assets folder, which browsers block over file://. Serve this folder over http — e.g. "python -m http.server" — and open it from there.'
    : 'Could not load game data: ' + err.message;
  levelLoadMsg.classList.remove('hidden');
});

// ---------- Share ----------
// A level pack served from this site — one in levelpacks/, or one kept in the
// browser under /__idb/levels/<name>/ — can be handed to a friend through
// share/, which gives its link: the browser answers the friend while any of
// its pages is open, this one included. A game opened any other way (an unzipped
// folder, a host without share/) shows no button.
(async () => {
  const pack = new URL(ROOT_PACK_URL, location.href);
  if (pack.origin !== location.origin) return;
  let key = null, m;
  if ((m = /^\/__idb\/levels\/([^/]+)\//.exec(pack.pathname))) key = 'idb:' + decodeURIComponent(m[1]);
  else if ((m = /^\/levelpacks\/([^/]+)\//.exec(pack.pathname))) key = decodeURIComponent(m[1]);
  if (!key) return;
  try {
    const res = await fetch('/share/index.html', { method: 'HEAD', cache: 'no-store' });
    if (!res.ok) return;
  } catch (err) { return; }
  const btn = document.getElementById('shareBtn');
  btn.classList.remove('hidden');
  btn.addEventListener('click', () => window.open(`/share/?pack=${encodeURIComponent(key)}`, 'wtw-share'));
})();

document.getElementById('customLevelBtn').addEventListener('click', () => {
  goToScreen(customLevelScreen);
});

document.getElementById('playCustomBtn').addEventListener('click', () => {
  sound.resume();
  sound.startMusic();
  const result = loadCustomLevel(customLevelInput.value);
  if (!result.ok) {
    customLevelMsg.textContent = result.error;
    return;
  }
  customLevelMsg.textContent = '';
  startGame();
});

const musicToggleBtn = document.getElementById('musicToggleBtn');
const effectsToggleBtn = document.getElementById('effectsToggleBtn');
const musicVolumeSlider = document.getElementById('musicVolumeSlider');
const effectsVolumeSlider = document.getElementById('effectsVolumeSlider');
const debugToggleBtn = document.getElementById('debugToggleBtn');
const debugBtn = document.getElementById('debugBtn');
const perfBtn = document.getElementById('perfBtn');

function setToggle(btn, on) {
  btn.textContent = on ? 'ON' : 'OFF';
  btn.classList.toggle('off', !on);
}

function refreshToggleButtons() {
  setToggle(musicToggleBtn, musicEnabled);
  setToggle(effectsToggleBtn, effectsEnabled);
  setToggle(debugToggleBtn, debugEnabled);
  debugBtn.classList.toggle('hidden', !debugEnabled);
  debugBtn.classList.toggle('on', debugCollisionView);
  perfBtn.classList.toggle('hidden', !debugEnabled && !perf.on);
  perfBtn.classList.toggle('on', perf.on);
}
refreshToggleButtons();
musicVolumeSlider.value = Math.round(musicVolume * 100);
effectsVolumeSlider.value = Math.round(effectsVolume * 100);

document.getElementById('optionsBtn').addEventListener('click', () => {
  goToScreen(optionsScreen);
});
musicToggleBtn.addEventListener('click', () => {
  sound.resume();
  setMusicEnabled(!musicEnabled);
  refreshToggleButtons();
});
effectsToggleBtn.addEventListener('click', () => {
  sound.resume();
  setEffectsEnabled(!effectsEnabled);
  refreshToggleButtons();
  playSound('coin'); // quick sample so the toggle feels responsive
});
musicVolumeSlider.addEventListener('input', () => {
  setMusicVolume(musicVolumeSlider.value / 100);
});
effectsVolumeSlider.addEventListener('input', () => {
  sound.resume();
  setEffectsVolume(effectsVolumeSlider.value / 100);
});
effectsVolumeSlider.addEventListener('change', () => {
  playSound('coin'); // sample at the chosen volume once they release the slider
});
debugToggleBtn.addEventListener('click', () => {
  debugEnabled = !debugEnabled;
  try { localStorage.setItem('warmWormDebug', String(debugEnabled)); } catch (e) { /* ignore */ }
  if (!debugEnabled) { debugCollisionView = false; setPerf(false); } // nothing stays on once it's out of reach
  refreshToggleButtons();
});
debugBtn.addEventListener('click', () => {
  debugCollisionView = !debugCollisionView;
  refreshToggleButtons();
});
perfBtn.addEventListener('click', () => {
  setPerf(!perf.on);
  refreshToggleButtons();
});
// F2 opens and closes the panel whether or not Debug is on in Options; F3
// switches the tiles between one WebGL pass and the 2D path, to compare them
window.addEventListener('keydown', e => {
  if (e.repeat) return;
  if (e.key === 'F2') { e.preventDefault(); setPerf(!perf.on); refreshToggleButtons(); }
  if (e.key === 'F3') { e.preventDefault(); tileGL.on = !tileGL.on; }
});

const MEDALS = ['🥇', '🥈', '🥉'];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

async function showTopScores(displayEl) {
  displayEl.innerHTML = '<div class="hiscoreLoading">Loading…</div>';
  const top = await fetchTopScores();
  if (top && top.length > 0) {
    const rows = top.map((row, i) => {
      const medal = MEDALS[i] || ('#' + (i + 1));
      const name = escapeHtml(row.name || 'Player');
      return '<div class="hiscoreRow">' +
               '<span class="hiscoreRank"><span class="hiscoreMedal">' + medal + '</span>' + name + '</span>' +
               '<span class="hiscoreScore">' + row.score + '</span>' +
             '</div>';
    }).join('');
    displayEl.innerHTML =
      '<div class="hiscoreCard"><div class="hiscoreTitle">🏆 Global Top 5</div>' + rows + '</div>';
  } else {
    displayEl.innerHTML =
      '<div class="hiscoreCard"><div class="hiscoreTitle">🏆 High Score</div>' +
      '<div class="hiscoreFallback">Best on this device: ' + getHighScore() + '</div></div>';
  }
}
document.getElementById('hiscoreBtn').addEventListener('click', () => {
  goToScreen(hiscoreScreen);
  showTopScores(hiscoreLine);
});
document.getElementById('hiscoreBtnGameOver').addEventListener('click', () => showTopScores(hiscoreLineGameOver));
document.getElementById('hiscoreBtnWin').addEventListener('click', () => showTopScores(hiscoreLineWin));

requestAnimationFrame(loop);
