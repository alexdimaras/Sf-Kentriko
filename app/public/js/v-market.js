/* Τιμές αγοράς — every product compared with the whole catalog of every competitor, every day */
'use strict';
(function () {
  const { h, clear, btn, icon, fmt, GET, POST, toast, fail, modal, dlgHead, thumb, pageHead, siteName, fileReady, watchJob, confirmBox, debounce } = App;
  const ACT = {
    lower: ['Μείωσε', 'Πιο ακριβό από την αγορά: τουλάχιστον 2 καταστήματα με απόθεμα το πουλάνε φθηνότερα.'],
    raise: ['Μπορείς να ανεβάσεις', 'Πολύ φθηνότερο από την αγορά: χάνεις κέρδος.'],
    watch: ['Μόνο ενημέρωση', 'Κάτι φαίνεται φθηνότερο/ακριβότερο, αλλά από ένα μόνο κατάστημα ή με ύποπτη τιμή: δεν αλλάζεις.'],
    hold: ['Σωστή τιμή', 'Μέσα στην αγορά.'],
    nodata: ['Χωρίς στοιχεία', 'Δεν βρέθηκε το ίδιο προϊόν διαθέσιμο αλλού.'],
  };
  const FLAG = { used: ['μετράει', 'ok'], suspect: ['ύποπτη τιμή', 'crit'], out: ['εξαντλημένο', ''], stale: ['παλιά τιμή', ''], high: ['πολύ ακριβό', ''], foreign: ['εξωτερικό', ''], similar: ['παρόμοιο;', 'warn'], ignored: ['δεν μετράει', ''] };
  const flagOf = (c) => c.flag || (c.ignored ? 'ignored' : c.match === 'exact' ? (c.used === false ? 'out' : 'used') : 'similar');
  const pct = (v) => (v > 0 ? '+' : '') + Math.round(v * 100) + '%';
  const actPill = (a) => h('span', { class: 'act ' + a, title: (ACT[a] || ACT.nodata)[1] }, (ACT[a] || ACT.nodata)[0]);

  /** Price ladder: every shop as a dot on one line, our price as the marker. Hollow red = suspect, grey = out of stock. */
  function ladder(m, ours, opts) {
    opts = opts || {};
    const offers = (m.competitors || []).filter((c) => !c.ignored && c.match === 'exact' && c.price > 0);
    if (!offers.length) return h('span', { class: 'faint' }, '—');
    const vals = offers.map((c) => c.price).concat(ours ? [ours] : []);
    const lo = Math.min(...vals) * 0.96, hi = Math.max(...vals) * 1.04;
    const pos = (v) => ((v - lo) / (hi - lo || 1)) * 100;
    const box = h('div', { class: 'ladder' + (opts.big ? ' big' : ''), role: 'img', 'aria-label': `Η τιμή μας ${fmt.money(ours)} ανάμεσα σε ${offers.length} καταστήματα` });
    box.appendChild(h('div', { class: 'rail' }));
    const st = m.stats || {};
    if (st.count) box.appendChild(h('div', { class: 'band', style: { left: pos(st.min) + '%', width: Math.max(0.5, pos(st.max) - pos(st.min)) + '%' }, title: `Αγορά (όσα μετράνε): ${fmt.money(st.min)} – ${fmt.money(st.max)} · μέση ${fmt.money(st.median)}` }));
    if (st.count) box.appendChild(h('div', { class: 'mid', style: { left: pos(st.median) + '%' }, title: 'Μέση τιμή αγοράς ' + fmt.money(st.median) }));
    for (const c of offers.slice().sort((a, b) => a.price - b.price)) {
      const f = flagOf(c);
      box.appendChild(h('div', { class: 'dot ' + f, style: { left: pos(c.price) + '%' }, title: `${c.shop}: ${fmt.money(c.price)} · ${FLAG[f][0]}${c.note ? ' — ' + c.note : ''}` }));
    }
    if (ours) box.appendChild(h('div', { class: 'us', style: { left: pos(ours) + '%' }, title: 'Η τιμή μας ' + fmt.money(ours) }, h('span', null, opts.big ? 'Εμείς ' + fmt.money(ours) : 'εμείς')));
    return box;
  }
  App.priceLadder = ladder;

  function decide(ctx, url, answer) {
    return POST('/api/market/decide', { site: ctx.site, id: ctx.id, url, answer }).then(() => { toast(answer === 'yes' ? 'Μετράει πλέον στην τιμή (το θυμάμαι και για τις επόμενες έρευνες).' : answer === 'no' ? 'Δεν μετράει (το θυμάμαι).' : 'Επαναφορά.'); if (ctx.refresh) ctx.refresh(); }).catch(fail);
  }

  /** Market box for one product (also used in the product drawer): decision, numbers, ladder, and every shop next to us. */
  App.marketSummary = function (m, ours, ctx) {
    const st = m.stats || { count: 0 };
    const action = m.action || m.verdict || 'nodata';
    const box = h('div', { class: 'stack s' });
    if (m.master) box.appendChild(h('div', { class: 'note' }, 'Το προϊόν υπάρχει και στο ' + siteName('sf') + ': ισχύει η έρευνα και η τιμή του ' + siteName('sf') + '.'));
    box.appendChild(h('div', { class: 'decision ' + action },
      h('div', { class: 'row tight' }, actPill(action), m.suggested ? h('b', { class: 'newprice' }, 'Νέα τιμή ' + fmt.money(m.suggested), h('span', { class: 'price-diff ' + (m.suggested < ours ? 'down' : 'up') }, ' (' + (m.suggested > ours ? '+' : '') + fmt.money(m.suggested - ours) + ')')) : null,
        m.careful ? h('span', { class: 'pill crit', title: 'Μεγάλη πτώση με λίγα καταστήματα' }, 'έλεγξε πριν αλλάξεις') : null),
      h('p', null, m.reason || (ACT[action] || ACT.nodata)[1]),
      m.at ? h('div', { class: 'hint' }, 'Έρευνα ' + fmt.dateTime(m.at)) : null));
    if (st.count || (m.competitors || []).length) {
      box.appendChild(h('div', { class: 'mk-nums' },
        h('div', { class: 'us' }, h('span', null, 'Η τιμή μας'), h('b', null, fmt.money(ours))),
        h('div', null, h('span', null, 'Φθηνότερο'), h('b', null, st.count ? fmt.money(st.min) : '—'), st.minShop ? h('small', null, st.minShop) : null),
        h('div', null, h('span', null, 'Μέση αγοράς'), h('b', null, st.count ? fmt.money(st.median) : '—'), m.vsMedian != null ? h('small', { class: m.vsMedian > 0.05 ? 'up' : m.vsMedian < -0.05 ? 'down' : '' }, 'εμείς ' + pct(m.vsMedian)) : null),
        h('div', null, h('span', null, 'Ακριβότερο'), h('b', null, st.count ? fmt.money(st.max) : '—'), st.maxShop ? h('small', null, st.maxShop) : null),
        h('div', null, h('span', null, 'Θέση μας'), h('b', null, m.rank ? m.rank + 'ος' : '—'), m.of ? h('small', null, 'από ' + m.of + ' (1 = φθηνότερος)') : null)));
      box.appendChild(ladder(m, ours, { big: true }));
      box.appendChild(h('div', { class: 'legend' }, h('span', null, h('i', { class: 'dot used' }), 'μετράει'), h('span', null, h('i', { class: 'dot suspect' }), 'ύποπτη τιμή (δεν μετράει)'), h('span', null, h('i', { class: 'dot out' }), 'εξαντλημένο / παλιό'), h('span', null, h('i', { class: 'usk' }), 'εμείς')));
    }
    // every shop and us in one list, cheapest first
    const rows = (m.competitors || []).filter((c) => !c.ignored || ctx).slice();
    if (rows.length) {
      const all = rows.map((c) => ({ c })).concat(ours ? [{ us: true, price: ours }] : []);
      all.sort((a, b) => (a.us ? a.price : a.c.price) - (b.us ? b.price : b.c.price) || (a.us ? -1 : 1));
      const tb = h('tbody');
      for (const r of all) {
        if (r.us) {
          tb.appendChild(h('tr', { class: 'me' }, h('td', null, h('b', null, 'ΕΜΕΙΣ · ' + siteName(ctx && ctx.site ? ctx.site : 'sf'))),
            h('td', { class: 'num' }, h('b', null, fmt.money(ours))), h('td', null, ''), h('td', null, m.cost ? h('span', { class: 'faint' }, 'κόστος ' + fmt.money(m.cost) + ' + ΦΠΑ') : ''),
            h('td', null, m.floor ? h('span', { class: 'faint', title: 'Κόστος + ελάχιστο περιθώριο + ΦΠΑ' }, 'όριο ' + fmt.money(m.floor)) : ''), h('td', null, m.rrp ? h('span', { class: 'faint' }, 'λιανική αντιπρ. ' + fmt.money(m.rrp)) : '')));
          continue;
        }
        const c = r.c, f = flagOf(c);
        const vs = ours ? (c.price - ours) / ours : 0;
        tb.appendChild(h('tr', { class: c.used ? '' : 'unused' },
          h('td', null, h('div', { class: 'row tight', style: { flexWrap: 'nowrap', minWidth: 0 } }, c.img ? thumb(c.img, 'sm') : null,
            h('div', { style: { minWidth: 0 } }, h('b', null, c.shop), c.manual ? h('span', { class: 'pill', style: { marginLeft: '6px' } }, 'χειροκίνητα') : null,
              h('div', { class: 'faint ell', title: c.name }, c.name), c.why && f === 'similar' ? h('div', { class: 'hint', style: { margin: 0 } }, c.why) : null))),
          h('td', { class: 'num' }, h('b', null, fmt.money(c.price)), c.prevPrice ? h('div', { class: 'hint', style: { margin: 0 } }, 'πριν ' + fmt.money(c.prevPrice)) : null),
          h('td', { class: 'num' }, ours ? h('span', { class: 'price-diff ' + (vs < -0.005 ? 'down' : vs > 0.005 ? 'up' : '') }, pct(vs)) : ''),
          h('td', null, c.inStock === false ? h('span', { class: 'faint' }, 'εξαντλημένο') : 'διαθέσιμο'),
          h('td', null, h('span', { class: 'pill ' + FLAG[f][1] }, FLAG[f][0]), c.note && f !== 'used' ? h('div', { class: 'hint', style: { margin: '2px 0 0' } }, c.note) : null),
          h('td', null, h('div', { class: 'row tight', style: { flexWrap: 'nowrap', justifyContent: 'flex-end' } }, c.url ? h('button', { class: 'x', title: 'Άνοιγμα της σελίδας τους', onclick: () => App.openUrl(c.url) }, icon('ext')) : null,
            ctx && !c.manual && c.match !== 'exact' && !c.ignored ? h('button', { class: 'btn sm', title: 'Είναι το ίδιο προϊόν: να μετράει στην τιμή', onclick: () => decide(ctx, c.url, 'yes') }, icon('check'), 'Ίδιο') : null,
            ctx && !c.ignored ? h('button', { class: 'btn sm ghost', title: 'Δεν είναι το ίδιο προϊόν / να μη μετράει', onclick: () => decide(ctx, c.url, 'no') }, icon('x'), 'Όχι') : null,
            ctx && (c.ignored || c.confirmed) ? h('button', { class: 'btn sm ghost', title: 'Να το κρίνει ξανά το πρόγραμμα', onclick: () => decide(ctx, c.url, '') }, 'Επαναφορά') : null))));
      }
      box.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl cmp-tbl' }, h('thead', null, h('tr', null, h('th', null, 'Κατάστημα'), h('th', { class: 'num' }, 'Τιμή'), h('th', { class: 'num' }, 'vs εμάς'), h('th', null, 'Απόθεμα'), h('th', null, 'Μετράει;'), h('th', null, ''))), tb)));
    } else if (!st.count) box.appendChild(h('p', { class: 'muted' }, 'Πρόσθεσε τιμή με το χέρι αν την ξέρεις.'));
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
    let c0 = head.counts;
    let action = (ACT[p.f] || p.f === 'all') ? p.f : (c0.lower ? 'lower' : c0.raise ? 'raise' : c0.watch ? 'watch' : 'all');
    let q = p.q || '';
    let page = 1;
    let suspectOnly = false;
    const selected = new Set();
    const tiles = h('div', { class: 'kpis' });
    const fbar = h('div', { class: 'toolbar' });
    const chips = h('div', { class: 'row tight' });
    const box = h('div');
    const bulk = h('div', { class: 'bulkbar hidden' });
    const search = h('input', { type: 'search', placeholder: 'Αναζήτηση: όνομα, κωδικός, μάρκα', value: q, oninput: debounce((e) => { q = e.target.value; page = 1; load(); }, 300) });
    const minShops = App.state.settings.minShops || 2;
    const drawF = () => {
      clear(tiles);
      for (const k of ['lower', 'raise', 'watch', 'hold', 'nodata']) {
        tiles.appendChild(h('button', { type: 'button', class: 'kpi ' + k, 'aria-pressed': String(action === k), title: ACT[k][1], onclick: () => { action = action === k ? 'all' : k; page = 1; selected.clear(); drawF(); load(); } },
          h('b', null, fmt.num(c0[k] || 0)), h('span', null, ACT[k][0])));
      }
      // the search box stays the same element (it keeps the focus while you type)
      if (!fbar.firstChild) { fbar.appendChild(App.seg([['sf', siteName('sf')], ['st', siteName('st')]], site, (v) => App.go('market', { site: v }))); fbar.appendChild(chips); fbar.appendChild(search); }
      clear(chips);
      chips.appendChild(h('button', { type: 'button', class: 'chip' + (action === 'all' ? ' on' : ''), onclick: () => { action = 'all'; page = 1; selected.clear(); drawF(); load(); } }, 'Όλα ', h('b', null, fmt.num(c0.all))));
      if (c0.suspect) chips.appendChild(h('button', { type: 'button', class: 'chip' + (suspectOnly ? ' on' : ''), title: 'Ανταγωνιστές με τιμή κάτω από το κόστος μας ή πολύ κάτω από τους άλλους', onclick: () => { suspectOnly = !suspectOnly; page = 1; drawF(); load(); } }, 'Με ύποπτες τιμές ', h('b', null, fmt.num(c0.suspect))));
    };
    const renderBulk = () => {
      clear(bulk); bulk.classList.toggle('hidden', !selected.size);
      if (!selected.size) return;
      bulk.appendChild(h('b', null, fmt.plural(selected.size, 'επιλεγμένο', 'επιλεγμένα')));
      const doExport = (extra) => POST('/api/market/export', Object.assign({ site, ids: [...selected] }, extra || {})).then(async (r) => {
        if (r.needConfirm) {
          const choice = await new Promise((resolve) => {
            let done = false; const fin = (v) => { if (!done) { done = true; resolve(v); modal.close(); } };
            modal.open(h('div', null, dlgHead(`${fmt.plural(r.carefulCount, 'προϊόν έχει', 'προϊόντα έχουν')} μεγάλη πτώση τιμής (πάνω από 20%)`),
              h('p', { class: 'muted' }, 'Τη στηρίζουν λιγότερα από 3 καταστήματα. Προτείνεται να μπουν στο αρχείο μόνο τα υπόλοιπα και να ελεγχθούν αυτά ένα-ένα.'),
              h('ul', { class: 'why' }, r.careful.slice(0, 8).map((x) => h('li', null, `${x.name}: ${fmt.money(x.ourPrice)} → ${fmt.money(x.suggested)}`))),
              h('div', { class: 'dlg-foot' }, btn('Άκυρο', () => fin(null)), btn('Μαζί κι αυτά', () => fin(true)), btn('Μόνο τα υπόλοιπα', { cls: 'primary' }, () => fin(false)))), { onClose: () => { if (!done) { done = true; resolve(null); } } });
          });
          if (choice === null) return null;
          return doExport({ includeCareful: choice });
        }
        if (!r) return;
        if (r.skipped) toast(`${fmt.plural(r.skipped, 'προϊόν', 'προϊόντα')} με μεγάλη πτώση δεν μπήκαν στο αρχείο· έλεγξέ τα πρώτα.`, { ms: 9000 });
        fileReady(Object.assign({ site }, r), { title: 'Αρχείο νέων τιμών έτοιμο' });
        if (r.extra) toast(`Έγινε και αρχείο για το ${siteName('st')} (${fmt.num(r.extra.count)} γραμμές, ίδιες τιμές για τα κοινά προϊόντα).`, { ms: 9000, action: { label: 'Άνοιγμα', fn: () => fileReady(Object.assign({ site: 'st' }, r.extra), { title: 'Αρχείο για το ' + siteName('st') }) } });
      }).catch(fail);
      bulk.appendChild(btn('Αρχείο με τις νέες τιμές', { cls: 'primary', icon: 'download' }, () => doExport()));
      bulk.appendChild(btn('Ξανά έρευνα για αυτά', { icon: 'sync' }, () => startRun([...selected].map((id) => ({ site, id })))));
      bulk.appendChild(btn('Καθαρισμός', { cls: 'ghost' }, () => { selected.clear(); load(); }));
    };
    const load = async () => {
      const ov = await GET('/api/market', { site, action: action === 'all' ? '' : action, suspect: suspectOnly ? '1' : '', q, page, per: 100 });
      c0 = ov.counts; drawF(); // the counts follow every decision
      clear(box);
      if (action !== 'all') box.appendChild(h('p', { class: 'muted', style: { margin: '0 0 10px' } }, h('b', null, ACT[action][0] + ': '), ACT[action][1].replace('2 καταστήματα', minShops + ' καταστήματα')));
      if (!ov.rows.length) { box.appendChild(h('div', { class: 'panel empty' }, h('p', null, 'Κανένα προϊόν εδώ.'))); renderBulk(); return; }
      const allBox = h('input', { type: 'checkbox', title: 'Όλα της σελίδας (όσα έχουν νέα τιμή)', onchange: (e) => { ov.rows.forEach((r) => (e.target.checked && r.suggested && !r.master ? selected.add(r.id) : selected.delete(r.id))); load(); } });
      const tb = h('tbody');
      for (const r of ov.rows) {
        const detail = h('tr', { class: 'hidden' }, h('td', { colspan: 7 }, h('div', { class: 'mk-detail' })));
        const refresh = async () => { await load(); };
        const st = r.stats || {};
        const tr = h('tr', { class: 'click mk-row' + (selected.has(r.id) ? ' sel' : ''), onclick: () => {
          const open = detail.classList.toggle('hidden');
          if (!open) {
            const c = clear(detail.querySelector('div'));
            c.appendChild(App.marketSummary(r, r.ourPrice, r.master ? null : { site, id: r.id, refresh }));
            c.appendChild(h('div', { class: 'row tight', style: { marginTop: '10px' } }, r.master ? null : btn('Χειροκίνητη τιμή', { cls: 'sm' }, () => App.manualPrice(site, r.id, refresh)), btn('Στοιχεία προϊόντος', { cls: 'sm' }, () => App.openProduct(site, r.id)),
              btn('Skroutz', { cls: 'sm', icon: 'ext' }, () => GET('/api/links/search', { q: r.name }).then((l) => App.openUrl(l.skroutz))),
              btn('BestPrice', { cls: 'sm', icon: 'ext' }, () => GET('/api/links/search', { q: r.name }).then((l) => App.openUrl(l.bestprice)))));
          }
        } },
          h('td', { class: 'w-check' }, h('input', { type: 'checkbox', disabled: !r.suggested || r.master, title: r.master ? 'Η τιμή αλλάζει από το ' + siteName('sf') : !r.suggested ? 'Δεν προτείνεται αλλαγή τιμής' : '', checked: selected.has(r.id), onclick: (e) => e.stopPropagation(), onchange: (e) => { if (e.target.checked) selected.add(r.id); else selected.delete(r.id); renderBulk(); } })),
          h('td', { style: { width: '52px' } }, thumb(r.img)),
          h('td', { class: 'title' }, r.name, h('div', { class: 'faint meta' }, [r.brand, r.sku].filter(Boolean).join(' · '), r.rank ? ` · ${r.rank}ος φθηνότερος από ${r.of}` : '', ` · ${fmt.plural(st.count || 0, 'κατάστημα μετράει', 'καταστήματα μετράνε')}`, st.suspect ? ` · ${st.suspect} ύποπτη τιμή` : '', st.similar ? ` · ${st.similar} παρόμοια` : '', r.master ? ' · τιμή από ' + siteName('sf') : '')),
          h('td', { class: 'num ours' }, h('b', null, fmt.money(r.ourPrice)), r.vsMedian != null && st.count ? h('div', { class: 'price-diff ' + (r.vsMedian > 0.05 ? 'up' : r.vsMedian < -0.05 ? 'down' : ''), title: 'Σε σχέση με τη μέση τιμή αγοράς ' + fmt.money(st.median) }, pct(r.vsMedian) + ' vs μέση') : null),
          h('td', { class: 'ladder-cell' }, ladder(r, r.ourPrice), st.count ? h('div', { class: 'ladder-cap' }, h('span', null, fmt.money(st.min), st.minShop ? ' · ' + st.minShop : ''), h('span', null, st.maxShop ? st.maxShop + ' · ' : '', fmt.money(st.max))) : null),
          h('td', { class: 'decide' }, actPill(r.action), h('div', { class: 'reason', title: r.reason }, r.reason)),
          h('td', { class: 'num' }, r.suggested ? h('b', { class: 'newprice' }, fmt.money(r.suggested)) : h('span', { class: 'faint' }, '—'),
            r.diff ? h('div', { class: 'price-diff ' + (r.diff < 0 ? 'down' : 'up') }, (r.diff > 0 ? '+' : '') + fmt.money(r.diff)) : null,
            r.raised ? h('div', { class: 'hint' }, 'όριο κόστους') : null,
            r.careful ? h('div', { class: 'hint', style: { color: 'var(--signal)' }, title: 'Πτώση πάνω από 20% με λιγότερα από 3 καταστήματα' }, 'έλεγξε πριν αλλάξεις') : null));
        tb.appendChild(tr); tb.appendChild(detail);
      }
      box.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl mk-tbl' }, h('thead', null, h('tr', null, h('th', { class: 'w-check' }, allBox), h('th', null, ''), h('th', null, 'Προϊόν'), h('th', { class: 'num' }, 'Η τιμή μας'), h('th', null, 'Εμείς και οι ανταγωνιστές'), h('th', null, 'Απόφαση'), h('th', { class: 'num' }, 'Νέα τιμή'))), tb)));
      const pages = Math.ceil(ov.total / 100);
      if (pages > 1) box.appendChild(h('div', { class: 'pager' }, btn('‹', { cls: 'sm', disabled: page <= 1 }, () => { page--; load(); }), h('span', null, `Σελίδα ${page} από ${pages} · ${fmt.num(ov.total)} προϊόντα`), btn('›', { cls: 'sm', disabled: page >= pages }, () => { page++; load(); })));
      box.appendChild(h('p', { class: 'hint' }, `Πάτα μια γραμμή για όλα τα καταστήματα δίπλα στη δική μας τιμή. Μετράνε μόνο τα «Ίδια» προϊόντα που είναι διαθέσιμα. Δεν μετράνε: εξαντλημένα, παλιές τιμές και ύποπτες τιμές (κάτω από το κόστος μας ή ${App.state.settings.suspectPct || 30}%+ κάτω από τους άλλους — π.χ. παλιό απόθεμα ή λάθος). Αλλαγή τιμής προτείνεται μόνο όταν συμφωνούν τουλάχιστον ${minShops} καταστήματα.`));
      renderBulk();
    };
    main.appendChild(tiles); main.appendChild(fbar); main.appendChild(box); main.appendChild(bulk);
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
          c.url ? btn('Η σελίδα τους', { cls: 'ghost', icon: 'ext' }, () => App.openUrl(c.url)) : null));
      function answer(a) { POST('/api/market/decide', { site, id: r.id, url: c.url, answer: a }).then(() => { el.classList.add('done'); setTimeout(() => el.remove(), 180); }).catch(fail); }
      el.answer = answer;
      return el;
    };
    for (const it of items.slice(0, 200)) list.appendChild(card(it));
    main.appendChild(list);
    const onKey = (e) => {
      if (!list.isConnected || App.parseHash().params.tab !== 'confirm') { document.removeEventListener('keydown', onKey); return; }
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
        h('td', null, h('div', { class: 'row tight' }, btn('Άνοιγμα', { cls: 'sm', icon: 'ext' }, () => App.openUrl(c.url)), btn('Αφαίρεση', { cls: 'sm ghost' }, async () => { if (await confirmBox('Αφαίρεση ' + c.name + ';', null, 'Αφαίρεση', true)) POST('/api/competitors/delete', { id: c.id }).then(() => App.route()).catch(fail); })))));
    }
    const name = h('input', { type: 'text', placeholder: 'Όνομα' });
    const url = h('input', { type: 'url', placeholder: 'https://κατάστημα.gr' });
    const auto = list.filter((c) => c.enabled !== false && (c.kind === 'woo' || c.kind === 'shopify')).length;
    main.appendChild(h('div', { class: 'panel', style: { marginBottom: '14px' } }, h('div', { class: 'row' }, url, name, btn('Προσθήκη', { cls: 'primary', icon: 'new' }, () => POST('/api/competitors', { url: url.value, name: name.value }).then(() => App.route()).catch(fail)), btn('Έλεγχος όλων', { icon: 'sync' }, () => POST('/api/competitors/detect').then((job) => watchJob(job, { done: () => { toast('Ο έλεγχος ολοκληρώθηκε.'); App.route(); } })).catch(fail))),
      h('p', { class: 'hint', style: { margin: '8px 0 0' } }, `${auto} από ${list.length} διαβάζονται αυτόματα (WooCommerce / Shopify): κατεβαίνει όλος ο κατάλογός τους και συγκρίνεται με όλα τα προϊόντα σας. Τα υπόλοιπα ανοίγουν για χειροκίνητο έλεγχο. Η λίστα βρέθηκε με αναζήτηση ελληνικών καταστημάτων του χώρου — βγάλε όποιο δεν είναι ανταγωνιστής.`)));
    main.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Κατάστημα'), h('th', null, 'Ανάγνωση'), h('th', { class: 'num' }, 'Προϊόντα'), h('th', null, ''))), tb)));
  }
})();
