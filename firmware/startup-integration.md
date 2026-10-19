[简体中文](startup-integration.zh_CN.md)

# Wi-Fi and startup binding integration

Reuses existing BLUFI security negotiation, scanning and Wi-Fi connection/reconnection without the demo UI. provisioning-reference.json records source hashes; licenses/FoloToy-MIT.txt preserves the license.

## Implemented

Wi-Fi runtime configuration uses RAM. Legacy ordinary-NVS storage is replaced with app_services→personal_store→event_storage, retaining five successfully connected profiles. Failed saves retain old configuration. Successful new connections promote profiles; failure keeps prior networks. Startup remains locked until connected; obsolete OK exit/cancel instructions were removed. Phone provisioning can resubmit credentials.

Legacy experimental UDP discovery was removed; cloud communication uses validated HTTPS. No placeholder signature function substitutes for authentication.

The startup controller uses actual status/confirm APIs and four-digit binding codes. Requests expose account/hint and request IDs; queued presses predating a new account cannot confirm it. A timed-out confirmation remains CHECKING and reconciles via status without automatically consenting again. The member ID must be saved before binding success is shown.

New binding waits for OK before planet. Previously bound boots follow the persistent Hello flag; dismissal requires durable storage. Repeated binding-status polls preserve active-event state.

## Task boundary

network_worker exclusively owns storage/cloud/internal state. UI sends bounded commands and receives immutable snapshots containing connectivity, flow, binding identity and feedback sequence. The 12 KiB worker stack is a development allocation, not measured acceptance. Services are permanent and do not retain display pointers.

UI input, animation and local name navigation must remain independent. Do not overwrite local name/help pages with every internal flow_page snapshot; merge facts with pc_facts priority. Implemented commands cover Hello save, binding-success continuation, current binding confirmation/rejection, network switching and polling. Only planet-origin commands may initiate network changes; entry/key timestamps are checked. Durable unresolved business operations remain unresolved until future reconciliation/result orchestration is wired, rather than being marked successful.

## Updated input decision

The user superseded the POWER-help requirement: POWER is hardware-only. Long OK (500ms) now opens/closes help on ordinary pages. Short OK retains its page function. Onboarding keeps inline guidance and long OK rejects binding; loading/processing/reconciliation/animations remain locked. No POWER GPIO interface is needed for help. The core and simulator have been updated; current four-color diagrams are in output/ok-help-review.

## Preconditions and unfinished work

The worker requires a valid device ID/token/server in protected storage. Missing credentials produce IDENTITY_REQUIRED; it does not fabricate identities or share public tokens. Factory provisioning, old-device identity migration and organizer app-ID uniqueness remain pending. System NVS errors never trigger erase.

BSP rendering, approved four-color assets, Hello/planet effects, complete product app_main, input/UI tasks, result controllers, BLE friend/proximity submission and automatic unresolved-result orchestration are not yet combined. Compilation does not prove phone-app compatibility, real TLS/time, coexistence or RAM/stack acceptance.

## Validation

Host validation passes 79 core, 1603 storage and 72 cloud/startup assertions, plus BLUFI input and Wi-Fi scan-model tests. Actual Node API responses cover waiting/pending/rejected/bound/revoked binding, lost confirmation responses, failed durable saves and stale keys. No real account/device was used.

ESP32-C3 / ESP-IDF 5.5.3 compiles/links Wi-Fi, NimBLE, BLUFI security, HTTPS and the worker. The harness retains the worker for link verification without starting wireless services. Application 1290704 bytes; merged image 1356240 bytes; unchanged upstream source/build-directory and image-range validation pass below 0x690000.

Component Build: PASS. Host tests: PASS. Complete product Build: NOT RUN. Device tests: NOT RUN. No deployment, flashing or physical save/hardware update occurred. Physical A→B→A preservation acceptance remains required.

## Signed roster integration (2026-10-19)

Runtime retains the verified active activity ID. The network worker fetches six-member roster pages, checks recipient/signature/activity, counts, unique IDs, status and pagination, and publishes an immutable bounded copy. Failed validation does not replace a valid protocol output; periodic refresh failure invalidates the worker view until refreshed. Disconnection or loss/change of host activity invalidates the view. Roster data never supplies or changes BLE nearby counts. No member-switch loading behavior is introduced.

Validation: 88 core, 1603 storage and 81 cloud/startup assertions pass. ESP32-C3 component build passes with the roster worker linked. Complete UI integration and device acceptance remain pending.

## Batch result controller and native input (2026-10-19)

The native entry now routes host long UP to durable batch creation, verified partial/failed OK to retry, result dismissal to durable journal clearing, and roster UP/DOWN to read-only pagination. Long DOWN leaves the roster, matching the approved simulator. Batch commands carry the currently displayed activity ID and an acknowledgement serial; pending UI input locks until acknowledged. The worker publishes typed counts and verified result phases; the UI replaces example counts with actual values. Ordinary help and loading now use approved themed assets.

The controller restores the persisted batch ID on boot, rejects replacing uncertainty with a new operation, queries authoritative results, preserves terminal results on an optional refresh error, and rechecks after physical reconnect. A retry POST with a lost response retains its ID across restart; replay uses that same ID and clears it only after an acknowledged response and durable commit. Known terminal batch journals are retained until explicit dismissal/retry, or verified end/activity change. The periodic worker does not repeatedly poll settled results during the same active activity.

Validation: 90 core + 1603 persistence + 104 cloud/startup assertions and 9 portable-tool tests pass; native ESP32-C3 build and merged-image partition contract pass. No board was flashed. Single proximity attendance, friend protocol/controller, personal planet/name assets, provisioning and remaining visual completion remain unfinished; product-readiness gates stay false.

BLE proximity integration: signed 30-byte beacons use calibrated server time and the existing presence contract. The worker drains sightings, preserves selected identity on departure, resolves names through signed host/nearby replies, renders the 192x32 CJK bitmap, and routes UP/DOWN without a loading transition. Nearby count comes from the independent live radio set, not selection index; it is not an authenticated attendee total. Hardware RSSI calibration and RF behavior remain unverified. Single-submit recovery is still pending. Host checks: 90 core, 1603 storage, 127 cloud/startup, 3 initializer and 9 portable tests pass; native build and partition boundary pass.
