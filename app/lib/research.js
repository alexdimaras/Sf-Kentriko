'use strict';
// The price research split into work that can be done anywhere, for ONE competitor at a time:
//   1. matchPack()      — the cloud: what our products are (only what the matching needs), compressed, by version
//   2. compareShop()    — a shop's computer (or the cloud): its catalog against our products → the best offer per
//                         product (exactly the matching of lib/market.js: the same code runs everywhere)
//   3. mergeShop()      — the cloud: the offers of that competitor into the results (the only place that writes them)
//   4. finishDay()      — the cloud: when every competitor of the day is in, the day is marked done
// A merge is written at once with a note of progress, so a stop anywhere loses nothing (as lib/market.run).
const zlib = require('zlib');
const crypto = require('crypto');
const store = require('./store');
const U = require('./util');

function market() { return require('./market'); }
function catalog() { return require('./catalog'); }

// ---------- 1. our products, for the computers ----------
let packMemo = null;
/** What the version of the pack depends on: the catalogs, the user's yes/no answers, the EANs found at suppliers. */
function packVersion() {
  const ec = store.read('enrich-cache', null) || {};
  return crypto.createHash('sha1').update([catalog().bothVer(), store.ver('market-decisions'), ec.at || '', market().MATCH_VERSION].join('|')).digest('hex').slice(0, 16);
}
/** → { v, gz (Buffer) } — built once per version (17.000 products → ~1 MB compressed). */
async function matchPack() {
  const v = packVersion();
  if (packMemo && packMemo.v === v) return packMemo;
  const bg = require('./bg');
  const pace = bg.pacer();
  const byId = { sf: catalog().byId('sf'), st: catalog().byId('st') };
  const found = (store.read('enrich-cache', null) || {}).products || {};
  const items = [];
  for (const t of market().targetsAll()) {
    if (pace.due()) await pace.rest();
    const p = byId[t.site] && byId[t.site].get(Number(t.id));
    if (!p) continue;
    const k = t.site + ':' + p.id;
    const colour = (p.attrs || []).filter((a) => /χρωμ|χρώμ|colou?r/i.test(a.name || '') && !a.variation && (a.terms || []).length === 1);
    const e = found[k];
    items.push({ k, name: p.name, brand: p.brand || '', sku: p.sku || '', price: p.price || 0, attrs: colour, images: (p.images || []).slice(0, 1), thumb: p.thumb || '', ean: e && e.data && e.data.ean ? e.data.ean : '' });
  }
  const pack = { v, at: U.nowIso(), items, dec: store.read('market-decisions', {}) };
  const gz = await new Promise((ok, no) => zlib.gzip(Buffer.from(JSON.stringify(pack)), { level: 6 }, (e, r) => (e ? no(e) : ok(r))));
  packMemo = { v, gz, count: items.length };
  return packMemo;
}
function readPack(gz) { return JSON.parse(zlib.gunzipSync(gz).toString('utf8')); }

// ---------- 2. one competitor against our products ----------
/**
 * The best offer of competitor `comp` for each of our products. `pack` = readPack(...). The competitor's catalog
 * must be in this program's store already (compcat). → { offers: { 'site:id': offer }, catAt, count }
 */
async function compareShop(pack, comp, api) {
  const m = market();
  const bg = require('./bg');
  const pace = bg.pacer();
  const compcat = require('./compcat');
  const cat = compcat.load(comp.id);
  const ix = await bg.drain(m.indexGen(comp.id));
  const offers = {};
  let n = 0;
  for (const it of pack.items) {
    if (pace.due()) { await pace.rest(); if (api && api.cancelled && api.cancelled()) break; }
    n++;
    if (api && n % 500 === 0) api.progress(n, pack.items.length, `Σύγκριση με ${comp.name}…`);
    const f = m.features(it, { ean: it.ean });
    if (!(f.keys.length || f.sku || f.codes.length || f.gtin || f.code)) continue;
    const d = pack.dec[it.k] || {};
    const o = m.bestIn(f, ix, comp, new Set(d.yes || []), new Set(d.no || []));
    if (o) offers[it.k] = o;
  }
  m.clearIndexes();
  return { offers, catAt: cat.at || '', count: Object.keys(offers).length };
}

// ---------- 3. the offers of one competitor into the results ----------
/** The day's progress note (the same one lib/market.run keeps): which competitors are in, with which catalog. */
function progressNote(fresh) {
  const m = market();
  const cm = store.read('catalog-meta', null) || {};
  const sig = [m.localDay(new Date()), m.LOGIC_VERSION, m.MATCH_VERSION, (cm.sf || {}).syncedAt || '', (cm.st || {}).syncedAt || ''].join('|');
  let prog = store.read(m.PROGRESS, null);
  if (!prog || prog.sig !== sig || fresh) prog = { sig, startedAt: U.nowIso(), done: {}, changes: 0 };
  return prog;
}
/**
 * Take in the offers of competitor `compId` (catalog read at `catAt`): each product's offer from that competitor is
 * replaced (or removed when there is none any more), its decision computed again; price changes are noted.
 */
// Results of two shops that arrive together are taken in one after the other (they change the same results).
let mergeLine = Promise.resolve();
function mergeShop(compId, catAt, offers) {
  const run = mergeLine.catch(() => {}).then(() => mergeShopNow(compId, catAt, offers));
  mergeLine = run;
  return run;
}
async function mergeShopNow(compId, catAt, offers) {
  const m = market();
  const bg = require('./bg');
  const pace = bg.pacer();
  const prog = progressNote(false);
  const at = prog.startedAt; // one time for the whole day, as in one run
  const all = m.results();
  const dec = m.decisions();
  const readableIds = new Set(m.readable().map((c) => c.id));
  const byId = { sf: catalog().byId('sf'), st: catalog().byId('st') };
  const changes = [];
  const keys = new Set(Object.keys(offers));
  for (const [k, e] of Object.entries(all)) if (e.competitors.some((c) => c.competitorId === compId || (!c.manual && !c.web && !readableIds.has(c.competitorId)))) keys.add(k);
  let touched = 0;
  for (const key of keys) {
    if (pace.due()) await pace.rest();
    const [site, id] = key.split(':');
    const p = byId[site] && byId[site].get(Number(id));
    if (!p) continue;
    const prev = all[key] || null;
    const before = prev ? prev.competitors.find((c) => c.competitorId === compId && !c.manual) : null;
    const list = prev ? prev.competitors.filter((c) => c.manual || c.web || (c.competitorId !== compId && readableIds.has(c.competitorId))) : [];
    const o = offers[key] ? JSON.parse(JSON.stringify(offers[key])) : null;
    if (o) {
      if (before && before.url === o.url && before.price > 0 && Math.abs(before.price - o.price) >= 0.01 && o.match === 'exact' && o.inStock !== false) {
        o.prevPrice = before.price;
        changes.push({ at, site, id: p.id, name: p.name, shop: o.shop, url: o.url, from: before.price, to: o.price, ours: p.price });
      }
      list.push(o);
    }
    const d = dec[key] || {};
    const yes = new Set(d.yes || []), no = new Set(d.no || []);
    for (const x of list) { x.ignored = no.has(x.url); if (yes.has(x.url)) { x.match = 'exact'; x.confirmed = true; } }
    const entry = m.compute(site, p, { at, name: p.name, competitors: list, prevStats: prev && prev.stats && prev.stats.count && prev.at !== at ? { min: prev.stats.min, median: prev.stats.median, at: prev.at } : (prev && prev.prevStats) || null });
    if (!list.length && !prev && !entry.loss) continue;
    all[key] = entry;
    touched++;
  }
  await store.writeAsync('market', all, bg.breathe);
  prog.done[compId] = catAt || '';
  prog.at = U.nowIso();
  prog.changes += changes.length;
  store.write(m.PROGRESS, prog);
  if (changes.length) { const log = store.read('market-changes', []); store.write('market-changes', changes.concat(log).slice(0, 400)); }
  const meta = store.read('market-meta', {});
  const readable = m.readable();
  meta.progress = { at: U.nowIso(), done: readable.filter((c) => prog.done[c.id] != null).length, of: readable.length, complete: false, stopped: false };
  store.write('market-meta', meta);
  try { require('./fixes').invalidate(); } catch (_) { /* not loaded */ }
  return { touched, changes: changes.length };
}

// ---------- 4. the day is done ----------
/** Every competitor of the day is in: products with a cost but no result yet get one (a sale at a loss shows). */
async function finishDay() { await mergeLine.catch(() => {}); return finishDayNow(); }
async function finishDayNow() {
  const m = market();
  const bg = require('./bg');
  const pace = bg.pacer();
  const prog = progressNote(false);
  const readable = m.readable();
  if (!readable.every((c) => prog.done[c.id] != null)) return { complete: false, done: readable.filter((c) => prog.done[c.id] != null).length, of: readable.length };
  const all = m.results();
  const byId = { sf: catalog().byId('sf'), st: catalog().byId('st') };
  let withData = 0, similar = 0, n = 0;
  for (const t of m.targetsAll()) {
    if (pace.due()) await pace.rest();
    n++;
    const key = t.site + ':' + t.id;
    let e = all[key];
    if (!e) {
      const p = byId[t.site] && byId[t.site].get(Number(t.id));
      if (!p) continue;
      e = m.compute(t.site, p, { at: prog.startedAt, name: p.name, competitors: [], prevStats: null });
      if (!e.loss) continue;
      all[key] = e;
    }
    if (e.stats && e.stats.count) withData++;
    if (e.stats && e.stats.similar) similar++;
  }
  await store.writeAsync('market', all, bg.breathe);
  const meta = Object.assign(store.read('market-meta', {}), {
    lastRun: prog.startedAt, lastRunDay: m.localDay(new Date(prog.startedAt)), compared: n, withData, similar, competitors: readable.length, changes: prog.changes,
    progress: { at: U.nowIso(), done: readable.length, of: readable.length, complete: true, stopped: false }, pausedUntil: null, distributed: true,
  });
  store.write('market-meta', meta);
  return { complete: true, compared: n, withData, similar };
}

/** Which pages of a shop's site map look like our products (lib/market.wantedPages, from the pack instead of the catalogs). */
async function wantedFromPack(pack) {
  const m = market();
  const byId = { pk: new Map(pack.items.map((it, i) => [i, it])) };
  return m.wantedPages(pack.items.map((it, i) => ({ site: 'pk', id: i })), byId);
}

module.exports = { wantedFromPack, matchPack, readPack, packVersion, compareShop, mergeShop, finishDay, progressNote };
