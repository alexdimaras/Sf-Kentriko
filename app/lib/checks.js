'use strict';
// Catalog health checks for both shops. Each check lists products and, where possible,
// produces a ready WooCommerce update file that fixes them. Items can be marked "ignore".
const settings = require('./settings');
const catalog = require('./catalog');
const store = require('./store');
const adrules = require('./adrules');
const spell = require('./spell');
const U = require('./util');
const kinds = require('./kinds');
const bg = require('./bg');

const SEV = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const DEFAULT_CAT = /^(uncategorized|default|xoris-katigoria|χωρις-κατηγορια|genika)$/i;

function ignored() { return store.read('ignored', {}); }
function setIgnored(checkId, keys, on) {
  store.update('ignored', {}, (m) => {
    const set = new Set(m[checkId] || []);
    for (const k of keys) { if (on) set.add(k); else set.delete(k); }
    if (set.size) m[checkId] = [...set]; else delete m[checkId];
    return m;
  });
  // nothing is recalculated: the marks are laid over the results (cached), like the decisions of the fixes
}

/** How often each word appears in the titles of both shops (Greek and Latin). Kept until a catalog changes. */
let wordMemo = null;
function wordsFresh() { return wordMemo && wordMemo.v === catalog.bothVer() ? wordMemo.out : null; }
function wordStats() {
  const hit = wordsFresh();
  if (hit) return hit;
  const v = catalog.bothVer();
  const out = bg.drainSync(wordsGen());
  wordMemo = { v, out };
  return out;
}
/** The same, in slices (the program keeps answering): used before the checks are built in the background. */
async function warmWords() {
  if (wordsFresh()) return;
  const v = catalog.bothVer();
  const out = await bg.drain(wordsGen());
  wordMemo = { v, out };
}
/** Words kept from the last run (after a restart), valid for the catalogs loaded now. */
function setWords(pairs) {
  if (!pairs || !Array.isArray(pairs.freq)) return;
  wordMemo = { v: catalog.bothVer(), out: { freq: new Map(pairs.freq), latin: new Map(pairs.latin || []) } };
}
function wordsForSave() { const w = wordsFresh(); return w ? { freq: [...w.freq], latin: [...w.latin] } : null; }
function* wordsGen() {
  const freq = new Map(), latin = new Map();
  const seen = new Set();
  for (const site of catalog.SITES) {
    for (const p of catalog.load(site).products) {
      if (p.type === 'variation') continue;
      yield;
      // the same product on both shops counts once; titles and descriptions both count
      const key = U.foldKey(p.name);
      const dup = seen.has(key); seen.add(key);
      if (dup) continue;
      // the first 4000 letters are enough: the description is opened and cut before the slow clean-up
      const text = p.name + ' ' + U.stripTags((String(p.short || '') + ' ' + String(p.desc || '')).slice(0, 12000)).slice(0, 4000);
      for (const w of new Set(spell.plain(text).split(/[^\u0370-\u03ffA-Z]+/))) {
        if (/^[\u0391-\u03a9]{3,}$/.test(w)) freq.set(w, (freq.get(w) || 0) + 1);
        else if (/^[A-Z]{3,}$/.test(w)) latin.set(w, (latin.get(w) || 0) + 1);
      }
    }
  }
  return { freq, latin };
}

/** Type word for a title that starts with a brand: the most common first word in the same category. */
function typeSuggester(site) {
  const c = catalog.load(site);
  const byCat = new Map();
  for (const p of c.products) {
    if (p.type === 'variation') continue;
    const w = U.greekUpper(p.name).split(' ')[0];
    if (!/^[Α-Ω]{3,}$/.test(w)) continue;
    for (const id of p.cats) {
      let m = byCat.get(id);
      if (!m) { m = new Map(); byCat.set(id, m); }
      m.set(w, (m.get(w) || 0) + 1);
    }
  }
  const learned = catalog.learnedTypes().map || {};
  const brandWords = new Set();
  for (const k of catalog.knownBrands().keys()) for (const w of U.greekUpper(k).split(/[^A-Z0-9Α-Ω]+/)) if (w.length > 1) brandWords.add(w);
  // the kinds learned from the titles (first word of many titles) + the shop's own kind words (lib/knowledge.js:
  // ΔΙΑΚΡΙΤΙΚΟ is a kind although 5.11 writes it in the middle of 35 titles and so it is never «the first word»)
  const K = require('./knowledge').terms();
  const R = kinds.recogniser([...new Set((catalog.learnedTypes().nouns || []).concat([...K.kinds]))], catalog.categoryIndex(site), brandWords);
  // a Greek word that may well be the kind already (ΠΕΡΙΚΝΗΜΙΔΕΣ, ΑΚΟΝΙΣΤΗΣ): no colour, no «of …», no little word
  // (…«-ΤΗΣ» of 8 letters or more is a thing or a person — ΑΚΟΝΙΣΤΗΣ, ΤΗΛΕΠΙΕΣΟΣΤΑΤΗΣ — not «of something»)
  const nounLike = (w) => /^[Α-Ω]{4,}$/.test(w) && !kinds.COLOUR.test(w) && !kinds.PREP.has(w) && (!kinds.GENITIVE.test(w) || (w.length >= 8 && /ΤΗΣ$/.test(w)));
  return (p) => {
    // 1. the kind is written inside the title: it goes first, with the words that belong to it
    //    (5.11 TACTICAL ΣΑΚΙΔΙΟ RUSH → ΣΑΚΙΔΙΟ 5.11 TACTICAL RUSH · BENELLI M4 ΗΜΙΑΥΤΟΜΑΤΗ ΚΑΡΑΜΠΙΝΑ → ΗΜΙΑΥΤΟΜΑΤΗ ΚΑΡΑΜΠΙΝΑ BENELLI M4)
    const moved = kinds.kindFirst(p.name, R.isKind);
    if (moved) return { fix: moved.fix, why: `Το είδος «${moved.phrase}» να πάει πρώτο`, how: 'title' };
    // 2. proof of what it is: a trade name of one kind only (12ΒΟΛΑ, ΜΟΝΟΒΟΛΑ → ΦΥΣΙΓΓΙΑ), or its own category
    const k = R.kindOf(p);
    if (k.kind && k.at !== 0 && (k.how === 'compound' || k.how === 'category')) return { fix: k.kind + ' ' + U.collapse(p.name), why: `Είδος «${k.kind}»: ${k.proof}`, how: k.how, kind: k.kind };
    const ws = kinds.words(p.name);
    // 2b. a foreign word the shop names in its own way (PATCH → ΔΙΑΚΡΙΤΙΚΟ): its rule, said with its source
    const fw = ws.find((w) => K.foreign.has(w.replace(/[^A-Z]/g, '')));
    if (fw && !ws.some((w) => R.isKind(w))) { const f = K.foreign.get(fw.replace(/[^A-Z]/g, '')); return { fix: f.to + ' ' + U.collapse(p.name), why: `Είδος «${f.to}»: «${fw}» στη γλώσσα του καταστήματος (${f.source})`, how: 'term', kind: f.to }; }
    // 3. no proof: what similar products are called — a suggestion to check, never a certainty. Not when the title
    // already has a Greek word that may be its kind (it is not put aside for another one: 101 of 531 such proposals on
    // the real catalog, 24/11 — ΠΕΡΙΚΝΗΜΙΔΕΣ → «ΓΙΛΕΚΟ»), never a second kind word, and only from enough products:
    // 5 or more of the category starting with a Greek word, 60% of them with the same one (one product of «5.11
    // TACTICAL» named all 35 of its patches «ΣΗΜΑ»)
    if (ws.some((w) => R.isKind(w) || nounLike(w))) return { fix: '', why: 'Ο τίτλος έχει ήδη ελληνική λέξη για το είδος· καμία άλλη από «παρόμοια προϊόντα» (γράψε το είδος μπροστά, αν χρειάζεται)', how: '' };
    const words = U.greekUpper(p.name).split(' ');
    let best = '', bn = 0;
    for (const id of p.cats) {
      const m = byCat.get(id);
      if (!m) continue;
      let tot = 0; for (const n of m.values()) tot += n;
      if (tot < 5) continue;
      for (const [w, n] of m) if (n > bn && n >= 3 && n / tot >= 0.6) { bn = n; best = w; }
    }
    if (!best) {
      const votes = new Map();
      // (a foreign word that goes with one kind in many of our titles: SHORTS → ΒΕΡΜΟΥΔΑ in 11 of 14 — not a word seen
      // with a kind a few times: TRACER (a model of jackets, and a brand of power banks), TOURNIQUET (in «ΘΗΚΗ TOURNIQUET»))
      for (const w of words) { const l = learned[w.replace(/[^A-Z]/g, '')]; if (l && l.n >= 10 && l.share >= 0.75) votes.set(l.type, (votes.get(l.type) || 0) + l.share); }
      for (const [t, v] of votes) if (v > bn) { bn = v; best = t; }
    }
    if (best) { const sp = spell.check(best, wordStats().freq); if (sp && sp.fix) best = sp.fix; }
    // (a person said «no» to this word for products of this category twice: it is not proposed from «similar» again)
    if (best && (require('./knowledge').refusedIn(p.cats).get(best) || 0) >= 2) return { fix: '', why: `Η λέξη «${best}» απορρίφθηκε για παρόμοια προϊόντα: γράψε το είδος μπροστά`, how: '', refused: best };
    return best ? { fix: best + ' ' + U.collapse(p.name), why: `Πρόταση: «${best}» πρώτο (έτσι λέγονται παρόμοια προϊόντα — έλεγξέ το)`, how: 'similar' } : { fix: '', why: 'Δεν βρέθηκε πρόταση — γράψε το είδος μπροστά', how: '' };
  };
}

function* runGen() {
  const s = settings.all();
  const names = { sf: s.sites.sf.name, st: s.sites.st.name };
  const checks = [];
  const L = catalog.links();
  const brands = new Set([...catalog.knownBrands().keys()].map((k) => k.replace(/[^A-Z0-9]/g, '')));
  const { freq, latin } = wordStats();
  const dict = spell.dict();
  const latinCommon = new Set([...latin].filter(([, n]) => n >= 3).map(([w]) => w));
  for (const b of brands) latinCommon.add(b);
  // every item is kept here; the "ignore" marks are laid over the result afterwards (cached)
  const add = (c) => { if (c.items.length) checks.push(c); };

  for (const site of catalog.SITES) {
    const c = catalog.load(site);
    if (!c.syncedAt) continue;
    const other = site === 'sf' ? 'st' : 'sf';
    const all = c.products;
    let main = all.filter((p) => p.type !== 'variation' && p.status !== 'draft' && p.status !== 'private');
    const byId = new Map(all.map((p) => [p.id, p]));
    const oById = new Map(catalog.load(other).products.map((p) => [p.id, p]));
    const map = site === 'sf' ? L.sfToSt : L.stToSf;
    const item = (p, extra) => Object.assign({ site, id: p.id, name: p.name, sku: p.sku, price: p.price, img: p.thumb || p.images[0] || '', url: p.url, brand: p.brand }, extra || {});
    const n = names[site];
    const idx = catalog.categoryIndex(site);

    // What may be advertised (ads site only)
    if (site === 'st') {
      const lv = { banned: [], google: [], caution: [], meta18: [] };
      for (const p of main) {
        yield;
        const oid = map.get(p.id);
        const r = catalog.adStatus(site, p, oid ? oById.get(oid) : null, other);
        if (lv[r.level]) lv[r.level].push(item(p, { why: r.why }));
      }
      add({ id: 'st-ads-banned', site, severity: 'critical', title: 'Απαγορεύονται σε Google και Meta', help: 'Όπλα (και αεροβόλα/airsoft), φυσίγγια, γεμιστήρες, κοντάκια/λαβές/ράγες, σπρέι πιπεριού, μαχαίρια «μάχης». Μπορεί να κλείσουν τον λογαριασμό διαφημίσεων. Το αρχείο τα κάνει πρόχειρα στο ' + n + '.', items: lv.banned, fix: { kind: 'unpublish', label: 'Αρχείο: κάνε τα πρόχειρα' } });
      add({ id: 'st-ads-google', site, severity: 'high', title: 'Όχι στο Google — στο Meta μόνο 18+', help: 'Διόπτρες, σκοπευτικά, red dot, φακοί όπλου: το Google τα απορρίπτει (scopes and sights). Κράτα τα στο site, αλλά βγάλ’ τα από το feed του Google.', items: lv.google, fix: { kind: 'hidegoogle', label: 'Αρχείο: απόκρυψη από Google' } });
      add({ id: 'st-ads-caution', site, severity: 'low', title: 'Μαχαίρια και ειδικά είδη: προσοχή στη διατύπωση', help: 'Κυνηγετικά/εργαλεία επιτρέπονται. Απορρίπτονται όταν παρουσιάζονται ως όπλα (tactical, combat, military, υποβοηθούμενο άνοιγμα). Μην τα διαφημίζεις με τέτοιες λέξεις ή εικόνες.', items: lv.caution });
      add({ id: 'st-ads-meta18', site, severity: 'info', title: 'Στο Meta μόνο με στόχευση 18+', help: 'Θήκες όπλων, θήκες γεμιστήρων, αορτήρες: επιτρέπονται, αλλά οι διαφημίσεις στο Facebook/Instagram πρέπει να στοχεύουν 18+.', items: lv.meta18 });
    }

    // what is not allowed on the ads site only gets "take it off": no other check or fix is asked for it
    if (site === 'st') { const banned = catalog.bannedOnAds(); main = main.filter((p) => !banned.has(p.id)); }
    add({ id: site + '-noimg', site, severity: 'high', title: 'Χωρίς φωτογραφία', help: 'Προϊόντα χωρίς φωτογραφία σχεδόν δεν πουλάνε και απορρίπτονται από Google Shopping / Meta.', items: main.filter((p) => !p.images.length).map((p) => item(p)) });
    const noPrice = main.filter((p) => !(p.price > 0));
    const weaponNoPrice = [], realNoPrice = [];
    for (const p of noPrice) {
      const oid = map.get(p.id);
      const lvl = catalog.adStatus(site, p, oid ? oById.get(oid) : null, other).level;
      (lvl === 'banned' ? weaponNoPrice : realNoPrice).push(item(p, { why: p.type === 'variable' ? 'Μεταβλητό: κανένα μέγεθος δεν έχει τιμή' : (p.inStock ? '' : 'Εξαντλημένο') }));
    }
    add({ id: site + '-noprice', site, severity: 'high', title: 'Χωρίς τιμή', help: 'Δεν αγοράζονται και χαλάνε τα feeds των διαφημίσεων.', items: realNoPrice });
    add({ id: site + '-noprice-weapons', site, severity: 'info', title: 'Όπλα / φυσίγγια χωρίς τιμή', help: 'Συνήθως σκόπιμα (τιμή κατόπιν επικοινωνίας). Μόνο ενημερωτικό.', items: weaponNoPrice });
    add({ id: site + '-nodesc', site, severity: 'medium', title: 'Χωρίς περιγραφή ή με πολύ μικρή', help: `Λιγότερο από ${s.descMinChars} χαρακτήρες. Κακό για Google και για τον πελάτη.`, items: main.filter((p) => p.descLen + p.shortLen < s.descMinChars).map((p) => item(p, { why: (p.descLen + p.shortLen) + ' χαρακτήρες' })) });
    const isDefault = (id) => { const cc = idx.byId.get(id); return !cc || DEFAULT_CAT.test(String(cc.slug || '')) || /^(uncategorized|χωρις κατηγορια)$/i.test(U.stripTonos(cc.name).toLowerCase()); };
    add({ id: site + '-nocat', site, severity: 'medium', title: 'Μόνο στη γενική κατηγορία', help: 'Δεν εμφανίζονται στο μενού και στα φίλτρα (π.χ. μόνο στο «' + ((idx.cats.find((x) => DEFAULT_CAT.test(String(x.slug || ''))) || {}).name || 'Uncategorized') + '»).', items: main.filter((p) => !p.cats.length || p.cats.every(isDefault)).map((p) => item(p)) });
    add({ id: site + '-nosku', site, severity: 'low', title: 'Χωρίς κωδικό (SKU)', help: 'Χωρίς κωδικό δεν γίνεται αντιστοίχιση με τιμοκαταλόγους αντιπροσώπων.', items: main.filter((p) => !p.sku).map((p) => item(p)) });
    add({ id: site + '-oneimg', site, severity: 'info', title: 'Μόνο μία φωτογραφία', help: 'Δεύτερη φωτογραφία (πίσω όψη, λεπτομέρεια) ανεβάζει τις πωλήσεις.', items: main.filter((p) => p.images.length === 1).map((p) => item(p)) });
    add({ id: site + '-out', site, severity: 'info', title: 'Εμφανίζονται εξαντλημένα', help: 'Μόνο ενημερωτικό: έτσι τα βλέπει ο πελάτης στο site.', items: main.filter((p) => !p.inStock).map((p) => item(p)) });
    add({ id: site + '-nobrand', site, severity: 'low', title: 'Χωρίς μάρκα', help: 'Η μάρκα βοηθάει στα φίλτρα, στο Google και στη σύνδεση με αντιπρόσωπο.', items: main.filter((p) => !p.brand).map((p) => item(p)) });

    // Titles
    const mixed = [], suspect = [], caps = [], accents = [], spaces = [], long = [], typos = [], typeFirst = [], broken = [], codeTitle = [];
    const suggestType = typeSuggester(site);
    // (the same context as the proposals: a code of another product that is in 2+ of our titles is a model — XQ35)
    const codeCtx = { codes: catalogCodes(), brands: new Set([...catalog.knownBrands().keys()].map((k) => k.replace(/[^A-Z0-9]/g, ''))), titleTok: titleTokens() };
    const mk = require('./market');
    const colourBad = [];
    yield;
    for (const p of main) {
      yield;
      const name = p.name;
      const rep = U.repairEntities(name);
      if (rep) broken.push(item(p, { fix: U.capsTitle(rep), why: 'Χάθηκε ένα «&» ή άλλο σύμβολο όταν γράφτηκε ο τίτλος στο site' }));
      const fm = U.fixMixedScript(name, latinCommon, dict, freq);
      if (fm.changed) mixed.push(item(p, { fix: U.capsTitle(fm.text), why: 'Ελληνικά και λατινικά γράμματα μαζί' }));
      if (fm.suspects.length) {
        let t = name;
        for (const x of fm.suspects) t = t.split(x.word).join(x.fix);
        suspect.push(item(p, { why: fm.suspects.map((x) => `${x.word} → ${x.fix}`).join(', '), fix: U.capsTitle(t) }));
      }
      if (!fm.changed && U.hasLowercase(name)) caps.push(item(p, { fix: U.capsTitle(name) }));
      else if (!fm.changed && /[ΆΈΉΊΌΎΏ]/.test(name)) accents.push(item(p, { fix: U.capsTitle(name) }));
      if (/\s{2,}/.test(name) || name !== name.trim() || /​/.test(name)) spaces.push(item(p, { fix: U.collapse(name.replace(/​/g, '')) }));
      if (name.length > s.longTitle) long.push(item(p, { why: name.length + ' χαρακτήρες' }));
      const inTitle = codesInTitle(name, p, codeCtx);
      if (inTitle.length) codeTitle.push(item(p, { why: 'κωδικός: ' + inTitle.join(', '), fix: U.collapse(name.split(/\s+/).filter((w) => !inTitle.includes(w)).join(' ')) }));
      // spelling
      const base = U.capsTitle(fm.changed ? fm.text : name);
      const fixes = [];
      const skip = new Set(fm.suspects.map((x) => x.word));
      for (const w of new Set(base.split(/[^Ͱ-ϿA-Z]+/))) {
        if (skip.has(w)) continue;
        const r = spell.check(w, freq);
        if (r) fixes.push([w, r.fix, r.alts]);
      }
      if (fixes.length) {
        const t = base.split(' ').map((tok) => tok.replace(/[Ͱ-Ͽ]+/g, (m) => { const hit = fixes.find(([a]) => a === m); return hit ? hit[1] : m; })).join(' ');
        typos.push(item(p, { why: fixes.map(([a, b, alts]) => `${a} → ${b}` + (alts.length ? ` (ή ${alts.join(', ')})` : '')).join(' · '), fix: t }));
      }
      // the colour of the title and the colour the product has (its attribute, or its variations) must agree
      {
        // (not the brand's words — TASMANIAN TIGER — nor a kind of sight — RED DOT / GREEN DOT —, nor a RAL code)
        const brandW = new Set(U.foldKey(p.brand || '').split(/[^A-Z0-9Α-Ω]+/).filter(Boolean));
        const plain = U.foldKey(name).replace(/\b(RED|GREEN)\s+DOT\b/g, ' ').replace(/\bRAL\b/g, ' ').replace(/\bTASMANIAN\s+TIGER\b/g, ' ').split(/\s+/).filter((w) => !brandW.has(w)).join(' ');
        const tc = mk.coloursOf(plain);
        if (tc.size) {
          const attr = (p.attrs || []).find((a) => /χρωμ|χρώμ|colou?r/i.test(a.name || ''));
          const terms = attr ? (attr.terms || []) : [];
          const ac = new Set(terms.flatMap((t) => [...mk.coloursOf(t)]));
          if (attr && !attr.variation && ac.size && ![...tc].some((c) => ac.has(c))) colourBad.push(item(p, { why: `τίτλος: ${[...tc].join(', ')} · ιδιότητα χρώματος: ${terms.join(', ')}` }));
          else if (attr && attr.variation && terms.length > 1 && ac.size > 1) colourBad.push(item(p, { why: `ο τίτλος γράφει ${[...tc].join(', ')}, αλλά το προϊόν έχει χρώματα-παραλλαγές: ${terms.slice(0, 6).join(', ')}` }));
        }
      }
      // type first (also «12ΒΟΛΑ FEDERAL…»: a trade name, not the kind)
      if (kinds.startsWithoutKind(name)) {
        const sug = suggestType(p);
        typeFirst.push(item(p, { why: sug.why, fix: sug.fix }));
      }
    }
    const nameFix = { kind: 'name', label: 'Αρχείο διόρθωσης τίτλων' };
    add({ id: site + '-broken', site, severity: 'high', title: 'Τίτλοι με σπασμένους χαρακτήρες', help: 'Π.χ. «Hamp;N» αντί για «H&N»: το «&» χάθηκε όταν γράφτηκε ή εισάχθηκε το προϊόν στο site, και έμεινε το υπόλοιπο του κωδικού του («amp;»). Έτσι το βλέπει και ο πελάτης και το Google· η μάρκα δεν αναγνωρίζεται.', items: broken, fix: nameFix });
    add({ id: site + '-mixed', site, severity: 'high', title: 'Τίτλοι με ελληνικά και λατινικά γράμματα μαζί', help: 'Π.χ. «ΔΙXΤΥ» με λατινικό X ή «ΣΟΥΓΙAΣ» με λατινικό A. Ο πελάτης που ψάχνει τη λέξη δεν βρίσκει το προϊόν, ούτε στο site ούτε στο Google.', items: mixed, fix: nameFix });
    add({ id: site + '-typos', site, severity: 'medium', title: 'Πιθανά ορθογραφικά λάθη στον τίτλο', help: 'Λέξεις που δεν υπάρχουν αλλού στον κατάλογο και μοιάζουν με γνωστή λέξη (π.χ. ΠΙΙΣΤΟΛΙ → ΠΙΣΤΟΛΙ). Έλεγξε πριν το ανεβάσεις.', items: typos, fix: nameFix });
    add({ id: site + '-suspect', site, severity: 'medium', title: 'Ελληνικές λέξεις γραμμένες με λατινικά', help: 'Π.χ. «KONTAKIA» αντί «ΚΟΝΤΑΚΙΑ». Εμφανίζονται μόνο λέξεις που υπάρχουν στα ελληνικά κείμενα του καταστήματος.', items: suspect, fix: nameFix });
    add({ id: site + '-typefirst', site, severity: 'medium', title: 'Ο τίτλος δεν ξεκινά με το είδος', help: 'Το πρότυπο είναι ΕΙΔΟΣ ΜΑΡΚΑ ΜΟΝΤΕΛΟ. Ο πελάτης ψάχνει «σακίδιο», όχι μόνο τη μάρκα. Η πρόταση βγαίνει από παρόμοια προϊόντα — έλεγξέ την.', items: typeFirst, fix: nameFix });
    add({ id: site + '-codetitle', site, severity: 'medium', title: 'Κωδικός μέσα στον τίτλο', help: 'Ο κωδικός (SKU / κωδικός κατασκευαστή) μένει στο πεδίο κωδικού: ο τίτλος είναι ΕΙΔΟΣ ΜΑΡΚΑ ΜΟΝΤΕΛΟ [ΧΡΩΜΑ]. Όταν ο κωδικός είναι το ίδιο το όνομα του μοντέλου (π.χ. MH40PRO) μένει.', items: codeTitle, fix: nameFix });
    add({ id: site + '-caps', site, severity: 'low', title: 'Τίτλοι με μικρά γράμματα', help: 'Το πρότυπο είναι όλα κεφαλαία χωρίς τόνους. Κωδικοί και μονάδες με αριθμούς (9x19, 400g) μένουν όπως είναι.', items: caps, fix: nameFix });
    add({ id: site + '-accents', site, severity: 'low', title: 'Κεφαλαία με τόνους', help: 'Στα κεφαλαία δεν μπαίνουν τόνοι.', items: accents, fix: nameFix });
    add({ id: site + '-spaces', site, severity: 'low', title: 'Διπλά ή κρυφά κενά στον τίτλο', help: '', items: spaces, fix: nameFix });
    add({ id: site + '-colour', site, severity: 'medium', title: 'Το χρώμα του τίτλου δεν συμφωνεί με το χρώμα του προϊόντος', help: 'Ο τίτλος λέει ένα χρώμα και η ιδιότητα «Χρώμα» άλλο (ή το προϊόν έχει πολλά χρώματα ως παραλλαγές). Ο πελάτης και το Google βλέπουν αντιφατικά στοιχεία: διόρθωσε το ένα από τα δύο.', items: colourBad });
    add({ id: site + '-long', site, severity: 'info', title: 'Πολύ μεγάλοι τίτλοι', help: 'Το Google κόβει τους τίτλους μετά τους ~70 χαρακτήρες.', items: long });

    // Duplicates (variations of one product may share codes; only whole products count)
    const byTitle = new Map(), bySku = new Map();
    yield;
    for (const p of main) {
      const k = U.foldKey(p.name);
      if (!byTitle.has(k)) byTitle.set(k, []);
      byTitle.get(k).push(p);
      if (p.sku) { const ks = U.normSku(p.sku); if (!bySku.has(ks)) bySku.set(ks, []); bySku.get(ks).push(p); }
    }
    const dupT = [], dupS = [];
    for (const [, arr] of byTitle) if (arr.length > 1) for (const p of arr) dupT.push(item(p, { why: arr.length + ' προϊόντα με τον ίδιο τίτλο', group: U.foldKey(p.name) }));
    for (const [, arr] of bySku) if (arr.length > 1) for (const p of arr) dupS.push(item(p, { why: `Κωδικός ${p.sku} σε ${arr.length} προϊόντα`, group: U.normSku(p.sku) }));
    add({ id: site + '-duptitle', site, severity: 'medium', title: 'Διπλά προϊόντα (ίδιος τίτλος)', help: 'Το ίδιο προϊόν δύο φορές μοιράζει τις πωλήσεις και μπερδεύει το Google.', items: dupT });
    add({ id: site + '-dupsku', site, severity: 'medium', title: 'Ίδιος κωδικός σε διαφορετικά προϊόντα', help: 'Το WooCommerce και οι τιμοκατάλογοι χρειάζονται μοναδικό κωδικό ανά προϊόν.', items: dupS });
    void byId;
    yield;
  }

  // Cross-site
  const sfc = catalog.load('sf'), stc = catalog.load('st');
  if (sfc.syncedAt && stc.syncedAt) {
    const stById = new Map(stc.products.map((p) => [p.id, p]));
    const master = s.master === 'st' ? 'st' : 'sf';
    const bannedSt = catalog.bannedOnAds();
    const diff = [], zero = [], missing = [], onlySt = [];
    for (const p of sfc.products) {
      if (p.type === 'variation' || p.status === 'draft' || p.status === 'private') continue;
      yield;
      const oid = L.sfToSt.get(p.id);
      if (!oid) {
        const r = catalog.adStatus('sf', p, null, null);
        if (r.level !== 'banned') missing.push({ site: 'sf', id: p.id, name: p.name, sku: p.sku, price: p.price, img: p.thumb || p.images[0] || '', url: p.url, why: r.level === 'google' ? 'Όχι στο feed του Google (διόπτρα/σκοπευτικό)' : '' });
        continue;
      }
      const o = stById.get(oid);
      if (!o || bannedSt.has(oid)) continue;
      const src = master === 'sf' ? p : o, dst = master === 'sf' ? o : p;
      if (!(src.price > 0) || !(dst.price > 0)) {
        if (src.price > 0 || dst.price > 0) zero.push({ site: master === 'sf' ? 'st' : 'sf', id: dst.id, name: p.name, sku: p.sku, img: p.thumb || p.images[0] || '', price: dst.price, url: dst.url, why: `${names.sf}: ${p.price > 0 ? U.money(p.price) : 'χωρίς τιμή'} · ${names.st}: ${o.price > 0 ? U.money(o.price) : 'χωρίς τιμή'}` });
        continue;
      }
      if (Math.abs(p.price - o.price) > 0.009 || Math.abs(p.regular - o.regular) > 0.009) {
        diff.push({ site: master === 'sf' ? 'st' : 'sf', id: dst.id, name: p.name, sku: p.sku, img: p.thumb || p.images[0] || '', price: dst.price, url: dst.url,
          why: `${names.sf}: ${U.money(p.price)} · ${names.st}: ${U.money(o.price)}`, fix: { regular: src.regular, sale: src.sale }, sfPrice: p.price, stPrice: o.price, srcId: src.id, type: dst.type });
      }
    }
    for (const p of stc.products) {
      if (p.type === 'variation' || p.status === 'draft' || bannedSt.has(p.id)) continue;
      if (!L.stToSf.has(p.id)) onlySt.push({ site: 'st', id: p.id, name: p.name, sku: p.sku, price: p.price, img: p.thumb || p.images[0] || '', url: p.url });
    }
    if (s.priceSync !== 'info') add({ id: 'x-price', site: master === 'sf' ? 'st' : 'sf', severity: 'high', title: 'Διαφορετική τιμή στα δύο sites', help: `Σωστή είναι η τιμή του ${names[master]}. Το αρχείο διορθώνει το άλλο site (και τα μεγέθη των μεταβλητών προϊόντων).`, items: diff, fix: { kind: 'price', label: 'Αρχείο ενημέρωσης τιμών' } });
    else add({ id: 'x-price', site: master === 'sf' ? 'st' : 'sf', severity: 'info', title: 'Διαφορετική τιμή στα δύο sites', help: 'Οι τιμές διαφέρουν σκόπιμα (Ρυθμίσεις).', items: diff });
    add({ id: 'x-price-zero', site: master === 'sf' ? 'st' : 'sf', severity: 'high', title: 'Χωρίς τιμή στο ένα από τα δύο sites', help: 'Δεν φτιάχνεται αρχείο: μια μηδενική τιμή δεν αντιγράφεται ποτέ. Βάλε τιμή με το χέρι.', items: zero });
    add({ id: 'x-missing', site: 'sf', severity: 'medium', title: 'Λείπουν από το ' + names.st, help: `Υπάρχουν στο ${names.sf} αλλά όχι στο ${names.st}. Όσα απαγορεύονται στις διαφημίσεις εξαιρούνται αυτόματα.`, items: missing, fix: { kind: 'transfer', label: 'Αρχείο μεταφοράς στο ' + names.st } });
    add({ id: 'x-onlyst', site: 'st', severity: 'low', title: 'Υπάρχουν μόνο στο ' + names.st, help: 'Ίσως λείπουν από το κεντρικό site ή έχουν άλλο όνομα/κωδικό.', items: onlySt });
  }

  return { checks, at: U.nowIso() };
}

// ---------- One combined title correction (for the fixes waiting for approval) ----------
/** What the title checks need, built once for many titles. */
function titleContext(site) {
  const brands = new Set([...catalog.knownBrands().keys()].map((k) => k.replace(/[^A-Z0-9]/g, '')));
  const { freq, latin } = wordStats();
  const latinCommon = new Set([...latin].filter(([, n]) => n >= 3).map(([w]) => w));
  for (const b of brands) latinCommon.add(b);
  return { latinCommon, dict: spell.dict(), freq, suggestType: typeSuggester(site), memo: new Map(), codes: catalogCodes(), brands, titleTok: titleTokens() };
}
/** In how many of our titles each code-like word stands (XQ35 in 3 titles, 223REM in 3: the name of a model, a calibre). */
let tokMemo = null;
function titleTokens() {
  const lists = catalog.SITES.map((s) => catalog.load(s).products);
  if (tokMemo && tokMemo.lists.every((l, i) => l === lists[i])) return tokMemo.map;
  const map = new Map();
  for (const l of lists) for (const p of l) {
    if (p.type === 'variation') continue;
    for (const w of new Set(String(p.name || '').split(/\s+/).map((x) => U.normSku(x)).filter((k) => k.length >= 3 && /\d/.test(k)))) map.set(w, (map.get(w) || 0) + 1);
  }
  tokMemo = { lists, map };
  return map;
}
// the codes of the catalog (products and variations of both sites, and their bases: K05068 of «K05068-54»): a word of a
// title that is one of them is a code, not a word of the title
let codesMemo = null;
function catalogCodes() {
  const lists = catalog.SITES.map((s) => catalog.load(s).products);
  if (codesMemo && codesMemo.lists.every((l, i) => l === lists[i])) return codesMemo.set;
  const set = new Set();
  for (const l of lists) for (const p of l) {
    const k = U.normSku(p.sku || '');
    if (k.length >= 4 && /\d/.test(k)) set.add(k);
    const base = U.normSku(String(p.sku || '').split(/[-_/ ]/)[0]);
    if (base.length >= 5 && /[A-Z]/.test(base) && /\d{3}/.test(base)) set.add(base);
  }
  codesMemo = { lists, set };
  return set;
}
/** The words of a title that are codes (its own SKU, the base of it, a code of the catalog) — not the model's only name. */
function codesInTitle(name, p, ctx) {
  const own = U.normSku(p.sku || ''), ownBase = U.normSku(String(p.sku || '').split(/[-_/ ]/)[0]);
  const words = String(name || '').split(/\s+/);
  // a quantity or unit (32GR, 9X19, 1200, 550ML) is not a code; a long bare number of the catalog is
  const isUnit = (w) => /^\d+([.,]\d+)?(MM|CM|M|ML|L|LT|GR|G|KG|W|V|MAH|LM|LUMENS|ΤΜΧ|ΓΡ)$/i.test(w) || /^\d+X\d+$/i.test(w) || /^\d{1,4}$/.test(w);
  // the product's own code written as a model name (MH40PRO, SR51): letters and digits only, short — it is the model
  const modelLike = (w) => /^[A-Z0-9]{3,10}$/.test(w) && /[A-Z]/.test(w) && /\d/.test(w) && !/^[A-Z]\d{5,}$/.test(w); // (K13075, D19041: a maker's item number, not a model name)
  const out = [];
  for (const w0 of words) {
    const w = w0.replace(/^[([]+|[)\],.;:]+$/g, '');
    const k = U.normSku(w);
    if (k.length < 4 || !/\d/.test(k) || isUnit(w)) continue;
    if (own && k === own && modelLike(w.toUpperCase())) continue;
    // (…or a maker's item number by its shape — K05068, D19041: one or two letters and five digits or more — even when no
    // product of ours has it as its code; seen 24/11: «PANTS K05068» stayed in the title, the code was not in the catalog)
    const itemNo = /^[A-Z]{1,2}\d{5,}$/.test(w.toUpperCase());
    // (the code of ANOTHER product that stands in 2+ of our titles is the name of a model / a calibre, not a code:
    // XQ35 of «… KRYPTON 2 XQ35» is the code of «PULSAR TELOS LRF XQ35» only — seen 24/11, removed at 98%)
    const inTitles = (ctx && ctx.titleTok && ctx.titleTok.get(k)) || 0;
    const other = ctx && ctx.codes && ctx.codes.has(k) && k !== own && inTitles < 2;
    const hit = (own && k === own) || (ownBase.length >= 5 && k === ownBase && !modelLike(w.toUpperCase())) || other || (itemNo && inTitles < 2);
    if (hit) out.push(w0);
  }
  if (!out.length) return [];
  // what stays must still name the model: a Latin word that is not the brand, beside the codes taken out
  const brand = U.foldKey(p.brand || '').replace(/[^A-Z0-9]/g, '');
  const rest = words.filter((w) => !out.includes(w) && /[A-Z]{2}/.test(U.foldKey(w)) && !/[Ͱ-Ͽ]/.test(w) && U.foldKey(w).replace(/[^A-Z0-9]/g, '') !== brand && !(ctx && ctx.brands && ctx.brands.has(U.foldKey(w).replace(/[^A-Z0-9]/g, ''))));
  return rest.length ? out : [];
}
/**
 * Every title rule of the checks, one after the other, on one title → { fix, steps:[{ kind, why, level }] }.
 * level high = mechanical (spaces, capitals, accents, letters of the wrong alphabet); medium = needs a look
 * (Greek words typed in Latin, spelling, type word first).
 */
function titleFix(p, ctx) {
  const steps = [];
  let t = String(p.name || '');
  const rep = U.repairEntities(t);
  if (rep) { t = rep; steps.push({ kind: 'broken', why: 'Σπασμένοι χαρακτήρες: χάθηκε ένα «&» ή άλλο σύμβολο όταν γράφτηκε ο τίτλος στο site', level: 'high' }); }
  const sp = U.collapse(t.replace(/\u200b/g, ''));
  if (sp !== t) steps.push({ kind: 'spaces', why: 'Διπλά ή κρυφά κενά', level: 'high' });
  t = sp;
  // no code in a title (rule of the shop): K05068 of «ΠΑΝΤΕΛΟΝΙ PENTAGON BDU ARCTIC PANTS K05068» goes; the model's only
  // name stays (MH40PRO of «ΦΑΚΟΣ NITECORE MH40PRO» is the model, even if it is also the code)
  const codes = codesInTitle(t, p, ctx);
  if (codes.length) {
    t = U.collapse(t.split(/\s+/).filter((w) => !codes.includes(w)).join(' ').replace(/\(\s*\)|\[\s*\]/g, ''));
    steps.push({ kind: 'code', why: `Κωδικός μέσα στον τίτλο (${codes.join(', ')}): ο κωδικός μένει στο πεδίο κωδικού, όχι στον τίτλο`, level: codes.every((w) => [U.normSku(p.sku || ''), U.normSku(String(p.sku || '').split(/[-_/ ]/)[0])].includes(U.normSku(w))) ? 'high' : 'medium' });
  }
  const fm = U.fixMixedScript(t, ctx.latinCommon, ctx.dict, ctx.freq);
  if (fm.changed) { t = fm.text; steps.push({ kind: 'mixed', why: 'Ελληνικά και λατινικά γράμματα μαζί (ο πελάτης δεν το βρίσκει στην αναζήτηση)', level: 'high' }); }
  for (const x of fm.suspects) { t = t.split(x.word).join(x.fix); steps.push({ kind: 'suspect', why: `«${x.word}» → «${x.fix}» (ελληνική λέξη με λατινικά)`, level: 'medium' }); }
  const caps = U.capsTitle(t);
  if (caps !== t) { steps.push(U.hasLowercase(t) ? { kind: 'caps', why: 'Κεφαλαία, όπως όλοι οι τίτλοι', level: 'high' } : { kind: 'accents', why: 'Χωρίς τόνους στα κεφαλαία', level: 'high' }); t = caps; }
  const fixes = [];
  for (const w of new Set(t.split(/[^\u0370-\u03ffA-Z]+/))) {
    if (!w) continue;
    let r = ctx.memo.get(w);
    if (r === undefined) { r = spell.check(w, ctx.freq); ctx.memo.set(w, r); }
    if (r) fixes.push([w, r.fix]);
  }
  if (fixes.length) {
    t = t.split(' ').map((tok) => tok.replace(/[\u0370-\u03ff]+/g, (m) => { const hit = fixes.find(([a]) => a === m); return hit ? hit[1] : m; })).join(' ');
    steps.push({ kind: 'typo', why: 'Ορθογραφία: ' + fixes.map(([a, b]) => `${a} → ${b}`).join(', '), level: 'medium' });
  }
  if (kinds.startsWithoutKind(t)) {
    const sug = ctx.suggestType(Object.assign({}, p, { name: t }));
    // a trade name of one kind only (12ΒΟΛΑ → ΦΥΣΙΓΓΙΑ) or the kind already in the title: a rule, sure
    if (sug.fix) { t = U.capsTitle(sug.fix); steps.push({ kind: 'typefirst', why: sug.why + ' (πρότυπο ΕΙΔΟΣ ΜΑΡΚΑ ΜΟΝΤΕΛΟ)', level: sug.how === 'compound' || sug.how === 'title' ? 'high' : 'medium', how: sug.how }); }
  }
  // the shop's own word for the kind (lib/knowledge.js — owner 24/11: «ΔΙΑΚΡΙΤΙΚΟ», never «ΣΗΜΑ»; ΣΗΜΑΙΑ is another word)
  const first = t.split(' ')[0] || '';
  const pref = require('./knowledge').terms().preferred.get(kinds.words(first)[0] || '');
  if (pref) {
    t = pref.to + t.slice(first.length);
    // (a kind just put first by these rules: sure; an existing title renamed: for a look — 89 titles start «ΣΗΜΑ» today)
    steps.push({ kind: 'term', why: `Λέξη του καταστήματος: «${pref.to}», όχι «${first}» (${pref.source})`, level: steps.some((x) => x.kind === 'typefirst') ? 'high' : 'medium' });
  }
  return { fix: U.collapse(t), steps };
}

// ---------- results: the heavy raw list, and the "ignore" marks laid over it ----------
let rawMemo = null;     // { checks, at } — every item, before the "ignore" marks
let dirty = false;      // the data changed: build again
let lazy = false;       // server: keep answering from the last result while the new one is built in the background
let onDirty = null;
let filtered = null;
function setLazy(on, fn) { lazy = !!on; onDirty = fn || null; }
function invalidate() { dirty = true; if (onDirty) onDirty('checks'); }
function isDirty() { return dirty || !rawMemo; }
function raw() {
  if (rawMemo && (!dirty || lazy)) return rawMemo;
  dirty = false;
  rawMemo = bg.drainSync(runGen());
  return rawMemo;
}
/** Build again in slices (the program keeps answering); the old result is used until the new one is whole. */
async function rebuild() {
  dirty = false;
  const r = await bg.drain(runGen());
  rawMemo = r;
  return r;
}
function setRaw(r) { if (r && Array.isArray(r.checks)) { rawMemo = r; filtered = null; } }
/** What the screens use: the raw list without the ignored items, the most serious first. */
function cached(force) {
  if (force && !lazy) dirty = true;
  const R = raw();
  const iv = store.ver('ignored');
  if (filtered && filtered.R === R && filtered.iv === iv) return filtered.out;
  const ign = ignored();
  const checks = [];
  for (const c0 of R.checks) {
    const skip = ign[c0.id] && ign[c0.id].length ? new Set(ign[c0.id]) : null;
    const items = skip ? c0.items.filter((i) => !skip.has(i.site + ':' + i.id)) : c0.items;
    checks.push(Object.assign({}, c0, { items, ignoredCount: c0.items.length - items.length }));
  }
  checks.sort((a, b) => SEV[a.severity] - SEV[b.severity] || b.items.length - a.items.length);
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const c of checks) counts[c.severity] += c.items.length;
  filtered = { R, iv, out: { checks, counts, at: R.at } };
  return filtered.out;
}
/** A fresh result now (tests, "check again"). */
function run() { dirty = true; const was = lazy; lazy = false; try { return cached(); } finally { lazy = was; } }

/** Build the fix file for a check (optionally only some product ids). */
function fixFile(checkId, ids, overrides) {
  const wx = require('./wooexport');
  const res = cached();
  const c = res.checks.find((x) => x.id === checkId);
  if (!c || !c.fix) throw new Error('Αυτός ο έλεγχος δεν έχει αρχείο διόρθωσης.');
  const want = ids && ids.length ? new Set(ids.map(Number)) : null;
  const items = c.items.filter((i) => !want || want.has(i.id));
  if (!items.length) throw new Error('Δεν επιλέχθηκαν προϊόντα.');
  const site = c.site;
  if (c.fix.kind === 'name') {
    const ov = overrides || {};
    const rows = items.map((i) => ({ ID: i.id, Name: U.collapse(ov[i.id] || (typeof i.fix === 'string' ? i.fix : '')) })).filter((r) => r.Name && r.Name !== (items.find((i) => i.id === r.ID) || {}).name);
    if (!rows.length) throw new Error('Δεν υπάρχει διόρθωση για τα επιλεγμένα.');
    return { site, csv: wx.updateFile(rows, ['Name']), count: rows.length, name: `diorthosi-titlon-${site}.csv` };
  }
  if (c.fix.kind === 'unpublish') {
    const rows = items.map((i) => ({ ID: i.id, Published: -1 }));
    return { site, csv: wx.updateFile(rows, ['Published']), count: rows.length, name: `proxeira-${site}.csv` };
  }
  if (c.fix.kind === 'hidegoogle') {
    // "Google for WooCommerce" keeps the choice in this field; other feed plugins ignore it harmlessly.
    const rows = items.map((i) => ({ ID: i.id, 'Meta: _wc_gla_visibility': 'dont-sync-and-show' }));
    return { site, csv: wx.updateFile(rows, ['Meta: _wc_gla_visibility']), count: rows.length, name: `apokrypsi-google-${site}.csv`, note: 'Ισχύει για το πρόσθετο «Google for WooCommerce». Αν το feed γίνεται με άλλο πρόσθετο, εξαίρεσε αυτά τα προϊόντα από τις ρυθμίσεις του (η λίστα για Excel έχει τα ID).' };
  }
  if (c.fix.kind === 'price') {
    const s = settings.all();
    const master = s.master === 'st' ? 'st' : 'sf';
    const src = catalog.load(master), dst = catalog.load(site);
    const rows = [];
    for (const i of items) {
      const d = dst.products.find((p) => p.id === i.id);
      if (!d) continue;
      if (d.type === 'variable') {
        const sv = src.products.filter((p) => p.type === 'variation' && p.parent === i.srcId);
        const dv = dst.products.filter((p) => p.type === 'variation' && p.parent === d.id);
        for (const v of dv) {
          const m = sv.find((x) => (x.sku && v.sku && U.normSku(x.sku) === U.normSku(v.sku)) || U.foldKey(x.varLabel) === U.foldKey(v.varLabel));
          if (m && m.regular > 0) rows.push({ ID: v.id, 'Regular price': m.regular.toFixed(2), 'Sale price': m.sale ? m.sale.toFixed(2) : '' });
        }
      } else if (Number(i.fix.regular) > 0) {
        rows.push({ ID: d.id, 'Regular price': Number(i.fix.regular).toFixed(2), 'Sale price': i.fix.sale ? Number(i.fix.sale).toFixed(2) : '' });
      }
    }
    if (!rows.length) throw new Error('Δεν βρέθηκαν τιμές για ενημέρωση.');
    return { site, csv: wx.updateFile(rows, ['Regular price', 'Sale price']), count: rows.length, name: `times-${site}.csv` };
  }
  if (c.fix.kind === 'transfer') {
    const r = wx.transfer('sf', 'st', items.map((i) => i.id));
    return { site: 'st', csv: r.csv, count: r.products, skipped: r.skipped, newCategories: r.newCategories, name: 'metafora-sto-st.csv' };
  }
  throw new Error('Άγνωστη διόρθωση.');
}

function get(checkId) {
  const c = cached().checks.find((x) => x.id === checkId);
  if (!c) throw new Error('Δεν βρέθηκε ο έλεγχος.');
  return c;
}
function ignoredItems(checkId) {
  const keys = ignored()[checkId] || [];
  return keys.map((k) => { const [site, id] = k.split(':'); const p = catalog.load(site).products.find((x) => x.id === Number(id)); return p ? { site, id: p.id, name: p.name, sku: p.sku } : { site, id: Number(id), name: '(δεν υπάρχει πια)' }; });
}

module.exports = { codesInTitle, catalogCodes, warmWords, setWords, wordsForSave, run, raw, rebuild, setRaw, setLazy, isDirty, cached, invalidate, fixFile, get, setIgnored, ignoredItems, wordStats, titleContext, titleFix, typeSuggester, ignored };
