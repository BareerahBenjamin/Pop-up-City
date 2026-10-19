// SPDX-FileCopyrightText: 2021-2025 Espressif Systems (Shanghai) CO LTD
// SPDX-License-Identifier: Unlicense OR CC0-1.0
// Adapted from the ESP-IDF 5.5 BLUFI security example.
#include "blufi_security.h"

#include "esp_blufi_api.h"
#include "esp_crc.h"
#include "esp_log.h"
#include "esp_random.h"
#include "mbedtls/aes.h"
#include "mbedtls/dhm.h"
#include "mbedtls/md5.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include <stdlib.h>
#include <string.h>

static const char *TAG = "blufi_security";

#define SEC_TYPE_DH_PARAM_LEN  0x00
#define SEC_TYPE_DH_PARAM_DATA 0x01
#define DH_KEY_LEN              128
#define DH_PARAM_LEN_MAX        1024
#define PSK_LEN                 16

typedef struct {
    uint8_t public_key[DH_KEY_LEN];
    uint8_t shared_key[DH_KEY_LEN];
    size_t shared_len;
    uint8_t psk[PSK_LEN];
    uint8_t *dh_param;
    int dh_param_len;
    uint8_t iv[16];
    mbedtls_dhm_context dhm;
    mbedtls_aes_context aes;
} blufi_security_t;

static blufi_security_t *s_security;
static bool s_ready;
static SemaphoreHandle_t security_lock;

extern void btc_blufi_report_error(esp_blufi_error_state_t state);

static int random_bytes(void *state, unsigned char *output, size_t len)
{
    (void)state;
    esp_fill_random(output, len);
    return 0;
}

static void negotiate_locked(uint8_t *data, int len, uint8_t **output_data,
                          int *output_len, bool *need_free)
{
    if (!output_data || !output_len || !need_free) return;
    *output_data=NULL; *output_len=0; *need_free=false;
    if (!data || len < 3) {
        btc_blufi_report_error(ESP_BLUFI_DATA_FORMAT_ERROR);
        return;
    }
    if (!s_security) {
        btc_blufi_report_error(ESP_BLUFI_INIT_SECURITY_ERROR);
        return;
    }

    if (data[0] == SEC_TYPE_DH_PARAM_LEN) {
        int param_len = (data[1] << 8) | data[2];
        if (param_len <= 0 || param_len > DH_PARAM_LEN_MAX) {
            btc_blufi_report_error(ESP_BLUFI_DH_PARAM_ERROR);
            return;
        }
        free(s_security->dh_param);
        s_security->dh_param = malloc(param_len);
        if (!s_security->dh_param) {
            s_security->dh_param_len = 0;
            btc_blufi_report_error(ESP_BLUFI_DH_MALLOC_ERROR);
            return;
        }
        s_security->dh_param_len = param_len;
        return;
    }

    if (data[0] != SEC_TYPE_DH_PARAM_DATA || !s_security->dh_param ||
        len < s_security->dh_param_len + 1) {
        btc_blufi_report_error(ESP_BLUFI_DH_PARAM_ERROR);
        return;
    }

    memcpy(s_security->dh_param, data + 1, s_security->dh_param_len);
    uint8_t *param = s_security->dh_param;
    int rc = mbedtls_dhm_read_params(&s_security->dhm, &param,
                                     param + s_security->dh_param_len);
    free(s_security->dh_param);
    s_security->dh_param = NULL;
    if (rc != 0) {
        ESP_LOGE(TAG, "read DH parameters failed: %d", rc);
        btc_blufi_report_error(ESP_BLUFI_READ_PARAM_ERROR);
        return;
    }

    int dh_len = (int)mbedtls_dhm_get_len(&s_security->dhm);
    if (dh_len <= 0 || dh_len > DH_KEY_LEN) {
        btc_blufi_report_error(ESP_BLUFI_DH_PARAM_ERROR);
        return;
    }
    rc = mbedtls_dhm_make_public(&s_security->dhm, dh_len,
                                 s_security->public_key, DH_KEY_LEN,
                                 random_bytes, NULL);
    if (rc == 0) {
        rc = mbedtls_dhm_calc_secret(&s_security->dhm, s_security->shared_key,
                                     DH_KEY_LEN, &s_security->shared_len,
                                     random_bytes, NULL);
    }
    if (rc != 0) {
        ESP_LOGE(TAG, "DH key generation failed: %d", rc);
        btc_blufi_report_error(ESP_BLUFI_DH_PARAM_ERROR);
        return;
    }
    rc = mbedtls_md5(s_security->shared_key, s_security->shared_len,
                     s_security->psk);
    if (rc != 0) {
        btc_blufi_report_error(ESP_BLUFI_CALC_MD5_ERROR);
        return;
    }
    rc = mbedtls_aes_setkey_enc(&s_security->aes, s_security->psk,
                                PSK_LEN * 8);
    if (rc != 0) {
        btc_blufi_report_error(ESP_BLUFI_INIT_SECURITY_ERROR);
        return;
    }

    s_ready=true;
    *output_data = s_security->public_key;
    *output_len = dh_len;
    *need_free = false;
}

static int crypt(bool encrypt, uint8_t iv8, uint8_t *data, int len)
{
    if (!s_security || !s_ready || !data || len < 0 || len > 512) return -1;
    size_t offset = 0;
    uint8_t iv[16];
    memcpy(iv, s_security->iv, sizeof(iv));
    iv[0] = iv8;
    int mode = encrypt ? MBEDTLS_AES_ENCRYPT : MBEDTLS_AES_DECRYPT;
    return mbedtls_aes_crypt_cfb128(&s_security->aes, mode, len, &offset,
                                    iv, data, data) == 0 ? len : -1;
}

static int encrypt_locked(uint8_t iv8, uint8_t *data, int len)
{
    return crypt(true, iv8, data, len);
}

static int decrypt_locked(uint8_t iv8, uint8_t *data, int len)
{
    return crypt(false, iv8, data, len);
}

uint16_t passport_blufi_checksum(uint8_t iv8, uint8_t *data, int len)
{
    (void)iv8;
    if (!data || len < 0 || len > 1024) return 0;
    return esp_crc16_be(0, data, len);
}

static void deinit_locked(void);
static int init_locked(void)
{
    deinit_locked();
    s_security = calloc(1, sizeof(*s_security));
    if (!s_security) return -1;
    mbedtls_dhm_init(&s_security->dhm);
    mbedtls_aes_init(&s_security->aes);
    return 0;
}

static void deinit_locked(void)
{
    s_ready=false;
    if (!s_security) return;
    free(s_security->dh_param);
    mbedtls_dhm_free(&s_security->dhm);
    mbedtls_aes_free(&s_security->aes);
    memset(s_security, 0, sizeof(*s_security));
    free(s_security);
    s_security = NULL;
}

/* RX/decrypt runs on NimBLE; lifecycle and TX run on BTC. Serialize the
 * context so phone disconnect cannot free an in-flight crypto operation. */
bool passport_blufi_security_prepare(void)
{
    if(!security_lock)security_lock=xSemaphoreCreateMutex();
    return security_lock!=NULL;
}
void passport_blufi_negotiate(uint8_t *data,int len,uint8_t **out,int *length,bool *release)
{
    if(!security_lock){if(out)*out=NULL;if(length)*length=0;if(release)*release=false;return;}
    xSemaphoreTake(security_lock,portMAX_DELAY);
    negotiate_locked(data,len,out,length,release);
    xSemaphoreGive(security_lock);
}
int passport_blufi_encrypt(uint8_t iv,uint8_t *data,int len)
{
    if(!security_lock)return -1;
    xSemaphoreTake(security_lock,portMAX_DELAY);int result=encrypt_locked(iv,data,len);
    xSemaphoreGive(security_lock);return result;
}
int passport_blufi_decrypt(uint8_t iv,uint8_t *data,int len)
{
    if(!security_lock)return -1;
    xSemaphoreTake(security_lock,portMAX_DELAY);int result=decrypt_locked(iv,data,len);
    xSemaphoreGive(security_lock);return result;
}
int passport_blufi_security_init(void)
{
    if(!security_lock)return -1;
    xSemaphoreTake(security_lock,portMAX_DELAY);int result=init_locked();
    xSemaphoreGive(security_lock);return result;
}
void passport_blufi_security_deinit(void)
{
    if(!security_lock)return;
    xSemaphoreTake(security_lock,portMAX_DELAY);deinit_locked();xSemaphoreGive(security_lock);
}
bool passport_blufi_security_ready(void)
{
    if(!security_lock)return false;
    xSemaphoreTake(security_lock,portMAX_DELAY);bool result=s_ready;
    xSemaphoreGive(security_lock);return result;
}
