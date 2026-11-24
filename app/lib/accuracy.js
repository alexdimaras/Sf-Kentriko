'use strict';
// SF Κέντρο — how right the program is, MEASURED from a person's checks (asked 24/11: «πόσο στα 100 δίνει έγκυρα
// αποτελέσματα» — and a place where the program learns from the owner):
//   • a random SAMPLE of the matches the program counts by itself («ίδιο προϊόν» in another shop, of the price research
//     or of the internet) is shown to a person: yes / no / not sure. Random = an honest estimate of the whole: of 100
//     matches the program makes, how many are right (with the margin of so few checks);
//   • every other answer of a person is kept too (the matches «θέλουν επιβεβαίωση», the proposals of Διορθώσεις with
//     the certainty they were given): «we said 98% — how often was it really approved?»;
//   • what it learns: a shop whose matches were found wrong again and again is no longer believed by itself (its
//     matches wait for a person's yes, like «similar» ones) — never a change on the sites, only less trust.
// Nothing here changes a price or a product: a «no» is the same as «Όχι ίδιο» in Τιμές (that page's price stops counting,
// and its code / EAN / photos are not taken), a «yes» the same as «Ίδιο».
const store = require('./store');
const U = require('./util');

const KEY = 'match-checks'; // { items: { 'site:id|url': { k, url, host, kind, prog: { match, how, why, score }, verdict, by, at, sample } } }
const MAX = 5000;
const DOUBT_MIN = 3;        // checks of a shop before its record counts
const DOUBT_SHARE = 0.34;   // a third of them wrong → its matches wait for a person

function data() { const d = store.read(KEY, null) || {}; d.items = d.items || {}; return d; }
let memo = null;
function changed() { memo = null; }

/** Keep a person's answer about one match. o: { k: 'site:id', url, kind: price|web, prog, verdict: yes|no|unsure, by, sample } */
function record(o) {
  if (!o || !/^(sf|st):\d+$/.test(String(o.k || '')) || !o.url || !['yes', 'no', 'unsure'].includes(o.verdict)) return null;
  const id = o.k + '|' + String(o.url).slice(0, 400);
  const prog = o.prog || {};
  const row = {
    k: o.k, url: String(o.url).slice(0, 400), host: U.hostOf(o.url), kind: o.kind === 'web' ? 'web' : 'price',
    prog: { match: prog.match || '', how: prog.how || '', why: String(prog.why || '').slice(0, 160), score: Number(prog.score) || 0 },
    verdict: o.verdict, by: o.by || '', at: U.nowIso(), sample: !!o.sample,
    // (why it is not the same: «variant» = the same model in another colour / size / edition — the commonest mistake)
    ...(o.verdict === 'no' && ['variant', 'other'].includes(o.reason) ? { reason: o.reason } : {}),
  };
  store.update(KEY, {}, (d) => {
    d.items = d.items || {};
    const prev = d.items[id];
    // a check from the sample stays a sample check (a later answer elsewhere does not make the estimate biased)
    if (prev && prev.sample) row.sample = true;
    d.items[id] = row;
    const keys = Object.keys(d.items);
    if (keys.length > MAX) for (const x of keys.sort((a, b) => String(d.items[a].at).localeCompare(String(d.items[b].at))).slice(0, keys.length - MAX)) delete d.items[x];
    return d;
  });
  changed();
  return row;
}

/** The matches the program counts BY ITSELF (exact, not yet judged by a person), every product of a site. */
function automatic(site) {
  const market = require('./market');
  const all = market.results();
  const out = [];
  for (const [k, e] of Object.entries(all)) {
    if (site && !k.startsWith(site + ':')) continue;
    for (const c of (e && e.competitors) || []) {
      if (!c || !c.url || c.match !== 'exact' || c.confirmed || c.ignored || c.manual) continue;
      out.push({ k, c });
    }
  }
  return out;
}

/**
 * A random sample to check: n matches the program made by itself and nobody judged yet. Random on purpose: the
 * share of right ones in it is an honest estimate for all of them.
 */
function sample(n, q) {
  const o = q || {};
  const catalog = require('./catalog');
  const done = data().items;
  const pool = automatic(o.site).filter(({ k, c }) => !done[k + '|' + c.url]);
  // (a fair shuffle: every match has the same chance)
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const rows = [];
  for (const { k, c } of pool) {
    if (rows.length >= Math.max(1, Math.min(30, Number(n) || 10))) break;
    const [site, id] = k.split(':');
    const p = catalog.byId(site).get(Number(id));
    if (!p) continue;
    rows.push(view(k, p, c));
  }
  return { rows, left: pool.length };
}
function view(k, p, c) {
  return {
    k, ours: { name: p.name, sku: p.sku || '', ean: p.ean || '', price: p.price || 0, img: p.thumb || (p.images || [])[0] || '', url: p.url || '' },
    theirs: { shop: c.shop || U.hostOf(c.url), url: c.url, name: c.name || '', sku: c.sku || '', ean: c.ean || c.gtin || '', price: c.price || 0, inStock: c.inStock, img: c.img || '', web: !!c.web, variant: c.vo || '' },
    prog: { match: c.match, how: c.how || '', why: c.why || '', ev: (c.ev || []).slice(0, 6), score: c.score || 0, confirmed: !!c.confirmed, ignored: !!c.ignored },
  };
}

/** Every match of one product (the price research and the internet), with what the program decided and why. */
function dossier(site, id) {
  const catalog = require('./catalog');
  const market = require('./market');
  const p = catalog.byId(site).get(Number(id));
  if (!p) throw new Error('Δεν βρέθηκε το προϊόν.');
  const k = site + ':' + p.id;
  const e = market.results()[k] || { competitors: [] };
  const checks = data().items;
  const rows = (e.competitors || []).map((c) => Object.assign(view(k, p, c), { flag: c.flag || '', note: c.note || '', check: checks[k + '|' + c.url] || null }));
  const order = { exact: 0, similar: 1, family: 2, none: 3 };
  rows.sort((a, b) => (order[a.prog.match] ?? 4) - (order[b.prog.match] ?? 4) || (b.prog.score || 0) - (a.prog.score || 0));
  const web = (store.read('web-codes', null) || {}).products || {};
  const w = web[k] || null;
  return {
    k, ours: rows.length ? rows[0].ours : view(k, p, {}).ours, at: e.at || null, rows,
    internet: w ? { at: w.at, status: w.status || '', hits: (w.hits || []).map((h) => ({ host: h.host, url: h.url, name: h.name, code: h.code || '', ean: h.ean || '', price: h.price || 0, how: h.how || '', match: h.match || '', check: checks[k + '|' + h.url] || null })), family: (w.family || []).slice(0, 10) } : null,
  };
}

/** A person's answer, applied as in Τιμές (yes = «Ίδιο», no = «Όχι ίδιο») and kept for the measuring. */
function check(input, by) {
  const k = String(input.k || '');
  const [site, id] = k.split(':');
  if (!['sf', 'st'].includes(site)) throw new Error('Λάθος προϊόν.');
  const url = String(input.url || '');
  const verdict = String(input.verdict || '');
  if (!['yes', 'no', 'unsure'].includes(verdict)) throw new Error('Λάθος απάντηση.');
  const market = require('./market');
  const e = market.results()[k];
  const c = e && (e.competitors || []).find((x) => x.url === url);
  const prog = c ? { match: c.match, how: c.how, why: c.why, score: c.score } : { match: input.match || '', how: input.how || '' };
  const row = record({ k, url, kind: c && c.web ? 'web' : input.kind || 'price', prog, verdict, by, sample: !!input.sample, reason: input.reason });
  // (the market's own memory: a yes / no there is the same answer; «not sure» changes nothing)
  if (verdict !== 'unsure' && c) market.decide(site, Number(id), url, verdict, { by, noRecord: true });
  if (verdict === 'no') try { require('./fixes').invalidate(); } catch (_) { /* fixes not loaded */ }
  return row;
}

// ---------- the numbers ----------
/** Wilson interval (95%): with few checks the margin is wide, and it is said. */
function wilson(yes, n) {
  if (!n) return { p: null, low: null, high: null };
  const z = 1.96, ph = yes / n, d = 1 + z * z / n;
  const c = (ph + z * z / (2 * n)) / d, m = (z * Math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n))) / d;
  return { p: Math.round(ph * 1000) / 10, low: Math.round(Math.max(0, c - m) * 1000) / 10, high: Math.round(Math.min(1, c + m) * 1000) / 10 };
}
function tally(rows) {
  const yes = rows.filter((r) => r.verdict === 'yes').length, no = rows.filter((r) => r.verdict === 'no').length;
  return Object.assign({ n: yes + no, yes, no, unsure: rows.filter((r) => r.verdict === 'unsure').length }, wilson(yes, yes + no));
}
/** Shops whose matches a person found wrong again and again → Map(host → why). */
function doubtShops() {
  if (memo && memo.doubt) return memo.doubt;
  const by = new Map();
  for (const r of Object.values(data().items)) {
    if (r.verdict === 'unsure' || r.prog.match !== 'exact') continue; // (only what the program said by itself)
    const t = by.get(r.host) || { n: 0, no: 0 };
    t.n++; if (r.verdict === 'no') t.no++;
    by.set(r.host, t);
  }
  // the AI's «no» counts too, once it has proven itself against the person's answers (and never twice for one match)
  if (aiAgreement().proven) {
    const d = data();
    for (const [id, a] of Object.entries(d.ai || {})) {
      if (d.items[id] || a.verdict === 'unsure' || (a.prog && a.prog.match !== 'exact')) continue;
      const t = by.get(a.host) || { n: 0, no: 0 };
      t.n++; if (a.verdict === 'no') t.no++;
      by.set(a.host, t);
    }
  }
  const doubt = new Map();
  for (const [host, t] of by) if (t.n >= DOUBT_MIN && t.no / t.n >= DOUBT_SHARE) doubt.set(host, `σε αυτό το κατάστημα βρήκες λάθος ${t.no} από ${t.n} αντιστοιχίες: θέλει το δικό σου «ναι»`);
  memo = Object.assign(memo || {}, { doubt });
  return doubt;
}

function scoreboard() {
  const rows = Object.values(data().items);
  const sampleRows = rows.filter((r) => r.sample);
  const auto = rows.filter((r) => r.prog.match === 'exact');
  const how = {};
  for (const r of auto) { const h = r.prog.how || (r.kind === 'web' ? 'internet' : 'άλλο'); (how[h] = how[h] || []).push(r); }
  const shops = {};
  for (const r of auto) (shops[r.host] = shops[r.host] || []).push(r);
  const doubt = doubtShops();
  // the proposals of Διορθώσεις: what certainty they were given, and what a person did with them
  const fx = Object.values(store.read('fixes', null) || {}).filter((d) => d && d.cf);
  const bucket = (cf) => (cf >= 90 ? 'high' : 'medium');
  const prop = { high: { approved: 0, edited: 0, rejected: 0 }, medium: { approved: 0, edited: 0, rejected: 0 } };
  const byOrigin = {};
  for (const d of fx) {
    const b = prop[bucket(d.cf)];
    const st = d.status === 'rejected' ? 'rejected' : d.edited !== undefined ? 'edited' : d.status === 'approved' || d.status === 'exported' ? 'approved' : '';
    if (!st) continue;
    b[st]++;
    const o = byOrigin[d.og || 'rules'] = byOrigin[d.og || 'rules'] || { approved: 0, edited: 0, rejected: 0 };
    o[st]++;
  }
  const rate = (b) => { const n = b.approved + b.edited + b.rejected; return Object.assign({ n }, wilson(b.approved + b.edited, n)); };
  const K = require('./knowledge').learned(1).counts;
  const aiRows = Object.values(data().ai || {});
  const cal = calibration();
  const FIELDS = ['name', 'sku', 'varsku', 'gtin', 'images', 'brand', 'cats', 'desc', 'short', 'price'];
  const wrong = rows.filter((r) => r.verdict === 'no' && r.prog.match === 'exact');
  return {
    wrongKinds: { all: wrong.length, variant: wrong.filter((r) => r.reason === 'variant').length },
    ai: Object.assign(tally(aiRows), { agreement: aiAgreement(), last: aiRows.map((a) => a.at).sort().pop() || null, doubts: aiRows.filter((a) => a.verdict === 'no' && !data().items[a.k + '|' + a.url]).length }),
    calibration: FIELDS.map((f) => ({ field: f, high: cal[f + '|high'] || null, medium: cal[f + '|medium'] || null })).filter((x) => x.high || x.medium),
    calMin: CAL_MIN,
    sample: tally(sampleRows),
    matches: tally(auto),
    confirmations: tally(rows.filter((r) => r.prog.match && r.prog.match !== 'exact')),
    byHow: Object.entries(how).map(([k, v]) => Object.assign({ how: k }, tally(v))).sort((a, b) => b.n - a.n),
    shops: Object.entries(shops).map(([host, v]) => Object.assign({ host, doubt: doubt.has(host) }, tally(v))).filter((x) => x.n).sort((a, b) => (a.p ?? 101) - (b.p ?? 101) || b.n - a.n).slice(0, 30),
    doubtShops: [...doubt.keys()],
    proposals: { high: Object.assign(prop.high, rate(prop.high)), medium: Object.assign(prop.medium, rate(prop.medium)), byOrigin: Object.entries(byOrigin).map(([k, v]) => Object.assign({ origin: k }, v, rate(v))) },
    naming: K,
    waiting: automatic().filter(({ k, c }) => !data().items[k + '|' + c.url]).length,
    // the measuring of the research in a world with a known answer (test/bench/research-bench.js, 24/11): not the
    // live internet, said apart from what a person checked
    bench: { precision: 99.1, recall: 60.9, lightRecall: 57.6, at: '2026-11-24' },
  };
}

// ---------- the AI's second opinion (the computer's local AI, free) ----------
// Silently, every few hours, the AI judges a random set of the matches the program counts by itself: a bigger sample
// than a person can check. Its answers are kept APART from the person's; how far they can be believed is measured by
// how often the AI agrees with the person on the same matches. Only an AI that has proven itself (≥ 20 common answers,
// ≥ 90% agreement) counts in what the program learns (the shops it no longer believes by itself).
const AI_SCHEMA = { type: 'object', properties: { same: { type: 'string', enum: ['yes', 'no', 'unsure'] }, why: { type: 'string' } }, required: ['same', 'why'] };
function aiPrompt(r) {
  const side = (x) => [x.name, x.sku ? 'κωδικός ' + x.sku : '', x.ean ? 'EAN ' + x.ean : '', x.variant ? 'παραλλαγή ' + x.variant : ''].filter(Boolean).join(' | ');
  return `Είναι το ΙΔΙΟ ακριβώς προϊόν; Ίδιο σημαίνει: ίδια μάρκα, ίδιο μοντέλο, ίδιο χρώμα, ίδιο μέγεθος / ποσότητα, ίδια έκδοση.
Άλλο χρώμα, άλλη έκδοση (PRO, MK2, V2), σετ ή συσκευασία άλλης ποσότητας, άλλο μέγεθος = ΟΧΙ.
Αν δεν φαίνεται χρώμα ή μέγεθος στο ένα από τα δύο, και τα υπόλοιπα συμφωνούν, απάντησε «yes» μόνο αν ο κωδικός ή το EAN είναι ίδιος· αλλιώς «unsure».
Α: ${side(r.ours)}
Β: ${side(r.theirs)}
Απάντησε JSON: {"same": "yes" | "no" | "unsure", "why": "σύντομα, στα ελληνικά"}`;
}
async function aiJudge(r) {
  const a = await require('./localai').askJson(aiPrompt(r), AI_SCHEMA, (o) => (o && ['yes', 'no', 'unsure'].includes(o.same) ? { same: o.same, why: String(o.why || '').slice(0, 200) } : null), { maxTokens: 200 });
  return { verdict: a.data.same, why: a.data.why, model: a.model || '' };
}
/** One silent round: n random matches nobody (person or AI) judged → the AI's answers. Stops at the first AI error. */
async function aiRound(n, opts) {
  const o = opts || {};
  const judge = o.judge || aiJudge;
  const catalog = require('./catalog');
  const d0 = data();
  const ai0 = d0.ai || {};
  const pool = automatic().filter(({ k, c }) => !ai0[k + '|' + c.url] && !d0.items[k + '|' + c.url]);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  let judged = 0, error = '';
  for (const { k, c } of pool.slice(0, Math.max(1, Math.min(50, Number(n) || 15)))) {
    const [site, id] = k.split(':');
    const p = catalog.byId(site).get(Number(id));
    if (!p) continue;
    let v;
    try { v = await judge(view(k, p, c)); } catch (e) { error = e.message || String(e); break; }
    const id2 = k + '|' + c.url;
    store.update(KEY, {}, (d) => { d.ai = d.ai || {}; d.ai[id2] = { k, url: c.url, host: U.hostOf(c.url), verdict: v.verdict, why: v.why, model: v.model, at: U.nowIso(), prog: { match: c.match, how: c.how || '' } }; const ks = Object.keys(d.ai); if (ks.length > MAX) for (const x of ks.slice(0, ks.length - MAX)) delete d.ai[x]; return d; });
    judged++;
  }
  changed();
  return { judged, error, left: Math.max(0, pool.length - judged) };
}
/** For the person's check (never part of the random sample): the matches the AI said are NOT the same. */
function aiDoubts(n) {
  const catalog = require('./catalog');
  const d = data();
  const market = require('./market');
  const res = market.results();
  const out = [];
  for (const a of Object.values(d.ai || {})) {
    if (a.verdict !== 'no' || d.items[a.k + '|' + a.url]) continue;
    const e = res[a.k]; const c = e && (e.competitors || []).find((x) => x.url === a.url);
    if (!c || c.confirmed || c.ignored) continue;
    const [site, id] = a.k.split(':');
    const p = catalog.byId(site).get(Number(id));
    if (p) out.push(Object.assign(view(a.k, p, c), { ai: { verdict: a.verdict, why: a.why, model: a.model, at: a.at } }));
    if (out.length >= (Number(n) || 10)) break;
  }
  return out;
}
/** How far the AI can be believed: its answers next to the person's on the same matches. */
function aiAgreement() {
  const d = data();
  let n = 0, same = 0;
  for (const [id, a] of Object.entries(d.ai || {})) {
    const r = d.items[id];
    if (!r || r.verdict === 'unsure' || a.verdict === 'unsure') continue;
    n++; if (r.verdict === a.verdict) same++;
  }
  return Object.assign({ n, same, proven: n >= 20 && same / n >= 0.9 }, wilson(same, n));
}

// ---------- the certainty of the proposals, corrected by what really happened ----------
// «We said 98%»: when the proposals of one kind (title, code, photos…) given as sure were approved less often than that
// (at least 20 answers), their certainty is the measured one, and under 90% they are no longer «sure» (not in «Έγκριση
// όλων των σίγουρων»). Measured by the certainty FIRST given (never by the corrected one): it recovers as approvals come.
const CAL_MIN = 20;
function calibration() {
  if (memo && memo.cal && Date.now() - memo.calAt < 5 * 60000) return memo.cal;
  const fx = Object.values(store.read('fixes', null) || {}).filter((x) => x && x.cf && x.fd);
  const groups = {};
  for (const x of fx) {
    const ok = x.status === 'approved' || x.status === 'exported';
    if (!ok && x.status !== 'rejected') continue;
    const b = x.cf >= 90 ? 'high' : 'medium';
    for (const key of [x.fd + '|' + b, '*|' + b]) { const g = groups[key] = groups[key] || { n: 0, ok: 0, claimed: 0 }; g.n++; if (ok) g.ok++; g.claimed += x.cf; }
  }
  const cal = {};
  for (const [key, g] of Object.entries(groups)) cal[key] = Object.assign({ n: g.n, ok: g.ok, claimed: Math.round(g.claimed / g.n) }, wilson(g.ok, g.n));
  memo = Object.assign(memo || {}, { cal, calAt: Date.now() });
  return cal;
}
/** The measured approval of proposals like this one (field + how sure it was said to be), or null (too few answers). */
function calibrationFor(field, claimed) {
  const cal = calibration();
  const b = claimed >= 90 ? 'high' : 'medium';
  const g = cal[field + '|' + b] && cal[field + '|' + b].n >= CAL_MIN ? cal[field + '|' + b] : null;
  return g;
}

/**
 * Take an answer back (asked 24/11: «αναίρεση / ιστορικό»): the check is forgotten (it no longer counts in the
 * numbers nor in what was learned) and the match is as the program had it — neither «Ίδιο» nor «Όχι ίδιο» in Τιμές.
 */
function undo(input, by) {
  const k = String((input && input.k) || ''), url = String((input && input.url) || '');
  const [site, id] = k.split(':');
  if (!['sf', 'st'].includes(site) || !url) throw new Error('Λάθος απάντηση για αναίρεση.');
  const key = k + '|' + url.slice(0, 400);
  let had = null;
  store.update(KEY, {}, (d) => { d.items = d.items || {}; had = d.items[key] || null; delete d.items[key]; d.undone = (d.undone || []).concat([{ k, url, verdict: had && had.verdict, by: by || '', at: U.nowIso() }]).slice(-200); return d; });
  changed();
  const market = require('./market');
  const e = market.results()[k];
  if (e && (e.competitors || []).some((c) => c.url === url)) market.decide(site, Number(id), url, '', { by, noRecord: true });
  try { require('./fixes').invalidate(); } catch (_) { /* fixes not loaded */ }
  return { ok: true, was: had ? had.verdict : null };
}

/** What was answered lately (newest first), with the product and the shop — each one can be taken back (undo). */
function recent(n) {
  const catalog = require('./catalog');
  return Object.values(data().items).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, Math.min(300, Number(n) || 100)).map((r) => {
    const [site, id] = r.k.split(':');
    const p = catalog.byId(site).get(Number(id));
    return Object.assign({}, r, { product: p ? p.name : '(δεν υπάρχει πια)', img: p ? p.thumb || (p.images || [])[0] || '' : '' });
  });
}

module.exports = { undo, aiRound, aiJudge, aiPrompt, aiDoubts, aiAgreement, calibration, calibrationFor, CAL_MIN, KEY, record, sample, dossier, check, scoreboard, doubtShops, recent, wilson, automatic, DOUBT_MIN, DOUBT_SHARE };
