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
            for item in ['--uid=herstory-popup-city','ProtectSystem=strict','KillMode=control-group','PrivateNetwork=yes']:
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
