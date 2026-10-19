[简体中文](README.zh_CN.md)

# Flashing from another computer

This directory is a tool template, not a flashable release. Only use a complete product ZIP containing its verified manifest, merged image and matching artifacts. Never substitute a component-check image.

ESP-IDF is not required. Install Python 3.9+ and use a USB data cable. Extract every ZIP member into the same directory. Initial dependency installation requires internet; flashing afterwards does not.

Windows: run `powershell -ExecutionPolicy Bypass -File .\setup.ps1` in the extracted directory. This changes policy only for that process. Run `.\.venv\Scripts\python.exe flash.py --list`, then `.\.venv\Scripts\python.exe flash.py --port COM4` with the actual port. Setup uses `py -3`, or `python` when the launcher is unavailable, and rejects Python versions below 3.9. Install Python and reopen the terminal if neither command works.

macOS/Linux: run `sh setup.sh`, then `.venv/bin/python flash.py --list` and `.venv/bin/python flash.py --port ACTUAL_PORT`. macOS commonly uses `/dev/cu.usbmodem...`; Linux commonly uses `/dev/ttyACM0`. Follow OS serial-access rules for permission errors rather than making the port world-writable. Close serial monitors before writing.

Listing ports does not reset devices. `--verify` validates files without USB access. Specifying `--port` resets and writes the selected board; select it carefully.

The script writes the merged image at 0x0, validates hashes, ESP32-C3/8MB headers, the application descriptor against the matching ELF, merged segments and empty gaps, partition entries and MD5, and limits writes/sector erasure below 0x690000. It exposes no whole-chip erase operation. Ordinary system NVS may reset; personal saves must reside in the fixed event_save partition. Legacy layouts require a separate compatibility/migration decision.

A successful write is not device acceptance. Verify display/input, networking/binding, two-board friendship, attendance, reconnect recovery and repeated-flash save preservation. Device provisioning credentials are unique and must not be cloned; the firmware ZIP must not contain personal device tokens.

Validation logic has macOS host coverage. Windows/Linux execution and actual USB flashing remain unverified. Keep matching ELF/MAP files for diagnosis; do not publicly distribute debugging files without checking embedded configuration.

For a new empty board, run `.venv/bin/python initialize.py --port PORT --event-profile PRIVATE_EVENT.json --identity-file PRIVATE_BOARD.json` after flashing (Windows: `.venv\Scripts\python.exe`). The private event profile uses `{origin,enrollment_key}` and must stay outside the public ZIP. The generated identity file is tied to the physical board; cross-board reuse is refused. Keep it for retries on that same board. Already initialized boards do not need this step. Running the tool registers one board on the website and saves its unique identity after physical-board confirmation.

Version 0.2.0-rc2 is a first-device-acceptance candidate, not a stable release; hardware tests have not run. The local app ID is `popcity`; organizer uniqueness remains a public-release prerequisite. Before registering an empty board, an administrator must set `DEVICE_ENROLLMENT_KEY` to 64 lowercase hexadecimal characters in the server environment and restart the website. The private event profile must use the same origin/key; otherwise registration returns `403 ENROLLMENT_DISABLED`. Deploy website kit r4 first. Never include private event profiles or per-board identities in the public firmware ZIP.
