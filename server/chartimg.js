// Chart screenshot for the Telegram alerts: candles around the event, the POI box, the trade plan lines and an event marker,
// drawn as a PNG with no npm packages (own rasteriser, own 5x7 font, zlib for the PNG). Used by notify() in app.js.
import { deflateSync, crc32 } from 'node:zlib';

// ---------------------------------------------------------------- 5x7 font (upper case, digits and a few signs)
const G = (...rows) => rows;
const FONT = {
  A: G('.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'), B: G('####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'),
  C: G('.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'), D: G('####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'),
  E: G('#####', '#....', '#....', '####.', '#....', '#....', '#####'), F: G('#####', '#....', '#....', '####.', '#....', '#....', '#....'),
  G: G('.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'), H: G('#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'),
  I: G('.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'), J: G('..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'),
  K: G('#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'), L: G('#....', '#....', '#....', '#....', '#....', '#....', '#####'),
  M: G('#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'), N: G('#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'),
  O: G('.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'), P: G('####.', '#...#', '#...#', '####.', '#....', '#....', '#....'),
  Q: G('.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'), R: G('####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'),
  S: G('.####', '#....', '#....', '.###.', '....#', '....#', '####.'), T: G('#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'),
  U: G('#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'), V: G('#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'),
  W: G('#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'), X: G('#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'),
  Y: G('#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'), Z: G('#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'),
  0: G('.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'), 1: G('..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'),
  2: G('.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'), 3: G('####.', '....#', '....#', '.###.', '....#', '....#', '####.'),
  4: G('...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'), 5: G('#####', '#....', '####.', '....#', '....#', '#...#', '.###.'),
  6: G('.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'), 7: G('#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'),
  8: G('.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'), 9: G('.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'),
  '.': G('.....', '.....', '.....', '.....', '.....', '.....', '..#..'), '-': G('.....', '.....', '.....', '#####', '.....', '.....', '.....'),
  ':': G('.....', '..#..', '.....', '.....', '.....', '..#..', '.....'), '/': G('....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'),
  '%': G('##..#', '##..#', '...#.', '..#..', '.#...', '#..##', '#..##'), '(': G('...#.', '..#..', '.#...', '.#...', '.#...', '..#..', '...#.'),
  ')': G('.#...', '..#..', '...#.', '...#.', '...#.', '..#..', '.#...'), ' ': G('.....', '.....', '.....', '.....', '.....', '.....', '.....'),
};
const WATERMARK = 'B-JEFF';
const textWidth = (s, k) => Math.max(0, String(s).length * 6 * k - k);

// ---------------------------------------------------------------- tiny raster
const SS = 2;                                       // shapes are drawn at 2x and averaged down (smooth edges), text is drawn after at 1x
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const C = { bg: hex('#000000'), grid: hex('#2A2E39'), text: hex('#787B86'), bright: hex('#D1D4DC'), up: hex('#089981'), dn: hex('#F23645'),
  gold: hex('#E3C16A'), blue: hex('#59A7FF'), white: hex('#FFFFFF'), axis: hex('#B2B5BE') };

class Canvas {
  constructor(w, h) { this.w = w; this.h = h; this.W = w * SS; this.H = h * SS; this.px = new Uint8Array(this.W * this.H * 3); this.fill(C.bg); }
  fill(c) { for (let i = 0; i < this.px.length; i += 3) { this.px[i] = c[0]; this.px[i + 1] = c[1]; this.px[i + 2] = c[2]; } }
  rect(x0, y0, x1, y1, c, a = 1) {                  // coordinates in final pixels (may be fractional)
    const X0 = Math.max(0, Math.round(Math.min(x0, x1) * SS)), X1 = Math.min(this.W, Math.round(Math.max(x0, x1) * SS));
    const Y0 = Math.max(0, Math.round(Math.min(y0, y1) * SS)), Y1 = Math.min(this.H, Math.round(Math.max(y0, y1) * SS));
    for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
      const i = (y * this.W + x) * 3;
      this.px[i] += (c[0] - this.px[i]) * a; this.px[i + 1] += (c[1] - this.px[i + 1]) * a; this.px[i + 2] += (c[2] - this.px[i + 2]) * a;
    }
  }
  hline(y, x0, x1, c, a = 1, th = 1, dash = 0) {
    if (!dash) return this.rect(x0, y - th / 2, x1, y + th / 2, c, a);
    for (let x = x0; x < x1; x += dash * 2) this.rect(x, y - th / 2, Math.min(x + dash, x1), y + th / 2, c, a);
  }
  vline(x, y0, y1, c, a = 1, th = 1, dash = 0) {
    if (!dash) return this.rect(x - th / 2, y0, x + th / 2, y1, c, a);
    for (let y = y0; y < y1; y += dash * 2) this.rect(x - th / 2, y, x + th / 2, Math.min(y + dash, y1), c, a);
  }
  triangle(cx, cy, size, up, c) {                   // arrow head: tip at (cx, cy), pointing up or down
    for (let r = 0; r < size * SS; r++) {
      const half = (r / (size * SS)) * size * 0.75 * SS, y = up ? cy * SS + r : cy * SS - r - 1;
      const X0 = Math.round(cx * SS - half), X1 = Math.round(cx * SS + half) + 1, Y = Math.round(y);
      if (Y < 0 || Y >= this.H) continue;
      for (let x = Math.max(0, X0); x < Math.min(this.W, X1); x++) { const i = (Y * this.W + x) * 3; this.px[i] = c[0]; this.px[i + 1] = c[1]; this.px[i + 2] = c[2]; }
    }
  }
  // downsample to the final RGB image
  finish() {
    const out = new Uint8Array(this.w * this.h * 3), n = SS * SS;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) for (let ch = 0; ch < 3; ch++) {
      let s = 0;
      for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) s += this.px[((y * SS + dy) * this.W + x * SS + dx) * 3 + ch];
      out[(y * this.w + x) * 3 + ch] = Math.round(s / n);
    }
    this.out = out;
  }
  // Watermark: big, faint block letters behind the candles, drawn at the 2x stage so it is smooth. Centred in the plot area.
  watermark(s, cx, cy, k, c, a) {
    const w = textWidth(s, k), x0 = cx - w / 2, y0 = cy - (7 * k) / 2;
    let x = x0;
    for (const ch of String(s).toUpperCase()) {
      const g = FONT[ch] || FONT[' '];
      for (let r = 0; r < 7; r++) for (let q = 0; q < 5; q++) if (g[r][q] === '#') this.rect(x + q * k, y0 + r * k, x + (q + 1) * k, y0 + (r + 1) * k, c, a);
      x += 6 * k;
    }
  }
  dot(x, y, c) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) { const i = (y * this.w + x) * 3; this.out[i] = c[0]; this.out[i + 1] = c[1]; this.out[i + 2] = c[2]; } }
  box(x0, y0, x1, y1, c) { for (let y = Math.max(0, y0); y < Math.min(this.h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(this.w, x1); x++) this.dot(x, y, c); }
  text(s, x, y, k, c) {                             // 1x text on the finished image; k = pixel size of one font dot
    let cx = Math.round(x);
    for (const ch of String(s).toUpperCase()) {
      const g = FONT[ch] || FONT[' '];
      for (let r = 0; r < 7; r++) for (let q = 0; q < 5; q++) if (g[r][q] === '#') this.box(cx + q * k, Math.round(y) + r * k, cx + (q + 1) * k, Math.round(y) + (r + 1) * k, c);
      cx += 6 * k;
    }
  }
}

function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- the chart
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const p2 = (n) => String(n).padStart(2, '0');
function stamp(t, tf) {
  const d = new Date(t * 1000), hm = `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
  return tf >= 3600 ? `${p2(d.getUTCDate())} ${MON[d.getUTCMonth()]} ${hm}` : hm;
}
// "Nice" price steps for the grid: 1, 2 or 5 times a power of ten.
function niceStep(range, target) {
  const raw = range / target, pow = 10 ** Math.floor(Math.log10(raw)), m = raw / pow;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * pow;
}

// snap = { candles: [{t,o,h,l,c}], tf (seconds), tfName, t (event time, candle close), dir, symbol, label (e.g. "BEARISH KEY LEVEL"),
//          digits, box: { lo, hi, t0, label }, lines: [{ y, label, tone }] }
// Returns a PNG Buffer, or null when there is nothing to draw.
export function renderChart(snap, { width = 1280, height = 720 } = {}) {
  // 1280 x 720 is Telegram's own display size for a photo, so the picture is not resampled (that is what made it soft). Text is big
  // (KA / KH font dots) because the picture is read on a phone, where it is shown about 3x smaller than its pixels.
  const all = (snap && snap.candles) || [];
  if (all.length < 5) return null;
  const KA = 3, KH = 4, GAPY = 6, z = width / 1000;
  const tf = snap.tf, evIdx = Math.max(0, all.findLastIndex((c) => c.t <= snap.t - tf));
  const end = Math.min(all.length - 1, evIdx + 12), start = Math.max(0, end - 59), cs = all.slice(start, end + 1), n = cs.length;   // 60 candles: big, readable bodies
  const dg = snap.digits ?? 3, dir = snap.dir || 0, tone = dir === 1 ? C.up : dir === -1 ? C.dn : C.white;

  let lo = Math.min(...cs.map((c) => c.l)), hi = Math.max(...cs.map((c) => c.h));
  const box = snap.box && Number.isFinite(snap.box.lo) && Number.isFinite(snap.box.hi) ? snap.box : null;
  const span = hi - lo || 1;
  if (box) { lo = Math.min(lo, Math.max(box.lo, lo - span * 0.6)); hi = Math.max(hi, Math.min(box.hi, hi + span * 0.6)); }   // a far away box does not squash the candles
  const pad = (hi - lo) * 0.07; lo -= pad; hi += pad;
  const axW = textWidth((hi).toFixed(dg), KA) + 30;                                  // the price axis is as wide as its longest label
  const TAGH = 7 * KH + 14, L = Math.round(14 * z), R = axW, T = 16 + 7 * KH + 14 + TAGH + 12, B = 7 * KA + 26, pw = width - L - R, ph = height - T - B;
  const Y = (v) => T + (hi - v) / (hi - lo) * ph, step = pw / n, X = (i) => L + (i + 0.5) * step;
  const cv = new Canvas(width, height);
  cv.watermark(WATERMARK, L + pw / 2, T + ph / 2, Math.max(4, Math.round(pw / 70)), C.white, 0.07);     // under everything else, on every alert chart

  // grid + price axis
  const gs = niceStep(hi - lo, 6), grid = [];
  for (let v = Math.ceil(lo / gs) * gs; v <= hi; v += gs) { grid.push(v); }                                    // no grid lines, only the price labels
  const ticks = [], tickEvery = Math.max(1, Math.ceil((textWidth('00 MMM 00:00', KA) + 40) / step));      // time labels never touch each other
  for (let i = Math.max(0, tickEvery - 1); i < n; i += tickEvery) { ticks.push(i); }                                  // no grid lines, only the time labels

  // POI box (from its own start to the right edge)
  if (box) {
    const bi = box.t0 ? Math.max(0, cs.findLastIndex((c) => c.t <= box.t0)) : 0, x0 = box.t0 && cs[0].t > box.t0 ? L : X(bi) - step / 2;
    const bc = dir === 1 ? C.up : dir === -1 ? C.dn : C.gold;
    cv.rect(x0, Y(Math.min(box.hi, hi)), L + pw, Y(Math.max(box.lo, lo)), bc, 0.18);
    cv.hline(Y(Math.min(box.hi, hi)), x0, L + pw, bc, 0.9, 2); cv.hline(Y(Math.max(box.lo, lo)), x0, L + pw, bc, 0.9, 2);
  }
  // trade plan lines
  const plan = (snap.lines || []).filter((l) => Number.isFinite(l.y) && l.y > lo && l.y < hi);
  for (const l of plan) cv.hline(Y(l.y), L, L + pw, l.tone === 'sl' ? C.dn : l.tone === 'tp' ? C.up : C.gold, 0.95, 2.5, 9);

  // event marker: dashed vertical line at the candle that fired the alert
  const ei = Math.min(n - 1, Math.max(0, evIdx - start));
  cv.vline(X(ei), T, T + ph, tone, 0.6, 1.5, 7);

  // candles: thick bodies, clear wicks
  const bw = Math.max(2, step * 0.7);
  cs.forEach((c, i) => {
    const up = c.c >= c.o, col = up ? C.up : C.dn, x = X(i), top = Y(Math.max(c.o, c.c)), bot = Y(Math.min(c.o, c.c)), a = c.forming ? 0.55 : 1;
    cv.rect(x - 1, Y(c.h), x + 1, Y(c.l), col, a);
    cv.rect(x - bw / 2, top, x + bw / 2, Math.max(bot, top + 2), col, a);
  });
  // arrow under (buy) or over (sell) the event candle
  const ec = cs[ei];
  if (dir === 1) cv.triangle(X(ei), Y(ec.l) + 12, 22, false, tone);
  else if (dir === -1) cv.triangle(X(ei), Y(ec.h) - 12, 22, true, tone);

  cv.finish();
  const mid = (y, k) => y - (7 * k) / 2;                                               // top of text so that it is centred on y
  const lp = cs[n - 1].c, th = 7 * KA + 12, ly = Math.min(Math.max(Y(lp), T + th / 2), T + ph - th / 2), lc = cs[n - 1].c >= cs[n - 1].o ? C.up : C.dn;
  // axis labels (bright enough to read on a phone); the one under the last price tag is left out
  for (const v of grid) { const y = Y(v); if (y > T + 10 && y < T + ph - 10 && Math.abs(y - ly) > th * 0.9) cv.text(v.toFixed(dg), L + pw + 14, mid(y, KA), KA, C.axis); }
  for (const i of ticks) { const s = stamp(cs[i].t, tf), x = X(i) - textWidth(s, KA) / 2; if (x > L && x + textWidth(s, KA) < L + pw) cv.text(s, x, T + ph + 12, KA, C.axis); }
  // header: symbol and timeframe, the B-JEFF mark in the corner
  cv.text(`${snap.symbol || ''} - ${snap.tfName || ''}`, L + 6, 16, KH, C.bright);
  cv.text(WATERMARK, width - 14 - textWidth(WATERMARK, KH), 16, KH, C.gold);
  const lab = String(snap.label || '');
  if (lab) {
    const w = textWidth(lab, KH) + 32, x = Math.min(Math.max(L + 2, X(ei) - w / 2), L + pw - w), y0 = 16 + 7 * KH + 14;
    cv.box(Math.round(x), y0, Math.round(x + w), y0 + TAGH, tone); cv.text(lab, x + 16, y0 + 7, KH, [255, 255, 255]);
  }
  for (const l of plan) { const y = Y(l.y), s = `${l.label} ${l.y.toFixed(dg)}`, col = l.tone === 'sl' ? C.dn : l.tone === 'tp' ? C.up : C.gold; const ty = Math.round(y - 7 * KA - GAPY - 5); cv.box(L + 4, ty - 4, L + 4 + textWidth(s, KA) + 12, ty + 7 * KA + 4, C.bg); cv.text(s, L + 10, ty, KA, col); }
  if (box && box.label) { const y = Y(Math.min(box.hi, hi)); cv.text(box.label, L + pw - textWidth(box.label, KA) - 10, y + 8, KA, C.bright); }
  // last price tag
  cv.box(L + pw + 4, Math.round(ly - th / 2), width - 4, Math.round(ly + th / 2), lc); cv.text(lp.toFixed(dg), L + pw + 14, mid(ly, KA), KA, [255, 255, 255]);
  cv.text('UTC', L + pw + 14, T + ph + 12, KA, C.axis);
  return png(width, height, cv.out);
}
