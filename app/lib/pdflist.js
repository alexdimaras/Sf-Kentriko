'use strict';
// Price lists in PDF: rebuilds the table from the position of every piece of text on the page
// (rows by height, columns by the header line), joins descriptions that wrap to a second line,
// and gives the same { headers, rows } as an Excel file, so the column mapping works the same way.
const U = require('./util');

const HEAD_WORDS = /κωδ|code|sku|ref|περιγραφ|ονομα|προιον|description|item|τιμη|price|λιανικ|χονδρ|retail|wholesale|net|καθαρ|μαρκα|brand|ean|barcode|ποσοτ|qty|αποθεμ|μονα|μεγεθ|size|χρωμ|colou?r|φπα|vat|€/;
const PRICE = /^[-+]?\d{1,3}([.\s]\d{3})*([.,]\d{1,2})?\s*€?$|^€?\s*\d+([.,]\d{1,2})?$/;

async function pages(buf) {
  const pdfParse = require('pdf-parse/lib/pdf-parse.js');
  const out = [];
  await pdfParse(buf, {
    max: 400,
    pagerender: async (page) => {
      const tc = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
      const items = tc.items.map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || (it.str.length * Math.abs(it.transform[0]) * 0.5), h: Math.abs(it.transform[3]) || 8 }))
        .filter((it) => it.s && it.s.trim());
      out.push(items);
      return '';
    },
  });
  return out;
}

/** Text pieces → lines (same height); cells = pieces right next to each other (for finding the header). */
function linesOf(items) {
  const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const l = lines.length ? lines[lines.length - 1] : null;
    if (l && Math.abs(l.y - it.y) <= Math.max(2, it.h * 0.35)) l.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    const cells = [];
    for (const it of l.items) {
      const c = cells[cells.length - 1];
      const gap = c ? it.x - c.x2 : Infinity;
      // touching pieces are one cell, unless the next one starts with a capital right after a small letter (ΠεριγραφήΧρώμα)
      const newWord = c && /[\p{Ll}.]$/u.test(c.s) && /^\p{Lu}/u.test(it.s);
      if (c && !newWord && gap < Math.max(1.5, it.h * 0.3)) { c.s += (gap > it.h * 0.12 ? ' ' : '') + it.s; c.x2 = it.x + it.w; } else cells.push({ s: it.s, x: it.x, x2: it.x + it.w });
    }
    for (const c of cells) c.s = U.collapse(c.s);
    l.cells = cells.filter((c) => c.s);
  }
  return lines.filter((l) => l.cells.length);
}

function isHeader(l) {
  const hits = l.cells.filter((c) => HEAD_WORDS.test(U.stripTonos(c.s).toLowerCase()) && c.s.length < 40).length;
  return hits >= 2 && hits >= l.cells.length * 0.5;
}
const NOISE = /σελιδα|σελ\.\s*\d|page\s*\d|τηλ\.?\s*:|www\.|@|copyright|©/i;

/** Read a PDF price list. */
async function read(buf) {
  const pgs = await pages(buf);
  const all = pgs.map(linesOf);
  let header = null;
  for (const lines of all) { header = lines.find(isHeader); if (header) break; }
  let cols;
  if (header) cols = header.cells.map((c) => ({ name: c.s, x: c.x, x2: c.x2 }));
  else {
    // no titles: the most common number of cells per line gives the columns
    const flat = all.flat().filter((l) => l.cells.length >= 2);
    const counts = new Map();
    for (const l of flat) counts.set(l.cells.length, (counts.get(l.cells.length) || 0) + 1);
    const n = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!n) return { headers: [], rows: [] };
    const model = flat.find((l) => l.cells.length === n[0]);
    cols = model.cells.map((c, i) => ({ name: 'Στήλη ' + (i + 1), x: c.x, x2: c.x2 }));
  }
  const seen = new Map();
  for (const c of cols) { const k = c.name; seen.set(k, (seen.get(k) || 0) + 1); if (seen.get(k) > 1) c.name = k + ' ' + seen.get(k); }
  // column borders: halfway between the end of one title and the start of the next
  const borders = cols.slice(0, -1).map((c, i) => (Math.min(c.x2, cols[i + 1].x) + cols[i + 1].x) / 2);
  const colOfX = (x) => { let i = 0; while (i < borders.length && x >= borders[i]) i++; return i; };
  const nameCol = cols.findIndex((c) => /περιγραφ|ονομα|προιον|description|item|name|τιτλ/.test(U.stripTonos(c.name).toLowerCase()));
  const rows = [];
  for (const lines of all) {
    const pageRows = [], orphans = [];
    for (const l of lines) {
      if (l === header || (header && isHeader(l))) continue; // the header repeats on every page
      const vals = cols.map(() => '');
      // each piece of text goes to the column under whose title it starts (pieces may touch each other)
      for (const it of l.items) { const i = colOfX(it.x + 1); vals[i] = vals[i] ? vals[i] + (/\s$/.test(vals[i]) || /^\s/.test(it.s) ? '' : ' ') + it.s : it.s; }
      for (let i = 0; i < vals.length; i++) vals[i] = U.collapse(vals[i]);
      const filled = vals.filter(Boolean).length;
      const hasPrice = vals.some((v, i) => i !== nameCol && /\d/.test(v) && PRICE.test(v.trim()));
      if (filled >= 2 && hasPrice) { pageRows.push({ y: l.y, vals }); continue; }
      // text only in the description column: the description wraps to another line
      if (nameCol >= 0 && filled === 1 && vals[nameCol] && !NOISE.test(vals[nameCol])) orphans.push({ y: l.y, text: vals[nameCol] });
    }
    if (pageRows.length > 1) {
      const gaps = pageRows.slice(1).map((r, i) => pageRows[i].y - r.y).sort((a, b) => a - b);
      const typical = gaps[Math.floor(gaps.length / 2)] || 12;
      for (const o of orphans) {
        let best = null, d = Infinity;
        for (const r of pageRows) { const dd = Math.abs(r.y - o.y); if (dd < d) { d = dd; best = r; } }
        if (!best || d > typical * 1.6) continue;
        best.extra = best.extra || [];
        best.extra.push(o);
      }
    }
    for (const r of pageRows) {
      if (r.extra && nameCol >= 0) {
        const parts = r.extra.concat([{ y: r.y, text: r.vals[nameCol] }]).sort((a, b) => b.y - a.y);
        r.vals[nameCol] = U.collapse(parts.map((p) => p.text).join(' '));
      }
      const o = {};
      cols.forEach((c, i) => { o[c.name] = r.vals[i]; });
      rows.push(o);
    }
  }
  return { headers: cols.map((c) => c.name), rows };
}

module.exports = { read };
