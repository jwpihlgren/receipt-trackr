#!/bin/sh
set -e

# Docker skapar en bind-montering som saknas på värden med root som ägare. En
# container som kör som vanlig användare kan då inte skriva i sitt eget arkiv, och
# felet ser ut som en rättighetsbugg trots att ingen gjort något fel.
#
# Lösningen hör hemma här, inte i en instruktion på värden: startar vi som root
# rättar vi ägarskapet på monteringen och släpper sedan rättigheterna. PUID och
# PGID kommer från compose och avgör vem som äger filerna sett från värden — sätt
# dem till din egen användare så går arkivet att läsa och kopiera utan sudo.
if [ "$(id -u)" = "0" ]; then
  PUID="${PUID:-1000}"
  PGID="${PGID:-1000}"

  mkdir -p "$DATA_DIR"
  # Bara monteringens topp, inte hela arkivet: en rekursiv chown över tiotusen
  # kvitton vid varje start vore både långsam och onödig.
  chown "$PUID:$PGID" "$DATA_DIR"

  if ! command -v setpriv >/dev/null 2>&1; then
    echo "entrypoint: setpriv saknas i imagen — kan inte släppa root." >&2
    exit 1
  fi
  exec setpriv --reuid "$PUID" --regid "$PGID" --clear-groups "$@"
fi

# Redan icke-root (t.ex. `docker run -u`): då är ägarskapet någon annans beslut.
exec "$@"
