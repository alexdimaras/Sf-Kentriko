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

function matchVersion() { try { return require('./market').MATCH_VERSION || 0; } catch (_) { return 0; } }
function catOf(k) {
  try { const [site, id] = String(k).split(':'); const p = require('./catalog').byId(site).get(Number(id)); return p ? String((p.catNames || [])[0] || '').slice(0, 60) : ''; } catch (_) { return ''; }
}
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
    prog: { match: prog.match || '', how: prog.how || '', why: String(prog.why || '').slice(0, 160), score: Number(prog.score) || 0, used: !!prog.used, ver: prog.ver || matchVersion() },
    // (the product's category: where the mistakes are — asked 25/11 «ποιες κατηγορίες έχουν περισσότερα λάθη»)
    cat: o.cat || catOf(o.k),
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
  const prog = c ? { match: c.match, how: c.how, why: c.why, score: c.score, used: !!c.used } : { match: input.match || '', how: input.how || '' };
  const row = record({ k, url, kind: c && c.web ? 'web' : input.kind || 'price', prog, verdict, by, sample: !!input.sample, reason: input.reason });
  // (the market's own memory: a yes / no there is the same answer; «not sure» changes nothing)
  // («another colour / size»: not «the same», not thrown away — its price is evaluated as a sign; lib/market.js variantEval)
  if (verdict !== 'unsure' && c) market.decide(site, Number(id), url, verdict === 'no' && input.reason === 'variant' ? 'variant' : verdict, { by, noRecord: true });
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
  const doms = domains();
  return {
    domains: doms, actions: actions(doms), enough: ENOUGH,
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

/**
 * Answers «Άλλο χρώμα / μέγεθος» given before 24/11 (evening) were kept by Τιμές as «Όχι ίδιο» (thrown away): they
 * become «another colour of the same model» (its price evaluated). Idempotent; run at every start.
 */
function migrateVariants() {
  const market = require('./market');
  const rows = Object.values(data().items).filter((r) => r.verdict === 'no' && r.reason === 'variant');
  if (!rows.length) return 0;
  const dec = market.decisions();
  const res = market.results();
  let n = 0;
  for (const r of rows) {
    const d = dec[r.k] || {};
    if ((d.variant || []).includes(r.url)) continue;
    const [site, id] = r.k.split(':');
    const e = res[r.k];
    if (!e || !(e.competitors || []).some((c) => c.url === r.url)) continue;
    try { market.decide(site, Number(id), r.url, 'variant', { by: r.by, noRecord: true }); n++; } catch (_) { /* product gone */ }
  }
  return n;
}

// ---------- accuracy by DOMAIN (asked 25/11 §2): never one number for everything ----------
// Every domain has its own number, from its own evidence, said apart: a random sample a person checked (the honest
// estimate) · a person's decisions on proposals · the AI · a synthetic benchmark · the automatic tests · what the
// program produces now (volume, not accuracy). One domain never proves another. 100% is shown only for what was
// checked, always with its margin; «enough» only from 30 checks on.
const ENOUGH = 30;
const HIST = 'accuracy-history'; // { days: { 'YYYY-MM-DD': { domain: { n, p } } } }
const DOMAINS = [
  ['match', 'Αντιστοίχιση προϊόντων'], ['photos', 'Φωτογραφίες'], ['colour', 'Χρώμα και παραλλαγές'], ['sku', 'SKU και κωδικοί κατασκευαστή'],
  ['ean', 'EAN'], ['brand', 'Μάρκα'], ['specs', 'Χαρακτηριστικά και προδιαγραφές'], ['aidesc', 'Περιγραφές AI'], ['price', 'Εντοπισμός τιμών'], ['sources', 'Αξιοπιστία πηγών και καταστημάτων'],
];
// what the automatic tests cover in each domain (checked at every publication: `npm test` green before a push)
const TESTS = { match: 'research (91), variants (73), rules', photos: 'rules: φωτογραφίες άλλου χρώματος / έκδοσης / διπλές', colour: 'rules, knowledge, units: άλλο χρώμα', sku: 'rules: κωδικοί μόνο από απόδειξη', ean: 'rules, research: EAN με ψηφίο ελέγχου', brand: 'rules: μάρκα (Brands)', specs: '', aidesc: 'ai: περιγραφή μόνο από στοιχεία', price: 'rules, units: τιμή άλλου χρώματος, ύποπτες τιμές', sources: 'units: κατάστημα με λάθη' };
const BENCH = { match: { p: 99.1, recall: 60.9, at: '2026-11-24', what: 'συνθετικός κόσμος 60 προϊόντων / 14 καταστημάτων (test/bench/research-bench.js)' } };
const FIELD_OF = { sku: ['sku', 'varsku'], ean: ['gtin'], brand: ['brand'], specs: ['specs', 'attrs'], photos: ['images'] };

function tallyDec(rows) {
  const ok = rows.filter((d) => (d.status === 'approved' || d.status === 'exported') && d.edited === undefined).length;
  const part = rows.filter((d) => (d.status === 'approved' || d.status === 'exported') && d.edited !== undefined).length;
  const no = rows.filter((d) => d.status === 'rejected').length;
  const n = ok + part + no;
  return Object.assign({ n, yes: ok, partial: part, no, unsure: 0 }, wilson(ok, n));
}
const lastAt = (rows) => rows.map((r) => r.at || '').sort().pop() || null;
function byVersion(rows, isOk, verOf) {
  const g = {};
  for (const r of rows) { const v = verOf(r); if (v == null || v === '') continue; (g[v] = g[v] || []).push(r); }
  return Object.entries(g).map(([ver, list]) => { const yes = list.filter(isOk).length; return Object.assign({ ver, n: list.length, yes }, wilson(yes, list.length)); }).sort((a, b) => String(a.ver).localeCompare(String(b.ver), undefined, { numeric: true }));
}
const top = (rows, key, n) => { const m = new Map(); for (const r of rows) { const k = key(r); if (k) m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n || 5).map(([k, c]) => ({ k, n: c })); };

/** Every domain → { id, label, main, basis, enough, evidence: [...], versions, delta, last, problems, next, auto, human } */
function domains() {
  const items = Object.values(data().items);
  const human = items.filter((r) => r.verdict === 'yes' || r.verdict === 'no' || r.verdict === 'unsure');
  const exactRows = human.filter((r) => r.prog.match === 'exact');
  const ai = Object.values(data().ai || {});
  const fx = Object.values(store.read('fixes', null) || {}).filter((d) => d && d.fd);
  const photoChecks = Object.values((store.read('photo-checks', null) || {}).items || {});
  const isYes = (r) => r.verdict === 'yes';
  const tallyChecks = (rows) => tally(rows);
  const prod = productionCounts();
  const out = [];
  for (const [id, label] of DOMAINS) {
    const ev = [];
    let sampleRows = [], humanRows = [], decRows = [], aiRows = [], problems = [], auto = [], versions = [];
    if (id === 'match' || id === 'sources') {
      sampleRows = exactRows.filter((r) => r.sample); humanRows = exactRows.filter((r) => !r.sample); aiRows = ai.filter((a) => !a.prog || a.prog.match === 'exact');
      versions = byVersion(exactRows.filter((r) => r.verdict !== 'unsure'), isYes, (r) => r.prog.ver ? 'αντιστοίχιση v' + r.prog.ver : '');
      const wrong = exactRows.filter((r) => r.verdict === 'no');
      if (id === 'match') problems = [
        ...top(wrong, (r) => (r.reason === 'variant' ? 'το ίδιο μοντέλο σε άλλο χρώμα / μέγεθος' : r.reason === 'other' ? 'άλλο προϊόν' : 'όχι ίδιο')).map((x) => ({ what: x.k, n: x.n, kind: 'λάθος' })),
        ...top(wrong, (r) => r.prog.how && 'απόδειξη: ' + ({ ean: 'EAN', sku: 'κωδικός', code: 'κωδικός μοντέλου', words: 'μόνο λέξεις' }[r.prog.how] || r.prog.how)).map((x) => ({ what: x.k, n: x.n, kind: 'απόδειξη' })),
        ...top(wrong, (r) => r.cat).map((x) => ({ what: x.k, n: x.n, kind: 'κατηγορία' })),
      ];
      else problems = top(wrong, (r) => r.host).map((x) => ({ what: x.k, n: x.n, kind: 'κατάστημα' }));
      const ds = doubtShops();
      if (ds.size) auto.push(`${ds.size} ${ds.size === 1 ? 'κατάστημα' : 'καταστήματα'} με συχνά λάθη δεν μετράνε πια μόνα τους: ${[...ds.keys()].slice(0, 5).join(', ')}`);
    } else if (id === 'colour') {
      const rel = human.filter((r) => r.verdict === 'yes' || (r.verdict === 'no' && r.reason === 'variant'));
      sampleRows = rel.filter((r) => r.sample && r.prog.match === 'exact'); humanRows = rel.filter((r) => !(r.sample && r.prog.match === 'exact'));
      const pc = photoChecks.filter((x) => x.verdict && x.category);
      if (pc.length) ev.push({ type: 'human', label: 'Φωτογραφίες που έλεγξες (σωστό χρώμα ή όχι)', t: tally(pc.map((x) => ({ verdict: x.category === 'other_colour' ? 'no' : x.verdict }))), at: lastAt(pc) });
      problems = top(rel.filter((r) => r.verdict === 'no'), (r) => r.cat).map((x) => ({ what: x.k, n: x.n, kind: 'κατηγορία' }));
      auto.push('Κωδικός, EAN και φωτογραφίες ποτέ από άλλο χρώμα· η ΤΙΜΗ άλλου χρώματος μετράει μόνο ως ένδειξη με αξιολόγηση (★★ / ★)');
    } else if (id === 'price') {
      const rel = exactRows.filter((r) => r.prog.used);
      sampleRows = rel.filter((r) => r.sample); humanRows = rel.filter((r) => !r.sample);
      problems = top(rel.filter((r) => r.verdict === 'no'), (r) => r.host).map((x) => ({ what: x.k, n: x.n, kind: 'κατάστημα' }));
      auto.push('Μετράνε μόνο: ίδιο προϊόν, διαθέσιμο, ελληνικό, πρόσφατο, όχι ύποπτο· αλλαγή τιμής μόνο με ≥2 καταστήματα');
    } else if (id === 'aidesc') {
      decRows = fx.filter((d) => d.fd === 'desc' && d.sk === 'ai');
    } else if (id === 'photos') {
      decRows = fx.filter((d) => d.fd === 'images');
      const pc = photoChecks.filter((x) => x.verdict);
      if (pc.length) { sampleRows = pc.filter((x) => x.sample); humanRows = pc.filter((x) => !x.sample); }
      problems = top(photoChecks.filter((x) => x.verdict === 'no'), (x) => PHOTO_WHY[x.category] || x.category).map((x) => ({ what: x.k, n: x.n, kind: 'λάθος' }))
        .concat(top(decRows.filter((d) => d.status === 'rejected'), (d) => d.src).map((x) => ({ what: x.k, n: x.n, kind: 'πηγή' })));
      auto.push('Ποτέ φωτογραφία από καταχώριση πολλών χρωμάτων, από αρχείο που λέει άλλο χρώμα, από είδος αντιπροσώπου σε άλλο χρώμα· ποτέ «σίγουρη» από ομοιότητα εικόνας μόνο');
    } else {
      decRows = fx.filter((d) => (FIELD_OF[id] || []).includes(d.fd));
    }
    if (decRows.length || FIELD_OF[id] || id === 'aidesc') {
      if (!problems.length) problems = top(decRows.filter((d) => d.status === 'rejected'), (d) => d.src || ({ rules: 'κανόνες', site: 'δεδομένα του site', sources: 'αντιπρόσωποι & sites', infer: 'συμπέρασμα', mine: 'δικές σου' }[d.og] || d.og)).map((x) => ({ what: x.k, n: x.n, kind: 'πηγή' }))
        .concat(top(decRows.filter((d) => d.status === 'rejected'), (d) => d.cat).map((x) => ({ what: x.k, n: x.n, kind: 'κατηγορία' })));
      if (decRows.length) versions = versions.concat(byVersion(decRows.filter((d) => ['approved', 'exported', 'rejected'].includes(d.status)), (d) => d.status !== 'rejected' && d.edited === undefined, (d) => (d.ver ? 'κανόνες v' + d.ver : 'πριν τις 25/11')));
      for (const f of FIELD_OF[id] || []) { const g = calibrationFor(f, 95); if (g && g.p < 90) auto.push(`Οι «σίγουρες» προτάσεις εδώ εγκρίνονταν ${g.p}% (${g.ok}/${g.n}): έγιναν «μέτριες», όχι στο «Έγκριση όλων των σίγουρων»`); }
    }
    if (sampleRows.length) ev.unshift({ type: 'sample', label: 'Τυχαίο δείγμα που έλεγξες (η αντικειμενική εκτίμηση)', t: tallyChecks(sampleRows), at: lastAt(sampleRows) });
    if (humanRows.length) ev.push({ type: 'human', label: 'Άλλοι δικοί σου έλεγχοι (όχι τυχαίοι)', t: tallyChecks(humanRows), at: lastAt(humanRows) });
    if (decRows.length) ev.push({ type: 'decisions', label: 'Οι αποφάσεις σου στις προτάσεις (εγκρίθηκε χωρίς αλλαγή / με αλλαγή / όχι)', t: tallyDec(decRows), at: lastAt(decRows) });
    if (aiRows.length) ev.push({ type: 'ai', label: 'Δεύτερη γνώμη AI (μετράει όσο συμφωνεί μαζί σου)', t: tally(aiRows), at: lastAt(aiRows), agreement: aiAgreement() });
    if (BENCH[id]) ev.push({ type: 'bench', label: 'Συνθετικό benchmark: ' + BENCH[id].what, t: { p: BENCH[id].p, n: null }, at: BENCH[id].at, note: `βρίσκει ~${Math.round(BENCH[id].recall / 10)} στα 10 καταστήματα που το έχουν` });
    if (TESTS[id]) ev.push({ type: 'tests', label: 'Αυτοματοποιημένα tests (πράσινα σε κάθε δημοσίευση)', text: TESTS[id] });
    if (prod[id] != null) ev.push({ type: 'production', label: 'Παραγωγή τώρα (πλήθος, όχι ακρίβεια)', text: prod[id] });
    // the main number: the random sample when there is one, else the person's decisions / checks — said which
    const mainEv = ev.find((e) => e.type === 'sample' && e.t.n) || ev.find((e) => (e.type === 'decisions' || e.type === 'human') && e.t.n) || null;
    const main = mainEv ? Object.assign({ basis: mainEv.type, basisLabel: mainEv.label }, mainEv.t) : null;
    const enough = !!(main && main.n >= ENOUGH);
    out.push({ id, label, main, enough, need: main ? Math.max(0, ENOUGH - main.n) : ENOUGH, evidence: ev, versions, last: mainEv ? mainEv.at : null, problems: problems.slice(0, 8), auto });
  }
  // the change since the last day measured before today (history kept once a day)
  const h = store.read(HIST, null) || { days: {} };
  const today = new Date().toISOString().slice(0, 10);
  const prevDay = Object.keys(h.days || {}).filter((d) => d < today).sort().pop();
  for (const d of out) {
    const pr = prevDay && h.days[prevDay][d.id];
    d.delta = pr && pr.p != null && d.main && d.main.p != null && d.main.n > pr.n ? Math.round((d.main.p - pr.p) * 10) / 10 : null;
    d.prev = pr ? Object.assign({ day: prevDay }, pr) : null;
    d.next = nextStep(d);
  }
  store.update(HIST, { days: {} }, (x) => { x.days = x.days || {}; x.days[today] = Object.fromEntries(out.filter((d) => d.main).map((d) => [d.id, { n: d.main.n, p: d.main.p, basis: d.main.basis }])); const ks = Object.keys(x.days).sort(); for (const k of ks.slice(0, Math.max(0, ks.length - 120))) delete x.days[k]; return x; });
  return out;
}
const PHOTO_WHY = { other_colour: 'άλλο χρώμα', other_version: 'άλλη έκδοση', wrong_product: 'λάθος προϊόν', accessory: 'αξεσουάρ / εξάρτημα', packaging: 'συσκευασία', generic: 'γενική διαφημιστική', duplicate: 'διπλή', poor: 'κακή ποιότητα', watermark: 'υδατογράφημα', maybe: 'αβέβαιη' };
/** How much the program produces now in each domain (volume — never shown as accuracy). */
function productionCounts() {
  const out = {};
  try { out.match = `${automatic().length} αντιστοιχίσεις «ίδιο» μετράνε χωρίς να τις έχεις δει`; } catch (_) { /* market not loaded */ }
  try {
    const items = require('./fixes').compute().items.filter((c) => c.status === 'pending');
    const c = (fs) => items.filter((x) => fs.includes(x.field)).length;
    out.sku = `${c(['sku', 'varsku'])} προτάσεις κωδικών περιμένουν`; out.ean = `${c(['gtin'])} προτάσεις EAN περιμένουν`; out.brand = `${c(['brand'])} προτάσεις μάρκας περιμένουν`;
    out.photos = `${c(['images'])} προτάσεις φωτογραφιών περιμένουν`; out.aidesc = `${items.filter((x) => x.field === 'desc' && x.source && x.source.kind === 'ai').length} περιγραφές AI περιμένουν`;
  } catch (_) { /* fixes not loaded */ }
  return out;
}
/** The next best step of a domain, in words — and whether a person is needed. */
function nextStep(d) {
  if (d.id === 'specs') return { who: 'none', text: 'Δεν μετριέται: το πρόγραμμα δεν προτείνει ακόμα χαρακτηριστικά (μόνο τα παίρνει από τον αντιπρόσωπο για τις περιγραφές).' };
  if (!d.main) return { who: 'human', text: d.id === 'match' || d.id === 'price' || d.id === 'colour' || d.id === 'sources' ? 'Δεν έχει μετρηθεί: κάνε 10 ελέγχους στον «Έλεγχο δείγματος».' : d.id === 'photos' ? 'Δεν έχει μετρηθεί: έλεγξε 10 φωτογραφίες στον «Έλεγχο φωτογραφιών».' : 'Δεν έχει μετρηθεί: οι εγκρίσεις / απορρίψεις σου στις Διορθώσεις μετράνε μόνες τους.' };
  if (!d.enough) return { who: 'human', text: `Χρειάζονται ${d.need} ακόμη ${d.main.basis === 'decisions' ? 'αποφάσεις στις Διορθώσεις' : 'έλεγχοι'} για επαρκές δείγμα (έχεις ${d.main.n}).` };
  if (d.main.low < 90 && d.problems.length) return { who: 'system', text: `Κύρια αιτία λάθους: ${d.problems[0].what} (${d.problems[0].n}). Το σύστημα γίνεται αυστηρότερο εκεί μόνο του όπου μπορεί με ασφάλεια· μετά νέος έλεγχος σε τυχαίο δείγμα.` };
  return { who: 'none', text: 'Δεν απαιτείται δική σου ενέργεια: το δείγμα είναι επαρκές και κανένα συστηματικό λάθος δεν είναι γνωστό.' };
}
/** What the owner should do first, with why (the most useful for the least of their time). */
function actions(ds) {
  const out = [];
  const W = { match: 10, price: 9, photos: 8, colour: 8, sku: 7, ean: 6, brand: 5, aidesc: 4, sources: 3, specs: 0 };
  for (const d of ds) {
    if (d.id === 'specs') continue;
    if (!d.enough) out.push({ prio: W[d.id] + (d.main ? 0 : 2), domain: d.label, text: d.main ? `${d.label}: χρειάζονται ${d.need} ακόμη ${d.main.basis === 'decisions' ? 'αποφάσεις' : 'επιβεβαιώσεις'} για επαρκές δείγμα.` : `${d.label}: δεν έχει μετρηθεί ακόμα.`, why: 'Χωρίς ~30 ελέγχους ο αριθμός έχει μεγάλο περιθώριο (δεν ξέρουμε αν είναι καλό).', go: d.id === 'photos' ? 'photos' : ['match', 'price', 'colour', 'sources'].includes(d.id) ? 'sample' : 'fixes' });
    if (d.delta != null && Math.abs(d.delta) >= 2) out.push({ prio: 2, domain: d.label, text: `${d.label}: ${d.delta > 0 ? 'βελτιώθηκε' : 'χειροτέρεψε'} κατά ${Math.abs(d.delta)} μονάδες από ${d.prev.day}.`, why: d.delta > 0 ? 'Οι τελευταίες διορθώσεις φαίνεται να βοήθησαν (στο ίδιο είδος μέτρησης).' : 'Κάτι άλλαξε προς το χειρότερο: δες τα λάθη του τομέα.', go: '' });
  }
  const match = ds.find((d) => d.id === 'match');
  const variant = match && match.problems.find((p) => /άλλο χρώμα/.test(p.what));
  if (variant && variant.n >= 3) out.push({ prio: 14, domain: 'Χρώμα', text: `Εντοπίστηκαν ${variant.n} λάθη «άλλο χρώμα / μέγεθος» στις αντιστοιχίες.`, why: 'Το πιο συχνό λάθος: κοίτα αν αφορά συγκεκριμένα καταστήματα ή κατηγορίες (στο «Τι χρειάζεται»).', go: '' });
  // (a known systematic mistake comes before a domain that is only measured too little)
  for (const host of doubtShops().keys()) out.push({ prio: 13, domain: 'Πηγές', text: `Το κατάστημα ${host} έχει χαμηλότερη αξιοπιστία από τα υπόλοιπα.`, why: 'Οι αντιστοιχίες του δεν μετράνε πια μόνες τους· αν το ξέρεις αξιόπιστο, οι «Ίδιο» σου το διορθώνουν.', go: 'product' });
  const ag = aiAgreement();
  if (ag.n >= 10 && !ag.proven) out.push({ prio: 3, domain: 'AI', text: `Το AI συμφωνεί μαζί σου ${ag.p}% (${ag.same}/${ag.n}): δεν μετράει ακόμα στην εκμάθηση.`, why: 'Χρειάζεται ≥90% σε ≥20 κοινές απαντήσεις· οι έλεγχοί σου στο «Το AI διαφωνεί» το δείχνουν γρηγορότερα.', go: 'aidoubts' });
  if (!out.length) out.push({ prio: 0, domain: '', text: 'Δεν απαιτείται δική σου ενέργεια — το σύστημα προχωρά μόνο του.', why: 'Όλοι οι τομείς που μετριούνται έχουν επαρκές δείγμα και κανένα γνωστό συστηματικό λάθος.', go: '' });
  return out.sort((a, b) => b.prio - a.prio).slice(0, 5); // (the five most useful: never a long list of chores)
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

module.exports = { domains, actions, nextStep, ENOUGH, DOMAINS, migrateVariants, undo, aiRound, aiJudge, aiPrompt, aiDoubts, aiAgreement, calibration, calibrationFor, CAL_MIN, KEY, record, sample, dossier, check, scoreboard, doubtShops, recent, wilson, automatic, DOUBT_MIN, DOUBT_SHARE };
