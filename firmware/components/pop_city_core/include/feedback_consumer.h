#pragma once
#include <stdbool.h>
#include <stdint.h>
/* Transport must validate signature and recipient before this API. Single worker owns it. */
typedef struct { char session_id[37]; uint64_t consumed; } pc_feedback_cursor;
typedef bool (*pc_cursor_save)(const pc_feedback_cursor *,void *);
typedef struct { pc_feedback_cursor cursor; bool active; pc_cursor_save save; void *context; } pc_feedback;
typedef enum { PC_FEEDBACK_DROP, PC_FEEDBACK_ACK_ONLY, PC_FEEDBACK_PULSE_ACK, PC_FEEDBACK_STORAGE_FAILED } pc_feedback_action;
/* Server-confirmed fresh session. Persistence failure prevents all feedback. */
bool pc_feedback_open(pc_feedback *f,const char *session,pc_cursor_save save,void *context);
void pc_feedback_disconnect(pc_feedback *f);
pc_feedback_action pc_feedback_consume(pc_feedback *f,const char *session,uint64_t id,
 uint64_t expires_at,uint64_t server_now,bool activity_valid);
