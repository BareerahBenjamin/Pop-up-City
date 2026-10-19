import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import shutil
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('flash', ROOT / 'portable/flash.py')
flash = importlib.util.module_from_spec(spec)
spec.loader.exec_module(flash)
spec_package = importlib.util.spec_from_file_location('package_portable', ROOT / 'tools/package_portable.py')
packager = importlib.util.module_from_spec(spec_package)
spec_package.loader.exec_module(packager)


class PortablePackage(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        boot = bytearray(256)
        boot[0] = 0xe9
        boot[3] = 0x3f
        boot[12] = 5
        app = bytearray(boot)
        elf = b'fixture ELF identity'
        app[32:36] = b'\x32\x54\xcd\xab'
        app[176:208] = hashlib.sha256(elf).digest()
        table = b''
        for label, kind, subtype, offset, size in [('nvs',1,2,0x9000,0x6000),('phy_init',1,1,0xf000,0x1000),('factory',0,0,0x10000,0x680000),('event_save',1,2,0x690000,0x170000)]:
            table += struct.pack('<HBBII16sI',0x50aa,kind,subtype,offset,size,label.encode(),0)
        table += b'\xeb\xeb'+b'\xff'*14+hashlib.md5(table).digest()
        table += b'\xff' * (3072-len(table))
        full = bytearray(b'\xff' * (0x10000+len(boot)))
        full[:len(boot)] = boot
        full[0x8000:0x8000+len(table)] = table
        full[0x10000:] = app
        self.data = {'bootloader.bin':bytes(boot),'application.bin':bytes(app),'partition-table.bin':table,'full.bin':bytes(full),'partitions.csv':(ROOT/'partitions.csv').read_bytes(), 'firmware.elf':elf, 'firmware.map':b'fixture map'}
        self.manifest = {'format':'popcity-flash-v1','chip':'esp32c3','contract':'herstory-event-v1','artifact_kind':'product','partition_csv_sha256':flash.PARTITION_SHA}
        self.write()

    def tearDown(self):
        self.tmp.cleanup()

    def write(self):
        self.manifest['files'] = {}
        for name, data in self.data.items():
            (self.root/name).write_bytes(data)
            self.manifest['files'][name] = {'size':len(data),'sha256':hashlib.sha256(data).hexdigest()}
        (self.root/'manifest.json').write_text(json.dumps(self.manifest))

    def test_valid_without_usb(self):
        self.assertEqual(flash.validate(self.root)['chip'],'esp32c3')

    def test_harness_rejected(self):
        self.manifest['artifact_kind']='component-check'
        self.write()
        with self.assertRaises(ValueError):flash.validate(self.root)

    def test_corrupted_file(self):
        (self.root/'full.bin').write_bytes(b'corrupt')
        with self.assertRaises(ValueError):flash.validate(self.root)

    def test_protected_range_even_with_matching_hash(self):
        self.data['full.bin'] += b'\xff' * (flash.SAVE_START-len(self.data['full.bin'])+1)
        self.write()
        with self.assertRaises(ValueError):flash.validate(self.root)

    def test_wrong_chip_even_when_all_hashes_match(self):
        for name in ['application.bin','bootloader.bin']:
            data=bytearray(self.data[name]);data[12]=0;self.data[name]=bytes(data)
        data=bytearray(self.data['full.bin']);data[12]=0;data[0x1000c]=0;self.data['full.bin']=bytes(data)
        self.write()
        with self.assertRaises(ValueError):flash.validate(self.root)

    def test_changed_partition_even_with_matching_merged_hash(self):
        table=bytearray(self.data['partition-table.bin']);table[100]^=1
        self.data['partition-table.bin']=bytes(table)
        full=bytearray(self.data['full.bin']);full[0x8000:0x8000+len(table)]=table;self.data['full.bin']=bytes(full)
        self.write()
        with self.assertRaises(ValueError):flash.validate(self.root)

    def test_mismatched_app(self):
        self.data['application.bin']+=b'changed';self.write()
        with self.assertRaises(ValueError):flash.validate(self.root)

    def test_wrong_elf_even_when_manifest_hash_matches(self):
        self.data['firmware.elf'] = b'ELF from another build'
        self.write()
        with self.assertRaises(ValueError):flash.validate(self.root)

    def test_nvs_identity_blob_rejected(self):
        full = bytearray(self.data['full.bin']);full[0x9000:0x9006] = b'secret'
        self.data['full.bin'] = bytes(full);self.write()
        with self.assertRaises(ValueError):flash.validate(self.root)

    def test_wrong_flash_size_rejected(self):
        boot = bytearray(self.data['bootloader.bin']);boot[3] = 0x2f
        full = bytearray(self.data['full.bin']);full[:len(boot)] = boot
        self.data['bootloader.bin'] = bytes(boot);self.data['full.bin'] = bytes(full);self.write()
        with self.assertRaises(ValueError):flash.validate(self.root)

    def test_traversal_rejected(self):
        self.manifest['files']['../outside']={'size':1,'sha256':'a'*64}
        (self.root/'manifest.json').write_text(json.dumps(self.manifest))
        with self.assertRaises(ValueError):flash.validate(self.root)

    def test_symlink_rejected(self):
        outside=self.root/'outside';outside.write_bytes(self.data['full.bin'])
        (self.root/'full.bin').unlink();(self.root/'full.bin').symlink_to(outside)
        with self.assertRaises(ValueError):flash.validate(self.root)

    def test_release_excludes_private_identity_files(self):
        # A user may run initialization from the tools directory. A later
        # packaging step must not sweep that private identity into the ZIP.
        project = self.root.resolve() / 'project';build = self.root.resolve() / 'build'
        (project / 'main').mkdir(parents=True);build.mkdir()
        (project / 'main/app_main.c').write_text('fixture')
        shutil.copytree(ROOT / 'portable', project / 'portable', ignore=shutil.ignore_patterns('__pycache__'))
        (project / 'portable/private-board.json').write_text('private device token')
        (project / 'partitions.csv').write_bytes(self.data['partitions.csv'])
        gates = {key:True for key in ['startup_binding', 'planet_name', 'friend_mutual_consent',
            'host_single_batch', 'reconnect_reconciliation', 'display_input', 'persistent_identity', 'host_tests']}
        (project / 'product-readiness.json').write_text(json.dumps({**gates, 'version':'fixture'}))
        (build / 'project_description.json').write_text(json.dumps({'project_path':str(project), 'project_version':'fixture'}))
        names = {'full.bin':'FoloToy-AI-Passport-full.bin', 'application.bin':'FoloToy-AI-Passport.bin',
            'bootloader.bin':'bootloader/bootloader.bin', 'partition-table.bin':'partition_table/partition-table.bin',
            'firmware.elf':'FoloToy-AI-Passport.elf', 'firmware.map':'FoloToy-AI-Passport.map'}
        for artifact, name in names.items():
            destination = build / name;destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(self.data[artifact])
        output = self.root / 'release.zip'
        with patch.object(packager, 'ROOT', project), patch.object(packager.subprocess, 'run'):
            packager.package(build, output)
        import zipfile
        with zipfile.ZipFile(output) as archive:
            self.assertNotIn('Pop-up-City-Firmware/private-board.json', archive.namelist())
            self.assertIn('Pop-up-City-Firmware/initialize.py', archive.namelist())


if __name__ == '__main__':unittest.main()
