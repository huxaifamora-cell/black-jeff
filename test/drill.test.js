import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { SmcEngine } from '../server/smc.js';
const src = fs.readFileSync(new URL('../web/rank.js', import.meta.url),'utf8');
const a = src.indexOf('const DRILL_COL'), b = src.indexOf('async function renderDrill');
const fn = new Function('lastDrill', src.slice(a, b) + '; return { drillQuestions, drillSpecials };');
const { drillQuestions, drillSpecials } = fn('');

test('smc drill: an H1 chart gives IDM, DISR, BOS, swing high / low and trend questions, and tapping the answer is a hit', () => {
  const T0 = 1_700_000_000, H = 3600;
  const up=(a,b)=>{const r=[];for(let v=a;v<=b;v++)r.push(v);return r;}, dn=(a,b)=>{const r=[];for(let v=a;v>=b;v--)r.push(v);return r;};
  const vals=[...up(10,15),...dn(14,12),...up(13,18),...dn(17,15),...up(16,22),...dn(21,14),...up(15,26),...dn(25,20)];
  let p=vals[0]; const cs=vals.map((v,i)=>{const c=[T0+i*H,p,Math.max(p,v)+.2,Math.min(p,v)-.2,v];p=v;return c;});
  const e=new SmcEngine({swingLen:2,internalLen:1,idmMinDepthAtr:.1});
  for(const c of cs) e.close({t:c[0],o:c[1],h:c[2],l:c[3],c:c[4]});
  const sm={...e.snapshot(),state:'live'};
  const W=400, step=(W-6)/cs.length, lo=8, hi=30, Hh=340, TOP=40;
  const cv={_geom:{cs:[...cs,[T0+cs.length*H,0,0,0,0]].slice(0,cs.length),plotW:W,step}};
  const map={lo,hi,toPrice:y=>lo+(Hh-14-y)/(Hh-14-TOP)*(hi-lo)};
  const qs=drillQuestions(cv,map,sm,null);
  
  assert.deepEqual(qs.map((q) => q.kind).sort(), ['bos', 'bosdir', 'disr', 'idm', 'swingh', 'swingl', 'trend']);
  for (const q of qs) {
    if (q.type === 'choice') { assert.ok(q.options[q.answer]); continue; }
    const r = q.reveal[0], x = r.k === 'box' ? cv._geom.cs.findIndex((c) => c[0] >= r.t0) * step + step * 3 : cv._geom.cs.findIndex((c) => c[0] >= (r.t0 ?? r.t)) * step + step * 1.5, py = r.k === 'box' ? (r.lo + r.hi) / 2 : r.y;
    assert.equal(q.hit(x, py), true, q.kind); assert.equal(q.hit(x, py + 9), false, q.kind);
  }
  assert.equal(qs.find((q) => q.kind === 'trend').answer, 0);   // bullish
});

// ---- entry candle names, QML and reclamation drills
const T0 = 1_700_000_000;
const mkCs = (t0, ivl, n, f) => Array.from({ length: n }, (_, i) => { const [o, c] = f(i); return [t0 + i * ivl, o, Math.max(o, c) + .1, Math.min(o, c) - .1, c]; });
const geom = (cs, lo, hi) => { const step = 394 / cs.length; return { cv: { _geom: { cs, plotW: 400, step } }, map: { lo, hi }, step }; };

test('smc drill: KLV entry candle names (engulfing, harami, star) are read from the key level signals', () => {
  const m5 = mkCs(T0, 300, 40, (i) => i % 2 ? [20, 19] : [19, 20]);
  const st = { candles: { m5, h1: [] } };
  for (const [type, ans] of [['bullish_engulf', 0], ['bearish_harami', 1], ['morning_star', 2], ['evening_star', 2]]) {
    const fl = { state: { k: { active: { lo: 18, hi: 21, t0: T0 } }, m5poi: { lo: 18, hi: 21, t: T0 }, signals: [{ t: m5[30][0], type }] } };
    const d = drillSpecials(st, null, fl).find((x) => x.kind === 'entry');
    assert.ok(d); assert.equal(d.tf, 'm5'); assert.equal(d.endT, m5[30][0] + 1500);
    const q = d.make(); assert.equal(q.answer, ans); assert.equal(q.type, 'choice'); assert.equal(q.options.length, 3);
    assert.equal(q.reveal[0].ts.length, /star/.test(type) ? 3 : 2); assert.equal(q.reveal[0].ts.at(-1), m5[30][0]);
  }
  assert.equal(drillSpecials(st, null, { state: { k: { active: { lo: 1, hi: 2, invalidated: { t: 1 } } }, signals: [{ t: m5[30][0], type: 'bullish_engulf' }] } }).length, 0);   // an invalidated key level gives no entry drill
});

test('smc drill: QML tap, direction and validity questions', () => {
  const h1 = mkCs(T0, 3600, 90, (i) => [20 + i * .1, 20 + i * .1 + .05]);
  const qml = { dir: -1, lo: 24, hi: 27, t: h1[60][0], extreme: 27, extreme_t: h1[55][0], at_liquidity: true };
  const ds = drillSpecials({ candles: { h1, m5: [] } }, null, { state: { qml } });
  assert.deepEqual(ds.map((d) => d.kind).sort(), ['qml', 'qmldir', 'qmlvalid']);
  const cs = h1.slice(0, 69), { cv, map, step } = geom(cs, 18, 30);
  const tap = ds.find((d) => d.kind === 'qml').make(cv, map);
  assert.equal(tap.hit(65 * step, 25.5), true); assert.equal(tap.hit(65 * step, 20), false); assert.equal(tap.hit(10 * step, 25.5), false);
  assert.equal(ds.find((d) => d.kind === 'qmldir').make(cv, map).answer, 1);      // an RBS was invalidated: the QML sells
  assert.equal(ds.find((d) => d.kind === 'qmlvalid').make(cv, map).answer, 0);    // at a point of liquidity: counts
  assert.equal(ds.find((d) => d.kind === 'qml').make({ _geom: { cs: h1.slice(58, 69), plotW: 400, step } }, map), null);   // the reversal is off screen: no question
});

test('smc drill: reclamation: tap the completing candle, and name the step reached', () => {
  const h1 = mkCs(T0, 3600, 90, (i) => [20, 20.4]);
  const f = { state: { r: [{ role: 'inducement', dir: 1, state: 0, last_complete: h1[70][0], lo: 19, hi: 20.5 }, { role: 'disruption', dir: -1, state: 3, last_complete: null, lo: 21, hi: 22 }] } };
  const ds = drillSpecials({ candles: { h1, m5: [] } }, null, f);
  assert.deepEqual(ds.map((d) => d.kind).sort(), ['reclaim', 'reclaimstep']);
  const rc = ds.find((d) => d.kind === 'reclaim'); assert.equal(rc.endT, h1[70][0] + 4 * 3600);
  const cs = h1.slice(0, 75), { cv, map, step } = geom(cs, 19, 22), q = rc.make(cv, map);
  assert.equal(q.hit(70 * step + step / 2, 20.2), true); assert.equal(q.hit(60 * step, 20.2), false); assert.equal(q.hit(70 * step, 21.9), false);
  const rs = ds.find((d) => d.kind === 'reclaimstep').make(cv, map);
  assert.equal(rs.answer, 2); assert.match(rs.options[1], /above the POI/);      // bearish: step 2 is a body above the POI
  assert.equal(rs.context[0].label, 'DISR POI');
});
