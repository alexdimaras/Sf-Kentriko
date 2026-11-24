# Ποια απαίτηση αποδεικνύει ποιο τεστ (TEST-MATRIX)

| Απαίτηση | Τεστ (αρχείο · τι ελέγχει) |
|---|---|
| Ίδιο EAN πριν από «άλλη μάρκα»· μάρκα με άλλη γραφή | `app/test/rules.js` · «the same EAN with the brand written another way…» |
| Άλλη παραλλαγή (χρώμα) δεν μετρά στην τιμή | `app/test/variants.js` · «the price of another colour does not count…» |
| Χειροκίνητη τιμή λήγει σε 14 μέρες / «χωρίς λήξη» | `app/test/variants.js` · «a hand-written price counts until its end…» |
| Μία πηγή ποτέ αλλαγή τιμής (`minShops` ≥ 2) | `app/test/variants.js` · «one shop alone never moves a price» |
| Πληρότητα καταλόγων χωριστά από τη σύγκριση | `app/test/variants.js` · «the coverage of the catalogs is told apart…» |
| Κανένας κατασκευασμένος κωδικός (επίθεμα, σκουπιδο-κωδικός, μάρκα) | `app/test/rules.js` · variant-code block, `junkSku`, `unifyCodes` |
| Κωδικός παραλλαγής μόνο από ≥2 ανεξάρτητα καταστήματα | `app/test/rules.js` · «the XL gets the code two shops show for the XL», «two pages of ONE site are one source» |
| Κωδικός μέσα σε τίτλο → πρόταση αφαίρεσης (όχι όνομα μοντέλου) | `app/test/rules.js` · `codesInTitle` |
| Οικογένεια μόνο με ≥2 καταστήματα, αλλιώς «πιθανή» | `app/test/variants.js` · «one shop only… → πιθανή οικογένεια» |
| Φωτογραφία μόνο της ίδιας παραλλαγής | `app/test/variants.js` · «photos only of OUR variant» |
| «Περιορισμένη κάλυψη» ≠ «δεν βρέθηκε» | `app/test/research.js` · «one engine ok with 0 results + the others failed…» |
| Πλάνο αναζητήσεων χωρίς σκουπιδο-κωδικούς | `app/test/research.js` · «a code with a copy's date stamp is never searched» |
| Παλιός worker δεν παίρνει έρευνα | `app/test/research.js` · «a stale worker… is not given internet research» |
| Νέος υπολογιστής σταματημένος, το cloud συνεχίζει | `app/test/coord.js` · «a new computer starts STOPPED», `someoneFor` |
| Αρχείο εγκατάστασης ασφαλές | `app/test/coord.js` · installer: τιμές, μόνο GitHub |
| Αυτο-ενημέρωση: SHA-256, όνομα, `node --check`, ποτέ προς τα πίσω | `app/test/coord.js` · selfupdate block |
| Προφίλ απόδοσης και αυτόματο κατέβασμα | `app/test/coord.js` · perf block |
| Ollama: ξεχωριστές καταστάσεις, μετρήσεις | `app/test/ai.js` |
| Έλεγχος υγείας: 4 επίπεδα, βάση με εγγραφή/ανάγνωση | `app/test/integrity.js` (μονάδες) · `app/test/db.js` (PostgreSQL) · `app/test/workers.js` (server) |
| Αρχείο συμβάντων: κανένα μυστικό, ×N αντί για πλημμύρα· πακέτο διάγνωσης χωρίς μυστικά | `app/test/integrity.js` (events / diagnostics) · `app/test/workers.js` (bundle, `/api/worker/event` μόνο με token) |
| Αυτοεπισκευές: μόνο επιτρεπτές, έλεγχος μετά, ανάπαυση, καμία αλλαγή δεδομένων | `app/test/integrity.js` (repair) · `app/test/workers.js` (`/api/system/repair`) |
| Η προετοιμασία δεν καθυστερεί από αιτήματα που περιμένουν | `app/test/integrity.js` · «a request that only waits does not hold the background work back» |
| Αναφορά ποιότητας: 3 καταστάσεις, χωρίς αναζήτηση στο άνοιγμα | `app/test/variants.js` · quality block |
| Worker που σβήνει στη μέση: τίποτα δεν χάνεται | `app/test/research.js`, `app/test/workers.js` |
| Είδος προϊόντος με τις λέξεις του καταστήματος (ΔΙΑΚΡΙΤΙΚΟ ≠ ΣΗΜΑ, κανένα είδος από 1 προϊόν, αποχή, XQ35/223REM μένουν) — regression | `app/test/knowledge.js` · μέτρηση: `node test/bench/naming-bench.js <products.json> …` |
| Ουρά: προσπάθεια (fencing), επιστροφή εργασίας, «ζωντανός αλλά αργός», γρήγορη λωρίδα codes.one | `app/test/coord.js`, `app/test/workers.js` (πραγματικός worker) |
| «Μόνο με ανοιχτό πρόγραμμα»: η εργασία δεν κόβεται στη μέση | `app/test/workers.js` |
| Έρευνες: δικές μου / αυτόματες, λεπτομέρειες της δικής μου μένουν | `app/test/research.js`, `app/test/workers.js` |
| Τιμοκατάλογος: εκδόσεις, διαφορές, τίποτα δεν διαγράφεται επειδή λείπει | `app/test/run.js` |
| Παραλλαγές ανταγωνιστών (Shopify / WooCommerce): τιμή/απόθεμα του δικού μας χρώματος | `app/test/variants.js` |
| Ιστορικό τιμών: μόνο αλλαγές, 30 ημέρες, πιθανή τεχνητή έκπτωση | `app/test/variants.js` |
| Κωδικοί: αντιγραμμένος κωδικός άλλου προϊόντος, «μέγεθος-αριθμός», κείμενο στη θέση κωδικού | `app/test/rules.js` |
| «Δεν μπήκε στο site» (αρχείο που δεν εισήχθη) · προέλευση προτάσεων | `app/test/run.js` |
| Χρώμα τίτλου vs χρώμα προϊόντος (μάρκες TASMANIAN TIGER / RED DOT / RAL δεν μετράνε) | `app/test/knowledge.js` |
| Ροή: «Μετά» + προέλευση δίπλα στο πρόβλημα | `app/test/run.js` |
| Προτεινόμενα καταστήματα στους ανταγωνιστές με ένα κλικ (κανένα δύο φορές) | `app/test/rules.js` |
| Σελίδα sitemap ProductGroup: χρώματα με δική τους τιμή/απόθεμα, κωδικός = κοινό μέρος, μεγέθη = ένα προϊόν | `app/test/integrity.js` |
| Περιγραφή AI για υπάρχον προϊόν: μόνο στοιχεία του, επινοημένοι αριθμοί αφαιρούνται, πρόταση «Συμπέρασμα», φεύγει όταν το site την έχει | `app/test/ai.js` |

Δεν καλύπτεται από τεστ (θέλει πραγματικό περιβάλλον): πραγματικές μηχανές αναζήτησης, Ollama στο PC, εισαγωγή CSV
στο WooCommerce, restore από αντίγραφο GitHub.
