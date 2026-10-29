/* Έλεγχοι καταλόγου */
'use strict';
(function () {
  const { h, clear, btn, fmt, GET, POST, toast, fail, drawer, dlgHead, thumb, pageHead, siteName, sitePill, fileReady, go } = App;
  const SEV_LABEL = { critical: 'Κρίσιμα', high: 'Σοβαρά', medium: 'Μέτρια', low: 'Μικρά', info: 'Ενημέρωση' };

  App.views.checks = {
    async render(main, p) {
      main.appendChild(pageHead('Έλεγχοι καταλόγου', 'Ό,τι χαλάει πωλήσεις, Google και διαφημίσεις — με έτοιμο αρχείο διόρθωσης όπου γίνεται.', [
        App.reportButtons('checks', {}, 'Όλοι οι έλεγχοι'),
        btn('Ξανά έλεγχος', { icon: 'sync' }, () => GET('/api/checks', { force: '1', limit: 1 }).then(() => { App.refreshBadges(); App.route(); }).catch(fail)),
      ]));
      const st = App.state.summary;
      if (!st.sf.syncedAt && !st.st.syncedAt) {
        main.appendChild(h('div', { class: 'panel empty' }, h('h3', null, 'Πρώτα διάβασε τα προϊόντα'), h('p', null, 'Οι έλεγχοι γίνονται στα στοιχεία των sites.'), btn('Ανάγνωση τώρα', { cls: 'primary', icon: 'sync' }, () => App.startSync())));
        return;
      }
      main.appendChild(h('div', { class: 'note ok', style: { marginBottom: '12px', display: 'flex', gap: '12px', alignItems: 'center' } }, h('div', { class: 'grow' }, h('b', null, 'Τα περισσότερα διορθώνονται μόνα τους. '), 'Τίτλοι, περιγραφές και φωτογραφίες (από τους αντιπροσώπους), τιμές, κατηγορίες και διαφημίσεις είναι έτοιμα στις «Διορθώσεις» — εσύ μόνο εγκρίνεις.'), btn('Διορθώσεις', { cls: 'primary sm', icon: 'fixes' }, () => App.go('fixes'))));
      const data = await GET('/api/checks', { limit: 1 });
      let sev = p.sev || '';
      let siteF = p.site || '';
      const strip = h('div', { class: 'sev-strip' });
      const list = h('div', { class: 'check-list' });
      const draw = () => {
        clear(strip);
        for (const k of Object.keys(SEV_LABEL)) {
          strip.appendChild(h('button', { type: 'button', class: k, 'aria-pressed': String(sev === k), onclick: () => { sev = sev === k ? '' : k; draw(); } }, h('b', null, fmt.num(data.counts[k] || 0)), h('span', null, SEV_LABEL[k])));
        }
        clear(list);
        const rows = data.checks.filter((c) => (!sev || c.severity === sev) && (!siteF || c.site === siteF));
        if (!rows.length) list.appendChild(h('div', { class: 'panel empty' }, h('h3', null, 'Τίποτα εδώ'), h('p', null, 'Δεν βρέθηκαν θέματα σε αυτή την κατηγορία.')));
        for (const c of rows) {
          list.appendChild(h('button', { type: 'button', class: 'check-row ' + c.severity, onclick: () => openCheck(c.id) },
            h('div', { class: 'bar' }),
            h('div', null, h('h3', null, c.title), c.help ? h('p', null, c.help) : null),
            h('div', { class: 'row tight' }, sitePill(c.site), c.fix ? h('span', { class: 'pill' }, 'Με αρχείο διόρθωσης') : null),
            h('div', { class: 'count' }, fmt.num(c.total))));
        }
      };
      main.appendChild(strip);
      main.appendChild(h('div', { class: 'toolbar' }, App.seg([['', 'Και τα δύο sites'], ['sf', siteName('sf')], ['st', siteName('st')]], siteF, (v) => { siteF = v; draw(); }), h('span', { class: 'faint' }, 'Έλεγχος: ' + fmt.dateTime(data.at))));
      main.appendChild(list);
      draw();
      if (p.open) openCheck(p.open);
    },
  };

  async function openCheck(id) {
    let c;
    try { c = await GET('/api/check', { id }); } catch (e) { return fail(e); }
    const selected = new Set(c.items.map((i) => i.id));
    const overrides = {};
    const body = h('div');
    const countLbl = h('b');
    const updateCount = () => { countLbl.textContent = c.fix ? `${fmt.num(selected.size)} από ${fmt.num(c.items.length)} επιλεγμένα` : `${fmt.num(c.items.length)} προϊόντα`; };
    const reload = () => GET('/api/checks', { force: '1', limit: 1 }).then(() => { App.refreshBadges(); openCheck(id); });
    body.appendChild(dlgHead(c.title, c.help, drawer));
    const actions = h('div', { class: 'row', style: { marginBottom: '12px' } }, sitePill(c.site), countLbl, h('span', { class: 'grow' }),
      App.reportButtons('check', { id: c.id }, 'Λίστα'),
      btn('Αγνόηση επιλεγμένων', { title: 'Δεν θα ξαναεμφανίζονται σε αυτόν τον έλεγχο (π.χ. σωστή ονομασία, εξαίρεση)', icon: 'x' }, () => {
        if (!selected.size) return toast('Διάλεξε τουλάχιστον ένα προϊόν.', { err: true });
        const keys = c.items.filter((i) => selected.has(i.id)).map((i) => i.site + ':' + i.id);
        POST('/api/checks/ignore', { id: c.id, keys, on: true }).then(() => { toast(`${fmt.num(keys.length)} δεν θα ξαναεμφανίζονται εδώ.`); reload(); }).catch(fail);
      }),
      c.fix ? btn(c.fix.label, { cls: 'primary', icon: 'download' }, () => {
        if (!selected.size) return toast('Διάλεξε τουλάχιστον ένα προϊόν.', { err: true });
        POST('/api/checks/fix', { id: c.id, ids: [...selected], overrides }).then((r) => { fileReady(r, { kind: c.fix.kind === 'transfer' ? 'new' : 'update' }); if (r.note) toast(r.note, { ms: 12000 }); }).catch(fail);
      }) : null);
    body.appendChild(actions);
    if (c.fix && c.fix.kind === 'unpublish') body.appendChild(h('div', { class: 'note warn', style: { marginBottom: '12px' } }, 'Το αρχείο κάνει τα προϊόντα «Πρόχειρα» στο ' + siteName(c.site) + ' — δεν τα διαγράφει. Στο ' + siteName('sf') + ' μένουν κανονικά.'));
    if (c.fix && c.fix.kind === 'hidegoogle') body.appendChild(h('div', { class: 'note', style: { marginBottom: '12px' } }, 'Τα προϊόντα μένουν στο ' + siteName(c.site) + ', αλλά βγαίνουν από το Google Shopping (πρόσθετο «Google for WooCommerce»). Στο Meta μπορούν να διαφημιστούν μόνο με κοινό 18+.'));
    if (c.fix && c.fix.kind === 'transfer') body.appendChild(h('div', { class: 'note', style: { marginBottom: '12px' } }, 'Φτιάχνει αρχείο εισαγωγής για το ' + siteName('st') + ' με τίτλο, περιγραφές, τιμές, φωτογραφίες, κατηγορίες, μάρκα και μεγέθη από το ' + siteName('sf') + '. Όσα απαγορεύονται στις διαφημίσεις δεν μπαίνουν· διόπτρες/σκοπευτικά μπαίνουν κρυφά από το Google. Οι κατηγορίες αντιστοιχίζονται με το ίδιο όνομα — έλεγξέ τες στις ', h('a', { href: '#/settings?tab=cats' }, 'Ρυθμίσεις → Κατηγορίες'), '.'));
    if (c.fix && c.fix.kind === 'name') body.appendChild(h('p', { class: 'hint', style: { marginTop: 0 } }, 'Η πρόταση διορθώνεται: πάτα πάνω της και γράψε τη σωστή. Ό,τι δεν θέλεις, ξετσέκαρέ το ή πάτα «Αγνόηση».'));
    const allBox = h('input', { type: 'checkbox', checked: true, 'aria-label': 'Επιλογή όλων', onchange: (e) => { if (e.target.checked) c.items.forEach((i) => selected.add(i.id)); else selected.clear(); $$rows(); updateCount(); } });
    const tbody = h('tbody');
    const hasFix = c.items.some((i) => typeof i.fix === 'string');
    const editable = c.fix && c.fix.kind === 'name';
    const $$rows = () => {
      clear(tbody);
      for (const i of c.items.slice(0, 2000)) {
        const cb = h('input', { type: 'checkbox', checked: selected.has(i.id), onchange: (e) => { if (e.target.checked) selected.add(i.id); else selected.delete(i.id); updateCount(); } });
        const fixCell = typeof i.fix === 'string'
          ? (editable ? h('input', { type: 'text', class: 'fix-edit', value: overrides[i.id] || i.fix, oninput: (e) => { overrides[i.id] = e.target.value; } }) : i.fix)
          : '';
        tbody.appendChild(h('tr', null,
          c.fix ? h('td', { class: 'w-check' }, cb) : null,
          h('td', { style: { width: '52px' } }, thumb(i.img)),
          h('td', { class: 'title' }, h('a', { href: '#', onclick: (e) => { e.preventDefault(); App.openProduct(i.site, i.id); } }, i.name), i.why ? h('div', { class: 'faint', style: { fontWeight: 400, fontSize: '12.5px' } }, i.why) : null),
          hasFix ? h('td', { class: 'title', style: { color: 'var(--ok)', minWidth: editable ? '320px' : null } }, fixCell) : null,
          h('td', { class: 'mono' }, i.sku || ''),
          h('td', { class: 'num' }, fmt.money(i.price))));
      }
    };
    $$rows();
    updateCount();
    body.appendChild(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, c.fix ? h('th', { class: 'w-check' }, allBox) : null, h('th', null, ''), h('th', null, 'Προϊόν'), hasFix ? h('th', null, 'Διόρθωση') : null, h('th', null, 'Κωδικός'), h('th', { class: 'num' }, 'Τιμή'))), tbody)));
    if (c.items.length > 2000) body.appendChild(h('p', { class: 'faint' }, 'Εμφανίζονται τα πρώτα 2.000. Το αρχείο περιλαμβάνει όλα τα επιλεγμένα.'));
    if (c.ignoredCount) {
      const ign = h('div', { class: 'stack s', style: { marginTop: '14px' } });
      ign.appendChild(h('button', { type: 'button', class: 'btn sm ghost', onclick: async () => {
        const list = await GET('/api/checks/ignored', { id: c.id });
        clear(ign).appendChild(h('h3', { style: { fontSize: '14px', margin: 0 } }, `Αγνοημένα (${list.length})`));
        for (const it of list) ign.appendChild(h('div', { class: 'row tight' }, h('span', { class: 'grow' }, it.name), btn('Να ξαναφαίνεται', { cls: 'sm' }, () => POST('/api/checks/ignore', { id: c.id, keys: [it.site + ':' + it.id], on: false }).then(reload).catch(fail))));
      } }, `${fmt.num(c.ignoredCount)} αγνοημένα — εμφάνιση`));
      body.appendChild(ign);
    }
    drawer.open(body, { wide: true, onClose: () => { if (App.parseHash().params.open) go('checks'); } });
  }
})();
