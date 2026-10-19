#!/bin/bash
# Bundle current working tree, including reviewed uncommitted integration changes.
set -euo pipefail
repo=$(cd -- "$(dirname -- "$0")/.." && pwd)
out=${1:?Usage: package-deployment-kit.sh /absolute/path/new-kit.tar.gz}
[[ $out == /* && ! -e $out && ! -e $out.sha256 ]] || { echo '需提供尚不存在的绝对输出路径。' >&2; exit 1; }
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
bash "$repo/scripts/package-release.sh" "$stage/source.tar.gz" >/dev/null
# Reject accidentally introduced local credentials/data even inside allowed trees.
python3 - "$stage/source.tar.gz" <<'PY_CHECK'
import sys, tarfile
from pathlib import PurePosixPath
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    for entry in archive.getmembers():
        path = PurePosixPath(entry.name)
        parts = path.parts
        name = path.name.lower()
        unsafe = (path.is_absolute() or '..' in parts or entry.issym() or entry.islnk()
                  or any(p in ('node_modules', '.git', '.ssh', '__pycache__') for p in parts)
                  or name in ('.env', 'server.env', 'id_rsa', 'id_ed25519')
                  or name.endswith(('.sqlite', '.sqlite-wal', '.sqlite-shm', '.db', '.pem', '.key', '.p12')))
        if unsafe:
            raise SystemExit('拒绝打包本机数据/私密文件/链接：' + entry.name)
PY_CHECK
cp "$repo/deploy/upgrade-current.sh" "$stage/deploy.sh"
cat > "$stage/README.zh-CN.txt" <<'TEXT'
适用于现有 herstory.net.cn 服务器的人工升级，不是首次安装脚本。
保留 server.env、个人数据库、既有 Node 运行时、Caddy/Workshop 配置。
先在服务器用 sha256sum -c 外部 .sha256 校验上传包，再解压到新的临时目录。
cd 解压目录后：bash deploy.sh --verify-only
随后：sudo bash deploy.sh
脚本依次校验、独立版本 npm ci、测试与发布自检、在线备份、停机备份、增量迁移、原子切换 current、健康检查。
迁移/启动失败不自动回滚数据库；停机阶段失败保持停止，管理员审阅日志和兼容性后决定恢复。
备份位于 /var/lib/herstory-popup-city/backup-*.sqlite，不会覆盖已有备份。
部署不代表邮件投递或硬件实机验收已完成。请从另一台电脑验收网站与实机。
TEXT
(cd "$stage" && shasum -a 256 source.tar.gz deploy.sh README.zh-CN.txt > SHA256SUMS)
COPYFILE_DISABLE=1 tar --no-xattrs --no-acls -czf "$out" -C "$stage" source.tar.gz deploy.sh README.zh-CN.txt SHA256SUMS
(cd "$(dirname "$out")" && shasum -a 256 "$(basename "$out")" > "$(basename "$out").sha256")
printf '%s\n' "$out"
