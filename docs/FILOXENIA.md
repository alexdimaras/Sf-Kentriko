# Πού τρέχει το πρόγραμμα — αξιολόγηση (Νοέμβριος 2026)

Ερώτηση: υπάρχει άλλος **δωρεάν** τρόπος, **χωρίς κάρτα** και **χωρίς δικό μας υπολογιστή ανοιχτό**, που να μην
έχει τα προβλήματα του Render;

Σύντομη απάντηση: **όχι κάτι δυνατότερο με αυτούς τους όρους.** Το πρόβλημα όμως δεν ήταν το Render· ήταν ότι το
πρόγραμμα ζητούσε περισσότερα από όσα δίνει ένα μικρό μηχάνημα. Αυτό διορθώθηκε (βλ. μετρήσεις στο τέλος), άρα
μένουμε στο Render. Αν κάποτε χρειαστεί περισσότερη δύναμη, υπάρχει δωρεάν δρόμος χωρίς κάρτα: ο «νυχτερινός
εργάτης» στο GitHub (πρόταση 2, δεν έχει εφαρμοστεί).

## Τι δίνει το δωρεάν Render

512 MB μνήμη, 0,1 επεξεργαστή, δίσκος που σβήνει σε κάθε επανεκκίνηση, ύπνος μετά από 15 λεπτά χωρίς επισκέψεις,
χωρίς κάρτα. Πηγή: [Render — Deploy for Free](https://render.com/docs/free).

## Οι εναλλακτικές που εξετάστηκαν

| Υπηρεσία | Δωρεάν πλάνο | Κάρτα | Κρίση |
|---|---|---|---|
| **Render** (τώρα) | 512 MB, 0,1 CPU, ύπνος 15′ | όχι | Μένουμε. Το πρόγραμμα πλέον χωράει. |
| Koyeb | 512 MB, 0,1 vCPU, «scale to zero» | συχνά ζητείται | Ίδια δύναμη με το Render· κανένα κέρδος. |
| Northflank | μικρό δωρεάν έργο | ναι | Εκτός όρων (κάρτα). |
| Zeabur | πίστωση ~5 $ | όχι στην αρχή | Η πίστωση τελειώνει· όχι μόνιμο. |
| Hugging Face Spaces (Docker) | 2 vCPU, 16 GB | — | Το Docker SDK εμφανίζεται πλέον ως επί πληρωμή για νέα Spaces. Όχι σίγουρο, όχι για ιδιωτικά δεδομένα. |
| Cloudflare Workers | 10 ms CPU ανά αίτημα | όχι | Δεν τρέχει πρόγραμμα Node με αρχεία· θα ήθελε ξαναγράψιμο από την αρχή. |
| Deno Deploy / Leapcell | serverless, μικρά όρια | όχι | Ίδιο πρόβλημα: όχι μόνιμη διεργασία με 100+ MB δεδομένων στη μνήμη. |
| Oracle Cloud «Always Free» | έως 4 πυρήνες ARM, 24 GB | **ναι** (επαλήθευση) | Το δυνατότερο δωρεάν που υπάρχει, αλλά ζητά κάρτα. Αν κάποτε το δεχτείς, υπάρχει ήδη το `deploy/install-server.sh`. |
| GitHub Actions | 2.000 λεπτά/μήνα (ιδιωτικό αποθετήριο), δυνατά μηχανήματα | όχι | Όχι για να «σερβίρει» την εφαρμογή, αλλά ιδανικό για τις βαριές δουλειές (πρόταση 2). |

Πηγές: [Free Cloud Hosting 2026: 14 Platforms Compared](https://snapdeploy.dev/blog/free-cloud-deployment-platforms-2026-comparison),
[Best Free Docker Hosting 2026](https://xcloud.host/best-free-docker-hosting/),
[9 Best Free Docker Hosting Platforms 2026](https://flywp.com/blog/9769/best-free-docker-hosting-platforms/),
[Awesome Web Hosting 2026](https://github.com/iSoumyaDey/Awesome-Web-Hosting-2026),
[Koyeb scale to zero](https://www.koyeb.com/docs/run-and-scale/scale-to-zero),
[Zeabur free plan](https://zeabur.com/docs/pricing/free-plan),
[Hugging Face Spaces overview](https://huggingface.co/docs/hub/en/spaces-overview),
[HF forum: Docker SDK marked as paid](https://discuss.huggingface.co/t/docker-sdk-now-marked-as-paid-when-creating-a-new-space/177580/5),
[GitHub Actions pricing](https://cicdcost.com/github-actions-pricing),
[GitHub Actions free tier](https://cicdcalculator.com/github-actions-free-tier),
[Cloudflare Workers pricing 2026](https://www.activepieces.com/blog/cloudflare-workers-pricing-2026-free-vs-paid-plans),
[Deno Deploy usage](https://docs.deno.com/deploy/usage/),
[Leapcell free tier](https://agentdeals.dev/vendor/leapcell).

Τα όρια αυτά αλλάζουν συχνά· ισχύουν όπως τα βρήκα τον Νοέμβριο 2026.

## Πρόταση 1 (έγινε): το πρόγραμμα να χωράει στο μικρό μηχάνημα

Μετρημένα σε «κουτί» με τα ίδια όρια (0,1 CPU, 512 MB), με τα αληθινά δεδομένα — βλ. `app/test/perf/README.md`.

## Πρόταση 2 (για έγκριση, ΔΕΝ έχει εφαρμοστεί): «νυχτερινός εργάτης» στο GitHub

Οι δύο βαριές δουλειές — πλήρης ανάγνωση των sites και έρευνα τιμών σε 24 ανταγωνιστές — δεν χρειάζεται να
γίνονται στο μικρό μηχάνημα. Το GitHub δίνει δωρεάν δυνατά μηχανήματα για προγραμματισμένες εργασίες:

1. Κάθε νύχτα ξεκινά μόνη της μια εργασία στο GitHub (2 πυρήνες, 7+ GB): διαβάζει τα sites, κάνει την έρευνα,
   χτίζει τους ελέγχους και γράφει τα αποτελέσματα στο ιδιωτικό αποθετήριο δεδομένων — εκεί που ήδη φυλάγονται.
2. Το πρόγραμμα στο Render απλώς τα φορτώνει το πρωί. Δεν κάνει ποτέ βαριά δουλειά, άρα δεν αργεί ποτέ.

Κόστος: ~15–25 λεπτά τη μέρα = 450–750 από τα 2.000 δωρεάν λεπτά τον μήνα. Χωρίς κάρτα.
Τι χρειάζεται από εσένα: ένα «ναι», και να βάλεις μία φορά το ίδιο κλειδί GitHub ως «secret» στο αποθετήριο
του κώδικα (5 λεπτά, με οδηγίες βήμα-βήμα). Κίνδυνος: αν το GitHub αλλάξει τα δωρεάν λεπτά, το πρόγραμμα συνεχίζει
όπως σήμερα (κάνει τις δουλειές μόνο του, πιο αργά).

Δεν το εφάρμοσα γιατί αλλάζει το πού τρέχουν οι δουλειές και θέλει δική σου ρύθμιση· πρώτα η απόφασή σου.
