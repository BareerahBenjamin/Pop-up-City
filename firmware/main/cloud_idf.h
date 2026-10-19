#pragma once
#include "cloud_protocol.h"
/* Bind only to the application's serialized networking worker, after Wi-Fi is connected. */
void pc_cloud_bind_idf(pc_cloud *,pc_store *,pc_state *);
