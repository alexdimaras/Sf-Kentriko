'use strict';
// Optional free AI that runs on the shop's own PC (Ollama, https://ollama.com). No subscription, no data leaves the PC.
const settings = require('./settings');
const U = require('./util');

function cfg() { return settings.all().localAI || {}; }

async function call(path, body, timeout) {
  const c = cfg();
  const base = String(c.url || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout || 180000);
  try {
    const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
    if (!r.ok) throw new Error('Το τοπικό AI απάντησε με σφάλμα ' + r.status + '.');
    return await r.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Το τοπικό AI άργησε πολύ. Δοκίμασε μικρότερο μοντέλο.');
    if (/ECONNREFUSED|fetch failed/i.test(String(e.message) + String(e.cause && e.cause.code))) throw new Error('Δεν βρέθηκε το Ollama σε αυτόν τον υπολογιστή. Εγκατάστησέ το από το ollama.com ή άφησε την επιλογή κλειστή.');
    throw e;
  } finally { clearTimeout(t); }
}

async function status() {
  const r = await call('/api/tags', null, 8000);
  const models = (r.models || []).map((m) => m.name);
  return { ok: true, models };
}

async function generate(prompt) {
  const c = cfg();
  if (!c.enabled) throw new Error('Το τοπικό AI είναι κλειστό (Ρυθμίσεις).');
  let model = c.model;
  if (!model) { const s = await status(); model = s.models[0]; }
  if (!model) throw new Error('Δεν υπάρχει εγκατεστημένο μοντέλο στο Ollama. Τρέξε π.χ. «ollama pull qwen2.5:7b».');
  const r = await call('/api/generate', { model, prompt, stream: false, options: { temperature: 0.4 } });
  return String(r.response || '').trim();
}

function toHtml(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map((l) => l.trim());
  let html = '', inList = false;
  for (const l of lines) {
    if (!l) { if (inList) { html += '</ul>'; inList = false; } continue; }
    const li = l.match(/^[-*•]\s+(.*)$/);
    if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${U.escapeHtml(li[1].replace(/\*\*/g, ''))}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    html += `<p>${U.escapeHtml(l.replace(/\*\*/g, '').replace(/^#+\s*/, ''))}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
}

async function describe(d) {
  const facts = [
    'Προϊόν: ' + d.displayTitle,
    d.fields.brand ? 'Μάρκα: ' + d.fields.brand : '',
    d.fields.model ? 'Μοντέλο: ' + d.fields.model : '',
    (d.variations || []).length ? 'Μεγέθη/χρώματα: ' + [...new Set(d.variations.map((v) => [v.size, v.color].filter(Boolean).join(' ')))].join(', ') : '',
    ...(d.specs || []).slice(0, 12).map((s) => s.k + ': ' + s.v),
    ...(d.features || []).slice(0, 12).map((f) => '- ' + f),
    d.keyPoints ? 'Σημειώσεις καταστήματος: ' + d.keyPoints : '',
    d.descOfficial ? 'Επίσημο κείμενο: ' + U.stripTags(d.descOfficial).slice(0, 2500) : '',
  ].filter(Boolean).join('\n');
  const prompt = `Γράψε περιγραφή προϊόντος στα ελληνικά για ηλεκτρονικό κατάστημα στρατιωτικών, τακτικών και κυνηγετικών ειδών.
Χρησιμοποίησε ΜΟΝΟ τα στοιχεία που δίνονται. Μην επινοήσεις τεχνικά χαρακτηριστικά. Ύφος απλό, ξεκάθαρο, χωρίς υπερβολές.
Μορφή: 2 σύντομες παράγραφοι και μετά λίστα με παύλες για τα χαρακτηριστικά. Χωρίς τίτλο, χωρίς τιμές.

${facts}`;
  return toHtml(await generate(prompt));
}

async function translate(html) {
  const text = U.stripTags(html).slice(0, 5000);
  const prompt = `Μετάφρασε στα ελληνικά το παρακάτω κείμενο προϊόντος. Κράτα ονόματα μάρκας, μοντέλα, κωδικούς και μονάδες όπως είναι. Κράτα τις λίστες ως γραμμές που ξεκινούν με παύλα. Επέστρεψε μόνο τη μετάφραση.

${text}`;
  return toHtml(await generate(prompt));
}

module.exports = { status, generate, describe, translate };
