import test from 'node:test';
import assert from 'node:assert/strict';
import { C, H1, H4, M5, defaultParams as P, evaluate, manualOrderFlow } from '../server/engine.js';
import { Service, formatSniperAlert, alertLabel } from '../server/service.js';
import { createApp } from '../server/app.js';
import { Store, MAX_SNIPER_FLOWS } from '../server/store.js';
import { WANTED, norm } from '../server/symbols.js';

const quiet = { info() {}, warn() {}, error() {} };
function mk(segments, { start = 100, t0 = 0, step = 3600, wick = 0.1 } = {}) {
  const cs = []; let price = start, t = t0;
  for (const [delta, n] of segments) for (let i = 0; i < n; i++) {
    const o = price, c = price + delta;
    cs.push(C(t, o, Math.max(o, c) + wick, Math.min(o, c) - wick, c)); price = c; t += step;
  }
  return cs;
}
// A rising market (like the evaluate fixture), optionally followed by a crash that goes through the person's disruption.
function fixture(crash) {
  const h4 = mk([[2, 6], [-1.5, 3], [2, 6], [-1.5, 3], [2.2, 8], [-1.5, 3], [2.5, 8]], { start: 1000, step: 14400 });
  const h1 = mk([[0.5, 6], [-0.4, 3], [0.5, 6], [-0.4, 3], [0.5, 8], [-0.4, 3], [0.5, 8], ...(crash ? [[-1.0, crash]] : [])], { start: 1000 });
  const m5 = mk(Array.from({ length: 3 }, () => [[0.1, 6], [-0.08, 3], [0.1, 6], [-0.08, 3], [0.1, 8]]).flat(), { start: 1000, step: 300 });
  return { h4, h1, m5 };
}
// the service keeps the candles it fetched in its cache; tests fill it by hand
const load = (svc, c, now) => { const e = svc.cache.get('V10'); e[H4] = { cs: c.h4 }; e[H1] = { cs: c.h1 }; e[M5] = { cs: c.m5 }; svc.apply('V10', c.h4, c.h1, c.m5, now); };
const spec = { dir: 1, dis: { lo: 1001, hi: 1001.5, t: 2 * 3600 }, ind: { lo: 1004, hi: 1004.5, t: 5 * 3600 } };

test('manualOrderFlow: the flow is exactly what the person set, and it ends when the disruption is wicked through', () => {
  const { h1 } = fixture(0);
  const of = manualOrderFlow(h1, spec);
  assert.equal(of.dir, 1); assert.deepEqual(of.pois.map((x) => x.role), ['inducement', 'disruption']);
  assert.equal(of.pois[0].lo, 1004); assert.equal(of.pois[1].hi, 1001.5); assert.equal(of.invalidated, null);
  const dead = manualOrderFlow(fixture(14).h1, spec);
  assert.ok(dead.invalidated && dead.invalidated.by === 'disruption'); assert.equal(dead.official.dir, -1);
  const early = manualOrderFlow(mk([[0.5, 6], [-1.5, 2], [0.5, 10]], { start: 1000 }), { dir: 1, dis: { lo: 1001, hi: 1001.5, t: 3600 }, ind: { lo: 1004, hi: 1004.5, t: 12 * 3600 } });
  assert.equal(early.invalidated, null, 'a dip below the disruption BEFORE the inducement existed does not end the flow');
  const bear = manualOrderFlow(h1, { dir: -1, dis: { lo: 1100, hi: 1101, t: 3600 }, ind: { lo: 1090, hi: 1091, t: 7200 } });
  assert.equal(bear.dir, -1); assert.equal(bear.invalidated, null, 'price never reached that disruption');
});

test('evaluate with a manual flow: no automatic trend / POI news, break of structure after the POIs, invalidation text', () => {
  const { h4, h1, m5 } = fixture(0);
  const out = evaluate(h4, h1, m5, P, 3, { manual: spec });
  assert.ok(!out.events.some((e) => e.kind === 'trend_valid' || e.kind === 'inducement' || e.kind === 'disruption'));
  const bos = out.events.filter((e) => e.kind === 'bos');
  assert.ok(bos.length >= 1 && bos.every((e) => e.dir === 1 && e.t > 5 * 3600 && Number.isFinite(e.extra.level)), 'valid H1 breaks of structure with the flow');
  assert.equal(out.state.o.pois.length, 2); assert.equal(out.state.s.trend, 1);
  JSON.stringify(out);
  const crashed = evaluate(...Object.values(fixture(14)), P, 3, { manual: spec });
  const inv = crashed.events.find((e) => e.kind === 'invalidated');
  assert.ok(inv && inv.title.includes('your order flow'), 'invalidated');
  // a break the other way (against the flow) is a change of structure
  const choch = evaluate(...Object.values(fixture(14)), P, 3, { manual: spec }).events.filter((e) => e.kind === 'choch');
  assert.ok(choch.every((e) => e.dir === -1));
});

test('service.sniperEvents: only events after the flow was set, fresh ones, and the flow ends on invalidation', () => {
  const svc = new Service(new Store(':memory:'), P, quiet);
  const { h4, h1, m5 } = fixture(0);
  const when = (c, kind) => evaluate(c.h4, c.h1, c.m5, P, 3, { manual: spec }).events.filter((e) => e.kind === kind).at(-1).t;
  const now = when({ h4, h1, m5 }, 'bos') + 600;                                          // just after the latest break of structure
  load(svc, { h4, h1, m5 }, now);
  const flow = { id: 'f1', dir: 1, ind: spec.ind, dis: spec.dis, created: 0 };
  const r = svc.sniperEvents('V10', flow, now);
  assert.ok(r.alerts.length > 0 && !r.ended);
  assert.ok(r.alerts.every((a) => a.key.startsWith('f1|') && a.title && a.snap && a.symbol === 'V10'));
  assert.ok(r.alerts.some((a) => a.kind === 'bos' && a.snap.lines.some((l) => l.label === 'BOS')), 'the break of structure chart draws the broken level');
  assert.deepEqual(svc.sniperEvents('V10', { ...flow, created: now + 1e6 }, now).alerts, [], 'set after those events: nothing is sent');
  assert.deepEqual(svc.sniperEvents('V10', flow, now + 10 * 86400).alerts, [], 'old events are not sent');
  assert.equal(svc.sniperEvents('V25', flow), null, 'no data yet');
  // crash: the invalidation is sent, nothing after it, and the flow is over
  const c = fixture(14), s2 = new Service(new Store(':memory:'), P, quiet), end = when(c, 'invalidated') + 600;
  load(s2, c, end);
  const r2 = s2.sniperEvents('V10', flow, end);
  assert.ok(r2.ended); const inv = r2.alerts.find((a) => a.kind === 'invalidated');
  assert.ok(inv); assert.equal(inv.snap.box.label, 'DISRUPTION');
  assert.ok(r2.alerts.every((a) => a.kind === 'invalidated' || a.ts < inv.ts), 'nothing is said about the flow after it is over');
  assert.ok(s2.sniperDead('V10', spec) && !svc.sniperDead('V10', spec));
});

test('Telegram text for Sniper Mode: dot + keyword, no bullish / bearish, a Sniper Mode line', () => {
  const t = formatSniperAlert({ kind: 'bos', concept: 'S', dir: 1, symbol_name: 'Volatility 10 Index' });
  assert.ok(t.startsWith('🟢 <b>BREAK OF STRUCTURE</b>') && t.includes('SNIPER MODE') && !/bullish|bearish/i.test(t), t);
  assert.ok(formatSniperAlert({ kind: 'choch', concept: 'S', dir: -1, symbol_name: 'V' }).startsWith('🔴 <b>CHANGE OF STRUCTURE</b>'));
  const inv = formatSniperAlert({ kind: 'invalidated', concept: 'O', dir: 0, symbol_name: 'V' });
  assert.ok(inv.includes('INVALIDATED') && inv.includes('ORDER FLOW') && inv.includes('set a new one'), inv);
  assert.equal(alertLabel({ kind: 'bos', concept: 'S', dir: 1 }), 'BREAK OF STRUCTURE');
});

test('store: Sniper flows (one per symbol, limit, seen keys, end, backup)', () => {
  const st = new Store(':memory:');
  const a = st.sniperSet(7, 'V10', spec, 1000);
  assert.equal(a.status, 'active'); assert.equal(a.ind.lo, 1004);
  const b = st.sniperSet(7, 'V10', { ...spec, dir: -1 }, 2000);                         // setting it again replaces it
  assert.equal(st.sniperList(7, 'V10').length, 1); assert.equal(b.dir, -1); assert.notEqual(a.id, b.id);
  st.sniperMark(b.id, ['k1', 'k2']); st.sniperMark(b.id, ['k2', 'k3']);
  assert.deepEqual(st.sniperActive('V10')[0].seen, ['k1', 'k2', 'k3']);
  const st2 = new Store(':memory:'); assert.equal(st2.importSniper(JSON.parse(JSON.stringify(st.exportSniper()))), 1);
  assert.deepEqual(st2.sniperActive('V10')[0].seen, ['k1', 'k2', 'k3']);
  assert.equal(st2.importSniper([{ id: 'x', tg_id: 1, symbol: 'V10', dir: 0 }]), 0, 'bad rows are ignored');
  assert.ok(st.sniperEnd(b.id)); assert.equal(st.sniperActive('V10').length, 0); assert.equal(st.sniperList(7, 'V10')[0].status, 'ended');
  for (let i = 0; i < MAX_SNIPER_FLOWS; i++) st.sniperSet(8, `S${i}`, spec);
  assert.equal(st.sniperSet(8, 'ONE_TOO_MANY', spec), null);
  assert.ok(st.sniperSet(8, 'S0', spec), 'replacing an existing one is still allowed at the limit');
  assert.ok(st.sniperDelete(8, st.sniperList(8, 'S0')[0].id) && !st.sniperDelete(9, 'nope'));
});

test('app: checkSniperFlows sends each new event once, privately, and ends a dead flow', async () => {
  const sent = [], bot = { send: async (c, t) => { sent.push([c, t]); }, sendPhoto: async (c, p, t) => { sent.push([c, t, p.length]); }, stop() {}, poll() {}, setMenuButton() { return Promise.resolve(); } };
  const cfg = { botToken: '123456:TEST', webappUrl: 'https://x.test', port: 0, dbPath: ':memory:', requireAuth: false, pollSeconds: 60, derivUrls: [], derivAppId: '1' };
  const app = createApp({ cfg, store: new Store(':memory:'), deriv: { symbolCodes: async () => ({}), close() {} }, bot, log: quiet, background: false });
  const c = fixture(14), end = evaluate(c.h4, c.h1, c.m5, P, 3, { manual: spec }).events.find((e) => e.kind === 'invalidated').t + 600;
  load(app.svc, c, end);
  const realNow = Date.now; Date.now = () => end * 1000;                                  // events are "fresh" relative to the end of the fixture
  try {
    const f = app.store.sniperSet(42, 'V10', spec, 0);
    await app.checkSniperFlows('V10');
    assert.ok(sent.length >= 1 && sent.every(([chat, text]) => chat === 42 && text.includes('SNIPER MODE')));
    assert.ok(sent.some(([, text]) => text.includes('ORDER FLOW')) && sent.every((m) => m.length === 3), 'with a chart picture');
    assert.equal(app.store.sniperList(42, 'V10')[0].status, 'ended', 'dead flow ends');
    const n = sent.length; await app.checkSniperFlows('V10'); assert.equal(sent.length, n, 'nothing is sent twice');
    assert.ok(f.id);
  } finally { Date.now = realNow; await app.stop(); }
});

const fakeDeriv = {
  async symbolCodes() { return Object.fromEntries(WANTED.map((n, i) => [norm(n), `SYM${i}`])); },
  async candles(code, gran, count) {
    const end = Math.floor(Date.now() / 1000 / gran) * gran, out = [];
    let p = 1000;
    for (let i = 0; i < count; i++) { const o = p, c = p + 4 * Math.sin(i / 5); out.push(C(end - (count - i) * gran, o, Math.max(o, c) + 0.5, Math.min(o, c) - 0.5, c)); p = c; }
    return out;
  },
  close() {},
};
test('API: /api/sniper validates, saves, returns and deletes a flow', async () => {
  const cfg = { botToken: '', webappUrl: '', port: 0, dbPath: ':memory:', requireAuth: false, pollSeconds: 1, derivUrls: [], derivAppId: '1' };
  const app = createApp({ cfg, store: new Store(':memory:'), deriv: fakeDeriv, log: quiet });
  const port = await app.start(0), base = `http://127.0.0.1:${port}`;
  const post = async (path, body) => { const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return [r.status, await r.json()]; };
  try {
    let v; for (let i = 0; i < 80 && !(v && v.state); i++) { v = await (await fetch(`${base}/api/symbol/V10`)).json(); if (!v.state) await new Promise((r) => setTimeout(r, 100)); }
    const tNow = v.state.candles.h1.at(-1)[0] - 3600, ok = { symbol: 'V10', dir: 1, dis: { lo: 1, hi: 2, t: tNow }, ind: { lo: 3, hi: 4, t: tNow } };
    assert.equal((await post('/api/sniper', { ...ok, symbol: 'NOPE' }))[0], 400);
    assert.equal((await post('/api/sniper', { ...ok, dir: 0 }))[0], 400);
    assert.match((await post('/api/sniper', { ...ok, ind: { lo: 0.5, hi: 1.5, t: tNow } }))[1].error, /above the disruption/);
    assert.match((await post('/api/sniper', { ...ok, dir: -1 }))[1].error, /below the disruption/);
    assert.match((await post('/api/sniper', { ...ok, dis: { lo: 2, hi: 1, t: tNow } }))[1].error, /high above its low/);
    assert.match((await post('/api/sniper', { symbol: 'V10', dir: 1, dis: { lo: 1e9, hi: 1e9 + 1, t: 1000 }, ind: { lo: 1e9 + 2, hi: 1e9 + 3, t: 1000 } }))[1].error, /already went beyond/);
    const [code, saved] = await post('/api/sniper', ok);
    assert.equal(code, 200); assert.equal(saved.flow.status, 'active'); assert.equal(saved.flow.dis.hi, 2);
    const got = await (await fetch(`${base}/api/sniper?symbol=V10`)).json();
    assert.equal(got.flow.id, saved.flow.id); assert.equal((await (await fetch(`${base}/api/sniper?symbol=V25`)).json()).flow, null);
    assert.equal((await post('/api/sniper/delete', { id: saved.flow.id }))[1].ok, true);
    assert.equal((await (await fetch(`${base}/api/sniper?symbol=V10`)).json()).flow, null);
  } finally { await app.stop(); }
});
