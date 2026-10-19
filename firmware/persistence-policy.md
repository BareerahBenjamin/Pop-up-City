[简体中文](persistence-policy.zh_CN.md)

# Unified partition, save and flashing requirements

Source: [Herstory Starter Repo](https://github.com/Jiajia-Chen/herstory-ai-passport-starter/tree/f8798a349fd70715c0d62f4a84d1a6b148d99441), pinned commit f8798a349fd70715c0d62f4a84d1a6b148d99441, frozen contract herstory-event-v1. partitions.csv and event-contract.json were copied unchanged; starter-reference.json records hashes. This supersedes the old planet-preview layout; no separate voice_notes partition remains.

| Partition | Offset | Size | Replacement policy |
| --- | --- | --- | --- |
| nvs | 0x9000 | 0x6000 (24 KiB) | System configuration; merged flashing may overwrite it; no essential personal saves |
| phy_init | 0xF000 | 0x1000 (4 KiB) | Radio configuration; may be refreshed |
| factory | 0x10000 | 0x680000 (6.5 MiB) | Application and static assets; replaced on app switching |
| event_save | 0x690000 | 0x170000 (1.4375 MiB) | Dedicated personal-save NVS through the 8 MiB boundary; never included in normal flashing |

All compatible applications must use the identical frozen table. Generic minimal-layout documentation does not override the event contract, actual CSV or event-persistence documentation.

## Save requirements

Use only event_storage and the organizer-assigned app_id namespace. The local development ID is popcity, pending organizer assignment/uniqueness confirmation for release; do not ship the app_a template identity. Keep the manifest/header ID consistent and stable across releases. Never modify another application's namespace or invent shared storage access.

The default quota is 2048 serialized bytes per application, not the entire shared 1.4375 MiB pool. Measure record size and leave space for NVS overhead. Extend the example record model: its two example value fields alone do not meet product requirements.

The product record must cover binding identity/necessary credentials, retained Wi-Fi profiles, Hello dismissal, unresolved friendship/single/batch/retry IDs, feedback session/consumption cursor and essential presentation state/versions. The backend remains authoritative for full rosters, checkins and receipt history. Refetch them after reconnecting.

Do not store name bitmaps, complete planet frames, animations, images, audio, recordings or other large assets in event_save. Static assets belong in the application area; downloadable caches are not personal saves. Never embed credentials/personal records in public firmware, logs, Git or share packages.

Retain magic, schema, app_id and checksum. Corrupt/foreign/unknown future-schema records must remain untouched and be reported, not overwritten with defaults. Migrate known older versions explicitly; commit only successful migrations. Downgrades must not overwrite an unsupported newer record. Initialization/write errors never trigger automatic save-partition erasure. Failed durable writes must prevent Hello dismissal, submission of unpersisted operation IDs and unpersisted feedback playback. The record/storage adapter and example migration are implemented and tested against an NVS host substitute (see storage.md); application wiring and physical persistence remain unverified.

## One normal flashing workflow

Build with ESP-IDF 5.5.3, the frozen partition table and the unchanged event validator. Reject mismatched partition hashes, oversized applications and configured/image write ranges at or above 0x690000.

Deliver only the verified merged full.bin for offset 0x0. It must end strictly below 0x690000; erase-sector rounding must also stay below the aligned protected boundary. Do not use whole-chip erase, padding to 8 MiB, a bundled event_save image or automatic partition reset on boot/load errors. Normal app switching uses this single preservation profile. event_storage's internal NVS writes are normal; direct application partition erasure is forbidden.

Record app_id, contract, save schema/quota, image hash, matching ELF and actual write ranges in the package. Never substitute an older binary. Existing devices with another layout require identification/export and a separately validated migration first. The former voice area 0x670000..0x68FFFF is now application space; old recordings are not automatically protected.

## Acceptance

Run the original upstream validate_event_app.py against the app identity/quota, frozen layout and final build directory, followed by the full firmware gate. Do not weaken it. Host tests must cover integrity, namespace isolation, schema migration, power/write failure, quota and rejected write ranges.

Physical acceptance is recognizable app state → compatible organizer control firmware using the same preservation flasher → original app reinstalled → exact state restored; verify other apps' saves also remain intact. Preservation applies only to compatible applications and tools following this contract.

Status: layout/requirements aligned and frozen-file hashes checked. Storage adaptation and host fault tests pass; the complete firmware build, flashing and physical cross-application restoration tests are NOT RUN. The existing 79 core host assertions do not substitute for these checks.
