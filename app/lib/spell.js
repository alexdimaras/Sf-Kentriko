'use strict';
// Greek spelling, offline: 828.000 word forms (el_GR Hunspell dictionary, elspell.math.upatras.gr, MPL/GPL/LGPL).
// Titles are in capitals without accents, so the dictionary is kept the same way (ΠΑΝΑΓΙΑ, ΣΠΑΣΤΑ…),
// and the diaeresis is dropped too (ΠΛΑΪΝΗ = ΠΛΑΙΝΗ).
const fs = require('fs');
const path = require('path');

let words = null;
let stems = null;
const plain = (w) => String(w).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

function dict() {
  if (words) return words;
  words = new Set();
  stems = new Set();
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'dict', 'el.dic'), 'utf8');
    let start = raw.indexOf('\n') + 1; // first line = count
    for (let i = start; i <= raw.length; i++) {
      if (i === raw.length || raw.charCodeAt(i) === 10) {
        const w = raw.slice(start, i).trim();
        if (w.length >= 2) {
          const u = plain(w);
          words.add(u);
          // stems: the word without its ending, so other forms of the same word count as known
          if (u.length >= 6) { stems.add(u.slice(0, -1)); stems.add(u.slice(0, -2)); }
        }
        start = i + 1;
      }
    }
  } catch (e) { console.error('dictionary:', e.message); }
  return words;
}
function isWord(w) { return dict().has(plain(w)); }
/** Another form of a known word (different ending): ΑΝΤΙΟΞΕΙΔΩΤΙΚΟ next to ΑΝΤΙΟΞΕΙΔΩΤΙΚΗ. */
function knownStem(w) { dict(); return w.length >= 6 && (stems.has(w.slice(0, -1)) || stems.has(w.slice(0, -2))); }

const GR = 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ';
// Letters that sound the same in Greek: the classic spelling mistakes (ΣΠΙΝΘΙΡΑΣ / ΣΠΙΝΘΗΡΑΣ, ΠΡΟΠΟΝΙΤΙΚΟ).
const SAME_SOUND = ['ΙΗΥ', 'ΟΩ'];
const sameSound = (a, b) => SAME_SOUND.some((g) => g.includes(a) && g.includes(b));

/**
 * Spelling check of one Greek word in capitals. Returns null when it is fine / unknown,
 * otherwise { fix, alts } (best correction + other possible ones).
 * freq = how many products of the shop use each word (titles + descriptions).
 * Careful by design: a wrong "correction" is worse than a missed typo, so:
 *  - edits are only looked for away from the ending (endings change with grammar),
 *  - a correction the shop never writes is only proposed for typing slips (double letter, swapped letters)
 *    and same-sound letters (Ι/Η/Υ, Ο/Ω),
 *  - a word the shop writes in several products is a name/term unless it is a typing slip (ΧΡΑΠΑ, ΚΥΡΓΙΑΣ).
 */
function check(word, freq) {
  const w = plain(word);
  if (w.length < 5 || !/^[Α-Ω]+$/.test(w)) return null;
  const d = dict();
  const f = (x) => (freq && freq.get(x)) || 0;
  if (d.has(w)) return null;
  const cands = new Map(); // word -> kind
  const consider = (c, kind) => { if (c !== w && d.has(c) && !cands.has(c)) cands.set(c, kind); };
  const lim = w.length - 2;
  for (let i = 0; i <= lim; i++) {
    for (const ch of GR) consider(w.slice(0, i) + ch + w.slice(i), ch === w[i] || ch === w[i - 1] ? 'slip' : 'other');
    if (i === lim) break;
    consider(w.slice(0, i) + w.slice(i + 1), w[i] === w[i + 1] || w[i] === w[i - 1] ? 'slip' : 'other');
    if (i < lim - 1) consider(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2), 'slip');
    for (const ch of GR) consider(w.slice(0, i) + ch + w.slice(i + 1), sameSound(ch, w[i]) ? 'sound' : 'other');
  }
  const fw = f(w);
  const stem = knownStem(w);
  const ok = [...cands.entries()].filter(([c, kind]) => {
    const n = f(c);
    if (stem && n < 10) return false; // another form of a known word: only when the shop clearly writes it otherwise
    if (kind === 'other') return n >= 3 && fw < 3; // e.g. ΚΙΤΙΡΙΝΟ → ΚΙΤΡΙΝΟ (the shop writes ΚΙΤΡΙΝΟ)
    if (fw >= 3) return n >= fw * 4; // ΠΙΙΣΤΟΛΙ (18) next to ΠΙΣΤΟΛΙ (554)
    return true;
  });
  if (!ok.length) return null;
  // prefer words the shop uses, typing slips and same-sound letters, the same first letter, the closest length
  const rank = { slip: 6, sound: 4, other: 0 };
  const score = ([c, kind]) => Math.min(f(c), 50) * 10 + rank[kind] + (c[0] === w[0] ? 5 : 0) - Math.abs(c.length - w.length);
  ok.sort((a, b) => score(b) - score(a));
  return { fix: ok[0][0], alts: ok.slice(1, 3).map((x) => x[0]) };
}
function suggest(word, freq) { const r = check(word, freq); return r ? r.fix : ''; }

module.exports = { dict, isWord, knownStem, check, suggest, plain };
