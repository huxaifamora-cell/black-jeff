import test from 'node:test';
import assert from 'node:assert/strict';
import { C, H1, M5, defaultParams as P, findBos, markValid, marketStructure, orderBlock, poiFromOb, reclamation, findKls,
  validateKls, klInvalidation, confirmations, qmlFor, advanced, evaluate, mirror, tradePlan, atr } from '../server/engine.js';

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
  const ms = marketStructure(cs, P);
  assert.equal(ms.trend, -1); assert.ok(ms.anchor.slq);
});

test('order block and POI body rules', () => {
  const cs = mk([[1.0, 5], [-0.8, 3], [1.0, 2], [-0.3, 1], [1.2, 3]]);
  const b = markValid(cs, findBos(cs, 2)).find((x) => x.dir === 1);
  const j = orderBlock(cs, b, P);
  assert.equal(j, 7); assert.ok(cs[j].c < cs[j].o);
  let [lo, hi] = poiFromOb(cs, j, 1, P);
  near(lo, Math.min(cs[j].o, cs[j].c)); near(hi, Math.max(cs[j].o, cs[j].c));       // normal body: body to body
  const base = Array.from({ length: 10 }, (_, i) => C(i, 100, 100.6, 99.9, 100.5));
  const all = [...base, C(10, 104, 104.2, 99.0, 100.0)];                              // long body 100..104
  [lo, hi] = poiFromOb(all, 10, 1, P); near(lo, 100); near(hi, 102);                  // bullish: bottom 50%
  [lo, hi] = poiFromOb(all, 10, -1, P); near(lo, 102); near(hi, 104);                 // bearish: top 50%
});

const RECL = [[108, 109, 106.5, 107], [107, 107.3, 102.5, 103], [103, 103.2, 98.5, 99], [99, 104.8, 98.8, 104.5],
  [104.5, 105, 102.5, 103], [103, 108, 102.8, 107.5], [107.5, 111, 107, 110.5]];
const m5From = (rows, t0 = 1000, k = null) => rows.map(([o, h, l, c], i) =>
  k === null ? C(t0 + i * M5, o, h, l, c) : C(t0 + i * M5, k - o, k - l, k - h, k - c));

test('reclamation, bullish and bearish', () => {
  let r = reclamation(m5From(RECL), { dir: 1, lo: 100, hi: 104, bos_t: 0 }, P);
  assert.equal(r.last_complete, 1000 + 5 * M5);
  r = reclamation(m5From(RECL, 1000, 204), { dir: -1, lo: 100, hi: 104, bos_t: 0 }, P);
  assert.equal(r.last_complete, 1000 + 5 * M5);
  r = reclamation(m5From([...RECL.slice(0, 4), [104.5, 108, 104.2, 107.5], [107.5, 111, 107, 110.5]]), { dir: 1, lo: 100, hi: 104, bos_t: 0 }, P);
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
