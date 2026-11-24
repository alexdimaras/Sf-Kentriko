'use strict';
// SF Κέντρο — the «Πακέτο διάγνωσης για AI» (audit 23/11, phase 2): one file that tells an AI (Claude in the cloud, or
// any other) how the program is RIGHT NOW — what the repository alone cannot: the version that runs, the health of each
// part with its evidence, the computers, the AI, the queue, the last failures and events, and which runbook applies.
// Made only when a person asks; shown to them before it goes anywhere; no password, token, key, cookie, database
// address or e-mail address in it (every line goes through events.redact), no names of the shop's users.
const fs = require('fs');
const path = require('path');
const events = require('./events');

// which part of docs/RUNBOOKS.md answers which events
const RUNBOOK_OF = [
  [/^(DB_|HEALTH_DB|HEALTH_SAVE)/, 'Η βάση δεδομένων'], [/BACKUP/, 'Ημερήσιο αντίγραφο'], [/^(JOB_|LEASE_|HEALTH_QUEUE)/, 'Ουρά εργασιών'],
  [/^(WORKER_|RUNNER_)/, 'Υπολογιστής'], [/^(AI_|OLLAMA_)/, 'AI'], [/^(SEARCH_|PAGES_)/, 'Έρευνα internet'], [/^ENGINE_/, 'Ετοιμάζονται τα στοιχεία'],
];
function runbookSections(codes) {
  let text = '';
  try { text = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'RUNBOOKS.md'), 'utf8'); } catch (_) { return []; }
  const parts = text.split(/\n(?=## )/);
  const want = new Set();
  for (const c of codes) for (const [re, title] of RUNBOOK_OF) if (re.test(c)) want.add(title);
  return parts.filter((p) => [...want].some((t) => p.startsWith('## ') && p.split('\n')[0].includes(t))).map((p) => p.trim());
}

/**
 * d: { build, workerRev, status (systemStatus), health (health.view), workers (coord.workersView), queue (coord.healthOf),
 *      failed (failed jobs), settings } → { name, markdown, json }
 */
function bundle(d) {
  const at = new Date();
  const ev = events.query({ severity: 'warn', limit: 60 });
  const sum = events.summary();
  const s = d.settings || {};
  const safeSettings = {
    minShops: s.minShops, strategy: s.strategy, marketAuto: !!s.marketAuto, variantSku: s.variantSku, autoSyncHours: s.autoSyncHours,
    localAI: s.localAI ? { enabled: !!s.localAI.enabled, model: s.localAI.model || '', research: s.localAI.research !== false } : null,
    webResearch: s.webResearch ? { maxQueries: s.webResearch.maxQueries, maxPages: s.webResearch.maxPages, minShops: s.webResearch.minShops } : null,
  };
  const workers = (d.workers || []).map((w) => ({
    name: w.name, online: !!w.online, mode: w.mode || 'off', perf: w.perf || 'normal', rev: (w.caps && w.caps.rev) || '', lastSeen: w.lastSeen,
    ollama: w.caps ? { models: (w.caps.ollama || []).slice(0, 5), ok: !!(w.caps.ollamaInfo && w.caps.ollamaInfo.ok), error: w.caps.ollamaInfo ? w.caps.ollamaInfo.error || '' : 'δεν αναφέρθηκε' } : null,
    jobs: (w.jobs || []).length,
  }));
  const json = {
    made: at.toISOString(), app: d.build, workerRev: d.workerRev,
    status: (d.status && d.status.items || []).map((x) => ({ id: x.id, level: x.level, text: x.text })), overall: d.status ? d.status.level : 'unknown',
    health: d.health || {}, workers, queue: d.queue || null,
    failedJobs: (d.failed || []).slice(0, 15).map((j) => ({ type: j.type, label: j.label, error: j.error, attempts: j.attempts, at: j.endedAt ? new Date(j.endedAt).toISOString() : null })),
    events: ev.map((e) => ({ at: e.at, last: e.last, count: e.count, severity: e.severity, service: e.service, code: e.code, message: e.message, jobId: e.jobId, rid: e.rid })),
    eventSummary24h: sum, settings: safeSettings,
  };
  const L = (x) => events.redact(x, 4000);
  const lines = [];
  lines.push(`# SF Κέντρο — πακέτο διάγνωσης (${at.toISOString()})`, '');
  lines.push('> Για AI: διάβασε πρώτα `AGENTS.md`, `docs/STATE.md`, `docs/BUGS.md`. Τα παρακάτω είναι η κατάσταση της στιγμής (χωρίς μυστικά).', '');
  lines.push('## Έκδοση', `- εφαρμογή ${d.build.version} · commit ${d.build.sha || '—'} · branch ${d.build.branch || '—'} · ξεκίνησε ${d.build.startedAt || '—'}`, `- worker rev (τρέχουσα): ${d.workerRev}`, '');
  lines.push(`## Υγεία — συνολικά: ${(json.overall || 'unknown').toUpperCase()}`);
  for (const x of json.status) lines.push(`- [${(x.level || '?').toUpperCase()}] ${x.id}: ${L(x.text)}`);
  lines.push('');
  lines.push('## Υπολογιστές');
  if (!workers.length) lines.push('- κανένας συνδεδεμένος');
  for (const w of workers) lines.push(`- ${w.name}: ${w.online ? 'online' : 'offline'} · mode ${w.mode} · προφίλ ${w.perf} · rev ${w.rev || '—'}${w.rev && w.rev < d.workerRev ? ' (ΠΑΛΙΑ)' : ''} · Ollama ${w.ollama ? (w.ollama.ok ? 'ok ' + w.ollama.models.join(', ') : 'όχι: ' + L(w.ollama.error)) : '—'} · εργασίες ${w.jobs}`);
  lines.push('');
  // (the moment of this pack: the health line above was measured at its own time — the two can differ, said so)
  if (d.queue) lines.push('## Ουρά (τώρα, ' + new Date(d.made || Date.now()).toLocaleTimeString('el-GR', { timeZone: 'Europe/Athens' }) + ')', `- σε αναμονή ${d.queue.queued} · τρέχουν ${d.queue.running} · κολλημένες ${d.queue.stuck} · >2 μέρες ${d.queue.old} · αποτυχίες 24ώρου ${d.queue.failed}`, '');
  if (json.failedJobs.length) { lines.push('## Τελευταίες αποτυχημένες εργασίες'); for (const j of json.failedJobs) lines.push(`- ${j.at || ''} ${j.type} «${L(j.label)}»: ${L(j.error)} (προσπάθειες ${j.attempts})`); lines.push(''); }
  lines.push('## Συμβάντα (προσοχή / σφάλματα, νεότερα πρώτα)');
  if (!ev.length) lines.push('- κανένα');
  for (const e of ev) lines.push(`- ${e.last || e.at} [${e.severity}] ${e.service}/${e.code}${e.count > 1 ? ' ×' + e.count : ''}: ${L(e.message)}${e.jobId ? ' · job ' + e.jobId : ''}${e.rid ? ' · request ' + e.rid : ''}`);
  lines.push('');
  lines.push('## Ρυθμίσεις (μόνο όσες δεν είναι μυστικές)', '```json', JSON.stringify(safeSettings, null, 2), '```', '');
  const rb = runbookSections(ev.map((e) => e.code));
  if (rb.length) { lines.push('## Σχετικές οδηγίες (docs/RUNBOOKS.md)', ''); for (const r of rb) lines.push(r, ''); }
  lines.push('## Τα ίδια ως JSON', '```json', events.redact(JSON.stringify(json, null, 2), 300000), '```'); // (cleaned once more below)
  const markdown = events.redact(lines.join('\n'), 600000); // (once more over everything: nothing secret slips through)
  const stamp = at.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  // (the JSON given back to the screen is cleaned the same way, every text of it)
  const deep = (v) => (typeof v === 'string' ? events.redact(v, 20000) : Array.isArray(v) ? v.map(deep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : v);
  return { name: `sf-kentro-diagnosi-${stamp}.md`, markdown, json: deep(json) };
}

module.exports = { bundle, runbookSections };
