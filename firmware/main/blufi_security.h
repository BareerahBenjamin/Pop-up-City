#pragma once

#include <stdbool.h>
#include <stdint.h>

void passport_blufi_negotiate(uint8_t *data, int len, uint8_t **output_data,
                          int *output_len, bool *need_free);
int passport_blufi_encrypt(uint8_t iv8, uint8_t *data, int len);
int passport_blufi_decrypt(uint8_t iv8, uint8_t *data, int len);
uint16_t passport_blufi_checksum(uint8_t iv8, uint8_t *data, int len);
int passport_blufi_security_init(void);
void passport_blufi_security_deinit(void);

bool passport_blufi_security_ready(void);

bool passport_blufi_security_prepare(void);
