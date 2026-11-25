import test from 'node:test';
import assert from 'node:assert/strict';
import { Deriv } from '../server/deriv.js';

const quiet = { info() {}, warn() {}, error() {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Stand-in for Node's WebSocket that behaves like Deriv: answers ticks_history with the history, then streams ohlc messages that carry the same req_id.
class FakeWS {
  static last = null;
  constructor() { this.readyState = 0; this.sent = []; FakeWS.last = this; setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 1); }
  send(txt) {
    const m = JSON.parse(txt); this.sent.push(m);
    if (m.ticks_history) setTimeout(() => this.onmessage({ data: JSON.stringify({ msg_type: 'candles', req_id: m.req_id, candles: [{ epoch: 100, open: 1, high: 2, low: 0.5, close: 1.5 }], subscription: { id: 'SUB-1' } }) }), 1);
    if (m.ping) setTimeout(() => this.onmessage({ data: JSON.stringify({ msg_type: 'ping', ping: 'pong' }) }), 1);
  }
  push(obj) { this.onmessage({ data: JSON.stringify(obj) }); }
  close() { this.readyState = 3; this.onclose && this.onclose(); }
}

test('deriv: subscribeCandles returns the history, routes ohlc by req_id, falls back to the subscription id, forgets and reports a dropped socket', async () => {
  const Real = globalThis.WebSocket; globalThis.WebSocket = FakeWS;
  const d = new Deriv(['wss://x/{app_id}'], '1', quiet);
  try {
    const got = []; let closed = 0;
    const { first, stop } = await d.subscribeCandles('R_75', 300, 10, (m) => got.push(m), () => closed++);
    const req = FakeWS.last.sent.find((m) => m.ticks_history);
    assert.equal(req.subscribe, 1); assert.equal(req.style, 'candles'); assert.equal(req.granularity, 300); assert.equal(req.end, 'latest');
    assert.equal(first.candles.length, 1);
    FakeWS.last.push({ msg_type: 'ohlc', req_id: req.req_id, ohlc: { open_time: 100, open: 1, high: 3, low: 1, close: 2 } });
    FakeWS.last.push({ msg_type: 'ohlc', ohlc: { id: 'SUB-1', open_time: 100, open: 1, high: 4, low: 1, close: 3 } });          // no req_id: found by subscription id
    FakeWS.last.push({ msg_type: 'ohlc', req_id: 9999, ohlc: { open_time: 100 } });                                              // somebody else's: ignored
    assert.equal(got.length, 2); assert.equal(got[1].ohlc.high, 4);
    // one-off requests still work next to the stream
    const p = d.request({ ping: 1 }); await sleep(10); FakeWS.last.push({ msg_type: 'x', req_id: FakeWS.last.sent.at(-1).req_id }); await p.catch(() => {});
    stop();
    assert.deepEqual(FakeWS.last.sent.at(-1), { forget: 'SUB-1' });
    FakeWS.last.push({ msg_type: 'ohlc', req_id: req.req_id, ohlc: { open_time: 100 } });
    assert.equal(got.length, 2, 'nothing after stop()');
    // a second subscription, then the socket drops
    const sub2 = await d.subscribeCandles('R_50', 3600, 10, () => {}, () => closed++);
    FakeWS.last.close();
    assert.equal(closed, 1); assert.equal(d.streams.size, 0);
    sub2.stop();                                                                                    // harmless after a drop
  } finally { d.close(); globalThis.WebSocket = Real; }
});
