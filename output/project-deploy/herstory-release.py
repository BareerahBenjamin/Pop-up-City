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
STATE = BASE / 'deploy-state'
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
           'npm_config_cache': str(directory.parent / 'cache'),
           'npm_config_userconfig': str(directory.parent / 'npm-userconfig'),
           'npm_config_globalconfig': str(directory.parent / 'npm-globalconfig')}
    unit = 'herstory-popup-build-' + os.urandom(8).hex()
    args = ['/usr/bin/systemd-run', '--quiet', '--wait', '--pipe', '--collect',
         '--unit=' + unit, '--uid=herstory-popup-city', '--working-directory=' + str(directory),
         '-p', 'NoNewPrivileges=yes', '-p', 'ProtectSystem=strict',
         '-p', 'ProtectHome=yes', '-p', 'PrivateTmp=yes',
         '-p', 'ProtectControlGroups=yes', '-p', 'ProtectKernelTunables=yes',
         '-p', 'RestrictSUIDSGID=yes', '-p', 'PrivateDevices=yes',
         '-p', 'CapabilityBoundingSet=', '-p', 'KillMode=control-group',
         '-p', 'RuntimeMaxSec=900', '-p', 'TasksMax=128', '-p', 'MemoryMax=384M',
         '-p', 'CPUQuota=50%', '-p', 'Nice=10',
         '-p', 'ReadWritePaths=' + str(directory.parent) + (' ' + str(writable) if writable else ''),
         *([] if network else ['-p', 'PrivateNetwork=yes']),
         '-p', 'InaccessiblePaths=/var/lib/herstory-popup-city /etc/herstory-popup-city /opt/herstory-popup-city/deploy-state -/opt/lmoment -/opt/herstory-records-ro -/srv -/var/www',
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
    compat = Path(tempfile.mkdtemp(prefix='compat-', dir=str(BASE / 'deploy-work')))
    try:
        clone = compat / 'compatibility.sqlite'
        shutil.copyfile(saved, clone)
        # Rehearse reviewed SQL while only root can access the new directory.
        sqlite_migrate(clone, expected)
        checker = compat / 'compatibility.mjs'
        checker.write_text("import {pathToFileURL} from 'node:url'; const m=await import(pathToFileURL(process.argv[2])); const db=m.openDatabase(process.argv[3]);try{m.checkSchema(db)}finally{db.close()}")
        user = pwd.getpwnam('herstory-popup-city')
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
    work = Path(tempfile.mkdtemp(prefix='release-', dir=str(BASE / 'deploy-work')))
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
        for config_name in ('npm-userconfig', 'npm-globalconfig'):
            (work / config_name).write_text('')
        archive.unlink()
        user = pwd.getpwnam('herstory-popup-city')
        for root, dirs, files in os.walk(work):
            os.chown(root, user.pw_uid, user.pw_gid)
            for name in files:
                os.chown(Path(root) / name, user.pw_uid, user.pw_gid)
        build_run([NODE, NPM, 'ci', '--include=optional', '--ignore-scripts', '--no-audit', '--no-fund'], tree)
        tests = sorted(str(p.relative_to(tree)) for p in (tree / 'test').glob('*.test.js'))
        if not tests:
            raise RuntimeError('缺少隔离测试')
        build_run([NODE, '--test', *tests], tree, network=False)
        build_run([NODE, 'scripts/check-release.mjs'], tree, network=False)
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
