#!/usr/bin/env python3
"""Package an actual product build; component-check builds are rejected."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def package(build, output):
    description = json.loads((build / 'project_description.json').read_text())
    if Path(description['project_path']).resolve() != ROOT or not (ROOT / 'main/app_main.c').is_file():
        raise ValueError('Refusing component harness: a complete product project/build is required')
    acceptance = json.loads((ROOT / 'product-readiness.json').read_text())
    required = ['startup_binding', 'planet_name', 'friend_mutual_consent', 'host_single_batch',
                'reconnect_reconciliation', 'display_input', 'persistent_identity', 'host_tests']
    if acceptance.get('version') != description.get('project_version') or any(acceptance.get(k) is not True for k in required):
        raise ValueError('Product integration gates are incomplete or version does not match')
    subprocess.run([sys.executable, str(ROOT / 'tools/validate_event_app.py'), '--build-dir', str(build)], check=True)
    if output.exists():
        raise ValueError('Output already exists; do not replace an existing release')
    with tempfile.TemporaryDirectory(prefix='popcity-package-') as temporary:
        stage = Path(temporary)
        sources = {'full.bin': build / 'FoloToy-AI-Passport-full.bin',
                   'application.bin': build / 'FoloToy-AI-Passport.bin',
                   'bootloader.bin': build / 'bootloader/bootloader.bin',
                   'partition-table.bin': build / 'partition_table/partition-table.bin',
                   'partitions.csv': ROOT / 'partitions.csv',
                   'firmware.elf': build / 'FoloToy-AI-Passport.elf',
                   'firmware.map': build / 'FoloToy-AI-Passport.map'}
        files = {}
        for name, source in sources.items():
            data = source.read_bytes()
            (stage / name).write_bytes(data)
            files[name] = {'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        manifest = {'format': 'popcity-flash-v1', 'chip': 'esp32c3', 'contract': 'herstory-event-v1',
                    'artifact_kind': 'product', 'version': description['project_version'],
                    'app_id': 'popcity', 'device_tests': 'not_run', 'files': files,
                    'partition_csv_sha256': files['partitions.csv']['sha256']}
        (stage / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        # Never sweep this directory: initialization creates private per-board
        # files beside tools, which must not enter a release or replace manifest.
        for name in ['flash.py', 'initialize.py', 'setup.sh', 'setup.ps1',
                     'requirements.txt', 'README.md', 'README.zh_CN.md']:
            source = ROOT / 'portable' / name
            if source.is_symlink() or not source.is_file():
                raise ValueError('Missing or unsafe portable tool: ' + name)
            shutil.copyfile(source, stage / name)
        spec = importlib.util.spec_from_file_location('portable_flash', stage / 'flash.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.validate(stage)
        output.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
            for item in sorted(stage.iterdir()):
                archive.write(item, 'Pop-up-City-Firmware/' + item.name)
    output.with_suffix(output.suffix + '.sha256').write_text(hashlib.sha256(output.read_bytes()).hexdigest() + '  ' + output.name + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('build', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    try:
        package(args.build.resolve(), args.output.resolve())
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        parser.exit(1, 'STOP: ' + str(error) + '\n')
