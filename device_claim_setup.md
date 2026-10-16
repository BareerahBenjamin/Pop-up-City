English · [简体中文](device_claim_setup.zh_CN.md)

# Four-digit device claims

For about 100 personal boards, use one firmware image and the existing Members → Bind device action. The browser no longer displays long-term device tokens.

## Distribution

An unbound board creates an independent random UUID and 256-bit token in its own NVS namespace, connects to the server and displays a unique four-digit claim code. Codes include leading zeroes, expire after five minutes and are unique among all currently valid codes. The administrator chooses the member and enters the code. This only requests binding. The board displays a masked ASCII email hint and the code; the holder presses OK to accept or holds OK to reject. Button events from before the current request was displayed cannot accept it. Successful confirmation atomically establishes ownership, persists the member identity on the board and loads its planet. The page polls for the result. Reboots and Wi-Fi changes retain ownership.

New claims allow one active board per member. For replacement, verify and revoke the previous board first. Binding never silently transfers ownership. A recycling/transfer workflow is not introduced. The legacy technical token-issuance API remains available for maintenance, but the distribution button no longer invokes it.

## Batch preparation

Back up production SQLite, deploy and apply migrations 0012 and 0013 before restart. Generate a dedicated random 32-byte key encoded as 64 lowercase hex characters. Set `DEVICE_ENROLLMENT_KEY` on the server; never reuse `AUTH_PEPPER`. Empty means new initialization is disabled; already registered boards can still claim and bind.

Prepare private JSON containing the actual HTTPS `origin` and matching `enrollment_key`, optionally `wifi_ssid` and `wifi_password`:

```sh
node scripts/hardware-batch-profile.mjs /private/path/event.defaults < /private/path/event.json
```

The helper creates a new mode-0600 file without echoing secrets. Build `planet-preview` with ESP-IDF 5.5.3 using its base defaults followed by this private profile, a fresh SDKCONFIG and a fresh build directory. Legacy per-member credentials are explicitly cleared. Flash the same application to the batch, but never clone an NVS image containing an initialized identity. Preserve NVS when updating existing boards. Do not commit or publish private JSON, defaults, or firmware containing the batch key.

The batch key only registers unclaimed inventory; it cannot read planets, claim a member or supply the board's independent confirmation. Initialization is capped at 1000 inventory identities. After initializing the batch, the server key can be cleared and the service restarted. Proxy `/api/device-enrollment/*`, `/api/device/*` and `/local/*` to the same Node instance without hardware response compression. Keep HTTPS enabled.

The board uses English and numeric claim prompts with masked ASCII email hints rather than unsupported Chinese glyphs. The combined startup page shows Wi-Fi and website binding together. Press UP for Wi-Fi setup; hold OK to reject a displayed claim. Connection and verified binding together automatically open the planet. Later offline boots try saved networks first and show only Wi-Fi setup on failure; reconnection resumes the planet without rebinding.

## Protocol and protections

`POST /api/device-enrollment/register` uses `Authorization: Enrollment <batch key>` and receives a device UUID and SHA256 token hash; raw device tokens are never stored or returned. `GET /api/device-enrollment/status` uses the board's Bearer token and returns a response signed using its derived key. `POST /api/device-enrollment/confirm` requires that same board's token, a server-generated request UUID, and accept/reject. A four-digit code alone cannot confirm ownership.

`POST /api/admin/members/:id/device-claims` uses the administrator's session and same-origin protection with `{code:"0087"}`. Five incorrect lookups per minute temporarily limit that administrator. GET with `request_id` polls; DELETE with `request_id` cancels. Only the requesting administrator may poll/cancel. Request, reject, bind and cancel are audited. Expiry, cancellation and code renewal invalidate old request IDs; completed confirmation retries are idempotent.

Disabled accounts, revoked devices and revoked administrators cannot complete a new binding. Erasing NVS does not erase server ownership and is not an unbind operation; administrators must handle recovery explicitly.

## Acceptance

Tests cover leading zeroes, 100 simultaneously valid unique codes, expiration and stale requests, wrong identities, rate limits, cancellation, rejection, replay and revocation. Physical buttons, power-cycle persistence and a real 100-board Wi-Fi environment remain device/site checks. A validation image with an empty batch key is not a production enrollment image.

## Local hardware lab

Run `node scripts/dev-hardware.mjs --lan`. Open `http://127.0.0.1:3340/__hardware-lab/login` on this computer for the isolated test administrator. Two hardware test members are also seeded. The persistent SQLite database and private configuration are stored under Git-ignored `data/hardware-lab/`. This launcher is separate from production; LAN clients cannot use its loopback-only automatic sign-in.

The launcher prints the LAN origin for boards on the same reachable Wi-Fi. Its private `data/hardware-lab/lan.defaults` configures that origin and enrollment key, allows isolated LAN HTTP and disables discovery of the legacy UDP relay. Build with fresh SDKCONFIG rather than an old local profile. Starting the website alone does not update a board's existing firmware.
