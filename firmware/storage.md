[简体中文](storage.zh_CN.md)

# Personal save implementation

The local development ID is popcity. Organizer assignment/uniqueness still requires confirmation before release. event-app.json and event_app_identity.h match; the app_a template ID is not used.

## Record and quota

main/event_save_model implements a fixed 1536-byte little-endian wire format, independent of native C structure padding. The quota is 2048 bytes; the remaining 512 bytes are not a media allocation.

Records contain magic, schema=2, a 16-byte app_id field, product fields and FNV-1a checksum. The checksum detects accidental corruption; it is not encryption or authentication. Fields cover Hello dismissal, device/member identity and token, server origin, five Wi-Fi profiles, three unresolved operation/activity/retry IDs, feedback session/high-water mark, palette and planet revision.

Validation checks UUIDs, token length, terminated strings, counts, operation types and duplicate operation IDs. Encoding clears reserved space and excludes structure padding and stale bytes after string terminators.

## Storage and ordering

main/event_storage initializes only event_save, opens this application's namespace via nvs_open_from_partition and uses the existing record key with NVS commit. It never erases the partition, rejects foreign application identity and does not overwrite records on errors.

main/personal_store uses event_storage as its only persistence boundary. Only genuine NOT_FOUND initializes a new empty save. Corrupt/unknown records, initialization and other read errors disable writes. In-memory state advances only after successful persistence.

- Persist Hello dismissal before pc_hello_saved(true).
- Persist operation IDs with pc_store_pending_begin before friendship/single/batch submission. Unresolved slots and IDs cannot be silently replaced.
- After verifying an authoritative retryable batch result, persist the retry ID with pc_store_pending_retry before POST. Reconcile timeouts using the original IDs.
- Clear pending records only after validating an authoritative matching result. Failed persistence retains the unresolved item.
- Bind feedback consumers to pc_store_feedback_save: durable cursor first, pulse authorization second. Restored duplicate notifications only ACK.

The adapters are implemented; their application-loop/network/UI wiring remains pending. Run storage in a worker, never button/timer callbacks. Target stack/RAM budgets still need an ESP32 build and device tests.

## Migration

Validated same-app 32-byte Starter schema=1 records can be read. Their primary/secondary/launches values are preserved as schema=2 legacy fields, never interpreted as product state. Reading does not rewrite the old record; a subsequent explicit successful save upgrades it.

Unknown future versions, corrupt and foreign records are rejected and preserved; no destructive downgrade occurs. Other historic product formats are outside this example migration and require separate identification.

## Validation

sh firmware/tools/validate.sh passes 79 core assertions and 1603 storage assertions, including 1536 single-byte corruption checks. Other checks cover maximum Wi-Fi strings, namespace isolation, unresolved operations/retry IDs, durable feedback deduplication, storage/init/read/commit faults and version migration.

Tests compile the real adapters against an NVS host substitute, not a physical board. Fault injection is not an actual power-cut test. The unchanged upstream validate_event_app.py passes source-contract validation. No final build directory exists, so final image-range validation is NOT RUN.

Build: NOT RUN. Host tests: PASS. Device tests: NOT RUN.
Unverified: ESP-IDF build, real NVS/power loss, final flasher ranges and physical A→control B→A save restoration. No physical device, production data or partition was changed.
