#pragma once
#include <string.h>
/* Fixed labels only: never log query strings, identifiers or credentials. */
static inline const char *pc_diag_request(const char *path) {
 if(!strncmp(path,"/api/device-enrollment/status",sizeof("/api/device-enrollment/status")-1))return "binding_status";
 if(!strncmp(path,"/api/device-enrollment/confirm",sizeof("/api/device-enrollment/confirm")-1))return "binding_confirm";
 if(!strncmp(path,"/api/device/runtime",sizeof("/api/device/runtime")-1))return "runtime";
 if(!strncmp(path,"/api/device/feedback/session",sizeof("/api/device/feedback/session")-1))return "feedback_session";
 if(!strncmp(path,"/api/device/feedback/ack",sizeof("/api/device/feedback/ack")-1))return "feedback_ack";
 if(!strncmp(path,"/api/device/feedback",sizeof("/api/device/feedback")-1))return "feedback_poll";
 if(!strncmp(path,"/api/device/host/roster",sizeof("/api/device/host/roster")-1))return "roster";
 if(!strncmp(path,"/api/device/host/batches",sizeof("/api/device/host/batches")-1))return "batch";
 if(!strncmp(path,"/api/device/operations/",sizeof("/api/device/operations/")-1))return "operation_lookup";
 if(!strncmp(path,"/local/friend/",sizeof("/local/friend/")-1))return "friend";
 if(!strncmp(path,"/local/host/",sizeof("/local/host/")-1))return "host";
 return "other";
}
