import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { Store } from '../server/store.js';
import { smcAlertsFrom } from '../server/smcalerts.js';
import { Service } from '../server/service.js';
import { WANTED, norm } from '../server/symbols.js';
import { C } from '../server/engine.js';

const quiet = { info() {}, warn() {}, error() {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TF = 300;
const up = (a, b) => { const r = []; for (let v = a; v <= b; v++) r.push(v); return r; };
const dn = (a, b) => { const r = []; for (let v = a; v >= b; v--) r.push(v); return r; };
const HIST = [...up(10, 15), ...dn(14, 12), 13, 14];
const P = { swingLen: 2, internalLen: 1, idmMinDepthAtr: 0.1 };

function fakeDeriv(closes) {
  const cur = Math.floor(Date.now() / 1000 / TF) * TF;
  const hist = closes.map((v, i, a) => { const o = i ? a[i - 1] : v; return { epoch: cur - (closes.length - i) * TF, open: o, high: Math.max(o, v) + 0.2, low: Math.min(o, v) - 0.2, close: v }; });
  const d = { subs: [], cur, async symbolCodes() { return Object.fromEntries(WANTED.map((n, i) => [norm(n), `SYM${i}`])); },
    async subscribeCandles(code, gran, count, onMessage, onClose) {
      const s = { onMessage, onClose, stopped: false }; d.subs.push(s);
      const l = closes[closes.length - 1];
      return { first: { candles: [...hist, { epoch: cur, open: l, high: l + 0.1, low: l - 0.1, close: l }] }, stop() { s.stopped = true; } };
    },
    tick(t, o, h, l, c) { for (const s of d.subs) if (!s.stopped) s.onMessage({ msg_type: 'ohlc', ohlc: { open_time: t, open: o, high: h, low: l, close: c } }); },
    drop() { for (const s of d.subs) if (!s.stopped) { s.stopped = true; s.onClose(); } }, close() {} };
  return d;
}

test('smcalerts: a BOS and a new IDM / DISR zone become S / O alerts; H1 keys match the polled path so the two never double-send', () => {
  const changed = [
    { id: 'bos:1:1', type: 'bos', dir: 1, t0: 100, t1: 7200, price: 15 },
    { id: 'idm:1:1', type: 'idm', dir: 1, zone: true, role: 'idm', status: 'open', lo: 12, hi: 13, t0: 3600, bos_t: 7200, bos_level: 15 },
    { id: 'idm:0:1', type: 'idm', dir: 1, zone: true, role: 'disr', status: 'open', lo: 9, hi: 10, t0: 0, bos_t: 3600, bos_level: 11 },
    { id: 'bos:x:1', type: 'bos', dir: 1, t0: 1, t1: 9000, price: 1, provisional: true },       // forming candle: never alerted
    { id: 'idm:2:-1', type: 'idm', dir: -1, zone: true, role: 'idm', status: 'open', lo: 1, hi: 2, t0: 1, bos_t: 1 },   // against the trend
  ];
  const r = smcAlertsFrom({ sym: 'V75', name: 'Volatility 75 Index', tf: 3600, changed, trend: 1, prevTrend: 1, t: 7200 });
  assert.deepEqual(r.map((a) => `${a.concept}|${a.kind}`), ['S|bos', 'O|inducement', 'O|disruption']);
  assert.equal(r[0].key, 'V75|smc|S|bos|bos-7200');
  assert.equal(r[1].key, 'V75|smc|O|inducement|inducement-7200');     // the same key service.apply() builds for the H1 inducement
  assert.equal(r[0].ts, 7200 + 3600);
  assert.ok(r.every((a) => a.payload.src === 'smc'));
  const flip = smcAlertsFrom({ sym: 'V75', name: 'x', tf: 3600, changed: [], trend: -1, prevTrend: 1, t: 10800 });
  assert.equal(flip.length, 1); assert.equal(flip[0].kind, 'invalidated'); assert.equal(flip[0].dir, -1); assert.equal(flip[0].key, 'V75|smc|O|invalidated|inv-10800');
  assert.equal(smcAlertsFrom({ sym: 'V75', name: 'x', tf: 3600, changed: [], trend: 1, prevTrend: null, t: 1 }).length, 0, 'no flip without a known previous trend');
  assert.ok(smcAlertsFrom({ sym: 'V75', name: 'x', tf: 300, changed: [changed[0]], trend: 1 })[0].key.includes('|m5-bos-'), 'other timeframes carry their own prefix');
});

test('service.liveTick: the forming candle and the price follow the stream; a new candle opens; an old one is ignored', () => {
  const svc = new Service(new Store(':memory:'), undefined, quiet);
  const base = Math.floor(Date.now() / 1000 / TF) * TF - 2 * TF;
  svc.cache.get('V10')[TF] = { cs: [C(base, 1, 2, 0, 1), C(base + TF, 1, 2, 0, 1.5)] };
  svc.states.set('V10', { price: 1.5 });
  assert.equal(svc.liveTick('V10', C(base + TF, 1, 3, 0, 2.5), TF), true);
  const cs = svc.cache.get('V10')[TF].cs;
  assert.equal(cs.length, 2); assert.equal(cs[1].c, 2.5); assert.equal(svc.states.get('V10').price, 2.5);
  assert.equal(svc.liveTick('V10', C(base + 2 * TF, 2.5, 2.6, 2.4, 2.6), TF), true);
  assert.equal(cs.length, 3); assert.equal(cs[2].forming, true); assert.equal(cs[1].forming, undefined); assert.equal(svc.states.get('V10').price, 2.6);
  assert.equal(svc.liveTick('V10', C(base, 1, 1, 1, 1), TF), false, 'late message of an old candle');
  assert.equal(svc.liveTick('V99', C(base, 1, 1, 1, 1), TF), false, 'symbol with no history yet');
});

test('app: a BOS on the live feed reaches Telegram the moment the candle closes, with nobody on the chart', async () => {
  const d = fakeDeriv(HIST), sent = [];
  const cfg = { botToken: 'x', webappUrl: '', port: 0, dbPath: ':memory:', requireAuth: false, pollSeconds: 3600, derivUrls: [], derivAppId: '1',
    alertChats: ['@chan'], chatConcepts: ['S', 'O'], smcAlertChats: true, dmAlerts: false, smcAlerts: true, smcAlertTfs: ['m5'],
    smc: true, smcSwingLen: 2, smcInternalLen: 1, smcTimeframes: ['m5'], smcPinned: ['V10'], smcPinTimeframes: ['m5'] };
  const bot = { send(c, t) { sent.push([c, t]); return Promise.resolve(); }, stop() {}, poll() {}, setMenuButton() { return Promise.resolve(); } };
  const app = createApp({ cfg, store: new Store(':memory:'), deriv: d, bot, log: quiet, background: false });
  await app.start(0);
  app.svc.setCodes(await d.symbolCodes());
  app.smc.confirmOnRoll = false; app.smc.params = P;
  try {
    await app.smc.watch('V10', TF);                                   // what pinSmc does for a pinned symbol
    d.tick(d.cur, 14, 16.5, 13.9, 16);                                // forming candle above the swing high: provisional only, nothing is sent
    await sleep(50);
    assert.equal(sent.length, 0);
    d.tick(d.cur + TF, 16, 16.2, 15.8, 16.1);                         // the candle closes
    await sleep(150);
    const texts = sent.map((x) => x[1]);
    assert.ok(texts.some((t) => t.includes('BREAK OF STRUCTURE') && t.includes('Volatility 10 Index') && t.includes('SMC')), texts.join('\n'));
    assert.ok(sent.every((x) => x[0] === '@chan'));
    assert.equal(app.store.recentAlerts({ symbol: 'V10' }).some((a) => a.kind === 'bos' && a.concept === 'S'), true, 'also in the app\'s Alerts tab');
    const n = sent.length;
    d.tick(d.cur + TF, 16, 16.3, 15.8, 16.2);                         // the same candle again: nothing new
    await sleep(50);
    assert.equal(sent.length, n);
  } finally { await app.stop(); }
});

test('app: after a dropped socket the missed BOS is sent on reconnect, once', async () => {
  const d = fakeDeriv(HIST), sent = [];
  const cfg = { botToken: 'x', webappUrl: '', port: 0, dbPath: ':memory:', requireAuth: false, pollSeconds: 3600, derivUrls: [], derivAppId: '1',
    alertChats: ['@chan'], chatConcepts: ['S', 'O'], smcAlertChats: true, dmAlerts: false, smcAlerts: true, smcAlertTfs: ['m5'],
    smc: true, smcSwingLen: 2, smcInternalLen: 1, smcTimeframes: ['m5'], smcPinned: [], smcPinTimeframes: ['m5'] };
  const bot = { send(c, t) { sent.push(t); return Promise.resolve(); }, stop() {}, poll() {}, setMenuButton() { return Promise.resolve(); } };
  const app = createApp({ cfg, store: new Store(':memory:'), deriv: d, bot, log: quiet, background: false });
  await app.start(0);
  app.svc.setCodes(await d.symbolCodes());
  app.smc.confirmOnRoll = false; app.smc.params = P;
  try {
    await app.smc.watch('V10', TF);
    assert.equal(sent.length, 0, 'the first snapshot is history, not news');
    d.drop();
    // while the socket is down a BOS candle closes: the next history the feed loads already contains it
    const live = [...HIST, 16]; const d2 = fakeDeriv(live);
    d.subscribeCandles = d2.subscribeCandles; d2.subs = d.subs;
    await sleep(2300);
    assert.equal(sent.filter((t) => t.includes('BREAK OF STRUCTURE')).length, 1, sent.join('\n'));
  } finally { await app.stop(); }
});
