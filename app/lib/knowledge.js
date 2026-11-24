'use strict';
// SF Κέντρο — the shop's own words for what a product IS (study 24/11 «Μελέτη Γνώσης Προϊόντων», §4 / §6):
//   preferred — the word the shop uses, and the words it replaces: ΣΗΜΑ / ΣΗΜΑΤΑ → ΔΙΑΚΡΙΤΙΚΟ / ΔΙΑΚΡΙΤΙΚΑ
//   foreign   — a foreign word on a page or in a title and the shop's kind for it: PATCH → ΔΙΑΚΡΙΤΙΚΟ
//   kinds     — kind words the shop uses even where its titles carry them in the middle (5.11 TACTICAL ΔΙΑΚΡΙΤΙΚΟ …)
// Every rule says where it comes from (the owner's decision, or a person's rule written in Ρυθμίσεις) and a person's
// rule can be taken back. Nothing here is guessed: the AI and the «similar products» suggestion only READ it.
const store = require('./store');
const U = require('./util');

const KEY = 'shop-knowledge';
// the owner's decisions (spec 2.0 §11 and the study 24/11): always there, never removed by a person's rule
const OWNER = [
  { id: 'o-diakritiko', kind: 'preferred', from: ['ΣΗΜΑ'], to: 'ΔΙΑΚΡΙΤΙΚΟ', source: 'Απόφαση ιδιοκτήτη 24/11 (ΔΙΑΚΡΙΤΙΚΟ, όχι ΣΗΜΑ)' },
  { id: 'o-diakritika', kind: 'preferred', from: ['ΣΗΜΑΤΑ'], to: 'ΔΙΑΚΡΙΤΙΚΑ', source: 'Απόφαση ιδιοκτήτη 24/11 (ΔΙΑΚΡΙΤΙΚΟ, όχι ΣΗΜΑ)' },
  { id: 'o-patch', kind: 'foreign', from: ['PATCH', 'PATCHES'], to: 'ΔΙΑΚΡΙΤΙΚΟ', source: 'Απόφαση ιδιοκτήτη 24/11 (PATCH = ΔΙΑΚΡΙΤΙΚΟ)' },
];
const word = (w) => U.greekUpper(String(w || '')).replace(/[^A-ZΑ-Ω0-9]/g, '');

function own() { const d = store.read(KEY, null); return (d && Array.isArray(d.rules) ? d.rules : []).filter((r) => r && !r.removed); }
let memo = null;
/** Every rule, the owner's first → { preferred: Map(from → {to, source}), foreign: Map, kinds: Set, rules: [...] } */
function terms() {
  const mine = own();
  const sig = JSON.stringify(mine.map((r) => r.id));
  if (memo && memo.sig === sig) return memo.v;
  const preferred = new Map(), foreign = new Map(), kinds = new Set();
  for (const r of OWNER.concat(mine)) {
    const to = word(r.to);
    if (!to) continue;
    if (r.kind === 'preferred') { for (const f of r.from || []) if (word(f) && word(f) !== to) preferred.set(word(f), { to, source: r.source || '' }); kinds.add(to); }
    else if (r.kind === 'foreign') { for (const f of r.from || []) if (word(f)) foreign.set(word(f), { to, source: r.source || '' }); kinds.add(to); }
    else if (r.kind === 'kind') kinds.add(to);
  }
  // the plural of a preferred word is a kind too (ΔΙΑΚΡΙΤΙΚΑ)
  for (const v of preferred.values()) kinds.add(v.to);
  memo = { sig, v: { preferred, foreign, kinds, rules: OWNER.map((r) => Object.assign({ owner: true }, r)).concat(mine) } };
  return memo.v;
}
/** A person's rule (Ρυθμίσεις → Γνώση καταστήματος): { kind: preferred|foreign|kind, from: [..], to } → the rule. */
function addRule(input, by) {
  const kind = ['preferred', 'foreign', 'kind'].includes(input && input.kind) ? input.kind : '';
  const to = word(input && input.to);
  const from = [].concat((input && input.from) || []).map(word).filter(Boolean).slice(0, 10);
  if (!kind || !to || (kind !== 'kind' && !from.length)) throw new Error('Γράψε τη λέξη του καταστήματος και (εκτός από «είδος») τις λέξεις που αντικαθιστά.');
  if (!/[Α-Ω]/.test(to)) throw new Error('Η λέξη του καταστήματος γράφεται στα ελληνικά (π.χ. ΔΙΑΚΡΙΤΙΚΟ).');
  const r = { id: U.uid('k'), kind, from, to, by: by || '', at: U.nowIso(), source: 'Κανόνας του ' + (by || 'χρήστη') };
  store.update(KEY, {}, (d) => { d.rules = (d.rules || []).concat([r]).slice(-500); return d; });
  memo = null;
  return r;
}
/** Take a person's rule back (the owner's ones stay). */
function removeRule(id, by) {
  let ok = false;
  store.update(KEY, {}, (d) => { for (const r of d.rules || []) if (r.id === id && !r.removed) { r.removed = U.nowIso(); r.removedBy = by || ''; ok = true; } return d; });
  memo = null;
  return ok;
}

// ---------- what the program learns from a person's decisions (study 24/11 §6) ----------
// approved / changed titles = approved EXAMPLES (given to the AI, and kept for the measuring of the naming);
// «no» to a kind word added in front = a REJECTION: the same word is not proposed again from «similar products» in
// that category after two of them. A proposal of the AI or of a rule is never an example until a person approves it.
// Every entry has who / when and can be taken back.
/** d: { site, pid, cats: [ids], from, to, status: approved|rejected, edited (the person's own title), by } */
function learn(d) {
  if (!d || !d.pid || !['approved', 'rejected'].includes(d.status)) return null;
  const k = d.site + ':' + d.pid;
  const at = U.nowIso();
  let row = null;
  store.update(KEY, {}, (s) => {
    s.examples = s.examples || []; s.rejections = s.rejections || [];
    if (d.status === 'approved') {
      const title = U.collapse(d.edited || d.to || '');
      if (!title) return s;
      row = { id: U.uid('e'), k, title, cats: (d.cats || []).slice(0, 6), how: d.edited ? 'edited' : 'approved', by: d.by || '', at };
      s.examples = s.examples.filter((x) => x.k !== k).concat([row]).slice(-3000);
    } else {
      const before = new Set(String(d.from || '').split(/\s+/).map(word));
      const added = word(String(d.to || '').split(/\s+/)[0]);
      if (!added || before.has(added)) return s;
      row = { id: U.uid('r'), k, word: added, cats: (d.cats || []).slice(0, 6), from: String(d.from || '').slice(0, 120), by: d.by || '', at };
      s.rejections = s.rejections.filter((x) => !(x.k === k && x.word === added)).concat([row]).slice(-3000);
    }
    return s;
  });
  memo = null;
  return row;
}
/** How many times a kind word was refused for products of these categories → Map(word → n) */
function refusedIn(cats) {
  const d = store.read(KEY, null) || {};
  const set = new Set((cats || []).map(Number));
  const m = new Map();
  for (const r of d.rejections || []) if (!r.removed && (r.cats || []).some((c) => set.has(Number(c)))) m.set(r.word, (m.get(r.word) || 0) + 1);
  return m;
}
/** Approved titles of the same categories (the newest first, at most n) — the AI's examples. */
function examplesFor(cats, n) {
  const d = store.read(KEY, null) || {};
  const set = new Set((cats || []).map(Number));
  return (d.examples || []).filter((x) => !x.removed && (x.cats || []).some((c) => set.has(Number(c)))).slice(-(n || 3)).reverse().map((x) => x.title);
}
/** What was learned (the newest first) → { examples, rejections } · take one back by id. */
function learned(n) {
  const d = store.read(KEY, null) || {};
  const live = (a) => (a || []).filter((x) => !x.removed).slice(-(n || 50)).reverse();
  return { examples: live(d.examples), rejections: live(d.rejections), counts: { examples: (d.examples || []).filter((x) => !x.removed).length, rejections: (d.rejections || []).filter((x) => !x.removed).length } };
}
function forget(id, by) {
  let ok = false;
  store.update(KEY, {}, (s) => { for (const x of (s.examples || []).concat(s.rejections || [])) if (x.id === id && !x.removed) { x.removed = U.nowIso(); x.removedBy = by || ''; ok = true; } return s; });
  return ok;
}

module.exports = { terms, addRule, removeRule, learn, refusedIn, examplesFor, learned, forget, KEY, OWNER, word };
