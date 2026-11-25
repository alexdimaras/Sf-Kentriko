'use strict';
// SF Κέντρο — is this PHOTO really our product, in our variant? (asked 25/11 §1)
//
// Not enough that the page is about the same product: every candidate photo is looked at on its own.
//   1. rules, for every photo, always (cheap, explainable): the file name and the page title say another colour, another
//      edition (PRO / MK2 / V2…), an accessory or a spare part, the box, a size chart / banner / logo; the same picture
//      at another size or address (a duplicate); a thumbnail too small;
//   2. a person: a random sample of the proposed photos, answered with a category (Σωστό · Άλλο χρώμα · …) — undo;
//   3. the AI's EYES, only when a model that really sees pictures is installed (Ollama says «vision»; qwen2.5:7b does
//      not): our photo ↔ theirs, judged apart (model, colour, shape, the page's text, the same product or only the same
//      kind, another edition). Never proof on its own: with the code / EAN / title / colour of the page; never approves.
// The result is a category per photo — never one score that hides the doubts.
const store = require('./store');
const U = require('./util');

const KEY = 'photo-checks'; // { items: { 'site:id|url': { k, url, host, verdict: yes|no|unsure, category, why, by, at, sample, ver, cat, src } } }
const VER = 1;               // the version of the photo rules (25/11)
const CATS = {
  right: 'Σωστό προϊόν και σωστό χρώμα',
  other_colour: 'Σωστό μοντέλο αλλά άλλο χρώμα',
  other_version: 'Σωστό μοντέλο αλλά άλλη έκδοση',
  maybe: 'Πιθανό ίδιο προϊόν — χρειάζεται επιβεβαίωση',
  wrong_product: 'Λάθος προϊόν',
  accessory: 'Αξεσουάρ ή εξάρτημα',
  packaging: 'Φωτογραφία συσκευασίας',
  generic: 'Γενική διαφημιστική εικόνα',
  duplicate: 'Διπλή φωτογραφία',
  poor: 'Κακή ή ακατάλληλη ποιότητα',
  uncertain: 'Αβέβαιο αποτέλεσμα',
};
// never proposed / proposed only for a look
const NEVER = new Set(['other_colour', 'other_version', 'wrong_product', 'generic', 'duplicate', 'poor']);
const EDITION = /\b(PRO|MK\s?[2-9]|MKII|MKIII|V[2-9]|GEN\s?[2-9]|PLUS|MAX|MINI|LITE|XL|II|III|IV|2\.0|3\.0)\b/;
const ACCESSORY = /(^|[-_ ])(spare|replacement|accessor(y|ies)|parts?|strap|clip|refill|adapter|ανταλλακτ|εξαρτημ)([-_ .]|$)/i;
const PACKAGING = /(^|[-_ ])(box|package|packaging|packshot-box|blister|συσκευασ)([-_ .]|$)/i;
const GENERIC = /(^|[-_ ])(banner|logo|placeholder|no-?image|size-?chart|sizechart|sizes?-?guide|measur|lifestyle|promo|icon|badge|youtube|play-button)([-_ .]|$)/i;

const fileOf = (u) => decodeURIComponent(String(u || '').split('?')[0].split('#')[0].split('/').pop() || '').toLowerCase();
/** The same picture at another size / address: the maker's file name without size and copy suffixes. */
function keyOf(u) {
  const f = fileOf(u).replace(/\.(jpe?g|png|webp|gif|avif)$/i, '');
  return f.replace(/[-_]\d{2,4}x\d{2,4}$/, '').replace(/_\d{2,4}x$/, '').replace(/[-_](scaled|large|medium|small|thumb|thumbnail|min|copy|e\d{10,})$/g, '').replace(/[-_]\d{1,2}$/, (m) => (/^[-_]\d$/.test(m) ? '' : m)).replace(/[^a-z0-9α-ω]+/g, '-');
}
const tokens = (s) => U.foldKey(String(s || '').replace(/[-_.+%]/g, ' ')).split(/\s+/).filter(Boolean);

/**
 * One candidate photo, by the rules. p: our product { name }, u: the address, ctx: { title (of its page), proof
 * ('ean'|'sku'|'words'|…), exact (bool), seen: Set of keys already taken, ourKeys: Set of our photos' keys }
 * → { category, why, level }
 */
function classify(p, u, ctx) {
  const c = ctx || {};
  const mk = require('./market');
  const file = fileOf(u);
  const name = file.replace(/\.(jpe?g|png|webp|gif|avif)$/i, '');
  const k = keyOf(u);
  if (!file || !/\.(jpe?g|png|webp|gif|avif)$/i.test(file) && !/\/image|\/img|cdn/i.test(String(u))) return { category: 'uncertain', why: 'Δεν φαίνεται να είναι αρχείο εικόνας', level: 'low' };
  if ((c.ourKeys && c.ourKeys.has(k)) || (c.seen && c.seen.has(k))) return { category: 'duplicate', why: 'Η ίδια φωτογραφία (ίδιο αρχείο σε άλλο μέγεθος ή διεύθυνση)', level: 'sure' };
  const dims = name.match(/[-_](\d{2,4})x(\d{2,4})$/);
  if (dims && Math.max(Number(dims[1]), Number(dims[2])) < 300) return { category: 'poor', why: `Μικρή εικόνα (${dims[1]}×${dims[2]}): η μεγάλη δεν βρέθηκε`, level: 'sure' };
  if (GENERIC.test(name)) return { category: 'generic', why: 'Το όνομα του αρχείου δείχνει πίνακα μεγεθών / banner / λογότυπο, όχι το προϊόν', level: 'sure' };
  // colour: the file, then the page title (a page in several colours is said by its caller: c.multi)
  const ours = mk.coloursOf(p.name);
  const inFile = mk.coloursOf(U.foldKey(name.replace(/[-_.+%0-9]+/g, ' ')));
  if (ours.size && inFile.size && ![...inFile].some((x) => ours.has(x))) return { category: 'other_colour', why: `Το όνομα του αρχείου λέει άλλο χρώμα (${[...inFile].join(', ')})`, level: 'sure' };
  if (c.multi) return { category: 'other_colour', why: 'Κεντρική φωτογραφία σελίδας με πολλά χρώματα: μπορεί να δείχνει οποιοδήποτε', level: 'likely' };
  const inTitle = c.title ? mk.coloursOf(c.title) : new Set();
  if (ours.size && inTitle.size && ![...inTitle].some((x) => ours.has(x))) return { category: 'other_colour', why: `Η σελίδα της φωτογραφίας είναι για άλλο χρώμα (${[...inTitle].join(', ')})`, level: 'likely' };
  // edition: PRO / MK2 / V2 … in the file or the page title, not in ours (or in ours, not in theirs)
  const ed = (s) => new Set((U.foldKey(String(s || '').replace(/[-_]/g, ' ')).match(new RegExp(EDITION.source, 'g')) || []).map((x) => x.replace(/\s/g, '')));
  const eo = ed(p.name), ef = ed(name), et = ed(c.title);
  const other = [...ef, ...et].filter((x) => !eo.has(x));
  if (other.length && !(c.exact && !ef.size)) return { category: 'other_version', why: `Άλλη έκδοση (${[...new Set(other)].join(', ')}) από τη δική μας`, level: 'likely' };
  if (ACCESSORY.test(name) && !ACCESSORY.test(U.foldKey(p.name).toLowerCase())) return { category: 'accessory', why: 'Το όνομα του αρχείου δείχνει ανταλλακτικό / αξεσουάρ', level: 'likely' };
  if (PACKAGING.test(name)) return { category: 'packaging', why: 'Φωτογραφία της συσκευασίας (μπαίνει τελευταία)', level: 'likely' };
  if (c.wrong) return { category: 'wrong_product', why: 'Η σελίδα είναι για άλλο προϊόν', level: 'sure' };
  // the same product, proved: by EAN / the whole code, or our colour named on both sides (or neither has colours)
  const colourOk = !ours.size || inFile.size || inTitle.size;
  if (c.exact && colourOk) return { category: 'right', why: c.proof === 'ean' ? 'Ίδιο EAN, ίδιο χρώμα' : 'Ίδιος κωδικός, ίδιο χρώμα', level: 'likely' };
  if (colourOk && (c.proof === 'words' || c.proof === 'code')) return { category: 'maybe', why: 'Ίδια μάρκα / μοντέλο / χρώμα από τους τίτλους: θέλει επιβεβαίωση', level: 'low' };
  if (!colourOk) return { category: 'maybe', why: 'Ούτε το αρχείο ούτε η σελίδα λένε χρώμα (το δικό μας έχει): θέλει επιβεβαίωση', level: 'low' };
  return { category: 'uncertain', why: 'Δεν υπάρχει αρκετή απόδειξη', level: 'low' };
}

/**
 * A gallery for OUR variant: every candidate classified; what is never ours left out (with why); the right ones first,
 * then the likely ones, the box last — the details are kept (they are not the main photo, they are not dropped).
 * cands: [{ u, title, proof, exact, multi, wrong, src }] → { take: [{ u, category, why, src }], left: [...] }
 */
function gallery(p, cands, opts) {
  const o = opts || {};
  const ourKeys = new Set((p.images || []).map(keyOf));
  const seen = new Set();
  const decided = o.checks || {}; // url → a person's answer
  const take = [], left = [];
  for (const x of cands) {
    const k = keyOf(x.u);
    const person = decided[x.u];
    let r = classify(p, x.u, Object.assign({}, x, { seen, ourKeys }));
    if (person && person.verdict === 'no') r = { category: person.category || 'wrong_product', why: 'Το είπες εσύ: ' + (CATS[person.category] || 'όχι σωστή'), level: 'sure', person: true };
    else if (person && person.verdict === 'yes') r = { category: 'right', why: 'Το επιβεβαίωσες εσύ', level: 'sure', person: true };
    const row = Object.assign({ u: x.u, src: x.src || '', label: CATS[r.category] }, r);
    if (NEVER.has(r.category) || r.category === 'accessory' && !o.keepAccessories) left.push(row);
    else { take.push(row); seen.add(k); }
  }
  const order = { right: 0, maybe: 1, uncertain: 2, accessory: 3, packaging: 4 };
  take.sort((a, b) => (order[a.category] ?? 5) - (order[b.category] ?? 5));
  return { take, left };
}

// ---------- the person's checks: a random sample of the proposed photos ----------
function data() { const d = store.read(KEY, null) || {}; d.items = d.items || {}; return d; }
/** The answers for one product → { url: answer } (for the gallery). */
function checksFor(k) { const out = {}; for (const x of Object.values(data().items)) if (x.k === k) out[x.url] = x; return out; }
/** A random sample of photos the program proposes now (pending «Φωτογραφίες» of Διορθώσεις), each on its own. */
function sample(n) {
  const fixes = require('./fixes');
  const done = data().items;
  const pool = [];
  for (const c of fixes.compute().items) {
    if (c.field !== 'images' || c.status !== 'pending') continue;
    const k = c.site + ':' + c.pid;
    for (const ph of c.photos || []) if (!done[k + '|' + ph.u]) pool.push({ k, name: c.name, ours: (c.from || [])[0] || c.img || '', url: ph.u, category: ph.category, why: ph.why, src: ph.src || (c.source && c.source.label) || '', productUrl: c.url, ai: ph.ai || null });
  }
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return { rows: pool.slice(0, Math.max(1, Math.min(30, Number(n) || 10))), left: pool.length };
}
/** A person's answer about one photo: category right → yes; any other → no; «uncertain» → not sure. */
function check(input, by) {
  const k = String(input.k || ''), url = String(input.url || '');
  if (!/^(sf|st):\d+$/.test(k) || !/^https?:\/\//.test(url)) throw new Error('Λάθος φωτογραφία.');
  const category = CATS[input.category] ? input.category : 'uncertain';
  const verdict = category === 'right' ? 'yes' : category === 'uncertain' ? 'unsure' : 'no';
  const row = { k, url: url.slice(0, 500), host: U.hostOf(url), verdict, category, by: by || '', at: U.nowIso(), sample: !!input.sample, ver: VER, prog: String(input.prog || '').slice(0, 30), cat: catOf(k), src: String(input.src || '').slice(0, 120) };
  store.update(KEY, {}, (d) => { d.items = d.items || {}; const prev = d.items[k + '|' + row.url]; if (prev && prev.sample) row.sample = true; d.items[k + '|' + row.url] = row; return d; });
  try { require('./fixes').invalidate(); } catch (_) { /* not loaded */ }
  return row;
}
function undo(input) {
  const id = String(input.k || '') + '|' + String(input.url || '').slice(0, 500);
  let had = null;
  store.update(KEY, {}, (d) => { d.items = d.items || {}; had = d.items[id] || null; delete d.items[id]; return d; });
  try { require('./fixes').invalidate(); } catch (_) { /* not loaded */ }
  return { ok: true, was: had ? had.category : null };
}
function catOf(k) { try { const [site, id] = k.split(':'); const p = require('./catalog').byId(site).get(Number(id)); return p ? String((p.catNames || [])[0] || '') : ''; } catch (_) { return ''; } }
/** What the program said about the photos a person judged: how often each category was right. */
function agreement() {
  const rows = Object.values(data().items).filter((x) => x.prog && x.verdict !== 'unsure');
  const by = {};
  for (const r of rows) { const b = by[r.prog] || (by[r.prog] = { n: 0, same: 0 }); b.n++; if ((r.prog === 'right') === (r.verdict === 'yes')) b.same++; }
  return by;
}

// ---------- the AI's eyes (only a model that really sees) ----------
const VISION_SCHEMA = {
  type: 'object',
  properties: {
    same_model: { type: 'string', enum: ['yes', 'no', 'unsure'] },
    same_colour: { type: 'string', enum: ['yes', 'no', 'unsure'] },
    same_shape: { type: 'string', enum: ['yes', 'no', 'unsure'] },
    matches_text: { type: 'string', enum: ['yes', 'no', 'unsure'] },
    same_product_or_kind: { type: 'string', enum: ['same_product', 'same_kind_only', 'different', 'unsure'] },
    other_version: { type: 'string', enum: ['yes', 'no', 'unsure'] },
    category: { type: 'string', enum: Object.keys(CATS) },
    why: { type: 'string' },
  },
  required: ['same_model', 'same_colour', 'same_shape', 'matches_text', 'same_product_or_kind', 'other_version', 'category', 'why'],
};
/**
 * Our photo ↔ a candidate, by a model that sees. Every part apart; the category it gives is a SECOND opinion: it can
 * only make a photo more doubtful (never «sure», never approved by itself). → { ...parts, category, why, model } or
 * throws when no model sees (the reason is said).
 */
async function visionCompare(ourUrl, theirUrl, ctx) {
  const localai = require('./localai');
  const vm = (await localai.visionModels())[0];
  if (!vm) throw Object.assign(new Error('Κανένα εγκατεστημένο μοντέλο δεν βλέπει εικόνες (το qwen2.5:7b διαβάζει μόνο κείμενο).'), { code: 'no_vision' });
  const c = ctx || {};
  const prompt = `Η πρώτη εικόνα είναι το ΔΙΚΟ ΜΑΣ προϊόν: «${String(c.name || '').slice(0, 160)}». Η δεύτερη είναι υποψήφια φωτογραφία από άλλη σελίδα${c.title ? ` με τίτλο «${String(c.title).slice(0, 160)}»` : ''}.
Κρίνε ΧΩΡΙΣΤΑ: ίδιο μοντέλο; ίδιο χρώμα; ίδιο σχήμα και βασικά χαρακτηριστικά; συμφωνεί με τον τίτλο της σελίδας; ίδιο προϊόν ή μόνο ίδιο είδος; ενδείξεις άλλης έκδοσης (PRO, MK2, V2);
Και διάλεξε κατηγορία: ${Object.entries(CATS).map(([k, v]) => `${k} = ${v}`).join(' · ')}.
Αν δεν είσαι βέβαιος, «unsure». Απάντησε JSON.`;
  const a = await localai.askJson(prompt, VISION_SCHEMA, (o) => (o && CATS[o.category] ? o : null), { model: vm.name, imageUrls: [ourUrl, theirUrl], maxTokens: 300, timeout: 180000 });
  return Object.assign({}, a.data, { model: a.model || vm.name, how: vm.how });
}
/** The AI's answer can only add doubt: a «right» photo stays as the rules said; anything else → «look at it». */
function withVision(row, v) {
  if (!v) return row;
  const bad = v.same_model === 'no' || v.same_colour === 'no' || v.other_version === 'yes' || v.same_product_or_kind !== 'same_product' || (v.category && v.category !== 'right');
  return Object.assign({}, row, { ai: { category: v.category, colour: v.same_colour, model: v.same_model, version: v.other_version, kind: v.same_product_or_kind, why: v.why, by: v.model }, ...(bad && row.category === 'right' ? { category: 'maybe', why: row.why + ' · το AI είδε: ' + (v.why || CATS[v.category] || 'διαφορά') } : {}) });
}

module.exports = { KEY, VER, CATS, NEVER, classify, gallery, keyOf, sample, check, undo, checksFor, agreement, visionCompare, withVision, VISION_SCHEMA };
