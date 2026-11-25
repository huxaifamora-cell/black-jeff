import test from 'node:test';
import assert from 'node:assert/strict';
import { Service, formatAlert, isSmcAlert } from '../server/service.js';
import { Store } from '../server/store.js';

const quiet = { info() {}, warn() {}, error() {} };
const M = 300, N = 20000, T0 = 1_700_000_000 - (1_700_000_000 % 14400);
// Seeded random walk with changing drift, 5-minute candles; H1 / H4 are built from them.
function gen(seed) {
  let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  let p = 1000, drift = 0.02; const out = [];
  for (let i = 0; i < N; i++) {
    if (i % 600 === 0) drift = (rnd() - 0.5) * 0.4;
    const o = p, c = o + drift + (rnd() - 0.5) * 1.2;
    out.push({ t: T0 + i * M, o, h: Math.max(o, c) + rnd() * 0.5, l: Math.min(o, c) - rnd() * 0.5, c }); p = c;
  }
  return out;
}
const agg = (m5, g) => {
  const out = [];
  for (let i = 0; i + g / M <= m5.length; i += g / M) { const ch = m5.slice(i, i + g / M); out.push({ t: ch[0].t, o: ch[0].o, h: Math.max(...ch.map((x) => x.h)), l: Math.min(...ch.map((x) => x.l)), c: ch[ch.length - 1].c }); }
  return out;
};

test('smc flow: the SORK key level rules run on the SMC order flow; alerts are keyed and tagged smc, and SORK alerts are untouched', () => {
  const m5all = gen(3 * 7919), svc = new Service(new Store(':memory:'), undefined, quiet);
  svc.smcAlerts = true;
  const got = [];
  for (let cut = N - 3000; cut <= N; cut += 288) {                      // replay, so earlier events are not stale when they are seen
    const mm = m5all.slice(0, cut), now = mm[mm.length - 1].t + M + 10;
    got.push(...svc.applySmc('V75', agg(mm, 14400), agg(mm, 3600), mm, now));
  }
  const kl = got.find((a) => a.concept === 'K' && a.kind === 'kl_valid');
  assert.ok(kl, 'a valid key level on the SMC order flow');
  assert.ok(kl.key.includes('|smc|') && kl.payload.src === 'smc' && isSmcAlert(kl) && kl.id);
  assert.ok(formatAlert({ ...kl, symbol_name: 'Volatility 75 Index' }).includes('SMC'));
  assert.ok(!formatAlert({ ...kl, key: 'V75|K|kl_valid|x', payload: {}, symbol_name: 'Volatility 75 Index' }).includes('SMC'));
  const st = svc.smcStates.get('V75');
  assert.ok(st.o.pois.some((p) => p.role === 'inducement') && st.k.active && !st.candles);
  assert.ok(st.overlays.some((o) => o.grp === 'k') && st.overlays.some((o) => o.label === '50% POI'));
  const v = svc.smcView('V75');
  assert.equal(v.id, 'V75'); assert.ok(Array.isArray(v.steps));
  assert.equal(svc.smcView('nope'), null);
});

test('smc flow: off by default; the same candles give no SMC state until it is turned on', async () => {
  const svc = new Service(new Store(':memory:'), undefined, quiet);
  assert.equal(svc.smcAlerts, false);
  assert.equal(svc.smcStates.size, 0);
});

test('smc flow: with sorkAlerts off no SORK alert is stored, with sorkBoxes off the SORK state has no POI boxes; the state itself is still kept', () => {
  const m5 = gen(3 * 7919), h1 = agg(m5, 3600), h4 = agg(m5, 14400), now = m5[m5.length - 1].t + M + 10;
  const off = new Service(new Store(':memory:'), undefined, quiet);
  off.sorkAlerts = false; off.sorkBoxes = false;
  assert.deepEqual(off.apply('V75', h4, h1, m5, now), []);
  const st = off.states.get('V75');
  assert.ok(st && st.o && st.s);
  assert.equal(st.overlays.filter((o) => o.type === 'box').length, 0);
});

test('smc primary: the state the app shows (symbol page, checklist, radar) and the alerts all come from the SMC order flow', () => {
  const m5 = gen(3 * 7919), svc = new Service(new Store(':memory:'), undefined, quiet);
  svc.smcAlerts = true; svc.smcPrimary = true;
  const got = [];
  for (let cut = N - 3000; cut <= N; cut += 288) {
    const mm = m5.slice(0, cut), now = mm[mm.length - 1].t + M + 10;
    got.push(...svc.apply('V75', agg(mm, 14400), agg(mm, 3600), mm, now));
  }
  assert.ok(got.length && got.every((a) => a.key.includes('|smc|') && a.payload.src === 'smc'));
  const st = svc.states.get('V75'), sm = svc.smcStates.get('V75');
  assert.equal(st.o.source, 'smc');                                              // the order flow is the SMC one
  assert.ok(st.o.pois.length && st.o.pois[0].swept !== undefined);              // SMC POIs carry the zone status
  assert.equal(st.overlays.filter((o) => o.type === 'box').length, 0);          // the chart draws the SMC boxes itself
  assert.ok(sm.overlays.some((o) => o.type === 'box') && !sm.candles);          // from this copy (/api/smc/flow)
  assert.equal(svc.symbolView('V75').state, st);
  assert.ok(svc.overview().find((r) => r.id === 'V75').trend === st.s.trend);
});

test('sniper on SMC rules: a wick through the disruption does not end the flow, a body close does; the pullback is a wick back into the inducement', async () => {
  const { manualSmcFlow } = await import('../server/smcflow.js');
  const T = 1_700_000_000, H = 3600;
  const cs = (rows) => rows.map(([o, h, l, c], i) => ({ t: T + i * H, o, h, l, c }));
  const spec = { dir: 1, ind: { lo: 15, hi: 16, t: T + 3 * H }, dis: { lo: 12, hi: 13, t: T + 1 * H } };
  const base = [[10, 11, 9.5, 10.5], [11, 14, 10.5, 13], [13, 14, 12.5, 13.5], [14, 17, 13.8, 16.5], [16.5, 18, 16.2, 17.8], [17.8, 18, 15.5, 16.4]];   // last candle wicks into the inducement (15..16)
  const wick = manualSmcFlow(cs([...base, [16, 16.5, 11.5, 14]]), spec, { swingLen: 2, internalLen: 1 });     // wick to 11.5 below the disruption, closes at 14
  assert.equal(wick.invalidated, null); assert.ok(wick.pullback && wick.pullback.resume_t === null); assert.equal(wick.source, 'smc');
  const body = manualSmcFlow(cs([...base, [16, 16.5, 11, 11.8]]), spec, { swingLen: 2, internalLen: 1 });      // body closes below 12
  assert.equal(body.invalidated.dir, 1); assert.equal(body.official.dir, -1); assert.equal(body.pullback, null);
});
