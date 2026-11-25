// The SMC order flow in the shape the SORK rules expect, so reclamation, key levels, M5 POI, 50% POI, bjeff zone, QML and the trade plan run on it unchanged.
//   IDM  (latest BOS zone in the trend direction)  -> role 'inducement'
//   DISR (the BOS zone before it)                  -> role 'disruption'
//   LIQ  (the one before that)                     -> role 'plq' (point of liquidity)
// The SMC engine decides the trend (it flips when the DISR zone is invalidated by a body close) and the pullback at the IDM; this file only translates.
// Pure: no network, no I/O. h1 = CLOSED H1 candles {t,o,h,l,c}, the same array evaluate() works on (the candle indexes in the flow point into it).
import { SmcEngine } from './smc.js';

const ROLE = { idm: 'inducement', disr: 'disruption', liq: 'plq' };

export function flowFromSnapshot(snap, h1) {
  const d = snap.trend || 0, at = new Map(h1.map((c, i) => [c.t, i]));
  const res = { dir: d, pois: [], pending: null, invalidated: null, remapped: false, recovered: null, pending_flip: null, official: null, pullback: null, source: 'smc' };
  if (d === 0) return res;
  const zones = snap.annotations.filter((a) => a.type === 'idm' && a.zone && a.role && a.status !== 'void' && a.dir === d);
  const poi = (a) => ({ role: ROLE[a.role], dir: a.dir, lo: a.lo, hi: a.hi, line: a.line, bos_t: a.bos_t, bos_idx: at.has(a.bos_t) ? at.get(a.bos_t) : -1,
    ob_t: a.t0, ob_b_t: null, bos_level: a.bos_level, broken_t: a.broken_t, swept: a.status === 'swept' });
  const by = (r) => zones.find((a) => a.role === r);
  const idm = by('idm'), disr = by('disr'), liq = by('liq');
  if (snap.flip) {
    res.invalidated = { dir: snap.flip.dir, t: snap.flip.t, idx: at.has(snap.flip.t) ? at.get(snap.flip.t) : -1, by: 'disruption' };
    res.official = { dir: -snap.flip.dir, invalidated_t: snap.flip.t, t: snap.flip.t, idx: res.invalidated.idx, by: 'disruption' };
    res.remapped = true;
  }
  if (idm && !disr) { res.pending = { dir: d, bos_t: idm.bos_t, bos_idx: at.has(idm.bos_t) ? at.get(idm.bos_t) : -1 }; return res; }   // one BOS only: nothing is marked yet
  if (!idm || !disr) return res;
  res.pois = [poi(idm), poi(disr), ...(liq ? [poi(liq)] : [])];
  if (snap.pullback && snap.pullback.dir === d) res.pullback = { ...snap.pullback };
  return res;
}

// Seed an SMC engine with the H1 history and translate its state. `params` = the SMC engine settings (swingLen, internalLen ...).
export function smcFlow(h1, params = {}) {
  const e = new SmcEngine(params);
  e.seed(h1);
  return flowFromSnapshot(e.snapshot({ limit: 1000 }), h1);
}
