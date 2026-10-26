# Wi-Fi first-page integration

[Detailed audit, state table, API contract, configuration and acceptance plan (Chinese)](wifi-first-page.zh-CN.md).

Scope: device/phone BLUFI provisioning through authenticated website handoff only. No UI asset changes, cloud provisioning endpoint, deployment or flashing. Preserve herstory-event-v1, popcity's own event_save namespace and the 2 KiB quota. Phone entry is the FoloToy provisioning mini program; the user confirmed both expected BLE names, not yet security/scan/connect acceptance. Host tests and builds are distinct from physical and cross-program persistence acceptance.
