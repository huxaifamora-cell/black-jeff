import test from 'node:test';
import assert from 'node:assert/strict';
import { SmcEngine, smcDefaults } from '../server/smc.js';
import { flowFromSnapshot, smcFlow } from '../server/smcflow.js';

const T0 = 1_700_000_000, STEP = 300;
// Candles from a list of closes: each opens at the previous close, wicks 0.2 beyond the body. `x` entries are full [o,h,l,c] candles.
function build(vals, w = 0.2) {
  let p = Array.isArray(vals[0]) ? vals[0][0] : vals[0];
  return vals.map((v, i) => {
    const [o, h, l, c] = Array.isArray(v) ? v : [p, Math.max(p, v) + w, Math.min(p, v) - w, v];
    p = c; return { t: T0 + i * STEP, o, h, l, c };
  });
}
const up = (a, b) => { const r = []; for (let v = a; v <= b; v++) r.push(v); return r; };
const dn = (a, b) => { const r = []; for (let v = a; v >= b; v--) r.push(v); return r; };
const P = { swingLen: 2, internalLen: 1, idmMinDepthAtr: 0.1 };
const idx = (t) => (t - T0) / STEP;
function run(cs, params = P) {
  const e = new SmcEngine(params), events = [];
  for (const c of cs) for (const a of e.close(c).changed) events.push({ at: idx(c.t), a });
  return { e, events };
}
const find = (events, type) => events.filter((x) => x.a.type === type);

test('smc: BOS on a body close above the swing high; a break against the trend is only a counter-trend break and does NOT flip the trend', () => {
  const { e, events } = run(build([...up(10, 15), ...dn(14, 12), ...up(13, 18), ...dn(17, 14), ...up(15, 16), ...dn(15, 9)]));
  const bos = find(events, 'bos'), ch = find(events, 'choch');
  assert.equal(bos.length, 1); assert.equal(bos[0].a.dir, 1); assert.equal(bos[0].at, 12);          // first break after a cold start is a BOS
  assert.equal(idx(bos[0].a.t0), 5);                                                                 // drawn from the swing high that was broken
  assert.equal(ch.length, 1); assert.equal(ch[0].a.dir, -1); assert.equal(ch[0].at, 23);             // 13.8 HL broken by a close
  assert.equal(e.trend, 1);                                                                          // the old rule flipped here; now only a DISR invalidation flips
  const labels = find(events, 'swing').map((x) => x.a.label);
  assert.ok(labels.includes('HH') && labels.includes('HL') && labels.includes('LH'));
});

test('smc: a wick through a high that closes back inside is a sweep, not a BOS', () => {
  const cs = build([...up(10, 15), ...dn(14, 12), 13, 14, [14, 15.6, 13.9, 14.4], 14, 13, 12]);   // wick to 15.6 above the 15.2 high, close 14.4
  const { events } = run(cs);
  const sw = find(events, 'sweep');
  assert.equal(sw.length, 1); assert.equal(sw[0].a.side, 'buy'); assert.equal(sw[0].a.dir, -1); assert.equal(idx(sw[0].a.t0), 5);
  assert.equal(find(events, 'bos').length, 0);
  assert.equal(find(events, 'choch').length, 0);
});

test('smc: a sweep of lows (sell-side liquidity) points up', () => {
  const cs = build([...dn(20, 15), ...up(16, 18), 17, 16, [16, 16.2, 14.4, 15.5], 16, 17, 18]);       // low 14.8 swing, wick to 14.4 closes 15.5
  const { events } = run(cs);
  const sw = find(events, 'sweep');
  assert.equal(sw.length, 1); assert.equal(sw[0].a.side, 'sell'); assert.equal(sw[0].a.dir, 1);
});

test('smc: equal highs form one pool and a single sweep event', () => {
  const cs = build([...up(10, 15), ...dn(14, 12), ...up(13, 15), ...dn(14, 12), 13, [13, 15.6, 12.9, 14], 13, 12, 11]);   // two highs at 15.2, then a wick to 15.6
  const { events } = run(cs);
  assert.equal(find(events, 'eq').filter((x) => x.a.label === 'EQH').length, 1);       // (the two lows at 11.8 are an EQL pair too, that is expected)
  assert.equal(find(events, 'swing').some((x) => x.a.label === 'EQH'), true);
  const sw = find(events, 'sweep');
  assert.equal(sw.length, 1); assert.equal(sw[0].a.label, 'EQH SWEEP');
});

const PS = { ...P, idmMode: 'swing' };
test('smc: swing mode: inducement = first minor low of the pullback; it turns "swept" when a wick takes it', () => {
  // up leg to 20, pullback with a minor low at 17.8 then a bounce and a deeper low, which takes the minor low
  const cs = build([...up(10, 15), ...dn(14, 12), ...up(13, 20), 19, 18, 19, 18.5, 17, 16, 18, 19]);
  const { events } = run(cs, PS);
  const idms = find(events, 'idm');
  assert.ok(idms.length >= 1);
  const last = idms[idms.length - 1].a;
  assert.equal(last.dir, 1);
  assert.equal(last.status, 'swept');
  assert.ok(last.t1 > last.t0);
});

test('smc: swing mode: a new swing retires an inducement that was never taken', () => {
  const { e } = run(build([...up(10, 15), ...dn(14, 12), ...up(13, 18), ...dn(17, 16), ...up(17, 21), ...dn(20, 19)]), PS);
  const idms = [...e.ann.values()].filter((a) => a.type === 'idm');
  assert.ok(idms.some((a) => a.status === 'void') || idms.length <= 1);
  assert.ok(e.snapshot().annotations.every((a) => a.status !== 'void'));                             // void ones never reach the chart
});

test('smc: seeding with history equals feeding candle by candle (no repainting)', () => {
  const cs = build([...up(10, 15), ...dn(14, 12), ...up(13, 18), ...dn(17, 14), ...up(15, 16), ...dn(15, 9), ...up(10, 14)]);
  const a = new SmcEngine(P); a.seed(cs);
  const { e: b } = run(cs);
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test('smc: peek previews the forming candle and changes nothing', () => {
  const cs = build([...up(10, 15), ...dn(14, 12), 13, 14]);
  const e = new SmcEngine(P); e.seed(cs);
  const before = JSON.stringify(e.snapshot());
  const live = e.peek({ t: T0 + cs.length * STEP, o: 14, h: 16.5, l: 13.9, c: 16 });                 // closing above 15.2 right now
  assert.equal(live.length, 1); assert.equal(live[0].type, 'bos'); assert.equal(live[0].provisional, true);
  assert.equal(JSON.stringify(e.snapshot()), before);
  assert.equal(e.peek({ t: cs[cs.length - 1].t, o: 1, h: 99, l: 0, c: 50 }).length, 0);              // an old candle is ignored
});

test('smc: duplicate / old / forming candles are ignored by close()', () => {
  const cs = build([...up(10, 15), ...dn(14, 12)]);
  const e = new SmcEngine(P); e.seed(cs);
  assert.deepEqual(e.close(cs[cs.length - 1]).changed, []);
  assert.deepEqual(e.close({ ...cs[0] }).changed, []);
  assert.deepEqual(e.close({ t: T0 + 999 * STEP, o: 1, h: 99, l: 0, c: 50, forming: true }).changed, []);
});

test('smc: memory stays bounded and the engine re-seeds itself', () => {
  const e = new SmcEngine({ ...P, maxBars: 200, keep: 50 });
  let rebuilt = 0, n = 0;
  for (let i = 0; i < 1500; i++) {
    const v = 100 + 10 * Math.sin(i / 7) + 3 * Math.sin(i / 2.3);
    const r = e.close({ t: T0 + i * STEP, o: v, h: v + 1, l: v - 1, c: v + 0.3 }); n++;
    if (r.rebuilt) rebuilt++;
  }
  assert.ok(rebuilt > 0); assert.ok(e.cs.length <= 200); assert.ok(e.ann.size <= 100);
  assert.ok(e.snapshot().annotations.length > 0);
});

// ---- zone mode (default): the IDM sits on the demand / supply zone of each BOS / CHoCH
const zones = (events) => find(events, 'idm').map((x) => x.a);

test('smc: zone mode: a BOS gets an IDM on its demand zone (last bearish candle at the pullback low + first bullish candle, body to body)', () => {
  const { events } = run(build([...up(10, 15), ...dn(14, 12), ...up(13, 18)]));
  const bos = find(events, 'bos')[0].a, z = zones(events)[0];
  assert.equal(z.dir, 1); assert.equal(z.zone, true); assert.equal(z.status, 'open'); assert.equal(z.ref, `bos:${bos.t0}:1`);
  assert.equal(idx(z.t0), 8);                         // the last bearish candle (14 -> 13) at the pullback low
  assert.equal(z.lo, 12); assert.equal(z.hi, 13);     // A body 13..12, B body 12..13
  assert.equal(z.price, z.hi);                        // demand zone: the edge price returns to is the top
});

test('smc: zone mode: a counter-trend break gets no zone on the chart (only BOS in the trend direction map IDM / DISR / LIQ)', () => {
  const { events } = run(build([...up(10, 15), ...dn(14, 12), ...up(13, 18), ...dn(17, 14), ...up(15, 16), ...dn(15, 9)]));
  assert.equal(find(events, 'choch').length, 1);
  assert.ok(zones(events).every((z) => z.dir === 1));
});

test('smc: zone mode: a wick back into the zone takes the IDM (swept), the break candle itself does not', () => {
  const base = [...up(10, 15), ...dn(14, 12), ...up(13, 18)];
  const { events } = run(build([...base, 19, 18, 17, 16, 15, 14, 13.2, 14]));
  const z = zones(events).find((q) => q.dir === 1 && q.status === 'swept');
  assert.ok(z); assert.ok(z.t1 > z.t0); assert.ok(idx(z.t1) > 12);
});

test('smc: zone mode: a body closing through the far side of the IDM (not the DISR) does not change the trend or the IDM', () => {
  const { e } = run(build([...up(10, 15), ...dn(14, 12), ...up(13, 18), ...dn(17, 15), ...up(16, 22), ...dn(21, 14)]));   // IDM zone 15..16 is closed through, DISR zone 12..13 is not
  assert.equal(e.trend, 1);
  const live = e.snapshot().annotations.filter((a) => a.type === 'idm');
  assert.deepEqual(live.map((a) => a.role).sort(), ['disr', 'idm']);
  assert.equal(live.find((a) => a.role === 'idm').lo, 15);
});

test('smc: zone mode: only idmMaxOpen zones are mapped', () => {
  const cs = build([...up(10, 15), ...dn(14, 12), ...up(13, 18), ...dn(17, 15), ...up(16, 22), ...dn(21, 19), ...up(20, 26), ...dn(25, 23), ...up(24, 30)]);
  const { e } = run(cs, { ...P, idmMaxOpen: 2 });
  assert.equal(e.snapshot().annotations.filter((a) => a.type === 'idm').length, 2);
});

test('smc: zone mode: seeding equals feeding candle by candle', () => {
  const cs = build([...up(10, 15), ...dn(14, 12), ...up(13, 18), ...dn(17, 14), ...up(15, 16), ...dn(15, 9), ...up(10, 14)]);
  const a = new SmcEngine(P); a.seed(cs);
  const { e: b } = run(cs);
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test('smc: zone mode keeps at most 3 untouched IDM zones by default', () => {
  assert.equal(smcDefaults.idmMaxOpen, 3); assert.equal(smcDefaults.idmMode, 'zone');
});

// ---- IDM = latest BOS in the trend direction, trend flips only when the DISR zone is invalidated
const mir = (vals) => vals.map((v) => 40 - v);
const twoBos = [...up(10, 15), ...dn(14, 12), ...up(13, 18), ...dn(17, 15), ...up(16, 22)];       // bull: BOS at 12 (zone 12..13), BOS at 21 (zone 15..16)
const roleOf = (e, role) => e.snapshot().annotations.find((a) => a.type === 'idm' && a.role === role);

test('smc: IDM is the zone of the latest BOS in the trend direction, DISR the BOS before it, LIQ the one before that', () => {
  const { e } = run(build([...twoBos, ...dn(21, 16), ...up(17, 23)]));
  assert.equal(e.trend, 1);
  assert.equal(roleOf(e, 'idm').lo, 16); assert.equal(roleOf(e, 'disr').lo, 15); assert.equal(roleOf(e, 'liq').lo, 12);
  assert.equal(roleOf(e, 'idm').label, 'IDM'); assert.equal(roleOf(e, 'disr').label, 'DISR');
});

test('smc: a pullback between the IDM and the DISR does not invalidate the trend (bull and bear)', () => {
  for (const [f, trend] of [[(v) => v, 1], [(v) => 40 - v, -1]]) {
    const { e } = run(build([...twoBos, ...dn(21, 13.5)].map(f)));         // closes below the IDM zone, still above the DISR zone's far side
    assert.equal(e.trend, trend);
  }
});

test('smc: bull -> bear when a body closes below the DISR zone; the old zones leave the chart and the order flow is mapped again downwards', () => {
  const { e, events } = run(build([...twoBos, ...dn(21, 8), ...up(9, 11), ...dn(10, 5)]));
  assert.equal(e.trend, -1);
  const flipAt = Math.min(...events.filter((x) => x.a.type === 'idm' && x.a.status === 'void').map((x) => idx(x.a.t1)));
  assert.equal(flipAt, 35);                                                // the candle that closed at 11.0 < 12 (DISR zone 12..13)
  const live = e.snapshot().annotations.filter((a) => a.type === 'idm');
  assert.ok(live.length >= 1 && live.every((a) => a.dir === -1));
  assert.equal(roleOf(e, 'idm').dir, -1);
});

test('smc: bear -> bull when a body closes above the DISR zone (mirror)', () => {
  const { e } = run(build(mir([...twoBos, ...dn(21, 8), ...up(9, 11), ...dn(10, 5)])));
  assert.equal(e.trend, 1);
  assert.ok(e.snapshot().annotations.filter((a) => a.type === 'idm').every((a) => a.dir === 1));
});

test('smc: a wick through the DISR zone that closes back inside it does not flip the trend', () => {
  const cs = build([...twoBos, ...dn(21, 14), [14, 14.2, 11.5, 14.1], 15, 16]);                    // wick to 11.5 below the DISR zone (12..13), close 14.1
  assert.equal(run(cs).e.trend, 1);
});

test('smc: 50% rule: a long-body candle only gives the half of its body on the zone side (demand: bottom half, supply: top half)', () => {
  const base = [...up(10, 15), ...dn(14, 13), [17, 17.2, 11.8, 12], ...up(13, 18)];                // A = long bearish body 17..12 at the pullback low
  const dem = zones(run(build(base).slice(0)).events)[0];
  assert.equal(dem.half, true); assert.equal(dem.lo, 12); assert.equal(dem.hi, 14.5);               // bottom 50% of 12..17
  const sup = zones(run(build(base.map((v) => (Array.isArray(v) ? [40 - v[0], 40 - v[2], 40 - v[1], 40 - v[3]] : 40 - v)))).events)[0];
  assert.equal(sup.dir, -1); assert.equal(sup.half, true); assert.equal(sup.hi, 28); assert.equal(sup.lo, 25.5);   // top 50% of 23..28
  const normal = zones(run(build([...up(10, 15), ...dn(14, 12), ...up(13, 18)])).events)[0];
  assert.equal(normal.half, undefined); assert.equal(normal.hi, 13);                                // ordinary bodies keep body-to-body
});

// ---- pullback at the IDM, flip info, and the SMC order flow in SORK shape (server/smcflow.js)
test('smc: pullback = a wick back into the IDM zone with an IDM and a DISR mapped; the next BOS in the trend direction resumes it', () => {
  const pb1 = run(build([...twoBos, ...dn(21, 15.5)])).e.snapshot().pullback;
  assert.ok(pb1 && pb1.dir === 1 && pb1.resume_t === null);
  const pb2 = run(build([...twoBos, ...dn(21, 15.5), ...up(16, 27)])).e.snapshot().pullback;           // new high = new BOS
  assert.equal(pb2.t, pb1.t); assert.ok(pb2.resume_t > pb2.t);
  assert.equal(run(build([...up(10, 15), ...dn(14, 12), ...up(13, 18), ...dn(17, 12)])).e.snapshot().pullback, null);   // only one BOS mapped: no pullback yet
});

test('smc: flip info is kept and the pullback is cleared on a flip', () => {
  const sn = run(build([...twoBos, ...dn(21, 15.5), ...dn(15, 8)])).e.snapshot();
  assert.equal(sn.trend, -1); assert.equal(sn.pullback, null);
  assert.equal(sn.flip.dir, 1); assert.equal(sn.flip.by, 'disruption');
});

test('smcflow: IDM / DISR / LIQ become inducement / disruption / plq POIs in SORK shape', () => {
  const cs = build([...twoBos, ...dn(21, 16), ...up(17, 23)]);
  const f = flowFromSnapshot(run(cs).e.snapshot(), cs);
  assert.equal(f.dir, 1);
  assert.deepEqual(f.pois.map((p) => p.role), ['inducement', 'disruption', 'plq']);
  const [ind, dis] = f.pois;
  assert.ok(ind.bos_idx > dis.bos_idx && dis.bos_idx > 0 && ind.lo < ind.hi && ind.bos_t > dis.bos_t);
  assert.ok(Number.isFinite(ind.line) && Number.isFinite(ind.bos_level) && Number.isFinite(ind.broken_t) && ind.ob_t <= ind.bos_t);
  assert.equal(f.invalidated, null);
});

test('smcflow: one BOS only is pending (no POIs yet); a flip gives invalidated + official; no trend gives an empty flow', () => {
  const cs1 = build([...up(10, 15), ...dn(14, 12), ...up(13, 18)]);
  const f1 = flowFromSnapshot(run(cs1).e.snapshot(), cs1);
  assert.equal(f1.pois.length, 0); assert.ok(f1.pending && f1.pending.dir === 1);
  const cs2 = build([...twoBos, ...dn(21, 8), ...up(9, 11), ...dn(10, 5)]);
  const f2 = flowFromSnapshot(run(cs2).e.snapshot(), cs2);
  assert.equal(f2.dir, -1); assert.equal(f2.invalidated.dir, 1); assert.equal(f2.official.dir, -1); assert.equal(f2.official.t, f2.invalidated.t);
  assert.ok(f2.pois.every((p) => p.dir === -1));
  assert.deepEqual(flowFromSnapshot(new SmcEngine(P).snapshot(), []).pois, []);
  assert.equal(smcFlow(cs2, P).dir, -1);                                                              // seeding = streaming
});
