'use strict';
// SF Κέντρο — the quality report of one product: one page that ties together «what this product needs» (the work
// flow), the research on the internet, the SEO of its page and the proposals waiting for a yes.
//
// Fast: it reads only what is already here (the product, its variations, the last saved research, the last SEO check,
// the price research, the proposals). It never starts a search or reads a page by itself — when the research is old
// or something important is missing it says so, and the person starts the full research with one button.
// It changes nothing: every finding that can be fixed is a proposal in Διορθώσεις (before / after, why, source,
// confidence) waiting for a person's yes.
//
// Three states are kept apart (never mixed): the work flow («Βήμα 5: Έτοιμο»), the internet research, the SEO check.

const store = require('./store');
const U = require('./util');

const SEO_KEY = 'seo-audits';      // { 'site:id': { at, url, counts: { crit, warn, ok, info }, findings: [...] } }
const SEO_DAYS = 30;               // an SEO check older than this is «old»
const RESEARCH_DAYS = 60;          // (as codefind's STALE_DAYS)

const days = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 864e5 : Infinity);
const plain = (html) => U.collapse(U.stripTags(String(html || '')));

/** A value of a proposal as words (a title, «3 φωτογραφίες», «60 → —» for the codes of the sizes…). */
function show(c, v) {
  if (v == null || v === '') return '';
  if (typeof v === 'string') return (c.field === 'desc' || c.field === 'short' ? plain(v) : v).slice(0, 300);
  if (typeof v === 'number') return c.field === 'published' && v < 0 ? 'Πρόχειρο' : String(v);
  if (Array.isArray(v)) {
    if (c.field === 'images') return v.length + ' φωτογραφίες';
    return v.slice(0, 8).map((x) => (x && typeof x === 'object' ? `${x.label || ''} → ${x.sku || '(ο κωδικός του προϊόντος)'}` : String(x))).join(' · ') + (v.length > 8 ? ` · και ${v.length - 8} ακόμα` : '');
  }
  if (c.field === 'desc') return 'νέα περιγραφή: ' + plain(v.html || '').slice(0, 160) + '…';
  if (c.field === 'cats') return v.path || '';
  return '';
}
/** Keep the last SEO check of a product (the report reads it; the check itself runs only when asked). */
function saveSeo(site, id, r) {
  if (!r || !Array.isArray(r.findings)) return;
  const counts = { crit: 0, warn: 0, ok: 0, info: 0 };
  for (const f of r.findings) counts[f.level] = (counts[f.level] || 0) + 1;
  store.update(SEO_KEY, {}, (d) => {
    d[site + ':' + id] = { at: r.checkedAt || U.nowIso(), url: String(r.url || '').slice(0, 300), counts, findings: r.findings.slice(0, 40).map((f) => ({ level: f.level, area: String(f.area || '').slice(0, 40), text: String(f.text || '').slice(0, 300), fix: String(f.fix || '').slice(0, 300) })) };
    // a bounded file: the 3.000 last checks
    const keys = Object.keys(d);
    if (keys.length > 3000) keys.sort((a, b) => String(d[a].at).localeCompare(String(d[b].at))).slice(0, keys.length - 3000).forEach((k) => delete d[k]);
    return d;
  });
}
function seoOf(site, id) { return (store.read(SEO_KEY, null) || {})[site + ':' + id] || null; }

// duplicates of descriptions / codes across the catalog: built once per catalog load
let dupMemo = null;
function dupIndex(site) {
  const catalog = require('./catalog');
  const list = catalog.load(site).products;
  if (dupMemo && dupMemo.list === list) return dupMemo;
  const desc = new Map(), sku = new Map(), ean = new Map();
  const bump = (m, k) => { if (k) m.set(k, (m.get(k) || 0) + 1); };
  for (const p of list) {
    if (p.status === 'private') continue;
    // (the length and the start of the text are kept beside the compressed text: no text is opened for this)
    if ((p.descLen || 0) >= 120 && p.type !== 'variation') bump(desc, p.descLen + '|' + U.foldKey(p.descHead || ''));
    bump(sku, U.normSku(p.sku || ''));
    bump(ean, String(p.ean || '').replace(/\D/g, ''));
  }
  dupMemo = { list, desc, sku, ean };
  return dupMemo;
}

/**
 * The report → { at, site, id, name, statuses: { flow, research, seo }, areas: [{ area, level, text, fix, field, fixes }],
 *   counts, needsResearch, proposals }
 *   level: crit (must be fixed) · warn (should) · info (good to know / uncertain) · ok
 */
function report(site, id) {
  const catalog = require('./catalog');
  const market = require('./market');
  const cf = require('./codefind');
  const p = catalog.byId(site).get(Number(id));
  if (!p) throw new Error('Δεν βρέθηκε το προϊόν.');
  const vars = catalog.load(site).products.filter((x) => x.type === 'variation' && x.parent === p.id);
  const key = site + ':' + p.id;
  const areas = [];
  const add = (area, level, text, fix, field) => areas.push({ area, level, text, fix: fix || '', field: field || '', fixes: [] });

  // ---- the proposals already waiting (they are where every fix goes) ----
  let pending = [], approved = [];
  try { const mine = require('./fixes').compute().items.filter((c) => c.site === site && c.pid === p.id); pending = mine.filter((c) => c.status === 'pending'); approved = mine.filter((c) => c.status === 'approved'); } catch (_) { pending = []; }

  // ---- title ----
  const name = U.collapse(p.name || '');
  if (name !== name.toUpperCase()) add('Τίτλος', 'warn', 'Ο τίτλος δεν είναι όλος κεφαλαία.', 'Κανόνας του καταστήματος: μόνο κεφαλαία (ΕΙΔΟΣ ΜΑΡΚΑ ΜΟΝΤΕΛΟ [ΧΡΩΜΑ]).', 'name');
  if (p.sku && U.normSku(p.sku).length >= 4 && U.normSku(name).includes(U.normSku(p.sku))) add('Τίτλος', 'warn', `Ο τίτλος γράφει τον κωδικό (${p.sku}).`, 'Κανένας κωδικός στον τίτλο: ο κωδικός μένει στο πεδίο SKU.', 'name');
  if (p.brand && !U.foldKey(name).replace(/[^A-Z0-9Α-Ω]/g, '').includes(U.foldKey(p.brand).replace(/[^A-Z0-9Α-Ω]/g, ''))) add('Τίτλος', 'warn', `Η μάρκα (${p.brand}) δεν φαίνεται στον τίτλο.`, 'ΕΙΔΟΣ ΜΑΡΚΑ ΜΟΝΤΕΛΟ.', 'name');
  const words = U.foldKey(name).split(/[^A-Z0-9Α-Ω]+/).filter((w) => w.length >= 3);
  const rep = words.find((w, i) => words.indexOf(w) !== i);
  if (rep) add('Τίτλος', 'warn', `Λέξη που επαναλαμβάνεται στον τίτλο («${rep}»).`, 'Χωρίς επαναλήψεις / keyword stuffing.', 'name');
  if (name.length > 90) add('Τίτλος', 'info', `Μεγάλος τίτλος (${name.length} χαρακτήρες).`, 'Το Google κόβει στους ~60–70 χαρακτήρες.', 'name');
  try {
    for (const c of require('./checks').cached().checks) {
      if (!c.items.some((i) => i.site === site && i.id === p.id)) continue;
      add(/τίτλ|ονομ/i.test(c.title) ? 'Τίτλος' : 'Έλεγχοι', c.severity === 'critical' ? 'crit' : c.severity === 'high' || c.severity === 'medium' ? 'warn' : 'info', c.title, c.hint || '', /τίτλ/i.test(c.title) ? 'name' : '');
    }
  } catch (_) { /* the checks are not ready yet */ }

  // ---- texts ----
  const desc = plain(p.desc), short = plain(p.short);
  if (!desc) add('Περιγραφή', 'crit', 'Δεν έχει περιγραφή.', 'Ελληνικό κείμενο από τα πραγματικά στοιχεία (Πρόταση AI ή προμηθευτής).', 'desc');
  else if (desc.length < 300) add('Περιγραφή', 'warn', `Μικρή περιγραφή (${desc.length} χαρακτήρες).`, 'Χρήσιμο κείμενο για τον πελάτη: χρήση, υλικά, μεγέθη — μόνο με πηγή.', 'desc');
  if (desc && (desc.match(/[Α-Ωα-ωάέήίόύώ]/g) || []).length < desc.length * 0.25) add('Περιγραφή', 'warn', 'Η περιγραφή είναι κυρίως σε άλλη γλώσσα.', 'Ελληνική περιγραφή (μετάφραση με το AI, έλεγχος από εσένα).', 'desc');
  const D = dupIndex(site);
  const dk = (p.descLen || 0) + '|' + U.foldKey(p.descHead || '');
  if ((p.descLen || 0) >= 120 && (D.desc.get(dk) || 0) > 1) add('Περιγραφή', 'warn', `Η ίδια περιγραφή υπάρχει σε ${D.desc.get(dk)} προϊόντα.`, 'Μοναδικό κείμενο ανά προϊόν (το Google δεν αγαπά τα αντίγραφα).', 'desc');
  if (!short) add('Σύντομη περιγραφή', 'warn', 'Δεν έχει σύντομη περιγραφή.', 'Σύνοψη 2–3 γραμμών: τι είναι, κύρια οφέλη.', 'short');

  // ---- brand / category / attributes ----
  if (!p.brand) add('Μάρκα / κατηγορία', 'warn', 'Χωρίς μάρκα.', 'Η μάρκα του κατασκευαστή (από προμηθευτή ή ≥2 καταστήματα).', 'brand');
  else if (p.brandSource === 'title') add('Μάρκα / κατηγορία', 'info', `Η μάρκα (${p.brand}) διαβάστηκε από τον τίτλο — δεν είναι καταχωρημένη στο προϊόν.`, 'Καταχώρισέ τη στο πεδίο μάρκας.', 'brand');
  if (!(p.cats || []).length || (p.catNames || []).some((c) => /^(uncategori[sz]ed|χωρίς κατηγορία)$/i.test(c))) add('Μάρκα / κατηγορία', 'warn', 'Χωρίς σωστή κατηγορία.', 'Κατηγορία και υποκατηγορία του είδους.', 'cats');
  if (!(p.attrs || []).length) add('Χαρακτηριστικά', 'info', 'Χωρίς χαρακτηριστικά (attributes).', 'Υλικό, βάρος, διαστάσεις… μόνο από πηγή (προμηθευτής / κατασκευαστής).', 'attrs');

  // ---- codes ----
  const sku = String(p.sku || '').trim();
  if (!sku) add('SKU / EAN', p.type === 'variable' ? 'warn' : 'crit', 'Χωρίς κωδικό (SKU).', 'Μόνο πραγματικός κωδικός: προμηθευτής ή ο ίδιος σε ≥2 ανεξάρτητα καταστήματα — ποτέ κατασκευασμένος.', 'sku');
  else if (U.junkSku(sku)) add('SKU / EAN', 'crit', `Ο κωδικός «${sku}» δεν είναι πραγματικός κωδικός (ώρα αντιγραφής στο τέλος, ή κείμενο γραμμένο στη θέση του κωδικού).`, 'Κανένα «καθάρισμα» του κωδικού: αντικατάσταση μόνο με κωδικό από προμηθευτή ή ≥2 καταστήματα.', 'sku');
  else if ((D.sku.get(U.normSku(sku)) || 0) > 1) add('SKU / EAN', 'crit', `Ο κωδικός ${sku} υπάρχει σε ${D.sku.get(U.normSku(sku))} προϊόντα.`, 'Ένας κωδικός = ένα προϊόν / παραλλαγή.', 'sku');
  // codes the internet research saw for this very product: one source = an uncertain finding to check by hand
  // (it may be the shop's own code, not the maker's); two independent sources go to Διορθώσεις as a proposal
  if (!sku || U.junkSku(sku)) {
    const by = new Map();
    for (const h of cf.hitsFor(key)) {
      const c = String(h.mpn || h.code || '').trim();
      if (!c || !/\d/.test(c) || U.junkSku(c) || market.gtinOf(c)) continue;
      const e = by.get(U.normSku(c)) || { code: c, sites: new Map() };
      if (!e.sites.has(U.siteOf(h.host))) e.sites.set(U.siteOf(h.host), h.url);
      by.set(U.normSku(c), e);
    }
    for (const e of [...by.values()].sort((a, b) => b.sites.size - a.sites.size).slice(0, 3)) {
      const src = [...e.sites].map(([site, url]) => site + ' (' + url + ')').join(' · ');
      add('SKU / EAN', 'warn', e.sites.size >= 2 ? `Ο κωδικός ${e.code} βρέθηκε σε ${e.sites.size} ανεξάρτητα καταστήματα: ${src}.` : `Αβέβαιο εύρημα: ο κωδικός ${e.code} βρέθηκε σε ένα μόνο κατάστημα — ${src}.`, e.sites.size >= 2 ? 'Η πρόταση είναι στις Διορθώσεις για έγκριση.' : 'Χρειάζεται χειροκίνητη επιβεβαίωση (κατασκευαστής / προμηθευτής ή δεύτερο κατάστημα) — δεν προτείνεται αλλαγή.', 'sku');
    }
  }
  const ean = String(p.ean || '').replace(/\D/g, '');
  if (ean && !market.gtinOf(ean)) add('SKU / EAN', 'crit', `Το EAN ${p.ean} δεν είναι έγκυρο (ψηφίο ελέγχου).`, 'EAN μόνο με σωστό ψηφίο ελέγχου και για την ίδια παραλλαγή.', 'ean');
  else if (ean && (D.ean.get(ean) || 0) > 1) add('SKU / EAN', 'crit', `Το EAN ${ean} υπάρχει σε ${D.ean.get(ean)} προϊόντα.`, 'Κάθε παραλλαγή έχει δικό της EAN.', 'ean');
  else if (!ean && p.type !== 'variable') add('SKU / EAN', 'info', 'Χωρίς EAN.', 'Το Google το θέλει όταν υπάρχει (από προμηθευτή ή ίδια παραλλαγή σε κατάστημα).', 'ean');

  // ---- photos ----
  const imgs = p.images || [];
  const keys = imgs.map((u) => market.imageKey(u) || u);
  if (!imgs.length) add('Φωτογραφίες', 'crit', 'Χωρίς φωτογραφία.', 'Φωτογραφία της ίδιας παραλλαγής (προμηθευτής / κατασκευαστής) — έλεγξε τα δικαιώματα χρήσης.', 'images');
  else if (imgs.length < 3) add('Φωτογραφίες', 'warn', `Μόνο ${imgs.length} φωτογραφία/ες.`, '3+ φωτογραφίες της ίδιας παραλλαγής.', 'images');
  if (new Set(keys).size < keys.length) add('Φωτογραφίες', 'warn', 'Η ίδια φωτογραφία υπάρχει δύο φορές.', 'Κράτα μία.', 'images');
  if (pending.some((c) => c.field === 'images')) add('Φωτογραφίες', 'info', 'Υπάρχουν προτεινόμενες φωτογραφίες από άλλα sites.', 'Η εύρεση σε άλλο κατάστημα δεν δίνει δικαίωμα χρήσης: προτίμησε προμηθευτή / κατασκευαστή ή ζήτα άδεια.', 'images');

  // ---- variations ----
  if (p.type === 'variable') {
    if (!vars.length) add('Παραλλαγές', 'crit', 'Μεταβλητό προϊόν χωρίς παραλλαγές.', 'Πρόσθεσε τις πραγματικές επιλογές (χρώμα / μέγεθος).', 'variations');
    const noPrice = vars.filter((v) => !(v.price > 0)).length, noSku = vars.filter((v) => !String(v.sku || '').trim() || U.junkSku(v.sku)).length;
    const labels = vars.map((v) => U.foldKey(v.varLabel || '')), dupL = labels.filter((l, i) => l && labels.indexOf(l) !== i).length;
    if (noPrice) add('Παραλλαγές', 'crit', `${noPrice} παραλλαγές χωρίς τιμή.`, 'Κάθε παραλλαγή με τη δική της τιμή.', 'variations');
    if (noSku) add('Παραλλαγές', 'info', `${noSku} παραλλαγές χωρίς πραγματικό κωδικό.`, 'Κωδικός παραλλαγής μόνο από απόδειξη (προμηθευτής ή ≥2 καταστήματα για την ίδια παραλλαγή) — ποτέ γονικός + επίθεμα.', 'variations');
    if (dupL) add('Παραλλαγές', 'warn', `${dupL} διπλές παραλλαγές (ίδια επιλογή).`, 'Μία παραλλαγή ανά επιλογή.', 'variations');
    const vImg = vars.filter((v) => (v.images || []).length).length;
    if (vars.length > 1 && !vImg) add('Παραλλαγές', 'info', 'Καμία παραλλαγή δεν έχει δική της φωτογραφία.', 'Φωτογραφία ανά χρώμα: ο πελάτης βλέπει αυτό που διαλέγει.', 'variations');
  }
  let fam = null;
  try { fam = require('./families').ofProduct(site, p.id); } catch (_) { fam = null; }
  if (fam) add('Παραλλαγές', fam.proof === 'confirmed' ? 'warn' : 'info', fam.proof === 'confirmed' ? `Ένα από ${fam.members.length} ξεχωριστά προϊόντα του ίδιου μοντέλου (${fam.colours.join(', ')}) — το επιβεβαιώνουν ${fam.proofSources.length} καταστήματα.` : `Πιθανή οικογένεια (${fam.colours.join(', ')}): δεν το επιβεβαιώνουν ακόμα 2 ανεξάρτητα καταστήματα — καμία πρόταση μετατροπής.`, fam.proof === 'confirmed' ? 'Προϊόντα → Οικογένειες: έγκριση και αρχεία μετατροπής.' : '«Έρευνα internet» στα μέλη της.', 'family');

  // ---- price / availability ----
  if (!(p.price > 0)) add('Τιμή / διαθεσιμότητα', p.type === 'variable' ? 'info' : 'crit', 'Χωρίς τιμή.', '', 'price');
  if (p.sale > 0 && p.regular > 0 && p.sale >= p.regular) add('Τιμή / διαθεσιμότητα', 'warn', 'Η τιμή προσφοράς δεν είναι μικρότερη από την κανονική.', '', 'price');
  const mr = market.resultFor(site, p.id);
  let mst = null;
  if (mr && Array.isArray(mr.competitors)) { try { mst = market.stats(mr.competitors, {}); } catch (_) { mst = null; } }
  if (!mr) add('Τιμή / διαθεσιμότητα', 'info', 'Δεν έχει γίνει έρευνα τιμών ανταγωνιστών.', 'Νέα έρευνα τιμών ανταγωνιστών (κουμπί πιο κάτω).', 'price');
  else if (mst && mst.count && p.price > 0) {
    const diff = Math.round(((p.price - mst.median) / mst.median) * 100);
    add('Τιμή / διαθεσιμότητα', Math.abs(diff) >= 15 ? 'warn' : 'ok', `Αγορά: ${mst.count} καταστήματα με απόθεμα, διάμεση ${mst.median.toFixed(2)} € (εμείς ${diff > 0 ? '+' : ''}${diff}%) · σιγουριά ${{ high: 'υψηλή', medium: 'μέτρια', low: 'χαμηλή' }[mst.confidence] || '—'}${mr.at ? ' · ' + new Date(mr.at).toLocaleDateString('el-GR') : ''}.`, mst.confidence === 'low' ? 'Μία μόνο τιμή: όχι αρκετή για αλλαγή τιμής.' : '', 'price');
  }
  if (p.inStock === false) add('Τιμή / διαθεσιμότητα', 'info', 'Εξαντλημένο στο site.', '', 'stock');

  // ---- the research on the internet (the last saved, never started from here) ----
  let tr = null;
  try { tr = cf.traceFor(key, { page: 1, per: 1 }); } catch (_) { tr = null; }
  const rs = tr ? tr.status : 'never';
  const rAt = tr ? tr.okAt || tr.at : null;
  const rStale = !tr || rs === 'never' || rs === 'stale' || rs === 'due' || days(rAt) > RESEARCH_DAYS;
  const critMissing = !sku || U.junkSku(sku) || !imgs.length || !p.brand;
  const research = { state: rs, label: cf.STATUS_LABEL[rs] || rs, at: tr ? tr.at : null, okAt: tr ? tr.okAt : null, stale: rStale, coverage: tr && tr.coverage ? tr.coverage.level : '', stop: tr ? tr.stopWord || '' : '',
    hits: tr ? (tr.hits || []).length : 0, family: tr ? (tr.family || []).length : 0, needsLeft: tr ? tr.needsLeft || [] : [], nextAt: tr ? tr.nextAt : null };
  if (tr && tr.quality && tr.quality.length) for (const q of tr.quality) add('Έρευνα internet', 'info', q, '', '');
  if (rs === 'coverage_limited') add('Έρευνα internet', 'warn', 'Η τελευταία έρευνα είχε περιορισμένη κάλυψη (λίγες μηχανές απάντησαν): το «δεν βρέθηκε» δεν είναι σίγουρο.', 'Ξαναδοκιμάζει μόνη της· ή «Πλήρης έρευνα Internet».', '');

  // ---- SEO (the last check, never run from here) ----
  const seo = seoOf(site, p.id);
  const seoState = !seo ? 'never' : days(seo.at) > SEO_DAYS ? 'stale' : seo.counts.crit ? 'crit' : seo.counts.warn ? 'warn' : 'ok';
  if (seo) for (const f of seo.findings.filter((x) => x.level === 'crit' || x.level === 'warn').slice(0, 8)) add('SEO', f.level, f.text, f.fix, 'seo');
  if (!seo) add('SEO', 'info', 'Δεν έχει γίνει έλεγχος SEO της σελίδας.', '«Έλεγχος SEO» (διαβάζει τη σελίδα όπως το Google).', 'seo');

  // ---- the work flow (its own state: «Βήμα 5: Έτοιμο» is the flow's, not the research's) ----
  let row = null;
  try { row = require('./flow').compute().rows.get(key); } catch (_) { row = null; }
  const STEP = ['', 'Κωδικός', 'Στοιχεία', 'Περιεχόμενο', 'Τιμή', 'Έτοιμο'];
  const stage = row ? row.stage : 5;
  const flow = { stage, label: 'Βήμα ' + Math.min(5, stage) + ': ' + STEP[Math.min(5, stage)], open: row ? row.problems.filter((x) => x.state !== 'done').length : 0 };

  // every area points to its waiting proposals (the fix is there, for a yes)
  const FIELD = { name: ['name'], desc: ['desc', 'description'], short: ['short'], brand: ['brand'], sku: ['sku'], ean: ['ean', 'gtin'], images: ['images'], variations: ['varsku', 'variations'], price: ['price', 'sale', 'regular'], cats: ['cats', 'categories'], attrs: ['attrs'] };
  for (const a of areas) { const fs = FIELD[a.field] || []; a.fixes = pending.filter((c) => fs.includes(c.field)).map((c) => c.id); }
  // (asked 24/11: «it says what is missing and gives no proposal — why?») — when nothing is proposed, said why and what brings it
  const NOFIX = {
    short: 'Δεν υπάρχει ακόμα πρόταση: η σύντομη περιγραφή φτιάχνεται από τα χαρακτηριστικά του αντιπροσώπου ή μιας σελίδας του ίδιου προϊόντος. Η έρευνα στο internet ξεκινά μόνη της όταν ανοίγεις το προϊόν· ή γράψ\' την εδώ.',
    desc: 'Δεν υπάρχει ακόμα πρόταση: χρειάζεται κείμενο από αντιπρόσωπο, το άλλο σας site ή σελίδα του ίδιου προϊόντος (η έρευνα ξεκινά μόνη της).',
    ean: 'Δεν βρέθηκε ακόμα EAN με απόδειξη (αντιπρόσωπος, ή 2 καταστήματα για την ίδια ακριβώς παραλλαγή). Η έρευνα ξεκινά μόνη της.',
    images: 'Δεν βρέθηκαν ακόμα φωτογραφίες του ίδιου προϊόντος (και του ίδιου χρώματος). Η έρευνα ξεκινά μόνη της.',
  };
  for (const a of areas) if (!a.fixes.length && a.level !== 'ok' && NOFIX[a.field]) a.fix = NOFIX[a.field];
  const ORDER = { crit: 0, warn: 1, info: 2, ok: 3 };
  areas.sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  const counts = { crit: 0, warn: 0, info: 0, ok: 0 };
  for (const a of areas) counts[a.level]++;
  return {
    at: U.nowIso(), site, id: p.id, name: p.name, sku: p.sku || '',
    current: { name: p.name, type: p.type, short: String(p.short || '').slice(0, 4000) },
    // approved changes waiting for the file of the site (Διορθώσεις → «Αρχείο»)
    approved: approved.map((c) => ({ id: c.id, label: c.label, to: show(c, c.edited !== undefined ? c.edited : c.to), manual: !!c.manual })),
    statuses: { flow, research, seo: { state: seoState, at: seo ? seo.at : null, counts: seo ? seo.counts : null } },
    areas, counts,
    // the full research is proposed (never started) when it is old / never done, or something important is missing
    needsResearch: rStale || (critMissing && !['complete', 'running', 'queued'].includes(rs)),
    // something the internet can give is missing (code, EAN, photos, text, brand) and the research is never done / due
    // again: it is queued by itself on opening, on the quick lane (asked 24/11: «automatic, with priority, fast»)
    autoResearch: ['never', 'due', 'stale'].includes(rs) && (!sku || !!U.junkSku(sku) || areas.some((a) => a.level !== 'ok' && ['sku', 'ean', 'images', 'desc', 'short', 'brand'].includes(a.field))),
    missing: areas.filter((a) => a.level !== 'ok' && a.level !== 'info' && ['sku', 'ean', 'images', 'desc', 'short', 'brand'].includes(a.field)).map((a) => a.area).slice(0, 6),
    proposals: pending.map((c) => ({ id: c.id, field: c.field, label: c.label, level: c.level, confidence: c.confidence || 0, from: show(c, c.from), to: show(c, c.to), manual: !!c.manual, editable: ['name', 'short', 'desc'].includes(c.field), html: c.field === 'desc' && c.to && c.to.html ? String(c.to.html).slice(0, 20000) : c.field === 'short' && typeof c.to === 'string' ? c.to.slice(0, 4000) : '', why: String(c.why || '').slice(0, 300), source: c.source ? { kind: c.source.kind || '', label: String(c.source.label || '').slice(0, 120), url: c.source.url || '' } : null })),
  };
}

/** Ahead of the first opening of a product (after each build of the program's results). */
async function warm() { const catalog = require('./catalog'); for (const s of catalog.SITES) dupIndex(s); await require('./families').warm(); try { require('./checks').catalogCodes(); } catch (_) { /* later */ } }

module.exports = { report, warm, saveSeo, seoOf, SEO_KEY };
