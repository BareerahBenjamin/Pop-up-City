#pragma once
#include "cloud_protocol.h"
/* Empty identities only; never replaces an account, pending journal or existing identity. */
pc_cloud_result pc_identity_apply(pc_store *,const char *json,const char *nonce,const char *board_uid);
esp_err_t pc_identity_wait_usb(pc_store *);
