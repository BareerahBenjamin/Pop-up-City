#!/bin/sh
# Package only deployable source; secrets, databases and platform-specific modules stay local.
set -eu
package_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
package_output=${1:-/tmp/herstory-popup-city-$(date +%Y%m%d-%H%M%S).tar.gz}
case "$package_output" in /*) ;; *) echo 'Output must be an absolute path' >&2; exit 1;; esac
if [ -e "$package_output" ]; then echo 'Output exists; choose a new release filename' >&2; exit 1; fi
COPYFILE_DISABLE=1 tar --exclude='.DS_Store' --exclude='._*' -czf "$package_output" -C "$package_root" \
  package.json package-lock.json server.js api.js config.js database.js covers.js roles.js \
  mail.js manage.js backup.js public migrations deploy scripts test \
  README.md deployment_v1.0.md database_schema_v1.0.md growth_architecture_v1.0.md \
  growth_data_dictionary_v1.0.md decision_log_v1.0.md visual_refresh_v1.0.md .env.example .gitignore
printf '%s\n' "$package_output"
