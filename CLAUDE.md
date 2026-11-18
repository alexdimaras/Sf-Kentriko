# SF Κέντρο — οδηγός για νέα συνεδρία (διάβασε ΜΟΝΟ αυτό πρώτα)

Back office (Node 22, vanilla JS, χωρίς framework) για δύο WooCommerce sites: **specialforces.gr (`sf`, κεντρικό)** και
**stratiotikaeidi.gr (`st`, διαφημίσεις)**. Έκδοση 1.6.0. Branch εργασίας: `claude/friendly-sagan-bfjrkj` — **κάθε push = deploy στο Render**.
Ο χρήστης μιλά ελληνικά, όχι προγραμματιστής: απαντήσεις στα ελληνικά, απλά, βήμα-βήμα όταν πρέπει να κάνει κάτι.

## Κανόνες που ΔΕΝ αλλάζουν
1. Το πρόγραμμα **δεν γράφει ποτέ στα sites**: φτιάχνει αρχεία CSV που ανεβάζει ο χρήστης (WooCommerce → Εισαγωγή, «Ενημέρωση υπαρχόντων»).
2. **Τίποτα δεν αλλάζει χωρίς έγκριση** (Διορθώσεις → Έγκριση). Κάθε πρόταση: Πριν/Μετά, Γιατί, Πηγή, Σιγουριά %.
3. Ασφάλεια: κωδικοί ποτέ σε log/chat/repo· οι κωδικοί διαχειριστή των sites δεν ζητούνται ποτέ· σύνδεση με κωδικό (30 μέρες «μείνε συνδεδεμένος»).
4. Δωρεάν: Render free (0,1 CPU / 512 MB), Supabase free (500 MB), χωρίς κάρτα, χωρίς πληρωμένο AI.
5. Τίτλοι: **μόνο κεφαλαία** (και κωδικοί/μονάδες: B12I, 4.5MM), **κανένας κωδικός (SKU) σε τίτλο/υπότιτλο**, μόνο ΕΙΔΟΣ ΜΑΡΚΑ ΜΟΝΤΕΛΟ [ΧΡΩΜΑ]. Μέγεθος → ιδιότητα/παραλλαγή.
6. Κωδικοί: **ένας κωδικός ανά προϊόν** για όλα τα χρώματα/μεγέθη (`variantSku: 'same'`)· **ποτέ επινοημένοι** — μόνο από πηγές (άλλο site, αντιπρόσωπος, ≥2 καταστήματα).
7. Ακρίβεια πάνω από ταχύτητα: «ίδιο προϊόν» μόνο με απόδειξη (κωδικός/EAN ή μάρκα+μοντέλο+χρώμα+ποσότητα). Σίγουρο = ≥2 ανεξάρτητες πηγές.
8. Πριν παραδώσεις: `cd app && npm test` πράσινο (και με `COORD_PG=...` για βάση) + έλεγχος οθόνης σε κινητό (Playwright, `/opt/pw-browsers`).

## Αρχιτεκτονική (σύντομα — λεπτομέρειες: docs/PROJECT.md §2β, §2γ)
- **Cloud (Render)**: `app/server.js` (API, χρήστες, ουρά). Δεδομένα: JSON αρχεία στο `SFK_DATA` (store.js) με **PostgreSQL/Supabase**
  ως πηγή αλήθειας (`lib/pgsave.js`, `SFK_DATABASE_URL`) και **GitHub** ως ημερήσιο αντίγραφο (`lib/cloudsave.js`, branches `backup-ΗΗΗΗ-ΜΜ-ΗΗ`).
- **Ουρά** `lib/coord.js` (+ `coord-store.js` αρχεία / `db.js` PG): leases 90″, heartbeat, idempotency, dedup, ανάθεση ανά δυνατότητες,
  cloud μόνο αν χωρά στη μνήμη (`cloudRamMB`). Τύποι: `lib/jobtypes.js` → `market.shop` (έρευνα ενός καταστήματος), `codes.web` (έρευνα internet), `ai.call` (Ollama του PC· γρήγορη λωρίδα).
- **Worker στο PC** `app/worker.js` (+ `SF-Kentro-Worker.cmd`): επόπτης + 1 εργάτης/πυρήνα, κοινός ρυθμός αναζητήσεων (IPC permits),
  αναφορά φόρτου `/api/worker/load` → Ρυθμίσεις → Υπολογιστές (ζωντανά). Τρέχει και από το zip του GitHub (`vendor/node-html-parser.js`).
- **Έρευνα τιμών** `lib/market.js` (αντιστοίχιση `compare/score`, `MATCH_VERSION`), `lib/research.js` (κατανεμημένη), `lib/compcat.js` + `lib/sitemapcat.js` (κατάλογοι ανταγωνιστών).
- **Έρευνα internet** `lib/codefind.js`: 6–8 ερωτήματα (`queriesOf`) σε DDG+Bing+Yahoo → έως 3 σελίδες/κατάστημα (`extract.fromUrl`) → μόνο ίδιο (EAN/κωδικός/`exact`, ίδιο χρώμα & έκδοση) → SKU/EAN/φωτο/μάρκα/τιμή+διαθεσιμότητα (`market.mergeWeb`). Κατάσταση + καταγραφή ανά προϊόν (`web-trace`), επανάληψη ανά πεδίο (`openNeeds`/`dueAt`).
- **Οικογένειες / παραλλαγές**: `market.compare` → exact | family | similar | none· `lib/families.js` (ξεχωριστά προϊόντα ενός μοντέλου → αρχεία μεταβλητού)· `lib/seoaudit.js` (σελίδα όπως τη βλέπει το Google).
- **Local AI** `lib/localai.js` + `lib/airesearch.js` (JSON Schema, κρίση αμφίβολων σελίδων): `resolveUrl`, `pickModel`, `test()` (πραγματικό generate), `guardFacts`· στο cloud μέσω `ai.call` στον υπολογιστή με το μοντέλο.
- **Διορθώσεις** `lib/fixes.js` (προτάσεις, `confidenceOf`, εξαγωγή CSV)· **Ροή εργασίας** `lib/flow.js` (βήματα 1 Κωδικός → 2 Στοιχεία → 3 Περιεχόμενο → 4 Τιμή).
- **Έλεγχοι τίτλων/ειδών** `lib/checks.js`, `lib/kinds.js`· χαρακτήρες `lib/util.js` (`repairEntities`, `capsTitle`).
- UI: `app/public/js/*.js` (`core.js` κοινά, `v-*.js` οθόνες), `app/public/app.css`.
- Ασφάλεια δικτύου: `http.assertPublic` (κανένα ιδιωτικό IP, σε κάθε redirect). Τεστ με τοπικούς mock servers: `SFK_ALLOW_PRIVATE=1`.

## Τεστ
`cd app && npm test` → run (89) · rules (90) · jobs (36) · integrity (19) · coord (32) · workers (26) · ai (34) · research (66) · variants (45, πραγματικά δεδομένα στο `test/fixtures`) · db (8, με `COORD_PG`).
Μετρήσεις: `node test/bench/research-bench.js` (παλιά vs νέα, συνθετικό) · `node test/bench/live-research.js` (ζωντανά σε πραγματικά καταστήματα).
Τοπική PG: `service postgresql start`, `COORD_PG=postgres://sfk:sfk-test-pass@127.0.0.1:5432/sfk`. CI: `.github/workflows/test.yml`.
Αληθινά δεδομένα για μετρήσεις (αν υπάρχουν στο scratchpad): κατάλογοι ~9.900 sf + 7.400 st προϊόντα.

## Δουλειά που εκκρεμεί
Δες **docs/BACKLOG.md** (λίστα του χρήστη με προτεραιότητα, διάγνωση και κατάσταση). Ενημέρωνέ το όταν κλείνει κάτι.
