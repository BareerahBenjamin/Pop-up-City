#!/bin/sh
# Read-only Linux checks. Does not install software or alter existing services.
set -eu
if [ "$(uname -s)" != Linux ]; then echo 'Run this check on the Linux cloud server.' >&2; exit 1; fi
printf '%s\n' '--- OS / architecture ---'
uname -m
if [ -r /etc/os-release ]; then sed -n '/^PRETTY_NAME=/p' /etc/os-release; fi
printf '%s\n' '--- Memory and persistent disk ---'
free -m
df -h / /var/lib
printf '%s\n' '--- Required tools ---'
for preflight_tool in curl tar xz sha256sum systemctl ss; do
  if command -v "$preflight_tool" >/dev/null 2>&1; then printf 'OK: %s\n' "$preflight_tool"; else printf 'Missing: %s\n' "$preflight_tool" >&2; exit 1; fi
done
printf '%s\n' '--- Port 3300 ---'
if ss -H -ltn 'sport = :3300' | sed -n '1p' | awk 'END{exit NR==0?1:0}'; then
  echo 'Port 3300 is in use. Inspect ownership; do not stop an unrelated service.'
else echo 'Port 3300 is available.'; fi
printf '%s\n' '--- Existing app paths ---'
for preflight_path in /opt/herstory-popup-city /var/lib/herstory-popup-city /etc/herstory-popup-city /etc/systemd/system/herstory-popup-city.service; do
  if [ -e "$preflight_path" ]; then printf 'EXISTS (use upgrade flow): %s\n' "$preflight_path"; else printf 'NEW: %s\n' "$preflight_path"; fi
done
printf '%s\n' '--- Caddy ---'
if command -v caddy >/dev/null 2>&1; then caddy version; else echo 'Caddy is not installed. Follow official installation guide before HTTPS setup.'; fi
printf '%s\n' 'Finished: no files or services changed.'
