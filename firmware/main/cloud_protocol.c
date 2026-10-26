#include "cloud_internal.h"
#include "cjk_name.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static const char *text(const cJSON *o,const char *name){const cJSON *v=cJSON_GetObjectItemCaseSensitive(o,name);return cJSON_IsString(v)?v->valuestring:NULL;}
bool pc_cloud_decode_bitmap(const cJSON *o,const char *name,uint8_t *out,size_t bytes){
 const char *hex=text(o,name);if(!hex||strlen(hex)!=bytes*2)return false;
 for(size_t i=0;i<bytes*2;i++)if(!((hex[i]>='0'&&hex[i]<='9')||(hex[i]>='a'&&hex[i]<='f')))return false;
 for(size_t i=0;i<bytes;i++){unsigned a=(unsigned)(hex[i*2]<='9'?hex[i*2]-'0':hex[i*2]-'a'+10),b=(unsigned)(hex[i*2+1]<='9'?hex[i*2+1]-'0':hex[i*2+1]-'a'+10);out[i]=(uint8_t)((a<<4)|b);}return true;
}
static bool integer(const cJSON *o,const char *name,uint64_t *out){const cJSON *v=cJSON_GetObjectItemCaseSensitive(o,name);if(!cJSON_IsNumber(v)||!isfinite(v->valuedouble)||v->valuedouble<0||v->valuedouble>9007199254740991.0||floor(v->valuedouble)!=v->valuedouble)return false;*out=(uint64_t)v->valuedouble;return true;}
bool pc_cloud_uuid(const char *s){if(!s||strlen(s)!=36)return false;for(unsigned i=0;i<36;i++){if(i==8||i==13||i==18||i==23){if(s[i]!='-')return false;}else if(!((s[i]>='a'&&s[i]<='f')||(s[i]>='0'&&s[i]<='9')))return false;}return true;}
bool pc_cloud_origin_valid(const char *s){if(!s||strncmp(s,"https://",8)||strlen(s)>192||!s[8])return false;for(const char *p=s+8;*p;p++)if(!((*p>='a'&&*p<='z')||(*p>='A'&&*p<='Z')||(*p>='0'&&*p<='9')||*p=='.'||*p=='-'||*p==':'))return false;return true;}
void pc_cloud_init(pc_cloud *c,pc_store *store,pc_state *state,pc_cloud_sign_fn sign,void *sign_context,pc_cloud_transport_fn transport,void *transport_context){memset(c,0,sizeof(*c));c->store=store;c->state=state;c->sign=sign;c->sign_context=sign_context;c->transport=transport;c->transport_context=transport_context;c->feedback.cursor.consumed=store->data.feedback_consumed;memcpy(c->feedback.cursor.session_id,store->data.feedback_session,37);for(unsigned i=0;i<PC_PENDING_OPERATIONS;i++)if(store->data.pending[i].kind)state->unresolved=true;}
static cJSON *parse(const char *s){const char *end=NULL;return cJSON_ParseWithLengthOpts(s,strlen(s)+1,&end,1);}
pc_cloud_result pc_cloud_call(pc_cloud *c,bool get,const char *path,const cJSON *body,cJSON **out){
 *out=NULL;c->http_status=0;
 if(!c->store->writable||!c->sign||(!c->transport&&!c->transport_alloc)||!pc_cloud_uuid(c->store->data.device_id)||!c->store->data.device_token[0]||!pc_cloud_origin_valid(c->store->data.server_origin))return PC_CLOUD_INVALID;
 /* Enrollment responses are small; do not reserve the 16KiB runtime
  * bitmap envelope while TLS needs its peak certificate-verification heap. */
 size_t response_capacity=!strncmp(path,"/api/device-enrollment/",23)?4096u:PC_CLOUD_RESPONSE_BYTES;
 char *request=body?cJSON_PrintUnformatted(body):NULL;char *response=c->transport_alloc?NULL:calloc(1,response_capacity);
 if((!c->transport_alloc&&!response)||(body&&!request)){free(request);free(response);return PC_CLOUD_TRANSPORT;}
 size_t allocated_bytes=response_capacity;
 bool received=c->transport_alloc?c->transport_alloc(c->transport_context,get,path,request?request:"",&response,response_capacity,&allocated_bytes,&c->http_status):c->transport(c->transport_context,get,path,request?request:"",response,response_capacity,&c->http_status);
 if(request){memset(request,0,strlen(request));free(request);}
 if(!received||!response||!allocated_bytes||allocated_bytes>response_capacity||!memchr(response,0,allocated_bytes)){free(response);return PC_CLOUD_TRANSPORT;}
 if(c->http_status!=200){free(response);return PC_CLOUD_HTTP;}
 cJSON *envelope=parse(response);free(response);const char *payload=text(envelope,"payload"),*signature=text(envelope,"signature");char expected[65];
 bool verified=payload&&signature&&strlen(signature)==64&&c->sign(c->sign_context,payload,expected);
 if(verified){unsigned diff=0;for(unsigned i=0;i<64;i++)diff|=(unsigned char)signature[i]^(unsigned char)expected[i];verified=diff==0;}
 cJSON *result=verified?parse(payload):NULL;const char *recipient=text(result,"recipient_device_id");
 if(!recipient||strcmp(recipient,c->store->data.device_id)){cJSON_Delete(result);result=NULL;}
 cJSON_Delete(envelope);if(!result)return PC_CLOUD_INVALID;*out=result;return PC_CLOUD_OK;
}
pc_cloud_result pc_cloud_runtime(pc_cloud *c,uint32_t ms,const char *known){
 if(known&&!pc_cloud_uuid(known))return PC_CLOUD_INVALID;
 char path[160];snprintf(path,sizeof(path),"/api/device/runtime?view=board%s%s",known?"&known_activity_id=":"",known?known:"");cJSON *r=NULL;pc_cloud_result status=pc_cloud_call(c,true,path,NULL,&r);if(status!=PC_CLOUD_OK)return status;
 uint64_t version,time;const cJSON *identity=cJSON_GetObjectItemCaseSensitive(r,"identity"),*host=cJSON_GetObjectItemCaseSensitive(r,"host");
 const char *member=text(identity,"member_id"),*device=text(identity,"device_id"),*active=text(host,"active_activity_id");
 const cJSON *allowed=cJSON_GetObjectItemCaseSensitive(host,"can_check_in"),*conflict=cJSON_GetObjectItemCaseSensitive(host,"schedule_conflict");
 bool valid=integer(r,"protocol_version",&version)&&version==1&&integer(r,"server_time",&time)&&time>0&&device&&!strcmp(device,c->store->data.device_id)&&member&&!strcmp(member,c->store->data.member_id)&&cJSON_IsBool(allowed)&&cJSON_IsBool(conflict)&&(!cJSON_IsTrue(allowed)||(!cJSON_IsTrue(conflict)&&pc_cloud_uuid(active)));
 if(valid){
  const cJSON *planet=cJSON_GetObjectItemCaseSensitive(r,"planet");const char *palette=text(planet,"palette_id");uint64_t revision;
  static const char *palettes[]={"green","pink","blue","apricot"};unsigned selected=4;
  for(unsigned i=0;i<4;i++)if(palette&&!strcmp(palette,palettes[i]))selected=i;
  if(selected==4||!integer(planet,"revision",&revision)||revision>UINT32_MAX)valid=false;
  else if(c->store->data.palette!=selected||c->store->data.planet_revision!=(uint32_t)revision){
   pc_personal_data next=c->store->data;next.palette=(uint8_t)selected;next.planet_revision=(uint32_t)revision;
   if(pc_store_commit(c->store,&next)!=ESP_OK){cJSON_Delete(r);return PC_CLOUD_STORAGE;}
  }
 }
 if(valid&&cJSON_GetObjectItemCaseSensitive(identity,"name_bitmap")){
  if(!pc_personal_visual_decode(r,&c->personal))valid=false;
 }
 if(valid){
  const cJSON *activities=cJSON_GetObjectItemCaseSensitive(host,"active_activities");
  const char *title=text(cJSON_GetArrayItem(activities,0),"title");c->active_title[0]=0;
  if(title&&strlen(title)<sizeof(c->active_title))strcpy(c->active_title,title);
 }
 if(valid){c->active_title_valid=false;if(cJSON_IsTrue(allowed)&&cJSON_GetObjectItemCaseSensitive(host,"active_title_bitmap")){c->active_title_valid=pc_cloud_decode_bitmap(host,"active_title_bitmap",c->active_title_bitmap,sizeof(c->active_title_bitmap));if(!c->active_title_valid)valid=false;}}
 if(valid){
  c->known_activity_id[0]=0;c->known_activity_closed=false;
  if(known){const cJSON *activity=cJSON_GetObjectItemCaseSensitive(r,"known_activity");const char *id=text(activity,"id"),*phase=text(activity,"phase");
   if(cJSON_IsNull(activity)||(id&&!strcmp(id,known)&&phase&&(!strcmp(phase,"ended")||!strcmp(phase,"cancelled")||!strcmp(phase,"rejected")))){memcpy(c->known_activity_id,known,37);c->known_activity_closed=true;}
  }
  c->active_activity_id[0]=0;if(cJSON_IsTrue(allowed))memcpy(c->active_activity_id,active,37);c->server_time=time;c->server_ms=ms;c->clock_known=true;pc_facts(c->state,true,true,cJSON_IsTrue(allowed),ms);}
 cJSON_Delete(r);return valid?PC_CLOUD_OK:PC_CLOUD_INVALID;
}
static pc_cloud_result batch_result(pc_cloud *c,bool get,const char *path,cJSON *body,const pc_pending_operation *op,cJSON **out){
 pc_cloud_result result=pc_cloud_call(c,get,path,body,out);if(result!=PC_CLOUD_OK)return result;
 const char *id=text(*out,"batch_id"),*activity=text(*out,"activity_id"),*state=text(*out,"state");uint64_t total,signed_count,failed,pending,processed;
 bool state_valid=state&&(!strcmp(state,"queued")||!strcmp(state,"running")||!strcmp(state,"completed")||!strcmp(state,"partial")||!strcmp(state,"failed")||!strcmp(state,"stopped"));
 bool valid=id&&activity&&!strcmp(id,op->operation_id)&&!strcmp(activity,op->activity_id)&&state_valid&&integer(*out,"total",&total)&&total<=10000&&integer(*out,"signed",&signed_count)&&integer(*out,"failed",&failed)&&integer(*out,"pending",&pending)&&integer(*out,"processed",&processed)&&signed_count+failed+pending==total&&processed==signed_count+failed;
 if(valid&&!strcmp(state,"completed"))valid=failed==0&&pending==0;
 if(valid&&(!strcmp(state,"failed")||!strcmp(state,"partial")))valid=pending==0&&failed>0;
 if(!valid){cJSON_Delete(*out);*out=NULL;return PC_CLOUD_INVALID;}return PC_CLOUD_OK;
}
static cJSON *proof_body(pc_cloud *c,const char *tag,const char *id,const char *batch_or_activity,bool retry){
 cJSON *a=cJSON_CreateArray(),*body=cJSON_CreateObject();if(!a||!body){cJSON_Delete(a);cJSON_Delete(body);return NULL;}
 cJSON_AddItemToArray(a,cJSON_CreateString(tag));cJSON_AddItemToArray(a,cJSON_CreateString(id));
 if(retry)cJSON_AddItemToArray(a,cJSON_CreateString(batch_or_activity));
 cJSON_AddItemToArray(a,cJSON_CreateString(c->store->data.device_id));
 if(!retry)cJSON_AddItemToArray(a,cJSON_CreateString(batch_or_activity));
 cJSON_AddItemToArray(a,cJSON_CreateBool(true));char *canonical=cJSON_PrintUnformatted(a),signature[65];cJSON_Delete(a);
 bool ok=canonical&&c->sign(c->sign_context,canonical,signature);free(canonical);if(!ok){cJSON_Delete(body);return NULL;}
 cJSON_AddStringToObject(body,retry?"request_id":"batch_id",id);if(!retry)cJSON_AddStringToObject(body,"activity_id",batch_or_activity);
 cJSON_AddBoolToObject(body,"host_confirmed",true);cJSON_AddStringToObject(body,"host_proof",signature);return body;
}
pc_cloud_result pc_cloud_batch_start(pc_cloud *c,unsigned slot,const char *id,const char *activity,cJSON **out){
 *out=NULL;if(slot>=PC_PENDING_OPERATIONS||!pc_cloud_uuid(id)||!pc_cloud_uuid(activity)||!c->sign)return PC_CLOUD_INVALID;
 pc_pending_operation op={.kind=PC_PENDING_BATCH};memcpy(op.operation_id,id,37);memcpy(op.activity_id,activity,37);const pc_pending_operation *old=&c->store->data.pending[slot];
 if(old->kind){if(old->kind!=PC_PENDING_BATCH||strcmp(old->operation_id,id)||strcmp(old->activity_id,activity))return PC_CLOUD_BUSY;}
 else if(pc_store_pending_begin(c->store,slot,&op)!=ESP_OK)return PC_CLOUD_STORAGE;
 cJSON *body=proof_body(c,"herstory-host-batch-v1",id,activity,false);if(!body)return PC_CLOUD_INVALID;
 pc_operation_started(c->state,PC_BATCH_RUNNING);pc_cloud_result r=batch_result(c,false,"/api/device/host/batches",body,&op,out);cJSON_Delete(body);return r;
}
pc_cloud_result pc_cloud_batch_query(pc_cloud *c,unsigned slot,cJSON **out){*out=NULL;if(slot>=PC_PENDING_OPERATIONS||c->store->data.pending[slot].kind!=PC_PENDING_BATCH)return PC_CLOUD_INVALID;const pc_pending_operation *p=&c->store->data.pending[slot];char path[128];snprintf(path,sizeof(path),"/api/device/host/batches/%s",p->operation_id);return batch_result(c,true,path,NULL,p,out);}
pc_cloud_result pc_cloud_batch_retry(pc_cloud *c,unsigned slot,const char *retry,cJSON **out){
 *out=NULL;if(slot>=PC_PENDING_OPERATIONS||!pc_cloud_uuid(retry)||!c->sign)return PC_CLOUD_INVALID;const pc_pending_operation *p=&c->store->data.pending[slot];if(p->kind!=PC_PENDING_BATCH)return PC_CLOUD_INVALID;
 /* Caller reconciles partial/failed first; never mint an ID because a request timed out. */
 cJSON *current=NULL;pc_cloud_result checked=pc_cloud_batch_query(c,slot,&current);if(checked!=PC_CLOUD_OK)return checked;
 const char *state=text(current,"state");bool retryable=state&&(!strcmp(state,"partial")||!strcmp(state,"failed"))&&cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(current,"can_retry"));cJSON_Delete(current);if(!retryable)return PC_CLOUD_BUSY;
 if(pc_store_pending_retry(c->store,slot,p->operation_id,retry)!=ESP_OK)return PC_CLOUD_STORAGE;
 cJSON *body=proof_body(c,"herstory-host-batch-retry-v1",retry,p->operation_id,true);if(!body)return PC_CLOUD_INVALID;
 char path[128];snprintf(path,sizeof(path),"/api/device/host/batches/%s/retry",p->operation_id);pc_operation_started(c->state,PC_BATCH_RUNNING);pc_cloud_result r=batch_result(c,false,path,body,p,out);cJSON_Delete(body);return r;
}
pc_cloud_result pc_cloud_operation_query(pc_cloud *c,unsigned slot,cJSON **out){
 *out=NULL;if(slot>=PC_PENDING_OPERATIONS)return PC_CLOUD_INVALID;const pc_pending_operation *p=&c->store->data.pending[slot];if(p->kind!=PC_PENDING_FRIEND&&p->kind!=PC_PENDING_SINGLE)return PC_CLOUD_INVALID;
 char path[128];snprintf(path,sizeof(path),"/api/device/operations/%s",p->operation_id);pc_cloud_result result=pc_cloud_call(c,true,path,NULL,out);if(result!=PC_CLOUD_OK)return result;
 const char *id=text(*out,"interaction_id"),*state=text(*out,"state");
 bool valid=id&&!strcmp(id,p->operation_id)&&state&&(!strcmp(state,"saved")||!strcmp(state,"unknown")||!strcmp(state,"cancelled"))&&cJSON_IsFalse(cJSON_GetObjectItemCaseSensitive(*out,"may_retry_as_new"));
 if(valid&&!strcmp(state,"saved")){
  const cJSON *receipt=cJSON_GetObjectItemCaseSensitive(*out,"receipt");const char *operation=text(*out,"operation_type"),*saved_id=text(receipt,"interaction_id"),*saved_status=text(receipt,"status");
  valid=operation&&saved_id&&!strcmp(saved_id,p->operation_id)&&saved_status;
  if(valid&&p->kind==PC_PENDING_FRIEND)valid=!strcmp(operation,"friend")&&!strcmp(saved_status,"connected")&&pc_cloud_uuid(text(receipt,"friendship_id"));
  if(valid&&p->kind==PC_PENDING_SINGLE){const char *activity=text(receipt,"activity_id");valid=(!strcmp(operation,"host_checkin")||!strcmp(operation,"checkin"))&&!strcmp(saved_status,"checked_in")&&activity&&!strcmp(activity,p->activity_id);}
 }
 if(valid&&!strcmp(state,"cancelled")){
  const cJSON *receipt=cJSON_GetObjectItemCaseSensitive(*out,"receipt");const char *id=text(receipt,"interaction_id"),*activity=text(receipt,"activity_id"),*status=text(receipt,"status");
  valid=id&&!strcmp(id,p->operation_id)&&status&&!strcmp(status,"cancelled")&&((p->kind==PC_PENDING_SINGLE&&activity&&!strcmp(activity,p->activity_id))||(p->kind==PC_PENDING_FRIEND&&text(*out,"operation_type")&&!strcmp(text(*out,"operation_type"),"friend")));
 }
 if(!valid){cJSON_Delete(*out);*out=NULL;return PC_CLOUD_INVALID;}return PC_CLOUD_OK;
}
pc_cloud_result pc_cloud_feedback_open(pc_cloud *c,const char *session){
 if(!pc_cloud_uuid(session))return PC_CLOUD_INVALID;
 cJSON *body=cJSON_CreateObject(),*r=NULL;if(!body)return PC_CLOUD_INVALID;cJSON_AddStringToObject(body,"session_id",session);pc_cloud_result status=pc_cloud_call(c,false,"/api/device/feedback/session",body,&r);cJSON_Delete(body);
 if(status!=PC_CLOUD_OK)return status;
 const char *received=text(r,"session_id");uint64_t expiry;bool valid=received&&!strcmp(received,session)&&integer(r,"expires_at",&expiry);cJSON_Delete(r);
 if(!valid)return PC_CLOUD_INVALID;
 return pc_feedback_open(&c->feedback,session,pc_store_feedback_save,c->store)?PC_CLOUD_OK:PC_CLOUD_STORAGE;
}
pc_cloud_result pc_cloud_feedback_poll(pc_cloud *c,uint32_t ms,pc_cloud_pulse_fn pulse,void *context){
 if(!c->feedback.active||!c->clock_known||!pulse||!c->monotonic_ms||(uint32_t)(ms-c->server_ms)>15000)return PC_CLOUD_INVALID;
 char path[128];snprintf(path,sizeof(path),"/api/device/feedback?session_id=%s",c->feedback.cursor.session_id);cJSON *r=NULL;pc_cloud_result status=pc_cloud_call(c,true,path,NULL,&r);if(status!=PC_CLOUD_OK)return status;
 const char *session=text(r,"session_id");const cJSON *items=cJSON_GetObjectItemCaseSensitive(r,"items");uint64_t remote;
 bool valid=session&&!strcmp(session,c->feedback.cursor.session_id)&&integer(r,"server_time",&remote)&&cJSON_IsArray(items)&&cJSON_GetArraySize(items)<=30;
 uint64_t expected=c->server_time+(uint32_t)(ms-c->server_ms)/1000;if(valid&&(remote+5<expected||remote>expected+5))valid=false;
 uint64_t last=0;const cJSON *item=NULL;
 cJSON_ArrayForEach(item,items){uint64_t id,expiry,duration;const char *feedback=text(item,"feedback");if(!integer(item,"notification_id",&id)||id<=last||!integer(item,"expires_at",&expiry)||!integer(item,"duration_ms",&duration)||duration!=1000||!pc_cloud_uuid(text(item,"activity_id"))||!pc_cloud_uuid(text(item,"interaction_id"))||!feedback||strcmp(feedback,"checkin_pulse"))valid=false;else last=id;}
 if(!valid){cJSON_Delete(r);return PC_CLOUD_INVALID;}
 cJSON *ack=cJSON_CreateObject(),*ids=cJSON_CreateArray();if(!ack||!ids){cJSON_Delete(ack);cJSON_Delete(ids);cJSON_Delete(r);return PC_CLOUD_INVALID;}
 cJSON_AddStringToObject(ack,"session_id",session);cJSON_AddItemToObject(ack,"notification_ids",ids);
 cJSON_ArrayForEach(item,items){uint64_t id,expiry;integer(item,"notification_id",&id);integer(item,"expires_at",&expiry);
  uint64_t aged=c->server_time+(uint32_t)(c->monotonic_ms(c->clock_context)-c->server_ms)/1000;
  uint64_t response_age=remote+(uint32_t)(c->monotonic_ms(c->clock_context)-ms)/1000;
  if(response_age>aged)aged=response_age;
  pc_feedback_action a=pc_feedback_consume(&c->feedback,session,id,expiry,aged,true);
  if(a==PC_FEEDBACK_STORAGE_FAILED){cJSON_Delete(r);cJSON_Delete(ack);return PC_CLOUD_STORAGE;}
  if(a==PC_FEEDBACK_PULSE_ACK)pulse(context,1000);
  if(a==PC_FEEDBACK_ACK_ONLY||a==PC_FEEDBACK_PULSE_ACK)cJSON_AddItemToArray(ids,cJSON_CreateNumber((double)id));
 }
 cJSON_Delete(r);if(cJSON_GetArraySize(ids)){cJSON *result=NULL;status=pc_cloud_call(c,false,"/api/device/feedback/ack",ack,&result);if(status==PC_CLOUD_OK){const char *s=text(result,"session_id");if(!s||strcmp(s,c->feedback.cursor.session_id)||!cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(result,"acknowledged")))status=PC_CLOUD_INVALID;}cJSON_Delete(result);}cJSON_Delete(ack);return status;
}
void pc_cloud_disconnect(pc_cloud *c,uint32_t ms){pc_feedback_disconnect(&c->feedback);c->clock_known=false;pc_facts(c->state,false,c->state->bound,false,ms);}

static bool enrollment_valid(const cJSON *r){
 const char *state=text(r,"state");if(!state)return false;
 if(!strcmp(state,"revoked"))return true;
 if(!strcmp(state,"reset_required")){
  const char *token=text(r,"replacement_device_token");
  if(!pc_cloud_uuid(text(r,"replacement_device_id"))||!token||strlen(token)!=64)return false;
  for(unsigned i=0;i<64;i++)if(!((token[i]>='0'&&token[i]<='9')||(token[i]>='a'&&token[i]<='f')))return false;
  return true;
 }
 if(!strcmp(state,"bound"))return pc_cloud_uuid(text(r,"member_id"))&&text(r,"device_kind")&&!strcmp(text(r,"device_kind"),"user");
 if(strcmp(state,"pending")&&strcmp(state,"unbound"))return false;
 const char *code=text(r,"claim_code");uint64_t expires,time;
 if(!code||strlen(code)!=4||!integer(r,"expires_at",&expires)||!integer(r,"server_time",&time)||expires<=time)return false;
 for(unsigned i=0;i<4;i++)if(code[i]<'0'||code[i]>'9')return false;
 return strcmp(state,"pending")||pc_cloud_uuid(text(r,"request_id"));
}
static pc_cloud_result enrollment_call(pc_cloud *c,bool get,cJSON *body,cJSON **out){
 pc_cloud_result result=pc_cloud_call(c,get,get?"/api/device-enrollment/status?reset_on_revoke=1":"/api/device-enrollment/confirm",body,out);
 if(result==PC_CLOUD_OK&&!enrollment_valid(*out)){cJSON_Delete(*out);*out=NULL;return PC_CLOUD_INVALID;}return result;
}
pc_cloud_result pc_cloud_enrollment_status(pc_cloud *c,cJSON **out){return enrollment_call(c,true,NULL,out);}
pc_cloud_result pc_cloud_enrollment_confirm(pc_cloud *c,const char *id,bool accept,cJSON **out){
 *out=NULL;if(!pc_cloud_uuid(id))return PC_CLOUD_INVALID;
 cJSON *body=cJSON_CreateObject();if(!body)return PC_CLOUD_INVALID;cJSON_AddStringToObject(body,"request_id",id);cJSON_AddStringToObject(body,"decision",accept?"accept":"reject");
 pc_cloud_result result=enrollment_call(c,false,body,out);cJSON_Delete(body);return result;
}

pc_cloud_result pc_cloud_roster(pc_cloud *c,const char *activity,uint32_t offset,pc_roster_page *out){
 if(!out||!pc_cloud_uuid(activity)||offset>10000)return PC_CLOUD_INVALID;
 char path[160];snprintf(path,sizeof(path),"/api/device/host/roster?activity_id=%s&offset=%u&limit=%u",activity,(unsigned)offset,PC_ROSTER_PAGE_SIZE);
 cJSON *r=NULL;pc_cloud_result result=pc_cloud_call(c,true,path,NULL,&r);if(result!=PC_CLOUD_OK)return result;
 const char *id=text(r,"activity_id"),*title=text(r,"activity_title"),*version=text(r,"roster_version");
 const cJSON *items=cJSON_GetObjectItemCaseSensitive(r,"items"),*more=cJSON_GetObjectItemCaseSensitive(r,"has_more");
 uint64_t total,checked,start,limit;
 bool valid=id&&!strcmp(id,activity)&&title&&strlen(title)<257&&version&&strlen(version)==64&&
  integer(r,"total",&total)&&total<=10000&&integer(r,"checked_count",&checked)&&checked<=total&&
  integer(r,"offset",&start)&&start==(total?(offset<total?offset:total-1):0)&&
  integer(r,"limit",&limit)&&limit==PC_ROSTER_PAGE_SIZE&&cJSON_IsBool(more)&&cJSON_IsArray(items);
 pc_roster_page page={0};
 if(valid&&cJSON_GetObjectItemCaseSensitive(r,"activity_title_bitmap")){page.title_bitmap_valid=pc_cloud_decode_bitmap(r,"activity_title_bitmap",page.title_bitmap,sizeof(page.title_bitmap));valid=page.title_bitmap_valid;}
 if(valid){
  page.count=(uint32_t)cJSON_GetArraySize(items);
  uint64_t expected=total-start;if(expected>PC_ROSTER_PAGE_SIZE)expected=PC_ROSTER_PAGE_SIZE;
  valid=page.count==expected&&cJSON_IsTrue(more)==(start+page.count<total);
 }
 if(valid){
  for(unsigned i=0;i<64;i++)if(!((version[i]>='0'&&version[i]<='9')||(version[i]>='a'&&version[i]<='f')))valid=false;
  for(unsigned i=0;valid&&i<page.count;i++){
   const cJSON *item=cJSON_GetArrayItem(items,(int)i);const char *member=text(item,"member_id"),*name=text(item,"name"),*status=text(item,"status");
   valid=pc_cloud_uuid(member)&&name&&strlen(name)<sizeof(page.members[i].name)&&status&&(!strcmp(status,"SIGNED")||!strcmp(status,"PENDING"));
   for(unsigned j=0;valid&&j<i;j++)if(!strcmp(member,page.members[j].member_id))valid=false;
   if(valid&&cJSON_GetObjectItemCaseSensitive(item,"name_bitmap")){page.members[i].name_bitmap_valid=pc_cloud_decode_bitmap(item,"name_bitmap",page.members[i].name_bitmap,sizeof(page.members[i].name_bitmap));valid=page.members[i].name_bitmap_valid;}
#ifdef ESP_PLATFORM
   if(valid){
    const char *style=text(item,"name_bitmap_style");
    if(!style||strcmp(style,PC_NAME_BITMAP_STYLE)){
     page.members[i].name_bitmap_valid=pc_pixel_name_local(name,page.members[i].name_bitmap,sizeof(page.members[i].name_bitmap),192,16,1,false,false);
     valid=page.members[i].name_bitmap_valid;
    }
   }
#endif
   if(valid){memcpy(page.members[i].member_id,member,37);strcpy(page.members[i].name,name);page.members[i].signed_in=!strcmp(status,"SIGNED");}
  }
 }
 if(valid){memcpy(page.activity_id,id,37);strcpy(page.title,title);memcpy(page.version,version,65);page.total=(uint32_t)total;page.checked_count=(uint32_t)checked;page.offset=(uint32_t)start;page.has_more=cJSON_IsTrue(more);*out=page;}
 cJSON_Delete(r);return valid?PC_CLOUD_OK:PC_CLOUD_INVALID;
}
