import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT = Path('/var/backups/herstory-domain-20261012')
FILES = [Path('/etc/caddy/Caddyfile'), Path('/etc/caddy/herstory-popup-city.caddy'), Path('/etc/herstory-popup-city/server.env')]

def run(*args):
    return subprocess.check_output(args, text=True).strip()

def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def copy(source, target):
    shutil.copy2(source, target)
    st = Path(source).stat()
    os.chown(target, st.st_uid, st.st_gid)

def protected():
    return {
        'lmoment_config': digest('/etc/caddy/lmoment.caddy'),
        'release': os.path.realpath('/opt/herstory-popup-city/current'),
        'services': {s: run('systemctl', 'show', s, '-p', 'MainPID', '--value') for s in ['caddy', 'herstory-workshop', 'pm2-ubuntu']},
    }

def local_health():
    for _ in range(20):
        try:
            data = json.loads(run('curl', '-fsS', '--max-time', '2', 'http://127.0.0.1:3300/healthz'))
            if data.get('status') == 'ok':
                return data
        except (subprocess.CalledProcessError, ValueError):
            pass
        time.sleep(.5)
    raise RuntimeError('Application health check failed')

def restore():
    for path in FILES:
        copy(ROOT / (path.name + '.before'), path)
    run('caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile')
    run('systemctl', 'restart', 'herstory-popup-city')
    local_health()
    run('systemctl', 'reload', 'caddy')

mode = sys.argv[1]
if mode == 'prepare':
    ROOT.mkdir(mode=0o700, exist_ok=False)
    baseline = {'files': {str(p): digest(p) for p in FILES}, 'protected': protected()}
    assert baseline['files']['/etc/caddy/Caddyfile'] == 'b8efab389e8830749d98483f99cbe7e5bbbb7651c13b6c426db75356705ffe10'
    assert baseline['files']['/etc/caddy/herstory-popup-city.caddy'] == '189c358360114e2c50b7fc85d983684403f95cee0300b4d2112204951d78f660'
    for p in FILES:
        copy(p, ROOT / (p.name + '.before'))
    original = FILES[0].read_text()
    old = '\t\troot * /srv/herstory.net.cn/current\n\t\tencode zstd gzip\n\t\ttry_files {path} /index.html\n\t\tfile_server'
    new = '\t\t@website {\n\t\t\tnot path /api/device/*\n\t\t}\n\t\tencode @website zstd gzip\n\t\treverse_proxy 127.0.0.1:3300'
    assert original.count(old) == 1
    candidate = original.replace(old, new)
    (ROOT / 'Caddyfile.after').write_text(candidate)
    (ROOT / 'herstory-popup-city.caddy.after').write_text('# Former domain; preserve paths when platform access permits.\nkunyuan.site {\n    redir https://herstory.net.cn{uri} 308\n}\n')
    env = FILES[2].read_text()
    assert env.splitlines().count('PUBLIC_ORIGIN=https://kunyuan.site') == 1
    (ROOT / 'server.env.after').write_text(env.replace('PUBLIC_ORIGIN=https://kunyuan.site', 'PUBLIC_ORIGIN=https://herstory.net.cn'))
    os.chmod(ROOT / 'server.env.after', 0o600)
    staged = candidate.replace('import /etc/caddy/herstory-popup-city.caddy', 'import ' + str(ROOT / 'herstory-popup-city.caddy.after'))
    (ROOT / 'Caddyfile.validate').write_text(staged)
    run('caddy', 'validate', '--config', str(ROOT / 'Caddyfile.validate'), '--adapter', 'caddyfile')
    run('/opt/herstory-popup-city/runtime/bin/node', '--env-file=' + str(ROOT / 'server.env.after'), '--input-type=module', '-e', "import {loadConfig} from '/opt/herstory-popup-city/current/config.js';const c=loadConfig();if(c.origin!=='https://herstory.net.cn'||!c.secureCookies)throw Error('invalid origin');console.log('configuration valid')")
    (ROOT / 'baseline.json').write_text(json.dumps(baseline, indent=2))
    print('PREPARED: Caddy and application configuration valid; live configuration unchanged.')
elif mode == 'apply':
    baseline = json.loads((ROOT / 'baseline.json').read_text())
    assert not (ROOT / 'applied.json').exists(), 'Already applied'
    assert baseline['files'] == {str(p): digest(p) for p in FILES}, 'Live configuration changed; refusing overwrite'
    assert baseline['protected'] == protected(), 'Other deployment detected'
    try:
        for p in FILES:
            candidate = ROOT / (p.name + '.after')
            st = p.stat()
            shutil.copyfile(candidate, p)
            os.chmod(p, st.st_mode & 0o777)
            os.chown(p, st.st_uid, st.st_gid)
        run('caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile')
        run('systemctl', 'restart', 'herstory-popup-city')
        health = local_health()
        run('systemctl', 'reload', 'caddy')
        public_health = json.loads(run('curl', '-fsS', '--max-time', '10', '--resolve', 'herstory.net.cn:443:127.0.0.1', 'https://herstory.net.cn/healthz'))
        assert public_health['status'] == 'ok'
        workshop = run('curl', '-sS', '--max-time', '10', '-o', '/dev/null', '-w', '%{http_code}', '--resolve', 'herstory.net.cn:443:127.0.0.1', 'https://herstory.net.cn/workshop/common-sense/')
        assert workshop == '200'
        assert protected() == baseline['protected'], 'Protected service state changed'
        report = {'origin': 'https://herstory.net.cn', 'health': health, 'workshop_http': workshop, 'protected_unchanged': True, 'backup': str(ROOT), 'files': {str(p): digest(p) for p in FILES}}
        (ROOT / 'applied.json').write_text(json.dumps(report, indent=2))
        print(json.dumps(report, indent=2))
    except Exception:
        restore()
        print('ROLLED BACK to original configuration', file=sys.stderr)
        raise
elif mode == 'rollback':
    restore()
    print('Restored original routing and PUBLIC_ORIGIN; no database changes.')
else:
    raise ValueError('Expected prepare, apply, or rollback')
