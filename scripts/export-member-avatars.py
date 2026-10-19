#!/usr/bin/env python3
"""Export all members' avatar selections from SQLite without modifying the DB.

Server usage: sudo python3 /tmp/export-member-avatars.py
Only member ID, nickname, avatar release/selection and avatar validity are exported.
No external packages or network access are required.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shlex
import sqlite3
import sys


def database_path(env_path):
    text = env_path.read_text(encoding='utf-8')
    match = re.search(r'^\s*(?:export\s+)?DATABASE_PATH\s*=\s*(.*?)\s*$', text, re.M)
    if not match:
        raise ValueError('DATABASE_PATH missing; use --database /absolute/path.sqlite')
    parts = shlex.split(match[1], comments=True)
    if len(parts) != 1 or not Path(parts[0]).is_absolute():
        raise ValueError('DATABASE_PATH must be an absolute path')
    return Path(parts[0])


def avatar_record(member_id, nickname, raw):
    record = {'member_id': member_id, 'nickname': nickname, 'avatar': None}
    try:
        avatar = json.loads(raw or '{}')
    except (ValueError, TypeError):
        return dict(record, avatar_state='invalid')
    if not isinstance(avatar, dict):
        return dict(record, avatar_state='invalid')
    if not avatar:
        return dict(record, avatar_state='missing')
    release, selection = avatar.get('release'), avatar.get('selection')
    if (not isinstance(release, str) or not release or
            not isinstance(selection, dict) or not selection or
            not all(isinstance(k, str) and isinstance(v, str) for k, v in selection.items())):
        return dict(record, avatar_state='invalid')
    # Explicit allowlist: do not copy unexpected avatar properties or member fields.
    record['avatar'] = {'release': release, 'selection': selection}
    return dict(record, avatar_state='ready')


def export(db_path, output):
    db_path = db_path.resolve(strict=True)
    if not db_path.is_file():
        raise ValueError('Database is not a regular file')
    if output.resolve() == db_path:
        raise ValueError('Output cannot be the database')
    with sqlite3.connect(db_path.as_uri() + '?mode=ro', uri=True, timeout=10) as db:
        db.execute('PRAGMA query_only=ON')
        rows = db.execute('SELECT id,nickname,avatar_json FROM members ORDER BY id').fetchall()
    members = [avatar_record(*row) for row in rows]
    counts = {state: sum(m['avatar_state'] == state for m in members)
              for state in ('ready', 'missing', 'invalid')}
    payload = {'format': 'herstory-member-avatars-v1',
               'exported_at': datetime.now(timezone.utc).isoformat(),
               'member_count': len(members), 'avatar_counts': counts, 'members': members}
    # Never overwrite an existing export; repeated runs get a numbered filename.
    for index in range(10000):
        target = output if index == 0 else output.with_name(output.stem + '-' + str(index + 1) + output.suffix)
        try:
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            break
        except FileExistsError:
            continue
    else:
        raise ValueError('Too many existing exports; choose another --output')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(payload, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    print('Exported: ' + str(target))
    print('Members: %d; ready: %d; missing: %d; invalid: %d' %
          (len(members), counts['ready'], counts['missing'], counts['invalid']))
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env', type=Path, default=Path('/etc/herstory-popup-city/server.env'))
    parser.add_argument('--database', type=Path, help='Explicit SQLite path instead of reading server.env')
    parser.add_argument('--output', type=Path, default=Path('/tmp/herstory-all-avatars.json'))
    args = parser.parse_args()
    try:
        export(args.database or database_path(args.env), args.output)
    except (OSError, ValueError, sqlite3.Error) as error:
        print('Export failed: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
