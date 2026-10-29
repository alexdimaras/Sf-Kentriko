#!/usr/bin/env bash
# SF Κέντρο — εγκατάσταση ή ενημέρωση σε δωρεάν διακομιστή Linux (Oracle Cloud «Always Free», Ubuntu).
# Οδηγίες: DIAKOMISTIS-CLOUD.txt. Συνήθως το τρέχει μόνο του το SF-Kentro-Cloud.cmd από τα Windows.
#
#   sudo bash deploy/install-server.sh kentro.example.gr
#
# Η διεύθυνση είναι ένα subdomain σας (DNS A record → η IP του διακομιστή) ή ένα δωρεάν όνομα της duckdns.org.
# Ξανατρέχει χωρίς πρόβλημα: για νέα έκδοση ανεβαίνουν τα νέα αρχεία και τρέχει η ίδια εντολή· τα δεδομένα μένουν.
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Τρέξε το με sudo:  sudo bash $0 ${1:-kentro.example.gr}"
[ -f docker-compose.yml ] && [ -f ../app/server.js ] || die "Δεν βρέθηκαν τα αρχεία του προγράμματος (φάκελοι app και deploy δίπλα-δίπλα)."

# ---------- 1. the address ----------
HOST="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]' | sed 's#^https\?://##; s#/.*$##')"
if [ -z "$HOST" ] && [ -f .env ]; then HOST="$(sed -n 's/^KENTRO_HOST=//p' .env | head -n1)"; fi
IP="$(curl -fsS --max-time 10 https://api.ipify.org 2>/dev/null || curl -fsS --max-time 10 https://ifconfig.me 2>/dev/null || true)"
if [ -z "$HOST" ]; then
  die "Γράψε τη διεύθυνση που θα ανοίγουν όλοι, π.χ.:  sudo bash $0 kentro.ΤΟ-DOMAIN-ΣΑΣ.gr
  - Με δικό σας domain (δωρεάν): στον πάροχο του domain φτιάξε εγγραφή DNS τύπου A: kentro → ${IP:-η IP αυτού του διακομιστή}
  - Χωρίς domain: δωρεάν όνομα στο duckdns.org (π.χ. sf-kentro.duckdns.org) με IP ${IP:-αυτού του διακομιστή}"
fi
[[ "$HOST" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || die "Λάθος διεύθυνση: $HOST (π.χ. kentro.example.gr)"
case "$HOST" in *.sslip.io|*.nip.io) die "Το $HOST δεν παίρνει σταθερά πιστοποιητικό https. Χρησιμοποίησε subdomain σας ή duckdns.org.";; esac

say "SF Κέντρο → https://$HOST/"
DNS="$(getent ahostsv4 "$HOST" 2>/dev/null | awk 'NR==1 {print $1}' || true)"
if [ -n "$IP" ] && [ "$DNS" != "$IP" ]; then
  warn "Προσοχή: το $HOST δείχνει σε «${DNS:-πουθενά}», όχι σε αυτόν τον διακομιστή ($IP)."
  warn "Φτιάξε (ή διόρθωσε) την εγγραφή DNS A: $HOST → $IP. Το https μπαίνει μόνο του μόλις ισχύσει (λίγα λεπτά)."
fi

# ---------- 2. Docker (once) ----------
if ! docker compose version >/dev/null 2>&1; then
  command -v apt-get >/dev/null 2>&1 || die "Αυτό το σενάριο θέλει Ubuntu (στο Oracle: Image «Canonical Ubuntu»)."
  say "Εγκατάσταση Docker (μία φορά, 1-3 λεπτά)…"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  apt-get install -y -q docker.io docker-compose-v2 || curl -fsSL https://get.docker.com | sh
  docker compose version >/dev/null 2>&1 || die "Το Docker δεν εγκαταστάθηκε σωστά. Δοκίμασε:  curl -fsSL https://get.docker.com | sudo sh"
fi
systemctl enable --now docker >/dev/null 2>&1 || true

# ---------- 3. small machines: swap, so the build does not run out of memory ----------
MEM_KB="$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
if [ "${MEM_KB:-0}" -lt 2000000 ] && [ -z "$(swapon --show --noheadings 2>/dev/null)" ]; then
  say "Μικρή μνήμη: προσθήκη 2 GB swap…"
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ---------- 4. ports 80/443 inside the machine (Oracle's Ubuntu images block all but 22) ----------
# (outputs are read whole, never through "grep -q": with pipefail a closed pipe would count as "not found")
UFW="$(ufw status 2>/dev/null || true)"
case "$UFW" in *'Status: active'*) ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null;; esac
RULES="$(iptables -S INPUT 2>/dev/null || true)"
if [[ "$RULES" == *'-j REJECT'* ]]; then
  for p in 443 80; do
    iptables -C INPUT -p tcp -m state --state NEW --dport "$p" -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p tcp -m state --state NEW --dport "$p" -j ACCEPT
  done
  if command -v netfilter-persistent >/dev/null 2>&1; then netfilter-persistent save >/dev/null 2>&1 || true
  elif [ -d /etc/iptables ]; then iptables-save > /etc/iptables/rules.v4; fi
fi

# ---------- 5. settings file (.env, only root can read it) and start ----------
umask 077
if [ -f .env ]; then
  if grep -q '^KENTRO_HOST=' .env; then sed -i "s|^KENTRO_HOST=.*|KENTRO_HOST=$HOST|" .env; else echo "KENTRO_HOST=$HOST" >> .env; fi
else
  printf 'KENTRO_HOST=%s\nKENTRO_ADMIN_USER=\nKENTRO_ADMIN_PASSWORD=\n' "$HOST" > .env
fi
say "Ξεκινάει το πρόγραμμα (η πρώτη φορά θέλει 2-5 λεπτά)…"
docker compose up -d --build
docker image prune -f >/dev/null 2>&1 || true

LOGS=""
for _ in $(seq 1 60); do LOGS="$(docker compose logs kentro 2>/dev/null || true)"; [[ "$LOGS" == *'Running at'* ]] && break; sleep 2; done
CODE="$(printf '%s\n' "$LOGS" | sed -n 's/.*setup code: \([A-F0-9-]*\).*/\1/p' | tail -n1)"
HTTPS=no
for _ in $(seq 1 30); do curl -fsS --max-time 5 "https://$HOST/ping" >/dev/null 2>&1 && { HTTPS=yes; break; }; sleep 3; done

say "Έτοιμο."
echo "  Διεύθυνση για όλους (PC και κινητά):  https://$HOST/"
if [ -n "$CODE" ]; then echo "  Πρώτη φορά: άνοιξέ τη και γράψε τον κωδικό αρχικής ρύθμισης:  $CODE"; fi
echo "  Μετά: Ρυθμίσεις → Χρήστες (ένας λογαριασμός για κάθε άτομο) και Ρυθμίσεις → Κινητό (QR για τα κινητά)."
if [ "$HTTPS" != yes ]; then
  warn "  Η σελίδα δεν απαντά ακόμα με https. Έλεγξε:"
  warn "   - Oracle: Instance → Subnet → Security List → Ingress Rules: TCP 80 και 443 από 0.0.0.0/0"
  warn "   - DNS: $HOST → ${IP:-η IP του διακομιστή} (μπορεί να θέλει λίγα λεπτά)"
  warn "  Το πρόγραμμα ξαναδοκιμάζει μόνο του· δες την κατάσταση με:  sudo docker compose -f $(pwd)/docker-compose.yml logs caddy"
fi
