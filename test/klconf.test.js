import test from 'node:test';
import assert from 'node:assert/strict';
import { klConfirmations } from '../server/engine.js';
import { formatAlert, alertLabel } from '../server/service.js';

const c = (t, o, cl, h, l) => ({ t, o, c: cl, h: h ?? Math.max(o, cl) + 0.2, l: l ?? Math.min(o, cl) - 0.2 });
const types = (cs, d, lo = 100, hi = 110) => klConfirmations(cs, lo, hi, d, 0).map((x) => x.type);

test('bullish harami / engulf inside the POI box', () => {
  assert.deepEqual(types([c(0, 108, 102), c(1, 103, 106)], 1), ['bullish_harami']);
  assert.deepEqual(types([c(0, 106, 103), c(1, 102, 108)], 1), ['bullish_engulf']);
});
test('bearish harami / engulf inside the POI box', () => {
  assert.deepEqual(types([c(0, 102, 108), c(1, 107, 104)], -1), ['bearish_harami']);
  assert.deepEqual(types([c(0, 103, 106), c(1, 108, 102)], -1), ['bearish_engulf']);
});
test('morning star (buys) and evening star (sells)', () => {
  assert.ok(types([c(0, 110, 102), c(1, 101.5, 101.8), c(2, 102, 107)], 1).includes('morning_star'));
  assert.ok(types([c(0, 102, 110), c(1, 110.5, 110.2), c(2, 110, 105)], -1, 100, 112).includes('evening_star'));
  assert.ok(!types([c(0, 110, 102), c(1, 101.5, 101.8), c(2, 102, 104)], 1).includes('morning_star'), 'the third candle must close beyond the middle of the first body');
  assert.ok(!types([c(0, 110, 102), c(1, 107, 104), c(2, 104, 109)], 1).includes('morning_star'), 'the middle candle must be small and at the far end');
});
test('a breakout out of the box is no longer a key level confirmation', () => {
  assert.deepEqual(types([c(0, 104, 105), c(1, 105, 112)], 1), []);
});
test('the Telegram alert and chart tag name the confirmation', () => {
  const a = { kind: 'kl_entry', concept: 'K', dir: 1, symbol_name: 'Volatility 25 Index', payload: { conf: 'bullish harami' } };
  assert.equal(formatAlert(a), '🟢 <b>KEY LEVEL · BULLISH HARAMI</b>\nVolatility 25 Index');
  assert.equal(alertLabel({ ...a, dir: -1, payload: { conf: 'evening star' } }), 'KEY LEVEL EVENING STAR');
  assert.equal(formatAlert({ ...a, kind: 'kl_valid' }), '🟢 <b>KEY LEVEL</b>\nVolatility 25 Index');
});
