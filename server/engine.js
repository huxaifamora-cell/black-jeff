// SORK concept engine. Pure functions over lists of CLOSED candles {t,o,h,l,c}. No network, no I/O.
// Timeframes: H4 (market structure), H1 (order flow, reclamation, key levels, QML), M5 (entries).
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
  h1Days: 180,          // H1 candles used everywhere: the last 6 months (key levels, order flow, reclamation, QML liquidity)
  maxKlWicks: 2,        // high probability key level: no more than this many wicks in the POI
  slBufferAtr: 0.25,    // "slightly outside the POI" = this x M5 ATR
  rr: 2.0,              // risk reward ratio used for the example TP
  plqNearAtr: 0.5,      // QML reversal is "close to" a point of liquidity when it is within this x H1 ATR of it
  liveM5: true,         // the M5 candle still forming is used (live price)
  liveHtf: true,        // H1 and H4 charts show the forming candle too; the H1 / H4 rules still only use closed candles
  klWithBias: true,     // trend continuation: only key levels in the direction of the internal (H1) order flow count (RBS when it is bullish, SBR when it is bearish). QML is the exception.
  maxScanH1: 4320,      // H1 candles scanned for reclamations (after the inducement / disruption BOS); 6 months of H1
};

export const C = (t, o, h, l, c) => ({ t, o, h, l, c });
const bull = (c) => c.c > c.o;
const bear = (c) => c.c < c.o;
const top = (c) => Math.max(c.o, c.c);
const bot = (c) => Math.min(c.o, c.c);
const body = (c) => Math.abs(c.c - c.o);
const upWick = (c) => c.h - top(c);
const loWick = (c) => bot(c) - c.l;
// The last `days` of candles, counted back from the newest candle (H1 uses 6 months).
export const lastDays = (cs, days) => (cs.length ? cs.filter((c) => c.t >= cs[cs.length - 1].t - days * 86400) : cs);
export const mirror = (c) => ({ t: c.t, o: -c.o, h: -c.l, l: -c.h, c: -c.c });

// The M5 candle that is still forming is flagged `forming` by the feed. Signals (confirmation patterns, M5 key levels, active bjeff zone)
// only use closed candles; invalidations and the price touching a level use the live candle too.
export const closedOnly = (cs) => (cs.length && cs[cs.length - 1].forming ? cs.slice(0, -1) : cs);
// ATR of M5 candles: the forming candle is left out (just opened it is tiny and would shrink the average).
export const atrM5 = (cs, p) => atr(closedOnly(cs), p.atrLen);

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
  for (const b of bos) {
    b.slq = hasSlq(cs, b);
    // a BOS is valid only with structural liquidity (SLQ); 2 or more BOS without SLQ no longer count as the liquidity
    b.valid = b.slq;
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

// POI box (inducement, disruption and points of liquidity), as in the study guide: the ORDER BLOCK CANDLE ONLY, from body to body.
// Wicks are left out and the box never extends to the candle after the order block (that candle is often the BOS candle itself).
// Exception: a LONG order block body uses only 50% of its body (bullish: the bottom half, bearish: the top half).
export function poiFromOb(cs, j, d, p) {
  const c = cs[j];
  let lo = bot(c), hi = top(c);
  const prev = cs.slice(Math.max(0, j - p.avgBodyLen), j);
  const avg = prev.length ? prev.reduce((a, x) => a + body(x), 0) / prev.length : body(c);
  const b = hi - lo;
  if (avg > 0 && b > p.longBodyMult * avg) {
    if (d === 1) hi = lo + b / 2;   // bullish scenario: bottom 50% of the body
    else lo = hi - b / 2;           // bearish scenario: top 50% of the body
  }
  return [lo, hi];
}

function poiOf(cs, b, role, p) {
  const j = orderBlock(cs, b, p);
  const [lo, hi] = poiFromOb(cs, j, b.dir, p);
  return { role, dir: b.dir, lo, hi, line: b.tip_price, bos_t: b.t, bos_idx: b.idx, ob_t: cs[j].t, bos_level: b.level, broken_t: cs[b.broken_idx].t };
}

// Internal order flow (H1) is the trend. It is read in two steps, walking the H1 candles in time order.
//  1. Find the PREVIOUS INVALIDATED order flow. A flow (direction d) has an inducement and a disruption; when an H1 body closes beyond the
//     disruption POI that flow is broken (a pullback at the disruption) and the NEW order flow is mapped the other way straight away.
//  2. Look for the NEW order flow only among the breaks of structure that come after that break. Only VALID breaks of structure
//     count (structural liquidity, via markValid), so a small break with no liquidity behind it never becomes an inducement.
// Inducement = the latest valid BOS of the flow, disruption = the valid BOS before it, the older ones are points of liquidity.
// A flow needs BOTH an inducement and a disruption; with a single valid BOS nothing is marked (it is kept in `pending`, never drawn).
// The flow is seeded from the first valid H1 BOS in the window (or from `trend` when a direction is passed in, as the tests do).
//
// After the disruption POI is broken the flip is NOT official yet. Whichever happens first:
//  1. the next point of liquidity (the older BOS POI beyond the disruption) is invalidated by a WICK: the new trend is official;
//  2. an H1 body closes back beyond the disruption POI: the old flow is restored, as a reclamation (when a reclamation of that POI completed
//     since the break) or as a break out (the first valid key level after it is not traded);
// While waiting, the new order flow is mapped in the other direction (it can also be restored if 2 happens). When there is no point of
// liquidity beyond the disruption to reach, the flip becomes official once the new flow has both an inducement and a disruption.
//
// Pullback at the inducement: price comes back to the inducement POI. It never changes the trend. It has resumed once a valid BOS forms in the
// trend direction (`pullback.resume_t`); trading then starts from the second valid key level after that (the first one is not traded).
export function orderFlow(h1, trend, p) {
  const res = { dir: trend || 0, pois: [], pending: null, invalidated: null, remapped: false, recovered: null, pending_flip: null, official: null, pullback: null };
  if (trend === 0) return res;
  const valid = markValid(h1, findBos(h1, p.swingK)).filter((b) => b.valid);
  if (trend == null) { if (!valid.length) return res; trend = valid[0].dir; res.dir = trend; }
  const at = new Map();
  for (const b of valid) { if (!at.has(b.idx)) at.set(b.idx, []); at.get(b.idx).push(b); }
  const dpCache = new Map(), disPoi = (b) => { if (!dpCache.has(b.idx)) dpCache.set(b.idx, poiOf(h1, b, 'disruption', p)); return dpCache.get(b.idx); };
  // the point of liquidity a pullback from the disruption has to reach: the nearest older BOS POI that lies beyond the disruption POI
  const nextPlq = (lst, dp, dir) => {
    for (let j = lst.length - 3; j >= 0; j--) {
      const q = poiOf(h1, lst[j], 'plq', p);
      if (dir === 1 ? q.lo < dp.lo : q.hi > dp.hi) return q;
    }
    return null;
  };
  let d = trend, list = [], last = null, saved = null, pb = null; // current flow: its direction and its valid BOS (oldest first); last = latest invalidation; saved = the flow that was broken and is not final yet; pb = pullback at the inducement
  for (let i = 0; i < h1.length; i++) {
    const c = h1[i];
    // a body close back beyond the disruption POI (trend side) before the flip is official: the old order flow is restored
    if (saved !== null) {
      const dp = saved.poi;
      if ((saved.dir === 1 && c.c > dp.hi) || (saved.dir === -1 && c.c < dp.lo)) {
        const rc = reclamation(h1.slice(0, i + 1), dp, p).last_complete;
        res.recovered = { kind: rc !== null && rc > saved.t ? 'reclamation' : 'breakout', dir: saved.dir, invalidated_t: saved.t, t: c.t, idx: i };
        d = saved.dir; list = saved.list; last = saved.prev; saved = null; pb = null;
      }
    }
    if (saved === null && list.length >= 2) {         // is the disruption POI of the flow broken by a body close?
      const dp = disPoi(list[list.length - 2]);
      if ((d === 1 && c.c < dp.lo) || (d === -1 && c.c > dp.hi)) {
        saved = { dir: d, t: c.t, poi: dp, list: list.slice(), prev: last, plq: nextPlq(list, dp, d) };   // prev = the invalidation before this one (if the flow was itself a flipped one)
        last = { dir: d, t: c.t, idx: i, poi: dp };
        res.recovered = null; res.official = null; pb = null;
        d = -d;                                       // the new flow is mapped the other way, but it is not official yet
        list = valid.filter((b) => b.dir === d && b.idx >= i - 3 && b.idx < i);
      }
    }
    if (saved !== null) {                             // the flip becomes official when the next point of liquidity is invalidated by a wick
      const q = saved.plq;
      if (q ? (saved.dir === 1 ? c.l < q.lo : c.h > q.hi) : list.length >= 2) {
        res.official = { dir: d, invalidated_t: saved.t, t: c.t, idx: i, plq: q ? { lo: q.lo, hi: q.hi } : null };
        saved = null;
      }
    }
    // pullback at the inducement: price comes back into the inducement POI (it does not change the trend direction)
    if (saved === null && list.length >= 2 && (pb === null || pb.resume_t)) {
      const ind = list[list.length - 1];
      if (i > ind.idx) {
        const q = poiOf(h1, ind, 'inducement', p);
        if (d === 1 ? c.l <= q.hi : c.h >= q.lo) pb = { dir: d, t: c.t, idx: i, resume_t: null };
      }
    }
    for (const b of at.get(i) || []) {
      if (b.dir === d) {
        list.push(b);
        if (pb !== null && !pb.resume_t) pb.resume_t = c.t;   // the first valid BOS in the trend direction after the pullback = the trend resumes
      } else if (last !== null && saved === null && list.length < 2) { d = b.dir; list = [b]; pb = null; }   // flipped for good, no disruption yet: follow the latest valid BOS
    }
  }
  res.dir = d; res.invalidated = last; res.remapped = last !== null;
  if (saved !== null) res.pending_flip = { old_dir: saved.dir, t: saved.t, plq: saved.plq ? { lo: saved.plq.lo, hi: saved.plq.hi } : null };
  res.pullback = pb;
  if (list.length === 1) { res.pending = { dir: d, bos_t: list[0].t, bos_idx: list[0].idx }; return res; }
  if (list.length < 2) return res;
  const ind = list[list.length - 1], dis = list[list.length - 2];
  res.pois = [poiOf(h1, ind, 'inducement', p), poiOf(h1, dis, 'disruption', p), ...list.slice(-4, -2).map((b) => poiOf(h1, b, 'plq', p))];
  return res;
}

// ---------------------------------------------------------------- reclamation (H1)
// Five steps, bullish version. The bearish version runs on mirrored candles.
// Runs on H1 candles, against the H1 inducement / disruption POI it belongs to.
export function reclamation(h1, poi, p) {
  const d = poi.dir;
  let lo = poi.lo, hi = poi.hi;
  let cs = h1.filter((c) => c.t > poi.bos_t).slice(-p.maxScanH1);
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
// A key level is two opposite candle bodies side by side.
// Resistant (R, bull then bear): the TOPS of the two bodies must be equal or almost equal; the bottoms can be any length.
// Support (S, bear then bull): the BOTTOMS of the two bodies must be equal or almost equal; the tops can be any length.
// RBS shares the logic of R, SBR shares the logic of S.
export function findKls(cs, p, atrV, lookback) {
  const out = [], tol = p.klTolAtr * atrV;
  for (let i = Math.max(1, cs.length - lookback); i < cs.length; i++) {
    const a = cs[i - 1], b = cs[i];
    if (body(a) === 0 || body(b) === 0 || bull(a) === bull(b)) continue;
    const kind = bull(a) ? 'R' : 'S';
    const equal = kind === 'R' ? Math.abs(top(a) - top(b)) <= tol : Math.abs(bot(a) - bot(b)) <= tol;
    if (!equal) continue;
    const tip = kind === 'R' ? (upWick(a) >= upWick(b) ? a : b).h : (loWick(a) >= loWick(b) ? a : b).l;
    out.push({ kind, i, t0: a.t, t1: b.t, lo: Math.min(bot(a), bot(b)), hi: Math.max(top(a), top(b)), tip, eq: kind === 'R' ? 'top' : 'bottom' });
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

// Key levels must agree with the order flow. In an uptrend, once price is above the inducement (or the disruption) POI, a key level only
// counts when it was formed AFTER that POI's BOS and sits entirely ABOVE the POI box. The downtrend is the exact inverse (after it, and
// entirely below). Checked separately for the inducement and for the disruption; a POI that price has not moved beyond sets no limit.
export function klFitsOrderFlow(k, of, price) {
  if (!of || !of.pois || price == null) return true;
  for (const poi of of.pois) {
    if (poi.role !== 'inducement' && poi.role !== 'disruption') continue;
    if (poi.dir !== k.dir) continue;
    const beyond = k.dir === 1 ? price > poi.hi : price < poi.lo;       // price is already past the POI in the trend direction
    if (!beyond) continue;
    if (!(k.t0 > poi.bos_t)) return false;                              // built from candles that came before the POI formed
    if (k.dir === 1 ? !(k.lo >= poi.hi) : !(k.hi <= poi.lo)) return false;   // not fully above (below) the POI box
  }
  return true;
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
// Points of liquidity: every H1 BOS in the window (6 months) except the current inducement and disruption.
// Each one is a POI (order block box) plus its horizontal line.
export function liquidityPoints(h1, of, p) {
  const skip = new Set(((of && of.pois) || []).filter((x) => x.role === 'inducement' || x.role === 'disruption').map((x) => x.bos_idx));
  if (of && of.pending) skip.add(of.pending.bos_idx);     // a BOS waiting to become the inducement is not a point of liquidity yet
  const out = [];
  for (const b of findBos(h1, p.swingK)) {
    if (skip.has(b.idx)) continue;
    const poi = poiOf(h1, b, 'plq', p);
    out.push({ dir: b.dir, t: b.t, line: b.tip_price, lo: poi.lo, hi: poi.hi });
  }
  return out;
}

// Is the reversal price at, or close to, a point of liquidity that already existed when the reversal formed?
// Distance to a point = 0 inside its POI, otherwise the gap to the POI edge or to its line, whichever is smaller.
export function nearLiquidity(price, tBefore, liq, atr1, p) {
  const tol = p.plqNearAtr * atr1;
  let best = null;
  for (const q of liq) {
    if (q.t >= tBefore) continue;                                   // it must exist before the reversal formed
    const toBox = price < q.lo ? q.lo - price : price > q.hi ? price - q.hi : 0;
    const dist = Math.min(toBox, Math.abs(price - q.line));
    if (dist <= tol && (best === null || dist < best.dist)) best = { t: q.t, dir: q.dir, lo: q.lo, hi: q.hi, line: q.line, dist, inside: toBox === 0 };
  }
  return best;
}

// After a key level is invalidated, build the inverse key level (Quasimodo level) POI.
// `liq` = points of liquidity (see liquidityPoints). The QML only counts when its reversal point is at or close to one.
export function qmlFor(kl, inv, h1, m5, p, atr1, liq = []) {
  const t0 = kl.t0, tInv = inv.t;
  const hcs = h1.filter((c) => c.t >= t0 && c.t < tInv);
  const lastH1End = hcs.length ? hcs[hcs.length - 1].t + H1 : t0;
  const all = hcs.concat(m5.filter((c) => c.t >= lastH1End && c.t < tInv));
  if (!all.length) return null;
  let lo, hi, d, extreme, extremeT = all[0].t;
  if (kl.dir === 1) {          // RBS invalidated -> QML sells
    extreme = -Infinity;
    for (const c of all) if (c.h > extreme) { extreme = c.h; extremeT = c.t; }
    [lo, hi, d] = [kl.hi, extreme, -1];
  } else {                     // SBR invalidated -> QML buys
    extreme = Infinity;
    for (const c of all) if (c.l < extreme) { extreme = c.l; extremeT = c.t; }
    [lo, hi, d] = [extreme, kl.lo, 1];
  }
  if (hi <= lo) return null;
  const plq = nearLiquidity(extreme, extremeT, liq, atr1, p);
  let dead = null;
  for (const c of m5) {
    if (c.t >= tInv && ((d === -1 && c.c > hi) || (d === 1 && c.c < lo))) { dead = c.t + M5; break; }
  }
  return { dir: d, lo, hi, t: tInv, extreme, extreme_t: extremeT, at_liquidity: plq !== null, plq, invalidated_t: dead };
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
  const seg = m5.filter((c) => c.t >= since && (invT === null || invT === undefined || c.t < invT));   // live: price touching the 50% line counts at once
  const segC = closedOnly(seg);                                                                          // zones and signals wait for the candle to close
  let entered = null;
  for (const c of seg) {
    if ((d === 1 && c.l <= mid) || (d === -1 && c.h >= mid)) { entered = c.t + M5; break; }
  }
  const zones = [];
  if (entered !== null) {
    const a5 = atrM5(segC, p);
    for (const z of validateKls(segC, findKls(segC, p, a5, segC.length), p)) {
      // Only a valid M5 RBS (for a buy) or SBR (for a sell) counts: the same direction as the H1 key level.
      if (z.status === 'valid' && z.dir === d && z.lo >= zl - 1e-12 && z.hi <= zh + 1e-12 && z.t1 + M5 >= entered - M5) {
        let active = null;
        for (const c of segC) if (c.t > z.t1 && z.lo <= c.c && c.c <= z.hi) { active = c.t + M5; break; }
        zones.push({ lo: z.lo, hi: z.hi, t0: z.t0, t: z.t1, active_t: active });
      }
    }
  }
  const uniq = new Map();
  for (const z of zones) if (z.active_t) for (const s of reversalSignals(segC, d, z.active_t)) uniq.set(`${s.t}|${s.type}`, s);
  const signals = [...uniq.values()].sort((a, b) => a.t - b.t).slice(-3);
  return { half: [zl, zh], entered_t: entered, zones: zones.slice(-3), signals };
}

// ---------------------------------------------------------------- full evaluation of one symbol
const ev = (concept, kind, dir, t, tf, title, body, uid, extra = {}) =>
  ({ concept, kind, dir, t: Math.trunc(t), tf, title, body, uid: String(uid), extra });
const side = (d) => (d === 1 ? 'buy' : 'sell');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// A move out of the box is named after the trade direction (dir = 1 buy -> bullish breakout, -1 sell -> bearish breakout).
export const nice = (s, dir = 0) => s === 'move_out' ? (dir === 1 ? 'bullish breakout' : dir === -1 ? 'bearish breakout' : 'breakout') : s.replace('_', ' ');
const tail = (cs, n) => cs.slice(-n).map((c) => [c.t, c.o, c.h, c.l, c.c]);

export function evaluate(h4Live, h1Live, m5, p = defaultParams, digits = 3) {
  // H4 and H1 arrive live (the forming candle is the last one, flagged `forming`) so the chart can show it. All the H4 / H1 rules
  // (BOS, order flow, reclamation, key levels, QML) are judged on CLOSED candles only, because they depend on a body CLOSING
  // beyond a level: a forming candle would make a POI appear and disappear while the candle is still moving.
  const h4 = closedOnly(h4Live), h1All = closedOnly(h1Live);
  const h1 = lastDays(h1All, p.h1Days);        // H1 candles: only the last 6 months are used
  const f = (x) => Number(x).toFixed(digits);
  const events = [], overlays = [];
  const state = { s: null, o: null, r: [], k: null, qml: null, adv: null, signals: [] };
  const minLen = 2 * p.swingK + 4;
  if (h4.length < minLen || h1.length < minLen || m5.length < minLen) {
    Object.assign(state, { note: 'Not enough candle history yet.', candles: { m5: tail(m5, 300), h1: tail(h1Live, 300), h4: tail(h4Live, 200) }, overlays, digits });
    return { state, events };
  }
  const m5c = closedOnly(m5);                  // closed M5 candles: confirmation patterns wait for the candle to close
  const atr1 = atr(h1, p.atrLen), atr5 = atrM5(m5, p);

  // ---- S: trend = internal order flow (H1). The H4 structure is only drawn on the H4 chart (neutral BOS lines); it is never shown as a bias.
  const ms = marketStructure(h4, p);
  const of = orderFlow(h1, null, p);
  const trend = of.dir;
  const sInd = of.pois.find((x) => x.role === 'inducement');
  const pf = of.pending_flip;
  state.s = {
    bias: trend, bias_shift: false, bias_t: sInd ? sInd.bos_t : null, bias_level: sInd ? sInd.bos_level : null,
    trend, shift_pending: false, valid: trend !== 0 && (of.pois.length > 0 || !!of.pending),
    trend_invalidated: pf ? { by: 'disruption', old_dir: pf.old_dir, t: pf.t + H1, plq: pf.plq } : null,
    official: of.official ? { t: of.official.t + H1, dir: of.official.dir } : null,
    anchor_t: sInd ? sInd.bos_t : null, level: sInd ? sInd.bos_level : null, slq: sInd ? true : null,
    swings: ms.swings,
    bos: ms.bos.map((b) => ({ dir: b.dir, t: b.t, level: b.level, valid: b.valid, slq: b.slq })),
  };
  if (sInd && !pf) {
    events.push(ev('S', 'trend_valid', trend, sInd.bos_t + H1, H1, `S: H1 ${trend === 1 ? 'uptrend' : 'downtrend'} is valid`,
      `Internal order flow is ${trend === 1 ? 'bullish' : 'bearish'}: valid BOS (liquidity + BOS) broke ${f(sInd.bos_level)}. Look for ${side(trend)} setups on H1.`, sInd.bos_t));
  }
  for (const b of ms.valid_bos) {
    // the label carries the current H4 bias (not the direction of that single break)
    overlays.push({ type: 'line', tf: 'h4', y: b.level, t0: h4[b.broken_idx].t, label: 'BOS', tone: 's' });
  }

  // ---- O: order flow on H1
  state.o = of;
  const rec = of.recovered;
  for (const poi of of.pois) {
    if (poi.role === 'inducement' || poi.role === 'disruption') {
      events.push(ev('O', poi.role, poi.dir, poi.bos_t + H1, H1, `O: new ${poi.role} POI (${poi.dir === 1 ? 'bullish' : 'bearish'})`,
        `POI ${f(poi.lo)} to ${f(poi.hi)} (order block body). Line at ${f(poi.line)}.`, `${poi.role}-${poi.bos_t}`, { lo: poi.lo, hi: poi.hi }));
    }
    // H1 chart: dotted grey horizontal line at the level the inducement / disruption BOS broke, labelled BOS
    if (poi.role === 'inducement' || poi.role === 'disruption') overlays.push({ type: 'line', tf: 'h1', grp: 'o', y: poi.bos_level, t0: poi.broken_t, label: 'BOS', tone: 'bos', dotted: true });
    if (poi.role !== 'plq') overlays.push({ type: 'box', grp: 'o', lo: poi.lo, hi: poi.hi, t0: poi.ob_t, label: cap(poi.role), tone: poi.role === 'disruption' ? 'dis' : 'o' });   // point of liquidity is not drawn
  }
  if (of.invalidated) {
    const iv = of.invalidated;
    events.push(ev('O', 'invalidated', iv.dir, iv.t + H1, H1, 'O: inducement and disruption invalidated',
      `An H1 body closed beyond the disruption POI (a pullback at the disruption). The new order flow is now mapped ${iv.dir === 1 ? 'down' : 'up'}. If price comes back past the disruption POI first (reclamation or break out), the old order flow is restored.`, `inv-${iv.t}`));
  }
  if (of.official) {
    const ofc = of.official;
    events.push(ev('O', 'official', ofc.dir, ofc.t + H1, H1, `O: new ${ofc.dir === 1 ? 'uptrend' : 'downtrend'} is official`,
      `A wick invalidated the next point of liquidity${ofc.plq ? ` (POI ${f(ofc.plq.lo)} to ${f(ofc.plq.hi)})` : ''}, so the internal order flow flip is official.`, `official-${ofc.invalidated_t}-${ofc.t}`));
  }

  if (rec) {
    const word = rec.kind === 'reclamation' ? 'reclaimed' : 'broke out';
    events.push(ev('O', rec.kind, rec.dir, rec.t + H1, H1, `O: disruption ${rec.kind === 'reclamation' ? 'reclaimed' : 'break out'}`,
      rec.kind === 'reclamation'
        ? `The disruption POI was invalidated, then price ${word} it. The ${rec.dir === 1 ? 'up' : 'down'}trend is still valid and its order flow is kept.`
        : `The disruption POI was invalidated, then price returned and ${word}. The ${rec.dir === 1 ? 'up' : 'down'}trend order flow is kept, but it is not proven to hold: skip the first valid key level and trade from the second.`,
      `${rec.kind}-${rec.invalidated_t}-${rec.t}`));
  }

  // ---- R: reclamation on H1, at the inducement and disruption POIs (confirmation only)
  state.r = [];
  for (const poi of of.pois.filter((x) => x.role === 'inducement' || x.role === 'disruption')) {
    const r = reclamation(h1, poi, p);
    state.r.push({ role: poi.role, dir: poi.dir, state: r.state, last_complete: r.last_complete, lo: poi.lo, hi: poi.hi });
    if (r.last_complete) {
      events.push(ev('R', 'reclamation', poi.dir, r.last_complete + H1, H1, `R: valid ${poi.dir === 1 ? 'bullish' : 'bearish'} reclamation`,
        `H1 reclamation completed at the ${poi.role} POI (${f(poi.lo)} to ${f(poi.hi)}). Use it as a confirmation, not as an entry.`,
        `${poi.role}-${poi.bos_t}-${r.last_complete}`));
    }
  }

  // ---- K: key levels on H1
  const vk = validateKls(h1, findKls(h1, p, atr1, h1.length), p);
  // Trend continuation model: the key level must agree with the internal (H1) order flow (no order flow = no key level). A QML is built from an invalidated key level and may go against it.
  const livePx = m5.length ? m5[m5.length - 1].c : null;
  // No valid order flow (inducement AND disruption both mapped) = no valid key level, so nothing is drawn, alerted or marked ready.
  const hasFlow = ['inducement', 'disruption'].every((r) => of.pois.some((x) => x.role === r));
  let valid = !hasFlow ? [] : vk.filter((k) => k.status === 'valid' && (!p.klWithBias || (of.dir !== 0 && k.dir === of.dir)) && klFitsOrderFlow(k, of, livePx));
  // Break out (disruption invalidated, then price returned and carried on): the trend is not proven yet, so the FIRST valid key level after
  // the return is not traded. Only the second valid key level (and later ones) counts.
  if (rec && rec.kind === 'breakout') {
    const after = valid.filter((k) => k.t_valid > rec.t).sort((a, b) => a.t_valid - b.t_valid);
    rec.first_kl_t = after.length ? after[0].t_valid : null;
    rec.waiting = after.length < 2;
    valid = after.slice(1);
  }
  // Pullback at the inducement, then the trend resumes: the FIRST valid key level after the resume is not traded, trading starts from the second.
  const pbk = of.pullback;
  if (pbk && !rec) {
    const after = pbk.resume_t ? valid.filter((k) => k.t_valid > pbk.resume_t).sort((a, b) => a.t_valid - b.t_valid) : [];
    state.pullback = { t: pbk.t, resumed: !!pbk.resume_t, resume_t: pbk.resume_t, waiting: after.length < 2 };
    valid = after.slice(1);
  }
  const kState = { active: null, pending: [] };      // RKL/SKL (levels not yet valid) are not shown or alerted
  state.k = kState;
  if (valid.length) {
    const act = valid.reduce((a, k) => (k.j > a.j || (k.j === a.j && k.i > a.i) ? k : a));
    const inv = klInvalidation(act, h1, m5);
    const plan = tradePlan(act.lo, act.hi, act.dir, atr5, p);
    kState.active = { type: act.type, dir: act.dir, lo: act.lo, hi: act.hi, t0: act.t0, t_valid: act.t_valid, wicks: act.wicks,
      high_prob: act.high_prob, invalidated: inv, plan };
    overlays.push({ type: 'box', grp: 'k', lo: act.lo, hi: act.hi, t0: act.t0, label: act.type + ' Key Level' + (act.high_prob ? '' : ' (low probability)'), tone: inv ? 'dead' : 'k' });
    const uid = `${act.type}-${act.t_valid}`;
    if (inv) {
      events.push(ev('K', 'kl_invalid', act.dir, inv.t, M5, `K: ${act.type} invalidated`,
        `An M5 body closed outside the POI (${f(act.lo)} to ${f(act.hi)}). All older key levels are invalid too. Watch for the QML.`, `${uid}-inv-${inv.t}`, { sub: act.type }));
      const q = qmlFor(act, inv, h1, m5, p, atr1, liquidityPoints(h1, of, p));
      if (q) {
        state.qml = q;
        overlays.push({ type: 'box', lo: q.lo, hi: q.hi, t0: q.t, label: 'QML', tone: q.invalidated_t ? 'dead' : 'qml' });
        if (q.at_liquidity && !q.invalidated_t) {
          const qp = tradePlan(q.lo, q.hi, q.dir, atr5, p);
          q.plan = qp;
          events.push(ev('QML', 'qml_valid', q.dir, q.t, M5, `QML: ${side(q.dir)} Quasimodo level formed ${q.plq.inside ? 'at' : 'close to'} a point of liquidity`,
            `Reversal at ${f(q.extreme)}, ${q.plq.inside ? 'inside' : 'close to'} an H1 point of liquidity (POI ${f(q.plq.lo)} to ${f(q.plq.hi)}). QML POI ${f(q.lo)} to ${f(q.hi)}. ${cap(side(q.dir))} limit ${f(qp.entry)}, SL ${f(qp.sl)}, TP (1:${p.rr}) ${f(qp.tp)}.`, `qml-${q.t}`, { lo: q.lo, hi: q.hi, ...qp, sub: 'QML' }));
          for (const cf of confirmations(m5c, q.lo, q.hi, q.dir, q.t).slice(-3)) {
            events.push(ev('QML', 'qml_entry', q.dir, cf.t + M5, M5, `QML: ${side(q.dir)} confirmation (${nice(cf.type, q.dir)})`,
              `${cap(nice(cf.type, q.dir))} inside the QML POI. ${cap(side(q.dir))} limit ${f(qp.entry)}, SL ${f(qp.sl)}, TP ${f(qp.tp)}.`, `qml-${q.t}-${cf.t}-${cf.type}`, { sub: 'QML', conf: nice(cf.type, q.dir) }));
          }
        }
      }
    } else if (act.high_prob) {
      events.push(ev('K', 'kl_valid', act.dir, act.t_valid + H1, H1, `K: valid ${act.type} key level (${side(act.dir)} setup)`,
        `POI ${f(act.lo)} to ${f(act.hi)}, ${act.wicks} wick(s) inside (high probability). ${cap(side(act.dir))} limit ${f(plan.entry)}, SL ${f(plan.sl)}, TP (1:${p.rr}) ${f(plan.tp)}.`,
        uid, { lo: act.lo, hi: act.hi, ...plan, sub: act.type }));
      const cfs = confirmations(m5c, act.lo, act.hi, act.dir, act.t_valid + H1).slice(-3);
      state.signals = cfs;
      for (const cf of cfs) {
        events.push(ev('K', 'kl_entry', act.dir, cf.t + M5, M5, `K: ${side(act.dir)} confirmation on ${act.type} (${nice(cf.type, act.dir)})`,
          `${cap(nice(cf.type, act.dir))} inside the POI. ${cap(side(act.dir))} limit ${f(plan.entry)}, SL ${f(plan.sl)}, TP ${f(plan.tp)}.`,
          `${uid}-${cf.t}-${cf.type}`, { lo: act.lo, hi: act.hi, ...plan, sub: act.type, conf: nice(cf.type, act.dir) }));
      }
      const adv = advanced(act, m5, p, null);
      state.adv = adv;
      overlays.push({ type: 'box', lo: adv.half[0], hi: adv.half[1], t0: act.t0, label: '50% POI', tone: 'adv' });
      for (const z of adv.zones) {
        overlays.push({ type: 'box', lo: z.lo, hi: z.hi, t0: z.t0, label: 'bjeff zone', tone: 'adv2' });
        if (z.active_t) {
          events.push(ev('ADV', 'bjeff_valid', act.dir, z.active_t, M5, 'ADV: bjeff zone is active',
            `M5 key level ${f(z.lo)} to ${f(z.hi)} inside the 50% of the H1 ${act.type}. A body candle closed inside it. Wait for any confirmation entry.`, `bj-${act.t_valid}-${z.t}`, { sub: act.type }));
        }
      }
      for (const sg of adv.signals) {
        events.push(ev('ADV', 'adv_entry', act.dir, sg.t + M5, M5, `ADV: ${side(act.dir)} confirmation in the bjeff zone (${nice(sg.type, act.dir)})`,
          `${cap(nice(sg.type, act.dir))} after a body closed inside the bjeff zone. SL slightly outside the POI, TP by your risk reward ratio.`, `bj-${act.t_valid}-${sg.t}-${sg.type}`, { sub: act.type, conf: nice(sg.type, act.dir) }));
      }
    }
  }
  Object.assign(state, { candles: { m5: tail(m5, 300), h1: tail(h1Live, 300), h4: tail(h4Live, 200) }, overlays, digits, atr: { h1: atr1, m5: atr5 } });
  return { state, events };
}
