import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { SmcFeed } from '../server/smcfeed.js';
import { createApp } from '../server/app.js';
import { Store } from '../server/store.js';
import { WANTED, norm } from '../server/symbols.js';

const quiet = { info() {}, warn() {}, error() {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TF = 300;

// A fake Deriv WebSocket: history on subscribe, then the test pushes ohlc ticks like Deriv would.
function fakeDeriv(closes) {
  const now = Math.floor(Date.now() / 1000), cur = Math.floor(now / TF) * TF;
  const hist = closes.map((v, i, a) => { const o = i ? a[i - 1] : v; return { epoch: cur - (closes.length - i) * TF, open: o, high: Math.max(o, v) + 0.2, low: Math.min(o, v) - 0.2, close: v }; });
  const d = { subs: [], subscribes: 0, hist, cur,
    async symbolCodes() { return Object.fromEntries(WANTED.map((n, i) => [norm(n), `SYM${i}`])); },
    async subscribeCandles(code, gran, count, onMessage, onClose) {
      d.subscribes++;
      const s = { onMessage, onClose, stopped: false }; d.subs.push(s);
      const forming = { epoch: cur, open: closes[closes.length - 1], high: closes[closes.length - 1] + 0.1, low: closes[closes.length - 1] - 0.1, close: closes[closes.length - 1] };
      return { first: { candles: [...hist, forming] }, stop() { s.stopped = true; } };
    },
    tick(t, o, h, l, c) { for (const s of d.subs) if (!s.stopped) s.onMessage({ msg_type: 'ohlc', ohlc: { open_time: t, open: o, high: h, low: l, close: c } }); },
    drop() { for (const s of d.subs) if (!s.stopped) { s.stopped = true; s.onClose(); } },
    close() {} };
  return d;
}
const up = (a, b) => { const r = []; for (let v = a; v <= b; v++) r.push(v); return r; };
const dn = (a, b) => { const r = []; for (let v = a; v >= b; v--) r.push(v); return r; };
const P = { swingLen: 2, internalLen: 1, idmMinDepthAtr: 0.1 };
// up to 15, back to 12, bounce to 14: the next close above 15.2 is a BOS
const HIST = [...up(10, 15), ...dn(14, 12), 13, 14];

test('smcfeed: seeds from the subscription history, a closed candle produces a BOS, ticks produce a provisional preview', async () => {
  const d = fakeDeriv(HIST);
  const feed = new SmcFeed({ deriv: d, codeOf: () => 'SYM0', params: P, timeframes: [TF], log: quiet, confirmOnRoll: false });
  const events = [];
  for (const ev of ['snapshot', 'update', 'live']) feed.on(ev, (m) => events.push([ev, m]));
  try {
    const snap = await feed.watch('V10', TF);
    assert.ok(snap.annotations.some((a) => a.type === 'swing'));
    assert.equal(snap.trend, 0);
    assert.equal(events.filter((e) => e[0] === 'snapshot').length, 1);
    // the forming candle is running above the swing high right now -> provisional BOS, not committed
    d.tick(d.cur, 14, 16.5, 13.9, 16);
    const live = events.filter((e) => e[0] === 'live').pop();
    assert.equal(live[1].live[0].type, 'bos'); assert.equal(live[1].live[0].provisional, true);
    assert.equal(feed.snapshot('V10', TF).annotations.some((a) => a.type === 'bos'), false);
    // the next candle opens -> the previous one is final -> committed BOS pushed as an update
    d.tick(d.cur + TF, 16, 16.2, 15.8, 16.1);
    await sleep(20);
    const upd = events.filter((e) => e[0] === 'update').pop();
    assert.ok(upd, 'update event');
    assert.equal(upd[1].changed.find((a) => a.type === 'bos').dir, 1);
    assert.equal(upd[1].trend, 1);
    assert.equal(feed.snapshot('V10', TF).trend, 1);
  } finally { feed.stop(); }
});

test('smcfeed: a dropped socket resubscribes by itself and re-sends a snapshot', async () => {
  const d = fakeDeriv(HIST);
  const feed = new SmcFeed({ deriv: d, codeOf: () => 'SYM0', params: P, timeframes: [TF], log: quiet, confirmOnRoll: false });
  let snaps = 0; feed.on('snapshot', () => snaps++);
  try {
    await feed.watch('V10', TF);
    d.drop();
    await sleep(2300);                       // first retry after 2 s
    assert.equal(d.subscribes, 2); assert.equal(snaps, 2);
    assert.equal(feed.snapshot('V10', TF).state, 'live');
  } finally { feed.stop(); }
});

test('smcfeed: a gap in candles rebuilds from history; unsupported timeframes and unknown codes are refused', async () => {
  const d = fakeDeriv(HIST);
  const feed = new SmcFeed({ deriv: d, codeOf: (s) => (s === 'V10' ? 'SYM0' : null), params: P, timeframes: [TF], log: quiet, confirmOnRoll: false });
  try {
    await feed.watch('V10', TF);
    d.tick(d.cur + 5 * TF, 1, 2, 0, 1);      // 5 candles later: we missed some
    await sleep(30);
    assert.equal(d.subscribes, 2);
    assert.equal(await feed.watch('V10', 3600), null);
    assert.equal(await feed.watch('V99', TF), null);
  } finally { feed.stop(); }
});

test('server: /api/smc snapshot and the live event stream (SSE)', async () => {
  const d = fakeDeriv(HIST);
  const cfg = { botToken: '', webappUrl: '', port: 0, dbPath: ':memory:', requireAuth: false, pollSeconds: 3600, derivUrls: [], derivAppId: '1',
    smc: true, smcSwingLen: 2, smcInternalLen: 1, smcTimeframes: ['m5'], smcPinned: [] };
  const app = createApp({ cfg, store: new Store(':memory:'), deriv: d, log: quiet, background: false });
  const port = await app.start(0), base = `http://127.0.0.1:${port}`;
  app.svc.setCodes(await d.symbolCodes());
  app.smc.confirmOnRoll = false;
  app.smc.params = P;
  try {
    assert.equal((await fetch(`${base}/api/smc?symbol=NOPE&tf=m5`)).status, 400);
    assert.equal((await fetch(`${base}/api/smc?symbol=V10&tf=h4`)).status, 400);
    const snap = await (await fetch(`${base}/api/smc?symbol=V10&tf=m5`)).json();
    assert.equal(snap.state, 'live'); assert.ok(snap.annotations.length > 0);
    // stream: first frame is a snapshot, then the BOS arrives as an update when a candle closes
    const frames = [], ac = new AbortController();
    const res = await fetch(`${base}/api/smc/stream?symbol=V10&tf=m5`, { signal: ac.signal });
    assert.equal(res.headers.get('content-type').startsWith('text/event-stream'), true);
    const reader = res.body.getReader(), dec = new TextDecoder(); let buf = '';
    (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
      let k; while ((k = buf.indexOf('\n\n')) >= 0) { const raw = buf.slice(0, k); buf = buf.slice(k + 2); const m = /event: (\w+)\ndata: (.*)/s.exec(raw); if (m) frames.push([m[1], JSON.parse(m[2])]); } } } catch { /* aborted */ } })();
    await sleep(100);
    assert.equal(frames[0][0], 'snapshot');
    d.tick(d.cur, 14, 16.5, 13.9, 16);
    d.tick(d.cur + TF, 16, 16.2, 15.8, 16.1);
    await sleep(150);
    const names = frames.map((f) => f[0]);
    assert.ok(names.includes('live')); assert.ok(names.includes('update'));
    assert.equal(frames.find((f) => f[0] === 'update')[1].changed.some((a) => a.type === 'bos'), true);
    ac.abort();
  } finally { await app.stop(); }
});
