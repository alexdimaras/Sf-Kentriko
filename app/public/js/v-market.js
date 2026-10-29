/* Τιμές αγοράς — every product compared with the whole catalog of every competitor, every day */
'use strict';
(function () {
  const { h, clear, btn, icon, fmt, GET, POST, toast, fail, modal, dlgHead, thumb, pageHead, siteName, fileReady, watchJob, confirmBox, debounce } = App;
  const VERDICT = { expensive: 'Ακριβότερο', cheap: 'Πολύ φθηνότερο', ok: 'Στην αγορά', nodata: 'Χωρίς σίγουρη τιμή' };

  function rangeBar(stats, ours) {
    if (!stats || !stats.count) return h('span', { class: 'faint' }, '—');
    const lo = Math.min(stats.min, ours || stats.min) * 0.97, hi = Math.max(stats.max, ours || stats.max) * 1.03;
    const pos = (v) => ((v - lo) / (hi - lo || 1)) * 100 + '%';
    return h('div', { class: 'range', title: `Φθηνότερο ${fmt.money(stats.min)} · μέση ${fmt.money(stats.median)} · ακριβότερο ${fmt.money(stats.max)}${ours ? ' · δική μας ' + fmt.money(ours) : ''}` },
      h('div', { class: 'track' }), h('div', { class: 'span', style: { left: pos(stats.min), width: `calc(${pos(stats.max)} - ${pos(stats.min)})` } }), h('div', { class: 'med', style: { left: pos(stats.median) } }), ours ? h('div', { class: 'ours', style: { left: pos(ours) } }) : null);
  }

  function decide(ctx, url, answer) {
    return POST('/api/market/decide', { site: ctx.site, id: ctx.id, url, answer }).then(() => { toast(answer === 'yes' ? 'Μετράει πλέον στην τιμή (το θυμάμαι και για τις επόμενες έρευνες).' : answer === 'no' ? 'Δεν μετράει (το θυμάμαι).' : 'Επαναφορά.'); if (ctx.refresh) ctx.refresh(); }).catch(fail);
  }

  /** Market box for one product (also used in the product drawer). */
  App.marketSummary = function (m, ours, ctx) {
    const st = m.stats || { count: 0 };
    const box = h('div', { class: 'stack s' });
    if (m.master) box.appendChild(h('div', { class: 'note' }, 'Το προϊόν υπάρχει και στο ' + siteName('sf') + ': ισχύει η έρευνα και η τιμή του ' + siteName('sf') + '.'));
    if (!st.count) box.appendChild(h('p', { class: 'muted' }, (st.outOfStock ? 'Το ίδιο προϊόν υπάρχει σε ' + st.outOfStock + ' κατάστημα/τα αλλά είναι εξαντλημένο εκεί, οπότε δεν μετράει στην τιμή' : 'Δεν βρέθηκε σίγουρα το ίδιο προϊόν σε άλλο κατάστημα') + (m.at ? ' (' + fmt.dateTime(m.at) + ')' : '') + '.' + (st.similar ? ' Υπάρχουν παρόμοια: επιβεβαίωσέ τα παρακάτω.' : ' Πρόσθεσε τιμή με το χέρι αν το ξέρεις.')));
    else {
      box.appendChild(h('div', { class: 'row', style: { gap: '22px' } },
        h('div', null, h('div', { class: 'faint' }, 'Φθηνότερο'), h('b', null, fmt.money(st.min))),
        h('div', null, h('div', { class: 'faint' }, 'Μέση τιμή'), h('b', null, fmt.money(st.median))),
        h('div', null, h('div', { class: 'faint' }, 'Ακριβότερο'), h('b', null, fmt.money(st.max))),
        h('div', null, h('div', { class: 'faint' }, 'Προτεινόμενη'), h('b', { style: { color: 'var(--coyote)' } }, fmt.money(m.suggested)), m.raised ? h('div', { class: 'hint' }, 'ανέβηκε στο όριο κόστους') : null,
          h('div', { class: 'hint' }, { high: 'σίγουρη (3+ καταστήματα)', medium: 'μέτρια σιγουριά (2 καταστήματα)', low: 'μόνο 1 κατάστημα: έλεγξέ την' }[st.confidence] || '')),
        h('div', { class: 'grow', style: { minWidth: '160px' } }, rangeBar(st, ours))));
    }
    const list = h('div', { class: 'comp-list' });
    const order = (c) => (c.ignored ? 3 : c.match === 'exact' ? 0 : 1);
    for (const c of (m.competitors || []).slice().sort((a, b) => order(a) - order(b) || a.price - b.price)) {
      const pill = c.ignored ? h('span', { class: 'pill' }, 'δεν μετράει') : c.match === 'exact' ? h('span', { class: 'pill st' }, c.confirmed ? 'ίδιο ✓' : 'ίδιο') : h('span', { class: 'pill warn' }, 'παρόμοιο;');
      list.appendChild(h('div', { class: 'c' + (c.used ? '' : ' unused') },
        h('div', { class: 'row tight', style: { minWidth: 0, flexWrap: 'nowrap' } }, c.img ? thumb(c.img, 'sm') : null,
          h('div', { style: { minWidth: 0 } }, h('b', null, c.shop), c.manual ? h('span', { class: 'pill', style: { marginLeft: '6px' } }, 'χειροκίνητα') : null,
            h('div', { class: 'faint', style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, title: c.name }, c.name),
            c.why ? h('div', { class: 'hint', style: { margin: 0 } }, c.why) : null,
            c.note ? h('div', { class: 'hint', style: { margin: 0, color: 'var(--signal)' } }, c.note) : null)),
        h('div', null, pill, c.inStock === false ? h('div', { class: 'hint', style: { margin: 0 } }, 'εξαντλημένο') : null),
        h('div', { class: 'num' }, h('b', null, fmt.money(c.price)), c.prevPrice ? h('div', { class: 'hint', style: { margin: 0 } }, 'πριν ' + fmt.money(c.prevPrice)) : null),
        h('div', { class: 'row tight' }, c.url ? h('button', { class: 'x', title: 'Άνοιγμα της σελίδας τους', onclick: () => POST('/api/open', { kind: 'url', url: c.url }) }, icon('ext')) : null,
          ctx && !c.manual && c.match !== 'exact' && !c.ignored ? h('button', { class: 'btn sm', title: 'Είναι το ίδιο προϊόν: να μετράει στην τιμή', onclick: () => decide(ctx, c.url, 'yes') }, icon('check'), 'Ίδιο') : null,
          ctx && !c.ignored ? h('button', { class: 'btn sm ghost', title: 'Δεν είναι το ίδιο προϊόν', onclick: () => decide(ctx, c.url, 'no') }, icon('x'), 'Όχι') : null,
          ctx && (c.ignored || c.confirmed) ? h('button', { class: 'btn sm ghost', title: 'Να το κρίνει ξανά το πρόγραμμα', onclick: () => decide(ctx, c.url, '') }, 'Επαναφορά') : null)));
    }
    if ((m.competitors || []).length) box.appendChild(list);
    return box;
  };

  App.manualPrice = function (site, id, after) {
    const shop = h('input', { type: 'text', placeholder: 'π.χ. Skroutz — κατάστημα Χ', autofocus: true });
    const price = h('input', { type: 'text', placeholder: '0,00' });
    const url = h('input', { type: 'url', placeholder: 'https://… (προαιρετικά)' });
    modal.open(h('div', null, dlgHead('Τιμή ανταγωνιστή με το χέρι', 'Για καταστήματα που δεν διαβάζονται αυτόματα (π.χ. από Skroutz ή τηλεφωνικά).'),
      h('div', { class: 'grid3' }, h('label', { class: 'field' }, 'Κατάστημα', shop), h('label', { class: 'field' }, 'Τιμή με ΦΠΑ', price), h('label', { class: 'field' }, 'Σύνδεσμος', url)),
      h('div', { class: 'dlg-foot' }, btn('Άκυρο', () => modal.close()), btn('Προσθήκη', { cls: 'primary' }, () => POST('/api/market/manual', { site, id, shop: shop.value, price: price.value, url: url.value }).then(() => { modal.close(); toast('Προστέθηκε.'); if (after) after(); }).catch(fail)))));
  };

  function startRun(targets) {
    return POST('/api/market/run', { targets: targets || [] }).then((job) => {
      toast(targets && targets.length ? 'Η έρευνα ξεκίνησε.' : 'Η έρευνα για όλα τα προϊόντα ξεκίνησε: πρώτα ενημερώνονται οι κατάλογοι των ανταγωνιστών, μετά η σύγκριση. Μπορείς να συνεχίσεις τη δουλειά σου.');
      watchJob(job, { done: (r) => { if (r) toast(`Έρευνα τιμών: ${fmt.num(r.withData)} από ${fmt.num(r.done)} προϊόντα έχουν σίγουρη τιμή αγοράς · ${fmt.num(r.similar)} θέλουν επιβεβαίωση · ${fmt.num(r.changes)} αλλαγές τιμών.`, { ms: 9000 }); if (App.parseHash().view === 'market') App.route(); App.refreshBadges(); } });
    }).catch(fail);
  }

  App.views.market = {
    async render(main, p) {
      const tab = ['competitors', 'confirm', 'changes'].includes(p.tab) ? p.tab : 'results';
      const site = p.site === 'st' ? 'st' : 'sf';
      const s = App.state.settings;
      const head = await GET('/api/market', { site, per: 1 });
      const meta = head.meta || {};
      const sub = meta.lastRun
        ? `Τελευταία έρευνα ${fmt.dateTime(meta.lastRun)}: ${fmt.num(meta.compared)} προϊόντα σε ${meta.competitors} καταστήματα, σε ${meta.seconds} δευτ. ${s.marketAuto ? 'Τρέχει αυτόματα κάθε μέρα με το πρώτο άνοιγμα του προγράμματος.' : 'Η αυτόματη ημερήσια έρευνα είναι κλειστή (Ρυθμίσεις).'}`
        : 'Το πρόγραμμα κατεβάζει όλο τον κατάλογο κάθε ανταγωνιστή και συγκρίνει όλα τα προϊόντα σας: ίδια μάρκα, ίδιο μοντέλο, ίδια έκδοση.';
      main.appendChild(pageHead('Τιμές αγοράς', sub, [
        App.reportButtons('market', { site }, 'Λήψη'),
        btn('Έρευνα τώρα', { cls: 'primary', icon: 'market' }, () => startRun()),
      ]));
      if (meta.errors && meta.errors.length) main.appendChild(h('div', { class: 'note warn', style: { marginBottom: '12px' } }, h('b', null, 'Δεν ενημερώθηκαν: '), meta.errors.map((e) => e.name + ' (' + e.error + ')').join(' · '), h('div', { class: 'hint' }, 'Για αυτά χρησιμοποιήθηκαν οι τιμές της προηγούμενης έρευνας.')));
      main.appendChild(h('div', { class: 'tabs' },
        h('button', { 'aria-selected': String(tab === 'results'), onclick: () => App.go('market', { site }) }, 'Αποτελέσματα'),
        h('button', { 'aria-selected': String(tab === 'confirm'), onclick: () => App.go('market', { site, tab: 'confirm' }) }, 'Θέλουν επιβεβαίωση', head.counts.similar ? h('span', { class: 'badge med' }, fmt.num(head.counts.similar)) : null),
        h('button', { 'aria-selected': String(tab === 'changes'), onclick: () => App.go('market', { site, tab: 'changes' }) }, 'Αλλαγές ανταγωνιστών', head.changes && head.changes.length ? h('span', { class: 'badge' }, head.changes.length) : null),
        h('button', { 'aria-selected': String(tab === 'competitors'), onclick: () => App.go('market', { tab: 'competitors' }) }, 'Ανταγωνιστές')));
      if (tab === 'competitors') return renderCompetitors(main);
      if (tab === 'changes') return renderChanges(main, site, head);
      if (tab === 'confirm') return renderConfirm(main, site);
      return renderResults(main, site, p, head);
    },
  };

  async function renderResults(main, site, p, head) {
    if (!head.counts.all) {
      main.appendChild(h('div', { class: 'panel empty' }, h('h3', null, 'Δεν έχει γίνει έρευνα ακόμα'), h('p', null, 'Πάτα «Έρευνα τώρα»: κατεβαίνουν οι κατάλογοι των ανταγωνιστών (λίγα λεπτά την πρώτη φορά) και συγκρίνονται όλα τα προϊόντα σε δευτερόλεπτα. Μετά γίνεται μόνο του κάθε μέρα.'), btn('Έρευνα τώρα', { cls: 'primary', icon: 'market' }, () => startRun())));
      return;
    }
    let verdict = p.f || (head.counts.expensive ? 'expensive' : head.counts.cheap ? 'cheap' : '');
    let q = p.q || '';
    let page = 1;
    const selected = new Set();
    const fbar = h('div', { class: 'toolbar' });
    const box = h('div');
    const bulk = h('div', { class: 'bulkbar hidden' });
    const search = h('input', { type: 'search', placeholder: 'Αναζήτηση: όνομα, κωδικός, μάρκα', value: q, oninput: debounce((e) => { q = e.target.value; page = 1; load(); }, 300) });
    const drawF = () => {
      clear(fbar);
      fbar.appendChild(App.seg([['sf', siteName('sf')], ['st', siteName('st')]], site, (v) => App.go('market', { site: v })));
      for (const [k, l] of [['expensive', VERDICT.expensive], ['cheap', VERDICT.cheap], ['ok', VERDICT.ok], ['nodata', VERDICT.nodata], ['', 'Όλα']]) {
        fbar.appendChild(h('button', { type: 'button', class: 'chip' + (verdict === k ? ' on' : ''), onclick: () => { verdict = k; page = 1; selected.clear(); drawF(); load(); } }, l, ' ', h('b', null, fmt.num(k ? head.counts[k] : head.counts.all))));
      }
      fbar.appendChild(search);
    };
    const renderBulk = () => {
      clear(bulk); bulk.classList.toggle('hidden', !selected.size);
      if (!selected.size) return;
      bulk.appendChild(h('b', null, fmt.plural(selected.size, 'επιλεγμένο', 'επιλεγμένα')));
      const doExport = (extra) => POST('/api/market/export', Object.assign({ site, ids: [...selected] }, extra || {})).then(async (r) => {
        if (r.needConfirm) {
          const choice = await new Promise((resolve) => {
            let done = false; const fin = (v) => { if (!done) { done = true; resolve(v); modal.close(); } };
            modal.open(h('div', null, dlgHead(`${fmt.plural(r.carefulCount, 'προϊόν έχει', 'προϊόντα έχουν')} μεγάλη πτώση τιμής με βάση ένα μόνο κατάστημα`),
              h('p', { class: 'muted' }, 'Μπορεί το άλλο κατάστημα να έχει λάθος ή παλιά τιμή. Προτείνεται να μπουν στο αρχείο μόνο τα υπόλοιπα και να ελεγχθούν αυτά ένα-ένα.'),
              h('ul', { class: 'why' }, r.careful.slice(0, 8).map((x) => h('li', null, `${x.name}: ${fmt.money(x.ourPrice)} → ${fmt.money(x.suggested)}`))),
              h('div', { class: 'dlg-foot' }, btn('Άκυρο', () => fin(null)), btn('Μαζί κι αυτά', () => fin(true)), btn('Μόνο τα υπόλοιπα', { cls: 'primary' }, () => fin(false)))), { onClose: () => { if (!done) { done = true; resolve(null); } } });
          });
          if (choice === null) return null;
          return doExport({ includeCareful: choice });
        }
        if (!r) return;
        if (r.skipped) toast(`${fmt.plural(r.skipped, 'προϊόν', 'προϊόντα')} με μεγάλη πτώση (1 κατάστημα) δεν μπήκαν στο αρχείο· έλεγξέ τα πρώτα.`, { ms: 9000 });
        fileReady(Object.assign({ site }, r), { title: 'Αρχείο νέων τιμών έτοιμο' });
        if (r.extra) toast(`Έγινε και αρχείο για το ${siteName('st')} (${fmt.num(r.extra.count)} γραμμές, ίδιες τιμές για τα κοινά προϊόντα).`, { ms: 9000, action: { label: 'Άνοιγμα', fn: () => fileReady(Object.assign({ site: 'st' }, r.extra), { title: 'Αρχείο για το ' + siteName('st') }) } });
      }).catch(fail);
      bulk.appendChild(btn('Αρχείο με τις προτεινόμενες τιμές', { cls: 'primary', icon: 'download' }, () => doExport()));
      bulk.appendChild(btn('Ξανά έρευνα για αυτά', { icon: 'sync' }, () => startRun([...selected].map((id) => ({ site, id })))));
      bulk.appendChild(btn('Καθαρισμός', { cls: 'ghost' }, () => { selected.clear(); load(); }));
    };
    const load = async () => {
      const ov = await GET('/api/market', { site, verdict, q, page, per: 100 });
      clear(box);
      if (!ov.rows.length) { box.appendChild(h('div', { class: 'panel empty' }, h('p', null, 'Κανένα προϊόν εδώ.'))); renderBulk(); return; }
      const allBox = h('input', { type: 'checkbox', title: 'Όλα της σελίδας', onchange: (e) => { ov.rows.forEach((r) => (e.target.checked && r.suggested && !r.master ? selected.add(r.id) : selected.delete(r.id))); load(); } });
      const tb = h('tbody');
      for (const r of ov.rows) {
        const detail = h('tr', { class: 'hidden' }, h('td', { colspan: 9 }, h('div', { style: { padding: '6px 4px' } })));
        const refresh = async () => { await load(); };
        const tr = h('tr', { class: 'click' + (selected.has(r.id) ? ' sel' : ''), onclick: () => {
          const open = detail.classList.toggle('hidden');
          if (!open) {
            const c = clear(detail.querySelector('div'));
            c.appendChild(App.marketSummary(r, r.ourPrice, r.master ? null : { site, id: r.id, refresh }));
            c.appendChild(h('div', { class: 'row tight', style: { marginTop: '8px' } }, r.master ? null : btn('Χειροκίνητη τιμή', { cls: 'sm' }, () => App.manualPrice(site, r.id, refresh)), btn('Στοιχεία προϊόντος', { cls: 'sm' }, () => App.openProduct(site, r.id)),
              btn('Skroutz', { cls: 'sm', icon: 'ext' }, () => GET('/api/links/search', { q: r.name }).then((l) => POST('/api/open', { kind: 'url', url: l.skroutz }))),
              btn('BestPrice', { cls: 'sm', icon: 'ext' }, () => GET('/api/links/search', { q: r.name }).then((l) => POST('/api/open', { kind: 'url', url: l.bestprice })))));
          }
        } },
          h('td', { class: 'w-check' }, h('input', { type: 'checkbox', disabled: !r.suggested || r.master, title: r.master ? 'Η τιμή αλλάζει από το ' + siteName('sf') : '', checked: selected.has(r.id), onclick: (e) => e.stopPropagation(), onchange: (e) => { if (e.target.checked) selected.add(r.id); else selected.delete(r.id); renderBulk(); } })),
          h('td', { style: { width: '52px' } }, thumb(r.img)),
          h('td', { class: 'title' }, r.name, h('div', { class: 'faint', style: { fontWeight: 400, fontSize: '12.5px' } }, `${fmt.plural(r.stats.count, 'κατάστημα', 'καταστήματα')}${r.stats.similar ? ' · ' + r.stats.similar + ' παρόμοια' : ''}${r.stats.outOfStock ? ' · ' + r.stats.outOfStock + ' εξαντλημένα αλλού (δεν μετράνε)' : ''} · ${fmt.ago(r.at)}${r.master ? ' · τιμή από ' + siteName('sf') : ''}`,
            !r.stats.count && r.stats.outOfStock ? h('div', { class: 'hint', style: { color: 'var(--ok, #2f7d4f)', fontWeight: 600 } }, 'Κανείς άλλος δεν το έχει διαθέσιμο: δεν χρειάζεται μείωση τιμής') : null)),
          h('td', { class: 'num' }, fmt.money(r.ourPrice)),
          h('td', null, rangeBar(r.stats, r.ourPrice)),
          h('td', { class: 'num' }, r.stats.count ? fmt.money(r.stats.median) : '—'),
          h('td', { class: 'num' }, r.suggested ? h('b', null, fmt.money(r.suggested)) : '—', r.raised ? h('div', { class: 'hint' }, 'όριο κόστους') : null,
            r.careful ? h('div', { class: 'hint', style: { color: 'var(--signal)' }, title: 'Πτώση πάνω από 20% με βάση ένα μόνο κατάστημα' }, 'έλεγξε πριν αλλάξεις') : r.stats.confidence === 'low' ? h('div', { class: 'hint' }, '1 κατάστημα') : null),
          h('td', { class: 'num' }, r.diff ? h('span', { class: 'price-diff ' + (r.diff < 0 ? 'down' : 'up') }, (r.diff > 0 ? '+' : '') + fmt.money(r.diff)) : ''),
          h('td', null, h('span', { class: 'verdict ' + r.verdict }, VERDICT[r.verdict])));
        tb.appendChild(tr); tb.appendChild(detail);
      }
      box.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', { class: 'w-check' }, allBox), h('th', null, ''), h('th', null, 'Προϊόν'), h('th', { class: 'num' }, 'Δική μας'), h('th', null, 'Εύρος αγοράς'), h('th', { class: 'num' }, 'Μέση'), h('th', { class: 'num' }, 'Προτεινόμενη'), h('th', { class: 'num' }, 'Αλλαγή'), h('th', null, ''))), tb)));
      const pages = Math.ceil(ov.total / 100);
      if (pages > 1) box.appendChild(h('div', { class: 'pager' }, btn('‹', { cls: 'sm', disabled: page <= 1 }, () => { page--; load(); }), h('span', null, `Σελίδα ${page} από ${pages} · ${fmt.num(ov.total)} προϊόντα`), btn('›', { cls: 'sm', disabled: page >= pages }, () => { page++; load(); })));
      box.appendChild(h('p', { class: 'hint' }, 'Πάτα μια γραμμή για να δεις τα καταστήματα. Μετράνε μόνο τα «Ίδια» προϊόντα που είναι διαθέσιμα· εξαντλημένα, παλιές τιμές και ακραίες τιμές δεν μετράνε. «Παρόμοιο;» = ίσως άλλη έκδοση ή χρώμα: πάτα «Ίδιο» ή «Όχι» και το πρόγραμμα το θυμάται.'));
      renderBulk();
    };
    main.appendChild(fbar); main.appendChild(box); main.appendChild(bulk);
    drawF(); load();
  }

  /** One by one: is their product the same as ours? */
  async function renderConfirm(main, site) {
    const ov = await GET('/api/market', { site, similar: '1', per: 300 });
    const items = [];
    for (const r of ov.rows) for (const c of r.competitors) if (c.match === 'similar' && !c.ignored && !c.manual) items.push({ r, c });
    if (!items.length) { main.appendChild(h('div', { class: 'panel empty' }, h('h3', null, 'Τίποτα για επιβεβαίωση'), h('p', null, 'Όλα τα ταιριάσματα είναι σίγουρα ή έχουν ήδη κριθεί.'))); return; }
    main.appendChild(h('p', { class: 'muted' }, `${fmt.plural(ov.total, 'προϊόν σας έχει', 'προϊόντα σας έχουν')} παρόμοια στους ανταγωνιστές, όχι σίγουρα ίδια (έκδοση, χρώμα, μέγεθος). Ό,τι απαντήσεις το θυμάται για πάντα και ξαναυπολογίζει την τιμή. Πλήκτρα: Ν = ίδιο, Ο = όχι.${ov.total > 300 ? ' Εμφανίζονται τα πρώτα· όταν τελειώσουν, ανανέωσε τη σελίδα.' : ''}`));
    const list = h('div', { class: 'stack s' });
    const card = ({ r, c }) => {
      const el = h('div', { class: 'panel confirm-card' },
        h('div', { class: 'cmp' },
          h('div', { class: 'side-a' }, h('div', { class: 'faint' }, 'Δικό μας'), h('div', { class: 'row tight', style: { flexWrap: 'nowrap' } }, thumb(r.img), h('div', null, h('b', null, r.name), h('div', null, fmt.money(r.ourPrice))))),
          h('div', { class: 'vs' }, '≈'),
          h('div', { class: 'side-b' }, h('div', { class: 'faint' }, c.shop), h('div', { class: 'row tight', style: { flexWrap: 'nowrap' } }, c.img ? thumb(c.img) : null, h('div', null, h('b', null, c.name), h('div', null, fmt.money(c.price), c.inStock === false ? ' · εξαντλημένο' : ''))))),
        c.why ? h('div', { class: 'note', style: { marginTop: '8px' } }, 'Γιατί δεν είναι σίγουρο: ', c.why) : null,
        h('div', { class: 'row tight', style: { marginTop: '10px' } },
          btn('Ίδιο προϊόν', { cls: 'primary', icon: 'check' }, () => answer('yes')),
          btn('Όχι, άλλο', { icon: 'x' }, () => answer('no')),
          c.url ? btn('Η σελίδα τους', { cls: 'ghost', icon: 'ext' }, () => POST('/api/open', { kind: 'url', url: c.url })) : null));
      function answer(a) { POST('/api/market/decide', { site, id: r.id, url: c.url, answer: a }).then(() => { el.classList.add('done'); setTimeout(() => el.remove(), 180); }).catch(fail); }
      el.answer = answer;
      return el;
    };
    for (const it of items.slice(0, 200)) list.appendChild(card(it));
    main.appendChild(list);
    const onKey = (e) => {
      if (App.parseHash().params.tab !== 'confirm') { document.removeEventListener('keydown', onKey); return; }
      if (e.target.matches('input, textarea, select')) return;
      const first = list.querySelector('.confirm-card:not(.done)');
      if (!first) return;
      if (/^[νnΝN]$/.test(e.key)) first.answer('yes');
      if (/^[οoΟO]$/.test(e.key)) first.answer('no');
    };
    document.addEventListener('keydown', onKey);
  }

  function renderChanges(main, site, head) {
    const ch = head.changes || [];
    main.appendChild(h('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '10px' } }, h('p', { class: 'muted', style: { margin: 0 } }, 'Αλλαγές τιμών των ανταγωνιστών σε προϊόντα που πουλάτε, από τις τελευταίες έρευνες.'), App.reportButtons('changes', {}, 'Λήψη')));
    if (!ch.length) { main.appendChild(h('div', { class: 'panel empty' }, h('p', null, 'Δεν υπάρχουν αλλαγές ακόμα. Εμφανίζονται από τη δεύτερη έρευνα και μετά.'))); return; }
    const tb = h('tbody');
    for (const c of ch) {
      const pct = c.from ? Math.round(((c.to - c.from) / c.from) * 100) : 0;
      tb.appendChild(h('tr', { class: 'click', onclick: () => App.openProduct(c.site, c.id) },
        h('td', null, fmt.dateTime(c.at)), h('td', { class: 'title' }, c.name), h('td', null, c.shop),
        h('td', { class: 'num' }, fmt.money(c.from)), h('td', { class: 'num' }, h('b', null, fmt.money(c.to))),
        h('td', { class: 'num' }, h('span', { class: 'price-diff ' + (pct < 0 ? 'down' : 'up') }, (pct > 0 ? '+' : '') + pct + '%')),
        h('td', { class: 'num' }, fmt.money(c.ours))));
    }
    main.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Πότε'), h('th', null, 'Δικό μας προϊόν'), h('th', null, 'Κατάστημα'), h('th', { class: 'num' }, 'Από'), h('th', { class: 'num' }, 'Σε'), h('th', { class: 'num' }, ''), h('th', { class: 'num' }, 'Δική μας'))), tb)));
  }

  async function renderCompetitors(main) {
    const list = await GET('/api/competitors');
    const KIND = { woo: ['Αυτόματα · WooCommerce', 'ok'], shopify: ['Αυτόματα · Shopify', 'ok'], manual: ['Μόνο χειροκίνητα', 'med'], auto: ['Δεν ελέγχθηκε ακόμα', ''] };
    const tb = h('tbody');
    for (const c of list) {
      const k = KIND[c.kind || 'auto'] || KIND.auto;
      tb.appendChild(h('tr', null,
        h('td', { class: 'w-check' }, h('input', { type: 'checkbox', checked: c.enabled !== false, title: 'Ενεργό', onchange: (e) => POST('/api/competitors', Object.assign({}, c, { enabled: e.target.checked })).catch(fail) })),
        h('td', { class: 'title' }, c.name, h('div', { class: 'faint', style: { fontWeight: 400 } }, c.url)),
        h('td', null, h('span', { class: 'badge ' + k[1] }, k[0]), c.status ? h('div', { class: 'faint', style: { fontSize: '12.5px' } }, c.status) : null),
        h('td', { class: 'num' }, c.catalog && c.catalog.count ? h('div', null, h('b', null, fmt.num(c.catalog.count)), h('div', { class: 'faint', style: { fontSize: '12.5px' } }, fmt.ago(c.catalog.at))) : h('span', { class: 'faint' }, '—')),
        h('td', null, h('div', { class: 'row tight' }, btn('Άνοιγμα', { cls: 'sm', icon: 'ext' }, () => POST('/api/open', { kind: 'url', url: c.url })), btn('Αφαίρεση', { cls: 'sm ghost' }, async () => { if (await confirmBox('Αφαίρεση ' + c.name + ';', null, 'Αφαίρεση', true)) POST('/api/competitors/delete', { id: c.id }).then(() => App.route()).catch(fail); })))));
    }
    const name = h('input', { type: 'text', placeholder: 'Όνομα' });
    const url = h('input', { type: 'url', placeholder: 'https://κατάστημα.gr' });
    const auto = list.filter((c) => c.enabled !== false && (c.kind === 'woo' || c.kind === 'shopify')).length;
    main.appendChild(h('div', { class: 'panel', style: { marginBottom: '14px' } }, h('div', { class: 'row' }, url, name, btn('Προσθήκη', { cls: 'primary', icon: 'new' }, () => POST('/api/competitors', { url: url.value, name: name.value }).then(() => App.route()).catch(fail)), btn('Έλεγχος όλων', { icon: 'sync' }, () => POST('/api/competitors/detect').then((job) => watchJob(job, { done: () => { toast('Ο έλεγχος ολοκληρώθηκε.'); App.route(); } })).catch(fail))),
      h('p', { class: 'hint', style: { margin: '8px 0 0' } }, `${auto} από ${list.length} διαβάζονται αυτόματα (WooCommerce / Shopify): κατεβαίνει όλος ο κατάλογός τους και συγκρίνεται με όλα τα προϊόντα σας. Τα υπόλοιπα ανοίγουν για χειροκίνητο έλεγχο. Η λίστα βρέθηκε με αναζήτηση ελληνικών καταστημάτων του χώρου — βγάλε όποιο δεν είναι ανταγωνιστής.`)));
    main.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Κατάστημα'), h('th', null, 'Ανάγνωση'), h('th', { class: 'num' }, 'Προϊόντα'), h('th', null, ''))), tb)));
  }
})();
