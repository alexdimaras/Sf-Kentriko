'use strict';
// What may be advertised on the ads site, from the official Google and Meta policies (checked 28/10/2026):
//  • Google Ads + Merchant Center "Dangerous products": no guns (incl. hunting, air, airsoft, paintball, BB),
//    no parts/accessories that are essential or enhance a gun — ammunition, ammunition clips (magazines), silencers,
//    tripods/bipods, stocks, conversion kits, grips, scopes and sights; no knives designed or promoted to injure
//    (switchblades, fighting knives, military knives, balisongs, push daggers, throwing axes, assisted-opening,
//    disguised); no throwing stars, brass knuckles, tasers, pepper spray. Gun safety items (locks) are allowed.
//  • Meta: no weapons, ammunition, explosives, weapon modification accessories (e.g. magazines); knives marketed
//    as weapons are rejected. Gun-mounted lights, optics, holsters and belt accessories only with 18+ targeting.
// Levels: banned (both) · google (not Google, Meta 18+) · meta18 (fine, Meta 18+) · caution (depends on wording).
const settings = require('./settings');
const U = require('./util');

const LEVELS = {
  banned: { label: 'Όχι σε Google και Meta', short: 'Απαγορεύεται', severity: 'critical' },
  google: { label: 'Όχι στο Google · Meta μόνο 18+', short: 'Όχι Google', severity: 'high' },
  meta18: { label: 'Επιτρέπεται · στο Meta μόνο 18+', short: 'Meta 18+', severity: 'info' },
  caution: { label: 'Εξαρτάται από το προϊόν και τη διατύπωση', short: 'Προσοχή', severity: 'medium' },
  ok: { label: 'Επιτρέπεται', short: 'Εντάξει', severity: 'info' },
};

// Rules are checked in order; the first match wins. kind: cat (category name or slug, children included),
// type (title starts with), word (word anywhere in the title).
const DEFAULT_RULES = [
  // allowed even inside the weapons category
  { kind: 'cat', match: 'ΧΡΗΜΑΤΟΚΙΒΩΤΙΑ', level: 'ok', why: 'Χρηματοκιβώτια: δεν είναι όπλα' },
  { kind: 'cat', match: 'ΟΠΛΟΚΙΒΩΤΙΑ', level: 'ok', why: 'Οπλοκιβώτια: φύλαξη, όχι όπλο' },
  { kind: 'cat', match: 'ΑΦΥΓΡΑΝΤΗΡΕΣ', level: 'ok', why: 'Αφυγραντήρες' },
  { kind: 'cat', match: 'ΛΙΠΑΝΤΙΚΑ', level: 'caution', why: 'Καθαριστικά/λιπαντικά: επιτρέπονται, χωρίς εικόνες όπλων' },
  { kind: 'cat', match: 'ΚΟΥΤΙΑ ΜΕΤΑΦΟΡΑΣ', level: 'caution', why: 'Κουτιά φυσιγγίων: όχι τα ίδια τα φυσίγγια' },
  { kind: 'type', match: 'ΧΡΗΜΑΤΟΚΙΒΩΤΙΟ', level: 'ok', why: 'Χρηματοκιβώτιο' },
  { kind: 'type', match: 'ΟΠΛΟΚΙΒΩΤΙΟ', level: 'ok', why: 'Οπλοκιβώτιο' },
  { kind: 'word', match: 'TRIGGER LOCK', level: 'ok', why: 'Κλειδαριές ασφαλείας όπλων επιτρέπονται' },
  // weapons and ammunition
  { kind: 'cat', match: 'ΟΠΛΑ', level: 'banned', why: 'Όπλα (και κυνηγετικά, αεροβόλα, airsoft)' },
  { kind: 'cat', match: 'ΦΥΣΙΓΓΙΑ', level: 'banned', why: 'Φυσίγγια / πυρομαχικά' },
  { kind: 'cat', match: 'AIRSOFT', level: 'banned', why: 'Airsoft' },
  { kind: 'cat', match: 'ΑΕΡΟΒΟΛΑ', level: 'banned', why: 'Αεροβόλα' },
  { kind: 'cat', match: 'ΒΛΗΜΑΤΑ', level: 'banned', why: 'Βλήματα αεροβόλων' },
  { kind: 'cat', match: 'ΘΗΚΕΣ ΟΠΛΩΝ', level: 'meta18', why: 'Θήκες όπλων' },
  { kind: 'cat', match: 'ΠΙΣΤΟΛΟΘΗΚΕΣ', level: 'meta18', why: 'Πιστολοθήκες / γεμιστηροθήκες' },
  { kind: 'cat', match: 'ΦΥΣΙΓΓΙΟΘΗΚΕΣ', level: 'caution', why: 'Φυσιγγιοθήκες' },
  { kind: 'cat', match: 'FAB DEFENSE', level: 'banned', why: 'Κοντάκια, λαβές, ράγες, δίποδα: εξαρτήματα που βελτιώνουν όπλο' },
  { kind: 'type', match: 'ΟΠΛΟ', level: 'banned', why: 'Όπλο' }, { kind: 'type', match: 'ΠΙΣΤΟΛΙ', level: 'banned', why: 'Πιστόλι' },
  { kind: 'type', match: 'ΠΕΡΙΣΤΡΟΦΟ', level: 'banned', why: 'Περίστροφο' }, { kind: 'type', match: 'ΤΟΥΦΕΚΙ', level: 'banned', why: 'Τουφέκι' },
  { kind: 'type', match: 'ΤΥΦΕΚΙΟ', level: 'banned', why: 'Τυφέκιο' }, { kind: 'type', match: 'ΚΑΡΑΜΠΙΝΑ', level: 'banned', why: 'Καραμπίνα' },
  { kind: 'type', match: 'ΗΜΙΑΥΤΟΜΑΤΗ', level: 'banned', why: 'Ημιαυτόματο όπλο' }, { kind: 'type', match: 'ΗΜΙΑΥΤΟΜΑΤΟ', level: 'banned', why: 'Ημιαυτόματο όπλο' },
  { kind: 'type', match: 'ΕΠΑΝΑΛΗΠΤΙΚΗ', level: 'banned', why: 'Επαναληπτικό όπλο' }, { kind: 'type', match: 'ΕΠΑΝΑΛΗΠΤΙΚΟ', level: 'banned', why: 'Επαναληπτικό όπλο' },
  { kind: 'type', match: 'ΔΙΚΑΝΝΟ', level: 'banned', why: 'Δίκαννο' }, { kind: 'type', match: 'ΜΟΝΟΚΑΝΝΟ', level: 'banned', why: 'Μονόκαννο' },
  { kind: 'type', match: 'ΠΛΑΓΙΟΚΑΝΝΟ', level: 'banned', why: 'Πλαγιόκαννο' }, { kind: 'type', match: 'ΑΕΡΟΒΟΛΟ', level: 'banned', why: 'Αεροβόλο' },
  { kind: 'type', match: 'ΦΥΣΙΓΓΙΑ', level: 'banned', why: 'Φυσίγγια' }, { kind: 'type', match: 'ΦΥΣΙΓΓΙΟ', level: 'banned', why: 'Φυσίγγιο' },
  { kind: 'type', match: 'ΣΦΑΙΡΕΣ', level: 'banned', why: 'Σφαίρες' }, { kind: 'type', match: 'ΒΟΛΙΔΕΣ', level: 'banned', why: 'Βολίδες' },
  { kind: 'type', match: 'ΔΡΑΜΙΑ', level: 'banned', why: 'Δράμια' }, { kind: 'type', match: 'ΣΚΑΓΙΑ', level: 'banned', why: 'Σκάγια' },
  { kind: 'type', match: 'ΒΛΗΜΑΤΑ', level: 'banned', why: 'Βλήματα' }, { kind: 'type', match: 'ΚΑΛΥΚΕΣ', level: 'banned', why: 'Κάλυκες' },
  { kind: 'type', match: 'ΜΠΑΡΟΥΤΙ', level: 'banned', why: 'Μπαρούτι' }, { kind: 'type', match: 'ΓΕΜΙΣΤΗΡΑ', level: 'banned', why: 'Γεμιστήρας (Google: ammunition clips)' },
  { kind: 'type', match: 'ΓΕΜΙΣΤΗΡΑΣ', level: 'banned', why: 'Γεμιστήρας' }, { kind: 'type', match: 'ΓΕΜΙΣΤΗΡΕΣ', level: 'banned', why: 'Γεμιστήρες' },
  { kind: 'type', match: 'ΣΙΓΑΣΤΗΡΑΣ', level: 'banned', why: 'Σιγαστήρας' }, { kind: 'type', match: 'ΚΑΝΝΗ', level: 'banned', why: 'Κάννη' },
  { kind: 'type', match: 'ΚΟΝΤΑΚΙ', level: 'banned', why: 'Κοντάκι όπλου' }, { kind: 'type', match: 'ΚΟΝΤΑΚΙΑ', level: 'banned', why: 'Κοντάκια όπλων' },
  { kind: 'type', match: 'ΧΕΙΡΟΛΑΒΗ', level: 'banned', why: 'Λαβή όπλου' }, { kind: 'type', match: 'ΧΕΙΡΟΦΥΛΑΚΤΗΡΑΣ', level: 'banned', why: 'Χειροφυλακτήρας' },
  { kind: 'type', match: 'ΔΙΠΟΔΟ', level: 'banned', why: 'Δίποδο (Google: bipods)' }, { kind: 'type', match: 'ΣΚΑΝΔΑΛΗ', level: 'banned', why: 'Σκανδάλη' },
  { kind: 'type', match: 'ΚΛΕΙΣΤΡΟ', level: 'banned', why: 'Κλείστρο' }, { kind: 'type', match: 'ΞΙΦΟΛΟΓΧΗ', level: 'banned', why: 'Ξιφολόγχη (στρατιωτικό μαχαίρι)' },
  { kind: 'type', match: 'ΓΚΛΟΠ', level: 'banned', why: 'Γκλοπ: σχεδιασμένο να τραυματίζει' }, { kind: 'type', match: 'ΣΙΔΕΡΟΓΡΟΘΙΑ', level: 'banned', why: 'Σιδερογροθιά' },
  { kind: 'word', match: 'ΠΙΠΕΡΙΟΥ', level: 'banned', why: 'Σπρέι πιπεριού' }, { kind: 'word', match: 'PEPPER', level: 'banned', why: 'Σπρέι πιπεριού' },
  { kind: 'word', match: 'ΗΛΕΚΤΡΟΣΟΚ', level: 'banned', why: 'Ηλεκτροσόκ' }, { kind: 'word', match: 'TASER', level: 'banned', why: 'Taser' },
  { kind: 'word', match: 'AIRSOFT', level: 'banned', why: 'Airsoft' }, { kind: 'word', match: 'SILENCER', level: 'banned', why: 'Σιγαστήρας' },
  { kind: 'word', match: 'SUPPRESSOR', level: 'banned', why: 'Σιγαστήρας' }, { kind: 'word', match: 'BIPOD', level: 'banned', why: 'Δίποδο' },
  { kind: 'word', match: 'BALISONG', level: 'banned', why: 'Μαχαίρι πεταλούδα' }, { kind: 'word', match: 'BUTTERFLY', level: 'banned', why: 'Μαχαίρι πεταλούδα' },
  { kind: 'word', match: 'ΠΕΤΑΛΟΥΔΑ', level: 'banned', why: 'Μαχαίρι πεταλούδα' }, { kind: 'word', match: 'SWITCHBLADE', level: 'banned', why: 'Αυτόματο μαχαίρι' },
  { kind: 'word', match: 'OTF', level: 'banned', why: 'Αυτόματο μαχαίρι (OTF)' }, { kind: 'word', match: 'KARAMBIT', level: 'banned', why: 'Karambit (μαχαίρι μάχης)' },
  { kind: 'word', match: 'PUSH DAGGER', level: 'banned', why: 'Push dagger' }, { kind: 'word', match: 'ΕΓΧΕΙΡΙΔΙΟ', level: 'banned', why: 'Εγχειρίδιο (μαχαίρι μάχης)' },
  { kind: 'word', match: 'DAGGER', level: 'banned', why: 'Εγχειρίδιο (μαχαίρι μάχης)' },
  // optics and attachments: Google says no, Meta 18+
  { kind: 'type', match: 'ΔΙΟΠΤΡΑ', level: 'google', why: 'Διόπτρα (Google: scopes and sights)' }, { kind: 'type', match: 'ΣΚΟΠΕΥΤΙΚΟ', level: 'google', why: 'Σκοπευτικό' },
  { kind: 'type', match: 'ΣΤΟΧΑΣΤΡΟ', level: 'google', why: 'Στόχαστρο' }, { kind: 'type', match: 'ΒΑΣΗ', level: 'caution', why: 'Βάση: αν είναι για διόπτρα/όπλο, όχι στο Google' },
  { kind: 'word', match: 'RED DOT', level: 'google', why: 'Red dot' }, { kind: 'word', match: 'RIFLESCOPE', level: 'google', why: 'Διόπτρα' },
  { kind: 'word', match: 'SCOPE', level: 'google', why: 'Διόπτρα' }, { kind: 'word', match: 'HOLOGRAPHIC', level: 'google', why: 'Ολογραφικό σκοπευτικό' },
  { kind: 'word', match: 'ΣΚΟΠΕΥΤΙΚΟ', level: 'google', why: 'Σκοπευτικό' }, { kind: 'word', match: 'TLR', level: 'google', why: 'Φακός που μπαίνει σε όπλο' },
  { kind: 'word', match: 'ΦΑΚΟΣ ΟΠΛΟΥ', level: 'google', why: 'Φακός που μπαίνει σε όπλο' }, { kind: 'word', match: 'ΣΤΟΧΕΥΤΗΣ', level: 'google', why: 'Laser στόχευσης' },
  // holsters, belt accessories: fine on Google, Meta 18+
  { kind: 'type', match: 'ΘΗΚΗ ΠΙΣΤΟΛΙΟΥ', level: 'meta18', why: 'Θήκη πιστολιού' }, { kind: 'type', match: 'ΘΗΚΗ ΓΕΜΙΣΤΗΡΑ', level: 'meta18', why: 'Θήκη γεμιστήρα' },
  { kind: 'type', match: 'ΘΗΚΗ ΓΕΜΙΣΤΗΡΩΝ', level: 'meta18', why: 'Θήκη γεμιστήρων' }, { kind: 'type', match: 'ΘΗΚΗ ΟΠΛΟΥ', level: 'meta18', why: 'Θήκη όπλου' },
  { kind: 'type', match: 'ΟΠΛΟΘΗΚΗ', level: 'meta18', why: 'Οπλοθήκη' }, { kind: 'word', match: 'HOLSTER', level: 'meta18', why: 'Θήκη όπλου' },
  { kind: 'type', match: 'ΑΟΡΤΗΡΑΣ', level: 'meta18', why: 'Αορτήρας όπλου' },
  // knives: hunting / utility allowed; anything tactical, military or assisted is not
  { kind: 'type', match: 'ΜΑΧΑΙΡΙ', level: 'caution', why: 'Μαχαίρι: κυνηγετικό/εργαλείο ναι, μάχης/στρατιωτικό όχι' },
  { kind: 'type', match: 'ΣΟΥΓΙΑΣ', level: 'caution', why: 'Σουγιάς: όχι με υποβοηθούμενο άνοιγμα ή «tactical»' },
  { kind: 'type', match: 'ΑΝΑΔΙΠΛΟΥΜΕΝΟ', level: 'caution', why: 'Αναδιπλούμενο μαχαίρι' },
  { kind: 'type', match: 'ΤΣΕΚΟΥΡΙ', level: 'caution', why: 'Τσεκούρι: όχι «ρίψης»' },
  { kind: 'cat', match: 'ΜΑΧΑΙΡΙΑ', level: 'caution', why: 'Μαχαίρια' }, { kind: 'cat', match: 'ΣΟΥΓΙΑΔΕΣ', level: 'caution', why: 'Σουγιάδες' },
  { kind: 'type', match: 'ΧΕΙΡΟΠΕΔΕΣ', level: 'caution', why: 'Χειροπέδες' },
  { kind: 'word', match: 'ΑΛΕΞΙΣΦΑΙΡΟ', level: 'caution', why: 'Αλεξίσφαιρο' }, { kind: 'word', match: 'ΒΑΛΛΙΣΤΙΚΟ', level: 'caution', why: 'Βαλλιστική προστασία' },
];
// Words that turn a knife into a "weapon" for Google/Meta.
const KNIFE_WEAPON_WORDS = ['TACTICAL', 'ΤΑΚΤΙΚΟ', 'COMBAT', 'ΜΑΧΗΣ', 'MILITARY', 'ΣΤΡΑΤΙΩΤΙΚΟ', 'FIGHTING', 'ASSISTED', 'SPRING ASSISTED', 'AUTOMATIC', 'ΑΥΤΟΜΑΤΟ', 'THROWING', 'ΡΙΨΗΣ', 'SURVIVAL KNIFE'];

function rules() {
  const s = settings.all();
  return Array.isArray(s.adRules) && s.adRules.length ? s.adRules : DEFAULT_RULES;
}

function compile(list) {
  return list.map((r) => Object.assign({}, r, { key: U.foldKey(r.match), slug: String(r.match || '').toLowerCase() }));
}
let compiled = null, compiledFrom = null;
function getCompiled() {
  const list = rules();
  if (compiledFrom !== list) { compiled = compile(list); compiledFrom = list; }
  return compiled;
}

/**
 * Evaluate one product. ctx: { catPaths: [[{name,slug}...]...] } — the category chains (root first) of the product.
 * Returns { level, why, rule }.
 */
function evaluate(p, catChains) {
  let title = ' ' + U.foldKey(U.untexturize(p.name)).replace(/[^\p{L}\p{N}]+/gu, ' ') + ' ';
  const titleStart = title.trim();
  // brand words never count as "weapon" words (5.11 TACTICAL, TACTICAL GEAR…)
  const brandKey = U.foldKey(p.brand || '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (brandKey) title = title.split(' ' + brandKey + ' ').join(' ');
  const isKnife = /^(ΜΑΧΑΙΡΙ|ΣΟΥΓΙΑΣ|ΑΝΑΔΙΠΛΟΥΜΕΝΟ)\b/.test(titleStart) || (catChains || []).some((ch) => ch.some((c) => /^(ΜΑΧΑΙΡΙΑ|ΣΟΥΓΙΑΔΕΣ)/.test(U.foldKey(c.name))));
  if (isKnife) {
    for (const w of KNIFE_WEAPON_WORDS) {
      const k = U.foldKey(w);
      if (title.includes(' ' + k + ' ')) return { level: 'banned', why: `Μαχαίρι με «${w}» στον τίτλο: το Google/Meta το θεωρεί όπλο`, rule: null };
    }
  }
  // Category rules apply from the deepest category upwards, so "ΟΠΛΑ › ΧΡΗΜΑΤΟΚΙΒΩΤΙΑ" stays allowed.
  const list = getCompiled();
  let best = null;
  for (const chain of catChains || []) {
    for (let i = chain.length - 1; i >= 0; i--) {
      const nk = U.foldKey(chain[i].name);
      const sl = String(chain[i].slug || '').toLowerCase();
      const r = list.find((x) => x.kind === 'cat' && (nk === x.key || nk.startsWith(x.key + ' ') || nk.startsWith(x.key + '-') || sl === x.slug));
      if (r) {
        if (!best || rank(r.level) > rank(best.level)) best = r;
        break; // deepest match wins for this chain
      }
    }
  }
  for (const r of list) {
    if (r.kind === 'type' && (titleStart === r.key || titleStart.startsWith(r.key + ' '))) { if (!best || rank(r.level) > rank(best.level) || best.level === 'ok') best = pickTitle(best, r); break; }
  }
  for (const r of list) {
    if (r.kind === 'word' && title.includes(' ' + r.key + ' ')) { if (!best || rank(r.level) > rank(best.level)) best = r; }
  }
  if (!best) return { level: 'ok', why: '', rule: null };
  return { level: best.level, why: best.why || best.match, rule: best.match };
}
function pickTitle(cur, r) {
  // An explicit "allowed" title (ΧΡΗΜΑΤΟΚΙΒΩΤΙΟ…) beats a broad category; otherwise the stricter one wins.
  if (r.level === 'ok') return r;
  if (!cur) return r;
  return rank(r.level) >= rank(cur.level) ? r : cur;
}
function rank(l) { return { ok: 0, meta18: 1, caution: 2, google: 3, banned: 4 }[l] || 0; }

module.exports = { LEVELS, DEFAULT_RULES, rules, evaluate, rank };
