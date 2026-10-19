#!/usr/bin/env python3
"""Portable, bounded ESP32-C3 flasher. Never accepts an arbitrary image path."""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import sys

SAVE_START = 0x690000
PARTITION_SHA = '5036f083d1a2fd9006a1d5c534ac82a54423fd62db563cce3a66c76b5788598b'


def validate(root):
    root = pathlib.Path(root).resolve()
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    if (manifest.get('format') != 'popcity-flash-v1' or manifest.get('chip') != 'esp32c3'
            or manifest.get('contract') != 'herstory-event-v1'
            or manifest.get('artifact_kind') != 'product'
            or manifest.get('partition_csv_sha256') != PARTITION_SHA):
        raise ValueError('Not a validated Pop-up City product firmware package')
    files = manifest.get('files', {})
    required = {'full.bin', 'application.bin', 'bootloader.bin', 'partition-table.bin', 'partitions.csv', 'firmware.elf', 'firmware.map'}
    if not required.issubset(files):
        raise ValueError('Missing required firmware artifacts')
    data = {}
    for name, entry in files.items():
        if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9_.-]+', name):
            raise ValueError('Invalid artifact path')
        path = root / name
        if path.is_symlink() or path.resolve().parent != root:
            raise ValueError('Artifact escapes package')
        payload = path.read_bytes()
        if not payload or len(payload) != entry.get('size') or hashlib.sha256(payload).hexdigest() != entry.get('sha256'):
            raise ValueError('Corrupt artifact: ' + name)
        data[name] = payload
    if hashlib.sha256(data['partitions.csv']).hexdigest() != PARTITION_SHA:
        raise ValueError('Partition contract mismatch')
    image = data['full.bin']
    if len(image) < 0x10000 + 24 or ((len(image) + 4095) // 4096) * 4096 > SAVE_START:
        raise ValueError('Image would touch protected event_save or is incomplete')
    for name, offset in [('bootloader.bin', 0), ('partition-table.bin', 0x8000), ('application.bin', 0x10000)]:
        piece = data[name]
        if image[offset:offset + len(piece)] != piece:
            raise ValueError('Merged artifact mismatch: ' + name)
    for name in ['bootloader.bin', 'application.bin']:
        # ESP image header: magic at 0; chip ID little-endian at 12. ESP32-C3 = 5.
        header = data[name]
        if (len(header) < 24 or header[0] != 0xE9 or int.from_bytes(header[12:14], 'little') != 5
                or header[3] >> 4 != 3):
            raise ValueError('Wrong ESP image target: ' + name)
    # IDF app descriptor lives after the image header and first segment header.
    app = data['application.bin']
    if (len(app) < 208 or app[32:36] != b'\x32\x54\xcd\xab'
            or app[176:208] != hashlib.sha256(data['firmware.elf']).digest()):
        raise ValueError('Application descriptor does not match the packaged ELF')
    if len(data['bootloader.bin']) > 0x8000 or len(data['partition-table.bin']) > 0x1000:
        raise ValueError('Boot/partition image exceeds reserved range')
    # Only the three declared firmware segments may carry bytes. In particular,
    # an accidental initialized NVS blob must never be copied to every board.
    ranges = [(0, len(data['bootloader.bin'])),
              (0x8000, 0x8000 + len(data['partition-table.bin'])),
              (0x10000, 0x10000 + len(app))]
    cursor = 0
    for start, end in ranges:
        if start < cursor or any(value != 255 for value in image[cursor:start]):
            raise ValueError('Unexpected data outside declared firmware segments')
        cursor = end
    if any(value != 255 for value in image[cursor:]):
        raise ValueError('Unexpected trailing firmware data')
    # Decode the binary partition entries independently of the CSV file.
    import struct
    expected = [('nvs', 1, 2, 0x9000, 0x6000), ('phy_init', 1, 1, 0xf000, 0x1000),
                ('factory', 0, 0, 0x10000, 0x680000), ('event_save', 1, 2, SAVE_START, 0x170000)]
    table = data['partition-table.bin']
    if len(table) < 160:
        raise ValueError('Truncated partition table')
    actual = []
    for position in range(0, 128, 32):
        magic, kind, subtype, offset, size, label, flags = struct.unpack('<HBBII16sI', table[position:position+32])
        if magic != 0x50AA or flags:
            raise ValueError('Invalid partition entry')
        actual.append((label.rstrip(b'\0').decode('ascii'), kind, subtype, offset, size))
    if any(b != 255 for b in table[160:]):
        raise ValueError('Unexpected additional partition entries')
    if actual != expected or table[128:144] != b'\xeb\xeb' + b'\xff' * 14 or table[144:160] != hashlib.md5(table[:128]).digest():
        raise ValueError('Binary partition contract/MD5 mismatch')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify', action='store_true', help='Verify package without opening USB')
    parser.add_argument('--list', action='store_true', help='List serial ports without resetting devices')
    parser.add_argument('--port', help='Explicit port, e.g. COM4 or /dev/cu.usbmodem...')
    args = parser.parse_args()
    if args.list:
        from serial.tools import list_ports
        for port in list_ports.comports():
            print(port.device, port.description)
        return 0
    root = pathlib.Path(__file__).resolve().parent
    manifest = validate(root)
    print('Verified:', manifest.get('version'), '| protected event_save: 0x690000..0x7fffff')
    if args.verify:
        return 0
    if not args.port:
        parser.error('Select an explicit --port; use --list first')
    # A subprocess receives a fixed argument array; user input is never interpreted by a shell.
    command = [sys.executable, '-m', 'esptool', '--chip', 'esp32c3', '--port', args.port,
               '--baud', '460800', '--before', 'default_reset', '--after', 'hard_reset',
               'write_flash', '--flash_size', '8MB', '0x0', str(root / 'full.bin')]
    return subprocess.call(command)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, ImportError) as error:
        print('STOP:', error, file=sys.stderr)
        sys.exit(1)
