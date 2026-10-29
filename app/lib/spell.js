'use strict';
// Greek spelling, offline: 828.000 word forms (el_GR Hunspell dictionary, elspell.math.upatras.gr, MPL/GPL/LGPL).
// Titles are in capitals without accents, so the dictionary is kept the same way (ΠΑΝΑΓΙΑ, ΣΠΑΣΤΑ…),
// and the diaeresis is dropped too (ΠΛΑΪΝΗ = ΠΛΑΙΝΗ).
const fs = require('fs');
const path = require('path');

const plain = (w) => String(w).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

// The 812.000 words are kept packed: one byte per letter in one buffer, an index of where each word starts,
// a hash table for "is it a word?", and one for the stems (a word without its last 1–2 letters, pointing into
// the same buffer, compared letter by letter: exact, no false matches). About 38 MB instead of ~150 MB as
// JavaScript Sets, with the same answers, and no big temporary list while loading.
let D = null;
const FNV = (x, c) => Math.imul(x ^ c, 16777619);
function build() {
  let raw = null;
  try { raw = fs.readFileSync(path.join(__dirname, 'dict', 'el.dic'), 'utf8'); } catch (e) { console.error('dictionary:', e.message); raw = ''; }
  // the alphabet: every letter used (Greek capitals, a few others), one byte each
  const code = new Map();
  const lines = [];
  let start = raw.indexOf('\n') + 1; // first line = count
  let total = 0, n = 0, long = 0;
  // first pass: sizes and alphabet (the words are made and dropped one by one)
  for (let i = start; i <= raw.length; i++) {
    if (i === raw.length || raw.charCodeAt(i) === 10) {
      const w = plain(raw.slice(start, i).trim());
      start = i + 1;
      if (w.length < 2 || w.length > 255) continue;
      for (let j = 0; j < w.length; j++) { const c = w.charCodeAt(j); if (!code.has(c)) code.set(c, code.size + 1); }
      total += w.length; n++; if (w.length >= 6) long++;
    }
  }
  void lines;
  if (code.size > 254) throw new Error('dictionary alphabet too large');
  const data = Buffer.allocUnsafe(total);
  const offs = new Uint32Array(n + 1);
  let wsize = 1; while (wsize < n * 2) wsize <<= 1;
  const wmask = wsize - 1;
  const words = new Int32Array(wsize).fill(-1);
  let ssize = 1; while (ssize < long * 3) ssize <<= 1;
  const smask = ssize - 1;
  const stems = new Int32Array(ssize).fill(-1); // -1 = empty, else word index * 2 + (cut - 1)
  const stemLen = (e) => offs[(e >> 1) + 1] - offs[e >> 1] - ((e & 1) + 1);
  const sameBytes = (a, b, len) => { for (let j = 0; j < len; j++) if (data[a + j] !== data[b + j]) return false; return true; };
  const addStem = (x, k, cut) => {
    const e = k * 2 + (cut - 1), len = offs[k + 1] - offs[k] - cut;
    let hh = x & smask;
    while (stems[hh] !== -1) { const f = stems[hh]; if (stemLen(f) === len && sameBytes(offs[f >> 1], offs[k], len)) return; hh = (hh + 1) & smask; }
    stems[hh] = e;
  };
  // second pass: pack, index, hash
  let o = 0, k = 0;
  start = raw.indexOf('\n') + 1;
  for (let i = start; i <= raw.length; i++) {
    if (i === raw.length || raw.charCodeAt(i) === 10) {
      const w = plain(raw.slice(start, i).trim());
      start = i + 1;
      if (w.length < 2 || w.length > 255) continue;
      const a = o;
      let x = 2166136261 | 0;
      const pre = [];
      for (let j = 0; j < w.length; j++) {
        const c = code.get(w.charCodeAt(j));
        data[o++] = c;
        x = FNV(x, c);
        if (w.length >= 6 && (j === w.length - 3 || j === w.length - 2)) pre.push(x >>> 0); // hashes of w[:-2], w[:-1]
      }
      const hh0 = x >>> 0;
      let hh = hh0 & wmask, dup = false;
      while (words[hh] !== -1) {
        const t = words[hh], ta = offs[t], tl = offs[t + 1] - ta;
        if (tl === w.length) { let j = 0; while (j < tl && data[ta + j] === data[a + j]) j++; if (j === tl) { dup = true; break; } }
        hh = (hh + 1) & wmask;
      }
      if (dup) { o = a; continue; }
      offs[k] = a; offs[k + 1] = o; words[hh] = k;
      if (pre.length === 2) { addStem(pre[0], k, 2); addStem(pre[1], k, 1); }
      k++;
    }
  }
  raw = null;
  offs[k] = o;
  const q = new Uint8Array(256);
  const enc = (w) => { if (w.length > 255) return -1; for (let j = 0; j < w.length; j++) { const c = code.get(w.charCodeAt(j)); if (!c) return -1; q[j] = c; } return w.length; };
  const hashQ = (len) => { let x = 2166136261 | 0; for (let j = 0; j < len; j++) x = FNV(x, q[j]); return x >>> 0; };
  const has = (w) => {
    const len = enc(w);
    if (len < 0) return false;
    let hh = hashQ(len) & wmask;
    for (;;) {
      const i = words[hh];
      if (i === -1) return false;
      const a = offs[i];
      if (offs[i + 1] - a === len) { let j = 0; while (j < len && data[a + j] === q[j]) j++; if (j === len) return true; }
      hh = (hh + 1) & wmask;
    }
  };
  const stemHas = (x) => {
    const len = enc(x);
    if (len < 0) return false;
    let hh = hashQ(len) & smask;
    while (stems[hh] !== -1) {
      const f = stems[hh];
      if (stemLen(f) === len) { const a = offs[f >> 1]; let j = 0; while (j < len && data[a + j] === q[j]) j++; if (j === len) return true; }
      hh = (hh + 1) & smask;
    }
    return false;
  };
  return { size: k, has, stem: (w) => stemHas(w.slice(0, -1)) || stemHas(w.slice(0, -2)), bytes: data.length + offs.byteLength + words.byteLength + stems.byteLength };
}
function dict() { if (!D) D = build(); return D; }
function isWord(w) { return dict().has(plain(w)); }
/** Another form of a known word (different ending): ΑΝΤΙΟΞΕΙΔΩΤΙΚΟ next to ΑΝΤΙΟΞΕΙΔΩΤΙΚΗ. */
function knownStem(w) { return w.length >= 6 && dict().stem(w); }

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
