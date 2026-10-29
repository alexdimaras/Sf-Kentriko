'use strict';
// "What to do today": a short, ordered task list built from everything the app knows.
const settings = require('./settings');
const catalog = require('./catalog');
const checks = require('./checks');
const suppliers = require('./suppliers');
const drafts = require('./drafts');
const market = require('./market');
const pricelist = require('./pricelist');
const store = require('./store');

const pl = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function hoursSince(iso) { return iso ? (Date.now() - new Date(iso).getTime()) / 36e5 : Infinity; }

function build() {
  const s = settings.all();
  const sum = catalog.summary();
  const tasks = [];
  const synced = sum.sf.syncedAt || sum.st.syncedAt;
  if (!synced) {
    tasks.push({ level: 'start', title: 'Διάβασε τα προϊόντα από τα δύο sites', text: 'Το πρόγραμμα παίρνει όλα τα δημόσια στοιχεία (τίτλους, τιμές, φωτογραφίες, κατηγορίες). Δεν αλλάζει τίποτα στα sites.', action: { kind: 'sync', label: 'Ανάγνωση τώρα' } });
  } else {
    for (const site of ['sf', 'st']) {
      const h = hoursSince(sum[site].syncedAt);
      if (h === Infinity) tasks.push({ level: 'high', title: `Δεν έχουν διαβαστεί τα προϊόντα του ${sum[site].name}`, text: 'Χωρίς αυτά δεν γίνονται οι έλεγχοι ανάμεσα στα δύο sites.', action: { kind: 'sync', label: 'Ανάγνωση' } });
      else if (s.autoSyncHours && h > s.autoSyncHours * 2) tasks.push({ level: 'low', title: `Τα στοιχεία του ${sum[site].name} είναι ${Math.round(h / 24) || 1} ημερών`, text: 'Ανανέωσε για να δεις τις τελευταίες αλλαγές.', action: { kind: 'sync', label: 'Ανανέωση' } });
    }
  }

  let ck = { checks: [], counts: {} };
  if (synced) {
    ck = checks.cached();
    for (const c of ck.checks.filter((x) => ['critical', 'high'].includes(x.severity)).slice(0, 6)) {
      tasks.push({ level: c.severity, title: `${c.title} — ${c.items.length}`, text: c.help, site: c.site, action: { kind: 'check', id: c.id, label: c.fix ? c.fix.label : 'Δες τη λίστα' } });
    }
  }

  const ds = drafts.list();
  const waiting = ds.filter((d) => d.status === 'draft').length;
  const approved = ds.filter((d) => d.status === 'approved' && (!d.exported.sf || (d.sites.st && d.regulated !== 'critical' && !d.exported.st))).length;
  if (waiting) tasks.push({ level: 'medium', title: `${pl(waiting, 'νέο προϊόν περιμένει', 'νέα προϊόντα περιμένουν')} έλεγχο`, text: 'Έλεγξε τίτλο, τιμή, κατηγορία και φωτογραφίες, μετά έγκριση και εξαγωγή.', action: { kind: 'view', view: 'new', label: 'Έλεγχος' } });
  if (approved) tasks.push({ level: 'medium', title: `${pl(approved, 'εγκεκριμένο προϊόν δεν έχει περαστεί', 'εγκεκριμένα προϊόντα δεν έχουν περαστεί')} ακόμα`, text: 'Φτιάξε το αρχείο εισαγωγής και ανέβασέ το στο WooCommerce.', action: { kind: 'view', view: 'new', label: 'Εξαγωγή' } });

  // Orders to suppliers
  const today = new Date().toISOString().slice(0, 10);
  const ords = suppliers.orders();
  const late = ords.filter((o) => o.status === 'sent' && o.expectedAt && o.expectedAt < today);
  const due = ords.filter((o) => o.status === 'sent' && o.expectedAt === today);
  const supName = (id) => (suppliers.get(id) || {}).name || '—';
  for (const o of late) tasks.push({ level: 'high', title: `Καθυστέρηση: παραγγελία ${supName(o.supplierId)}`, text: `Αναμενόταν ${new Date(o.expectedAt).toLocaleDateString('el-GR')} · ${pl(o.items.length, 'είδος', 'είδη')}${o.customer ? ' · για πελάτη: ' + o.customer : ''}`, action: { kind: 'view', view: 'suppliers', tab: 'orders', label: 'Παραγγελίες' } });
  for (const o of due) tasks.push({ level: 'medium', title: `Σήμερα έρχεται η παραγγελία ${supName(o.supplierId)}`, text: `${pl(o.items.length, 'είδος', 'είδη')}${o.customer ? ' · για πελάτη: ' + o.customer : ''}`, action: { kind: 'view', view: 'suppliers', tab: 'orders', label: 'Παραγγελίες' } });
  const drafted = ords.filter((o) => o.status === 'draft' && o.items.length);
  if (drafted.length) tasks.push({ level: 'low', title: `${pl(drafted.length, 'παραγγελία προς αντιπρόσωπο δεν έχει σταλεί', 'παραγγελίες προς αντιπροσώπους δεν έχουν σταλεί')}`, text: drafted.map((o) => supName(o.supplierId)).join(', '), action: { kind: 'view', view: 'suppliers', tab: 'orders', label: 'Αποστολή' } });

  const sups = suppliers.list();
  if (!sups.length) tasks.push({ level: 'start', title: 'Πέρασε τους αντιπροσώπους σας', text: 'Όνομα, τηλέφωνο, email, μάρκες, χρόνος παράδοσης. Έτσι κάθε προϊόν ξέρει από πού έρχεται.', action: { kind: 'view', view: 'suppliers', label: 'Προσθήκη' } });
  else {
    const noBrands = sups.filter((x) => x.active !== false && !(x.brands || []).length);
    if (noBrands.length) tasks.push({ level: 'low', title: 'Αντιπρόσωποι χωρίς μάρκες', text: noBrands.map((x) => x.name).join(', ') + ' — χωρίς μάρκες δεν συνδέονται με προϊόντα.', action: { kind: 'view', view: 'suppliers', label: 'Συμπλήρωση' } });
    const updates = store.read('supplier-updates', []);
    for (const sp of sups) {
      const inf = pricelist.info(sp.id);
      const auto = sp.autoRefresh !== false && (sp.catalogMode === 'public' || sp.catalogMode === 'b2b' || (sp.feedUrl && inf && inf.items));
      if (sp.feedUrl && !auto && (!inf || hoursSince(inf.importedAt) > 24 * 7)) tasks.push({ level: 'low', title: `Ανανέωσε τον τιμοκατάλογο ${sp.name}`, text: 'Το αρχείο του αντιπροσώπου έχει σύνδεσμο — ένα κλικ φέρνει τις νέες τιμές και τα νέα προϊόντα.', action: { kind: 'view', view: 'suppliers', id: sp.id, tab: 'pricelist', label: 'Ανανέωση' } });
      const u = updates.find((x) => x.supplierId === sp.id);
      if (u && u.changed && hoursSince(u.at) < 36) tasks.push({ level: 'medium', title: `${sp.name}: ${pl(u.changed, 'αλλαγή τιμής', 'αλλαγές τιμής')} στον τιμοκατάλογο`, text: 'Δες ποια προϊόντα σας επηρεάζονται και φτιάξε αρχείο νέων τιμών με ένα κλικ.', action: { kind: 'view', view: 'suppliers', id: sp.id, tab: 'pricelist', label: 'Δες τις αλλαγές' } });
    }
  }

  // suppliers found automatically, waiting for approval
  const sc = store.read('supplier-candidates', null);
  if (sc) {
    const found = Object.values(sc.brands || {}).filter((b) => b.status === 'found');
    if (found.length) tasks.push({ level: 'low', title: `${pl(found.length, 'μάρκα έχει', 'μάρκες έχουν')} πρόταση αντιπροσώπου για έγκριση`, text: found.slice(0, 6).map((b) => b.brand).join(', ') + (found.length > 6 ? ' …' : '') + ' — βρέθηκαν αυτόματα στο internet· τίποτα δεν καταχωρείται χωρίς την έγκρισή σου.', action: { kind: 'view', view: 'suppliers', tab: 'find', label: 'Προτάσεις' } });
  }
  // security: a PIN protects the program and seals the B2B passwords
  if (!require('./security').hasPin()) tasks.push({ level: sups.some((x) => x.b2bPass) ? 'high' : 'low', title: 'Βάλε PIN στο πρόγραμμα', text: sups.some((x) => x.b2bPass) ? 'Υπάρχουν αποθηκευμένοι κωδικοί B2B. Με PIN κλειδώνονται επιπλέον και το πρόγραμμα κλειδώνει μόνο του μετά από 30 λεπτά χωρίς χρήση.' : 'Το πρόγραμμα κλειδώνει μόνο του μετά από 30 λεπτά χωρίς χρήση και ζητάει PIN στο άνοιγμα.', action: { kind: 'view', view: 'settings', tab: 'security', label: 'Ορισμός PIN' } });

  const meta = store.read('market-meta', {});
  if (synced && !meta.lastRun) tasks.push({ level: 'start', title: 'Πρώτη έρευνα τιμών αγοράς', text: 'Κατεβαίνουν οι κατάλογοι των ανταγωνιστών και συγκρίνονται όλα τα προϊόντα σας. Μετά γίνεται μόνο του κάθε μέρα.', action: { kind: 'view', view: 'market', label: 'Έρευνα' } });
  const mk = { counts: market.quickCounts('sf') };
  if (mk.counts.similar) tasks.push({ level: 'low', title: `${pl(mk.counts.similar, 'προϊόν θέλει', 'προϊόντα θέλουν')} επιβεβαίωση «ίδιο ή όχι;»`, text: 'Βρέθηκαν παρόμοια στους ανταγωνιστές (άλλη έκδοση ή χρώμα;). Ένα κλικ το καθένα — το πρόγραμμα θυμάται την απάντηση.', action: { kind: 'view', view: 'market', tab: 'confirm', label: 'Επιβεβαίωση' } });
  const changes = store.read('market-changes', []).filter((c) => c.at === meta.lastRun);
  const cheaper = changes.filter((c) => c.to < c.from && c.to < c.ours);
  if (cheaper.length) tasks.push({ level: 'medium', title: `${pl(cheaper.length, 'τιμή ανταγωνιστή έπεσε', 'τιμές ανταγωνιστών έπεσαν')} κάτω από τις δικές σας`, text: cheaper.slice(0, 3).map((c) => `${c.shop}: ${c.name}`).join(' · ') + (cheaper.length > 3 ? ' …' : ''), action: { kind: 'view', view: 'market', tab: 'changes', label: 'Αλλαγές' } });
  if (mk.counts.expensive) tasks.push({ level: 'medium', title: `${pl(mk.counts.expensive, 'προϊόν είναι ακριβότερο', 'προϊόντα είναι ακριβότερα')} από την αγορά`, text: 'Με βάση τον τελευταίο έλεγχο ανταγωνισμού.', action: { kind: 'view', view: 'market', label: 'Τιμές' } });
  if (mk.counts.cheap) tasks.push({ level: 'medium', title: `${pl(mk.counts.cheap, 'προϊόν πουλιέται πολύ φθηνότερα', 'προϊόντα πουλιούνται πολύ φθηνότερα')} από την αγορά`, text: 'Χάνεις κέρδος χωρίς λόγο — δες την προτεινόμενη τιμή.', action: { kind: 'view', view: 'market', label: 'Τιμές' } });

  const order = { start: 0, critical: 1, high: 2, medium: 3, low: 4 };
  tasks.sort((a, b) => order[a.level] - order[b.level]);

  const L = synced ? catalog.links() : { sfToSt: new Map() };
  const history = store.read('history', []).slice(0, 6);
  return {
    sites: sum,
    kpi: {
      sf: sum.sf.products, st: sum.st.products, both: L.sfToSt.size,
      critical: ck.counts.critical || 0, high: ck.counts.high || 0,
      drafts: waiting, suppliers: sups.length, orders: ords.filter((o) => o.status === 'sent').length,
    },
    tasks, history,
  };
}

module.exports = { build };
