#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#define EVENT_SAVE_MAGIC 0x45565431u
#define EVENT_SAVE_SCHEMA_VERSION 3u
#define EVENT_SAVE_APP_ID_SIZE 16u
#define PC_WIFI_PROFILES 5
#define PC_PENDING_OPERATIONS 3
/* Fixed little-endian wire envelope: no native struct layout is serialized. */
#define PC_RECORD_BYTES 1536u
typedef struct { uint8_t bytes[PC_RECORD_BYTES]; } event_save_record_t;
typedef struct { char ssid[33],password[65]; } pc_wifi_profile;
typedef enum { PC_PENDING_NONE,PC_PENDING_FRIEND,PC_PENDING_SINGLE,PC_PENDING_BATCH } pc_pending_kind;
typedef struct {
 uint8_t kind;char operation_id[37],activity_id[37],retry_id[37];
 char peer_device_id[37];uint64_t occurred_at;
 union {struct {char nonce[33],code[5];} pairing;struct {uint32_t epoch;char tag[13];} single;} detail;
} pc_pending_operation;
typedef struct {
 bool hello_skipped;
 char device_id[37],member_id[37],device_token[65],server_origin[193];
 uint8_t wifi_count;pc_wifi_profile wifi[PC_WIFI_PROFILES];
 pc_pending_operation pending[PC_PENDING_OPERATIONS];
 char feedback_session[37];uint64_t feedback_consumed;
 uint8_t palette;uint32_t planet_revision;
 /* Preserve example v1 counters without interpreting them as product state. */
 uint32_t legacy_primary,legacy_secondary,legacy_launches;
} pc_personal_data;
bool pc_app_id_valid(const char *id);
bool pc_personal_valid(const pc_personal_data *data);
bool pc_record_encode(const char *app_id,const pc_personal_data *data,event_save_record_t *out);
/* Accepts schemas 2/3 and verified 32-byte Starter schema 1, without touching storage. */
bool pc_record_decode(const void *bytes,size_t size,const char *app_id,pc_personal_data *out,bool *migrated);
bool event_save_record_valid(const event_save_record_t *record,const char *app_id);
