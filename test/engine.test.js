import test from 'node:test';
import assert from 'node:assert/strict';
import { C, H1, M5, defaultParams as P, findBos, markValid, marketStructure, orderBlock, poiFromOb, reclamation, findKls,
  validateKls, klInvalidation, confirmations, qmlFor, advanced, evaluate, mirror, tradePlan, atr, lastDays, liquidityPoints, nearLiquidity, orderFlow } from '../server/engine.js';

export function mk(segments, { start = 100, t0 = 0, step = 3600, wick = 0.1 } = {}) {
  const cs = []; let price = start, t = t0;
  for (const [delta, n] of segments) for (let i = 0; i < n; i++) {
    const o = price, c = price + delta;
    cs.push(C(t, o, Math.max(o, c) + wick, Math.min(o, c) - wick, c)); price = c; t += step;
  }
  return cs;
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('BOS, SLQ and validity', () => {
  const cs = mk([[1.0, 5], [-0.8, 3], [1.0, 2], [-0.3, 1], [1.2, 3]]);
  const b = markValid(cs, findBos(cs, 2)).find((x) => x.dir === 1);
  assert.equal(b.idx, 11); assert.equal(b.tip_idx, 7);
  assert.ok(b.slq && b.valid, 'a red candle on the right side of the V, below the old high, is the SLQ');
  const first = markValid(mk([[1.0, 5], [-0.8, 3], [1.0, 4]]), findBos(mk([[1.0, 5], [-0.8, 3], [1.0, 4]]), 2)).find((x) => x.dir === 1);
  assert.ok(!first.slq && !first.valid);
  const cs3 = mk([[1.0, 5], [-0.8, 3], [1.0, 4], [-0.8, 3], [1.0, 5]]);
  const b3 = markValid(cs3, findBos(cs3, 2)).filter((x) => x.dir === 1);
  assert.ok(b3.length >= 2 && !b3[0].valid && b3[1].valid);
  assert.equal(marketStructure(cs3, P).trend, 1);
});

test('bearish mirror structure', () => {
  const cs = mk([[1.0, 5], [-0.8, 3], [1.0, 2], [-0.3, 1], [1.2, 3]]).map(mirror);
  const ms = marketStructure(cs, { ...P, swingK: 2 });   // fixture is drawn for 2 candles on each side
  assert.equal(ms.trend, -1); assert.ok(ms.anchor.slq);
});

test('order block and POI body rules', () => {
  const cs = mk([[1.0, 5], [-0.8, 3], [1.0, 2], [-0.3, 1], [1.2, 3]]);
  const b = markValid(cs, findBos(cs, 2)).find((x) => x.dir === 1);
  const j = orderBlock(cs, b, P);
  assert.equal(j, 7); assert.ok(cs[j].c < cs[j].o);
  let [lo, hi] = poiFromOb(cs, j, 1, P);
  const nx = cs[j + 1];                                                              // bullish: bottom of the 2 bodies up to the longer upper wick
  near(lo, Math.min(cs[j].o, cs[j].c, nx.o, nx.c));
  near(hi, (cs[j].h - Math.max(cs[j].o, cs[j].c)) >= (nx.h - Math.max(nx.o, nx.c)) ? cs[j].h : nx.h);
  const bear = [C(0, 100, 101, 99.9, 100.9), C(1, 100.9, 101, 98.0, 98.2)];        // OB wick 0.1, next candle lower wick 0.2
  const bb = poiFromOb(bear, 0, -1, P); near(bb[0], 98.0); near(bb[1], 100.9);       // bearish: top of 2 bodies down to the longest wick
  const base = Array.from({ length: 10 }, (_, i) => C(i, 100, 100.6, 99.9, 100.5));
  const all = [...base, C(10, 104, 104.2, 99.0, 100.0)];                              // long body 100..104
  [lo, hi] = poiFromOb(all, 10, 1, P); near(lo, 100); near(hi, 102);                  // bullish: bottom 50%
  [lo, hi] = poiFromOb(all, 10, -1, P); near(lo, 102); near(hi, 104);                 // bearish: top 50%
});

const RECL = [[108, 109, 106.5, 107], [107, 107.3, 102.5, 103], [103, 103.2, 98.5, 99], [99, 104.8, 98.8, 104.5],
  [104.5, 105, 102.5, 103], [103, 108, 102.8, 107.5], [107.5, 111, 107, 110.5]];
const m5From = (rows, t0 = 1000, k = null) => rows.map(([o, h, l, c], i) =>
  k === null ? C(t0 + i * M5, o, h, l, c) : C(t0 + i * M5, k - o, k - l, k - h, k - c));
const h1From = (rows, t0 = 1000, k = null) => rows.map(([o, h, l, c], i) =>
  k === null ? C(t0 + i * H1, o, h, l, c) : C(t0 + i * H1, k - o, k - l, k - h, k - c));

test('reclamation (H1), bullish and bearish', () => {
  let r = reclamation(h1From(RECL), { dir: 1, lo: 100, hi: 104, bos_t: 0 }, P);
  assert.equal(r.last_complete, 1000 + 5 * H1);
  r = reclamation(h1From(RECL, 1000, 204), { dir: -1, lo: 100, hi: 104, bos_t: 0 }, P);
  assert.equal(r.last_complete, 1000 + 5 * H1);
  r = reclamation(h1From([...RECL.slice(0, 4), [104.5, 108, 104.2, 107.5], [107.5, 111, 107, 110.5]]), { dir: 1, lo: 100, hi: 104, bos_t: 0 }, P);
  assert.equal(r.last_complete, null); assert.equal(r.state, 3);
});

export function klSeries() {
  const fill = Array.from({ length: 10 }, (_, i) => C(i * 3600, 90 + i, 91.2 + i, 89.9 + i, 91 + i));
  const rows = [[100, 102.6, 99.5, 102.4], [102.4, 105.5, 98.5, 99.5], [99.5, 100.5, 96, 97], [97, 100, 96.5, 99.8], [99.8, 107.5, 99.5, 107]];
  return [...fill, ...rows.map(([o, h, l, c], i) => C((10 + i) * 3600, o, h, l, c))];
}
const rbs = (cs) => validateKls(cs, findKls(cs, P, atr(cs), 200), P).filter((k) => k.status === 'valid' && k.type === 'RBS').pop();

test('key level RBS validity and the wick rule', () => {
  const k = rbs(klSeries());
  near(k.lo, 99.5); near(k.hi, 102.4); near(k.tip, 105.5);
  assert.equal(k.wicks, 2); assert.ok(k.high_prob);
  const h1 = klSeries();
  const seq = [...h1.slice(0, 12), C(0, 99.5, 100.5, 96, 97), C(0, 97, 100, 96.5, 99.8), C(0, 104, 105, 101.2, 104.8),
    C(0, 104.8, 105.4, 100.9, 105.1), C(0, 99.8, 107.5, 99.5, 107)].map((c, i) => C(i * 3600, c.o, c.h, c.l, c.c));
  const k2 = rbs(seq);
  assert.ok(k2.wicks > 2 && !k2.high_prob);
});

test('entry confirmations, invalidation, QML and advanced key level', () => {
  const h1 = klSeries(), kl = rbs(h1), tClose = kl.t_valid + H1;
  const m5 = m5From([[106, 106.5, 104, 104.5], [104.5, 104.8, 101.5, 102], [102, 102.2, 100.2, 100.6], [100.6, 102.3, 100.3, 102.1], [102.1, 105, 102, 104.8]], tClose);
  assert.equal(klInvalidation(kl, h1, m5), null);
  const types = new Set(confirmations(m5, kl.lo, kl.hi, 1, tClose).map((c) => c.type));
  assert.ok(types.has('engulf') && types.has('move_out'));
  const plan = tradePlan(kl.lo, kl.hi, 1, 0.5, P);
  assert.equal(plan.entry, 102.4); assert.ok(plan.sl < 99.5 && plan.tp > plan.entry);
  const m5b = [...m5, ...m5From([[105, 112, 104.8, 111], [111, 111.5, 104, 104.8], [104.8, 105, 98, 98.6]], tClose + 5 * M5)];
  const inv = klInvalidation(kl, h1, m5b);
  assert.equal(inv.t, tClose + 8 * M5);
  const q = qmlFor(kl, inv, h1, m5b, P, atr(h1));
  assert.equal(q.dir, -1); near(q.lo, 102.4); near(q.hi, 112);
  const adv = advanced(kl, m5From([[104, 104.2, 100.9, 101], [101, 101.1, 100.0, 100.2], [100.0, 100.9, 99.6, 100.8], [100.8, 101.0, 99.7, 100.1],
    [100.1, 100.6, 100.0, 100.5], [100.5, 100.55, 100.2, 100.25], [100.2, 100.9, 100.15, 100.8]], tClose), P, null);
  assert.ok(adv.entered_t !== null && adv.zones.some((z) => z.active_t));
  assert.ok(adv.signals.some((s) => s.type === 'engulf'));
});

test('evaluate runs end to end and returns JSON-able state', () => {
  const h4 = mk([[2, 6], [-1.5, 3], [2, 6], [-1.5, 3], [2.2, 8]], { start: 1000, step: 14400 });
  const h1 = mk([[0.5, 6], [-0.4, 3], [0.5, 6], [-0.4, 3], [0.5, 8]], { start: 1000 });
  const m5 = mk(Array.from({ length: 3 }, () => [[0.1, 6], [-0.08, 3], [0.1, 6], [-0.08, 3], [0.1, 8]]).flat(), { start: 1000, step: 300 });
  const out = evaluate(h4, h1, m5, P, 3);
  JSON.stringify(out);
  assert.equal(out.state.s.trend, 1);
  assert.ok(out.state.candles.m5.length);
});

test('swingK defaults to 1', () => assert.equal(P.swingK, 1));

test('BOS needs a body close beyond the swing, a wick is not enough', () => {
  const base = mk([[1.0, 5], [-0.8, 3]]);                       // swing high at idx 4 (price ~105.1), then a pullback
  const t = base.length * 3600, hi = Math.max(...base.map((c) => c.h));
  const wickOnly = [...base, C(t, 103, hi + 0.5, 102.8, 103.5), C(t + 3600, 103.5, 103.8, 103.2, 103.6)];
  assert.equal(findBos(wickOnly, 1).filter((b) => b.dir === 1).length, 0, 'wick above the high, body closes below it: no BOS');
  const bodyClose = [...base, C(t, 103, hi + 1, 102.8, hi + 0.8)];
  assert.equal(findBos(bodyClose, 1).filter((b) => b.dir === 1).length, 1, 'body closes above the high: BOS');
});

function evalFixture(crash) {
  const h4 = mk([[2, 6], [-1.5, 3], [2, 6], [-1.5, 3], [2.2, 8], [-1.5, 3], [2.5, 8]], { start: 1000, step: 14400 });
  const h1 = mk([[0.5, 6], [-0.4, 3], [0.5, 6], [-0.4, 3], [0.5, 8], [-0.4, 3], [0.5, 8], ...(crash ? [[-1.0, crash]] : [])], { start: 1000 });
  const m5 = mk(Array.from({ length: 3 }, () => [[0.1, 6], [-0.08, 3], [0.1, 6], [-0.08, 3], [0.1, 8]]).flat(), { start: 1000, step: 300 });
  return evaluate(h4, h1, m5, P, 3);
}

test('H4 chart draws only the 2 latest valid BOS, all labelled BOS', () => {
  const { state } = evalFixture(0);
  const lines = state.overlays.filter((o) => o.type === 'line' && o.tf === 'h4');
  assert.equal(lines.length, 2);
  assert.ok(lines.every((l) => l.label === 'BOS'));
  assert.ok(!state.overlays.some((o) => /not valid/.test(o.label)));
});

test('old trend is invalidated when the disruption POI is invalidated', () => {
  const ok = evalFixture(0);
  assert.equal(ok.state.s.trend, 1); assert.equal(ok.state.s.trend_invalidated, null);
  assert.ok(ok.events.some((e) => e.kind === 'trend_valid'));
  const dead = evalFixture(20);
  assert.equal(dead.state.s.trend, -1);
  assert.equal(dead.state.s.trend_invalidated.by, 'disruption'); assert.equal(dead.state.s.trend_invalidated.old_dir, 1);
  assert.ok(!dead.events.some((e) => e.kind === 'trend_valid') && dead.events.some((e) => e.kind === 'invalidated'));
});

// ---------------------------------------------------------------- key level edge rule
const pair = (a, b) => [C(0, ...a), C(3600, ...b)];     // [o, h, l, c]
const kls = (cs) => findKls(cs, P, 1, 10);              // ATR 1 -> tolerance 0.1

test('RKL: tops must be equal, the bottoms can be any length', () => {
  const sameTopFarBottoms = findKls(pair([100, 102.6, 99.5, 102.4], [102.4, 103, 95, 95.5]), P, 1, 10);   // tops 102.4 / 102.4, bottoms 100 / 95.5
  assert.equal(sameTopFarBottoms.length, 1); assert.equal(sameTopFarBottoms[0].kind, 'R'); assert.equal(sameTopFarBottoms[0].eq, 'top');
  near(sameTopFarBottoms[0].lo, 95.5); near(sameTopFarBottoms[0].hi, 102.4);
  assert.equal(kls(pair([100, 103, 99.5, 102.4], [103, 103.5, 99, 99.9])).length, 0, 'bottoms equal but tops 0.6 apart: not an RKL');
  assert.equal(kls(pair([100, 102.6, 99.5, 102.4], [102.45, 103, 95, 95.5])).length, 1, 'tops almost equal (within tolerance) is fine');
});

test('SKL: bottoms must be equal, the tops can be any length', () => {
  const s = kls(pair([102.4, 103, 99.5, 100], [100, 108, 99.6, 107.5]));    // bottoms 100 / 100, tops 102.4 / 107.5
  assert.equal(s.length, 1); assert.equal(s[0].kind, 'S'); assert.equal(s[0].eq, 'bottom');
  near(s[0].lo, 100); near(s[0].hi, 107.5);
  assert.equal(kls(pair([102.4, 103, 98, 99], [97, 103, 96.5, 102.35])).length, 0, 'tops equal but bottoms 3 apart: not an SKL');
});

test('RBS shares the RKL logic and SBR shares the SKL logic', () => {
  const up = klSeries(), down = up.map(mirror);
  const r = rbs(up); assert.equal(r.kind, 'R'); assert.equal(r.eq, 'top');
  const sbr = validateKls(down, findKls(down, P, atr(down), 200), P).filter((x) => x.status === 'valid' && x.type === 'SBR');
  assert.ok(sbr.length > 0 && sbr.every((x) => x.kind === 'S' && x.eq === 'bottom'));
});

test('KL POI box starts at the first (left) candle of the key level', () => {
  const k = rbs(klSeries());
  const { state } = evaluate(mk([[2, 6], [-1.5, 3], [2, 6], [-1.5, 3], [2.2, 8]], { start: 1000, step: 14400 }), klSeries(),
    mk([[0.1, 30]], { start: 100, step: 300, t0: k.t_valid + H1 }), P, 3);
  const box = state.overlays.find((o) => o.grp === 'k');
  assert.ok(box, 'key level box drawn'); assert.equal(box.t0, k.t0); assert.equal(box.t0, klSeries()[k.i - 1].t);
});

// ---------------------------------------------------------------- 2 months of H1 and QML at a point of liquidity
test('H1 uses the last 2 months of candles', () => {
  const cs = Array.from({ length: 2000 }, (_, i) => C(i * 3600, 100, 101, 99, 100));
  const w = lastDays(cs, P.h1Days);
  assert.equal(w.length, P.h1Days * 24 + 1); assert.equal(w[w.length - 1].t, cs[1999].t);
  assert.equal(P.h1Days, 60); assert.ok(P.maxScanH1 >= P.h1Days * 24);
});

test('QML needs the reversal at or close to a point of liquidity', () => {
  const h1 = klSeries(), kl = rbs(h1), tClose = kl.t_valid + H1;
  const m5 = m5From([[106, 106.5, 104, 104.5], [104.5, 104.8, 101.5, 102], [102, 102.2, 100.2, 100.6], [100.6, 102.3, 100.3, 102.1], [102.1, 105, 102, 104.8],
    [105, 112, 104.8, 111], [111, 111.5, 104, 104.8], [104.8, 105, 98, 98.6]], tClose);
  const inv = klInvalidation(kl, h1, m5), a1 = atr(h1);
  const q0 = qmlFor(kl, inv, h1, m5, P, a1, []);
  assert.equal(q0.extreme, 112); assert.equal(q0.at_liquidity, false, 'no point of liquidity at all');
  const old = 5 * 3600;                                                 // a point of liquidity that formed before the reversal
  const inside = qmlFor(kl, inv, h1, m5, P, a1, [{ dir: -1, t: old, line: 111, lo: 110.5, hi: 112.5 }]);
  assert.ok(inside.at_liquidity && inside.plq.inside, 'reversal inside the POI of a point of liquidity');
  const close = qmlFor(kl, inv, h1, m5, P, a1, [{ dir: -1, t: old, line: 109, lo: 108, hi: 110.5 }]);   // 1.5 below the POI top
  assert.equal(close.at_liquidity, a1 * P.plqNearAtr >= 1.5, 'distance is judged against plqNearAtr x ATR');
  const nearOne = qmlFor(kl, inv, h1, m5, { ...P, plqNearAtr: 1000 }, a1, [{ dir: -1, t: old, line: 109, lo: 108, hi: 110.5 }]);
  assert.ok(nearOne.at_liquidity && !nearOne.plq.inside, 'close to, not inside');
  const far = qmlFor(kl, inv, h1, m5, { ...P, plqNearAtr: 0.01 }, a1, [{ dir: -1, t: old, line: 90, lo: 89, hi: 91 }]);
  assert.equal(far.at_liquidity, false);
  const later = qmlFor(kl, inv, h1, m5, P, a1, [{ dir: -1, t: q0.extreme_t + 3600, line: 111, lo: 110.5, hi: 112.5 }]);
  assert.equal(later.at_liquidity, false, 'a point of liquidity formed after the reversal does not count');
});

test('points of liquidity are every BOS except the inducement and the disruption', () => {
  const h1 = mk([[0.5, 6], [-0.4, 3], [0.5, 6], [-0.4, 3], [0.5, 8], [-0.4, 3], [0.5, 8]], { start: 1000 });
  const of = orderFlow(h1, 1, P);
  const used = new Set(of.pois.filter((x) => x.role !== 'plq').map((x) => x.bos_idx));
  const liq = liquidityPoints(h1, of, P);
  assert.equal(liq.length, findBos(h1, P.swingK).length - used.size);
  assert.ok(liq.every((q) => Number.isFinite(q.lo) && Number.isFinite(q.hi) && q.hi >= q.lo));
  assert.equal(nearLiquidity(liq[0].line, liq[0].t + 1, liq, 1, P).dist, 0);
});
