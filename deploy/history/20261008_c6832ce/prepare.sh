#!/bin/sh
set -eu
umask 077
upload=/tmp/herstory-popup-city-release-20261008-c6832ce
release=/opt/herstory-popup-city/releases/20261008-c6832ce
previous=/opt/herstory-popup-city/releases/20261008-43a0440
node=/opt/herstory-popup-city/runtime/bin/node
cd "$upload"
sha256sum -c herstory-popup-city-20261008-cloud.tar.gz.sha256
[ "$(readlink -f /opt/herstory-popup-city/current)" = "$previous" ]
[ ! -e "$release" ]
sudo install -d -m 0755 "$release"
sudo tar --no-same-owner -xzf herstory-popup-city-20261008-cloud.tar.gz -C "$release"
cd "$release"
sudo sha256sum -c "$upload/release_files.sha256" > "$upload/source-check.log"
for old in "$previous"/migrations/*.sql; do sudo cmp "$old" "$release/migrations/$(basename "$old")"; done
sudo cmp "$previous/package-lock.json" "$release/package-lock.json"
sudo cmp "$previous/package.json" "$release/package.json"
# Dependency lock is identical; copy the Linux modules into this new release only.
sudo cp -a "$previous/node_modules" "$release/node_modules"
sudo env -i PATH=/opt/herstory-popup-city/runtime/bin:/usr/bin:/bin HOME=/tmp "$node" --test test/*.test.js > "$upload/linux-tests.log" 2>&1
sudo env -i PATH=/opt/herstory-popup-city/runtime/bin:/usr/bin:/bin HOME=/tmp "$node" scripts/check-release.mjs > "$upload/check-release.log" 2>&1
tail -n 12 "$upload/linux-tests.log"
cat "$upload/check-release.log"
printf 'Prepared new release successfully\n'
