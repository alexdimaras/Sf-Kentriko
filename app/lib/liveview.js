'use strict';
// SF Κέντρο — «τι κάνει τώρα ο υπολογιστής», from REAL signs only (asked 25/11): one moment for every number.
//
// Seven things that are NOT the same, told apart for every computer and every job:
//   1. the computer talks to the cloud (its «I am here», every 15″)
//   2. its worker is active (the mode: always / only with the program open / stopped)
//   3. its runner processes are alive (its own report, every 3″)
//   4. free places for work
//   5. jobs handed to it
//   6. jobs a runner of it really runs (the runner says it holds it AND its «still working» is fresh)
//   7. jobs that move (the count / the step changed lately) and jobs that bring results back
// A job is never «Εκτελείται» because of a lease or a heartbeat alone.
// Pure: everything comes in as arguments (the tests give their own).

const KIND = {
  'market.shop': ['shop', 'Ανάγνωση καταστήματος / συλλογή τιμών'],
  'codes.web': ['web', 'Έρευνα internet (κωδικοί, EAN, φωτογραφίες, μάρκα, τιμή)'],
  'codes.one': ['one', 'Έρευνα ενός προϊόντος (που ζήτησες)'],
  'ai.call': ['ai', 'Ερώτηση στο AI'],
  'research.measure': ['measure', 'Μέτρηση της έρευνας'],
};
const kindOf = (type) => KIND[type] || ['other', type];
// what each kind is doing, in words (the step comes from the job's own progress text)
const ENGINE_OF = (msg) => (/duckduckgo|ddg/i.test(msg) ? 'DuckDuckGo' : /bing/i.test(msg) ? 'Bing' : /yahoo/i.test(msg) ? 'Yahoo' : /ollama|AI/.test(msg) ? 'Ollama' : /woo/i.test(msg) ? 'WooCommerce' : /shopify/i.test(msg) ? 'Shopify' : /χάρτη|sitemap/i.test(msg) ? 'χάρτης του site' : '');

const BEAT_FRESH = 45000;       // a «still working» within this = the runner is there
const MOVE_FRESH = 3 * 60000;   // the count / the step changed within this = it moves
const LOAD_FRESH = 20000;       // the computer's own report within this = what it says is true now

/**
 * in: { now, snap: { live, recent } (coord.snapshot), workers: coord.workersView(), loads: Map(id → load),
 *       active: (w) → bool, workerRev, services: { ... } }
 */
function build(o) {
  const t = o.now || Date.now();
  const loads = o.loads || new Map();
  const live = (o.snap && o.snap.live) || [];
  const recent = (o.snap && o.snap.recent) || [];
  const day = t - 864e5;
  const computers = (o.workers || []).map((w) => {
    const l = loads.get(w.id);
    const fresh = !!(l && t - l.at < LOAD_FRESH);
    const held = new Map(((fresh && l.held) || []).map((x) => [x.id, x]));
    const active = o.active ? !!o.active(w) : w.mode !== 'off';
    const mine = live.filter((j) => j.workerId === w.id);
    const jobs = mine.map((j) => jobState(j, held, fresh, t));
    const runnersAlive = fresh ? (l.runnerList ? l.runnerList.length : l.runners || 0) : 0;
    const general = fresh && l.runnerList ? l.runnerList.filter((r) => !r.lane) : [];
    const slots = fresh ? (l.perf && l.perf.slots) || l.slots || 0 : 0;
    const executing = jobs.filter((j) => j.state === 'running' || j.state === 'moving' || j.state === 'waiting');
    const done = recent.filter((j) => j.workerId === w.id && j.endedAt && j.endedAt > day);
    const layers = [
      { id: 'online', label: 'Επικοινωνεί με το cloud', ok: !!w.online, text: w.online ? 'ναι' : 'όχι' + (w.lastSeen ? ` (τελευταία φορά ${ago(t, w.lastSeen)})` : '') },
      { id: 'worker', label: 'Ο worker δουλεύει', ok: w.online && active, text: !w.online ? '—' : active ? MODE[w.mode] || w.mode : 'σταματημένος (' + (MODE[w.mode] || w.mode) + ')' },
      { id: 'runners', label: 'Εργάτες (processes) ζωντανοί', ok: runnersAlive > 0, text: fresh ? `${runnersAlive}${general.length ? ` (${general.filter((r) => !r.paused).length} για όλες τις εργασίες, ${runnersAlive - general.length} γρήγορες λωρίδες)` : ''}` : 'καμία αναφορά τα τελευταία 20″' },
      { id: 'slots', label: 'Ελεύθερες θέσεις', ok: fresh && slots > 0, text: fresh ? `${Math.max(0, slots - jobs.filter((j) => j.kind !== 'ai' && j.kind !== 'one').length)} από ${slots}` : '—' },
      { id: 'assigned', label: 'Εργασίες που του δόθηκαν', ok: true, text: String(jobs.length) },
      { id: 'running', label: 'Εκτελούνται πραγματικά', ok: !jobs.some((j) => j.state === 'orphan'), text: `${executing.length}${jobs.some((j) => j.state === 'orphan') ? ` · ${jobs.filter((j) => j.state === 'orphan').length} χωρίς ενεργό εργάτη` : ''}` },
      { id: 'results', label: 'Φέρνουν αποτελέσματα (24 ώρες)', ok: !done.length || done.some((j) => j.status === 'completed'), text: `${done.filter((j) => j.status === 'completed').length} ολοκληρώθηκαν · ${done.filter((j) => j.status === 'failed').length} απέτυχαν` },
    ];
    // one sentence for the whole card: does it really work?
    const orphans = jobs.filter((j) => j.state === 'orphan').length;
    const verdict = !w.online ? ['off', 'Κλειστός ή χωρίς σύνδεση'] : !active ? ['stopped', 'Σταματημένος: δεν παίρνει δουλειά'] : !fresh ? ['unknown', 'Επικοινωνεί, αλλά δεν στέλνει αναφορά φόρτου (παλιός worker ή κολλημένος)'] : orphans ? ['crit', `Επικοινωνεί, αλλά ${orphans === 1 ? 'μία εργασία δεν εκτελείται' : orphans + ' εργασίες δεν εκτελούνται'} από ενεργό εργάτη`] : executing.length ? ['working', `Δουλεύει: ${executing.length} ${executing.length === 1 ? 'εργασία' : 'εργασίες'}`] : ['idle', 'Έτοιμος, χωρίς δουλειά αυτή τη στιγμή'];
    const old = o.workerRev && String((w.caps && w.caps.rev) || '') < o.workerRev;
    return {
      id: w.id, name: w.name, online: !!w.online, lastSeen: w.lastSeen, rev: (w.caps && w.caps.rev) || '', revOk: !old, mode: w.mode, perf: fresh && l.perf ? l.perf.label || l.perf.used : w.perf,
      cpu: fresh ? l.cpu : null, ram: fresh ? l.ram : null, ramTotalMB: fresh ? l.ramTotalMB : (w.caps && w.caps.ramMB) || null, freeMB: w.caps && w.caps.freeMB,
      verdict: { state: verdict[0], text: verdict[1] }, layers,
      ai: aiOf(w, fresh ? l : null, jobs),
      engines: fresh ? l.engines || {} : {},
      perHour: fresh ? l.perHour || {} : {},
      runners: fresh && l.runnerList ? l.runnerList.map((r) => ({ i: r.i, lane: r.lane, busy: !!r.job, paused: r.paused, rssMB: r.rssMB, job: r.job ? (mine.find((j) => j.id === r.job) || {}).label || r.job : '' })) : [],
      jobs,
      recent: recent.filter((j) => j.workerId === w.id).slice(0, 12).map((j) => ({ id: j.id, kind: kindOf(j.type)[0], kindLabel: kindOf(j.type)[1], label: j.label, what: j.what, status: j.status, endedAt: j.endedAt, ms: j.endedAt && j.startedAt ? j.endedAt - j.startedAt : null, error: j.error })),
    };
  });
  // the whole queue, by kind of work: running / waiting / again after a failure / failed / done (one day)
  const byKind = {};
  const k0 = (type) => { const [id, label] = kindOf(type); return byKind[id] || (byKind[id] = { id, label, running: 0, queued: 0, retry: 0, failed: 0, done: 0 }); };
  for (const j of live) { const b = k0(j.type); if (j.status === 'queued') { if (j.attempts > 0) b.retry++; else b.queued++; } else b.running++; }
  for (const j of recent) if (j.endedAt && j.endedAt > day) { const b = k0(j.type); if (j.status === 'failed') b.failed++; else if (j.status === 'completed') b.done++; }
  const allJobs = computers.flatMap((c) => c.jobs);
  const cloudJobs = live.filter((j) => j.workerId === 'cloud').map((j) => jobState(j, new Map(), false, t, true));
  return {
    at: t,
    queue: {
      queued: live.filter((j) => j.status === 'queued').length,
      assigned: live.filter((j) => j.status !== 'queued').length,
      withRunner: allJobs.filter((j) => j.runner != null).length + cloudJobs.length,
      moving: allJobs.filter((j) => j.state === 'moving').length + cloudJobs.filter((j) => j.state === 'moving').length,
      orphan: allJobs.filter((j) => j.state === 'orphan').length,
      expired: live.filter((j) => j.status !== 'queued' && j.leaseUntil && j.leaseUntil < t).length,
      failed24: recent.filter((j) => j.status === 'failed' && j.endedAt > day).length,
      done24: recent.filter((j) => j.status === 'completed' && j.endedAt > day).length,
    },
    byKind: Object.values(byKind),
    computers, cloud: cloudJobs,
    services: o.services || {},
  };
}
const MODE = { always: 'πάντα', app: 'μόνο με ανοιχτό πρόγραμμα', off: 'σταματημένος' };
function ago(t, x) { const s = Math.round((t - new Date(x).getTime()) / 1000); return s < 90 ? `${s}″` : s < 5400 ? `${Math.round(s / 60)}′` : `${Math.round(s / 3600)} ώρες`; }

/** One job as it really is: running (a runner holds it, «still working» fresh) / moving / waiting / orphan / … */
function jobState(j, held, fresh, t, cloud) {
  const [kind, kindLabel] = kindOf(j.type);
  const h = held.get(j.id);
  const byRunner = !!(h && (!h.attempt || h.attempt === j.attempts));
  const beatOk = j.beatAt && t - j.beatAt < BEAT_FRESH;
  const moved = j.progressAt && t - j.progressAt < MOVE_FRESH;
  let state, text;
  if (j.status === 'queued') { state = 'queued'; text = j.attempts ? `Ξανά στη σειρά (προσπάθεια ${j.attempts + 1} από ${j.maxAttempts || '?'})` : 'Στη σειρά'; }
  else if (cloud) { state = moved ? 'moving' : 'running'; text = 'Εκτελείται στο cloud'; }
  else if (!fresh) { state = 'unknown'; text = 'Δεν ξέρουμε: ο υπολογιστής δεν έστειλε αναφορά τα τελευταία 20″'; }
  else if (!byRunner) {
    // (just handed out: the runner takes it in a few seconds)
    if (j.startedAt && t - j.startedAt < 10000) { state = 'starting'; text = 'Μόλις δόθηκε: ξεκινά'; }
    else { state = 'orphan'; text = 'Ο υπολογιστής επικοινωνεί, αλλά η εργασία δεν εκτελείται από ενεργό εργάτη'; }
  } else if (!beatOk) { state = 'stalled'; text = 'Ο εργάτης την έχει, αλλά δεν έστειλε «ζω» για ' + ago(t, j.beatAt || j.startedAt || t); }
  else if (/AI.*σειρά|περιμένει|αναμονή/i.test(j.msg || '')) { state = 'waiting'; text = 'Περιμένει: ' + j.msg; }
  else if (moved) { state = 'moving'; text = 'Εκτελείται και προχωρά'; }
  else { state = 'running'; text = 'Εκτελείται (χωρίς νέα πρόοδο τα τελευταία 3′)'; }
  return {
    id: j.id, kind, kindLabel, label: j.label, what: j.what, state, text, runner: byRunner ? h.runner : null, lane: byRunner ? h.lane : '',
    startedAt: j.startedAt, ms: j.startedAt ? t - j.startedAt : null, beatAgoMs: j.beatAt ? t - j.beatAt : null, progressAgoMs: j.progressAt ? t - j.progressAt : null,
    done: j.done, total: j.total, msg: j.msg, via: ENGINE_OF(j.msg || ''), attempts: j.attempts, maxAttempts: j.maxAttempts, error: j.error, cancel: j.cancel,
  };
}

/** The AI of a computer: installed, connected, really answering a question now, or waiting for its turn. */
function aiOf(w, l, jobs) {
  const info = (w.caps && w.caps.ollamaInfo) || {};
  const models = (w.caps && w.caps.ollama) || [];
  const asking = jobs.filter((j) => j.kind === 'ai' && (j.state === 'running' || j.state === 'moving'));
  const state = !info.ok ? 'down' : !models.length ? 'nomodel' : l && l.ai && l.ai.busy ? 'busy' : asking.length ? 'busy' : 'idle';
  const TEXT = { down: 'Το Ollama δεν απαντά' + (info.error ? ` (${info.error})` : ''), nomodel: 'Το Ollama απαντά, αλλά δεν έχει μοντέλο που γράφει κείμενο', busy: 'Απαντά τώρα σε ερώτηση' + (l && l.ai && l.ai.waiting ? ` · ${l.ai.waiting} περιμένουν` : ''), idle: 'Συνδεδεμένο, χωρίς ερώτηση αυτή τη στιγμή' };
  return { state, text: TEXT[state], models: models.slice(0, 6), version: info.version || '' };
}

module.exports = { build, jobState, aiOf, KIND, BEAT_FRESH, MOVE_FRESH, LOAD_FRESH };
