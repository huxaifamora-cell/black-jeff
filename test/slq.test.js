import test from 'node:test';
import assert from 'node:assert/strict';
import { hasSlq } from '../server/engine.js';

const c = (o, cl, h, l) => ({ o, c: cl, h, l });
test('SLQ (downtrend): a green body between the point of liquidity and the BOS counts even if its wick dips below the broken level', () => {
  const cs = [c(110, 108, 110.5, 107.5), c(100, 102, 102.5, 99), c(101, 99.5, 101.5, 99.2), c(100.5, 98, 101, 97.5)];
  const b = { dir: -1, idx: 3, tip_idx: 0, level: 99.8 };
  assert.equal(hasSlq(cs, b), true);              // green body (100..102) is above the level, only its wick (99) is below
});
test('SLQ (downtrend): a green body that sits below the broken level does not count', () => {
  const cs = [c(110, 108, 110.5, 107.5), c(98, 99, 99.5, 97.5), c(100.5, 97, 101, 96.5)];
  assert.equal(hasSlq(cs, { dir: -1, idx: 2, tip_idx: 0, level: 99.8 }), false);
});
