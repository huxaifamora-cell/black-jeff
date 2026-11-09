// SORK concept engine. Pure functions over lists of CLOSED candles {t,o,h,l,c}. No network, no I/O.
// Timeframes: H4 (market structure), H1 (order flow, key levels, QML), M5 (reclamation, entries).
// Several SORK rules are judged "by eye" by the trader. Where a rule needs a number it is a field of
// `defaultParams` so it can be tuned without touching the logic.

export const H4 = 14400, H1 = 3600, M5 = 300;

export const defaultParams = {
  swingK: 1,            // candles on each side that confirm a swing high/low
  atrLen: 14,
  longBodyMult: 1.5,    // "longer than average" body = more than this x the average body
  avgBodyLen: 20,
  obScanBack: 6,        // how far back from the V tip to look for the order block candle
  klTolAtr: 0.10,       // "equal / almost identical" edges = within this x ATR
  klLookback: 200,      // H1 candles scanned for key levels
  maxKlWicks: 2,        // high probability key level: no more than this many wicks in the POI
  slBufferAtr: 0.25,    // "slightly outside the POI" = this x M5 ATR
  rr: 2.0,              // risk reward ratio used for the example TP
  extremeLookback: 100, // H1 candles used to judge "at the extreme" for a QML
  maxScanM5: 600,       // M5 candles scanned for reclamations
};

export const C = (t, o, h, l, c) => ({ t, o, h, l, c });
const bull = (c) => c.c > c.o;
const bear = (c) => c.c < c.o;
const top = (c) => Math.max(c.o, c.c);
const bot = (c) => Math.min(c.o, c.c);
const body = (c) => Math.abs(c.c - c.o);
const upWick = (c) => c.h - top(c);
const loWick = (c) => bot(c) - c.l;
export const mirror = (c) => ({ t: c.t, o: -c.o, h: -c.l, l: -c.h, c: -c.c });

export function atr(cs, n = 14) {
  if (cs.length < 2) return 0;
  const trs = [];
  for (let i = Math.max(1, cs.length - n); i < cs.length; i++) {
    const p = cs[i - 1].c, c = cs[i];
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - p), Math.abs(c.l - p)));
  }
  return trs.length ? trs.reduce((a, b) => a + b, 0) / trs.length : 0;
}

// ---------------------------------------------------------------- swings and BOS
export function swings(cs, k) {
  const out = [];
  for (let i = k; i < cs.length - k; i++) {
    const hi = cs[i].h, lo = cs[i].l;
    let isH = true, isL = true;
    for (let j = i - k; j < i; j++) { if (!(hi > cs[j].h)) isH = false; if (!(lo < cs[j].l)) isL = false; }
    for (let j = i + 1; j <= i + k; j++) { if (!(hi >= cs[j].h)) isH = false; if (!(lo <= cs[j].l)) isL = false; }
    if (isH) out.push({ idx: i, price: hi, kind: 'H' });
    if (isL) out.push({ idx: i, price: lo, kind: 'L' });
  }
  return out;
}

export function findBos(cs, k) {
  const sw = swings(cs, k);
  const highs = sw.filter((s) => s.kind === 'H'), lows = sw.filter((s) => s.kind === 'L');
  const out = [], usedH = new Set(), usedL = new Set();
  let hp = 0, lp = 0, lastH = null, lastL = null;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    while (hp < highs.length && highs[hp].idx + k <= i) lastH = highs[hp++];
    while (lp < lows.length && lows[lp].idx + k <= i) lastL = lows[lp++];
    if (lastH && !usedH.has(lastH.idx) && i > lastH.idx && c.c > lastH.price) {      // BOS = a candle BODY closes beyond the swing, a wick alone does not count
      usedH.add(lastH.idx);
      let tip = lastH.idx + 1;
      for (let j = lastH.idx + 1; j <= i; j++) if (cs[j].l < cs[tip].l) tip = j;
      out.push({ dir: 1, idx: i, t: c.t, level: lastH.price, broken_idx: lastH.idx, tip_idx: tip, tip_price: cs[tip].l, slq: false, valid: false });
    }
    if (lastL && !usedL.has(lastL.idx) && i > lastL.idx && c.c < lastL.price) {
      usedL.add(lastL.idx);
      let tip = lastL.idx + 1;
      for (let j = lastL.idx + 1; j <= i; j++) if (cs[j].h > cs[tip].h) tip = j;
      out.push({ dir: -1, idx: i, t: c.t, level: lastL.price, broken_idx: lastL.idx, tip_idx: tip, tip_price: cs[tip].h, slq: false, valid: false });
    }
  }
  out.sort((a, b) => a.idx - b.idx || b.dir - a.dir);
  return out;
}

// Structural liquidity: an opposite-colored candle on the right side of the V (or A),
// not above the previous HH (not below the previous LL).
export function hasSlq(cs, b) {
  for (let j = b.tip_idx + 1; j < b.idx; j++) {
    const c = cs[j];
    if (b.dir === 1 && bear(c) && c.h <= b.level) return true;
    if (b.dir === -1 && bull(c) && c.l >= b.level) return true;
  }
  return false;
}

export function markValid(cs, bos) {
  let prev = null;
  for (const b of bos) {
    b.slq = hasSlq(cs, b);
    // exception: two or more BOS in a row without SLQ act as the liquidity
    b.valid = b.slq || (prev !== null && prev.dir === b.dir && !prev.slq);
    prev = b;
  }
  return bos;
}

export function marketStructure(h4, p) {
  const bos = markValid(h4, findBos(h4, p.swingK));
  const valid = bos.filter((b) => b.valid);
  const anchor = valid.length ? valid[valid.length - 1] : null;
  const last = bos.length ? bos[bos.length - 1] : null;
  return {
    trend: anchor ? anchor.dir : 0, anchor, last,
    shift_pending: !!(anchor && last && last.dir !== anchor.dir && !last.valid),
    bos: bos.slice(-6),
    valid_bos: valid.slice(-2),     // the 2 latest valid BOS, drawn on the H4 chart
    swings: swings(h4, p.swingK).slice(-8).map((s) => ({ t: h4[s.idx].t, price: s.price, kind: s.kind })),
  };
}

// ---------------------------------------------------------------- order flow
export function orderBlock(cs, b, p) {
  const wantBear = b.dir === 1, start = b.tip_idx;
  for (let j = start; j > Math.max(-1, start - p.obScanBack - 1); j--) {
    if (wantBear ? bear(cs[j]) : bull(cs[j])) return j;
  }
  return start;
}

// POI box. The two candles are the order block and the candle right after it.
// Bearish: top = highest body edge of the two, bottom = low of the one with the longer lower wick.
// Bullish (mirror): bottom = lowest body edge of the two, top = high of the one with the longer upper wick.
// Exception kept from before: a LONG order block body uses only 50% of its body (no wick extension).
export function poiFromOb(cs, j, d, p) {
  const c = cs[j];
  let lo = bot(c), hi = top(c);
  const prev = cs.slice(Math.max(0, j - p.avgBodyLen), j);
  const avg = prev.length ? prev.reduce((a, x) => a + body(x), 0) / prev.length : body(c);
  const b = hi - lo;
  if (avg > 0 && b > p.longBodyMult * avg) {
    if (d === 1) hi = lo + b / 2;   // bullish scenario: bottom 50% of the body
    else lo = hi - b / 2;           // bearish scenario: top 50% of the body
    return [lo, hi];
  }
  const n = cs[j + 1] || c;         // no next candle yet: the order block alone
  if (d === -1) {
    hi = Math.max(top(c), top(n));
    lo = loWick(c) >= loWick(n) ? c.l : n.l;
  } else {
    lo = Math.min(bot(c), bot(n));
    hi = upWick(c) >= upWick(n) ? c.h : n.h;
  }
  return [lo, hi];
}

function poiOf(cs, b, role, p) {
  const j = orderBlock(cs, b, p);
  const [lo, hi] = poiFromOb(cs, j, b.dir, p);
  return { role, dir: b.dir, lo, hi, line: b.tip_price, bos_t: b.t, bos_idx: b.idx, ob_t: cs[j].t };
}

// Inducement = latest BOS in the trend, disruption = the BOS before it, the rest are points of liquidity.
// If the disruption POI is invalidated (an H1 body closes beyond it) the trend has changed direction and
// the order flow is mapped again in the new direction.
export function orderFlow(h1, trend, p) {
  const bos = findBos(h1, p.swingK);
  const res = { dir: trend, pois: [], invalidated: null, remapped: false };
  if (trend === 0) return res;
  let d = trend, minIdx = -1;
  for (let attempt = 0; attempt < 2; attempt++) {
    const mine = bos.filter((b) => b.dir === d && b.idx > minIdx);
    if (!mine.length) { res.dir = d; res.pois = []; return res; }
    const ind = mine[mine.length - 1];
    const dis = mine.length >= 2 ? mine[mine.length - 2] : null;
    const plq = mine.length >= 3 ? mine.slice(-4, -2) : [];
    if (dis && attempt === 0) {
      const dp = poiOf(h1, dis, 'disruption', p);
      for (let j = dis.idx + 1; j < h1.length; j++) {
        const c = h1[j];
        if ((d === 1 && c.c < dp.lo) || (d === -1 && c.c > dp.hi)) { res.invalidated = { dir: d, t: c.t, idx: j, poi: dp }; break; }
      }
      if (res.invalidated) { minIdx = res.invalidated.idx - 3; d = -d; res.remapped = true; continue; }
    }
    const pois = [poiOf(h1, ind, 'inducement', p)];
    if (dis) pois.push(poiOf(h1, dis, 'disruption', p));
    for (const b of plq) pois.push(poiOf(h1, b, 'plq', p));
    res.dir = d; res.pois = pois;
    return res;
  }
  return res;
}

// ---------------------------------------------------------------- reclamation (M5)
// Five steps, bullish version. The bearish version runs on mirrored candles.
export function reclamation(m5, poi, p) {
  const d = poi.dir;
  let lo = poi.lo, hi = poi.hi;
  let cs = m5.filter((c) => c.t > poi.bos_t).slice(-p.maxScanM5);
  if (d === -1) { cs = cs.map(mirror); [lo, hi] = [-hi, -lo]; }
  let st = 0, prevClose = null;
  const completes = [];
  for (const c of cs) {
    if (st === 0) {
      const fromAbove = (prevClose !== null ? prevClose : c.o) > hi;
      if (fromAbove && c.l <= hi) st = 1;                                  // 1: comes down into the POI
    }
    if (st === 1) {
      if (c.c < lo) st = 2;                                                // 2: body closes below the POI
      else if (c.c > hi && prevClose !== null && prevClose > hi) st = 0;   // left upward without breaking
    } else if (st === 2) {
      if (c.c > hi) st = 3;                                                // 3: body closes back above the POI
    } else if (st === 3) {
      if (c.c < lo) st = 2;                                                // broke below again
      else if (c.l <= hi && c.c >= lo) st = 4;                             // 4: back into the POI without a body break
    } else if (st === 4) {
      if (c.c < lo) st = 2;
      else if (c.c > hi) { completes.push(c.t); st = 0; }                  // 5: out of the POI in the trend direction
    }
    prevClose = c.c;
  }
  return { state: st, completes, last_complete: completes.length ? completes[completes.length - 1] : null };
}

// ---------------------------------------------------------------- key levels (H1 and M5)
export function findKls(cs, p, atrV, lookback) {
  const out = [], tol = p.klTolAtr * atrV;
  for (let i = Math.max(1, cs.length - lookback); i < cs.length; i++) {
    const a = cs[i - 1], b = cs[i];
    if (body(a) === 0 || body(b) === 0 || bull(a) === bull(b)) continue;
    const eqTop = Math.abs(top(a) - top(b)) <= tol, eqBot = Math.abs(bot(a) - bot(b)) <= tol;
    if (!(eqTop || eqBot)) continue;
    const kind = bull(a) ? 'R' : 'S';
    const tip = kind === 'R' ? (upWick(a) >= upWick(b) ? a : b).h : (loWick(a) >= loWick(b) ? a : b).l;
    out.push({ kind, i, t0: a.t, t1: b.t, lo: Math.min(bot(a), bot(b)), hi: Math.max(top(a), top(b)), tip, eq: eqTop ? 'top' : 'bottom' });
  }
  return out;
}

function wicksIn(cs, i, j, lo, hi) {
  let n = 0;
  for (const c of cs.slice(i + 1, j)) {
    if (upWick(c) > 0 && top(c) <= hi && c.h >= lo) n++;
    if (loWick(c) > 0 && c.l <= hi && bot(c) >= lo) n++;
  }
  return n;
}

export function validateKls(cs, kls, p) {
  return kls.map((k0) => {
    const k = { ...k0 };
    let j = null;
    for (let x = k.i + 1; x < cs.length; x++) {
      const c = cs[x];
      if ((k.kind === 'R' && bull(c) && c.c > k.tip) || (k.kind === 'S' && bear(c) && c.c < k.tip)) { j = x; break; }
    }
    if (j === null) k.status = 'pending';
    else {
      const w = wicksIn(cs, k.i, j, k.lo, k.hi);
      Object.assign(k, { status: 'valid', j, t_valid: cs[j].t, wicks: w, high_prob: w <= p.maxKlWicks,
        type: k.kind === 'R' ? 'RBS' : 'SBR', dir: k.kind === 'R' ? 1 : -1 });
    }
    return k;
  });
}

// A candle body closing outside the POI (pullback side) invalidates the key level.
export function klInvalidation(kl, h1, m5) {
  const { lo, hi, dir: d } = kl;
  const tFrom = kl.t_valid + H1, m5Start = m5.length ? m5[0].t : null;
  const hit = (c) => (d === 1 && c.c < lo) || (d === -1 && c.c > hi);
  for (const c of h1) {            // older part, where the M5 history does not reach
    if (c.t > kl.t_valid && (m5Start === null || c.t + H1 <= m5Start) && hit(c)) return { t: c.t + H1, price: c.c };
  }
  for (const c of m5) if (c.t >= tFrom && hit(c)) return { t: c.t + M5, price: c.c };
  return null;
}

// Entry confirmations on M5 inside the POI box: move out of the box, engulf, harami.
// d=+1 looks for buys (move out of the top), d=-1 for sells (move out of the bottom).
export function confirmations(m5, lo, hi, d, sinceT) {
  const out = [];
  for (let i = 1; i < m5.length; i++) {
    const c = m5[i], a = m5[i - 1];
    if (c.t < sinceT) continue;
    const inC = bot(c) >= lo && top(c) <= hi, inA = bot(a) >= lo && top(a) <= hi;
    if (d === 1) {
      if (lo <= a.c && a.c <= hi && c.c > hi) out.push({ t: c.t, type: 'move_out' });
      if (bear(a) && bull(c) && inA && inC && bot(c) <= bot(a) && top(c) >= top(a)) out.push({ t: c.t, type: 'engulf' });
      if (bear(a) && bull(c) && inC && body(a) > body(c) && top(c) <= top(a) && bot(c) >= bot(a)) out.push({ t: c.t, type: 'harami' });
    } else {
      if (lo <= a.c && a.c <= hi && c.c < lo) out.push({ t: c.t, type: 'move_out' });
      if (bull(a) && bear(c) && inA && inC && bot(c) <= bot(a) && top(c) >= top(a)) out.push({ t: c.t, type: 'engulf' });
      if (bull(a) && bear(c) && inC && body(a) > body(c) && top(c) <= top(a) && bot(c) >= bot(a)) out.push({ t: c.t, type: 'harami' });
    }
  }
  return out;
}

export function tradePlan(lo, hi, d, atr5, p) {
  const buf = p.slBufferAtr * atr5;
  if (d === 1) { const entry = hi, sl = lo - buf; return { entry, sl, tp: entry + p.rr * (entry - sl), rr: p.rr }; }
  const entry = lo, sl = hi + buf;
  return { entry, sl, tp: entry - p.rr * (sl - entry), rr: p.rr };
}

// ---------------------------------------------------------------- QML
// After a key level is invalidated, build the inverse key level (Quasimodo level) POI.
export function qmlFor(kl, inv, h1, m5, p, atr1) {
  const t0 = kl.t0, tInv = inv.t;
  const hcs = h1.filter((c) => c.t >= t0 && c.t < tInv);
  const lastH1End = hcs.length ? hcs[hcs.length - 1].t + H1 : t0;
  const all = hcs.concat(m5.filter((c) => c.t >= lastH1End && c.t < tInv));
  if (!all.length) return null;
  let lo, hi, d, extreme, atExtreme;
  if (kl.dir === 1) {          // RBS invalidated -> QML sells
    extreme = Math.max(...all.map((c) => c.h));
    [lo, hi, d] = [kl.hi, extreme, -1];
    const ref = h1.filter((c) => c.t < tInv).map((c) => c.h).slice(-p.extremeLookback);
    atExtreme = ref.length > 0 && extreme >= Math.max(...ref) - 0.1 * atr1;
  } else {                     // SBR invalidated -> QML buys
    extreme = Math.min(...all.map((c) => c.l));
    [lo, hi, d] = [extreme, kl.lo, 1];
    const ref = h1.filter((c) => c.t < tInv).map((c) => c.l).slice(-p.extremeLookback);
    atExtreme = ref.length > 0 && extreme <= Math.min(...ref) + 0.1 * atr1;
  }
  if (hi <= lo) return null;
  let dead = null;
  for (const c of m5) {
    if (c.t >= tInv && ((d === -1 && c.c > hi) || (d === 1 && c.c < lo))) { dead = c.t + M5; break; }
  }
  return { dir: d, lo, hi, t: tInv, extreme, at_extreme: atExtreme, invalidated_t: dead };
}

// ---------------------------------------------------------------- advanced key level / bjeff zone
export function reversalSignals(m5, d, sinceT) {
  const out = [];
  for (let i = 1; i < m5.length; i++) {
    const c = m5[i], a = m5[i - 1];
    if (c.t < sinceT) continue;
    if (d === 1) {
      if (bear(a) && bull(c) && bot(c) <= bot(a) && top(c) >= top(a)) out.push({ t: c.t, type: 'engulf' });
      else if (bear(a) && bull(c) && body(a) > body(c) && top(c) <= top(a) && bot(c) >= bot(a)) out.push({ t: c.t, type: 'harami' });
      else if (body(c) > 0 && loWick(c) >= 2 * body(c) && upWick(c) <= body(c)) out.push({ t: c.t, type: 'pin_bar' });
    } else {
      if (bull(a) && bear(c) && bot(c) <= bot(a) && top(c) >= top(a)) out.push({ t: c.t, type: 'engulf' });
      else if (bull(a) && bear(c) && body(a) > body(c) && top(c) <= top(a) && bot(c) >= bot(a)) out.push({ t: c.t, type: 'harami' });
      else if (body(c) > 0 && upWick(c) >= 2 * body(c) && loWick(c) <= body(c)) out.push({ t: c.t, type: 'pin_bar' });
    }
  }
  return out;
}

export function advanced(kl, m5, p, invT) {
  const { lo, hi, dir: d } = kl, mid = (lo + hi) / 2;
  const [zl, zh] = d === 1 ? [lo, mid] : [mid, hi];     // RBS: bottom half, SBR: top half
  const since = kl.t_valid + H1;
  const seg = m5.filter((c) => c.t >= since && (invT === null || invT === undefined || c.t < invT));
  let entered = null;
  for (const c of seg) {
    if ((d === 1 && c.l <= mid) || (d === -1 && c.h >= mid)) { entered = c.t + M5; break; }
  }
  const zones = [];
  if (entered !== null) {
    const a5 = atr(seg, p.atrLen);
    for (const z of validateKls(seg, findKls(seg, p, a5, seg.length), p)) {
      if (z.lo >= zl - 1e-12 && z.hi <= zh + 1e-12 && z.t1 + M5 >= entered - M5) {
        let active = null;
        for (const c of seg) if (c.t > z.t1 && z.lo <= c.c && c.c <= z.hi) { active = c.t + M5; break; }
        zones.push({ lo: z.lo, hi: z.hi, t: z.t1, active_t: active });
      }
    }
  }
  const uniq = new Map();
  for (const z of zones) if (z.active_t) for (const s of reversalSignals(seg, d, z.active_t)) uniq.set(`${s.t}|${s.type}`, s);
  const signals = [...uniq.values()].sort((a, b) => a.t - b.t).slice(-3);
  return { half: [zl, zh], entered_t: entered, zones: zones.slice(-3), signals };
}

// ---------------------------------------------------------------- full evaluation of one symbol
const ev = (concept, kind, dir, t, tf, title, body, uid, extra = {}) =>
  ({ concept, kind, dir, t: Math.trunc(t), tf, title, body, uid: String(uid), extra });
const side = (d) => (d === 1 ? 'buy' : 'sell');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const nice = (s) => s.replace('_', ' ');
const tail = (cs, n) => cs.slice(-n).map((c) => [c.t, c.o, c.h, c.l, c.c]);

export function evaluate(h4, h1, m5, p = defaultParams, digits = 3) {
  const f = (x) => Number(x).toFixed(digits);
  const events = [], overlays = [];
  const state = { s: null, o: null, r: [], k: null, qml: null, adv: null, signals: [] };
  const minLen = 2 * p.swingK + 4;
  if (h4.length < minLen || h1.length < minLen || m5.length < minLen) {
    Object.assign(state, { note: 'Not enough candle history yet.', candles: { m5: tail(m5, 150), h1: tail(h1, 150), h4: tail(h4, 120) }, overlays, digits });
    return { state, events };
  }
  const atr1 = atr(h1, p.atrLen), atr5 = atr(m5, p.atrLen);

  // ---- S: market structure on H4
  const ms = marketStructure(h4, p), anc = ms.anchor;
  // The old trend is also invalidated when its disruption POI is invalidated (an H1 body closes beyond it).
  const of = orderFlow(h1, ms.trend, p);
  const flipped = !!of.invalidated;
  const trend = flipped ? of.dir : ms.trend;
  state.s = {
    trend, shift_pending: flipped ? false : ms.shift_pending, valid: anc !== null,
    trend_invalidated: flipped ? { by: 'disruption', old_dir: ms.trend, t: of.invalidated.t + H1 } : null, anchor_t: anc ? anc.t : null, level: anc ? anc.level : null,
    slq: anc ? anc.slq : null, swings: ms.swings,
    bos: ms.bos.map((b) => ({ dir: b.dir, t: b.t, level: b.level, valid: b.valid, slq: b.slq })),
  };
  if (anc && !flipped) {
    const how = anc.slq ? 'liquidity (SLQ) + BOS' : '2+ BOS without SLQ';
    events.push(ev('S', 'trend_valid', anc.dir, anc.t + H4, H4, `S: H4 ${anc.dir === 1 ? 'uptrend' : 'downtrend'} is valid`,
      `Valid through ${how}. BOS broke ${f(anc.level)}. Look for ${side(anc.dir)} setups on H1.`, anc.t));
  }
  for (const b of ms.valid_bos) {
    overlays.push({ type: 'line', tf: 'h4', y: b.level, t0: h4[b.broken_idx].t, label: 'BOS', tone: 's' });
  }

  // ---- O: order flow on H1
  state.o = of;
  for (const poi of of.pois) {
    if (poi.role === 'inducement' || poi.role === 'disruption') {
      events.push(ev('O', poi.role, poi.dir, poi.bos_t + H1, H1, `O: new ${poi.role} POI (${poi.dir === 1 ? 'bullish' : 'bearish'})`,
        `POI ${f(poi.lo)} to ${f(poi.hi)} (order block body). Line at ${f(poi.line)}.`, `${poi.role}-${poi.bos_t}`, { lo: poi.lo, hi: poi.hi }));
    }
    if (poi.role !== 'plq') overlays.push({ type: 'box', grp: 'o', lo: poi.lo, hi: poi.hi, t0: poi.ob_t, label: cap(poi.role), tone: 'o' });   // point of liquidity is not drawn
  }
  if (of.invalidated) {
    const iv = of.invalidated;
    events.push(ev('O', 'invalidated', iv.dir, iv.t + H1, H1, 'O: inducement and disruption invalidated',
      `An H1 body closed beyond the disruption POI, so the old trend is invalidated. The trend has changed to ${iv.dir === 1 ? 'down' : 'up'}. New inducement and disruption are mapped.`, `inv-${iv.t}`));
  }

  // ---- R: reclamation on M5 (confirmation only)
  state.r = [];
  for (const poi of of.pois) {
    const r = reclamation(m5, poi, p);
    state.r.push({ role: poi.role, dir: poi.dir, state: r.state, last_complete: r.last_complete, lo: poi.lo, hi: poi.hi });
    if (r.last_complete) {
      events.push(ev('R', 'reclamation', poi.dir, r.last_complete + M5, M5, `R: valid ${poi.dir === 1 ? 'bullish' : 'bearish'} reclamation`,
        `M5 reclamation completed at the ${poi.role} POI (${f(poi.lo)} to ${f(poi.hi)}). Use it as a confirmation, not as an entry.`,
        `${poi.role}-${poi.bos_t}-${r.last_complete}`));
    }
  }

  // ---- K: key levels on H1
  const vk = validateKls(h1, findKls(h1, p, atr1, p.klLookback), p);
  const valid = vk.filter((k) => k.status === 'valid');
  const kState = { active: null, pending: [] };      // RKL/SKL (levels not yet valid) are not shown or alerted
  state.k = kState;
  if (valid.length) {
    const act = valid.reduce((a, k) => (k.j > a.j || (k.j === a.j && k.i > a.i) ? k : a));
    const inv = klInvalidation(act, h1, m5);
    const plan = tradePlan(act.lo, act.hi, act.dir, atr5, p);
    kState.active = { type: act.type, dir: act.dir, lo: act.lo, hi: act.hi, t0: act.t0, t_valid: act.t_valid, wicks: act.wicks,
      high_prob: act.high_prob, invalidated: inv, plan };
    overlays.push({ type: 'box', grp: 'k', lo: act.lo, hi: act.hi, t0: act.t0, label: act.type + (act.high_prob ? '' : ' (low probability)'), tone: inv ? 'dead' : 'k' });
    const uid = `${act.type}-${act.t_valid}`;
    if (inv) {
      events.push(ev('K', 'kl_invalid', act.dir, inv.t, M5, `K: ${act.type} invalidated`,
        `An M5 body closed outside the POI (${f(act.lo)} to ${f(act.hi)}). All older key levels are invalid too. Watch for the QML.`, `${uid}-inv-${inv.t}`));
      const q = qmlFor(act, inv, h1, m5, p, atr1);
      if (q) {
        state.qml = q;
        overlays.push({ type: 'box', lo: q.lo, hi: q.hi, t0: q.t, label: 'QML', tone: q.invalidated_t ? 'dead' : 'qml' });
        if (q.at_extreme && !q.invalidated_t) {
          const qp = tradePlan(q.lo, q.hi, q.dir, atr5, p);
          q.plan = qp;
          events.push(ev('QML', 'qml_valid', q.dir, q.t, M5, `QML: ${side(q.dir)} Quasimodo level formed at the extreme`,
            `QML POI ${f(q.lo)} to ${f(q.hi)}. ${cap(side(q.dir))} limit ${f(qp.entry)}, SL ${f(qp.sl)}, TP (1:${p.rr}) ${f(qp.tp)}.`, `qml-${q.t}`, { lo: q.lo, hi: q.hi, ...qp }));
          for (const cf of confirmations(m5, q.lo, q.hi, q.dir, q.t).slice(-3)) {
            events.push(ev('QML', 'qml_entry', q.dir, cf.t + M5, M5, `QML: ${side(q.dir)} confirmation (${nice(cf.type)})`,
              `${cap(nice(cf.type))} inside the QML POI. ${cap(side(q.dir))} limit ${f(qp.entry)}, SL ${f(qp.sl)}, TP ${f(qp.tp)}.`, `qml-${q.t}-${cf.t}-${cf.type}`));
          }
        }
      }
    } else if (act.high_prob) {
      events.push(ev('K', 'kl_valid', act.dir, act.t_valid + H1, H1, `K: valid ${act.type} key level (${side(act.dir)} setup)`,
        `POI ${f(act.lo)} to ${f(act.hi)}, ${act.wicks} wick(s) inside (high probability). ${cap(side(act.dir))} limit ${f(plan.entry)}, SL ${f(plan.sl)}, TP (1:${p.rr}) ${f(plan.tp)}.`,
        uid, { lo: act.lo, hi: act.hi, ...plan }));
      const cfs = confirmations(m5, act.lo, act.hi, act.dir, act.t_valid + H1).slice(-3);
      state.signals = cfs;
      for (const cf of cfs) {
        events.push(ev('K', 'kl_entry', act.dir, cf.t + M5, M5, `K: ${side(act.dir)} confirmation on ${act.type} (${nice(cf.type)})`,
          `${cap(nice(cf.type))} inside the POI. ${cap(side(act.dir))} limit ${f(plan.entry)}, SL ${f(plan.sl)}, TP ${f(plan.tp)}.`,
          `${uid}-${cf.t}-${cf.type}`, { lo: act.lo, hi: act.hi, ...plan }));
      }
      const adv = advanced(act, m5, p, null);
      state.adv = adv;
      overlays.push({ type: 'box', lo: adv.half[0], hi: adv.half[1], t0: act.t0, label: '50% POI', tone: 'adv' });
      for (const z of adv.zones) {
        overlays.push({ type: 'box', lo: z.lo, hi: z.hi, t0: z.t, label: 'bjeff zone', tone: 'adv2' });
        if (z.active_t) {
          events.push(ev('ADV', 'bjeff_valid', act.dir, z.active_t, M5, 'ADV: bjeff zone is active',
            `M5 key level ${f(z.lo)} to ${f(z.hi)} inside the 50% of the H1 ${act.type}. A body candle closed inside it. Wait for any confirmation entry.`, `bj-${act.t_valid}-${z.t}`));
        }
      }
      for (const sg of adv.signals) {
        events.push(ev('ADV', 'adv_entry', act.dir, sg.t + M5, M5, `ADV: ${side(act.dir)} confirmation in the bjeff zone (${nice(sg.type)})`,
          `${cap(nice(sg.type))} after a body closed inside the bjeff zone. SL slightly outside the POI, TP by your risk reward ratio.`, `bj-${act.t_valid}-${sg.t}-${sg.type}`));
      }
    }
  }
  Object.assign(state, { candles: { m5: tail(m5, 150), h1: tail(h1, 150), h4: tail(h4, 120) }, overlays, digits, atr: { h1: atr1, m5: atr5 } });
  return { state, events };
}
