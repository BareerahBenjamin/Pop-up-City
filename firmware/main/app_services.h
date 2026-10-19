#pragma once
#include "personal_store.h"
#include "network_profiles.h"
/* Application worker only; must bind after loading popcity's protected record. */
void app_services_bind(pc_store *store);
bool app_save_networks(const network_profiles_t *profiles);
bool app_load_networks(network_profiles_t *profiles);
