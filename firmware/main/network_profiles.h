#pragma once
#include <stdbool.h>
#include <stdint.h>
#define NETWORK_PROFILE_COUNT 5u
typedef struct { char ssid[33]; char password[65]; } network_profile_t;
typedef struct { uint32_t version, count; network_profile_t profiles[NETWORK_PROFILE_COUNT]; } network_profiles_t;
bool network_profile_valid(const network_profile_t *profile);
bool network_profiles_valid(const network_profiles_t *profiles);
/* Called only after DHCP success; preserve a second known working network. */
bool network_profiles_promote(network_profiles_t *profiles, const network_profile_t *connected);
bool network_elapsed(uint32_t now, uint32_t since, uint32_t duration);
