#!/bin/bash
# v2: self-tests + installation only. Does NOT deploy, migrate or restart production.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo '请使用 sudo bash 执行'; exit 1; }
exec 9>/run/lock/herstory-tools-install.lock
flock -n 9 || { echo '另一个安装正在执行'; exit 1; }
for file in /usr/bin/python3 /usr/bin/systemd-run /usr/bin/systemctl /usr/sbin/visudo /usr/sbin/runuser /usr/bin/curl /usr/sbin/useradd /usr/sbin/userdel /opt/herstory-popup-city/runtime/bin/node /usr/lib/node_modules/npm/bin/npm-cli.js; do
  test -f "$file" || { echo "缺少工具：$file"; exit 1; }
done
/usr/bin/python3 -c 'import sys; assert sys.version_info >= (3, 9), "需要 Python >= 3.9"'
id herstory-ops >/dev/null
id herstory-popup-city >/dev/null
for file in /usr/local/libexec/herstory-release.py /usr/local/sbin/herstory-deploy /usr/local/sbin/herstory-rollback /etc/sudoers.d/herstory-ops-deploy; do
  if [ -e "$file" ] || [ -L "$file" ]; then echo "已有同名工具，停止以免覆盖：$file"; exit 1; fi
done
if id herstory-build >/dev/null 2>&1; then echo 'herstory-build 账号已存在，停止避免修改已有账号'; exit 1; fi
for dir in /var/lib/herstory-build /var/lib/herstory-deploy; do
  if [ -e "$dir" ] || [ -L "$dir" ]; then echo "目录已存在，停止：$dir"; exit 1; fi
done
upload=/home/herstory-ops/releases-upload
test -d "$upload"
test ! -L "$upload"
test "$(stat -c %U "$upload")" = herstory-ops
before=$(/usr/bin/systemctl show --no-pager herstory-popup-city.service -p ActiveState -p MainPID)
/usr/bin/systemctl is-active --quiet herstory-popup-city.service
stage=$(mktemp -d /tmp/herstory-tools-install.XXXXXX)
created=0
installed=0
unit=herstory-install-check-$$
cleanup() {
  code=$?
  trap - EXIT
  /usr/bin/systemctl stop "$unit" >/dev/null 2>&1 || true
  if [ "$installed" = 0 ] && [ "$created" = 1 ]; then
    rm -f /etc/sudoers.d/herstory-ops-deploy
    rm -f /usr/local/sbin/herstory-deploy /usr/local/sbin/herstory-rollback /usr/local/libexec/herstory-release.py
    rm -rf /var/lib/herstory-build /var/lib/herstory-deploy
    /usr/sbin/userdel herstory-build || true
    echo '安装未完成，已撤销本次创建的工具和授权；请保留报错输出。'
  fi
  rm -rf "$stage"
  exit "$code"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
cat > "$stage/herstory-release.py" <<'HERSTORY_TOOL_V2'
#!/usr/bin/python3
"""Manual releases with explicitly reviewed additive migrations 0012 and 0013."""
import fcntl
import hashlib
import json
import os
import pwd
import re
import shutil
import signal
import sqlite3
from contextlib import closing
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
from pathlib import Path

BASE = Path('/opt/herstory-popup-city')
RELEASES = BASE / 'releases'
CURRENT = BASE / 'current'
STATE = Path('/var/lib/herstory-deploy')
UPLOAD = Path('/home/herstory-ops/releases-upload')
DB = Path('/var/lib/herstory-popup-city/popup-city.sqlite')
NODE = str(BASE / 'runtime/bin/node')
NPM = '/usr/lib/node_modules/npm/bin/npm-cli.js'
SERVICE = 'herstory-popup-city.service'
APPROVED_SQL = {'0012_cloud_hardware.sql': "-- Ephemeral state contains confirmation proofs, never raw device tokens.\nCREATE TABLE hardware_cloud_sessions (\n  id TEXT PRIMARY KEY,\n  state_json TEXT NOT NULL CHECK(json_valid(state_json)),\n  updated_at INTEGER NOT NULL\n);\nCREATE TABLE hardware_cloud_settings (\n  device_id TEXT PRIMARY KEY REFERENCES devices(id),\n  station_device_id TEXT REFERENCES devices(id)\n);\n-- Explicit authorization for a user's board to act as its owner's event station.\nCREATE TABLE hardware_host_grants (\n  device_id TEXT NOT NULL REFERENCES devices(id),\n  activity_id TEXT NOT NULL REFERENCES events(id),\n  authorized_by TEXT NOT NULL REFERENCES members(id),\n  PRIMARY KEY(device_id, activity_id)\n);\nCREATE TABLE hardware_host_receipts (\n  interaction_id TEXT PRIMARY KEY,\n  host_device_id TEXT NOT NULL REFERENCES devices(id),\n  user_device_id TEXT NOT NULL REFERENCES devices(id),\n  activity_id TEXT NOT NULL REFERENCES events(id),\n  payload_hash TEXT NOT NULL,\n  receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json)),\n  created_at INTEGER NOT NULL\n);\n", '0013_device_claims.sql': "CREATE TABLE device_inventory (\n  id TEXT PRIMARY KEY,\n  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64),\n  claim_code TEXT UNIQUE CHECK(claim_code IS NULL OR length(claim_code)=4),\n  expires_at INTEGER NOT NULL DEFAULT 0,\n  request_id TEXT UNIQUE,\n  requested_member_id TEXT REFERENCES members(id),\n  requested_by TEXT REFERENCES members(id),\n  bound_at INTEGER,\n  created_at INTEGER NOT NULL,\n  last_seen_at INTEGER NOT NULL\n);\nCREATE TABLE device_claim_attempts (\n  admin_id TEXT NOT NULL REFERENCES members(id),\n  attempted_at INTEGER NOT NULL\n);\nCREATE INDEX device_claim_attempts_admin ON device_claim_attempts(admin_id,attempted_at);\nCREATE TABLE device_claim_audit (\n  id TEXT PRIMARY KEY,\n  device_id TEXT NOT NULL REFERENCES device_inventory(id),\n  member_id TEXT REFERENCES members(id),\n  admin_id TEXT REFERENCES members(id),\n  action TEXT NOT NULL CHECK(action IN ('requested','rejected','bound','cancelled')),\n  created_at INTEGER NOT NULL\n);\n"}
APPROVED_HASHES = {name: hashlib.sha256(sql.encode()).hexdigest() for name, sql in APPROVED_SQL.items()}
TOOL = Path(__file__).resolve()



def run(args, **kw):
    print('+', ' '.join(map(str, args)), flush=True)
    return subprocess.run(list(map(str, args)), check=True, **kw)


def digest(path):
    with open(path, 'rb') as f:
        h = hashlib.sha256()
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
        return h.hexdigest()


def migrations(path):
    files = sorted((path / 'migrations').glob('*.sql'))
    if not files:
        raise RuntimeError('缺少迁移文件')
    return {f.name: digest(f) for f in files}


def plan(previous, target):
    old, new = migrations(previous), migrations(target)
    if any(new.get(name) != value for name, value in old.items()):
        raise RuntimeError('旧迁移被删除或修改，拒绝发布')
    added = {name: value for name, value in new.items() if name not in old}
    if any(APPROVED_HASHES.get(name) != value for name, value in added.items()):
        raise RuntimeError('有未审阅的新迁移，拒绝发布')
    return new


def sqlite_check(path, expected, allow_pending=False):
    with closing(sqlite3.connect(Path(path).as_uri() + '?mode=rw', uri=True, timeout=20)) as db, db:
        db.execute('PRAGMA query_only=ON')
        if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
            raise RuntimeError('数据库完整性检查失败')
        if db.execute('PRAGMA foreign_key_check').fetchone():
            raise RuntimeError('数据库外键检查失败')
        applied = dict(db.execute('SELECT name,checksum FROM schema_migrations'))
    for name, value in applied.items():
        if expected.get(name) != value and APPROVED_HASHES.get(name) != value:
            raise RuntimeError('数据库存在未知或不匹配迁移: ' + name)
    pending = {}
    for name, value in expected.items():
        if applied.get(name) == value:
            continue
        if name in applied or not allow_pending or APPROVED_HASHES.get(name) != value:
            raise RuntimeError('迁移与代码不一致: ' + name)
        pending[name] = value
    return pending


def sqlite_migrate(path, expected):
    pending = sqlite_check(path, expected, allow_pending=True)
    with closing(sqlite3.connect(path, timeout=30)) as db, db:
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('BEGIN IMMEDIATE')
        try:
            for name in sorted(pending):
                # All currently approved migrations consist solely of CREATE TABLE/INDEX.
                # Execute the root-installed reviewed SQL, never uploaded SQL as root.
                for statement in APPROVED_SQL[name].split(';'):
                    if statement.strip():
                        db.execute(statement)
                db.execute('INSERT INTO schema_migrations(name,checksum) VALUES(?,?)',
                           (name, pending[name]))
            if db.execute('PRAGMA foreign_key_check').fetchone():
                raise RuntimeError('迁移后外键校验失败')
            db.commit()
        except BaseException:
            db.rollback()
            raise
    sqlite_check(path, expected)
    return pending


def sqlite_backup(source, target):
    fd = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    try:
        with closing(sqlite3.connect(Path(source).as_uri() + '?mode=rw', uri=True, timeout=30)) as src, src:
            with closing(sqlite3.connect(target)) as dest, dest:
                src.execute('PRAGMA query_only=ON')
                src.backup(dest)
                if dest.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
                    raise RuntimeError('备份完整性检查失败')
    except BaseException:
        Path(target).unlink(missing_ok=True)
        raise


def db_command(operation, expected=None):
    args = ['/usr/sbin/runuser', '-u', 'herstory-popup-city', '--',
            '/usr/bin/env', '-i', 'PATH=/usr/bin:/bin',
            '/usr/bin/python3', '-I', str(TOOL), 'dbop', operation, str(DB)]
    result = subprocess.run(args, input=json.dumps(expected or {}), text=True,
                            capture_output=True)
    if result.returncode:
        print(result.stderr, file=sys.stderr, flush=True)
        raise RuntimeError('数据库操作失败: ' + operation)
    return json.loads(result.stdout)


def db_check(expected, allow_pending=False):
    return db_command('pending' if allow_pending else 'check', expected)


def backup():
    config = Path('/etc/herstory-popup-city/server.env').read_text()
    if len(re.findall(r'^\s*(?:export\s+)?DATABASE_PATH\s*=', config, re.M)) != 1:
        raise RuntimeError('DATABASE_PATH 配置不唯一或格式异常')
    if not re.search(r'^DATABASE_PATH=[\"\']?' + re.escape(str(DB)) + r'[\"\']?\s*$', config, re.M):
        raise RuntimeError('正式 DATABASE_PATH 与工具配置不同')
    target = db_command('backup')
    print('Backup:', target, flush=True)
    return target


def dbop():
    os.umask(0o077)
    operation, path = sys.argv[2:4]
    expected = json.load(sys.stdin)
    if operation == 'backup':
        target = Path(path).parent / ('backup-manual-' + time.strftime('%Y%m%d-%H%M%S') + '-' + os.urandom(4).hex() + '.sqlite')
        sqlite_backup(path, target)
        result = str(target)
    elif operation == 'migrate':
        result = sqlite_migrate(path, expected)
    elif operation in ('check', 'pending'):
        result = sqlite_check(path, expected, operation == 'pending')
    else:
        raise RuntimeError('未知数据库操作')
    print(json.dumps(result))


def current():
    path = CURRENT.resolve(strict=True)
    if path.parent != RELEASES or path.is_symlink():
        raise RuntimeError('current 指向非预期目录')
    if path.stat().st_uid != 0:
        raise RuntimeError('当前版本必须归 root 所有')
    return path


def switch(path):
    tmp = BASE / ('.current-' + os.urandom(8).hex())
    tmp.symlink_to(path)
    os.replace(tmp, CURRENT)


def health():
    for _ in range(20):
        try:
            subprocess.run(['/usr/bin/curl', '-fsS', '--max-time', '3',
                            'http://127.0.0.1:3300/healthz'], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            run(['/usr/bin/curl', '-fsS', '--max-time', '15',
                 'https://herstory.net.cn/healthz'])
            return
        except subprocess.CalledProcessError:
            time.sleep(1)
    raise RuntimeError('健康检查失败')


def cutover(target, previous):
    expected = migrations(target)
    db_check(expected, allow_pending=True)
    backup()
    stopped = False
    try:
        stopped = True
        run(['/usr/bin/systemctl', 'stop', SERVICE])
        backup()
        db_command('migrate', expected)
        db_check(expected)
        switch(target)
        run(['/usr/bin/systemctl', 'start', SERVICE])
        health()
    except BaseException:
        if stopped:
            # Only reviewed additive migrations may remain; never restore a database.
            db_check(migrations(previous))
            switch(previous)
            run(['/usr/bin/systemctl', 'restart', SERVICE])
        raise


def build_run(command, directory, network=True, writable=None):
    env = {'PATH': str(BASE / 'runtime/bin') + ':/usr/bin:/bin',
           'HOME': str(directory.parent / 'home'), 'CI': 'true',
           'npm_config_cache': str(directory.parent / 'cache')}
    unit = 'herstory-build-' + os.urandom(8).hex()
    args = ['/usr/bin/systemd-run', '--quiet', '--wait', '--pipe', '--collect',
         '--unit=' + unit, '--uid=herstory-build', '--working-directory=' + str(directory),
         '-p', 'NoNewPrivileges=yes', '-p', 'ProtectSystem=strict',
         '-p', 'ProtectHome=yes', '-p', 'PrivateTmp=yes',
         '-p', 'ProtectControlGroups=yes', '-p', 'ProtectKernelTunables=yes',
         '-p', 'RestrictSUIDSGID=yes', '-p', 'PrivateDevices=yes',
         '-p', 'CapabilityBoundingSet=', '-p', 'KillMode=control-group',
         '-p', 'RuntimeMaxSec=900', '-p', 'TasksMax=128', '-p', 'MemoryMax=384M',
         '-p', 'CPUQuota=50%', '-p', 'Nice=10',
         '-p', 'ReadWritePaths=' + str(directory.parent) + (' ' + str(writable) if writable else ''),
         *([] if network else ['-p', 'PrivateNetwork=yes']),
         '-p', 'InaccessiblePaths=/var/lib/herstory-popup-city /etc/herstory-popup-city /var/lib/herstory-deploy',
         '/usr/bin/env', '-i', *[k + '=' + v for k, v in env.items()], *command]
    try:
        run(args)
    except BaseException:
        subprocess.run(['/usr/bin/systemctl', 'stop', unit], check=False)
        raise


def extract(archive, target):
    total = 0
    seen = set()
    entries = 0
    with tarfile.open(archive, 'r:gz') as tf:
        for item in tf:
            entries += 1
            if entries > 50000 or item.size < 0:
                raise RuntimeError('归档文件数或大小异常')
            name = item.name
            parts = name.split('/')
            if (not name or name.startswith('/') or '..' in parts or
                    any(p in ('node_modules', '.git') or (p.startswith('.env') and p != '.env.example') for p in parts) or
                    not (item.isdir() or item.isfile())):
                raise RuntimeError('发布包包含不允许的路径或文件类型: ' + name)
            total += item.size
            if total > 1024 ** 3 or len(seen) > 50000:
                raise RuntimeError('发布包超过大小或文件数限制')
            out = target / name
            if item.isdir():
                out.mkdir(parents=True, exist_ok=True)
                continue
            if str(out) in seen:
                raise RuntimeError('重复文件路径')
            seen.add(str(out))
            out.parent.mkdir(parents=True, exist_ok=True)
            with tf.extractfile(item) as src, out.open('xb') as dest:
                shutil.copyfileobj(src, dest)
            out.chmod(0o644)


def inspect_tree(path):
    if path.is_symlink() or not path.is_dir():
        raise RuntimeError('源码目录被替换')
    for root, dirs, files in os.walk(path, followlinks=False):
        for name in dirs + files:
            item = Path(root) / name
            if item.is_symlink():
                if not item.resolve().is_relative_to(path):
                    raise RuntimeError('构建产物含越界链接')
            elif not (item.is_file() or item.is_dir()):
                raise RuntimeError('构建产物含特殊文件')


def freeze_tree(path):
    inspect_tree(path)
    # npm creates executable symlinks; permit only links confined to this tree.
    for root, dirs, files in os.walk(path, followlinks=False):
        for name in dirs + files:
            p = Path(root) / name
            if p.is_symlink():
                if not p.resolve().is_relative_to(path):
                    raise RuntimeError('构建产物含越界链接')
                os.lchown(p, 0, 0)
            elif not (p.is_file() or p.is_dir()):
                raise RuntimeError('构建产物含特殊文件')
            else:
                os.chown(p, 0, 0)
                p.chmod(0o755 if p.is_dir() or p.stat().st_mode & 0o111 else 0o644)
    os.chown(path, 0, 0)
    path.chmod(0o755)


def rehearsal(tree, previous, work, expected):
    saved = backup()
    compat = Path(tempfile.mkdtemp(prefix='compat-', dir='/var/lib/herstory-build'))
    try:
        clone = compat / 'compatibility.sqlite'
        shutil.copyfile(saved, clone)
        # Rehearse reviewed SQL while only root can access the new directory.
        sqlite_migrate(clone, expected)
        checker = compat / 'compatibility.mjs'
        checker.write_text("import {pathToFileURL} from 'node:url'; const m=await import(pathToFileURL(process.argv[2])); const db=m.openDatabase(process.argv[3]);try{m.checkSchema(db)}finally{db.close()}")
        user = pwd.getpwnam('herstory-build')
        for item in compat.iterdir():
            os.chown(item, user.pw_uid, user.pw_gid)
            item.chmod(0o600)
        os.chown(compat, user.pw_uid, user.pw_gid)
        for code in (previous, tree):
            build_run([NODE, str(checker), str(code / 'database.js'), str(clone)],
                      tree, network=False, writable=compat)
    finally:
        shutil.rmtree(compat)


def deploy(version, expected_sha):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}', version):
        raise RuntimeError('版本名格式错误')
    if not re.fullmatch(r'[a-f0-9]{64}', expected_sha):
        raise RuntimeError('需要发布包 SHA256')
    previous = current()
    target = RELEASES / version
    if target.exists() or target.is_symlink():
        raise RuntimeError('版本目录已经存在')
    work = Path(tempfile.mkdtemp(prefix='release-', dir='/var/lib/herstory-build'))
    try:
        archive = work / 'source.tar.gz'
        fd = os.open(UPLOAD / (version + '.tar.gz'), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as source, archive.open('xb') as dest:
            if os.fstat(source.fileno()).st_uid != pwd.getpwnam('herstory-ops').pw_uid:
                raise RuntimeError('发布包必须属于 herstory-ops')
            if os.fstat(source.fileno()).st_size > 512 * 1024 ** 2:
                raise RuntimeError('发布包超过 512 MiB')
            if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                raise RuntimeError('发布包必须是普通文件')
            remaining = 512 * 1024 ** 2
            while remaining:
                chunk = source.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                dest.write(chunk)
                remaining -= len(chunk)
            if source.read(1):
                raise RuntimeError('发布包超过大小限制')
        if archive.stat().st_size > 512 * 1024 ** 2 or digest(archive) != expected_sha:
            raise RuntimeError('发布包大小或摘要不符合要求')
        tree = work / 'source'
        tree.mkdir()
        extract(archive, tree)
        for required in ['package.json', 'package-lock.json', 'server.js', 'scripts/check-release.mjs']:
            if not (tree / required).is_file():
                raise RuntimeError('缺少文件: ' + required)
        expected = plan(previous, tree)
        db_check(migrations(previous))
        db_check(expected, allow_pending=True)
        for folder in [work / 'home', work / 'cache']:
            folder.mkdir()
        archive.unlink()
        user = pwd.getpwnam('herstory-build')
        for root, dirs, files in os.walk(work):
            os.chown(root, user.pw_uid, user.pw_gid)
            for name in files:
                os.chown(Path(root) / name, user.pw_uid, user.pw_gid)
        build_run([NODE, NPM, 'ci', '--include=optional', '--ignore-scripts', '--no-audit', '--no-fund'], tree)
        tests = sorted(str(p.relative_to(tree)) for p in (tree / 'test').glob('*.test.js'))
        if not tests:
            raise RuntimeError('缺少隔离测试')
        build_run([NODE, '--test', *tests], tree)
        build_run([NODE, 'scripts/check-release.mjs'], tree)
        # The transient cgroup is stopped before inspecting and freezing artifacts.
        freeze_tree(tree)
        os.chown(work, 0, 0)
        work.chmod(0o755)
        if plan(previous, tree) != expected:
            raise RuntimeError('构建后迁移文件发生变化')
        rehearsal(tree, previous, work, expected)
        shutil.move(str(tree), target)
        record = {'current': str(target), 'previous': str(previous), 'sha256': expected_sha,
                  'operator': os.environ.get('SUDO_USER', 'root'), 'time': time.time()}
        temp = STATE / ('pending-' + version + '.json')
        with temp.open('x') as out:
            json.dump(record, out, indent=2)
            out.flush()
            os.fsync(out.fileno())
        cutover(target, previous)
        os.replace(temp, STATE / 'last.json')
        print('部署成功:', target)
    finally:
        shutil.rmtree(work)


def rollback():
    record = json.loads((STATE / 'last.json').read_text())
    old = current()
    target = Path(record['previous']).resolve(strict=True)
    if str(old) != record['current'] or target.parent != RELEASES or target.stat().st_uid != 0:
        raise RuntimeError('当前版本与发布记录不符，拒绝回退')
    plan(target, old)
    db_check(migrations(target))
    cutover(target, old)
    (STATE / 'last.json').rename(STATE / ('rolled-back-' + str(time.time_ns()) + '.json'))
    print('代码回退成功，保留当前数据库:', target)


def main():
    if os.geteuid() != 0:
        raise RuntimeError('必须通过授权 sudo 命令执行')
    os.umask(0o077)
    STATE.mkdir(mode=0o700, exist_ok=True)
    with (STATE / 'operation.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        log_path = STATE / ('operation-' + str(time.time_ns()) + '.log')
        print('部署日志（管理员可读）:', log_path, flush=True)
        with log_path.open('a', buffering=1) as log:
            sys.stdout.flush()
            os.dup2(log.fileno(), 1)
            os.dup2(log.fileno(), 2)
            print('Operator:', os.environ.get('SUDO_USER', 'root'), 'Arguments:', sys.argv[1:], flush=True)
            if len(sys.argv) == 4 and sys.argv[1] == 'deploy':
                deploy(sys.argv[2], sys.argv[3])
            elif sys.argv[1:] == ['rollback']:
                rollback()
            else:
                raise RuntimeError('用法: deploy VERSION SHA256 或 rollback')


if __name__ == '__main__' and len(sys.argv) >= 2 and sys.argv[1] == 'dbop':
    dbop()
    sys.exit(0)

if __name__ == '__main__':
    def interrupted(signum, frame):
        raise RuntimeError('收到终止信号 ' + str(signum))
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGHUP, interrupted)
    original = os.dup(2)
    try:
        main()
    except BaseException as error:
        os.write(original, ('操作失败: ' + str(error) + '\n请负责人检查上述部署日志。\n').encode())
        raise
    else:
        os.write(original, '操作完成。\n'.encode())

HERSTORY_TOOL_V2
cat > "$stage/test_release_tool.py" <<'HERSTORY_TEST_V2'
#!/usr/bin/python3
"""Self-tests use disposable databases only; never call production service commands."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import sqlite3
from contextlib import closing
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('release_tool', ROOT / 'herstory-release.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
FIXTURE = json.loads((ROOT / 'selftest-fixtures.json').read_text())
NODE = os.environ.get('HERSTORY_TEST_NODE') or shutil.which('node')


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='herstory-selftest-')
        self.root = Path(self.tmp.name)
        self.old = self.root / 'old'
        self.new = self.root / 'new'
        for target in (self.old, self.new):
            (target / 'migrations').mkdir(parents=True)
            (target / 'package.json').write_text('{"type":"module"}')
            (target / 'database.js').write_text(FIXTURE.get('old-database.js', FIXTURE['database.js']) if target == self.old else FIXTURE['database.js'])
        for name, sql in FIXTURE['migrations'].items():
            (self.new / 'migrations' / name).write_text(sql)
            if int(name[:4]) <= 11:
                (self.old / 'migrations' / name).write_text(sql)
        self.db = self.root / 'test.sqlite'
        with closing(sqlite3.connect(self.db)) as db, db:
            db.executescript('PRAGMA application_id=1213219633; CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL);')
            for path in sorted((self.old / 'migrations').glob('*.sql')):
                db.executescript(path.read_text())
                db.execute('INSERT INTO schema_migrations VALUES(?,?)', (path.name, m.digest(path)))
                db.commit()
            db.execute("INSERT INTO members(id,email,nickname,created_at,updated_at) VALUES('keep','keep@example.test','keep member',1,1)")

    def tearDown(self):
        self.tmp.cleanup()

    def node_schema(self, code):
        self.assertIsNotNone(NODE, '需要 Node 验证 schema')
        script = "import {pathToFileURL} from 'node:url';const m=await import(pathToFileURL(process.argv[1]));const d=m.openDatabase(process.argv[2]);try{m.checkSchema(d)}finally{d.close()}"
        subprocess.run([NODE, '--input-type=module', '-e', script, str(code / 'database.js'), str(self.db)],
                       check=True, capture_output=True, timeout=20)

    def test_current_schema(self):
        m.sqlite_check(self.db, m.migrations(self.old))
        self.node_schema(self.old)

    def test_approved_upgrade_keeps_member(self):
        expected = m.plan(self.old, self.new)
        applied = m.sqlite_migrate(self.db, expected)
        self.assertEqual(len(applied), 2)
        with closing(sqlite3.connect(self.db)) as db, db:
            self.assertEqual(db.execute("SELECT nickname FROM members WHERE id='keep'").fetchone(), ('keep member',))
            self.assertEqual(db.execute('SELECT COUNT(*) FROM schema_migrations').fetchone()[0], 13)
            db.execute('SELECT * FROM hardware_cloud_sessions')
            db.execute('SELECT * FROM device_inventory')
        self.node_schema(self.new)

    def test_old_code_accepts_upgraded_database(self):
        m.sqlite_migrate(self.db, m.migrations(self.new))
        self.node_schema(self.old)
        m.sqlite_check(self.db, m.migrations(self.old))

    def test_repeat_upgrade_is_noop(self):
        expected = m.migrations(self.new)
        m.sqlite_migrate(self.db, expected)
        self.assertEqual(m.sqlite_migrate(self.db, expected), {})

    def test_unknown_migration_refused(self):
        (self.new / 'migrations' / '0014_unknown.sql').write_text('DROP TABLE members;')
        with self.assertRaises(RuntimeError): m.plan(self.old, self.new)

    def test_changed_old_migration_refused(self):
        name = next((self.old / 'migrations').iterdir()).name
        (self.new / 'migrations' / name).write_text('SELECT 1;')
        with self.assertRaises(RuntimeError): m.plan(self.old, self.new)

    def test_changed_approved_migration_refused(self):
        name = next(iter(m.APPROVED_SQL))
        (self.new / 'migrations' / name).write_text('DROP TABLE members;')
        with self.assertRaises(RuntimeError): m.plan(self.old, self.new)

    def test_pending_does_not_write(self):
        before = m.digest(self.db)
        self.assertEqual(len(m.sqlite_check(self.db, m.migrations(self.new), True)), 2)
        self.assertEqual(m.digest(self.db), before)

    def test_migration_transaction_rolls_back(self):
        # An intentionally conflicting future table makes migration fail halfway.
        with closing(sqlite3.connect(self.db)) as db, db:
            db.execute('CREATE TABLE device_inventory(conflict TEXT)')
        with self.assertRaises(sqlite3.Error):
            m.sqlite_migrate(self.db, m.migrations(self.new))
        with closing(sqlite3.connect(self.db)) as db, db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM schema_migrations').fetchone()[0], 11)
            self.assertIsNone(db.execute("SELECT name FROM sqlite_master WHERE name='hardware_cloud_sessions'").fetchone())

    def test_backup_preserves_content_and_no_overwrite(self):
        dest = self.root / 'backup.sqlite'
        m.sqlite_backup(self.db, dest)
        with closing(sqlite3.connect(dest)) as db, db:
            self.assertEqual(db.execute("SELECT id FROM members WHERE id='keep'").fetchone(), ('keep',))
        with self.assertRaises(FileExistsError): m.sqlite_backup(self.db, dest)

    def archive(self, names):
        path = self.root / 'test.tar.gz'
        with tarfile.open(path, 'w:gz') as archive:
            for name, kind in names:
                item = tarfile.TarInfo(name)
                item.type = kind
                if kind == tarfile.REGTYPE:
                    item.size = 2
                    archive.addfile(item, io.BytesIO(b'ok'))
                else:
                    item.linkname = '/etc/passwd'
                    archive.addfile(item)
        return path

    def test_archive_rejects_paths_and_links(self):
        for name, kind in [('../escape', tarfile.REGTYPE), ('/etc/passwd', tarfile.REGTYPE),
                           ('.env', tarfile.REGTYPE), ('node_modules/a', tarfile.REGTYPE),
                           ('link', tarfile.SYMTYPE), ('hard', tarfile.LNKTYPE), ('pipe', tarfile.FIFOTYPE)]:
            with self.subTest(name=name), self.assertRaises(RuntimeError):
                m.extract(self.archive([(name,kind)]), self.root / 'unpacked')

    def test_archive_duplicate_refused(self):
        with self.assertRaises(RuntimeError):
            m.extract(self.archive([('a',tarfile.REGTYPE),('a',tarfile.REGTYPE)]),self.root / 'unpacked')

    def test_safe_archive(self):
        dest = self.root / 'unpacked'
        m.extract(self.archive([('public/index.html',tarfile.REGTYPE)]),dest)
        self.assertEqual((dest / 'public/index.html').read_text(), 'ok')

    def test_build_tree_symlink_refused(self):
        bad = self.root / 'bad'
        bad.symlink_to(self.old)
        with self.assertRaises(RuntimeError): m.inspect_tree(bad)
        (self.new / 'escape').symlink_to('/etc/passwd')
        with self.assertRaises(RuntimeError): m.inspect_tree(self.new)

    def test_invalid_parameters_refused(self):
        for version in ['../x','/etc/x','a b','-x']:
            with self.subTest(version=version), self.assertRaises(RuntimeError): m.deploy(version, 'a'*64)
        with self.assertRaises(RuntimeError): m.deploy('valid', 'not-a-hash')

    def test_build_sandbox_and_offline_compatibility(self):
        with patch.object(m, 'run') as run:
            m.build_run(['node','check.js'],self.new, network=False)
            args = run.call_args[0][0]
            for item in ['--uid=herstory-build','ProtectSystem=strict','KillMode=control-group','PrivateNetwork=yes']:
                self.assertIn(item,args)

    def test_health_failure_restores_code_keeps_upgraded_data(self):
        def check(expected, allow_pending=False):
            return m.sqlite_check(self.db, expected, allow_pending)
        def db_command(op, expected):
            self.assertEqual(op,'migrate')
            return m.sqlite_migrate(self.db,expected)
        with patch.object(m,'db_check',side_effect=check), patch.object(m,'db_command',side_effect=db_command), \
             patch.object(m,'backup',return_value='test-backup'), patch.object(m,'run') as run, \
             patch.object(m,'switch') as switch, patch.object(m,'health',side_effect=RuntimeError('health failed')):
            with self.assertRaises(RuntimeError): m.cutover(self.new,self.old)
            self.assertEqual([call.args[0] for call in switch.call_args_list],[self.new,self.old])
            self.assertEqual(run.call_args.args[0],['/usr/bin/systemctl','restart',m.SERVICE])
        with closing(sqlite3.connect(self.db)) as db, db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM schema_migrations').fetchone()[0],13)
            self.assertIsNotNone(db.execute("SELECT id FROM members WHERE id='keep'").fetchone())

    def test_backup_failure_before_stop(self):
        with patch.object(m,'db_check'), patch.object(m,'backup',side_effect=RuntimeError('backup failed')), patch.object(m,'run') as run:
            with self.assertRaises(RuntimeError): m.cutover(self.new,self.old)
            run.assert_not_called()

    def test_migration_failure_restores_old_before_switch(self):
        with patch.object(m,'db_check'), patch.object(m,'db_command',side_effect=RuntimeError('migration failed')), \
             patch.object(m,'backup'), patch.object(m,'run'), patch.object(m,'switch') as switch:
            with self.assertRaises(RuntimeError): m.cutover(self.new,self.old)
            self.assertEqual([call.args[0] for call in switch.call_args_list],[self.old])


if __name__ == '__main__':
    unittest.main(verbosity=2)

HERSTORY_TEST_V2
cat > "$stage/selftest-fixtures.json" <<'HERSTORY_FIXTURE_V2'
{"database.js": "import { DatabaseSync } from 'node:sqlite';\nimport { mkdirSync, readFileSync, readdirSync } from 'node:fs';\nimport { dirname } from 'node:path';\nimport { createHash } from 'node:crypto';\n\n// 保留原业务层的 prepared statement 接口，实际只读写本服务 SQLite。\nexport function openDatabase(path) {\n  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });\n  const raw = new DatabaseSync(path);\n  const applicationId = raw.prepare('PRAGMA application_id').get().application_id;\n  const populated = raw.prepare(\"SELECT 1 FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'\").get();\n  if (applicationId !== 0x48504331 && (applicationId !== 0 || populated)) {\n    raw.close();\n    throw new Error('数据库不属于独立活动服务，拒绝修改；请选择新的数据库文件');\n  }\n  raw.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');\n  function statement(query, args = []) {\n    const stmt = raw.prepare(query);\n    return {\n      bind: (...values) => statement(query, values),\n      first: () => stmt.get(...args) || null,\n      all: () => ({ results: stmt.all(...args) }),\n      run: () => { const r = stmt.run(...args); return { meta: { changes: Number(r.changes) } }; },\n    };\n  }\n  return {\n    raw, prepare: statement,\n    batch(statements) {\n      raw.exec('BEGIN IMMEDIATE');\n      try { const results = statements.map(s => s.run()); raw.exec('COMMIT'); return results; }\n      catch (error) { raw.exec('ROLLBACK'); throw error; }\n    },\n    close: () => raw.close(),\n  };\n}\n\nexport function migrate(db) {\n  const directory = new URL('./migrations/', import.meta.url);\n  db.raw.exec('PRAGMA application_id=1213219633; CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL)');\n  for (const name of readdirSync(directory).filter(n => /^\\d+.*\\.sql$/.test(n)).sort()) {\n    const sql = readFileSync(new URL(name, directory), 'utf8');\n    const checksum = createHash('sha256').update(sql).digest('hex');\n    const old = db.raw.prepare('SELECT checksum FROM schema_migrations WHERE name=?').get(name);\n    if (old) { if (old.checksum !== checksum) throw new Error(`已应用迁移被修改：${name}`); continue; }\n    db.raw.exec('BEGIN IMMEDIATE');\n    try {\n      db.raw.exec(sql);\n      db.raw.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(name, checksum);\n      db.raw.exec('COMMIT');\n    } catch (error) { db.raw.exec('ROLLBACK'); throw error; }\n  }\n}\n\nexport function checkSchema(db) {\n  // 服务启动只验证，迁移由显式管理命令完成。\n  const missing = () => Object.assign(new Error('数据库有待执行迁移。请先备份，再运行 npm run migrate，然后运行 npm start。'), { code: 'SCHEMA_MIGRATION_REQUIRED' });\n  if (!db.raw.prepare(\"SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'\").get()) throw missing();\n  const applied = db.raw.prepare('SELECT name,checksum FROM schema_migrations').all();\n  const directory = new URL('./migrations/', import.meta.url);\n  for (const name of readdirSync(directory).filter(n => /^\\d+.*\\.sql$/.test(n))) {\n    const checksum = createHash('sha256').update(readFileSync(new URL(name, directory))).digest('hex');\n    const previous = applied.find(m => m.name === name);\n    if (!previous) throw missing();\n    if (previous.checksum !== checksum) throw Object.assign(new Error('已应用迁移的校验失败。请恢复原迁移文件；不要删除迁移记录或覆盖数据库。'), { code: 'SCHEMA_CHECKSUM_MISMATCH' });\n  }\n}\n", "migrations": {"0001_initial.sql": "CREATE TABLE members (\n  id TEXT PRIMARY KEY,\n  email TEXT NOT NULL UNIQUE,\n  nickname TEXT NOT NULL,\n  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),\n  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','disabled')),\n  bio TEXT NOT NULL DEFAULT '',\n  skills TEXT NOT NULL DEFAULT '',\n  needs TEXT NOT NULL DEFAULT '',\n  avatar_json TEXT NOT NULL DEFAULT '{}',\n  card_public INTEGER NOT NULL DEFAULT 1,\n  created_at INTEGER NOT NULL,\n  updated_at INTEGER NOT NULL\n);\nCREATE TABLE login_challenges (\n  id TEXT PRIMARY KEY,\n  member_id TEXT NOT NULL REFERENCES members(id),\n  code_hash TEXT NOT NULL,\n  link_hash TEXT NOT NULL UNIQUE,\n  expires_at INTEGER NOT NULL,\n  attempts INTEGER NOT NULL DEFAULT 0,\n  used_at INTEGER,\n  created_at INTEGER NOT NULL\n);\nCREATE INDEX login_challenges_member ON login_challenges(member_id,created_at);\nCREATE TABLE sessions (\n  token_hash TEXT PRIMARY KEY,\n  member_id TEXT NOT NULL REFERENCES members(id),\n  expires_at INTEGER NOT NULL,\n  created_at INTEGER NOT NULL\n);\nCREATE INDEX sessions_member ON sessions(member_id);\nCREATE TABLE events (\n  id TEXT PRIMARY KEY,\n  title TEXT NOT NULL,\n  description TEXT NOT NULL,\n  category TEXT NOT NULL,\n  location TEXT NOT NULL,\n  starts_at INTEGER NOT NULL,\n  ends_at INTEGER NOT NULL,\n  capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 150),\n  volunteer_capacity INTEGER NOT NULL DEFAULT 0 CHECK(volunteer_capacity BETWEEN 0 AND 30),\n  host_id TEXT NOT NULL REFERENCES members(id),\n  official INTEGER NOT NULL DEFAULT 0,\n  status TEXT NOT NULL CHECK(status IN ('pending','published','rejected','cancelled')),\n  reason TEXT NOT NULL DEFAULT '',\n  venue_pin_hash TEXT NOT NULL DEFAULT '',\n  created_at INTEGER NOT NULL,\n  updated_at INTEGER NOT NULL\n);\nCREATE INDEX events_status_time ON events(status,starts_at);\nCREATE TABLE event_registrations (\n  event_id TEXT NOT NULL REFERENCES events(id),\n  member_id TEXT NOT NULL REFERENCES members(id),\n  kind TEXT NOT NULL CHECK(kind IN ('attendee','volunteer')),\n  created_at INTEGER NOT NULL,\n  PRIMARY KEY(event_id,member_id,kind)\n);\nCREATE TABLE event_audit (\n  id TEXT PRIMARY KEY,\n  event_id TEXT NOT NULL REFERENCES events(id),\n  actor_id TEXT NOT NULL REFERENCES members(id),\n  action TEXT NOT NULL,\n  reason TEXT NOT NULL DEFAULT '',\n  created_at INTEGER NOT NULL\n);\nCREATE TABLE tasks (\n  id TEXT PRIMARY KEY,\n  title TEXT NOT NULL,\n  description TEXT NOT NULL,\n  category TEXT NOT NULL,\n  location TEXT NOT NULL,\n  deadline INTEGER NOT NULL,\n  capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 150),\n  host_id TEXT NOT NULL REFERENCES members(id),\n  created_at INTEGER NOT NULL,\n  updated_at INTEGER NOT NULL\n);\nCREATE TABLE task_claims (\n  task_id TEXT NOT NULL REFERENCES tasks(id),\n  member_id TEXT NOT NULL REFERENCES members(id),\n  completed_at INTEGER,\n  created_at INTEGER NOT NULL,\n  PRIMARY KEY(task_id,member_id)\n);\nCREATE TABLE devices (\n  id TEXT PRIMARY KEY,\n  member_id TEXT NOT NULL REFERENCES members(id),\n  token_hash TEXT NOT NULL UNIQUE,\n  revoked_at INTEGER,\n  created_at INTEGER NOT NULL\n);\nCREATE TABLE checkins (\n  event_id TEXT NOT NULL REFERENCES events(id),\n  member_id TEXT NOT NULL REFERENCES members(id),\n  device_id TEXT NOT NULL REFERENCES devices(id),\n  checked_at INTEGER NOT NULL,\n  request_id TEXT NOT NULL,\n  PRIMARY KEY(event_id,member_id),\n  UNIQUE(device_id,request_id)\n);\nCREATE TABLE social_codes (\n  code_hash TEXT PRIMARY KEY,\n  member_id TEXT NOT NULL REFERENCES members(id),\n  expires_at INTEGER NOT NULL,\n  used_at INTEGER\n);\nCREATE TABLE connections (\n  id TEXT PRIMARY KEY,\n  from_member_id TEXT NOT NULL REFERENCES members(id),\n  to_member_id TEXT NOT NULL REFERENCES members(id),\n  device_id TEXT NOT NULL REFERENCES devices(id),\n  connected_at INTEGER NOT NULL,\n  request_id TEXT NOT NULL,\n  UNIQUE(device_id,request_id)\n);\nCREATE TABLE device_failed_codes (\n  device_id TEXT NOT NULL REFERENCES devices(id),\n  attempted_at INTEGER NOT NULL\n);\nCREATE INDEX device_failed_codes_recent ON device_failed_codes(device_id,attempted_at);\n", "0002_event_covers.sql": "-- 封面与活动保存在同一独立数据库；不修改旧迁移或既有活动记录。\nCREATE TABLE event_covers (\n  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,\n  version TEXT NOT NULL,\n  image BLOB NOT NULL\n);\n", "0003_member_roles_and_interests.sql": "-- Preserve the existing admin role; the first enabled administrator owns delegation.\nALTER TABLE members ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0\n  CHECK (is_super_admin IN (0,1) AND (is_super_admin=0 OR role='admin'));\nUPDATE members SET is_super_admin=1 WHERE id=(\n  SELECT id FROM members WHERE role='admin' AND status!='disabled' ORDER BY created_at,id LIMIT 1\n);\nCREATE TABLE member_role_audit (\n  id TEXT PRIMARY KEY,\n  member_id TEXT NOT NULL REFERENCES members(id),\n  actor_id TEXT NOT NULL REFERENCES members(id),\n  previous_role TEXT NOT NULL,\n  role TEXT NOT NULL,\n  created_at INTEGER NOT NULL\n);\nCREATE TABLE event_interests (\n  event_id TEXT NOT NULL REFERENCES events(id),\n  member_id TEXT NOT NULL REFERENCES members(id),\n  created_at INTEGER NOT NULL,\n  PRIMARY KEY(event_id,member_id)\n);\nCREATE INDEX event_interests_member ON event_interests(member_id,event_id);\n", "0004_growth_system.sql": "-- Additive growth storage only. No historical rewards or production rules are seeded.\n-- events.id is the activity/session identifier; sessions remains the login-session table.\nCREATE TABLE programs (\n  id TEXT PRIMARY KEY NOT NULL,\n  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),\n  starts_at INTEGER NOT NULL,\n  ends_at INTEGER NOT NULL CHECK(ends_at>starts_at),\n  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',\n  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','closed')),\n  created_at INTEGER NOT NULL,\n  updated_at INTEGER NOT NULL\n);\nCREATE TABLE activity_types (\n  id TEXT PRIMARY KEY NOT NULL,\n  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),\n  category TEXT NOT NULL CHECK(length(trim(category)) BETWEEN 1 AND 50),\n  world_area TEXT NOT NULL CHECK(length(trim(world_area)) BETWEEN 1 AND 50),\n  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),\n  created_at INTEGER NOT NULL\n);\nCREATE TABLE growth_rules (\n  rule_id TEXT NOT NULL,\n  rule_version INTEGER NOT NULL CHECK(typeof(rule_version)='integer' AND rule_version>0),\n  type_id TEXT NOT NULL REFERENCES activity_types(id),\n  event_kind TEXT NOT NULL CHECK(event_kind IN ('activity','long_term_project','opening','closing')),\n  name TEXT NOT NULL,\n  definition_json TEXT NOT NULL CHECK(json_valid(definition_json) AND json_type(definition_json)='object'),\n  created_by TEXT NOT NULL REFERENCES members(id),\n  created_at INTEGER NOT NULL,\n  PRIMARY KEY(rule_id,rule_version),\n  UNIQUE(rule_id,rule_version,type_id,event_kind)\n);\nCREATE TRIGGER growth_rules_no_update BEFORE UPDATE ON growth_rules\nBEGIN SELECT RAISE(ABORT,'growth rule versions are immutable'); END;\nCREATE TRIGGER growth_rules_no_delete BEFORE DELETE ON growth_rules\nBEGIN SELECT RAISE(ABORT,'growth rule versions are immutable'); END;\nCREATE TABLE event_growth_config (\n  event_id TEXT PRIMARY KEY NOT NULL REFERENCES events(id),\n  program_id TEXT NOT NULL REFERENCES programs(id),\n  type_id TEXT NOT NULL REFERENCES activity_types(id),\n  event_kind TEXT NOT NULL CHECK(event_kind IN ('activity','long_term_project','opening','closing')),\n  rule_id TEXT NOT NULL,\n  rule_version INTEGER NOT NULL,\n  configured_by TEXT NOT NULL REFERENCES members(id),\n  created_at INTEGER NOT NULL,\n  FOREIGN KEY(rule_id,rule_version,type_id,event_kind) REFERENCES growth_rules(rule_id,rule_version,type_id,event_kind),\n  UNIQUE(event_id,program_id,rule_id,rule_version)\n);\nCREATE INDEX event_growth_program ON event_growth_config(program_id,type_id,event_kind);\nCREATE TABLE host_completions (\n  id TEXT PRIMARY KEY NOT NULL,\n  event_id TEXT NOT NULL REFERENCES event_growth_config(event_id),\n  member_id TEXT NOT NULL REFERENCES members(id),\n  evidence_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(evidence_json) AND json_type(evidence_json)='object'),\n  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','rejected','revoked')),\n  verified_by TEXT REFERENCES members(id),\n  verified_at INTEGER,\n  review_note TEXT NOT NULL DEFAULT '',\n  created_at INTEGER NOT NULL,\n  updated_at INTEGER NOT NULL,\n  CHECK((status='pending' AND verified_by IS NULL AND verified_at IS NULL)\n    OR (status!='pending' AND verified_by IS NOT NULL AND verified_at IS NOT NULL AND verified_by!=member_id)),\n  UNIQUE(event_id,member_id),\n  UNIQUE(id,event_id,member_id)\n);\nCREATE INDEX host_completions_review ON host_completions(status,event_id);\nCREATE TRIGGER host_completions_identity BEFORE UPDATE ON host_completions\nWHEN NEW.id!=OLD.id OR NEW.event_id!=OLD.event_id OR NEW.member_id!=OLD.member_id\n\nOR (OLD.status IN ('verified','revoked') AND (NEW.evidence_json!=OLD.evidence_json OR NEW.status NOT IN ('verified','revoked')))\nOR (OLD.status='revoked' AND NEW.status!='revoked')\nBEGIN SELECT RAISE(ABORT,'verified fact identity and evidence are immutable'); END;\nCREATE TRIGGER host_completions_review_insert BEFORE INSERT ON host_completions\nWHEN NEW.status!='pending'\nBEGIN\n  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.verified_by AND role='admin' AND status='active')\n    THEN RAISE(ABORT,'review requires an active administrator') END;\n  SELECT CASE WHEN NEW.status='verified' AND NOT EXISTS(SELECT 1 FROM events WHERE id=NEW.event_id AND host_id=NEW.member_id)\n    THEN RAISE(ABORT,'fact does not match host, volunteer or project') END;\nEND;\nCREATE TRIGGER host_completions_review_update BEFORE UPDATE ON host_completions\nWHEN NEW.status!='pending'\nBEGIN\n  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.verified_by AND role='admin' AND status='active')\n    THEN RAISE(ABORT,'review requires an active administrator') END;\n  SELECT CASE WHEN NEW.status='verified' AND NOT EXISTS(SELECT 1 FROM events WHERE id=NEW.event_id AND host_id=NEW.member_id)\n    THEN RAISE(ABORT,'fact does not match host, volunteer or project') END;\nEND;\nCREATE TABLE volunteer_completions (\n  id TEXT PRIMARY KEY NOT NULL,\n  event_id TEXT NOT NULL REFERENCES event_growth_config(event_id),\n  member_id TEXT NOT NULL REFERENCES members(id),\n  evidence_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(evidence_json) AND json_type(evidence_json)='object'),\n  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','rejected','revoked')),\n  verified_by TEXT REFERENCES members(id),\n  verified_at INTEGER,\n  review_note TEXT NOT NULL DEFAULT '',\n  created_at INTEGER NOT NULL,\n  updated_at INTEGER NOT NULL,\n  CHECK((status='pending' AND verified_by IS NULL AND verified_at IS NULL)\n    OR (status!='pending' AND verified_by IS NOT NULL AND verified_at IS NOT NULL AND verified_by!=member_id)),\n  UNIQUE(event_id,member_id),\n  UNIQUE(id,event_id,member_id)\n);\nCREATE INDEX volunteer_completions_review ON volunteer_completions(status,event_id);\nCREATE TRIGGER volunteer_completions_identity BEFORE UPDATE ON volunteer_completions\nWHEN NEW.id!=OLD.id OR NEW.event_id!=OLD.event_id OR NEW.member_id!=OLD.member_id\n\nOR (OLD.status IN ('verified','revoked') AND (NEW.evidence_json!=OLD.evidence_json OR NEW.status NOT IN ('verified','revoked')))\nOR (OLD.status='revoked' AND NEW.status!='revoked')\nBEGIN SELECT RAISE(ABORT,'verified fact identity and evidence are immutable'); END;\nCREATE TRIGGER volunteer_completions_review_insert BEFORE INSERT ON volunteer_completions\nWHEN NEW.status!='pending'\nBEGIN\n  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.verified_by AND role='admin' AND status='active')\n    THEN RAISE(ABORT,'review requires an active administrator') END;\n  SELECT CASE WHEN NEW.status='verified' AND NOT EXISTS(SELECT 1 FROM event_registrations WHERE event_id=NEW.event_id AND member_id=NEW.member_id AND kind='volunteer')\n    THEN RAISE(ABORT,'fact does not match host, volunteer or project') END;\nEND;\nCREATE TRIGGER volunteer_completions_review_update BEFORE UPDATE ON volunteer_completions\nWHEN NEW.status!='pending'\nBEGIN\n  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.verified_by AND role='admin' AND status='active')\n    THEN RAISE(ABORT,'review requires an active administrator') END;\n  SELECT CASE WHEN NEW.status='verified' AND NOT EXISTS(SELECT 1 FROM event_registrations WHERE event_id=NEW.event_id AND member_id=NEW.member_id AND kind='volunteer')\n    THEN RAISE(ABORT,'fact does not match host, volunteer or project') END;\nEND;\nCREATE TABLE project_submissions (\n  id TEXT PRIMARY KEY NOT NULL,\n  event_id TEXT NOT NULL REFERENCES event_growth_config(event_id),\n  member_id TEXT NOT NULL REFERENCES members(id),\n  contribution_key TEXT NOT NULL CHECK(length(trim(contribution_key)) BETWEEN 1 AND 100),\n  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),\n  evidence_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(evidence_json) AND json_type(evidence_json)='object'),\n  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','rejected','revoked')),\n  verified_by TEXT REFERENCES members(id),\n  verified_at INTEGER,\n  review_note TEXT NOT NULL DEFAULT '',\n  created_at INTEGER NOT NULL,\n  updated_at INTEGER NOT NULL,\n  CHECK((status='pending' AND verified_by IS NULL AND verified_at IS NULL)\n    OR (status!='pending' AND verified_by IS NOT NULL AND verified_at IS NOT NULL AND verified_by!=member_id)),\n  UNIQUE(event_id,member_id,contribution_key),\n  UNIQUE(id,event_id,member_id)\n);\nCREATE INDEX project_submissions_review ON project_submissions(status,event_id);\nCREATE TRIGGER project_submissions_identity BEFORE UPDATE ON project_submissions\nWHEN NEW.id!=OLD.id OR NEW.event_id!=OLD.event_id OR NEW.member_id!=OLD.member_id\nOR NEW.contribution_key!=OLD.contribution_key\nOR (OLD.status IN ('verified','revoked') AND (NEW.evidence_json!=OLD.evidence_json OR NEW.status NOT IN ('verified','revoked')))\nOR (OLD.status='revoked' AND NEW.status!='revoked')\nBEGIN SELECT RAISE(ABORT,'verified fact identity and evidence are immutable'); END;\nCREATE TRIGGER project_submissions_review_insert BEFORE INSERT ON project_submissions\nWHEN NEW.status!='pending'\nBEGIN\n  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.verified_by AND role='admin' AND status='active')\n    THEN RAISE(ABORT,'review requires an active administrator') END;\n  SELECT CASE WHEN NEW.status='verified' AND NOT EXISTS(SELECT 1 FROM event_growth_config WHERE event_id=NEW.event_id AND event_kind='long_term_project')\n    THEN RAISE(ABORT,'fact does not match host, volunteer or project') END;\nEND;\nCREATE TRIGGER project_submissions_review_update BEFORE UPDATE ON project_submissions\nWHEN NEW.status!='pending'\nBEGIN\n  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.verified_by AND role='admin' AND status='active')\n    THEN RAISE(ABORT,'review requires an active administrator') END;\n  SELECT CASE WHEN NEW.status='verified' AND NOT EXISTS(SELECT 1 FROM event_growth_config WHERE event_id=NEW.event_id AND event_kind='long_term_project')\n    THEN RAISE(ABORT,'fact does not match host, volunteer or project') END;\nEND;\nCREATE TABLE asset_definitions (\n  id TEXT PRIMARY KEY NOT NULL,\n  name TEXT NOT NULL,\n  asset_kind TEXT NOT NULL CHECK(length(trim(asset_kind))>0),\n  slot_key TEXT NOT NULL CHECK(length(trim(slot_key))>0),\n  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json) AND json_type(metadata_json)='object'),\n  created_at INTEGER NOT NULL\n);\nCREATE TABLE reward_ledger (\n  id TEXT PRIMARY KEY NOT NULL,\n  member_id TEXT NOT NULL REFERENCES members(id),\n  event_id TEXT NOT NULL,\n  program_id TEXT NOT NULL,\n  rule_id TEXT NOT NULL,\n  rule_version INTEGER NOT NULL,\n  source_kind TEXT NOT NULL CHECK(source_kind IN ('checkin','host','volunteer','project')),\n  checkin_event_id TEXT,\n  host_completion_id TEXT,\n  volunteer_completion_id TEXT,\n  project_submission_id TEXT,\n  metric TEXT CHECK(metric IN ('P','H','V','M')),\n  asset_id TEXT REFERENCES asset_definitions(id),\n  asset_level INTEGER,\n  amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount!=0),\n  reversal_of TEXT UNIQUE REFERENCES reward_ledger(id),\n  idempotency_key TEXT NOT NULL UNIQUE CHECK(length(trim(idempotency_key)) BETWEEN 1 AND 200),\n  reason TEXT NOT NULL CHECK(length(trim(reason))>0),\n  calculation_json TEXT NOT NULL CHECK(json_valid(calculation_json) AND json_type(calculation_json)='object'),\n  created_by TEXT NOT NULL REFERENCES members(id),\n  created_at INTEGER NOT NULL,\n  FOREIGN KEY(event_id,program_id,rule_id,rule_version) REFERENCES event_growth_config(event_id,program_id,rule_id,rule_version),\n  FOREIGN KEY(checkin_event_id,member_id) REFERENCES checkins(event_id,member_id),\n  FOREIGN KEY(host_completion_id,event_id,member_id) REFERENCES host_completions(id,event_id,member_id),\n  FOREIGN KEY(volunteer_completion_id,event_id,member_id) REFERENCES volunteer_completions(id,event_id,member_id),\n  FOREIGN KEY(project_submission_id,event_id,member_id) REFERENCES project_submissions(id,event_id,member_id),\n  CHECK((source_kind='checkin' AND checkin_event_id IS NOT NULL AND checkin_event_id=event_id AND host_completion_id IS NULL AND volunteer_completion_id IS NULL AND project_submission_id IS NULL)\n    OR (source_kind='host' AND checkin_event_id IS NULL AND host_completion_id IS NOT NULL AND volunteer_completion_id IS NULL AND project_submission_id IS NULL)\n    OR (source_kind='volunteer' AND checkin_event_id IS NULL AND host_completion_id IS NULL AND volunteer_completion_id IS NOT NULL AND project_submission_id IS NULL)\n    OR (source_kind='project' AND checkin_event_id IS NULL AND host_completion_id IS NULL AND volunteer_completion_id IS NULL AND project_submission_id IS NOT NULL)),\n  CHECK((metric IS NOT NULL AND asset_id IS NULL AND asset_level IS NULL)\n    OR (metric IS NULL AND asset_id IS NOT NULL AND typeof(asset_level)='integer' AND asset_level>0 AND abs(amount)=1)),\n  CHECK((reversal_of IS NULL AND amount>0) OR (reversal_of IS NOT NULL AND amount<0)),\n  CHECK(NOT(source_kind='checkin' AND metric='P') OR abs(amount)=1),\n  UNIQUE(id,member_id,program_id,asset_id,asset_level)\n);\n-- Business-level deduplication does not include rule_version: a rule upgrade must not award twice.\nCREATE UNIQUE INDEX reward_metric_once ON reward_ledger(event_id,member_id,source_kind,coalesce(project_submission_id,''),metric) WHERE reversal_of IS NULL AND metric IS NOT NULL;\nCREATE UNIQUE INDEX reward_asset_once ON reward_ledger(event_id,member_id,source_kind,coalesce(project_submission_id,''),asset_id,asset_level) WHERE reversal_of IS NULL AND asset_id IS NOT NULL;\nCREATE INDEX reward_member_program ON reward_ledger(member_id,program_id,created_at);\nCREATE TRIGGER reward_ledger_no_update BEFORE UPDATE ON reward_ledger\nBEGIN SELECT RAISE(ABORT,'reward ledger is append only'); END;\nCREATE TRIGGER reward_ledger_no_delete BEFORE DELETE ON reward_ledger\nBEGIN SELECT RAISE(ABORT,'reward ledger is append only'); END;\nCREATE TRIGGER reward_ledger_validate BEFORE INSERT ON reward_ledger\nBEGIN\n  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.created_by AND role='admin' AND status='active')\n    THEN RAISE(ABORT,'settlement requires an active administrator') END;\n  SELECT CASE WHEN NEW.reversal_of IS NULL AND NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.member_id AND status='active')\n    THEN RAISE(ABORT,'recipient must be active') END;\n  SELECT CASE WHEN NEW.reversal_of IS NULL AND NOT EXISTS(SELECT 1 FROM events WHERE id=NEW.event_id AND status='published')\n    THEN RAISE(ABORT,'event must be published') END;\n  SELECT CASE WHEN NEW.reversal_of IS NULL AND NEW.source_kind='checkin' AND NOT EXISTS(\n    SELECT 1 FROM checkins c JOIN events e ON e.id=c.event_id WHERE c.event_id=NEW.event_id AND c.member_id=NEW.member_id AND c.checked_at>=e.starts_at-3600 AND c.checked_at<e.starts_at)\n    THEN RAISE(ABORT,'checkin is outside the valid window') END;\n  SELECT CASE WHEN NEW.reversal_of IS NULL AND NEW.source_kind='host' AND NOT EXISTS(SELECT 1 FROM host_completions WHERE id=NEW.host_completion_id AND status='verified')\n    THEN RAISE(ABORT,'host completion is not verified') END;\n  SELECT CASE WHEN NEW.reversal_of IS NULL AND NEW.source_kind='volunteer' AND NOT EXISTS(SELECT 1 FROM volunteer_completions WHERE id=NEW.volunteer_completion_id AND status='verified')\n    THEN RAISE(ABORT,'volunteer completion is not verified') END;\n  SELECT CASE WHEN NEW.reversal_of IS NULL AND NEW.source_kind='project' AND NOT EXISTS(SELECT 1 FROM project_submissions WHERE id=NEW.project_submission_id AND status='verified')\n    THEN RAISE(ABORT,'project contribution is not verified') END;\n  SELECT CASE WHEN NEW.reversal_of IS NOT NULL AND NOT EXISTS(\n    SELECT 1 FROM reward_ledger r WHERE r.id=NEW.reversal_of AND r.reversal_of IS NULL\n      AND r.member_id=NEW.member_id AND r.event_id=NEW.event_id AND r.program_id=NEW.program_id\n      AND r.rule_id=NEW.rule_id AND r.rule_version=NEW.rule_version AND r.source_kind=NEW.source_kind\n      AND r.checkin_event_id IS NEW.checkin_event_id AND r.host_completion_id IS NEW.host_completion_id\n      AND r.volunteer_completion_id IS NEW.volunteer_completion_id AND r.project_submission_id IS NEW.project_submission_id\n      AND r.metric IS NEW.metric AND r.asset_id IS NEW.asset_id AND r.asset_level IS NEW.asset_level AND r.amount=-NEW.amount)\n    THEN RAISE(ABORT,'reversal must exactly negate its original reward') END;\nEND;\nCREATE TABLE user_assets (\n  member_id TEXT NOT NULL,\n  program_id TEXT NOT NULL,\n  asset_id TEXT NOT NULL,\n  asset_level INTEGER NOT NULL,\n  source_ledger_id TEXT NOT NULL,\n  updated_at INTEGER NOT NULL,\n  PRIMARY KEY(member_id,program_id,asset_id),\n  FOREIGN KEY(source_ledger_id,member_id,program_id,asset_id,asset_level) REFERENCES reward_ledger(id,member_id,program_id,asset_id,asset_level)\n);\nCREATE TRIGGER user_assets_insert_guard BEFORE INSERT ON user_assets\nWHEN NOT EXISTS(SELECT 1 FROM reward_ledger r WHERE r.id=NEW.source_ledger_id AND r.reversal_of IS NULL AND r.asset_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM reward_ledger x WHERE x.reversal_of=r.id))\nBEGIN SELECT RAISE(ABORT,'asset must reference an unreversed grant'); END;\nCREATE TRIGGER user_assets_update_guard BEFORE UPDATE ON user_assets\nWHEN NOT EXISTS(SELECT 1 FROM reward_ledger r WHERE r.id=NEW.source_ledger_id AND r.reversal_of IS NULL AND r.asset_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM reward_ledger x WHERE x.reversal_of=r.id))\nBEGIN SELECT RAISE(ABORT,'asset must reference an unreversed grant'); END;\n-- Projection changes are in the same SQLite statement/transaction as the grant or reversal.\nCREATE TRIGGER reward_asset_project AFTER INSERT ON reward_ledger WHEN NEW.asset_id IS NOT NULL\nBEGIN\n  DELETE FROM user_assets WHERE member_id=NEW.member_id AND program_id=NEW.program_id AND asset_id=NEW.asset_id;\n  INSERT INTO user_assets(member_id,program_id,asset_id,asset_level,source_ledger_id,updated_at)\n    SELECT r.member_id,r.program_id,r.asset_id,r.asset_level,r.id,NEW.created_at FROM reward_ledger r\n    WHERE r.member_id=NEW.member_id AND r.program_id=NEW.program_id AND r.asset_id=NEW.asset_id AND r.reversal_of IS NULL\n      AND NOT EXISTS(SELECT 1 FROM reward_ledger x WHERE x.reversal_of=r.id)\n    ORDER BY r.asset_level DESC,r.created_at,r.id LIMIT 1;\nEND;\nCREATE VIEW member_growth_totals AS\n  SELECT member_id,program_id,metric,SUM(amount) total FROM reward_ledger WHERE metric IS NOT NULL GROUP BY member_id,program_id,metric;\nCREATE TRIGGER host_completions_revoke_guard BEFORE UPDATE OF status ON host_completions\nWHEN OLD.status='verified' AND NEW.status!='verified' AND EXISTS(\n  SELECT 1 FROM reward_ledger r WHERE r.host_completion_id=OLD.id AND r.reversal_of IS NULL\n    AND NOT EXISTS(SELECT 1 FROM reward_ledger x WHERE x.reversal_of=r.id))\nBEGIN SELECT RAISE(ABORT,'reverse rewards before revoking their evidence'); END;\nCREATE TRIGGER volunteer_completions_revoke_guard BEFORE UPDATE OF status ON volunteer_completions\nWHEN OLD.status='verified' AND NEW.status!='verified' AND EXISTS(\n  SELECT 1 FROM reward_ledger r WHERE r.volunteer_completion_id=OLD.id AND r.reversal_of IS NULL\n    AND NOT EXISTS(SELECT 1 FROM reward_ledger x WHERE x.reversal_of=r.id))\nBEGIN SELECT RAISE(ABORT,'reverse rewards before revoking their evidence'); END;\nCREATE TRIGGER project_submissions_revoke_guard BEFORE UPDATE OF status ON project_submissions\nWHEN OLD.status='verified' AND NEW.status!='verified' AND EXISTS(\n  SELECT 1 FROM reward_ledger r WHERE r.project_submission_id=OLD.id AND r.reversal_of IS NULL\n    AND NOT EXISTS(SELECT 1 FROM reward_ledger x WHERE x.reversal_of=r.id))\nBEGIN SELECT RAISE(ABORT,'reverse rewards before revoking their evidence'); END;\n\nCREATE TRIGGER host_completions_no_verified_delete BEFORE DELETE ON host_completions\nWHEN OLD.status IN ('verified','revoked')\nBEGIN SELECT RAISE(ABORT,'verified evidence must be retained'); END;\n\nCREATE TRIGGER volunteer_completions_no_verified_delete BEFORE DELETE ON volunteer_completions\nWHEN OLD.status IN ('verified','revoked')\nBEGIN SELECT RAISE(ABORT,'verified evidence must be retained'); END;\n\nCREATE TRIGGER project_submissions_no_verified_delete BEFORE DELETE ON project_submissions\nWHEN OLD.status IN ('verified','revoked')\nBEGIN SELECT RAISE(ABORT,'verified evidence must be retained'); END;\n", "0005_event_import_batches.sql": "-- A stable request ID makes retries safe after network failures.\nCREATE TABLE event_import_batches (\n  id TEXT PRIMARY KEY,\n  actor_id TEXT NOT NULL REFERENCES members(id),\n  payload_hash TEXT NOT NULL,\n  result_json TEXT NOT NULL CHECK(json_valid(result_json)),\n  created_at INTEGER NOT NULL\n);\n", "0006_planet_identity.sql": "-- Planet ownership is global to the existing member account; no new member IDs.\nCREATE TABLE member_planets (\n  member_id TEXT PRIMARY KEY NOT NULL REFERENCES members(id),\n  planet_id TEXT NOT NULL UNIQUE,\n  palette_id TEXT NOT NULL CHECK(palette_id IN ('green','pink','blue','apricot')),\n  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),\n  snapshot_hash TEXT NOT NULL DEFAULT '',\n  onboarded_at INTEGER,\n  created_at INTEGER NOT NULL\n);\nCREATE TRIGGER member_planets_immutable_identity BEFORE UPDATE ON member_planets\nWHEN NEW.member_id != OLD.member_id OR NEW.planet_id != OLD.planet_id OR NEW.palette_id != OLD.palette_id\nBEGIN SELECT RAISE(ABORT, 'planet ownership and palette are permanent'); END;\n", "0007_profile_finalization.sql": "ALTER TABLE members ADD COLUMN profile_completed_at INTEGER;\n-- Previously saved avatar configurations remain the final configuration.\nUPDATE members SET profile_completed_at=updated_at\nWHERE json_valid(avatar_json) AND json_type(avatar_json,'$.selection')='object'\n  AND json_type(avatar_json,'$.release')='text';\nCREATE TRIGGER member_profile_final BEFORE UPDATE ON members\nWHEN OLD.profile_completed_at IS NOT NULL AND (\n  NEW.profile_completed_at IS NOT OLD.profile_completed_at OR\n  NEW.nickname IS NOT OLD.nickname OR NEW.bio IS NOT OLD.bio OR\n  NEW.skills IS NOT OLD.skills OR NEW.needs IS NOT OLD.needs OR\n  NEW.avatar_json IS NOT OLD.avatar_json OR NEW.card_public IS NOT OLD.card_public)\nBEGIN SELECT RAISE(ABORT, 'profile and avatar have been finalized'); END;\n", "0008_avatar_only_lock.sql": "-- Preserve confirmed avatars and timestamps; release only ordinary profile fields.\nDROP TRIGGER member_profile_final;\nCREATE TRIGGER member_avatar_final BEFORE UPDATE ON members\nWHEN OLD.profile_completed_at IS NOT NULL AND (\n  NEW.profile_completed_at IS NOT OLD.profile_completed_at OR\n  NEW.avatar_json IS NOT OLD.avatar_json)\nBEGIN SELECT RAISE(ABORT, 'avatar has been finalized'); END;\n", "0009_hardware_planet.sql": "CREATE TABLE device_hardware_profiles (\n  device_id TEXT PRIMARY KEY REFERENCES devices(id),\n  device_kind TEXT NOT NULL CHECK(device_kind IN ('user','checkin')),\n  rgb565_byte_order TEXT CHECK(rgb565_byte_order IN ('little','big')),\n  configured_by TEXT NOT NULL REFERENCES members(id),\n  updated_at INTEGER NOT NULL\n);\nCREATE TRIGGER device_kind_permanent BEFORE UPDATE ON device_hardware_profiles\nWHEN NEW.device_kind IS NOT OLD.device_kind\nBEGIN SELECT RAISE(ABORT,'device kind is permanent'); END;\nCREATE TRIGGER device_binding_permanent BEFORE UPDATE ON devices\nWHEN NEW.id IS NOT OLD.id OR NEW.member_id IS NOT OLD.member_id OR NEW.token_hash IS NOT OLD.token_hash\nBEGIN SELECT RAISE(ABORT,'device binding is permanent; revoke and enroll a replacement'); END;\nCREATE TABLE checkin_station_activities (\n  station_device_id TEXT NOT NULL REFERENCES device_hardware_profiles(device_id),\n  activity_id TEXT NOT NULL REFERENCES events(id),\n  opens_at INTEGER NOT NULL,\n  closes_at INTEGER NOT NULL CHECK(closes_at>opens_at),\n  authorized_by TEXT NOT NULL REFERENCES members(id),\n  revoked_at INTEGER,\n  PRIMARY KEY(station_device_id,activity_id)\n);\nCREATE TABLE hardware_interactions (\n  interaction_id TEXT PRIMARY KEY,\n  interaction_type TEXT NOT NULL CHECK(interaction_type IN ('checkin','friend')),\n  reporter_device_id TEXT NOT NULL REFERENCES devices(id),\n  device_a_id TEXT NOT NULL REFERENCES devices(id),\n  device_b_id TEXT NOT NULL REFERENCES devices(id),\n  activity_id TEXT REFERENCES events(id),\n  occurred_at INTEGER NOT NULL,\n  received_at INTEGER NOT NULL,\n  payload_hash TEXT NOT NULL,\n  receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json))\n);\nCREATE TRIGGER hardware_interactions_no_update BEFORE UPDATE ON hardware_interactions\nBEGIN SELECT RAISE(ABORT,'hardware receipts are immutable'); END;\nCREATE TABLE hardware_checkin_sources (\n  activity_id TEXT NOT NULL,\n  member_id TEXT NOT NULL,\n  interaction_id TEXT NOT NULL UNIQUE REFERENCES hardware_interactions(interaction_id) DEFERRABLE INITIALLY DEFERRED,\n  station_device_id TEXT NOT NULL REFERENCES devices(id),\n  PRIMARY KEY(activity_id,member_id),\n  FOREIGN KEY(activity_id,member_id) REFERENCES checkins(event_id,member_id)\n);\nCREATE TABLE friendships (\n  id TEXT PRIMARY KEY,\n  member_a_id TEXT NOT NULL REFERENCES members(id),\n  member_b_id TEXT NOT NULL REFERENCES members(id),\n  established_at INTEGER NOT NULL,\n  source_interaction_id TEXT NOT NULL REFERENCES hardware_interactions(interaction_id) DEFERRABLE INITIALLY DEFERRED,\n  CHECK(member_a_id<member_b_id),\n  UNIQUE(member_a_id,member_b_id)\n);\nCREATE INDEX friendships_other ON friendships(member_b_id,member_a_id);\n-- Explicit upstream catalog ID -> website UUID mapping, never guessed from title/date.\nCREATE TABLE planet_activity_catalog_map (\n  catalog_activity_id TEXT PRIMARY KEY,\n  activity_id TEXT NOT NULL REFERENCES events(id),\n  configured_by TEXT NOT NULL REFERENCES members(id),\n  updated_at INTEGER NOT NULL\n);\nCREATE TABLE planet_settlement_tasks (\n  activity_id TEXT NOT NULL,\n  member_id TEXT NOT NULL,\n  status TEXT NOT NULL DEFAULT 'pending_rules' CHECK(status IN ('pending_rules','settled','failed')),\n  created_at INTEGER NOT NULL,\n  PRIMARY KEY(activity_id,member_id),\n  FOREIGN KEY(activity_id,member_id) REFERENCES checkins(event_id,member_id)\n);\nCREATE TABLE hardware_pixel_states (\n  member_id TEXT PRIMARY KEY REFERENCES member_planets(member_id),\n  state_version INTEGER NOT NULL CHECK(state_version>0),\n  source_hash TEXT NOT NULL,\n  state_json TEXT NOT NULL CHECK(json_valid(state_json)),\n  updated_at INTEGER NOT NULL\n);\nCREATE TABLE hardware_planet_frames (\n  member_id TEXT NOT NULL REFERENCES member_planets(member_id),\n  frame_version INTEGER NOT NULL CHECK(frame_version>0),\n  planet_revision INTEGER NOT NULL,\n  state_version INTEGER NOT NULL,\n  width INTEGER NOT NULL CHECK(width=240),\n  height INTEGER NOT NULL CHECK(height=320),\n  format TEXT NOT NULL CHECK(format='RGB565'),\n  byte_order TEXT NOT NULL CHECK(byte_order IN ('little','big')),\n  render_version TEXT NOT NULL,\n  sha256 TEXT NOT NULL CHECK(length(sha256)=64),\n  byte_length INTEGER NOT NULL CHECK(byte_length=153600),\n  frame BLOB NOT NULL CHECK(length(frame)=153600),\n  created_at INTEGER NOT NULL,\n  PRIMARY KEY(member_id,frame_version)\n);\nCREATE TRIGGER hardware_frames_no_update BEFORE UPDATE ON hardware_planet_frames\nBEGIN SELECT RAISE(ABORT,'planet frames are immutable'); END;\nCREATE TABLE device_planet_displays (\n  device_id TEXT PRIMARY KEY REFERENCES devices(id),\n  member_id TEXT NOT NULL,\n  frame_version INTEGER NOT NULL,\n  sha256 TEXT NOT NULL,\n  displayed_at INTEGER NOT NULL,\n  FOREIGN KEY(member_id,frame_version) REFERENCES hardware_planet_frames(member_id,frame_version)\n);\n", "0010_planet_growth.sql": "-- Versioned asset entitlement ledger; PHVM metric rewards remain governed by 0004.\nCREATE TABLE planet_growth_release (\n  singleton INTEGER PRIMARY KEY CHECK(singleton=1),\n  rule_version TEXT NOT NULL, model_version TEXT NOT NULL,\n  rule_sha256 TEXT NOT NULL, manifest_sha256 TEXT NOT NULL,\n  configured_by TEXT NOT NULL REFERENCES members(id), activated_at INTEGER NOT NULL\n);\nCREATE TRIGGER planet_release_no_update BEFORE UPDATE ON planet_growth_release\nBEGIN SELECT RAISE(ABORT,'published planet rules are immutable'); END;\nCREATE TRIGGER planet_release_no_delete BEFORE DELETE ON planet_growth_release\nBEGIN SELECT RAISE(ABORT,'published planet rules are immutable'); END;\nCREATE TABLE planet_growth_events (\n  event_id TEXT PRIMARY KEY REFERENCES events(id),\n  milestone TEXT CHECK(milestone IN ('opening','host')),\n  halloween INTEGER NOT NULL DEFAULT 0 CHECK(halloween IN (0,1)),\n  configured_by TEXT NOT NULL REFERENCES members(id), created_at INTEGER NOT NULL\n);\nCREATE UNIQUE INDEX planet_opening_once ON planet_growth_events(milestone) WHERE milestone='opening';\nCREATE TRIGGER planet_growth_events_no_update BEFORE UPDATE ON planet_growth_events\nBEGIN SELECT RAISE(ABORT,'planet event mappings are immutable'); END;\nCREATE TRIGGER planet_growth_events_no_delete BEFORE DELETE ON planet_growth_events\nBEGIN SELECT RAISE(ABORT,'planet event mappings are immutable'); END;\nCREATE TRIGGER planet_catalog_mapping_guard BEFORE UPDATE ON planet_activity_catalog_map\nWHEN EXISTS(SELECT 1 FROM planet_growth_release) AND NEW.activity_id IS NOT OLD.activity_id\nBEGIN SELECT RAISE(ABORT,'published catalog mapping is immutable'); END;\nCREATE TRIGGER planet_catalog_mapping_no_delete BEFORE DELETE ON planet_activity_catalog_map\nWHEN EXISTS(SELECT 1 FROM planet_growth_release)\nBEGIN SELECT RAISE(ABORT,'published catalog mapping is immutable'); END;\nCREATE TABLE planet_role_reviews (\n  id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id),\n  kind TEXT NOT NULL CHECK(kind IN ('volunteer','host')),\n  event_id TEXT REFERENCES events(id),\n  evidence_note TEXT NOT NULL CHECK(length(trim(evidence_note)) BETWEEN 1 AND 1000),\n  reviewed_by TEXT NOT NULL REFERENCES members(id) CHECK(reviewed_by!=member_id),\n  reviewed_at INTEGER NOT NULL,\n  CHECK((kind='volunteer' AND event_id IS NULL) OR (kind='host' AND event_id IS NOT NULL))\n);\nCREATE UNIQUE INDEX planet_volunteer_once ON planet_role_reviews(member_id) WHERE kind='volunteer';\nCREATE UNIQUE INDEX planet_host_once ON planet_role_reviews(member_id,event_id) WHERE kind='host';\nCREATE TRIGGER planet_role_reviews_authority BEFORE INSERT ON planet_role_reviews\nBEGIN\n SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.reviewed_by AND status='active' AND role='admin') THEN RAISE(ABORT,'active administrator required') END;\n SELECT CASE WHEN NEW.kind='host' AND NOT EXISTS(SELECT 1 FROM events WHERE id=NEW.event_id AND host_id=NEW.member_id AND status='published' AND ends_at<=NEW.reviewed_at) THEN RAISE(ABORT,'completed host event required') END;\nEND;\nCREATE TRIGGER planet_role_reviews_no_update BEFORE UPDATE ON planet_role_reviews\nBEGIN SELECT RAISE(ABORT,'planet role reviews are immutable'); END;\nCREATE TRIGGER planet_role_reviews_no_delete BEFORE DELETE ON planet_role_reviews\nBEGIN SELECT RAISE(ABORT,'planet role reviews are immutable'); END;\nCREATE TABLE planet_fact_corrections (\n  id INTEGER PRIMARY KEY,member_id TEXT NOT NULL REFERENCES members(id),\n  kind TEXT NOT NULL CHECK(kind IN ('checkin','role')),event_id TEXT REFERENCES events(id),review_id TEXT REFERENCES planet_role_reviews(id),\n  valid INTEGER NOT NULL CHECK(valid IN (0,1)), reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 1000),\n  corrected_by TEXT NOT NULL REFERENCES members(id),corrected_at INTEGER NOT NULL,\n  CHECK((kind='checkin' AND event_id IS NOT NULL AND review_id IS NULL) OR (kind='role' AND event_id IS NULL AND review_id IS NOT NULL))\n);\nCREATE INDEX planet_corrections_latest ON planet_fact_corrections(member_id,kind,event_id,review_id,id);\nCREATE TRIGGER planet_corrections_authority BEFORE INSERT ON planet_fact_corrections\nBEGIN\n SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.corrected_by AND role='admin' AND status='active') THEN RAISE(ABORT,'active administrator required') END;\n SELECT CASE WHEN NEW.kind='checkin' AND NOT EXISTS(SELECT 1 FROM checkins WHERE event_id=NEW.event_id AND member_id=NEW.member_id) THEN RAISE(ABORT,'checkin fact required') END;\n SELECT CASE WHEN NEW.kind='role' AND NOT EXISTS(SELECT 1 FROM planet_role_reviews WHERE id=NEW.review_id AND member_id=NEW.member_id) THEN RAISE(ABORT,'role fact required') END;\nEND;\nCREATE TRIGGER planet_corrections_no_update BEFORE UPDATE ON planet_fact_corrections\nBEGIN SELECT RAISE(ABORT,'planet corrections are immutable'); END;\nCREATE TRIGGER planet_corrections_no_delete BEFORE DELETE ON planet_fact_corrections\nBEGIN SELECT RAISE(ABORT,'planet corrections are immutable'); END;\nCREATE TABLE planet_asset_grants (\n  id TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES member_planets(member_id),\n  rule_version TEXT NOT NULL, model_version TEXT NOT NULL,\n  reward_key TEXT NOT NULL,label TEXT NOT NULL,\n  source_json TEXT NOT NULL CHECK(json_valid(source_json)),\n  unit_ids_json TEXT NOT NULL CHECK(json_valid(unit_ids_json)),\n  content_hash TEXT NOT NULL,created_at INTEGER NOT NULL\n);\nCREATE INDEX planet_grants_owner ON planet_asset_grants(member_id,reward_key);\nCREATE TABLE planet_asset_reversals (\n  grant_id TEXT PRIMARY KEY REFERENCES planet_asset_grants(id),reason TEXT NOT NULL,created_at INTEGER NOT NULL\n);\nCREATE TRIGGER planet_grants_no_update BEFORE UPDATE ON planet_asset_grants\nBEGIN SELECT RAISE(ABORT,'planet grants are immutable'); END;\nCREATE TRIGGER planet_grants_no_delete BEFORE DELETE ON planet_asset_grants\nBEGIN SELECT RAISE(ABORT,'planet grants are immutable'); END;\nCREATE TRIGGER planet_reversals_no_update BEFORE UPDATE ON planet_asset_reversals\nBEGIN SELECT RAISE(ABORT,'planet reversals are immutable'); END;\nCREATE TRIGGER planet_reversals_no_delete BEFORE DELETE ON planet_asset_reversals\nBEGIN SELECT RAISE(ABORT,'planet reversals are immutable'); END;\n", "0011_game_jam.sql": "CREATE TABLE game_jam_apps (\n  app_id TEXT PRIMARY KEY,\n  owner_id TEXT NOT NULL REFERENCES members(id),\n  created_at INTEGER NOT NULL\n);\nCREATE TABLE game_jam_projects (\n  id TEXT PRIMARY KEY,\n  app_id TEXT NOT NULL REFERENCES game_jam_apps(app_id),\n  version TEXT NOT NULL,\n  title TEXT NOT NULL,\n  author TEXT NOT NULL,\n  description TEXT NOT NULL,\n  category TEXT NOT NULL CHECK(category IN ('互动游戏','随身工具','城市社交','实验作品')),\n  manifest_json TEXT NOT NULL,\n  firmware_name TEXT NOT NULL,\n  firmware_bytes INTEGER NOT NULL CHECK(firmware_bytes > 0 AND firmware_bytes < 6881280),\n  firmware_sha256 TEXT NOT NULL CHECK(length(firmware_sha256)=64),\n  firmware BLOB NOT NULL,\n  cover BLOB,\n  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','published','rejected')),\n  review_note TEXT NOT NULL DEFAULT '',\n  created_at INTEGER NOT NULL,\n  updated_at INTEGER NOT NULL,\n  UNIQUE(app_id,version),\n  CHECK(length(firmware)=firmware_bytes)\n);\nCREATE INDEX game_jam_project_status ON game_jam_projects(status,created_at);\nCREATE TABLE game_jam_reviews (\n  id TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL REFERENCES game_jam_projects(id),\n  reviewer_id TEXT NOT NULL REFERENCES members(id),\n  status TEXT NOT NULL CHECK(status IN ('published','rejected')),\n  note TEXT NOT NULL,\n  created_at INTEGER NOT NULL\n);\n", "0012_cloud_hardware.sql": "-- Ephemeral state contains confirmation proofs, never raw device tokens.\nCREATE TABLE hardware_cloud_sessions (\n  id TEXT PRIMARY KEY,\n  state_json TEXT NOT NULL CHECK(json_valid(state_json)),\n  updated_at INTEGER NOT NULL\n);\nCREATE TABLE hardware_cloud_settings (\n  device_id TEXT PRIMARY KEY REFERENCES devices(id),\n  station_device_id TEXT REFERENCES devices(id)\n);\n-- Explicit authorization for a user's board to act as its owner's event station.\nCREATE TABLE hardware_host_grants (\n  device_id TEXT NOT NULL REFERENCES devices(id),\n  activity_id TEXT NOT NULL REFERENCES events(id),\n  authorized_by TEXT NOT NULL REFERENCES members(id),\n  PRIMARY KEY(device_id, activity_id)\n);\nCREATE TABLE hardware_host_receipts (\n  interaction_id TEXT PRIMARY KEY,\n  host_device_id TEXT NOT NULL REFERENCES devices(id),\n  user_device_id TEXT NOT NULL REFERENCES devices(id),\n  activity_id TEXT NOT NULL REFERENCES events(id),\n  payload_hash TEXT NOT NULL,\n  receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json)),\n  created_at INTEGER NOT NULL\n);\n", "0013_device_claims.sql": "CREATE TABLE device_inventory (\n  id TEXT PRIMARY KEY,\n  token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64),\n  claim_code TEXT UNIQUE CHECK(claim_code IS NULL OR length(claim_code)=4),\n  expires_at INTEGER NOT NULL DEFAULT 0,\n  request_id TEXT UNIQUE,\n  requested_member_id TEXT REFERENCES members(id),\n  requested_by TEXT REFERENCES members(id),\n  bound_at INTEGER,\n  created_at INTEGER NOT NULL,\n  last_seen_at INTEGER NOT NULL\n);\nCREATE TABLE device_claim_attempts (\n  admin_id TEXT NOT NULL REFERENCES members(id),\n  attempted_at INTEGER NOT NULL\n);\nCREATE INDEX device_claim_attempts_admin ON device_claim_attempts(admin_id,attempted_at);\nCREATE TABLE device_claim_audit (\n  id TEXT PRIMARY KEY,\n  device_id TEXT NOT NULL REFERENCES device_inventory(id),\n  member_id TEXT REFERENCES members(id),\n  admin_id TEXT REFERENCES members(id),\n  action TEXT NOT NULL CHECK(action IN ('requested','rejected','bound','cancelled')),\n  created_at INTEGER NOT NULL\n);\n"}}
HERSTORY_FIXTURE_V2
/usr/bin/python3 - "$stage" <<'CHECK_FILES'
import ast, json, pathlib, sys
root=pathlib.Path(sys.argv[1])
for name in ('herstory-release.py','test_release_tool.py'):
    ast.parse((root/name).read_text())
fixture=json.loads((root/'selftest-fixtures.json').read_text())
# Use the actual installed old database module in the synthetic compatibility test.
fixture['old-database.js']=pathlib.Path('/opt/herstory-popup-city/current/database.js').read_text()
(root/'selftest-fixtures.json').write_text(json.dumps(fixture))
CHECK_FILES
cat > "$stage/herstory-deploy" <<'DEPLOY_WRAPPER'
#!/bin/sh
exec /usr/bin/python3 -I /usr/local/libexec/herstory-release.py deploy "$@"
DEPLOY_WRAPPER
cat > "$stage/herstory-rollback" <<'ROLLBACK_WRAPPER'
#!/bin/sh
exec /usr/bin/python3 -I /usr/local/libexec/herstory-release.py rollback "$@"
ROLLBACK_WRAPPER
cat > "$stage/sudoers" <<'SUDO_RULES'
herstory-ops ALL=(root) NOPASSWD: /usr/local/sbin/herstory-deploy *
herstory-ops ALL=(root) NOPASSWD: /usr/local/sbin/herstory-rollback ""
SUDO_RULES
/usr/sbin/visudo -cf "$stage/sudoers"
/usr/sbin/useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin herstory-build
created=1
install -d -m 0711 -o root -g root /var/lib/herstory-build
install -d -m 0700 -o root -g root /var/lib/herstory-deploy
check_dir=$(mktemp -d /var/lib/herstory-build/install-selftest.XXXXXX)
chmod 0755 "$check_dir"
for name in herstory-release.py test_release_tool.py selftest-fixtures.json; do
  install -m 0644 -o root -g root "$stage/$name" "$check_dir/$name"
done
echo '=== 自动隔离测试：只使用临时合成数据，不操作正式数据库 ==='
/usr/bin/systemd-run --quiet --wait --pipe --collect --unit="$unit" --uid=herstory-build \
  -p NoNewPrivileges=yes -p ProtectSystem=strict -p ProtectHome=yes \
  -p PrivateTmp=yes -p ProtectControlGroups=yes -p ProtectKernelTunables=yes \
  -p RestrictSUIDSGID=yes -p PrivateDevices=yes -p CapabilityBoundingSet= \
  -p PrivateNetwork=yes -p KillMode=control-group -p RuntimeMaxSec=180 \
  -p TasksMax=128 -p MemoryMax=384M -p CPUQuota=50% -p Nice=10 \
  -p 'InaccessiblePaths=/var/lib/herstory-popup-city /etc/herstory-popup-city /var/lib/herstory-deploy' \
  /usr/bin/env -i PATH=/opt/herstory-popup-city/runtime/bin:/usr/bin:/bin \
    PYTHONDONTWRITEBYTECODE=1 HERSTORY_TEST_NODE=/opt/herstory-popup-city/runtime/bin/node \
    /usr/bin/python3 -I "$check_dir/test_release_tool.py"
after=$(/usr/bin/systemctl show --no-pager herstory-popup-city.service -p ActiveState -p MainPID)
[ "$before" = "$after" ] || { echo '检测到网站服务状态发生变化，停止安装，请查看服务状态'; exit 1; }
rm -rf "$check_dir"
echo '=== 自动测试通过，安装工具和限定权限 ==='
install -d -m 0755 -o root -g root /usr/local/libexec
install -m 0644 -o root -g root "$stage/herstory-release.py" /usr/local/libexec/herstory-release.py
install -m 0755 -o root -g root "$stage/herstory-deploy" /usr/local/sbin/herstory-deploy
install -m 0755 -o root -g root "$stage/herstory-rollback" /usr/local/sbin/herstory-rollback
install -m 0440 -o root -g root "$stage/sudoers" /etc/sudoers.d/herstory-ops-deploy
/usr/sbin/visudo -c
installed=1
sudo -l -U herstory-ops
echo 'HERSTORY_INSTALL_OK：自动隔离测试通过，工具及权限安装完成。'
echo '本次没有部署代码、升级正式数据库、重启网站或修改 Caddy。'
