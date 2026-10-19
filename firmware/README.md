[简体中文](README.zh_CN.md)

# Pop-up City firmware integration

Partitioning, persistence and flashing now follow the specified Starter repository’s herstory-event-v1 contract: [unified preservation policy](persistence-policy.md). The old planet-preview layout is no longer the partition baseline.

This directory now has a product integration project and native app_main, in addition to the platform-independent core. It is **not a complete release or accepted device firmware**. The reference hardware source is `folotoy_herstory/folotoy`; its active planet-preview entry still builds a display diagnostic. No external source files, partitions, identities or device data were changed.

`components/pop_city_core` implements startup/navigation priority, authoritative-operation recovery, button action selection, long/short mutual exclusion and a persistent feedback-consumption boundary. Its ESP-IDF component registration is provided for integration; the [personal-storage adapter](storage.md) is implemented and host-tested; the native entry and network worker now compile, while complete UI and business wiring remain pending.

Run `sh firmware/tools/validate.sh` from the repository root. It compiles the actual C sources with strict warnings, AddressSanitizer and UndefinedBehaviorSanitizer, then runs 88 core assertions, 1603 storage assertions and upstream source-contract validation; macOS also runs 83 [cloud/startup assertions](startup-integration.md), plus BLUFI input and Wi-Fi scan-model checks. This is a host test, not an ESP32 build or physical-device test.

Integration requirements:

- A single application worker owns the state and performs storage/network work. Button callbacks only queue events; only authenticated server facts/receipts may update operation outcomes.
- Initialize `pc_state` with the persisted Hello flag and previous binding status. `PC_BOUND` waits for OK after a new binding; an already-bound boot follows Hello/planet history. Persist the Hello flag before `pc_hello_saved(true)`.
- Store operation IDs before issuing a request. Network timeout leaves `unresolved` true; query the same ID. `pc_operation_started` and result callbacks require adapter validation. The core does not create network requests or enforce proximity itself.
- Use raw down/up events with `key_policy`, or adapt existing BSP CLICK/LONG callbacks once; do not pass events through both paths. The current long threshold is 500ms, matching the reference BSP. Block held keys across page changes. Member selection returns an action without a loading transition.
- The feedback structure must be zero-initialized or restored from persistent storage. `pc_feedback_open` takes a server-confirmed session UUID and synchronous durable-save callback. Save failure stops feedback; a repeated session retains its cursor. Only a fresh server-confirmed UUID may replace a session. All callers must verify signature, recipient, session and calibrated server time first.
- `PC_FEEDBACK_PULSE_ACK` authorizes a 1000ms effect after the cursor was durably saved. `ACK_ONLY` never pulses. Disconnect invalidates delivery. Save before pulse favors avoiding repeats over replay after a power loss between persistence and rendering.
- One renderer handles local receipts and cloud feedback together; do not independently pulse for both. HTTP payloads, UUIDs and pending-operation persistence remain adapter responsibilities. The core is not a substitute for complete protocol validation.
- Display/LVGL access follows BSP locking. Network operations must not block animation or button handling. POWER is hardware-only; ordinary-page help now uses long OK (500ms), preserving short OK. Onboarding and busy/animation restrictions remain.

Build: NOT RUN. Host tests: PASS (79 assertions). Device tests: NOT RUN.
An isolated ESP-IDF 5.5.3 environment now passes the core/storage target build; see [component build record](build-check.md). The complete product build remains pending. Never deliver the check harness as product firmware.

## Native integration build (2026-10-19)

The root project now compiles the unmodified reference BSP display/button drivers, network worker and an initial UI entry. 155 approved PNG screens plus 168 welcome animation frames are compiled into 2,068,528 bytes of lossless RGB565 runs; the renderer uses a 4,800-byte DMA strip and waits for completion before reuse. Source-pixel tests pass for every screen. The current entry is incomplete: it has initial onboarding/name/Hello scaffolding; remaining animations, complete palette mapping, planet retrieval, business actions and factory provisioning are not yet connected. Do not treat placeholder/static scaffolding as approved final UI. product-readiness.json remains false and portable packaging refuses it.

ESP32-C3 integration Build: PASS, application 3,457,216 bytes, merged 3,522,752 bytes, protected-range contract PASS. Host tests: 90 core + 1603 storage + 104 cloud/startup, 9 portable-package tests and 323 screen-pixel checks PASS. Device tests: NOT RUN. Windows/Linux USB execution: NOT RUN. Portable flashing tools are under portable/ and require Python, not ESP-IDF; first dependency installation requires internet.
