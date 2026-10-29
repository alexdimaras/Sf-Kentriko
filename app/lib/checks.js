'use strict';
// Catalog health checks for both shops. Each check lists products and, where possible,
// produces a ready WooCommerce update file that fixes them. Items can be marked "ignore".
const settings = require('./settings');
const catalog = require('./catalog');
const store = require('./store');
const adrules = require('./adrules');
const spell = require('./spell');
const U = require('./util');

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
  invalidate();
}

/** How often each word appears in the titles of both shops (Greek and Latin). */
function wordStats() {
  const freq = new Map(), latin = new Map();
  const seen = new Set();
  for (const site of catalog.SITES) {
    for (const p of catalog.load(site).products) {
      if (p.type === 'variation') continue;
      // the same product on both shops counts once; titles and descriptions both count
      const key = U.foldKey(p.name);
      const dup = seen.has(key); seen.add(key);
      if (dup) continue;
      const text = p.name + ' ' + U.stripTags(String(p.short || '') + ' ' + String(p.desc || '')).slice(0, 4000);
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
  const types = new Set(catalog.learnedTypes().nouns || []);
  return (p) => {
    const words = U.greekUpper(p.name).split(' ');
    // a type word later in the title: move it to the front (5.11 TACTICAL ΣΑΚΙΔΙΟ → ΣΑΚΙΔΙΟ 5.11 TACTICAL)
    const inside = words.findIndex((w, i) => i > 0 && types.has(w));
    if (inside > 0) return { fix: [words[inside]].concat(words.slice(0, inside), words.slice(inside + 1)).join(' '), why: `Το είδος «${words[inside]}» να πάει πρώτο` };
    // most common type of the product's deepest category
    let best = '', bn = 0;
    for (const id of p.cats) {
      const m = byCat.get(id);
      if (!m) continue;
      let tot = 0; for (const n of m.values()) tot += n;
      for (const [w, n] of m) if (n > bn && n / tot >= 0.5) { bn = n; best = w; }
    }
    if (!best) {
      const votes = new Map();
      for (const w of words) { const l = learned[w.replace(/[^A-Z]/g, '')]; if (l) votes.set(l.type, (votes.get(l.type) || 0) + l.share); }
      for (const [t, v] of votes) if (v > bn) { bn = v; best = t; }
    }
    return best ? { fix: best + ' ' + U.collapse(p.name), why: `Πρόταση: «${best}» πρώτο (από παρόμοια προϊόντα)` } : { fix: '', why: 'Δεν βρέθηκε πρόταση — γράψε το είδος μπροστά' };
  };
}

function run() {
  const s = settings.all();
  const names = { sf: s.sites.sf.name, st: s.sites.st.name };
  const checks = [];
  const L = catalog.links();
  const brands = new Set([...catalog.knownBrands().keys()].map((k) => k.replace(/[^A-Z0-9]/g, '')));
  const ign = ignored();
  const { freq, latin } = wordStats();
  const dict = spell.dict();
  const latinCommon = new Set([...latin].filter(([, n]) => n >= 3).map(([w]) => w));
  for (const b of brands) latinCommon.add(b);
  const add = (c) => {
    const skip = new Set(ign[c.id] || []);
    const before = c.items.length;
    if (skip.size) c.items = c.items.filter((i) => !skip.has(i.site + ':' + i.id));
    c.ignoredCount = before - c.items.length;
    if (c.items.length || c.ignoredCount) checks.push(c);
  };

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
    const mixed = [], suspect = [], caps = [], accents = [], spaces = [], long = [], typos = [], typeFirst = [];
    const suggestType = typeSuggester(site);
    for (const p of main) {
      const name = p.name;
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
      // type first
      const first = U.greekUpper(name).split(' ')[0] || '';
      if (first && !/[Ͱ-Ͽ]/.test(first) && /[Ͱ-Ͽ]/.test(U.greekUpper(name)) === true) {
        const sug = suggestType(p);
        typeFirst.push(item(p, { why: sug.why, fix: sug.fix }));
      } else if (first && !/[Ͱ-Ͽ]/.test(first)) {
        const sug = suggestType(p);
        typeFirst.push(item(p, { why: sug.why, fix: sug.fix }));
      }
    }
    const nameFix = { kind: 'name', label: 'Αρχείο διόρθωσης τίτλων' };
    add({ id: site + '-mixed', site, severity: 'high', title: 'Τίτλοι με ελληνικά και λατινικά γράμματα μαζί', help: 'Π.χ. «ΔΙXΤΥ» με λατινικό X ή «ΣΟΥΓΙAΣ» με λατινικό A. Ο πελάτης που ψάχνει τη λέξη δεν βρίσκει το προϊόν, ούτε στο site ούτε στο Google.', items: mixed, fix: nameFix });
    add({ id: site + '-typos', site, severity: 'medium', title: 'Πιθανά ορθογραφικά λάθη στον τίτλο', help: 'Λέξεις που δεν υπάρχουν αλλού στον κατάλογο και μοιάζουν με γνωστή λέξη (π.χ. ΠΙΙΣΤΟΛΙ → ΠΙΣΤΟΛΙ). Έλεγξε πριν το ανεβάσεις.', items: typos, fix: nameFix });
    add({ id: site + '-suspect', site, severity: 'medium', title: 'Ελληνικές λέξεις γραμμένες με λατινικά', help: 'Π.χ. «KONTAKIA» αντί «ΚΟΝΤΑΚΙΑ». Εμφανίζονται μόνο λέξεις που υπάρχουν στα ελληνικά κείμενα του καταστήματος.', items: suspect, fix: nameFix });
    add({ id: site + '-typefirst', site, severity: 'medium', title: 'Ο τίτλος δεν ξεκινά με το είδος', help: 'Το πρότυπο είναι ΕΙΔΟΣ ΜΑΡΚΑ ΜΟΝΤΕΛΟ. Ο πελάτης ψάχνει «σακίδιο», όχι μόνο τη μάρκα. Η πρόταση βγαίνει από παρόμοια προϊόντα — έλεγξέ την.', items: typeFirst, fix: nameFix });
    add({ id: site + '-caps', site, severity: 'low', title: 'Τίτλοι με μικρά γράμματα', help: 'Το πρότυπο είναι όλα κεφαλαία χωρίς τόνους. Κωδικοί και μονάδες με αριθμούς (9x19, 400g) μένουν όπως είναι.', items: caps, fix: nameFix });
    add({ id: site + '-accents', site, severity: 'low', title: 'Κεφαλαία με τόνους', help: 'Στα κεφαλαία δεν μπαίνουν τόνοι.', items: accents, fix: nameFix });
    add({ id: site + '-spaces', site, severity: 'low', title: 'Διπλά ή κρυφά κενά στον τίτλο', help: '', items: spaces, fix: nameFix });
    add({ id: site + '-long', site, severity: 'info', title: 'Πολύ μεγάλοι τίτλοι', help: 'Το Google κόβει τους τίτλους μετά τους ~70 χαρακτήρες.', items: long });

    // Duplicates (variations of one product may share codes; only whole products count)
    const byTitle = new Map(), bySku = new Map();
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

  checks.sort((a, b) => SEV[a.severity] - SEV[b.severity] || b.items.length - a.items.length);
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const c of checks) counts[c.severity] += c.items.length;
  return { checks, counts, at: U.nowIso() };
}

// ---------- One combined title correction (for the fixes waiting for approval) ----------
/** What the title checks need, built once for many titles. */
function titleContext(site) {
  const brands = new Set([...catalog.knownBrands().keys()].map((k) => k.replace(/[^A-Z0-9]/g, '')));
  const { freq, latin } = wordStats();
  const latinCommon = new Set([...latin].filter(([, n]) => n >= 3).map(([w]) => w));
  for (const b of brands) latinCommon.add(b);
  return { latinCommon, dict: spell.dict(), freq, suggestType: typeSuggester(site), memo: new Map() };
}
/**
 * Every title rule of the checks, one after the other, on one title → { fix, steps:[{ kind, why, level }] }.
 * level high = mechanical (spaces, capitals, accents, letters of the wrong alphabet); medium = needs a look
 * (Greek words typed in Latin, spelling, type word first).
 */
function titleFix(p, ctx) {
  const steps = [];
  let t = String(p.name || '');
  const sp = U.collapse(t.replace(/\u200b/g, ''));
  if (sp !== t) steps.push({ kind: 'spaces', why: 'Διπλά ή κρυφά κενά', level: 'high' });
  t = sp;
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
  const first = U.greekUpper(t).split(' ')[0] || '';
  if (first && !/[\u0370-\u03ff]/.test(first)) {
    const sug = ctx.suggestType(Object.assign({}, p, { name: t }));
    if (sug.fix) { t = U.capsTitle(sug.fix); steps.push({ kind: 'typefirst', why: sug.why + ' (πρότυπο ΕΙΔΟΣ ΜΑΡΚΑ ΜΟΝΤΕΛΟ)', level: 'medium' }); }
  }
  return { fix: U.collapse(t), steps };
}

let last = null;
function cached(force) { if (!last || force) last = run(); return last; }
function invalidate() { last = null; }

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

module.exports = { run, cached, invalidate, fixFile, get, setIgnored, ignoredItems, wordStats, titleContext, titleFix, typeSuggester, ignored };
