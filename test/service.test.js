import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { evaluate, defaultParams as P } from '../server/engine.js';
import { Service, digitsFor, formatAlert } from '../server/service.js';
import { Store } from '../server/store.js';
import { SYMBOLS, slug } from '../server/symbols.js';
import { verifyInitData } from '../server/auth.js';
import { mk } from './engine.test.js';

const quiet = { info() {}, warn() {}, error() {} };

test('symbols list', () => {
  assert.equal(SYMBOLS.length, 23);
  const ids = SYMBOLS.map((s) => s.id);
  assert.equal(new Set(ids).size, 23);
  for (const id of ['V75', 'V75s', 'V5s', 'V300s', 'V250']) assert.ok(ids.includes(id), id);
  assert.equal(slug('Volatility 100 (1s) Index'), 'V100s');
});

function sign(token, fields) {
  const check = Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  return new URLSearchParams({ ...fields, hash: createHmac('sha256', secret).update(check).digest('hex') }).toString();
}

test('Telegram initData validation', () => {
  const token = '123456:TEST';
  const fields = { auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'q1', user: JSON.stringify({ id: 42, first_name: 'A' }) };
  const init = sign(token, fields);
  assert.equal(verifyInitData(init, token).id, 42);
  assert.equal(verifyInitData(init, 'other:token'), null);
  assert.equal(verifyInitData(init.replace('q1', 'q2'), token), null);
  assert.equal(verifyInitData(sign(token, { ...fields, auth_date: '1000' }), token), null);
});

test('store: alerts, users, recipients', () => {
  const st = new Store(':memory:');
  const a = { key: 'k1', ts: 1, symbol: 'V10', symbol_name: 'Volatility 10 Index', concept: 'K', kind: 'kl_valid', dir: 1, title: 't', body: 'b', payload: { x: 1 } };
  assert.ok(st.addAlert(a)); assert.equal(st.addAlert(a), null);                      // duplicates are ignored
  assert.deepEqual(st.recentAlerts({ symbol: 'V10' })[0].payload, { x: 1 });
  st.upsertUser(1, 'a'); st.upsertUser(2, 'b');
  st.updateSettings(2, { muted: ['V10'] });
  assert.deepEqual(st.recipients('V10', 'K'), [1]);
  st.updateSettings(1, { concepts: ['S'] });
  assert.deepEqual(st.recipients('V10', 'K'), []);
  st.updateSettings(1, { concepts: [], subscribed: false });
  assert.deepEqual(st.recipients('V25', 'K'), [2]);
  assert.equal(st.getUser(1).subscribed, false);
});

test('service: apply stores fresh alerts once', () => {
  const svc = new Service(new Store(':memory:'), P, quiet);
  const h4 = mk([[2, 6], [-1.5, 3], [2, 6], [-1.5, 3], [2.2, 8]], { start: 1000, step: 14400 });
  const h1 = mk([[0.5, 6], [-0.4, 3], [0.5, 6], [-0.4, 3], [0.5, 8]], { start: 1000 });
  const m5 = mk(Array.from({ length: 3 }, () => [[0.1, 6], [-0.08, 3], [0.1, 6], [-0.08, 3], [0.1, 8]]).flat(), { start: 1000, step: 300 });
  const sEv = evaluate(h4, h1, m5, P, 3).events.find((e) => e.concept === 'S');
  const now = sEv.t + 60;
  assert.ok(svc.apply('V10', h4, h1, m5, now).some((a) => a.concept === 'S'));
  assert.deepEqual(svc.apply('V10', h4, h1, m5, now), []);                             // same events are not sent twice
  assert.equal(svc.states.get('V10').s.trend, 1);
  assert.ok(svc.symbolView('V10').state.candles.h4.length);
  assert.equal(svc.symbolView('nope'), null);
  const ov = svc.overview();
  assert.equal(ov.length, 23); assert.equal(ov.find((o) => o.id === 'V10').trend, 1);
  assert.ok(formatAlert({ title: '<x>', symbol_name: 'n', body: 'b' }).includes('&lt;'));
  assert.ok(digitsFor(m5) >= 2);
});
