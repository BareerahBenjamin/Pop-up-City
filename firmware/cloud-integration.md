[简体中文](cloud-integration.zh_CN.md)

# Cloud communication module

main/cloud_protocol.c connects runtime facts, durable batch create/query/retry, single/friend receipt recovery and feedback sessions/polling/ACK. main/cloud_idf.c supplies ESP-IDF HTTPS, CA bundle and HMAC. Product worker scheduling, Wi-Fi/BLE provisioning and display integration remain pending.

Responses are verified over the original payload string with HMAC-SHA256 and recipient_device_id. The HMAC key is SHA256(raw Bearer token), matching backend token_hash bytes. Protocol, identity, IDs, batch counts and notification fields are checked after verification. HTTP/transport errors retain business state and do not prove attendance failure.

The HTTPS adapter disables redirects, uses a certificate bundle, caps responses at 16 KiB and adjusts each blocking timeout to the remaining 10-second budget. Incomplete/oversized/invalid responses fail closed; credentials and bodies are not logged.

## Persistence and state

- Runtime synchronizes server time and pc_facts, including host conflicts. HTTP failure does not imply unbinding. known_activity_id supports reconciliation.
- view=board bounds active host activities to two while preserving conflict rejection, upcoming to one and registrations to four. Truncation is explicit. Default API limits remain unchanged; truncated data is not absence of other activities.
- Batch creation persists IDs before signing/submitting. Replay uses the same ID; unresolved slots cannot be overwritten. Timeout retains the operation.
- Retry first queries the original batch and requires authoritative partial/failed plus can_retry=true, then persists retry_id before POST. New IDs require a user retry action, never an automatic timeout reaction.
- Returned verified JSON belongs to the caller. Queries do not automatically clear pending records or enter success pages. The page controller must reconcile outcomes, persist resolution and update pc_state. Partial results retain the batch for retry.
- Unknown operation results retain IDs without new submissions or false failure. Saved receipts check associated operation types and identifiers; presentation remains a controller responsibility.
- Feedback sessions are persisted after server confirmation. The entire notification array is validated before processing. Cursor persistence precedes queuing a 1000ms UI effect and ACK. Lost ACKs do not replay effects. A caller-provided monotonic clock accounts for network delay; expired responses do not animate.
- Wi-Fi loss must call pc_cloud_disconnect. Real reconnects require fresh UUID sessions; same-session retransmission only applies to the current unexpired connection.

## Remaining integration

APIs run synchronously in one network worker, never button/timer/LVGL callbacks. Pulse callbacks only queue a nonblocking UI effect. Display animation and input run independently; use BSP locks for cross-task LVGL operations.

Still pending: product worker, actual Wi-Fi/disconnect wiring, provisioning/binding, BLE proximity/single/friend submission, roster pagination client, approved screen rendering, result controllers and target RAM/stack acceptance. The 16 KiB cap/compact view are not whole-device memory validation. TLS system time, real certificate connections and Wi-Fi/BLE coexistence remain device checks. popcity is still a local development ID pending uniqueness confirmation. No deployment/flashing/physical save update occurred.

## Validation

Node's actual API and isolated database generate signed runtime, queued/partial/retry batch, feedback/ACK and unknown-operation vectors. The C client independently uses macOS CommonCrypto to verify Node responses and compare outgoing proofs. All 38 assertions pass, covering invalid signatures, validly signed wrong recipients/schemas, oversized responses, save failures, timeout recovery, late feedback and repeated ACKs.

The host cJSON copy comes unchanged from ESP-IDF 5.5.3 with its MIT license. Apple's sprintf deprecation suppression is scoped to that third-party object; product code remains strict. Other platforms explicitly skip the CommonCrypto test.

The 79 core and 1603 storage assertions pass; all 128 backend tests pass. ESP32-C3 / ESP-IDF 5.5.3 communication component compile/link and unchanged upstream image-layout checks pass. This remains a component harness. Complete product Build, complete product gate and Device tests (including cross-app preservation) are NOT RUN.
