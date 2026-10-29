#!/bin/bash
# SF Κέντρο — εγκατάσταση ΜΟΝΟ ΑΠΟ ΤΟ ΚΙΝΗΤΟ, χωρίς υπολογιστή και χωρίς SSH.
# Επικολλάται στο Oracle Cloud, στη δημιουργία του μηχανήματος (Advanced options → Management → Cloud-init script).
# Στήνει μόνο του το πρόγραμμα με https και φτιάχνει τον πρώτο διαχειριστή. Οδηγίες: DIAKOMISTIS-CLOUD.txt
#
# ΑΛΛΑΞΕ ΜΟΝΟ ΤΙΣ ΤΡΕΙΣ ΓΡΑΜΜΕΣ ΠΑΡΑΚΑΤΩ (μέσα στα εισαγωγικά, χωρίς κενά):
HOST="onoma.duckdns.org"          # η διεύθυνση που θα ανοίγεις (π.χ. sf-kentro-alex.duckdns.org)
ADMIN_USER="alex"                 # όνομα χρήστη του διαχειριστή (λατινικά)
ADMIN_PASSWORD="ΒΑΛΕ-ΕΔΩ-ΚΩΔΙΚΟ-10+-ΧΑΡΑΚΤΗΡΩΝ"   # άλλαξέ τον μετά το πρώτο άνοιγμα (Ρυθμίσεις → Χρήστες)

exec > /var/log/sf-kentro-setup.log 2>&1
set -x
export DEBIAN_FRONTEND=noninteractive
for i in 1 2 3 4 5 6; do apt-get update -q && apt-get install -y -q git curl && break; sleep 20; done
rm -rf /opt/sf-kentro
for i in 1 2 3 4 5 6; do git clone --depth 1 -b claude/friendly-sagan-bfjrkj https://github.com/alexdimaras/Sf-Kentriko.git /opt/sf-kentro && break; sleep 20; done
cd /opt/sf-kentro/deploy
umask 077
printf 'KENTRO_HOST=%s\nKENTRO_ADMIN_USER=%s\nKENTRO_ADMIN_PASSWORD=%s\n' "$HOST" "$ADMIN_USER" "$ADMIN_PASSWORD" > .env
bash install-server.sh "$HOST"
