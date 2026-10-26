#pragma once
#include "network_profiles.h"
#include <stddef.h>
typedef struct {network_profile_t profile;bool ssid_valid,password_valid;} blufi_input_t;
void blufi_input_reset(blufi_input_t *input);
bool blufi_input_ssid(blufi_input_t *input,const void *data,size_t length);
bool blufi_input_password(blufi_input_t *input,const void *data,size_t length);
bool blufi_input_ready(const blufi_input_t *input);

/* IDF 5.5.3 wire header guard; credentials must be encrypted after key negotiation. */
bool blufi_packet_allowed(const uint8_t *packet,size_t length,bool security_ready);

bool blufi_fragment_allowed(const uint8_t *decoded_packet,size_t length);
