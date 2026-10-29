/* Ροή εργασίας: κωδικός → στοιχεία → περιγραφές → τιμές */
'use strict';
(function () {
  const { h, clear, btn, fmt, GET, pageHead, siteName, sitePill, debounce } = App;
  const STATE = {
    manual: ['Θέλει δικό σου χέρι', 'crit'],
    approve: ['Έτοιμη διόρθωση: περιμένει έγκριση', 'warn'],
    decide: ['Απόφαση τιμής', 'warn'],
    done: ['Εγκρίθηκε', 'ok'],
  };
  const STEP_NOTE = {
    1: 'Ο κωδικός (SKU) δένει το προϊόν με τον τιμοκατάλογο του αντιπροσώπου, με τα δύο sites και με την αγορά. Πρώτα αυτός: χωρίς κωδικό καμία σύγκριση δεν είναι σίγουρη.',
    2: 'Μάρκα, κατηγορία και τίτλος ΕΙΔΟΣ ΜΑΡΚΑ ΜΟΝΤΕΛΟ. Οι περισσότερες διορθώσεις είναι έτοιμες στις «Διορθώσεις»: εσύ εγκρίνεις.',
    3: 'Περιγραφή και φωτογραφίες από τον αντιπρόσωπο, καθαρισμένες από τηλέφωνα και τιμές του. Η περιγραφή ξεκινά με τον τίτλο, π.χ. «Φακός Nitecore MS450 Black».',
    4: 'Μόνο προϊόντα με σωστά στοιχεία έρχονται εδώ. Τιμή πάνω από το κόστος, ίδια στα δύο sites και σωστή μπροστά στην αγορά.',
    5: 'Όλα σωστά. Όσα έχουν εγκεκριμένες διορθώσεις περιμένουν το αρχείο να ανέβει στο site.',
  };

  App.views.flow = {
    async render(main, p) {
      main.appendChild(pageHead('Ροή εργασίας', 'Πρώτα ο κωδικός, μετά τα στοιχεία, μετά οι περιγραφές και μόνο στο τέλος οι τιμές. Κάθε προϊόν στέκεται στο πρώτο βήμα που έχει ακόμα κάτι να διορθωθεί.'));
      const st = App.state.summary;
      if (!st.sf.syncedAt && !st.st.syncedAt) {
        main.appendChild(h('div', { class: 'panel empty' }, h('h3', null, 'Πρώτα διάβασε τα προϊόντα'), h('p', null, 'Η ροή φτιάχνεται από τα στοιχεία των sites.'), btn('Ανάγνωση τώρα', { cls: 'primary', icon: 'sync' }, () => App.startSync())));
        return;
      }
      let stage = Number(p.stage) || 0, site = p.site || '', q = p.q || '';
      const steps = h('div', { class: 'flow-steps' });
      const note = h('div', { class: 'note' });
      const bar = h('div', { class: 'toolbar' });
      const box = h('div', { class: 'stack' });
      const search = h('input', { type: 'search', placeholder: 'Αναζήτηση: όνομα ή κωδικός', value: q, oninput: debounce((e) => { q = e.target.value; load(); }, 300) });
      bar.appendChild(App.seg([['', 'Και τα δύο'], ['sf', siteName('sf')], ['st', siteName('st')]], site, (v) => { site = v; load(); }));
      bar.appendChild(search);
      main.appendChild(steps); main.appendChild(note); main.appendChild(bar); main.appendChild(box);

      const load = async () => {
        const v = await GET('/api/flow', { stage: stage || '', site, q });
        stage = v.stage;
        clear(steps);
        for (const s of v.stages) {
          const n = s.count.sf + s.count.st;
          steps.appendChild(h('button', { type: 'button', class: 'flow-step' + (s.n === stage ? ' on' : '') + (s.n === v.next ? ' next' : '') + (s.n === 5 ? ' end' : ''), 'aria-pressed': String(s.n === stage), onclick: () => { stage = s.n; load(); } },
            h('span', { class: 'fs-n' }, s.n === 5 ? '✓' : String(s.n)),
            h('b', null, fmt.num(n)),
            h('span', { class: 'fs-t' }, s.title),
            s.n < 5 && n ? h('small', null, [s.approve ? `${s.approve} για έγκριση` : '', s.manual ? `${s.manual} με το χέρι` : ''].filter(Boolean).join(' · ')) : (s.n === v.next ? null : s.n === 5 ? h('small', null, `${fmt.num(v.total.sf + v.total.st)} προϊόντα όλα`) : h('small', null, 'τίποτα'))));
        }
        clear(note);
        note.appendChild(h('div', null, h('b', null, `Βήμα ${stage === 5 ? '✓' : stage}: ${v.stages[stage - 1].title}. `), STEP_NOTE[stage]));
        if (stage === 4) note.appendChild(h('div', { class: 'row', style: { marginTop: '8px' } }, btn('Τιμές αγοράς (μόνο έτοιμα προϊόντα)', { cls: 'primary sm', icon: 'market' }, () => App.go('market', { ready: '1' }))));
        if (stage === 2 || stage === 3) note.appendChild(h('div', { class: 'row', style: { marginTop: '8px' } }, btn('Έγκριση διορθώσεων', { cls: 'primary sm', icon: 'fixes' }, () => App.go('fixes', site ? { site } : null))));
        if (v.next < stage && stage < 5) note.appendChild(h('div', { class: 'faint', style: { marginTop: '6px' } }, `Πρώτα όσα είναι στο βήμα ${v.next}: έτσι δεν δουλεύεις δύο φορές το ίδιο προϊόν.`));

        clear(box);
        if (!v.rows.length) { box.appendChild(h('div', { class: 'panel empty' }, h('h3', null, stage === 5 ? 'Κανένα προϊόν ακόμα εδώ' : 'Όλα καλά σε αυτό το βήμα'), h('p', null, stage === 5 ? 'Μόλις ολοκληρωθούν τα βήματα, τα προϊόντα εμφανίζονται εδώ.' : 'Κανένα προϊόν δεν περιμένει εδώ.'))); return; }
        if (v.matches > v.rows.length) box.appendChild(h('p', { class: 'muted', style: { margin: 0 } }, `Δείχνω τα πρώτα ${v.rows.length} από ${fmt.num(v.matches)}. Η αναζήτηση τα στενεύει.`));
        for (const r of v.rows) {
          box.appendChild(h('div', { class: 'flow-card' },
            h('div', { class: 'fc-thumb' }, App.thumb(r.img)),
            h('div', { class: 'fc-main' },
              h('div', { class: 'fc-title' }, h('b', null, r.name), ' ', sitePill(r.site)),
              h('div', { class: 'faint' }, [r.sku ? 'Κωδικός ' + r.sku : 'Χωρίς κωδικό', r.price ? fmt.money(r.price) : 'Χωρίς τιμή'].join(' · ')),
              h('ul', { class: 'fc-problems' }, r.problems.map((x) => h('li', { class: STATE[x.state] ? STATE[x.state][1] : '' },
                h('span', { class: 'fc-state' }, (STATE[x.state] || [''])[0]), ' ', x.text,
                x.hint ? h('div', { class: 'faint' }, x.hint) : null)))),
            h('div', { class: 'fc-act' },
              btn('Άνοιγμα', { cls: 'sm', icon: 'search' }, () => App.openProduct(r.site, r.id)),
              r.problems.some((x) => x.state === 'approve') ? btn('Έγκριση', { cls: 'sm primary', icon: 'fixes' }, () => App.go('fixes', { site: r.site, q: r.sku || r.name })) : null,
              r.problems.some((x) => x.state === 'decide') ? btn('Τιμή', { cls: 'sm primary', icon: 'market' }, () => App.go('market', { site: r.site, q: r.sku || r.name, f: 'all' })) : null)));
        }
      };
      await load();
    },
  };
})();
