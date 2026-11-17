/* Διορθώσεις — everything the program filled in by itself, waiting for a yes */
'use strict';
(function () {
  const { h, clear, btn, icon, fmt, GET, POST, toast, fail, modal, dlgHead, thumb, pageHead, siteName, sitePill, fileReady, watchJob, debounce } = App;
  const STATUS = [['pending', 'Περιμένουν'], ['approved', 'Εγκρίθηκαν'], ['exported', 'Στο αρχείο'], ['rejected', 'Απορρίφθηκαν']];
  const LEVEL = { high: ['Σίγουρο', 'ok'], medium: ['Δες το', 'warn'] };

  // word-level difference of two titles → the old title with what leaves marked, the new one with what comes marked
  function wordDiff(a, b) {
    const A = String(a || '').split(/\s+/).filter(Boolean), B = String(b || '').split(/\s+/).filter(Boolean);
    const n = A.length, m = B.length;
    const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const before = [], after = [];
    let i = 0, j = 0, changed = false;
    while (i < n || j < m) {
      if (i < n && j < m && A[i] === B[j]) { before.push(h('span', null, A[i]), ' '); after.push(h('span', null, B[j]), ' '); i++; j++; }
      else if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) { before.push(h('del', null, A[i]), ' '); i++; changed = true; }
      else { after.push(h('ins', null, B[j]), ' '); j++; changed = true; }
    }
    if (!changed) after.push(h('span', { class: 'faint' }, ' (αλλάζουν μόνο τα κενά)'));
    return { before, after };
  }
  /** «Πριν» over «Μετά», the same way for every kind of change: what is there now, what it becomes. */
  function beforeAfter(before, after, opts) {
    const o = opts || {};
    return h('div', { class: 'ba' + (o.cls ? ' ' + o.cls : '') },
      h('div', { class: 'ba-row ba-old' }, h('span', { class: 'ba-cap' }, 'Πριν'), h('div', { class: 'ba-val' }, before)),
      h('div', { class: 'ba-row ba-new' }, h('span', { class: 'ba-cap' }, 'Μετά'), h('div', { class: 'ba-val' }, after)));
  }
  const none = (text) => h('span', { class: 'ba-none' }, text || '—');
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
      case 'name': { const d = wordDiff(from, to); return beforeAfter(d.before, d.after, { cls: 'wdiff' }); }
      case 'desc': return h('div', { class: 'fx-cmp' }, preview('Πριν', from, 'Χωρίς περιγραφή'), preview('Μετά', to.html), to.meta ? h('div', { class: 'hint fx-meta' }, h('b', null, 'Meta description (Google): '), to.meta) : null);
      case 'short': return h('div', { class: 'fx-cmp' }, preview('Πριν', from, 'Χωρίς σύντομη περιγραφή'), preview('Μετά', to));
      case 'images': {
        const old = new Set(from || []);
        const added = (to || []).filter((u) => !old.has(u)).length;
        return beforeAfter(
          (from || []).length ? h('div', { class: 'fx-imgs' }, (from || []).map((u) => h('div', { class: 'fx-img' }, thumb(u)))) : none('Χωρίς φωτογραφία'),
          [h('div', { class: 'fx-imgs' }, (to || []).map((u) => h('div', { class: 'fx-img' + (old.has(u) ? '' : ' new') }, thumb(u), old.has(u) ? null : h('span', null, 'νέα')))), h('div', { class: 'faint ba-note' }, `${fmt.plural((to || []).length, 'φωτογραφία', 'φωτογραφίες')} (${added} ${added === 1 ? 'νέα' : 'νέες'})`)], { cls: 'ba-imgs' });
      }
      case 'price': return beforeAfter(h('del', null, fmt.money(from.price)), [h('ins', null, fmt.money(to.sale > 0 ? to.sale : to.regular)), to.sale > 0 ? h('span', { class: 'faint' }, ` (προσφορά· κανονική ${fmt.money(to.regular)})`) : null]);
      case 'cats': return beforeAfter(from && from !== '—' ? h('del', null, from) : none('Χωρίς κατηγορία'), h('ins', null, to.path));
      case 'published': return beforeAfter(h('del', null, 'Δημοσιευμένο'), h('ins', null, 'Πρόχειρο (δεν φαίνεται στο site)'));
      case 'gla': return beforeAfter(h('del', null, 'Στο site και στο Google Shopping'), h('ins', null, 'Μόνο στο site'));
      case 'brand': return beforeAfter(from ? h('del', null, from) : none('Χωρίς μάρκα'), h('ins', null, to));
      case 'gtin': return beforeAfter(from ? h('del', null, from) : none('Χωρίς EAN'), [h('ins', { class: 'mono' }, to), h('span', { class: 'faint' }, ' · σωστό ψηφίο ελέγχου')]);
      default: return null;
    }
  }
  // how sure a proposal is, in words, next to its source
  const SURE = { high: 'υψηλή — κανόνας ή ίδια ταυτότητα προϊόντος (κωδικός / EAN / το άλλο σας site)', medium: 'μέτρια — πιθανότατα σωστό, ρίξε μια ματιά' };

  App.views.fixes = {
    async render(main, p) {
      let status = STATUS.some(([k]) => k === p.tab) ? p.tab : 'pending';
      let site = p.site === 'sf' || p.site === 'st' ? p.site : '';
      let group = p.group || '';
      let level = p.level === 'high' ? 'high' : '';
      let q = p.q || '';
      let page = Math.max(1, Number(p.page) || 1);
      const head = h('div');
      const qual = h('div', { class: 'fx-quality' });
      const tabs = h('div', { class: 'tabs' });
      const bar = h('div', { class: 'toolbar' });
      const chips = h('div', { class: 'row tight' });
      const act = h('div', { class: 'fx-act' });
      const list = h('div', { class: 'stack s' });
      const pager = h('div');
      main.appendChild(head); main.appendChild(qual); main.appendChild(tabs); main.appendChild(bar); main.appendChild(act); main.appendChild(list); main.appendChild(pager);
      const search = h('input', { type: 'search', placeholder: 'Αναζήτηση προϊόντος', value: q, oninput: debounce((e) => { q = e.target.value; page = 1; load(); }, 300) });
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

      // A decision shows at once: the change leaves the list, the numbers follow, and the program saves it behind the
      // screen. The list is brought up to date quietly when the decisions stop for a moment (never while you tap).
      let settleTimer = null, waiting = 0;
      const settle = () => { clearTimeout(settleTimer); settleTimer = setTimeout(() => { if (waiting || !main.isConnected) return; App.refreshBadges(); load(); }, 900); };
      const leave = (ids) => {
        const gone = new Set(ids);
        let n = 0;
        for (const row of list.querySelectorAll('.fx-change[data-id]')) {
          if (!gone.has(row.dataset.id)) continue;
          n++;
          const cardEl = row.closest('.fx-card');
          row.classList.add('leaving'); row.removeAttribute('data-id');
          const left = cardEl ? cardEl.querySelectorAll('.fx-change[data-id]').length : 1;
          if (cardEl && !left) cardEl.classList.add('leaving');
          setTimeout(() => { row.remove(); if (cardEl && !left) cardEl.remove(); }, 170);
        }
        return n;
      };
      const bump = (from, to, n) => {
        if (!n) return;
        for (const [k, d] of [[from, -n], [to, n]]) {
          const b = tabs.querySelector(`button[data-k="${k}"] .badge`);
          if (b) b.textContent = fmt.num(Math.max(0, Number(String(b.textContent).replace(/\D/g, '')) + d));
        }
        if (from === 'pending' && App.badges.fixes) { App.badges.fixes.n = Math.max(0, App.badges.fixes.n - n); App.renderNav('fixes'); }
      };
      const decide = (ids, st, edited) => {
        if (!ids.length) return Promise.resolve();
        const n = leave(ids);
        bump(status, st, n);
        waiting++;
        return POST('/api/fixes/decide', { ids, status: st, edited }).then(() => { waiting--; settle(); }).catch((e) => { waiting--; fail(e); load(); });
      };

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
        const wasOpen = (qual.querySelector('details') || { open: window.innerWidth > 820 }).open;
        clear(qual);
        const panels = h('div', { class: 'fx-q-grid' });
        if (v.quality.length) qual.appendChild(h('details', { class: 'fx-qd', open: wasOpen ? '' : null },
          h('summary', null, h('span', { class: 'fx-qd-t' }, 'Ποιότητα καταλόγου'),
            v.quality.map((x) => h('span', { class: 'fx-qd-s' }, sitePill(x.site), h('b', null, x.score), x.after > x.score ? [icon('arrow'), h('b', { class: 'after' }, x.after)] : null)),
            h('span', { class: 'fx-qd-more' }, icon('chev'))),
          panels));
        for (const x of v.quality) {
          panels.appendChild(h('div', { class: 'panel fx-q' },
            h('div', { class: 'fx-q-head' }, sitePill(x.site), h('span', { class: 'faint' }, `Ποιότητα καταλόγου · ${fmt.num(x.products)} προϊόντα`)),
            h('div', { class: 'fx-q-score' }, h('b', { class: 'now' }, x.score), h('span', { class: 'faint' }, '/100'), x.after > x.score ? [icon('arrow'), h('b', { class: 'after', title: 'Αν εγκριθούν οι διορθώσεις που περιμένουν' }, x.after), h('span', { class: 'faint' }, 'μετά τις διορθώσεις')] : null),
            h('div', { class: 'fx-q-parts' }, x.parts.map((pt) => h('div', { class: 'fx-q-part', title: `${pt.label}: ${pt.pct}% των προϊόντων (βάρος ${pt.weight})` }, h('span', null, pt.label), h('div', { class: 'bar' }, h('i', { style: { width: pt.pct + '%' }, class: pt.pct >= 85 ? 'ok' : pt.pct >= 60 ? 'mid' : 'low' })), h('b', null, pt.pct + '%'))))));
        }
      };

      const load = async () => {
        App.keep({ tab: status === 'pending' ? '' : status, site, group, level, q, page: page > 1 ? page : '' });
        let v;
        try { v = await GET('/api/fixes', { site, status, group, level, q, page, per: 30 }); } catch (e) { if (e && e.locked) return; clear(list).appendChild(h('div', { class: 'note crit' }, e.message)); return; }
        if (!main.isConnected || waiting) return; // a newer decision is on its way: its own refresh follows
        drawHead(v);
        clear(tabs);
        for (const [k, l] of STATUS) tabs.appendChild(h('button', { 'aria-selected': String(status === k), 'data-k': k, onclick: () => { status = k; page = 1; load(); } }, l, h('span', { class: 'badge' + (k === 'pending' ? ' coy' : ''), hidden: v.counts.status[k] ? null : '' }, fmt.num(v.counts.status[k] || 0))));
        // the site switch and the search box are made once (the search keeps the focus while you type)
        if (!bar.firstChild) { bar.appendChild(App.seg([['', 'Και τα δύο'], ['sf', siteName('sf')], ['st', siteName('st')]], site, (x) => { site = x; page = 1; load(); })); bar.appendChild(chips); bar.appendChild(search); }
        clear(chips);
        chips.appendChild(h('button', { type: 'button', class: 'chip' + (!group ? ' on' : ''), onclick: () => { group = ''; page = 1; load(); } }, 'Όλα'));
        for (const [k, l] of Object.entries(v.groups)) if (v.counts.groups[k] || group === k) chips.appendChild(h('button', { type: 'button', class: 'chip' + (group === k ? ' on' : ''), onclick: () => { group = k; page = 1; load(); } }, l, ' ', h('b', null, fmt.num(v.counts.groups[k] || 0))));
        if (status === 'pending') chips.appendChild(h('button', { type: 'button', class: 'chip' + (level === 'high' ? ' on' : ''), title: 'Μόνο όσα βγαίνουν από κανόνες ή από σίγουρη πηγή (ίδιο EAN / κωδικός)', onclick: () => { level = level === 'high' ? '' : 'high'; page = 1; load(); } }, 'Μόνο σίγουρα'));
        clear(act);
        if (status === 'pending' && v.counts.high) act.appendChild(h('div', { class: 'fx-sure' }, icon('check'), h('div', null, h('b', null, `${fmt.plural(v.counts.high, 'σίγουρη διόρθωση', 'σίγουρες διορθώσεις')}${group ? ' (' + v.groups[group] + ')' : ''}`), h('div', { class: 'hint', style: { margin: 0 } }, 'Από κανόνες (κενά, κεφαλαία, τόνοι, γράμματα, τιμές, διαφημίσεις) ή από σίγουρη πηγή (ίδιο EAN / κωδικός στον αντιπρόσωπο, το άλλο μας site).')),
          btn('Έγκριση όλων των σίγουρων', { cls: 'primary', icon: 'check' }, () => POST('/api/fixes/approve-sure', { site, group }).then((r) => { toast(`Εγκρίθηκαν ${fmt.num(r.count)}. Φτιάξε το αρχείο από πάνω δεξιά.`); App.refreshBadges(); load(); }).catch(fail))));
        if (!v.cards.length) {
          clear(list).appendChild(h('div', { class: 'panel empty' }, h('h3', null, status === 'pending' ? 'Τίποτα δεν περιμένει' : 'Κανένα εδώ'),
            h('p', null, status === 'pending' ? 'Δεν βρέθηκε κάτι να διορθωθεί με σιγουριά. Για περιγραφές/φωτογραφίες που λείπουν, πάτα «Βρες περιγραφές και φωτογραφίες» (χρειάζονται τιμοκατάλογοι αντιπροσώπων).' : ''),
            status === 'pending' ? btn('Βρες περιγραφές και φωτογραφίες', { cls: 'primary', icon: 'search' }, find) : null));
        }
        const have = new Map();
        for (const el of list.querySelectorAll('.fx-card[data-sig]')) if (!el.classList.contains('leaving')) have.set(el.dataset.sig, el);
        const nodes = [];
        for (const cd of v.cards) {
          const sig = status + '|' + cd.site + ':' + cd.pid + '|' + cd.changes.map((c) => c.id + ':' + c.hash + (c.edited ? 'e' : '')).join(',');
          let el = have.get(sig);
          if (!el) { el = card(cd, v); el.dataset.sig = sig; }
          nodes.push(el);
        }
        for (const el of [...list.children]) if (!nodes.includes(el)) el.remove();
        nodes.forEach((el, i) => { if (list.children[i] !== el) list.insertBefore(el, list.children[i] || null); });
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
          el.appendChild(h('div', { class: 'fx-change ' + c.level, 'data-id': c.id },
            h('div', { class: 'fx-ch-head' }, h('span', { class: 'pill' }, c.label), h('span', { class: 'pill ' + lv[1], title: c.level === 'high' ? 'Κανόνας ή σίγουρη πηγή' : 'Πιθανότατα σωστό — ρίξε μια ματιά' }, lv[0]),
              c.edited ? h('span', { class: 'pill' }, 'αλλαγμένο από εσένα') : null, c.by ? h('span', { class: 'faint', style: { fontSize: '12px' } }, c.by + ' · ' + fmt.ago(c.at)) : null,
              h('span', { class: 'grow' }),
              status === 'pending' && c.exportable !== false ? btn('Έγκριση', { cls: 'sm', icon: 'check' }, () => decide([c.id], 'approved')) : null,
              status === 'pending' ? btn('Όχι', { cls: 'sm ghost' }, () => decide([c.id], 'rejected')) : null,
              status !== 'exported' && ['name', 'desc', 'short'].includes(c.field) ? btn('Αλλαγή', { cls: 'sm ghost', icon: 'edit' }, () => edit(c)) : null),
            changeBody(c),
            h('p', { class: 'fx-why' }, h('b', null, 'Γιατί: '), c.why),
            h('div', { class: 'fx-src' }, h('b', null, 'Πηγή: '), c.source && c.source.url ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); App.openUrl(c.source.url); } }, c.source.label) : (c.source ? c.source.label : '—'),
              (c.sources || []).map((x) => h('span', { class: 'fx-also' }, '+ ', x.url ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); App.openUrl(x.url); } }, x.label) : x.label)),
              h('span', { class: 'fx-conf ' + (c.level === 'high' ? 'high' : 'medium'), title: SURE[c.level] || SURE.medium }, 'Σιγουριά: ' + (c.level === 'high' ? 'υψηλή' : 'μέτρια')),
              c.field === 'desc' && c.english && v.ai ? btn('Μετάφραση με AI', { cls: 'sm ghost' }, () => { toast('Μετάφραση… (μπορεί να πάρει λίγο)'); POST('/api/fixes/translate', { site: cd.site, id: cd.pid }).then(() => { toast('Μεταφράστηκε: διάβασέ τη πριν την έγκριση.'); load(); }).catch(fail); }) : null,
              c.group === 'content' && status === 'pending' ? h('button', { type: 'button', class: 'linkish', onclick: () => pageSource(cd) }, 'άλλη σελίδα ως πηγή…') : null)));
        }
        return el;
      };
      load();
    },
  };
})();
