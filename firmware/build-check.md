[简体中文](build-check.zh_CN.md)

# ESP32-C3 component build check

2026-10-19: restored an isolated ESP-IDF 5.5.3 Python environment and recommended esp-14.2.0_20251107 compiler. The local compiler archive matches the macos-arm64 SHA256 in the IDF tool manifest. System Python, shell configuration and existing broken environments were preserved.

Local temporary environment: /private/tmp/pop-city-idf-env.sh. Build: /private/tmp/pop-city-target-build. These temporary paths may be cleaned and require restoration. /private/tmp/pop-city-target-check-result.json records image and matching ELF hashes.

target-check compiles/links the real product core and event_storage/personal_store against actual ESP-IDF NVS headers/libraries. It contains no product networking, display or interaction workflow. app_main initializes local state and attempts a save read; it performs no save, network operation or automatic reset. This is not a product deliverable or replacement application.

Four target-GCC misleading-indentation errors were fixed without disabling warnings. Rebuild and host regressions pass.

- Component Build: PASS, ESP32-C3 / ESP-IDF v5.5.3.
- Host tests: PASS, 79 core and 1603 storage assertions.
- Unchanged upstream source/build-directory contract: PASS.
- Upstream verify_firmware.py partition/image validation: PASS. Application 161536 bytes; merged image 227072 bytes, before the protected boundary.
- Complete product Build and full product gate: NOT RUN.
- Device tests: NOT RUN. No serial connection, flashing or physical save write occurred.

The SDK cache lacks ROM debugging ELFs, producing a GDB-helper warning without preventing this build. Restore them before real debugging. Product BSP/LVGL/Wi-Fi/BLE integration and RAM/stack budgets remain unverified.

To reproduce, activate the temporary environment, build target-check with an isolated SDKCONFIG/build directory, run merge-bin, tools/validate_event_app.py --build-dir and upstream verify_firmware.py. The harness retains the upstream-required FoloToy-AI-Passport project name with version 0.1.0-component-check; the validator was not changed to accept other filenames. This does not replace the future complete product build or physical A→B→A restoration acceptance.
