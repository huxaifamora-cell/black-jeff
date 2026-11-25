// SMC indicator engine: market structure (HH / HL / LH / LL), BOS, inducement (IDM), liquidity sweeps and equal highs / lows.
// Pure and incremental: no network, no I/O, no dependencies. Candles are {t,o,h,l,c} (t = open time in seconds).
//
//   const e = new SmcEngine();
//   e.seed(closedCandles);              // history, silent
//   const { changed } = e.close(c);     // a candle just closed -> annotations that are new or changed
//   const live = e.peek(formingCandle); // what the forming candle is doing right now (provisional, never stored)
//   e.snapshot();                       // everything the chart needs
//
// Nothing is repainted: a BOS or sweep is only committed when a candle CLOSES. The forming candle only produces `provisional` previews.
//
// Definitions used (all numbers are in `smcDefaults` and can be tuned per timeframe):
//  - Swing (major): a pivot with `swingLen` candles on each side. It is confirmed `swingLen` candles after it formed. Labelled HH / LH (highs), HL / LL (lows).
//  - BOS : a candle BODY closes beyond the latest unbroken swing in the direction of the current trend (continuation).
//  - Trend (zone mode): a trend needs at least 2 breaks in ONE direction (IDM + DISR). One break, or a lone break against older ones, is not a trend.
//          With no trend (cold start, loaded candles, or right after an invalidation) the LATEST break sets it, but only if its direction already has 2 breaks.
//          While a trend stands, the newest breaks the other way (even 2 of them) are only counter-trend BOS (type 'bos' with `counter: true`; CHoCH no longer exists as a separate type):
//          they cannot make the new trend until the DISR of the standing trend is invalidated.
//  - Trend flip (SORK rule): the trend ends only when the DISR zone is invalidated, i.e. a candle BODY closes beyond its far side
//          (bull trend: close below the DISR zone, bear trend: close above it). The other side becomes the trend AT ONCE, using the breaks that already exist in that direction
//          (no waiting for new ones): the most recent one is the IDM, the one before it the DISR, then LIQ. With only one existing break there is an IDM and no DISR yet (the next break in the new direction is the new IDM, this one becomes the DISR).
//          Only when the other side has no break at all is there no trend (0). No look-back window (the original SMC rule):
//          the new IDM / DISR / LIQ are simply the newest BOS zones of the new direction, whenever they formed, including the counter-trend break of the pullback that led to the flip.
//          (idmMode 'swing', the old rule, has no zones: there the first break still sets the trend.)
//  - Liquidity sweep: a candle WICKS beyond an unbroken swing (or an equal-highs / equal-lows pool) but CLOSES back on the near side of it.
//          Wick above highs = buy-side liquidity taken (bearish reaction expected, dir -1). Wick below lows = sell-side liquidity taken (dir +1).
//  - Inducement (IDM), idmMode 'zone' (default): every BOS gets a zone, drawn where it formed. Up break = demand zone: the last bearish candle (A)
//          at the lowest low between the broken swing and the break, plus the first bullish candle after it (B), body to body. Down break = supply zone, mirrored.
//          50% rule: a candle with a LONG body (more than `longBodyMult` x the average body of the previous `avgBodyLen` candles) only counts for the half of its body that
//          is on the zone side (demand: bottom 50%, supply: top 50%); a long A is the zone on its own, like the long order block body in SORK.
//          Which zones are shown follows the trend: IDM = the zone of the LATEST BOS in the trend direction, DISR (disruption) = the BOS before it, LIQ = the one before that.
//          A wick back into a zone = taken (status 'swept'). A zone that drops out of the three (or belongs to the old trend after a flip) gets status 'void' and leaves the chart.
//  - Inducement (IDM), idmMode 'swing' (the old rule): in an up trend, the FIRST minor swing low (internal pivot, `internalLen`) that forms in the pullback after the latest major swing high.
//          Price wicking below it = the inducement is taken (status 'swept'). Down trend: mirrored with the first minor swing high after the latest swing low.
//          A new major swing replaces it (the old one is dropped if it was never taken).
//  - EQH / EQL: two swings of the same side within `eqTolAtr` x ATR of each other. The pair becomes one liquidity pool at the outer price.

export const smcDefaults = {
  swingLen: 5,          // candles each side of a major swing
  internalLen: 2,       // candles each side of a minor (internal) swing, used for the inducement
  atrLen: 14,
  eqTolAtr: 0.1,        // equal highs / lows: within this x ATR
  sweepMinAtr: 0,       // a sweep wick must poke at least this x ATR beyond the level (0 = any)
  idmMode: 'zone',      // 'zone': IDM on the demand / supply zone of each BOS. 'swing': IDM = first minor pullback swing (old rule)
  idmMaxOpen: 3,        // zone mode: zones mapped on the chart: IDM, DISR, LIQ (newest BOS in the trend direction first)
  longBodyMult: 1.5,    // a "long" body is more than this x the average body (50% rule for zones)
  avgBodyLen: 20,       // candles before the zone candle used for that average
  idmMinDepthAtr: 0.3,  // the inducement must sit at least this x ATR away from the swing it pulled back from
  maxAge: 400,          // candles a swing stays sweepable
  keep: 300,            // annotations kept in memory
  maxBars: 4000,        // closed candles kept (the engine re-seeds from the newest half when it grows past this)
};

export class SmcEngine {
  constructor(params = {}) {
    this.p = { ...smcDefaults, ...params };
    this.#reset();
  }

  #reset() {
    this.cs = [];
    this.swH = []; this.swL = []; this.inH = []; this.inL = [];
    this.top = null; this.btm = null;            // latest confirmed major swing high / low that is not yet broken
    this.trend = 0;
    this.idm = { 1: null, '-1': null };          // current inducement annotation per trend direction (swing mode)
    this.zones = [];                             // mapped IDM / DISR / LIQ zone annotations (zone mode), not void
    this.pb = null;                              // pullback at the IDM: { dir, t, idx, resume_t } (resume_t = the next BOS in the trend direction)
    this.flip = null;                            // the latest trend flip: { dir (the OLD trend), t, idx, by }
    this.brks = [];                              // every committed break with its zone, oldest first: { dir, idx, zone, ann }

    this.ann = new Map();                        // id -> annotation (insertion ordered)
    this.atrV = 0;
  }

  // ------------------------------------------------------------------ public
  // Replace everything with closed history. Returns the snapshot.
  seed(candles) {
    this.#reset();
    for (const c of candles) if (!c.forming) this.#step(c, []);
    return this.snapshot();
  }

  // A candle just closed. Returns { changed } = annotations that are new or changed by this candle (already committed), oldest first.
  close(c) {
    const last = this.cs[this.cs.length - 1];
    if (!c || c.forming || (last && c.t <= last.t)) return { changed: [], trend: this.trend };      // old or duplicate candle
    const changed = [];
    this.#step(c, changed);
    if (this.cs.length > this.p.maxBars) { this.seed(this.cs.slice(-Math.floor(this.p.maxBars / 2))); return { changed: [], trend: this.trend, rebuilt: true }; }   // caller re-sends a full snapshot
    return { changed, trend: this.trend };
  }

  // What the forming candle is doing right now. Nothing is stored or changed. Returns provisional annotations (provisional: true).
  peek(c) {
    if (!c || !this.cs.length || c.t <= this.cs[this.cs.length - 1].t) return [];
    const out = [];
    const i = this.cs.length, f = this.#scan(c, i);
    for (const x of f) {
      if (x.k === 'break') out.push(this.#breakAnn(x, c, true));
      else if (x.k === 'sweep') out.push(this.#sweepAnn(x, c, true));
      else if (x.k === 'idm') out.push({ ...x.ann, status: 'swept', t1: c.t, provisional: true });
    }
    return out;
  }

  snapshot({ limit = this.p.keep } = {}) {
    const all = [...this.ann.values()].filter((a) => a.status !== 'void');
    const last = this.cs[this.cs.length - 1];
    return {
      trend: this.trend,
      last_t: last ? last.t : 0,
      top: this.top ? { t: this.top.t, price: this.top.price } : null,
      btm: this.btm ? { t: this.btm.t, price: this.btm.price } : null,
      pullback: this.pb ? { ...this.pb } : null,
      flip: this.flip ? { ...this.flip } : null,
      annotations: all.slice(-limit).sort((a, b) => (a.t1 ?? a.t0) - (b.t1 ?? b.t0) || a.t0 - b.t0),
    };
  }

  // ------------------------------------------------------------------ internals
  #atr() {
    const n = this.p.atrLen, cs = this.cs;
    if (cs.length < 2) return cs.length ? cs[0].h - cs[0].l : 0;
    let s = 0, k = 0;
    for (let i = Math.max(1, cs.length - n); i < cs.length; i++) {
      const pc = cs[i - 1].c, c = cs[i];
      s += Math.max(c.h - c.l, Math.abs(c.h - pc), Math.abs(c.l - pc)); k++;
    }
    return k ? s / k : 0;
  }

  #put(a, changed) {
    const had = this.ann.has(a.id);
    this.ann.set(a.id, a);
    if (!had && this.ann.size > this.p.keep * 2) { for (const k of this.ann.keys()) { this.ann.delete(k); if (this.ann.size <= this.p.keep) break; } }
    if (changed.indexOf(a) < 0) changed.push(a);
    return a;
  }

  #pivot(i, len, kind) {                                 // is candle i a pivot with `len` candles on each side? (ties on the right side are allowed)
    const cs = this.cs;
    if (i < len || i + len >= cs.length) return false;
    const v = kind === 'H' ? cs[i].h : cs[i].l;
    for (let j = i - len; j < i; j++) if (kind === 'H' ? !(v > cs[j].h) : !(v < cs[j].l)) return false;
    for (let j = i + 1; j <= i + len; j++) if (kind === 'H' ? !(v >= cs[j].h) : !(v <= cs[j].l)) return false;
    return true;
  }

  // Everything candle `c` (at index i, not yet in this.cs) would do. Pure: reads state, changes nothing.
  #scan(c, i) {
    const f = [], p = this.p, a = this.atrV, minWick = p.sweepMinAtr * a;
    // structure breaks (body close beyond the latest unbroken swing)
    if (this.top && !this.top.crossed && c.c > this.top.price) f.push({ k: 'break', dir: 1, sw: this.top, counter: this.trend === -1 });
    if (this.btm && !this.btm.crossed && c.c < this.btm.price) f.push({ k: 'break', dir: -1, sw: this.btm, counter: this.trend === 1 });
    const broke = new Set(f.map((x) => x.sw)), pools = new Set();
    // liquidity sweeps, and silent crosses of older swings (a body closed beyond them: they are gone, not swept)
    for (const s of this.swH) {
      if (s.crossed || s.swept || i - s.idx > p.maxAge || broke.has(s)) continue;
      const lvl = s.pool ?? s.price;
      if (c.h <= lvl) continue;
      if (c.c > lvl) f.push({ k: 'cross', sw: s });
      else if (c.h - lvl >= minWick && !(s.pool != null && pools.has('H' + lvl))) { f.push({ k: 'sweep', sw: s, side: 'buy', lvl }); if (s.pool != null) pools.add('H' + lvl); }
    }
    for (const s of this.swL) {
      if (s.crossed || s.swept || i - s.idx > p.maxAge || broke.has(s)) continue;
      const lvl = s.pool ?? s.price;
      if (c.l >= lvl) continue;
      if (c.c < lvl) f.push({ k: 'cross', sw: s });
      else if (lvl - c.l >= minWick && !(s.pool != null && pools.has('L' + lvl))) { f.push({ k: 'sweep', sw: s, side: 'sell', lvl }); if (s.pool != null) pools.add('L' + lvl); }
    }
    // an open inducement taken by a wick
    for (const d of [1, -1]) {
      const m = this.idm[d];
      if (m && m.status === 'open' && (d === 1 ? c.l < m.price : c.h > m.price)) f.push({ k: 'idm', ann: m });
    }
    // zone mode: a wick back into a mapped zone takes it
    for (const z of this.zones) if (z.status === 'open' && (z.dir === 1 ? c.l <= z.hi : c.h >= z.lo)) f.push({ k: 'idm', ann: z });
    return f;
  }

  #breakAnn(x, c, provisional = false) {
    const dir = x.dir;                                                                       // a break against the trend (old CHoCH) is a BOS too: same type and label, only `counter` tells them apart
    return { id: `bos:${x.sw.t}:${dir}`, type: 'bos', dir, t0: x.sw.t, t1: c.t, price: x.sw.price, label: 'BOS', ...(x.counter ? { counter: true } : {}), ...(provisional ? { provisional: true } : {}) };
  }

  #sweepAnn(x, c, provisional = false) {
    const buy = x.side === 'buy';
    return { id: `sweep:${x.sw.t}:${buy ? 'H' : 'L'}`, type: 'sweep', dir: buy ? -1 : 1, t0: x.sw.t, t1: c.t, price: x.lvl, wick: buy ? c.h : c.l,
      label: x.sw.pool != null ? (buy ? 'EQH SWEEP' : 'EQL SWEEP') : 'SWEEP', side: x.side, ...(provisional ? { provisional: true } : {}) };
  }

  #step(c, changed) {
    const p = this.p, cs = this.cs, i = cs.length;
    cs.push(c);
    this.atrV = this.#atr();
    const found = this.#scan(c, i);                              // candle i is already part of the history; the scan only reads the swing state
    // 1. commit what this candle did
    for (const x of found) {
      if (x.k === 'break') {
        if (!x.counter && this.pb && !this.pb.resume_t) this.pb.resume_t = c.t;                 // a BOS in the trend direction after the pullback = the trend resumes
        x.sw.crossed = true; if (this.trend === 0 && p.idmMode !== 'zone') this.trend = x.dir;   // zone mode: the trend needs 2 breaks in one direction (IDM + DISR), see #mapZones. Swing mode (old rule) has no zones: the first break sets it
        this.#put(this.#breakAnn(x, c), changed);
        if (p.idmMode === 'zone') this.#zoneOf(x, i);
      } else if (x.k === 'sweep') {
        for (const q of x.side === 'buy' ? this.swH : this.swL) if (q === x.sw || (x.sw.pool != null && q.pool === x.sw.pool)) q.swept = true;
        this.#put(this.#sweepAnn(x, c), changed);
      } else if (x.k === 'cross') x.sw.crossed = true;
      else if (x.k === 'idm') { x.ann.status = 'swept'; x.ann.t1 = c.t; this.#put(x.ann, changed); }
    }
    if (p.idmMode === 'zone') this.#mapZones(i, c, changed);
    // a trend flip retires the open inducement of the old direction
    for (const d of [1, -1]) { const m = this.idm[d]; if (m && m.status === 'open' && d !== this.trend && this.trend !== 0) { m.status = 'void'; m.t1 = c.t; this.#put(m, changed); this.idm[d] = null; } }
    // 2. new major swings (confirmed swingLen candles later)
    const pi = i - p.swingLen;
    if (pi >= 0) {
      if (this.#pivot(pi, p.swingLen, 'H')) this.#addSwing('H', pi, changed);
      if (this.#pivot(pi, p.swingLen, 'L')) this.#addSwing('L', pi, changed);
    }
    // 3. minor swings, then the inducement they define
    const ii = i - p.internalLen;
    if (ii >= 0) {
      if (this.#pivot(ii, p.internalLen, 'H')) { this.inH.push({ idx: ii, t: cs[ii].t, price: cs[ii].h }); if (this.inH.length > 60) this.inH.shift(); }
      if (this.#pivot(ii, p.internalLen, 'L')) { this.inL.push({ idx: ii, t: cs[ii].t, price: cs[ii].l }); if (this.inL.length > 60) this.inL.shift(); }
    }
    this.#updateIdm(changed);
  }

  #addSwing(kind, idx, changed) {
    const cs = this.cs, c = cs[idx], isH = kind === 'H', price = isH ? c.h : c.l, list = isH ? this.swH : this.swL;
    const prev = list[list.length - 1], tol = this.p.eqTolAtr * this.atrV;
    const s = { idx, t: c.t, price, crossed: false, swept: false, pool: null };
    let label = prev ? (isH ? (price > prev.price ? 'HH' : 'LH') : (price < prev.price ? 'LL' : 'HL')) : (isH ? 'H' : 'L');
    // equal highs / lows: this swing and an earlier unbroken one share a pool
    const mate = list.slice(-6).reverse().find((q) => !q.crossed && !q.swept && Math.abs(q.price - price) <= tol && idx - q.idx <= this.p.maxAge);
    if (mate) {
      const lvl = isH ? Math.max(mate.price, price) : Math.min(mate.price, price);
      mate.pool = s.pool = lvl; label = isH ? 'EQH' : 'EQL';
      this.#put({ id: `eq:${mate.t}:${c.t}`, type: 'eq', dir: isH ? -1 : 1, t0: mate.t, t1: c.t, price: lvl, label }, changed);
    }
    s.label = label;
    list.push(s); if (list.length > 80) list.shift();
    this.#put({ id: `swing:${c.t}:${kind}`, type: 'swing', dir: isH ? -1 : 1, t0: c.t, t1: null, price, label }, changed);
    if (isH) this.top = s; else this.btm = s;
  }

  // Zone of a break (candle i is the breaking candle, x.sw the swing it broke). Stored with the break; it is only put on the chart when it is the IDM, DISR or LIQ of the trend.
  // Up break: A = last bearish candle at or before the lowest low between the swing and the break, B = first bullish candle after A. Band over A and B, body to body.
  // Down break: mirrored (A = last bullish candle at the highest high, B = first bearish candle after it). 50% rule for long bodies (see the header).
  #zoneOf(x, i) {
    const cs = this.cs, d = x.dir, s = x.sw.idx;
    if (s >= i) return;
    let k = s;
    for (let j = s; j < i; j++) if (d === 1 ? cs[j].l < cs[k].l : cs[j].h > cs[k].h) k = j;       // the pullback extreme that led into the break
    const opp = (q) => (d === 1 ? q.c < q.o : q.c > q.o), same = (q) => (d === 1 ? q.c > q.o : q.c < q.o);
    let a = k;
    for (let j = k; j >= Math.max(0, k - this.p.maxAge); j--) if (opp(cs[j])) { a = j; break; }
    let b = -1;
    for (let j = a + 1; j <= i; j++) if (same(cs[j])) { b = j; break; }
    // body of a candle on the zone side; a long body only gives its half (demand: bottom 50%, supply: top 50%)
    let half = false;
    const part = (j) => {
      const q = cs[j], lo0 = Math.min(q.o, q.c), hi0 = Math.max(q.o, q.c), w = hi0 - lo0;
      if (!this.#longBody(j)) return { lo: lo0, hi: hi0, long: false };
      half = true;
      return d === 1 ? { lo: lo0, hi: lo0 + w / 2, long: true } : { lo: hi0 - w / 2, hi: hi0, long: true };
    };
    const pa = part(a);
    let lo = pa.lo, hi = pa.hi;
    if (b >= 0 && !pa.long) { const pb = part(b); lo = Math.min(lo, pb.lo); hi = Math.max(hi, pb.hi); }   // a long A is the zone on its own, like the long order block body in SORK
    if (!(hi > lo)) { lo = cs[a].l; hi = cs[a].h; half = false; }                                     // doji: use the whole candle
    const zone = { id: `idm:${x.sw.t}:${d}`, type: 'idm', dir: d, t0: cs[a].t, t1: null, price: d === 1 ? hi : lo, lo, hi, zone: true,
      bos_t: cs[i].t, bos_level: x.sw.price, broken_t: x.sw.t, line: d === 1 ? cs[k].l : cs[k].h,      // the breaking candle, the level it broke, when that swing formed, the swing start (HL / LH)
      ...(half ? { half: true } : {}), ref: `bos:${x.sw.t}:${d}` };
    this.brks.push({ dir: d, idx: i, zone, ann: null });
    if (this.brks.length > 80) this.brks.shift();
  }

  #longBody(j) {
    const cs = this.cs, q = cs[j], n = this.p.avgBodyLen;
    let s = 0, k = 0;
    for (let m = Math.max(0, j - n); m < j; m++) { s += Math.abs(cs[m].c - cs[m].o); k++; }
    const avg = k ? s / k : 0;
    return avg > 0 && Math.abs(q.c - q.o) > this.p.longBodyMult * avg;
  }

  // Which zones are on the chart, newest candle i = c. IDM = latest BOS in the trend direction, DISR = the one before, LIQ = the one before that.
  // SORK invalidation: a body closing beyond the far side of the DISR zone flips the trend and maps the order flow again in the new direction.
  #mapZones(i, c, changed) {
    const p = this.p, ROLES = ['idm', 'disr', 'liq'].slice(0, Math.max(1, Math.min(3, p.idmMaxOpen)));
    let d = this.trend;
    const cands = (dir) => this.brks.filter((b) => b.dir === dir);
    let cand = d ? cands(d) : [];
    if (d === 0) {
      // No trend yet (cold start / loaded candles, or the old trend was invalidated and the other side has no break at all). The LATEST break sets the trend,
      // but only when its direction already has 2 breaks (IDM + DISR). One break, or a lone break against older ones, is not a trend.
      const lb = this.brks[this.brks.length - 1];
      if (lb && lb.idx === i && cands(lb.dir).length >= 2) { this.trend = d = lb.dir; cand = cands(d); }
    } else {
      // A trend only ends when its DISR is invalidated. Until then the 2 newest breaks the other way can NOT make a new trend, however recent they are.
      const dis = cand.length >= 2 ? cand[cand.length - 2] : null;
      if (dis && dis.idx < i && (d === 1 ? c.c < dis.zone.lo : c.c > dis.zone.hi)) {
        this.flip = { dir: d, t: c.t, idx: i, by: 'disruption' }; this.pb = null;
        // the other side takes over at once with the breaks that already exist in its direction (most recent = IDM, the one before = DISR, then LIQ), no waiting for new ones;
        // only if it has no break at all is there no trend
        this.trend = d = cands(-d).length >= 1 ? -d : 0;
        cand = d ? cands(d) : [];
      }
    }
    const roles = cand.slice(-ROLES.length).reverse();             // newest first
    for (const b of this.brks) if (b.ann && b.ann.status !== 'void' && !roles.includes(b)) { b.ann.status = 'void'; b.ann.t1 = c.t; this.#put(b.ann, changed); }
    roles.forEach((b, k) => {
      const role = ROLES[k];
      if (!b.ann || b.ann.status === 'void') {                      // new on the chart, or back on it after the trend flipped again
        let taken = null;                                           // it may already have been touched between its break and now
        for (let j = b.idx + 1; j <= i; j++) if (b.dir === 1 ? this.cs[j].l <= b.zone.hi : this.cs[j].h >= b.zone.lo) { taken = this.cs[j].t; break; }
        b.ann = { ...b.zone, role, label: role.toUpperCase(), status: taken != null ? 'swept' : 'open', t1: taken };
        this.#put(b.ann, changed);
      } else if (b.ann.role !== role) { b.ann.role = role; b.ann.label = role.toUpperCase(); this.#put(b.ann, changed); }
    });
    this.zones = this.brks.filter((b) => b.ann && b.ann.status !== 'void').map((b) => b.ann);
    // pullback at the inducement (SORK rule): with an IDM and a DISR mapped, a wick back into the IDM zone. It never changes the trend; it ends when the next BOS in the trend direction forms.
    if (roles.length >= 2 && (this.pb === null || this.pb.resume_t)) {
      const z = roles[0].zone;
      if (i > roles[0].idx && (d === 1 ? c.l <= z.hi : c.h >= z.lo)) this.pb = { dir: d, t: c.t, idx: i, resume_t: null };
    }
  }

  // Inducement of the current trend: the FIRST minor pullback swing after the latest major swing (see the header).
  #updateIdm(changed) {
    const d = this.trend, atr = this.atrV;
    if (d === 0 || this.p.idmMode === 'zone') return;
    const ref = d === 1 ? this.swH[this.swH.length - 1] : this.swL[this.swL.length - 1];
    if (!ref || ref.crossed) return;                            // the latest swing was already broken: wait for the new leg's swing, the old pullback is history
    const cur = this.idm[d];
    if (cur && cur.ref === ref.t) return;                       // already found for this swing (open or swept): keep it
    const minors = d === 1 ? this.inL : this.inH;
    const m = minors.find((q) => q.idx > ref.idx && Math.abs(ref.price - q.price) >= this.p.idmMinDepthAtr * atr);
    if (!m) return;
    if (cur && cur.status === 'open') { cur.status = 'void'; cur.t1 = m.t; this.#put(cur, changed); }       // a new swing replaced an inducement that was never taken
    const cs = this.cs;
    let taken = null;                                            // it may already have been taken between its pivot and now
    for (let j = m.idx + 1; j < cs.length; j++) if (d === 1 ? cs[j].l < m.price : cs[j].h > m.price) { taken = cs[j].t; break; }
    const a = { id: `idm:${m.t}:${d}`, type: 'idm', dir: d, t0: m.t, t1: taken, price: m.price, label: 'IDM', status: taken != null ? 'swept' : 'open', ref: ref.t };
    this.idm[d] = a;
    this.#put(a, changed);
  }
}
