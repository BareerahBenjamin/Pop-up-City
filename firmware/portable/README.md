[简体中文](README.zh_CN.md)

# Flashing from another computer

This directory is a tool template, not a flashable release. Only use a complete product ZIP containing its verified manifest, merged image and matching artifacts. Never substitute a component-check image.

ESP-IDF is not required. Install Python 3.9+ and use a USB data cable. Extract every ZIP member into the same directory. Initial dependency installation requires internet; flashing afterwards does not.

Windows: run `powershell -ExecutionPolicy Bypass -File .\setup.ps1` in the extracted directory. This changes policy only for that process. Run `.\.venv\Scripts\python.exe flash.py --list`, then `.\.venv\Scripts\python.exe flash.py --port COM4` with the actual port. Setup uses `py -3`, or `python` when the launcher is unavailable, and rejects Python versions below 3.9. Install Python and reopen the terminal if neither command works.

macOS/Linux: run `sh setup.sh`, then `.venv/bin/python flash.py --list` and `.venv/bin/python flash.py --port ACTUAL_PORT`. macOS commonly uses `/dev/cu.usbmodem...`; Linux commonly uses `/dev/ttyACM0`. Follow OS serial-access rules for permission errors rather than making the port world-writable. Close serial monitors before writing.

Listing ports does not reset devices. `--verify` validates files without USB access. Specifying `--port` resets and writes the selected board; select it carefully.

The script writes bootloader (0x0), partition table (0x8000), and application (0x10000) as separate segments, validates hashes, ESP32-C3/8MB headers, the application descriptor against the matching ELF, merged segments and empty gaps, partition entries and MD5, and limits writes/sector erasure below 0x690000. It exposes no whole-chip erase operation. Default writes preserve ordinary NVS and event_save. Only this product's historical default-NVS identity/network records are read and committed to popcity; modern records win, corruption stops without erasure. Other apps' namespaces are never imported. full.bin is kept for matching archival verification.

A successful write is not device acceptance. Verify display/input, networking/binding, two-board friendship, attendance, reconnect recovery and repeated-flash save preservation. Device provisioning credentials are unique and must not be cloned; the firmware ZIP must not contain personal device tokens.

Validation logic has macOS host coverage. Windows/Linux execution and actual USB flashing remain unverified. Keep matching ELF/MAP files for diagnosis; do not publicly distribute debugging files without checking embedded configuration.

## First-time device initialization

`DEVICE SETUP REQUIRED` means the application is running but this board has no device identity yet. Flashing alone does not register a new board. After initialization, follow the screen to connect Wi-Fi and bind the board to a website account.

The website must expose signed enrollment, runtime, friendship and attendance APIs; this package does not deploy a website. The administrator must configure `DEVICE_ENROLLMENT_KEY` (64 lowercase hexadecimal characters) in the server environment and restart the website service. Obtain the private `popcity-event-profile.json` containing `{origin,enrollment_key}` separately from the administrator. Initialization requires internet access to that website. Do not paste the key into chat or put the profile in Git, the firmware ZIP, or a shared public folder.

For a new board, close serial monitors, then run from the extracted directory. Replace the port and private paths with your actual values.

Windows PowerShell:

```powershell
.\.venv\Scripts\python.exe initialize.py --port COM4 --event-profile "C:\private\popcity-event-profile.json" --identity-file "C:\private\board-COM4.json"
```

macOS:

```sh
.venv/bin/python initialize.py --port /dev/cu.usbmodem101 --event-profile "$HOME/private/popcity-event-profile.json" --identity-file "$HOME/private/board-101.json"
```

Linux:

```sh
.venv/bin/python initialize.py --port /dev/ttyACM0 --event-profile "$HOME/private/popcity-event-profile.json" --identity-file "$HOME/private/board-ACM0.json"
```

Use a **different identity file for each physical board**; the port-based names above are examples only. Keep a private record of the board hardware ID and its identity-file path, because port names can change. The tool registers one board on the website and writes its unique identity only after physical-board confirmation. It refuses reuse on another board. Keep the generated identity file private and use the **same file** when retrying that board after a failure; do not delete it and generate a replacement. Already initialized boards do not need this step. If the tool reports that initialization is no longer requested, do not erase the board to repeat it.

Version 0.2.0-rc19-websync is a first-device-acceptance candidate, not a stable release. The local app ID is `popcity`; organizer uniqueness remains a public-release prerequisite. Website registration failures must be resolved before retrying initialization: an unconfigured enrollment service can return `403 ENROLLMENT_DISABLED`, while an incorrect origin/key or inaccessible website also prevents registration. No private event profile or per-board identity is included in the public package.

Use the included request-bound initializer; do not mix older tools. Cross-app save switching, physical peak heap and Windows/Linux USB flashing remain unverified.
