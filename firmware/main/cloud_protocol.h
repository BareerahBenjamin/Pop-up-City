#pragma once
#include "personal_store.h"
#include "pop_city.h"
#include "cJSON.h"
#include "personal_visual.h"
#define PC_CLOUD_RESPONSE_BYTES 16384u
typedef enum {PC_CLOUD_OK,PC_CLOUD_INVALID,PC_CLOUD_TRANSPORT,PC_CLOUD_HTTP,
 PC_CLOUD_STORAGE,PC_CLOUD_BUSY} pc_cloud_result;
typedef bool (*pc_cloud_sign_fn)(void *,const char *,char[65]);
/* Bounded, complete response, NUL terminated; all credentials stay in adapter context. */
typedef bool (*pc_cloud_transport_fn)(void *,bool,const char *,const char *,char *,size_t,int *);
typedef void (*pc_cloud_pulse_fn)(void *,unsigned);
typedef struct {
 pc_store *store;pc_state *state;pc_feedback feedback;pc_personal_visual personal;
 pc_cloud_sign_fn sign;void *sign_context;
 pc_cloud_transport_fn transport;void *transport_context;
 char active_activity_id[37],known_activity_id[37];bool known_activity_closed;
 uint8_t active_title_bitmap[768];bool active_title_valid;
 uint64_t server_time;uint32_t server_ms;bool clock_known;
 uint32_t (*monotonic_ms)(void *);void *clock_context;
 int http_status;
} pc_cloud;
void pc_cloud_init(pc_cloud *,pc_store *,pc_state *,pc_cloud_sign_fn,void *,pc_cloud_transport_fn,void *);
bool pc_cloud_uuid(const char *);
bool pc_cloud_origin_valid(const char *);
/* Validate exact signed monochrome strip before replacing destination. */
bool pc_cloud_decode_bitmap(const cJSON *,const char *,uint8_t *,size_t);
pc_cloud_result pc_cloud_runtime(pc_cloud *,uint32_t,const char *known_activity);
/* Successful responses are verified JSON objects owned by caller; pending records stay until reconciled. */
pc_cloud_result pc_cloud_batch_start(pc_cloud *,unsigned,const char *,const char *,cJSON **);
pc_cloud_result pc_cloud_batch_query(pc_cloud *,unsigned,cJSON **);
pc_cloud_result pc_cloud_batch_retry(pc_cloud *,unsigned,const char *,cJSON **);
pc_cloud_result pc_cloud_operation_query(pc_cloud *,unsigned,cJSON **);
pc_cloud_result pc_cloud_feedback_open(pc_cloud *,const char *);
/* Serial worker only. Pulse callback must queue a nonblocking UI effect, never sleep. */
pc_cloud_result pc_cloud_feedback_poll(pc_cloud *,uint32_t,pc_cloud_pulse_fn,void *);
void pc_cloud_disconnect(pc_cloud *,uint32_t);
/* Startup queries are valid before member binding; never bypass device authentication. */
pc_cloud_result pc_cloud_enrollment_status(pc_cloud *,cJSON **);
pc_cloud_result pc_cloud_enrollment_confirm(pc_cloud *,const char *request_id,bool accept,cJSON **);

#define PC_ROSTER_PAGE_SIZE 6u
typedef struct {char member_id[37],name[129];uint8_t name_bitmap[384];bool name_bitmap_valid,signed_in;} pc_roster_member;
typedef struct {
 char activity_id[37],title[257],version[65];
 uint8_t title_bitmap[768];bool title_bitmap_valid;
 uint32_t total,checked_count,offset,count;bool has_more;
 pc_roster_member members[PC_ROSTER_PAGE_SIZE];
} pc_roster_page;
/* Bounded page; output is replaced only after complete authenticated validation. */
pc_cloud_result pc_cloud_roster(pc_cloud *,const char *activity,uint32_t offset,pc_roster_page *);
