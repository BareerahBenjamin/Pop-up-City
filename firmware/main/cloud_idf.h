#pragma once
#include "cloud_protocol.h"
/* Bind only to the application's serialized networking worker, after Wi-Fi is connected. */
void pc_cloud_bind_idf(pc_cloud *,pc_store *,pc_state *);

typedef enum {PC_TRANSPORT_NONE,PC_TRANSPORT_DNS,PC_TRANSPORT_TLS,
 PC_TRANSPORT_TIMEOUT,PC_TRANSPORT_MEMORY,PC_TRANSPORT_IO} pc_transport_error;
pc_transport_error pc_cloud_transport_last_error(void);

/* Serialized worker only. One retained TLS client during active friendship. */
void pc_cloud_transport_reuse(bool enabled);
