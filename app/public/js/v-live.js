/* «Τι κάνει τώρα»: every computer, every job, the queue and the services — live, every 4 seconds, from real signs. */
'use strict';
(function () {
  const { h, clear, fmt, GET } = App;
  const STATE = {
    moving: ['Εκτελείται · προχωρά', 'ok'], running: ['Εκτελείται', 'ok'], waiting: ['Περιμένει', 'warn'], starting: ['Ξεκινά', ''],
    stalled: ['Χωρίς «ζω»', 'warn'], orphan: ['Χωρίς ενεργό εργάτη', 'crit'], unknown: ['Άγνωστο', ''], queued: ['Στη σειρά', ''],
  };
  const VERDICT = { working: 'ok', idle: '', stopped: 'warn', off: '', unknown: 'warn', crit: 'crit' };
  const SVC = { ok: ['ΟΚ', 'ok'], warn: ['ΠΡΟΣΟΧΗ', 'warn'], crit: ['ΠΡΟΒΛΗΜΑ', 'crit'], paused: ['ΠΑΥΣΗ', 'warn'], unknown: ['ΑΓΝΩΣΤΟ', ''], error: ['ΠΡΟΒΛΗΜΑ', 'crit'] };
  const dur = (ms) => (ms == null ? '—' : ms < 60000 ? Math.max(1, Math.round(ms / 1000)) + '″' : ms < 3600000 ? Math.round(ms / 60000) + '′' : (ms / 3600000).toFixed(1).replace('.', ',') + ' ώρες');
  const time = (t) => new Date(t).toLocaleTimeString('el-GR', { timeZone: 'Europe/Athens', hour: '2-digit', minute: '2-digit', second: '2-digit' });

  function jobRow(j) {
    const st = STATE[j.state] || STATE.unknown;
    const pct = j.total ? Math.min(100, Math.round((j.done / j.total) * 100)) : null;
    return h('details', { class: 'lv-job ' + st[1] },
      h('summary', null,
        h('span', { class: 'pill ' + st[1] }, st[0]),
        h('span', { class: 'lv-job-what' }, h('b', null, j.kindLabel.split(' (')[0]), j.what ? ' · ' + j.what : ''),
        h('span', { class: 'lv-job-prog' }, j.total ? `${fmt.num(j.done)}/${fmt.num(j.total)}` : '—', j.via ? ' · ' + j.via : '')),
      pct != null ? h('div', { class: 'lv-bar' }, h('i', { style: { width: pct + '%' } })) : null,
      h('ul', { class: 'lv-facts' },
        h('li', null, h('b', null, 'Τι κάνει: '), j.msg || j.label),
        h('li', null, h('b', null, 'Κατάσταση: '), j.text),
        h('li', null, h('b', null, 'Εργάτης: '), j.runner != null ? `#${j.runner}${j.lane ? ' (γρήγορη λωρίδα ' + (j.lane === 'ai.call' ? 'AI' : 'ενός προϊόντος') + ')' : ''}` : 'κανένας'),
        h('li', null, h('b', null, 'Ξεκίνησε: '), j.startedAt ? `${time(j.startedAt)} · διαρκεί ${dur(j.ms)}` : '—'),
        h('li', null, h('b', null, 'Τελευταίο «ζω»: '), j.beatAgoMs != null ? `πριν από ${dur(j.beatAgoMs)}` : '—', ' · ', h('b', null, 'τελευταία πρόοδος: '), j.progressAgoMs != null ? `πριν από ${dur(j.progressAgoMs)}` : '—'),
        h('li', null, h('b', null, 'Προσπάθεια: '), `${j.attempts || 1} από ${j.maxAttempts || '?'}`),
        j.error ? h('li', { class: 'crit' }, h('b', null, 'Σφάλμα: '), j.error) : null));
  }

  function card(c) {
    const vcls = VERDICT[c.verdict.state] || '';
    const gauge = (label, v) => (v == null ? null : h('div', { class: 'lv-gauge ' + (v >= 90 ? 'hot' : v >= 65 ? 'warm' : '') }, h('span', null, label), h('b', null, v + '%'), h('div', { class: 'lv-bar' }, h('i', { style: { width: v + '%' } }))));
    return h('div', { class: 'panel lv-card ' + vcls },
      h('div', { class: 'lv-head' },
        h('div', null, h('h3', null, c.name), h('div', { class: 'faint' }, [c.online ? 'online' : 'offline', c.rev ? 'έκδοση ' + c.rev + (c.revOk ? '' : ' (παλιά)') : '', c.perf ? 'προφίλ ' + c.perf : '', c.lastSeen ? 'επικοινωνία ' + time(c.lastSeen) : ''].filter(Boolean).join(' · '))),
        h('span', { class: 'pill ' + vcls }, c.verdict.text)),
      h('div', { class: 'lv-gauges' }, gauge('CPU', c.cpu), gauge('RAM', c.ram),
        h('div', { class: 'lv-ai ' + (c.ai.state === 'busy' ? 'ok' : c.ai.state === 'idle' ? '' : 'warn') }, h('span', null, 'AI'), h('b', null, c.ai.state === 'busy' ? 'δουλεύει' : c.ai.state === 'idle' ? 'συνδεδεμένο' : c.ai.state === 'nomodel' ? 'χωρίς μοντέλο' : 'κλειστό'), h('small', null, c.ai.models.slice(0, 2).join(', ') || c.ai.text))),
      // the seven layers: talks · worker · runners · places · handed · really running · results
      h('ol', { class: 'lv-layers' }, c.layers.map((x) => h('li', { class: x.ok ? 'ok' : 'bad' }, h('span', { class: 'lv-dot' }), h('span', null, x.label), h('b', null, x.text)))),
      h('h4', { class: 'needs-h' }, `Τι εκτελεί τώρα (${c.jobs.length})`),
      c.jobs.length ? h('div', { class: 'stack s' }, c.jobs.map(jobRow)) : h('p', { class: 'faint' }, 'Καμία εργασία αυτή τη στιγμή.'),
      c.recent.length ? h('details', { class: 'lv-recent' }, h('summary', null, `Πρόσφατες εργασίες (${c.recent.length})`),
        h('ul', { class: 'todo-list' }, c.recent.map((r) => h('li', { class: r.status === 'failed' ? 'crit' : '' }, h('b', null, (r.status === 'completed' ? '✓ ' : r.status === 'failed' ? '✗ ' : '· ') + r.kindLabel.split(' (')[0]), r.what ? ' · ' + r.what : '', h('div', { class: 'faint' }, [r.endedAt ? time(r.endedAt) : '', r.ms ? 'σε ' + dur(r.ms) : '', r.error ? r.error.slice(0, 140) : ''].filter(Boolean).join(' · ')))))) : null,
      c.runners.length ? h('details', null, h('summary', null, `Εργάτες (${c.runners.length})`),
        h('ul', { class: 'todo-list' }, c.runners.map((r) => h('li', null, h('b', null, `#${r.i}${r.lane ? (r.lane === 'ai.call' ? ' · λωρίδα AI' : ' · λωρίδα ενός προϊόντος') : ''}: `), r.busy ? r.job : r.paused ? 'σε αναμονή (προφίλ / μπαταρία)' : 'ελεύθερος', r.rssMB ? h('span', { class: 'faint' }, ` · ${r.rssMB} MB`) : null)))) : null);
  }

  /** The panel: put it on a page; it refreshes itself while it is on the screen. */
  App.livePanel = function livePanel() {
    const box = h('div', { class: 'stack lv' });
    const head = h('div', { class: 'row', style: { justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' } }, h('h2', { style: { margin: 0 } }, 'Τι κάνει τώρα'), h('span', { class: 'faint lv-at' }, 'φόρτωση…'));
    const body = h('div', { class: 'stack' });
    box.appendChild(h('div', { class: 'panel' }, head, body));
    let failed = 0;
    const draw = (d) => {
      clear(body);
      head.lastChild.textContent = `ενημέρωση ${time(d.at)} · κάθε 4″ · όλοι οι αριθμοί από την ίδια στιγμή`;
      if (d.starting) { body.appendChild(h('div', { class: 'note' }, 'Το πρόγραμμα στο cloud ξεκινάει: σε λίγο.')); return; }
      const q = d.queue;
      // the queue in one line: what waits, what is handed out, what really runs, what moves, what has no runner
      body.appendChild(h('div', { class: 'lv-q' },
        [['Στη σειρά', q.queued, ''], ['Δόθηκαν', q.assigned, ''], ['Με ενεργό εργάτη', q.withRunner, 'ok'], ['Προχωρούν', q.moving, 'ok'], ['Χωρίς εργάτη', q.orphan, q.orphan ? 'crit' : ''], ['Έληξε ο χρόνος', q.expired, q.expired ? 'warn' : ''], ['Απέτυχαν (24ω)', q.failed24, q.failed24 ? 'warn' : ''], ['Ολοκληρώθηκαν (24ω)', q.done24, '']]
          .map(([l, v, c]) => h('div', { class: 'lv-q-i ' + c }, h('b', null, fmt.num(v || 0)), h('span', null, l)))));
      if (q.orphan) body.appendChild(h('div', { class: 'note crit' }, `${q.orphan === 1 ? 'Μία εργασία φαίνεται' : q.orphan + ' εργασίες φαίνονται'} σε εκτέλεση, αλλά κανένας εργάτης δεν την έχει: ο υπολογιστής επικοινωνεί, η εργασία όμως δεν εκτελείται. Επιστρέφει μόνη της στη σειρά.`));
      // by kind of work
      if (d.byKind.length) body.appendChild(h('details', { class: 'lv-kinds', open: true }, h('summary', null, 'Ανά είδος εργασίας'),
        h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl lv-tbl' }, h('thead', null, h('tr', null, ['Εργασία', 'Τώρα', 'Σειρά', 'Ξανά', 'Απέτυχαν', 'Έγιναν'].map((x, i) => h('th', i ? { class: 'num' } : null, x)))),
          h('tbody', null, d.byKind.map((k) => h('tr', null, h('td', { title: k.label }, k.label.split(' (')[0].replace(' / συλλογή τιμών', '')), h('td', { class: 'num' }, fmt.num(k.running)), h('td', { class: 'num' }, fmt.num(k.queued)), h('td', { class: 'num' }, fmt.num(k.retry)), h('td', { class: 'num' + (k.failed ? ' crit' : '') }, fmt.num(k.failed)), h('td', { class: 'num' }, fmt.num(k.done)))))))));
      if (!d.computers.length) body.appendChild(h('p', { class: 'faint' }, 'Κανένας υπολογιστής δεν έχει συνδεθεί: η δουλειά γίνεται (αργά) στο cloud.'));
      for (const c of d.computers) body.appendChild(card(c));
      if (d.cloud && d.cloud.length) body.appendChild(h('div', { class: 'panel' }, h('h4', { class: 'needs-h' }, `Στο cloud (${d.cloud.length})`), h('div', { class: 'stack s' }, d.cloud.map(jobRow))));
      // the outside services, each apart
      const S = d.services || {};
      const svc = (name, x) => { const l = SVC[x.state] || SVC.unknown; return h('li', null, h('span', { class: 'pill ' + l[1] }, l[0]), ' ', h('b', null, name + ': '), x.text); };
      body.appendChild(h('details', { class: 'lv-svc', open: true }, h('summary', null, 'Εξωτερικές υπηρεσίες'),
        h('ul', { class: 'todo-list' },
          (S.engines || []).map((e) => svc(e.name, e)),
          d.computers.map((c) => svc('Ollama · ' + c.name, { state: c.ai.state === 'down' || c.ai.state === 'nomodel' ? 'crit' : 'ok', text: c.ai.text + (c.ai.models.length ? ' (' + c.ai.models.slice(0, 3).join(', ') + ')' : '') })),
          S.db ? svc('Βάση δεδομένων', S.db) : null, S.backup ? svc('Αντίγραφο GitHub', S.backup) : null, S.cloud ? svc('Render (cloud)', S.cloud) : null,
          (S.sites || []).map((x) => svc(x.name, x)))));
    };
    let n = 0;
    const tick = async () => {
      if (n++ > 1 && !document.body.contains(box)) return; // left the screen: no more updates
      try { draw(await GET('/api/workers/live')); failed = 0; } catch (e) { failed++; head.lastChild.textContent = 'δεν απαντά τώρα · ξανά σε λίγο'; }
      setTimeout(tick, 4000);
    };
    setTimeout(tick, 0);
    return box;
  };
})();
