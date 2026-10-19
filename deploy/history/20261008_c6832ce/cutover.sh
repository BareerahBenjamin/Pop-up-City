#!/bin/sh
set -eu
umask 077
upload=/tmp/herstory-popup-city-release-20261008-c6832ce
release=/opt/herstory-popup-city/releases/20261008-c6832ce
previous=/opt/herstory-popup-city/releases/20261008-43a0440
node=/opt/herstory-popup-city/runtime/bin/node
database=/var/lib/herstory-popup-city/popup-city.sqlite
backup=backup-before-planet-preview-20261008-c6832ce.sqlite
next=/opt/herstory-popup-city/current.next-c6832ce
[ "$(readlink -f /opt/herstory-popup-city/current)" = "$previous" ]
[ ! -e "$next" ]
[ ! -e "/var/lib/herstory-popup-city/$backup" ]
[ -s "$upload/check-release.log" ]
[ -s "$upload/linux-tests.log" ]
sudo sha256sum /var/lib/lmoment/state.json /var/lib/herstory-workshop/game.sqlite3 /var/lib/herstory-workshop/game.sqlite3-wal /var/lib/herstory-workshop/game.sqlite3-shm /etc/caddy/Caddyfile /etc/caddy/herstory-popup-city.caddy /etc/herstory-popup-city/server.env /etc/systemd/system/herstory-popup-city.service /usr/bin/node > "$upload/protected-before.sha256"
sudo systemctl show caddy herstory-workshop -p Id -p MainPID -p ActiveState > "$upload/other-services-before.txt"
pgrep -f '^node /opt/lmoment/server/index.js$' > "$upload/lmoment-pid-before.txt"
stopped=0
switched=0
rollback(){
 code=$?
 trap - EXIT HUP INT TERM
 if [ "$code" -ne 0 ] && [ "$stopped" -eq 1 ]; then
  if [ "$switched" -eq 1 ]; then
   sudo ln -s "$previous" /opt/herstory-popup-city/current.rollback-c6832ce
   sudo mv -T /opt/herstory-popup-city/current.rollback-c6832ce /opt/herstory-popup-city/current
  fi
  sudo systemctl start herstory-popup-city || true
  printf 'Deployment failed: previous code restored, database retained; no backup overwrite or database restoration performed.\n' >&2
 fi
 exit "$code"
}
trap rollback EXIT
trap 'exit 1' HUP INT TERM
stopped=1
sudo systemctl stop herstory-popup-city
sudo "$node" "$upload/audit.mjs" before "$database" "$upload/db-before.json"
cd "$previous"
sudo -u herstory-popup-city "$node" --env-file=/etc/herstory-popup-city/server.env backup.js "$backup"
sudo "$node" "$upload/audit.mjs" same "/var/lib/herstory-popup-city/$backup" "$upload/db-backup.json" "$upload/db-before.json"
cd "$release"
# No new migrations: validate the existing database against the new source only.
sudo -u herstory-popup-city "$node" --env-file=/etc/herstory-popup-city/server.env --input-type=module -e "import {openDatabase,checkSchema} from './database.js';import {loadConfig} from './config.js';const db=openDatabase(loadConfig().databasePath);try{checkSchema(db)}finally{db.close()}"
sudo "$node" "$upload/audit.mjs" same "$database" "$upload/db-after-codecheck.json" "$upload/db-before.json"
sudo ln -s "$release" "$next"
sudo mv -T "$next" /opt/herstory-popup-city/current
switched=1
sudo systemctl start herstory-popup-city
attempt=0
until curl -fsS http://127.0.0.1:3300/healthz > "$upload/healthz.json"; do
 attempt=$((attempt+1));[ "$attempt" -lt 10 ];sleep 1
done
sudo sha256sum -c "$upload/protected-before.sha256" > "$upload/protected-after.log"
sudo systemctl show caddy herstory-workshop -p Id -p MainPID -p ActiveState > "$upload/other-services-after.txt"
cmp "$upload/other-services-before.txt" "$upload/other-services-after.txt"
pgrep -f '^node /opt/lmoment/server/index.js$' > "$upload/lmoment-pid-after.txt"
cmp "$upload/lmoment-pid-before.txt" "$upload/lmoment-pid-after.txt"
sudo "$node" "$upload/audit.mjs" same "$database" "$upload/db-after-start.json" "$upload/db-after-codecheck.json"
cat "$upload/healthz.json"
cat "$upload/protected-after.log"
printf '\nCutover complete. Backup: /var/lib/herstory-popup-city/%s\n' "$backup"
