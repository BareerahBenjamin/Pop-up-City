#!/bin/bash
# Existing-site upgrade only. Run manually as root from an extracted deployment kit.
set -euo pipefail
umask 077
kit=$(cd -- "$(dirname -- "$0")" && pwd)
if [[ ${1:-} == --verify-only ]]; then
  if command -v sha256sum >/dev/null; then
    (cd "$kit" && sha256sum -c SHA256SUMS)
  else
    (cd "$kit" && shasum -a 256 -c SHA256SUMS)
  fi
  tar -tzf "$kit/source.tar.gz" >/dev/null
  echo '部署包摘要与压缩包读取通过；未修改服务器。'
  exit 0
fi
[[ $# == 0 ]] || { echo 'Usage: sudo bash deploy.sh [--verify-only]' >&2; exit 1; }
[[ $(uname -s) == Linux && $EUID == 0 ]] || { echo '仅限现有 Linux 网站服务器，由管理员 sudo 执行。' >&2; exit 1; }
for tool in sha256sum tar flock runuser systemctl curl readlink; do command -v "$tool" >/dev/null; done
exec 9>/run/lock/herstory-popup-city-upgrade.lock
flock -n 9 || { echo '已有部署运行中。' >&2; exit 1; }
(cd "$kit" && sha256sum -c SHA256SUMS)
base=/opt/herstory-popup-city
node=$base/runtime/bin/node
npm=$base/runtime/lib/node_modules/npm/bin/npm-cli.js
if [[ ! -f $npm ]]; then
  npm_launcher=$(command -v npm || true)
  [[ -n $npm_launcher ]] || { echo '找不到 npm，请提供现有 npm 安装位置。' >&2; exit 1; }
  npm=$(readlink -f "$npm_launcher")
fi
[[ -f $npm ]] || { echo "npm 入口不存在：$npm" >&2; exit 1; }
envfile=/etc/herstory-popup-city/server.env
service=herstory-popup-city.service
owner=herstory-popup-city
previous=$(readlink -f "$base/current")
[[ -L $base/current && $previous == "$base/releases/"* && -d $previous && -x $node && -f $npm && -r $envfile ]]
[[ $(systemctl show "$service" -p User --value) == "$owner" ]]
[[ $(systemctl show "$service" -p WorkingDirectory --value) == "$base/current" ]]
systemctl is-active --quiet "$service"
"$node" --env-file="$envfile" --input-type=module -e '
 if(process.env.HOST!=="127.0.0.1" || process.env.PORT!=="3300" || process.env.DATABASE_PATH!=="/var/lib/herstory-popup-city/popup-city.sqlite") throw Error("现有配置路径/端口与固定部署规则不符，停止部署");
 if(process.env.PUBLIC_ORIGIN!=="https://herstory.net.cn") throw Error("正式域名与预期不符");'
release_id="$(date -u +%Y%m%dT%H%M%SZ)-$(sha256sum "$kit/source.tar.gz" | cut -c1-12)"
release=$base/releases/$release_id
[[ ! -e $release && ! -L $base/current.next ]]
mkdir -m 0755 "$release"
tar --no-same-owner -xzf "$kit/source.tar.gz" -C "$release"
chmod -R u=rwX,go=rX "$release"
cd "$release"
export PATH="$base/runtime/bin:/usr/sbin:/usr/bin:/sbin:/bin"
"$node" "$npm" ci --omit=dev --include=optional --ignore-scripts
# Root installs with restrictive umask; service user must read dependencies.
chmod -R u=rwX,go=rX "$release"
"$node" "$npm" test
"$node" scripts/check-release.mjs
# New backup tool uses SQLite online backup and exclusive destinations.
runuser -u "$owner" -- "$node" --env-file="$envfile" backup.js "backup-online-$release_id.sqlite"
stopped=0
on_failure() {
  code=$?
  if [[ $code != 0 && $stopped == 1 ]]; then
    echo "升级未完成，服务保持停止。旧版本：$previous；新版本：$release。" >&2
    echo '请审阅迁移与服务日志再决定恢复；脚本不会自动恢复旧数据库或启动不兼容旧代码。' >&2
  fi
  exit "$code"
}
trap on_failure EXIT
systemctl stop "$service"
stopped=1
# Close writes after the online backup before applying additive migrations.
runuser -u "$owner" -- "$node" --env-file="$envfile" backup.js "backup-cutover-$release_id.sqlite"
runuser -u "$owner" -- "$node" --env-file="$envfile" manage.js migrate
ln -s "$release" "$base/current.next"
mv -T "$base/current.next" "$base/current"
systemctl start "$service"
healthy=0
for attempt in {1..15}; do
  if curl -fsS --max-time 4 http://127.0.0.1:3300/healthz 2>/dev/null | "$node" --input-type=module -e 'let s="";for await(const b of process.stdin)s+=b;try{if(JSON.parse(s).status!=="ok")process.exit(1)}catch{process.exit(1)}'; then healthy=1; break; fi
  sleep 1
done
if [[ $healthy != 1 ]]; then systemctl stop "$service"; echo '本机健康检查失败。' >&2; exit 1; fi
stopped=0
if ! curl -fsS --max-time 15 https://herstory.net.cn/healthz | "$node" --input-type=module -e 'let s="";for await(const b of process.stdin)s+=b;try{if(JSON.parse(s).status!=="ok")process.exit(1)}catch{process.exit(1)}'; then
  echo "本机已健康启动，但域名检查未通过；服务保留运行。检查代理/域名，再从另一台电脑验收。新版本：$release" >&2
  exit 1
fi
printf '部署完成：%s\n上一版本：%s\n请在另一台电脑验收登录、报名、绑定和硬件联动。\n' "$release" "$previous"
