// SORK concept engine. Pure functions over lists of CLOSED candles {t,o,h,l,c}. No network, no I/O.
// Timeframes: H4 (market structure), H1 (order flow, reclamation, key levels, QML), M5 (entries).
// Several SORK rules are judged "by eye" by the trader. Where a rule needs a number it is a field of
// `defaultParams` so it can be tuned without touching the logic.

export const H4 = 14400, H1 = 3600, M5 = 300;

export const defaultParams = {
  swingK: 1,            // candles on each side that confirm a swing high/low
  bosStructural: true,  // a BOS must close beyond the highest unbroken swing high / lowest unbroken swing low of the leg (a true new HH / LL). false = old behaviour (latest swing only)
  atrLen: 14,
  longBodyMult: 1.5,    // "longer than average" body = more than this x the average body
  avgBodyLen: 20,
  klTolAtr: 0.10,       // "equal / almost identical" edges = within this x ATR
  h1Days: 180,          // H1 candles used everywhere: the last 6 months (key levels, order flow, reclamation, QML liquidity)
  maxKlWicks: 2,        // high probability key level: no more than this many wicks in the POI
  slBufferAtr: 0.25,    // "slightly outside the POI" = this x M5 ATR
  rr: 2.0,              // risk reward ratio used for the example TP
  plqNearAtr: 0.5,      // QML reversal is "close to" a point of liquidity when it is within this x H1 ATR of it
  liveM5: true,         // the M5 candle still forming is used (live price)
  liveHtf: true,        // H1 and H4 charts show the forming candle too; the H1 / H4 rules still only use closed candles
  klWithBias: true,     // trend continuation: only key levels in the direction of the internal (H1) order flow count (RBS when it is bullish, SBR when it is bearish). QML is the exception.
  m5PoiNearAtr: 2.0,    // an unmitigated M5 order block is "close to" the original M5 order block when the gap between the two boxes is at most this x the M5 ATR
  m5PoiLongMult: 1.5,   // an M5 order block candle is "too long" when its full range (wick + body) is more than this x the average M5 range
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

// Old behaviour (only the latest swing is tracked). Kept for comparison: set bosStructural: false.
export function findBosLatestSwing(cs, k) {
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


// BOS = a candle BODY closes beyond a swing, a wick alone does not count.
// Structural mode (default): every confirmed swing stays in a list until a body closes beyond it, and a BOS must be a TRUE new HH / LL of the
// current leg: the body must close beyond the HIGHEST unbroken swing high (LOWEST unbroken swing low) of the leg. Breaking a smaller swing while
// a higher one is still intact only clears that smaller swing, it is not a BOS. A leg starts at the last BOS in the opposite direction
// (a BOS the other way drops the swings that came before it), so reversal breaks still count as before.
export function findBos(cs, k, structural = true) {
  if (!structural) return findBosLatestSwing(cs, k);
  const sw = swings(cs, k);
  const out = [];
  let sp = 0, openH = [], openL = [];             // confirmed swings not yet closed beyond, oldest first
  let lastUp = -1, lastDn = -1;                   // idx of the latest BOS each way (a leg only restarts on a real reversal, see below)
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    while (sp < sw.length && sw[sp].idx + k <= i) { (sw[sp].kind === 'H' ? openH : openL).push(sw[sp]); sp++; }
    let upBos = null, dnBos = null;
    if (openH.length) {
      const top = openH.reduce((a, s) => (s.price > a.price ? s : a));          // highest unbroken swing high of the leg
      if (c.c > top.price) {
        let tip = top.idx + 1;
        for (let j = top.idx + 1; j <= i; j++) if (cs[j].l < cs[tip].l) tip = j;
        upBos = { dir: 1, idx: i, t: c.t, level: top.price, broken_idx: top.idx, tip_idx: tip, tip_price: cs[tip].l, slq: false, valid: false };
      }
      openH = openH.filter((s) => !(c.c > s.price));                           // smaller swings the body passed are used up either way
    }
    if (openL.length) {
      const bot_ = openL.reduce((a, s) => (s.price < a.price ? s : a));
      if (c.c < bot_.price) {
        let tip = bot_.idx + 1;
        for (let j = bot_.idx + 1; j <= i; j++) if (cs[j].h > cs[tip].h) tip = j;
        dnBos = { dir: -1, idx: i, t: c.t, level: bot_.price, broken_idx: bot_.idx, tip_idx: tip, tip_price: cs[tip].h, slq: false, valid: false };
      }
      openL = openL.filter((s) => !(c.c < s.price));
    }
    if (upBos) { out.push(upBos); openL = openL.filter((s) => s.idx >= i); }
    if (dnBos) { out.push(dnBos); openH = openH.filter((s) => s.idx >= i); }
  }
  out.sort((a, b) => a.idx - b.idx || b.dir - a.dir);
  return out;
}

// Structural liquidity: an opposite-colored BODY candle between the point of liquidity (the tip of the V / A) and the break of structure
// (downtrend: a green candle before the BOS). Its body must not go beyond the broken level; a wick beyond it does not matter.
export function hasSlq(cs, b) {
  for (let j = b.tip_idx + 1; j < b.idx; j++) {
    const c = cs[j];
    if (b.dir === 1 && bear(c) && Math.max(c.o, c.c) <= b.level) return true;
    if (b.dir === -1 && bull(c) && Math.min(c.o, c.c) >= b.level) return true;
  }
  return false;
}

export function markValid(cs, bos) {
  let prev = null;
  for (const b of bos) {
    b.slq = hasSlq(cs, b);
    b.valid = b.slq;
    // Rule: if the current BOS has no SLQ, go back to the BOS before it. When that previous BOS (same direction) has no SLQ either
    // (two BOS in a row without SLQ), the previous one becomes a valid BOS without SLQ. The current one stays invalid until the next BOS shows up.
    if (!b.slq && prev !== null && prev.dir === b.dir && !prev.slq) prev.valid = true;
    prev = b;
  }
  return bos;
}

export function marketStructure(h4, p) {
  const bos = markValid(h4, findBos(h4, p.swingK, p.bosStructural !== false));
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
export function orderBlock(cs, b) {
  // A = the candle at the point of liquidity: the last bearish candle (HH BOS) / last bullish candle (LL BOS) at or before the tip of the
  // higher low / lower high. There is no limit on how far back it looks: it keeps going until it finds a true order block at the POL.
  const wantBear = b.dir === 1;
  for (let j = b.tip_idx; j >= 0; j--) {
    if (wantBear ? bear(cs[j]) : bull(cs[j])) return j;
  }
  return b.tip_idx;
}

// A and B of a point of liquidity. HH BOS: A = last bearish candle, B = first bullish candle after it. LL BOS: A = last bullish candle,
// B = first bearish candle after it. B is null only if no such candle exists before the BOS candle.
export function obPair(cs, b) {
  const a = orderBlock(cs, b), wantBull = b.dir === 1;
  let bi = null;
  for (let j = a + 1; j <= b.idx; j++) { if (wantBull ? bull(cs[j]) : bear(cs[j])) { bi = j; break; } }
  return { a, b: bi };
}

// POI box (inducement, disruption and points of liquidity): one band over the A and B candles at the POL, from body to body (see poiOf).
// Wicks are left out.
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
  const pr = obPair(cs, b);
  let [lo, hi] = poiFromOb(cs, pr.a, b.dir, p);
  if (pr.b !== null) { const [l2, h2] = poiFromOb(cs, pr.b, b.dir, p); lo = Math.min(lo, l2); hi = Math.max(hi, h2); }   // one band over A and B, body to body
  return { role, dir: b.dir, lo, hi, line: b.tip_price, bos_t: b.t, bos_idx: b.idx, ob_t: cs[pr.a].t, ob_b_t: pr.b !== null ? cs[pr.b].t : null, bos_level: b.level, broken_t: cs[b.broken_idx].t };
}

// Internal order flow (H1) is the trend. It is read walking the H1 candles in time order.
// Flow = a direction d plus its BOS, valid and invalid ones (markValid = structural liquidity). The inducement is the most current BOS that sits BEYOND the previous
// inducement (above it in an uptrend, below it in a downtrend); a BOS between the inducement and the disruption changes nothing. An invalid
// NEWEST BOS cannot be the inducement (then the one before it is). The nearest earlier BOS whose POI sits on the right side of it is the disruption, older ones are points of liquidity (see addBos).
// A new BOS never flips the trend by itself, and neither does a key level invalidation (that only changes which key levels to look for, see
// evaluate). The trend flips ONLY when the disruption POI is invalidated: an H1 candle (a WICK is enough) goes beyond the disruption POI.
// The flip is immediate and official. As soon as it happens the new order flow is mapped from the most current valid BOS: every valid BOS in the
// new direction since the last valid BOS of the old direction (the current leg), plus the ones that follow.
// A flow needs BOTH an inducement and a disruption; with a single BOS nothing is marked (it is kept in `pending`, never drawn).
// The flow is seeded from the first H1 BOS in the window (or from `trend` when a direction is passed in, as the tests do).
//
// Pullback at the inducement: price comes back to the inducement POI. It never changes the trend. It has resumed once a valid BOS forms in the
// trend direction (`pullback.resume_t`); trading then starts from the second valid key level after that (the first one is not traded).
export function orderFlow(h1, trend, p) {
  const res = { dir: trend || 0, pois: [], pending: null, invalidated: null, remapped: false, recovered: null, pending_flip: null, official: null, pullback: null };
  if (trend === 0) return res;
  // Every BOS has a swing that started it, and ONE candle cannot form a swing: a BOS whose swing has fewer than 2 candles leaving the swing start is not used.
  // Valid or not, every other BOS counts (a BOS with no structural liquidity is still a point of liquidity).
  const bosAll = markValid(h1, findBos(h1, p.swingK, p.bosStructural !== false)).filter((b) => b.idx - b.tip_idx >= 2);
  if (trend == null) { if (!bosAll.length) return res; trend = bosAll[0].dir; res.dir = trend; }
  const at = new Map();
  for (const b of bosAll) { if (!at.has(b.idx)) at.set(b.idx, []); at.get(b.idx).push(b); }
  const dpCache = new Map(), disPoi = (b) => { if (!dpCache.has(b.idx)) dpCache.set(b.idx, poiOf(h1, b, 'disruption', p)); return dpCache.get(b.idx); };
  let d = trend, list = [], last = null, pb = null; // current flow: its direction and its valid BOS (oldest first); last = latest flip; pb = pullback at the inducement
  // The inducement is the most current BOS BEYOND the previous inducement (see addBos / eff); the disruption is the nearest earlier BOS whose POI sits on the right side of it
  // (uptrend: below, downtrend: above, no overlap). Older BOS that the newest one has passed (price wicked through them, no body close) are
  // dropped from the chain instead of the newest BOS being skipped, so a stale inducement / disruption can never stay on the chart.
  // All BOS of the flow are kept in `list` (oldest first). The chain used for the POIs (eff) is read from it:
  //  - the NEWEST BOS is left out while it is invalid (no structural liquidity yet, so it cannot be the inducement). Then the second newest BOS
  //    (valid or invalid) is the inducement and the BOS before it is the disruption;
  //  - going back from the newest, a BOS whose POI is not on the right side of the newer one (uptrend: below it, downtrend: above it, no overlap)
  //    is skipped, so the inducement is always above the disruption in an uptrend (below it in a downtrend).
  let effKey = -1, effVal = [];
  // The inducement is ALWAYS the swing start of the most recent BOS (valid or not) and the disruption is the swing start of the BOS before it.
  // Two BOS that came out of the same swing share one swing start, so the older of them is skipped (the disruption is a different swing).
  const eff = () => {
    if (effKey === list.length) return effVal;
    const out = [];
    for (let j = list.length - 1; j >= 0 && out.length < 6; j--) {
      if (out.length && disPoi(out[out.length - 1]).ob_t === disPoi(list[j]).ob_t) continue;
      out.push(list[j]);
    }
    effKey = list.length; effVal = out.reverse();
    return effVal;
  };
  const addBos = (b) => { list.push(b); return true; };
  // Always map an order flow. When the current leg gives fewer than 2 usable BOS (right after a flip, or at the start of the window), go back through
  // ALL earlier BOS in the trend direction (previous candle data) instead of waiting for new ones to form:
  // the inducement is the most recent BOS (an invalid newest one is left out, see eff), the disruption is the nearest earlier BOS whose POI sits on the
  // right side of it (below the inducement in an uptrend, above it in a downtrend). Nothing else filters it.
  const fill = (upTo) => {
    const cand = bosAll.filter((b) => b.dir === d && b.idx <= upTo);
    if (!cand.length) return;
    list = cand; effKey = -1;
  };
  for (let i = 0; i < h1.length; i++) {
    const c = h1[i];
    // the disruption POI is invalidated (an H1 wick beyond it is enough): flip right away
    let by = null;
    if (eff().length >= 2) {
      const dp = disPoi(eff()[eff().length - 2]);
      if ((d === 1 && c.l < dp.lo) || (d === -1 && c.h > dp.hi)) by = 'disruption';
    }
    if (by !== null) {
      last = { dir: d, t: c.t, idx: i, by };
      res.official = { dir: -d, invalidated_t: c.t, t: c.t, idx: i, by };
      pb = null;
      d = -d;                                         // flipped right away; map the new flow from the most current BOS
      list = []; effKey = -1;
      let lastOld = -1;
      for (const b of bosAll) if (b.idx <= i && b.dir === -d && b.idx > lastOld) lastOld = b.idx;
      for (const b of bosAll) if (b.dir === d && b.idx > lastOld && b.idx < i) addBos(b);
      if (eff().length < 2) fill(i - 1);              // the current leg is too short: use the BOS that came before it
    }
    // pullback at the inducement: price comes back into the inducement POI (it does not change the trend direction)
    if (eff().length >= 2 && (pb === null || pb.resume_t)) {
      const ind = eff()[eff().length - 1];
      if (i > ind.idx) {
        const q = poiOf(h1, ind, 'inducement', p);
        if (d === 1 ? c.l <= q.hi : c.h >= q.lo) pb = { dir: d, t: c.t, idx: i, resume_t: null };
      }
    }
    for (const b of at.get(i) || []) {
      // No complete order flow yet (no disruption exists, so nothing can flip it): a BOS the other way is the current direction, not something to ignore.
      // This is the first mapping of the flow, not a flip, so nothing is marked official.
      if (b.dir !== d && eff().length < 2) { d = b.dir; list = []; effKey = -1; pb = null; list.push(b); fill(i); continue; }
      if (b.dir === d) {
        addBos(b);
        if (b.valid && pb !== null && !pb.resume_t) pb.resume_t = c.t;   // the first valid BOS in the trend direction after the pullback = the trend resumes
      }
    }
  }
  if (eff().length < 2) fill(h1.length - 1);        // never leave a symbol without an order flow while earlier BOS exist
  res.dir = d; res.invalidated = last; res.remapped = last !== null;
  res.pullback = pb;
  const e = eff();
  if (e.length === 1) { res.pending = { dir: d, bos_t: e[0].t, bos_idx: e[0].idx }; return res; }
  if (e.length < 2) return res;
  const ind = e[e.length - 1], dis = e[e.length - 2];
  // Chart labels: the most recent HH + HL (up) or LL + LH (down). The swing start is the HL / LH, the extreme made since then is the HH / LL.
  { let x = ind.tip_idx; for (let j = ind.tip_idx; j < h1.length; j++) if (d === 1 ? h1[j].h > h1[x].h : h1[j].l < h1[x].l) x = j;
    res.labels = d === 1 ? [{ kind: 'HL', t: h1[ind.tip_idx].t, price: h1[ind.tip_idx].l }, { kind: 'HH', t: h1[x].t, price: h1[x].h }]
      : [{ kind: 'LH', t: h1[ind.tip_idx].t, price: h1[ind.tip_idx].h }, { kind: 'LL', t: h1[x].t, price: h1[x].l }]; }
  res.pois = [poiOf(h1, ind, 'inducement', p), poiOf(h1, dis, 'disruption', p), ...e.slice(-4, -2).map((b) => poiOf(h1, b, 'plq', p))];
  return res;
}

// ---------------------------------------------------------------- manual order flow (Sniper Mode)
// The person sets the order flow by hand: a direction plus the inducement and disruption POIs (price range lo..hi and the time t the POI formed).
// Everything downstream (reclamation, key levels, QML, bjeff zone) then runs on that flow exactly as it does on the bot's own flow.
// The flow ends when an H1 candle goes beyond the disruption POI after BOTH POIs exist (a wick is enough, same rule as the automatic flow: a disruption can
// only be invalidated once there is an inducement). Candles before that, such as the pullback that formed the POI, do not count. Unlike the
// automatic flow nothing is remapped after that: the person sets the next one.
export function manualOrderFlow(h1, m) {
  const d = m.dir === -1 ? -1 : 1;
  const mk = (role, x) => ({ role, dir: d, lo: x.lo, hi: x.hi, line: d === 1 ? x.lo : x.hi, bos_t: x.t, bos_idx: -1, ob_t: x.t, ob_b_t: null, bos_level: null, broken_t: x.t });
  const ind = mk('inducement', m.ind), dis = mk('disruption', m.dis);
  const res = { dir: d, pois: [ind, dis], pending: null, invalidated: null, remapped: false, recovered: null, pending_flip: null, official: null, pullback: null, manual: true };
  const from = Math.max(ind.bos_t, dis.bos_t);
  for (let i = 0; i < h1.length; i++) {
    const c = h1[i];
    if (c.t <= from) continue;
    if ((d === 1 && c.l < dis.lo) || (d === -1 && c.h > dis.hi)) {
      res.invalidated = { dir: d, t: c.t, idx: i, by: 'disruption' };
      res.official = { dir: -d, invalidated_t: c.t, t: c.t, idx: i, by: 'disruption' };
      break;
    }
  }
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

// Key level confirmations on M5 (the key level POI box): bullish / bearish harami, bullish / bearish engulf, morning / evening star.
//  harami: the candle's body sits inside the body of the opposite candle before it (inside the box).
//  engulf: the candle's body covers the body of the opposite candle before it (inside the box).
//  star:   a long candle, then a small body candle (at most half of the first body, sitting at the far end of it) that touches the box,
//          then a candle of the other colour that closes beyond the middle of the first body (morning star for buys, evening star for sells).
// The time of a confirmation is the candle that completes the pattern.
export function klConfirmations(m5, lo, hi, d, sinceT) {
  const out = [], mid = (c) => (c.o + c.c) / 2;
  for (let i = 1; i < m5.length; i++) {
    const c = m5[i], a = m5[i - 1];
    if (c.t < sinceT) continue;
    const inC = bot(c) >= lo && top(c) <= hi, inA = bot(a) >= lo && top(a) <= hi, nm = d === 1 ? 'bullish' : 'bearish';
    const opp = d === 1 ? bear(a) && bull(c) : bull(a) && bear(c);
    if (opp && inA && inC && bot(c) <= bot(a) && top(c) >= top(a)) out.push({ t: c.t, type: `${nm}_engulf` });
    else if (opp && inC && body(a) > body(c) && top(c) <= top(a) && bot(c) >= bot(a)) out.push({ t: c.t, type: `${nm}_harami` });
    if (i >= 2) {
      const f = m5[i - 2], m = a, touches = m.l <= hi && m.h >= lo;
      if (d === 1 && bear(f) && bull(c) && touches && body(f) > 0 && body(m) <= body(f) * 0.5 && top(m) <= bot(f) + body(f) * 0.25 && c.c > mid(f)) out.push({ t: c.t, type: 'morning_star' });
      if (d === -1 && bull(f) && bear(c) && touches && body(f) > 0 && body(m) <= body(f) * 0.5 && bot(m) >= top(f) - body(f) * 0.25 && c.c < mid(f)) out.push({ t: c.t, type: 'evening_star' });
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
  for (const b of findBos(h1, p.swingK, p.bosStructural !== false)) {
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

// ---------------------------------------------------------------- M5 POI (refines the H1 key level POI)
// M5 order blocks around an H1 key level POI. Buy (d = 1): the last BEARISH candle before a breakout up; sell (d = -1): the last BULLISH candle
// before a breakout down. The breakout candle is the first candle after it that closes beyond the order block candle's far side, and every
// candle between the two is not of the order block's colour (so each breakout gives exactly one order block).
// POI box: the WHOLE candle (wick and body); when the candle is too long (range > m5PoiLongMult x the average M5 range) only the BODY.
export function m5ObBox(cs, j, p) {
  const c = cs[j];
  const prev = cs.slice(Math.max(0, j - p.avgBodyLen), j);
  const avg = prev.length ? prev.reduce((a, x) => a + (x.h - x.l), 0) / prev.length : (c.h - c.l);
  const tooLong = avg > 0 && (c.h - c.l) > p.m5PoiLongMult * avg;
  return tooLong ? { lo: bot(c), hi: top(c), part: 'body' } : { lo: c.l, hi: c.h, part: 'full' };
}

// Mitigated = after the order block a wick pulls back into its POI box. The breakout candle itself is left out (it leaves the box).
// Unmitigated = nothing came back into the box (buy: no low at or below the top of the box; sell: no high at or above the bottom of it).
// `all` may include the candle still forming, so a touch counts at once.
export function m5Obs(all, closed, d, fromT, p) {
  const out = [];
  for (let j = 0; j < closed.length; j++) {
    const c = closed[j];
    if (c.t < fromT || (d === 1 ? !bear(c) : !bull(c))) continue;
    let k = null;
    for (let x = j + 1; x < closed.length; x++) {
      const y = closed[x];
      if (d === 1 ? bear(y) : bull(y)) break;                                  // a newer order block candle: this one is not the last before the breakout
      if (d === 1 ? y.c > c.h : y.c < c.l) { k = x; break; }
    }
    if (k === null) continue;
    const box = m5ObBox(closed, j, p);
    let mitigated = false;
    for (const y of all) {
      if (y.t <= c.t || y.t === closed[k].t) continue;
      if (d === 1 ? y.l <= box.hi : y.h >= box.lo) { mitigated = true; break; }
    }
    out.push({ ...box, t: c.t, break_t: closed[k].t, mitigated });
  }
  return out;
}

// The M5 POI. Step 1: the ORIGINAL M5 order block = the M5 order block at the H1 key level POI (the closest one to it; this only locates it).
// Step 2: everything is then measured on M5 from that original order block's box: the unmitigated order block CLOSEST TO IT wins. When the
// closest unmitigated one is too far away (the gap between the two M5 boxes is more than m5PoiNearAtr x the M5 ATR), the original order block
// is the M5 POI. The original itself counts when it is unmitigated (gap 0). Returns null when there is no M5 order block at all.
export function m5Poi(kl, m5, atr5, p) {
  const d = kl.dir, closed = closedOnly(m5);
  const obs = m5Obs(m5, closed, d, kl.t0, p);
  const gapTo = (r) => (o) => Math.max(0, o.lo - r.hi, r.lo - o.hi);
  const best = (arr, g) => arr.reduce((a, o) => (a === null || g(o) < g(a) || (g(o) === g(a) && o.t > a.t) ? o : a), null);
  const orig = best(obs, gapTo(kl));
  if (orig === null) return null;
  const g = gapTo(orig);
  const un = best(obs.filter((o) => !o.mitigated), g);
  if (un !== null && g(un) <= p.m5PoiNearAtr * atr5) return { ...un, source: un === orig ? 'original' : 'unmitigated', gap: g(un), orig_t: orig.t };
  return { ...orig, source: 'original', gap: 0, orig_t: orig.t };
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

// opts.manual = { dir, ind: {lo, hi, t}, dis: {lo, hi, t} } runs everything on a hand-set order flow (see manualOrderFlow) instead of the bot's own.
// opts.flowOf = (h1) => flow runs everything on an order flow made by another engine (the SMC, see smcflow.js). h1 = the closed H1 candles used here.
export function evaluate(h4Live, h1Live, m5, p = defaultParams, digits = 3, opts = {}) {
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
  const vk = validateKls(h1, findKls(h1, p, atr1, h1.length), p);
  const livePx = m5.length ? m5[m5.length - 1].c : null;
  // Key levels that count under a given order flow and key level bias (the direction of key levels we look for). Trend continuation model: the key
  // level must agree with the internal H1 order flow (no order flow = no key level), except after a key level invalidation (see below).
  // A QML is built from an invalidated key level and may go against the order flow.
  const klFor = (flow, bias, since) => {
    const hasFlow = ['inducement', 'disruption'].every((r) => flow.pois.some((x) => x.role === r));
    let valid = !hasFlow ? [] : vk.filter((k) => k.status === 'valid' && k.t_valid > since && (!p.klWithBias || (bias !== 0 && k.dir === bias)) && klFitsOrderFlow(k, flow, livePx));
    // Pullback at the inducement, then the trend resumes: the FIRST valid key level after the resume is not traded, trading starts from the second.
    const pbk = bias === flow.dir ? flow.pullback : null; let pbState = null;
    if (pbk) {
      const after = pbk.resume_t ? valid.filter((k) => k.t_valid > pbk.resume_t).sort((a, b) => a.t_valid - b.t_valid) : [];
      pbState = { t: pbk.t, resumed: !!pbk.resume_t, resume_t: pbk.resume_t, waiting: after.length < 2 };
      valid = after.slice(1);
    }
    return { valid, pbState, hasFlow };
  };
  const latestKl = (arr) => arr.reduce((a, k) => (k.j > a.j || (k.j === a.j && k.i > a.i) ? k : a));
  // The order flow flips ONLY when the disruption POI is invalidated (done inside orderFlow). A new BOS or a key level invalidation never flips it.
  // A key level invalidation only changes the key levels we look for: a bearish key level invalidated = look for bullish key levels, a bullish one
  // invalidated = look for bearish ones. That goes on until the next key level invalidation (it flips again) or until the disruption is
  // invalidated (the order flow flips, and the key levels follow the new order flow again), whichever comes first.
  const of = opts.flowOf ? opts.flowOf(h1) : opts.manual ? manualOrderFlow(h1, opts.manual) : orderFlow(h1, null, p);
  let bias = of.dir, since = -Infinity;
  const kInv = [];
  for (let n = 0; n < 8 && bias; n++) {
    const cand = klFor(of, bias, since).valid;
    if (!cand.length) break;
    const a0 = latestKl(cand), inv0 = klInvalidation(a0, h1, m5);
    if (!inv0) break;
    kInv.push({ act: a0, inv: inv0 });
    bias = -a0.dir; since = inv0.t;
  }
  const trend = of.dir;
  const sInd = of.pois.find((x) => x.role === 'inducement');
  state.s = {
    bias: trend, bias_shift: false, bias_t: sInd ? sInd.bos_t : null, bias_level: sInd ? sInd.bos_level : null,
    trend, shift_pending: false, valid: trend !== 0 && (of.pois.length > 0 || !!of.pending),
    trend_invalidated: null,
    official: of.official ? { t: of.official.t + H1, dir: of.official.dir, by: of.official.by } : null,
    anchor_t: sInd ? sInd.bos_t : null, level: sInd ? sInd.bos_level : null, slq: sInd ? true : null,
    swings: ms.swings,
    bos: ms.bos.map((b) => ({ dir: b.dir, t: b.t, level: b.level, valid: b.valid, slq: b.slq })),
  };
  if (sInd && !opts.manual) {
    events.push(ev('S', 'trend_valid', trend, sInd.bos_t + H1, H1, `S: H1 ${trend === 1 ? 'uptrend' : 'downtrend'} is valid`,
      opts.flowOf ? `SMC trend is ${trend === 1 ? 'bullish' : 'bearish'}: the latest BOS broke ${f(sInd.bos_level)}. Look for ${side(trend)} setups on H1.` : `Internal order flow is ${trend === 1 ? 'bullish' : 'bearish'}: valid BOS (liquidity + BOS) broke ${f(sInd.bos_level)}. Look for ${side(trend)} setups on H1.`, sInd.bos_t));
  }
  for (const b of ms.valid_bos) {
    // the label carries the current H4 bias (not the direction of that single break)
    overlays.push({ type: 'line', tf: 'h4', y: b.level, t0: h4[b.broken_idx].t, label: 'BOS', tone: 's' });
  }

  // ---- O: order flow on H1
  state.o = of;
  for (const poi of of.pois) {
    if ((poi.role === 'inducement' || poi.role === 'disruption') && !opts.manual) {       // a hand-set POI is not news to the person who set it
      events.push(ev('O', poi.role, poi.dir, poi.bos_t + H1, H1, `O: new ${poi.role} POI (${poi.dir === 1 ? 'bullish' : 'bearish'})`,
        `POI ${f(poi.lo)} to ${f(poi.hi)} (order block body). Line at ${f(poi.line)}.`, `${poi.role}-${poi.bos_t}`, { lo: poi.lo, hi: poi.hi, t0: poi.ob_t }));
    }
    // H1 chart: dotted grey horizontal line at the level the inducement / disruption BOS broke, labelled BOS
    if ((poi.role === 'inducement' || poi.role === 'disruption') && Number.isFinite(poi.bos_level)) overlays.push({ type: 'line', tf: 'h1', grp: 'o', y: poi.bos_level, t0: poi.broken_t, label: 'BOS', tone: 'bos', dotted: true });
    if (poi.role !== 'plq') overlays.push({ type: 'box', grp: 'o', lo: poi.lo, hi: poi.hi, t0: poi.ob_t, label: cap(poi.role), tone: poi.role === 'disruption' ? 'dis' : 'o' });   // point of liquidity is not drawn
  }
  for (const l of (of.labels || [])) overlays.push({ type: 'mark', tf: 'h1', grp: 'o', t: l.t, y: l.price, label: l.kind, tone: 'o' });   // newest HH + HL (up) / LL + LH (down)
  if (of.invalidated) {
    const iv = of.invalidated;
    if (opts.manual) events.push(ev('O', 'invalidated', iv.dir === 1 ? -1 : 1, iv.t + H1, H1, 'O: your order flow is invalidated',
      `An H1 candle went beyond your disruption POI (a wick is enough). This order flow is over: set a new one in Sniper Mode.`, `inv-${iv.t}`));
    else events.push(ev('O', 'invalidated', iv.dir === 1 ? -1 : 1, iv.t + H1, H1, iv.by === 'key_level' ? 'O: key level invalidated, trend flipped' : 'O: disruption invalidated, trend flipped',
      iv.by === 'key_level'
        ? `The key level in the ${iv.dir === 1 ? 'up' : 'down'}trend was invalidated, so the trend flips to ${iv.dir === 1 ? 'down' : 'up'} at once. The new order flow is mapped from the most current breaks of structure.`
        : opts.flowOf ? `An H1 body closed beyond the DISR zone, so the SMC trend flips to ${iv.dir === 1 ? 'down' : 'up'}. The new IDM and DISR are mapped in the new direction.`
        : `An H1 candle went beyond the disruption POI (a wick is enough), so the trend flips to ${iv.dir === 1 ? 'down' : 'up'} at once. The new order flow is mapped from the most current breaks of structure.`, `inv-${iv.t}`));
  }

  // ---- S (Sniper Mode only): breaks of structure on H1 after the person's POIs were set. A valid BOS with the flow = break of structure,
  // a valid BOS against it = change of structure. (Same structural-liquidity rule as everywhere else: a small break with no liquidity does not count.)
  if (opts.manual) {
    const from = Math.max(opts.manual.ind.t, opts.manual.dis.t);
    for (const b of markValid(h1, findBos(h1, p.swingK, p.bosStructural !== false))) {
      if (!b.valid || b.t <= from) continue;
      const same = b.dir === of.dir;
      events.push(ev('S', same ? 'bos' : 'choch', b.dir, b.t + H1, H1, same ? `S: break of structure (${side(b.dir)} side)` : 'S: change of structure',
        same ? `An H1 body closed beyond ${f(b.level)}: the order flow is making a new ${b.dir === 1 ? 'higher high' : 'lower low'}.`
          : `An H1 body closed beyond ${f(b.level)} against your order flow. Watch your disruption POI: if it breaks, the flow is over.`, `${same ? 'bos' : 'choch'}-${b.t}`, { level: b.level }));
    }
  }

  // ---- R: reclamation on H1, at the inducement and disruption POIs (confirmation only)
  state.r = [];
  for (const poi of of.pois.filter((x) => x.role === 'inducement' || x.role === 'disruption')) {
    const r = reclamation(h1, poi, p);
    state.r.push({ role: poi.role, dir: poi.dir, state: r.state, last_complete: r.last_complete, lo: poi.lo, hi: poi.hi });
    if (r.last_complete) {
      events.push(ev('R', 'reclamation', poi.dir, r.last_complete + H1, H1, `R: valid ${poi.dir === 1 ? 'bullish' : 'bearish'} reclamation`,
        `H1 reclamation completed at the ${poi.role} POI (${f(poi.lo)} to ${f(poi.hi)}). Use it as a confirmation, not as an entry.`,
        `${poi.role}-${poi.bos_t}-${r.last_complete}`, { lo: poi.lo, hi: poi.hi, t0: poi.ob_t }));
    }
  }

  // ---- K: key levels on H1
  const kl = klFor(of, bias, since), valid = kl.valid;
  state.k_bias = bias;
  if (kl.pbState) state.pullback = kl.pbState;
  const kState = { active: null, pending: [] };      // RKL/SKL (levels not yet valid) are not shown or alerted
  state.k = kState;
  const acts = [];
  if (kInv.length) acts.push(kInv[kInv.length - 1]);                // the latest invalidated key level still gets its QML
  if (valid.length) { const a = latestKl(valid); acts.push({ act: a, inv: klInvalidation(a, h1, m5) }); }
  for (const { act, inv } of acts) {
    const plan = tradePlan(act.lo, act.hi, act.dir, atr5, p);
    kState.active = { type: act.type, dir: act.dir, lo: act.lo, hi: act.hi, t0: act.t0, t_valid: act.t_valid, wicks: act.wicks,
      high_prob: act.high_prob, max_wicks: p.maxKlWicks, invalidated: inv, plan };
    overlays.push({ type: 'box', grp: 'k', lo: act.lo, hi: act.hi, t0: act.t0, label: 'KeyLevel' + (act.high_prob ? '' : ' (low probability)'), tone: inv ? 'dead' : 'k' });
    // The key level POI box on the M5 chart (grp 'k5', same label and colour as the H1 one) is marked from the M5 order block (see m5Poi).
    // With no M5 order block it falls back to the H1 box.
    const mp = m5Poi(act, m5, atr5, p);
    state.m5poi = mp;
    overlays.push({ type: 'box', grp: 'k5', lo: mp ? mp.lo : act.lo, hi: mp ? mp.hi : act.hi, t0: mp ? mp.t : act.t0, label: 'KeyLevel' + (act.high_prob ? '' : ' (low probability)'), tone: inv ? 'dead' : 'k' });
    const uid = `${act.type}-${act.t_valid}`;
    if (inv) {
      events.push(ev('K', 'kl_invalid', act.dir, inv.t, M5, `K: key level invalidated`,
        `An M5 body closed outside the POI (${f(act.lo)} to ${f(act.hi)}). All older key levels are invalid too. Watch for the QML.`, `${uid}-inv-${inv.t}`, { sub: act.type, lo: act.lo, hi: act.hi, t0: act.t0 }));
      const q = qmlFor(act, inv, h1, m5, p, atr1, liquidityPoints(h1, of, p));
      if (q) {
        state.qml = q;
        overlays.push({ type: 'box', lo: q.lo, hi: q.hi, t0: q.t, label: 'QML', tone: q.invalidated_t ? 'dead' : 'qml' });
        if (q.at_liquidity && !q.invalidated_t) {
          const qp = tradePlan(q.lo, q.hi, q.dir, atr5, p);
          q.plan = qp;
          events.push(ev('QML', 'qml_valid', q.dir, q.t, M5, `QML: ${side(q.dir)} Quasimodo level formed ${q.plq.inside ? 'at' : 'close to'} a point of liquidity`,
            `Reversal at ${f(q.extreme)}, ${q.plq.inside ? 'inside' : 'close to'} an H1 point of liquidity (POI ${f(q.plq.lo)} to ${f(q.plq.hi)}). QML POI ${f(q.lo)} to ${f(q.hi)}. ${cap(side(q.dir))} limit ${f(qp.entry)}, SL ${f(qp.sl)}, TP (1:${p.rr}) ${f(qp.tp)}.`, `qml-${q.t}`, { lo: q.lo, hi: q.hi, t0: q.t, ...qp, sub: 'QML' }));
          q.signals = confirmations(m5c, q.lo, q.hi, q.dir, q.t).slice(-3);      // the chart writes the latest one
          for (const cf of q.signals) {
            events.push(ev('QML', 'qml_entry', q.dir, cf.t + M5, M5, `QML: ${side(q.dir)} confirmation (${nice(cf.type, q.dir)})`,
              `${cap(nice(cf.type, q.dir))} inside the QML POI. ${cap(side(q.dir))} limit ${f(qp.entry)}, SL ${f(qp.sl)}, TP ${f(qp.tp)}.`, `qml-${q.t}-${cf.t}-${cf.type}`, { sub: 'QML', conf: nice(cf.type, q.dir), lo: q.lo, hi: q.hi, t0: q.t }));
          }
        }
      }
    } else if (!act.high_prob) {
      // Low probability key level: still alerted (valid kl_valid), but flagged with the reason. It is not traded, so no entry confirmations follow.
      events.push(ev('K', 'kl_valid', act.dir, act.t_valid + H1, H1, `K: valid key level, LOW PROBABILITY (${side(act.dir)} setup)`,
        `POI ${f(act.lo)} to ${f(act.hi)}. Low probability: ${act.wicks} wick(s) inside the POI, more than the ${p.maxKlWicks} allowed. Not traded.`,
        uid, { lo: act.lo, hi: act.hi, t0: act.t0, sub: act.type, low_prob: true, wicks: act.wicks, max_wicks: p.maxKlWicks }));
    } else if (act.high_prob) {
      events.push(ev('K', 'kl_valid', act.dir, act.t_valid + H1, H1, `K: valid key level (${side(act.dir)} setup)`,
        `POI ${f(act.lo)} to ${f(act.hi)}, ${act.wicks} wick(s) inside (high probability). ${cap(side(act.dir))} limit ${f(plan.entry)}, SL ${f(plan.sl)}, TP (1:${p.rr}) ${f(plan.tp)}.`,
        uid, { lo: act.lo, hi: act.hi, t0: act.t0, ...plan, sub: act.type }));
      const kb = mp || act;                                         // confirmations are read inside the M5 key level POI box (the H1 box when there is no M5 order block)
      const cfs = klConfirmations(m5c, kb.lo, kb.hi, act.dir, act.t_valid + H1).slice(-3);
      state.signals = cfs;
      for (const cf of cfs) {
        events.push(ev('K', 'kl_entry', act.dir, cf.t + M5, M5, `K: ${side(act.dir)} confirmation on key level (${nice(cf.type, act.dir)})`,
          `${cap(nice(cf.type, act.dir))} inside the M5 key level POI. ${cap(side(act.dir))} limit ${f(plan.entry)}, SL ${f(plan.sl)}, TP ${f(plan.tp)}.`,
          `${uid}-${cf.t}-${cf.type}`, { lo: act.lo, hi: act.hi, t0: act.t0, ...plan, sub: act.type, conf: nice(cf.type, act.dir) }));
      }
      // The 50% POI sits inside the key level POI box DRAWN ON M5 (the M5 order block box; the H1 box when there is no M5 order block).
      const adv = advanced(mp ? { ...act, lo: mp.lo, hi: mp.hi } : act, m5, p, null);
      state.adv = adv;
      overlays.push({ type: 'box', lo: adv.half[0], hi: adv.half[1], t0: mp ? mp.t : act.t0, label: '50% POI', tone: 'adv' });
      for (const z of adv.zones) {
        overlays.push({ type: 'box', lo: z.lo, hi: z.hi, t0: z.t0, label: 'bjeff zone', tone: 'adv2' });
        if (z.active_t) {
          events.push(ev('ADV', 'bjeff_valid', act.dir, z.active_t, M5, 'ADV: bjeff zone is active',
            `M5 key level ${f(z.lo)} to ${f(z.hi)} inside the 50% of the H1 key level. A body candle closed inside it. Wait for any confirmation entry.`, `bj-${act.t_valid}-${z.t}`, { sub: act.type, lo: z.lo, hi: z.hi, t0: z.t0 }));
        }
      }
      for (const sg of adv.signals) {
        events.push(ev('ADV', 'adv_entry', act.dir, sg.t + M5, M5, `ADV: ${side(act.dir)} confirmation in the bjeff zone (${nice(sg.type, act.dir)})`,
          `${cap(nice(sg.type, act.dir))} after a body closed inside the bjeff zone. SL slightly outside the POI, TP by your risk reward ratio.`, `bj-${act.t_valid}-${sg.t}-${sg.type}`, { sub: act.type, conf: nice(sg.type, act.dir), lo: adv.half[0], hi: adv.half[1], t0: mp ? mp.t : act.t0 }));
      }
    }
  }
  Object.assign(state, { candles: { m5: tail(m5, 300), h1: tail(h1Live, 300), h4: tail(h4Live, 200) }, overlays, digits, atr: { h1: atr1, m5: atr5 } });
  return { state, events };
}
