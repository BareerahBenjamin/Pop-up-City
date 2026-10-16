#!/bin/sh
# Run on the production server as root; upload this script beside its release archive.
set -eu
if [ "$(id -u)" != 0 ]; then echo 'Run with sudo bash deploy-formal.sh' >&2; exit 1; fi
release_version=20261016-hardware-formal-a0df41fc
release_sha=a0df41fc134d16f10286e09ff5f3bb7482f6e1b19bd50bc24282d7cac3ab34a0
upload_source=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/$release_version.tar.gz
[ -f "$upload_source" ] || { echo 'Place the release archive beside this script.' >&2; exit 1; }
printf '%s  %s\n' "$release_sha" "$upload_source" | sha256sum -c -
[ -x /opt/herstory-popup-city/deploy-tools/deploy ]
[ -x /opt/herstory-popup-city/deploy-tools/rollback ]
[ -f /etc/herstory-popup-city/server.env ]
# Only update this project's enrollment setting. Never print existing environment values.
python3 - <<'PY'
from pathlib import Path
import os,re,secrets,tempfile,shutil,datetime
p=Path('/etc/herstory-popup-city/server.env')
if p.is_symlink(): raise SystemExit('Refusing symlink server.env; ask maintainer to inspect.')
st=p.stat();text=p.read_text()
def values(key):
    return re.findall(r'^\s*(?:export\s+)?'+key+r'\s*=\s*(.*?)\s*$',text,re.M)
origin=values('PUBLIC_ORIGIN')
if len(origin)!=1 or origin[0].strip('\"\'')!='https://herstory.net.cn':
    raise SystemExit('PUBLIC_ORIGIN must already be https://herstory.net.cn; no settings changed.')
keys=values('DEVICE_ENROLLMENT_KEY')
if len(keys)>1: raise SystemExit('Duplicate enrollment settings; no settings changed.')
key=keys[0].strip('\"\'') if keys else ''
if key and not re.fullmatch('[0-9a-f]{64}',key): raise SystemExit('Existing enrollment key invalid; no settings changed.')
if not key:
    key=secrets.token_hex(32)
    state=Path('/opt/herstory-popup-city/deploy-state')
    if state.is_symlink(): raise SystemExit('Unexpected deploy-state symlink.')
    state.mkdir(mode=0o700,exist_ok=True)
    backup=state/('server-env-before-formal-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+secrets.token_hex(4)+'.bak')
    with backup.open('xb') as out:
        os.fchmod(out.fileno(),0o600);out.write(p.read_bytes());out.flush();os.fsync(out.fileno())
    line='DEVICE_ENROLLMENT_KEY='+key
    if keys: text=re.sub(r'^\s*(?:export\s+)?DEVICE_ENROLLMENT_KEY\s*=.*$',lambda _:line,text,flags=re.M)
    else: text=text.rstrip('\n')+'\n'+line+'\n'
    fd,name=tempfile.mkstemp(prefix='.formal-env-',dir=str(p.parent))
    try:
        with os.fdopen(fd,'w') as out:
            os.fchmod(out.fileno(),st.st_mode & 0o777);os.fchown(out.fileno(),st.st_uid,st.st_gid)
            out.write(text);out.flush();os.fsync(out.fileno())
        os.replace(name,p)
    finally:
        if os.path.exists(name): os.unlink(name)
    print('Project enrollment key configured. Existing login, SMTP and database settings preserved.')
else: print('Existing project enrollment key preserved.')
PY
install -o herstory-ops -g herstory-ops -m 0600 "$upload_source" "/home/herstory-ops/releases-upload/$release_version.tar.gz"
/opt/herstory-popup-city/deploy-tools/deploy "$release_version" "$release_sha"
python3 - <<'PY'
import json,urllib.request,urllib.error
origin='https://herstory.net.cn'
with urllib.request.urlopen(origin+'/healthz',timeout=20) as response:
    health=json.load(response)
assert health.get('status')=='ok',health
print('HTTPS health: OK; mail configured:',bool(health.get('mail_configured')))
for path in ['/device-binding.js','/hardware-admin.js']:
    with urllib.request.urlopen(origin+path,timeout=20) as response:
        assert response.status==200
        assert 'javascript' in response.headers.get('Content-Type',''), 'Unexpected static response'
    print('Static module: OK',path)
for path in ['/api/device-enrollment/status','/local/friend/list']:
    try:
        urllib.request.urlopen(origin+path,timeout=20)
    except urllib.error.HTTPError as error:
        assert error.code==401,(path,error.code)
        body=json.load(error)
        assert isinstance(body,dict)
        print('Device authentication gate: OK',path)
    else: raise RuntimeError('Unauthenticated device request unexpectedly accepted: '+path)
print('FORMAL_WEBSITE_DEPLOY_OK')
print('Physical board pairing and end-to-end attendance validation remain pending.')
PY
readlink -f /opt/herstory-popup-city/current
