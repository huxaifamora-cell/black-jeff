import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'vm';
import fs from 'fs';
import { BASE_TAGS, BRANCH_TAGS, rankTag } from '../server/ranks.js';
import { xpStatusText, ALERT_XP } from '../server/alertlink.js';

const src = fs.readFileSync(new URL('../web/rank.js', import.meta.url), 'utf8');
// web/rank.js run in a sandbox with a fake Telegram storage and a fake server, so the real rank rules are what is tested.
function boot({ store = {}, openOk = true } = {}) {
  let n = 0;
  const sb = { console, window: { addEventListener() {} }, document: { getElementById: () => null, createElement: () => ({}), body: { appendChild() {} } },
    esc: (x) => String(x), api: async (path) => (path === '/api/alert-open' ? (openOk ? sb._open : { ok: false }) : {}), ico: () => '', rkName: () => 'x',
    setTimeout: () => 0, clearTimeout() {}, tgs: null, localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } }, view: { innerHTML: '' }, _open: { ok: true, id: `${Math.floor(Date.now() / 1000).toString(36)}_00000001`, symbol: 'V75', ts: 1 } };
  vm.createContext(sb);
  vm.runInContext(src + '\n;globalThis.T = { rk, rankOf, ladder, GATES, BRANCHES, RANK_XP, award, rkAlertOpen, CHAPTERS, ANALYSES_REQ, DRILLS_REQ, EXAM_PASS, RKS: () => RKS, kvStore: () => 0 };', sb);
  return { T: sb.T, store, sb, nextAlert: (id) => { sb._open = { ok: true, id, symbol: 'V75', ts: 1 }; n++; } };
}
const names = (T, b) => [...T.BRANCHES[b].ranks.map((r) => r[0])];

test('rank ladders: 19 ranks after Recruit per service, same XP at each position, ending at 10,000 XP', () => {
  const { T } = boot();
  for (const b of ['army', 'navy', 'air']) {
    const r = T.BRANCHES[b].ranks; assert.equal(r.length, 19);
    assert.deepEqual([...r.map((x) => x[1])], [40, 120, 250, 450, 550, 680, 840, 1050, 1250, 1550, 1900, 2350, 2900, 3550, 4350, 5400, 6600, 8100, 10000]);
    assert.equal(new Set(r.map((x) => x[0])).size, 19, b + ' has no duplicate rank names');
  }
  assert.deepEqual(names(T, 'army').slice(0, 8), ['Private', 'Lance Corporal', 'Corporal', 'Sergeant', 'Staff Sergeant', 'Warrant Officer', 'Master Warrant Officer', 'Army Warrant Officer']);
  assert.equal(names(T, 'army').at(-1), 'Field Marshal'); assert.equal(names(T, 'navy').at(-1), 'Fleet Admiral'); assert.equal(names(T, 'air').at(-1), 'Marshal of the Air Force');
  assert.equal(names(T, 'air')[0], 'Airman'); assert.equal(names(T, 'navy')[0], 'Seaman');
  assert.equal(T.ladder({ branch: 'navy' })[0][0], 'Recruit'); assert.equal(T.ladder({ branch: 'navy' }).length, 20);
});

test('Telegram rank tags follow the same ladders and fit a tag (16 characters)', () => {
  const { T } = boot();
  assert.deepEqual(BASE_TAGS, ['Recruit']);
  for (const b of ['army', 'navy', 'air']) {
    assert.equal(BRANCH_TAGS[b].length, 19);
    for (const t of BRANCH_TAGS[b]) assert.ok(t.length <= 16, t);
    assert.equal(rankTag(b, 0), 'Recruit'); assert.equal(rankTag(b, 19), BRANCH_TAGS[b][18]); assert.equal(rankTag(b, 20), null);
  }
  assert.equal(T.ladder({ branch: 'air' }).length, 1 + BRANCH_TAGS.air.length);
});

test('everybody starts from Recruit with 0 XP: a rank saved by the old system is dropped', async () => {
  const old = JSON.stringify({ v: 1, xp: 5000, branch: 'navy', ch: [0, 1, 2, 3, 4, 5, 6, 7], drillOk: 40, anTotal: 99, medals: ['first'], owner: 1 });
  const { T, store } = boot({ store: { 'sork_rank@anon': old, 'sork_alert_log@anon': 'x:1' } });
  const s = await T.rk();
  assert.equal(s.xp, 0); assert.equal(s.branch, null); assert.equal(s.ch.length, 0); assert.equal(s.anTotal, 0); assert.deepEqual([...s.medals], []);
  assert.equal(T.rankOf(s), 0);
  assert.equal(store['sork_rank@anon'], undefined);                // the old record is gone from storage too
  assert.equal(store['sork_alert_log@anon'], undefined); assert.equal(store['sork_rank_reset_v2@anon'], '1');
});

test('XP stops counting at the promotion line until the mission is done, then the person is promoted at once', async () => {
  const { T } = boot();
  const s = await T.rk();
  await T.award(30, 'test'); assert.equal(s.xp, 30);
  await T.award(500, 'test');                                  // Recruit needs the Field guide + a service: XP stops at the XP of rank 2 (40)
  assert.equal(s.xp, 40); assert.equal(T.rankOf(s), 0);
  s.ch = T.CHAPTERS.map((_, i) => i); await T.award(15, 'guide');                    // guide done but no service yet: still held
  assert.equal(s.xp, 40); assert.equal(T.rankOf(s), 0);
  s.branch = 'army'; assert.equal(T.rankOf(s), 1);                                    // service chosen: promoted
  await T.award(10, 'test'); assert.equal(s.xp, 50);
  await T.award(1000, 'test'); assert.equal(s.xp, 120);                                // rank 2 needs 33 chart reading drills
  assert.equal(T.rankOf(s), 1);
  s.drillOk = 33; await T.award(1000, 'test'); assert.equal(T.rankOf(s), 2); assert.equal(s.xp, 250);   // held at the next line (exam)
  T.CHAPTERS.forEach((_, i) => { s.qz[i] = T.EXAM_PASS; }); await T.award(1000, 'test'); assert.equal(T.rankOf(s), 3); assert.equal(s.xp, 450);   // held (intercepts)
  s.anTotal = 33; await T.award(10, 'test'); assert.equal(T.rankOf(s), 4); assert.equal(s.xp, 460);
  await T.award(100000, 'test'); assert.equal(s.xp, 10000); assert.equal(T.rankOf(s), 19);                // the ladder ends at 10,000 XP
});

test('Intercept Analysis: the first open of an active Telegram alert counts once and pays 3 XP', async () => {
  const { T, nextAlert } = boot();
  const s = await T.rk();
  await T.rkAlertOpen('p1'); assert.equal(s.anTotal, 1); assert.equal(s.xp, ALERT_XP); assert.equal(ALERT_XP, 3);
  await T.rkAlertOpen('p1'); assert.equal(s.anTotal, 1); assert.equal(s.xp, 3);        // the same alert again: nothing
  nextAlert(`${Math.floor(Date.now() / 1000).toString(36)}_00000002`); await T.rkAlertOpen('p2'); assert.equal(s.anTotal, 2); assert.equal(s.xp, 6);
  const off = boot({ openOk: false }); const s2 = await off.T.rk(); await off.T.rkAlertOpen('p3'); assert.equal(s2.anTotal, 0); assert.equal(s2.xp, 0);   // not active / not a real alert
  assert.equal(T.ANALYSES_REQ, 33);
});

test('Telegram XP status pop-up matches the new rule', () => {
  const id = `${Math.floor(Date.now() / 1000).toString(36)}_0123abcd`;
  assert.match(xpStatusText(1, id), /\+3 XP earned/); assert.match(xpStatusText(0, id), /\+3 XP to claim/);
  assert.match(xpStatusText(0, '1_0123abcd'), /older than 24 hours/);
});
