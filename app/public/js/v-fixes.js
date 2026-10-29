/* Διορθώσεις — everything the program filled in by itself, waiting for a yes */
'use strict';
(function () {
  const { h, clear, btn, icon, fmt, GET, POST, toast, fail, modal, dlgHead, thumb, pageHead, siteName, sitePill, fileReady, watchJob, debounce } = App;
  const STATUS = [['pending', 'Περιμένουν'], ['approved', 'Εγκρίθηκαν'], ['exported', 'Στο αρχείο'], ['rejected', 'Απορρίφθηκαν']];
  const LEVEL = { high: ['Σίγουρο', 'ok'], medium: ['Δες το', 'warn'] };

  // word-level difference of two titles: each word that changes is shown as old → new, side by side
  function wordDiff(a, b) {
    const A = String(a || '').split(/\s+/).filter(Boolean), B = String(b || '').split(/\s+/).filter(Boolean);
    const n = A.length, m = B.length;
    const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const ops = [];
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && A[i] === B[j]) { ops.push(['eq', A[i]]); i++; j++; }
      else if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) { ops.push(['del', A[i]]); i++; }
      else { ops.push(['ins', B[j]]); j++; }
    }
    // inside every changed stretch: old word, new word, old word, new word…
    const out = [];
    for (let k = 0; k < ops.length;) {
      if (ops[k][0] === 'eq') { out.push(h('span', null, ops[k][1]), ' '); k++; continue; }
      const dels = [], ins = [];
      while (k < ops.length && ops[k][0] !== 'eq') { (ops[k][0] === 'del' ? dels : ins).push(ops[k][1]); k++; }
      for (let x = 0; x < Math.max(dels.length, ins.length); x++) {
        if (dels[x]) out.push(h('del', null, dels[x]), ' ');
        if (ins[x]) out.push(h('ins', null, ins[x]), ' ');
      }
    }
    if (!ops.some((o) => o[0] !== 'eq')) out.push(h('span', { class: 'faint' }, ' (αλλάζουν μόνο τα κενά)'));
    return h('div', { class: 'wdiff' }, out);
  }
  // plain text of a description (a space between paragraphs and list items, not "μέροςΘήκη")
  // (parsed as an inert document: nothing in a supplier's text can run or load)
  const textOf = (html) => { const d = new DOMParser().parseFromString(String(html || '').replace(/<(\/?)(p|li|h\d|div|tr|td|th|ul|ol|br)\b/gi, ' <$1$2'), 'text/html'); return ((d.body && d.body.textContent) || '').replace(/\s+/g, ' ').trim(); };

  function preview(label, html, empty) {
    const box = h('div', { class: 'fx-prev' }, h('div', { class: 'faint fx-cap' }, label));
    const t = textOf(html);
    if (!t) { box.appendChild(h('div', { class: 'fx-empty' }, empty || 'Τίποτα')); return box; }
    box.appendChild(h('div', { class: 'fx-text' }, t.length > 260 ? t.slice(0, 260) + '…' : t, h('span', { class: 'faint' }, ` · ${fmt.num(t.length)} χαρ.`)));
    box.appendChild(h('button', { type: 'button', class: 'linkish', onclick: () => modal.open(h('div', null, dlgHead(label), App.sandboxPreview(html), h('div', { class: 'dlg-foot' }, btn('Κλείσιμο', { cls: 'primary' }, () => modal.close())))) }, 'Πλήρης προβολή'));
    return box;
  }

  function changeBody(c) {
    const to = c.to, from = c.from;
    switch (c.field) {
      case 'name': return wordDiff(from, to);
      case 'desc': return h('div', { class: 'fx-cmp' }, preview('Τώρα', from, 'Χωρίς περιγραφή'), preview('Πρόταση', to.html), to.meta ? h('div', { class: 'hint fx-meta' }, h('b', null, 'Meta description (Google): '), to.meta) : null);
      case 'short': return h('div', { class: 'fx-cmp' }, preview('Τώρα', from, 'Χωρίς σύντομη περιγραφή'), preview('Πρόταση', to));
      case 'images': {
        const old = new Set(from || []);
        return h('div', { class: 'fx-imgs' }, (to || []).map((u) => h('div', { class: 'fx-img' + (old.has(u) ? '' : ' new') }, thumb(u), old.has(u) ? null : h('span', null, 'νέα'))));
      }
      case 'price': return h('div', { class: 'fx-price' }, h('del', null, fmt.money(from.price)), icon('arrow'), h('ins', null, fmt.money(to.sale > 0 ? to.sale : to.regular)), to.sale > 0 ? h('span', { class: 'faint' }, ` (προσφορά· κανονική ${fmt.money(to.regular)})`) : null);
      case 'cats': return h('div', { class: 'fx-price' }, h('del', null, from), icon('arrow'), h('ins', null, to.path));
      case 'published': return h('div', { class: 'fx-price' }, h('del', null, 'Δημοσιευμένο'), icon('arrow'), h('ins', null, 'Πρόχειρο'));
      case 'gla': return h('div', { class: 'fx-price' }, h('del', null, 'Google Shopping'), icon('arrow'), h('ins', null, 'μόνο στο site'));
      case 'brand': return h('div', { class: 'fx-price' }, h('ins', null, to));
      case 'gtin': return h('div', { class: 'fx-price mono' }, h('ins', null, to), h('span', { class: 'faint' }, ' · σωστό ψηφίο ελέγχου'));
      default: return null;
    }
  }

  App.views.fixes = {
    async render(main, p) {
      let status = STATUS.some(([k]) => k === p.tab) ? p.tab : 'pending';
      let site = p.site === 'sf' || p.site === 'st' ? p.site : '';
      let group = p.group || '';
      let level = '';
      let q = '';
      let page = 1;
      const head = h('div');
      const qual = h('div', { class: 'fx-quality' });
      const tabs = h('div', { class: 'tabs' });
      const bar = h('div', { class: 'toolbar' });
      const chips = h('div', { class: 'row tight' });
      const act = h('div', { class: 'fx-act' });
      const list = h('div', { class: 'stack s' });
      const pager = h('div');
      main.appendChild(head); main.appendChild(qual); main.appendChild(tabs); main.appendChild(bar); main.appendChild(act); main.appendChild(list); main.appendChild(pager);
      const search = h('input', { type: 'search', placeholder: 'Αναζήτηση προϊόντος', oninput: debounce((e) => { q = e.target.value; page = 1; load(); }, 300) });
      const by = () => (App.me ? App.me.name : '');

      const find = () => POST('/api/fixes/find', {}).then((job) => {
        toast('Ψάχνω στους τιμοκαταλόγους και στις σελίδες των αντιπροσώπων. Μπορείς να συνεχίσεις τη δουλειά σου.');
        watchJob(job, { done: (r) => { if (r) toast(`Βρέθηκαν πηγές για ${fmt.num(r.found)} από ${fmt.num(r.needs)} προϊόντα (${fmt.num(r.pages)} σελίδες αντιπροσώπων).`, { ms: 9000 }); App.refreshBadges(); if (App.parseHash().view === 'fixes') load(); } });
      }).catch(fail);
      const doExport = (s) => POST('/api/fixes/export', { site: s }).then((r) => {
        fileReady(Object.assign({ site: s }, r), { title: 'Αρχείο διορθώσεων έτοιμο' });
        if (r.gtin) toast('Το αρχείο έχει και EAN (στήλη GTIN): χρειάζεται WooCommerce 9.2 ή νεότερο — αλλιώς στην εισαγωγή άφησέ τη στήλη «Να μη γίνει εισαγωγή».', { ms: 12000 });
        load(); App.refreshBadges();
      }).catch(fail);

      const decide = (ids, st, edited) => POST('/api/fixes/decide', { ids, status: st, edited }).then(() => { App.refreshBadges(); load(); }).catch(fail);

      const edit = (c) => {
        const cur = c.field === 'desc' ? c.to.html : c.to;
        const ta = h(c.field === 'name' ? 'input' : 'textarea', c.field === 'name' ? { type: 'text', value: cur, class: 'fix-edit', style: { width: '100%' } } : { rows: 14, style: { width: '100%', fontFamily: 'Cascadia Mono, Consolas, monospace', fontSize: '12.5px' } });
        if (c.field !== 'name') ta.value = cur;
        modal.open(h('div', null, dlgHead('Αλλαγή πρότασης · ' + c.label, c.name),
          c.field === 'name' ? h('p', { class: 'hint' }, 'Γίνεται αυτόματα κεφαλαία χωρίς τόνους.') : h('p', { class: 'hint' }, 'HTML: <p>, <ul><li>, <strong>, <h2>. Ό,τι άλλο καθαρίζεται.'),
          ta, h('div', { class: 'dlg-foot' }, btn('Άκυρο', () => modal.close()), btn('Αποθήκευση και έγκριση', { cls: 'primary', icon: 'check' }, () => { modal.close(); decide([c.id], 'approved', c.field === 'desc' ? { html: ta.value } : ta.value); }))), { wide: c.field !== 'name' });
      };
      const pageSource = (card) => {
        const url = h('input', { type: 'url', placeholder: 'https://… (σελίδα κατασκευαστή ή αντιπροσώπου)', autofocus: true, style: { width: '100%' } });
        modal.open(h('div', null, dlgHead('Πηγή από σελίδα', card.name),
          h('p', { class: 'muted' }, 'Δώσε τη σελίδα του ίδιου προϊόντος στον κατασκευαστή ή στον αντιπρόσωπο. Το πρόγραμμα παίρνει περιγραφή, χαρακτηριστικά και φωτογραφίες, και ελέγχει ότι είναι το ίδιο προϊόν.'),
          url, h('div', { class: 'dlg-foot' }, btn('Άκυρο', () => modal.close()), btn('Ανάγνωση', { cls: 'primary', icon: 'download' }, () => POST('/api/fixes/page', { site: card.site, id: card.pid, url: url.value }).then((r) => { modal.close(); toast(r.sameProduct ? 'Διαβάστηκε: «' + r.name + '».' : 'Διαβάστηκε, αλλά ο τίτλος της σελίδας («' + r.name + '») δεν μοιάζει με το προϊόν — έλεγξε την πρόταση.', { ms: 9000, err: !r.sameProduct }); load(); }).catch(fail)))));
      };

      const drawHead = (v) => {
        clear(head).appendChild(pageHead('Διορθώσεις', 'Ό,τι λείπει ή είναι λάθος, το πρόγραμμα το συμπληρώνει μόνο του — εδώ, όχι στα sites. Εσύ εγκρίνεις· ένα αρχείο τα περνάει στο WooCommerce.', [
          btn('Βρες περιγραφές και φωτογραφίες', { icon: 'search', title: 'Στους τιμοκαταλόγους και στις σελίδες των αντιπροσώπων (γίνεται και μόνο του κάθε μέρα)' }, find),
          ['sf', 'st'].map((s) => (v.counts.sites[s] ? btn(`Αρχείο ${App.SITE_SHORT[s]} (${fmt.num(v.counts.sites[s])})`, { cls: 'primary', icon: 'download', title: 'Αρχείο ενημέρωσης WooCommerce με τις εγκεκριμένες διορθώσεις του ' + siteName(s) }, () => doExport(s)) : null)),
        ]));
        clear(qual);
        for (const x of v.quality) {
          qual.appendChild(h('div', { class: 'panel fx-q' },
            h('div', { class: 'fx-q-head' }, sitePill(x.site), h('span', { class: 'faint' }, `Ποιότητα καταλόγου · ${fmt.num(x.products)} προϊόντα`)),
            h('div', { class: 'fx-q-score' }, h('b', { class: 'now' }, x.score), h('span', { class: 'faint' }, '/100'), x.after > x.score ? [icon('arrow'), h('b', { class: 'after', title: 'Αν εγκριθούν οι διορθώσεις που περιμένουν' }, x.after), h('span', { class: 'faint' }, 'μετά τις διορθώσεις')] : null),
            h('div', { class: 'fx-q-parts' }, x.parts.map((pt) => h('div', { class: 'fx-q-part', title: `${pt.label}: ${pt.pct}% των προϊόντων (βάρος ${pt.weight})` }, h('span', null, pt.label), h('div', { class: 'bar' }, h('i', { style: { width: pt.pct + '%' }, class: pt.pct >= 85 ? 'ok' : pt.pct >= 60 ? 'mid' : 'low' })), h('b', null, pt.pct + '%'))))));
        }
      };

      const load = async () => {
        let v;
        try { v = await GET('/api/fixes', { site, status, group, level, q, page, per: 30 }); } catch (e) { clear(list).appendChild(h('div', { class: 'note crit' }, e.message)); return; }
        drawHead(v);
        clear(tabs);
        for (const [k, l] of STATUS) tabs.appendChild(h('button', { 'aria-selected': String(status === k), onclick: () => { status = k; page = 1; load(); } }, l, v.counts.status[k] ? h('span', { class: 'badge' + (k === 'pending' ? ' coy' : '') }, fmt.num(v.counts.status[k])) : null));
        // the site switch and the search box are made once (the search keeps the focus while you type)
        if (!bar.firstChild) { bar.appendChild(App.seg([['', 'Και τα δύο'], ['sf', siteName('sf')], ['st', siteName('st')]], site, (x) => { site = x; page = 1; load(); })); bar.appendChild(chips); bar.appendChild(search); }
        clear(chips);
        chips.appendChild(h('button', { type: 'button', class: 'chip' + (!group ? ' on' : ''), onclick: () => { group = ''; page = 1; load(); } }, 'Όλα'));
        for (const [k, l] of Object.entries(v.groups)) if (v.counts.groups[k] || group === k) chips.appendChild(h('button', { type: 'button', class: 'chip' + (group === k ? ' on' : ''), onclick: () => { group = k; page = 1; load(); } }, l, ' ', h('b', null, fmt.num(v.counts.groups[k] || 0))));
        if (status === 'pending') chips.appendChild(h('button', { type: 'button', class: 'chip' + (level === 'high' ? ' on' : ''), title: 'Μόνο όσα βγαίνουν από κανόνες ή από σίγουρη πηγή (ίδιο EAN / κωδικός)', onclick: () => { level = level === 'high' ? '' : 'high'; page = 1; load(); } }, 'Μόνο σίγουρα'));
        clear(act);
        if (status === 'pending' && v.counts.high) act.appendChild(h('div', { class: 'fx-sure' }, icon('check'), h('div', null, h('b', null, `${fmt.plural(v.counts.high, 'σίγουρη διόρθωση', 'σίγουρες διορθώσεις')}${group ? ' (' + v.groups[group] + ')' : ''}`), h('div', { class: 'hint', style: { margin: 0 } }, 'Από κανόνες (κενά, κεφαλαία, τόνοι, γράμματα, τιμές, διαφημίσεις) ή από σίγουρη πηγή (ίδιο EAN / κωδικός στον αντιπρόσωπο, το άλλο μας site).')),
          btn('Έγκριση όλων των σίγουρων', { cls: 'primary', icon: 'check' }, () => POST('/api/fixes/approve-sure', { site, group }).then((r) => { toast(`Εγκρίθηκαν ${fmt.num(r.count)}. Φτιάξε το αρχείο από πάνω δεξιά.`); App.refreshBadges(); load(); }).catch(fail))));
        clear(list);
        if (!v.cards.length) {
          list.appendChild(h('div', { class: 'panel empty' }, h('h3', null, status === 'pending' ? 'Τίποτα δεν περιμένει' : 'Κανένα εδώ'),
            h('p', null, status === 'pending' ? 'Δεν βρέθηκε κάτι να διορθωθεί με σιγουριά. Για περιγραφές/φωτογραφίες που λείπουν, πάτα «Βρες περιγραφές και φωτογραφίες» (χρειάζονται τιμοκατάλογοι αντιπροσώπων).' : ''),
            status === 'pending' ? btn('Βρες περιγραφές και φωτογραφίες', { cls: 'primary', icon: 'search' }, find) : null));
        }
        for (const cd of v.cards) list.appendChild(card(cd, v));
        clear(pager);
        const pages = Math.ceil(v.total / 30);
        if (pages > 1) pager.appendChild(h('div', { class: 'pager' }, btn('‹', { cls: 'sm', disabled: page <= 1 }, () => { page--; load(); window.scrollTo(0, 0); }), h('span', null, `Σελίδα ${page} από ${pages} · ${fmt.num(v.total)} προϊόντα`), btn('›', { cls: 'sm', disabled: page >= pages }, () => { page++; load(); window.scrollTo(0, 0); })));
      };

      const card = (cd, v) => {
        const ids = cd.changes.map((c) => c.id);
        const el = h('div', { class: 'panel fx-card' });
        el.appendChild(h('div', { class: 'fx-card-head' }, thumb(cd.img),
          h('div', { class: 'grow', style: { minWidth: 0 } }, h('a', { href: '#', class: 'fx-title', onclick: (e) => { e.preventDefault(); App.openProduct(cd.site, cd.pid); } }, cd.name),
            h('div', { class: 'faint', style: { fontSize: '12.5px' } }, sitePill(cd.site), cd.sku ? ' · ' + cd.sku : '', ' · ', fmt.plural(cd.changes.length, 'αλλαγή', 'αλλαγές'))),
          h('div', { class: 'row tight' },
            status === 'pending' ? btn('Έγκριση όλων', { cls: 'sm primary', icon: 'check' }, () => decide(ids.filter((id) => (cd.changes.find((c) => c.id === id) || {}).exportable !== false), 'approved')) : btn('Επαναφορά', { cls: 'sm' }, () => decide(ids, 'pending')),
            status === 'pending' ? btn('Όχι', { cls: 'sm ghost', icon: 'x' }, () => decide(ids, 'rejected')) : null)));
        for (const c of cd.changes) {
          const lv = LEVEL[c.level] || LEVEL.medium;
          el.appendChild(h('div', { class: 'fx-change ' + c.level },
            h('div', { class: 'fx-ch-head' }, h('span', { class: 'pill' }, c.label), h('span', { class: 'pill ' + lv[1], title: c.level === 'high' ? 'Κανόνας ή σίγουρη πηγή' : 'Πιθανότατα σωστό — ρίξε μια ματιά' }, lv[0]),
              c.edited ? h('span', { class: 'pill' }, 'αλλαγμένο από εσένα') : null, c.by ? h('span', { class: 'faint', style: { fontSize: '12px' } }, c.by + ' · ' + fmt.ago(c.at)) : null,
              h('span', { class: 'grow' }),
              status === 'pending' && c.exportable !== false ? btn('Έγκριση', { cls: 'sm', icon: 'check' }, () => decide([c.id], 'approved')) : null,
              status === 'pending' ? btn('Όχι', { cls: 'sm ghost' }, () => decide([c.id], 'rejected')) : null,
              status !== 'exported' && ['name', 'desc', 'short'].includes(c.field) ? btn('Αλλαγή', { cls: 'sm ghost', icon: 'edit' }, () => edit(c)) : null),
            h('p', { class: 'fx-why' }, c.why),
            changeBody(c),
            h('div', { class: 'fx-src' }, 'Πηγή: ', c.source && c.source.url ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); App.openUrl(c.source.url); } }, c.source.label) : (c.source ? c.source.label : '—'),
              c.field === 'desc' && c.english && v.ai ? btn('Μετάφραση με AI', { cls: 'sm ghost' }, () => { toast('Μετάφραση… (μπορεί να πάρει λίγο)'); POST('/api/fixes/translate', { site: cd.site, id: cd.pid }).then(() => { toast('Μεταφράστηκε: διάβασέ τη πριν την έγκριση.'); load(); }).catch(fail); }) : null,
              c.group === 'content' && status === 'pending' ? h('button', { type: 'button', class: 'linkish', onclick: () => pageSource(cd) }, 'άλλη σελίδα ως πηγή…') : null)));
        }
        return el;
      };
      load();
    },
  };
})();
