English · [简体中文](hardware_cloud_setup.zh_CN.md)

# Hardware cloud connection

For the personal-board batch, use [four-digit device claims](device_claim_setup.md). The per-board token setup below is a legacy maintenance workflow; the distribution button now uses claim codes and board confirmation.

Boards use HTTPS to reach the same Node service as the website. Its SQLite database owns identities and business facts. BLE remains the proximity channel. `/local/` is a compatibility path for the existing firmware protocol, not a dependency on a local computer. Never expose the old fixture-based LAN relay publicly.

## Server rollout

Back up production SQLite, deploy this code and locked dependencies, preserve the production `.env`, pepper, SMTP, database and uploaded data, then run `npm run migrate` before restarting the existing service. Migration 0012 is additive. Do not change applied migrations or overwrite the database. `PUBLIC_ORIGIN` must match the actual HTTPS hostname; the example hostname is not evidence of a live deployment.

Proxy `/local/*` and `/api/device/*` to Node without compression as shown in the Caddy snippet. Only HTTPS needs public exposure, not the backend, LAN relay or discovery ports. Verify `/healthz` and administrator login.

Use one Node service instance: session read/modify/write is serialised within that process and persisted in SQLite. Do not enable multiple workers without additional coordination. Unfinished sessions expire after about 90 seconds; attendance, friendships and receipts remain durable. This firmware interaction flow is online; the existing final-event API still supports complete bilateral offline proofs, but no new firmware offline friendship queue is added here.

## Two user boards and one station

Enroll three independent device identities under the correct members. Tokens are displayed once. In Hardware Management configure two `user` boards with the actual RGB565 byte order and one `checkin` station. Device types are permanent. Grant the station its published activity; check-in is allowed during the hour before the activity starts and requires attendee registration. Set each user's station ID in both the website and firmware. Automatic selection only works when exactly one station is available.

Prepare each private enrollment JSON with `origin`, `device_id`, `member_id`, `token`, `role` (`user` or `checkin`) and, for users, `station_device_id`:

```sh
node scripts/hardware-profile.mjs /private/path/user1.defaults < /private/path/user1.json
```

This creates a new mode-0600 file without echoing credentials. Never commit enrollment JSON, private defaults, sdkconfig, or credential-bearing firmware/ELF files. With ESP-IDF 5.5.3, build `folotoy/firmware/checkin/planet-preview` using its base defaults followed by the private device defaults, a fresh build directory and fresh SDKCONFIG. Reusing LAN-test sdkconfig can override cloud settings. The firmware defaults to HTTPS, disables LAN discovery, allows eight seconds per HTTP operation, starts SNTP for TLS time validation and retains existing phone Wi-Fi provisioning.

## Temporary host mode

Published activities automatically enable their owner's user board during [starts_at, ends_at), without administrator grants. Any active member can be a publisher. The existing host screen, BLE discovery, signed presence, registration checks, individual confirmation and participant planet refresh are retained. OK checks in the selected nearby registered participant; hold DOWN toggles the host screen and planet. Hold OK submits up to 16 currently nearby participants in one batch. The server validates each participant and returns success, duplicate or rejection; unregistered names are never returned. Retry retains the original per-person request IDs and durable receipts, preventing duplicate attendance. Cancelled/ended activities reject new requests, while committed replays return their original receipt. Conflicting simultaneous activities for one host remain unavailable until corrected.

Chinese nicknames are rendered by Sharp using the bundled SIL OFL Noto Sans CJK SC font under assets/fonts. A signed 192x32 one-bit name strip is displayed by LVGL, avoiding a complete Chinese font on the board. Names are capped at 32 Unicode characters and fitted to the strip. Unsupported characters follow the font's missing-glyph rendering. Include the font and license in server deployments.

## Acceptance

Stop the computer backend and LAN relay. Verify each user's own planet download, station activity selection and user-confirmed attendance, mutual nearby friend confirmation, website and hardware friend lists, recovery after disconnection, duplicate submission, revoked devices and expired activities. Verify host authorization separately. Friend figures are out of scope. Passing source tests does not establish production rollout or physical acceptance. Do not flash an empty generic validation image as a provisioned production device.
