#include "cloud_protocol.h"
#include "startup.h"
#include "batch_controller.h"
#include "identity_setup.h"
#include "proximity.h"
#include "single_attendance.h"
#include "friend_protocol.h"
#include "friend_flow.h"
#include "app_services.h"
#include "nvs_fake.h"
#include <CommonCrypto/CommonDigest.h>
#include <CommonCrypto/CommonHMAC.h>
#include <stdio.h>
#include <stdlib.h>
static const char *device="11111111-1111-1111-1111-111111111111",*member="22222222-2222-2222-2222-222222222222",*activity="33333333-3333-3333-3333-333333333333",*batch="44444444-4444-4444-4444-444444444444",*session="55555555-5555-5555-5555-555555555555",*retry="66666666-6666-6666-6666-666666666666";
static bool crypto(void *ctx,const char *text,char out[65]){pc_store *s=ctx;unsigned char key[32],digest[32];CC_SHA256(s->data.device_token,(CC_LONG)strlen(s->data.device_token),key);CCHmac(kCCHmacAlgSHA256,key,32,text,strlen(text),digest);for(unsigned i=0;i<32;i++)snprintf(out+i*2,3,"%02x",digest[i]);return true;}
typedef struct {cJSON *vectors;pc_store *store;bool timeout,corrupt,wrong_recipient,ack_timeout,too_large;int malformed,enrollment;bool confirm_timeout,retry_timeout,batch_completed,single_timeout,single_saved,single_not_delivered,runtime_closed,friend_waiting,friend_timeout,friend_retired,friend_saved;unsigned requests,pulses;uint32_t ms;unsigned latency_ms;} mock;
static uint32_t clock_ms(void *ctx){return ((mock *)ctx)->ms;}
static void pulse(void *ctx,unsigned duration){mock *m=ctx;assert(duration==1000);assert(m->store->data.feedback_consumed>0);m->pulses++;}
static bool transport(void *ctx,bool get,const char *path,const char *body,char *out,size_t capacity,int *status){
 mock *m=ctx;assert(capacity==(!strncmp(path,"/api/device-enrollment/",23)?4096u:PC_CLOUD_RESPONSE_BYTES));m->requests++;m->ms+=m->latency_ms;*status=200;if(m->timeout)return false;if(m->too_large){memset(out,'x',capacity);return true;}
 const char *name=NULL;cJSON *request=body[0]?cJSON_Parse(body):NULL;
 if(strstr(path,"/device-enrollment/status")){assert(get);name=m->enrollment==1?"enrollment_waiting":m->enrollment==2?"enrollment_pending":m->enrollment==5?"enrollment_reset":m->enrollment==4?"enrollment_revoked":"enrollment_bound";}
 else if(strstr(path,"/device-enrollment/confirm")){assert(!get);assert(!strcmp(cJSON_GetObjectItemCaseSensitive(request,"request_id")->valuestring,"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));if(!strcmp(cJSON_GetObjectItemCaseSensitive(request,"decision")->valuestring,"accept")){name="enrollment_bound";m->enrollment=3;}else{name="enrollment_rejected";m->enrollment=1;}if(m->confirm_timeout){cJSON_Delete(request);return false;}}
 else if(strstr(path,"/local/friend/retire")){assert(!get);assert(!strcmp(cJSON_GetObjectItemCaseSensitive(request,"user_proof")->valuestring,cJSON_GetObjectItemCaseSensitive(m->vectors,"expected_friend_retire_proof")->valuestring));if(m->friend_timeout){cJSON_Delete(request);return false;}m->friend_retired=true;name="friend_retire";}
 else if(strstr(path,"/local/friend/confirm")){assert(!get&&m->store->data.pending[0].kind==PC_PENDING_FRIEND);assert(!strcmp(cJSON_GetObjectItemCaseSensitive(request,"user_proof")->valuestring,cJSON_GetObjectItemCaseSensitive(m->vectors,"expected_friend_proof")->valuestring));if(m->friend_timeout){cJSON_Delete(request);return false;}name="friend_confirmed";}
 else if(strstr(path,"/local/friend/")){name=get?(m->friend_waiting?"friend_waiting":"friend_poll"):"friend_searching";}
 else if(strstr(path,"/runtime")){assert(get);assert(strstr(path,"view=board"));name=m->runtime_closed?"runtime_closed":"runtime";}
 else if(strstr(path,"/local/host/cancel")){assert(!get);assert(!strcmp(cJSON_GetObjectItemCaseSensitive(request,"host_proof")->valuestring,cJSON_GetObjectItemCaseSensitive(m->vectors,"expected_cancel_proof")->valuestring));name="single_cancel";}
 else if(strstr(path,"/local/host/submit")){assert(!get);assert(m->store->data.pending[0].kind==PC_PENDING_SINGLE);assert(!strcmp(cJSON_GetObjectItemCaseSensitive(request,"host_proof")->valuestring,cJSON_GetObjectItemCaseSensitive(m->vectors,"expected_single_proof")->valuestring));if(m->single_timeout){m->single_saved=!m->single_not_delivered;cJSON_Delete(request);return false;}name="single";}
 else if(strstr(path,"/local/host/nearby")){assert(!get);assert(cJSON_GetObjectItemCaseSensitive(request,"presence_epoch")->valuedouble==cJSON_GetObjectItemCaseSensitive(m->vectors,"presence_epoch")->valuedouble);assert(!strcmp(cJSON_GetObjectItemCaseSensitive(request,"presence_tag")->valuestring,cJSON_GetObjectItemCaseSensitive(m->vectors,"peer_presence_tag")->valuestring));name="host_nearby";}
 else if(strstr(path,"/host/roster?")){assert(get);name="roster";}
 else if(!strcmp(path,"/api/device/host/batches")){assert(!get&&m->store->data.pending[0].kind==PC_PENDING_BATCH);assert(!strcmp(cJSON_GetObjectItemCaseSensitive(request,"host_proof")->valuestring,cJSON_GetObjectItemCaseSensitive(m->vectors,"expected_batch_proof")->valuestring));name="batch_start";}
 else if(strstr(path,"/retry")){assert(!get&&!strcmp(m->store->data.pending[0].retry_id,retry));assert(!strcmp(cJSON_GetObjectItemCaseSensitive(request,"host_proof")->valuestring,cJSON_GetObjectItemCaseSensitive(m->vectors,"expected_retry_proof")->valuestring));name="batch_retry";if(m->retry_timeout){cJSON_Delete(request);return false;}}
 else if(strstr(path,"/host/batches/")){assert(get);name=m->batch_completed?"batch_completed":"batch_partial";}
 else if(strstr(path,"/feedback/session")){assert(!get);name="feedback_open";}
 else if(strstr(path,"/feedback/ack")){assert(!get&&m->store->data.feedback_consumed>0);if(m->ack_timeout){cJSON_Delete(request);return false;}name="ack";}
 else if(strstr(path,"/feedback?")){assert(get);name="feedback";}
 else if(strstr(path,"/operations/")){assert(get);const cJSON *friend_id=cJSON_GetObjectItemCaseSensitive(m->vectors,"friend_operation_id");name=cJSON_IsString(friend_id)&&strstr(path,friend_id->valuestring)?(m->friend_saved?"friend_operation":"operation"):strstr(path,"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")?(m->friend_retired?"friend_retired_operation":"operation"):strstr(path,"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?(m->single_saved?"single_operation":"single_unknown"):"operation";}
 assert(name);cJSON_Delete(request);cJSON *envelope=cJSON_Duplicate(cJSON_GetObjectItemCaseSensitive(m->vectors,name),true);assert(envelope);
 if(m->wrong_recipient||m->malformed){cJSON *payload=cJSON_Parse(cJSON_GetObjectItemCaseSensitive(envelope,"payload")->valuestring);if(m->wrong_recipient)cJSON_ReplaceItemInObjectCaseSensitive(payload,"recipient_device_id",cJSON_CreateString("77777777-7777-7777-7777-777777777777"));
 if(m->malformed==1)cJSON_ReplaceItemInObjectCaseSensitive(payload,"protocol_version",cJSON_CreateNumber(2));
 if(m->malformed==2)cJSON_ReplaceItemInObjectCaseSensitive(payload,"batch_id",cJSON_CreateString(retry));
 if(m->malformed==3)cJSON_ReplaceItemInObjectCaseSensitive(cJSON_GetArrayItem(cJSON_GetObjectItemCaseSensitive(payload,"items"),0),"duration_ms",cJSON_CreateNumber(2000));
 if(m->malformed==4){cJSON *items=cJSON_GetObjectItemCaseSensitive(payload,"items");cJSON_AddItemToArray(items,cJSON_Duplicate(cJSON_GetArrayItem(items,0),true));}
 if(m->malformed==5)cJSON_ReplaceItemInObjectCaseSensitive(payload,"activity_id",cJSON_CreateString(retry));
 if(m->malformed==6){cJSON *items=cJSON_GetObjectItemCaseSensitive(payload,"items");cJSON_ReplaceItemInArray(items,1,cJSON_Duplicate(cJSON_GetArrayItem(items,0),true));}
 if(m->malformed==7)cJSON_ReplaceItemInObjectCaseSensitive(payload,"total",cJSON_CreateNumber(10001));
 if(m->malformed==8)cJSON_ReplaceItemInObjectCaseSensitive(payload,"has_more",cJSON_CreateBool(true));
 if(m->malformed==9)cJSON_ReplaceItemInObjectCaseSensitive(cJSON_GetObjectItemCaseSensitive(payload,"planet"),"palette_id",cJSON_CreateString("unknown"));
 if(m->malformed==10)cJSON_ReplaceItemInObjectCaseSensitive(cJSON_GetObjectItemCaseSensitive(payload,"planet"),"revision",cJSON_CreateNumber(4294967296.0));
 if(m->malformed==11)cJSON_ReplaceItemInObjectCaseSensitive(payload,"activity_id",cJSON_CreateString(retry));
 if(m->malformed==12)cJSON_ReplaceItemInObjectCaseSensitive(payload,"name_bitmap",cJSON_CreateString("00"));
 if(m->malformed==13)cJSON_ReplaceItemInObjectCaseSensitive(cJSON_GetObjectItemCaseSensitive(payload,"host"),"active_title_bitmap",cJSON_CreateString("00"));
 if(m->malformed==15)cJSON_DeleteItemFromObjectCaseSensitive(payload,"member_label_bitmap");
 if(m->malformed==14)cJSON_ReplaceItemInObjectCaseSensitive(cJSON_GetArrayItem(cJSON_GetObjectItemCaseSensitive(payload,"items"),0),"name_bitmap",cJSON_CreateString("00"));
 if(m->malformed>=15&&m->malformed<=22){cJSON *visual=cJSON_GetObjectItemCaseSensitive(payload,"visual"),*self=cJSON_GetObjectItemCaseSensitive(visual,"self"),*peer=cJSON_GetObjectItemCaseSensitive(visual,"peer");
  if(m->malformed==15)cJSON_DeleteItemFromObjectCaseSensitive(payload,"visual");
  if(m->malformed==16)cJSON_ReplaceItemInObjectCaseSensitive(visual,"version",cJSON_CreateNumber(2));
  if(m->malformed==17)cJSON_ReplaceItemInObjectCaseSensitive(self,"member_id",cJSON_CreateString(retry));
  if(m->malformed==18)cJSON_ReplaceItemInObjectCaseSensitive(peer,"hair_length",cJSON_CreateString("extra-long"));
  if(m->malformed==19)cJSON_ReplaceItemInObjectCaseSensitive(self,"hair_rgb",cJSON_CreateString("#00000"));
  if(m->malformed==20)cJSON_DeleteItemFromObjectCaseSensitive(peer,"fallback");
  if(m->malformed==21)cJSON_ReplaceItemInObjectCaseSensitive(self,"hair_rgb",cJSON_CreateString("000000"));
  if(m->malformed==22){cJSON_ReplaceItemInObjectCaseSensitive(peer,"fallback",cJSON_CreateBool(true));cJSON_ReplaceItemInObjectCaseSensitive(peer,"hair_length",cJSON_CreateString("short"));}
 }
 char *p=cJSON_PrintUnformatted(payload),signature[65];crypto(m->store,p,signature);cJSON_ReplaceItemInObjectCaseSensitive(envelope,"payload",cJSON_CreateString(p));cJSON_ReplaceItemInObjectCaseSensitive(envelope,"signature",cJSON_CreateString(signature));free(p);cJSON_Delete(payload);}
 if(m->corrupt)cJSON_GetObjectItemCaseSensitive(envelope,"signature")->valuestring[0]^=1;
 char *json=cJSON_PrintUnformatted(envelope);assert(strlen(json)<capacity);memcpy(out,json,strlen(json)+1);free(json);cJSON_Delete(envelope);return true;
}
static bool deferred_transport(void *ctx,bool get,const char *path,const char *body,char **out,size_t capacity,size_t *allocated_bytes,int *status){
 char *buffer=calloc(1,capacity);assert(buffer);bool ok=transport(ctx,get,path,body,buffer,capacity,status);char *end=memchr(buffer,0,capacity);*allocated_bytes=end?(size_t)(end-buffer)+1:capacity;*out=malloc(*allocated_bytes);assert(*out);memcpy(*out,buffer,*allocated_bytes);free(buffer);return ok;
}
static bool deferred_no_buffer(void *ctx,bool get,const char *path,const char *body,char **out,size_t capacity,size_t *allocated_bytes,int *status){
 (void)ctx;(void)get;(void)path;(void)body;(void)capacity;(void)status;*allocated_bytes=0;*out=NULL;return false;
}
int main(int argc,char **argv){assert(argc==2);FILE *file=fopen(argv[1],"rb");assert(file);fseek(file,0,SEEK_END);long size=ftell(file);rewind(file);char *json=calloc(1,(size_t)size+1);assert(json&&fread(json,1,(size_t)size,file)==(size_t)size);fclose(file);cJSON *vectors=cJSON_Parse(json);free(json);assert(vectors);
 pc_store store;CHECK(pc_store_load(&store)==ESP_ERR_NVS_NOT_FOUND);pc_personal_data d=store.data;strcpy(d.device_id,device);strcpy(d.member_id,member);memset(d.device_token,'a',64);strcpy(d.server_origin,"https://example.test");CHECK(pc_store_commit(&store,&d)==ESP_OK);
 pc_state state;pc_init(&state,true,true);pc_cloud cloud;mock m={.vectors=vectors,.store=&store};pc_cloud_init(&cloud,&store,&state,crypto,&store,transport,&m);cloud.monotonic_ms=clock_ms;cloud.clock_context=&m;
 CHECK(pc_cloud_origin_valid("https://example.test"));CHECK(!pc_cloud_origin_valid("http://example.test"));CHECK(!pc_cloud_origin_valid("https://user@example.test"));CHECK(!pc_cloud_origin_valid("https://example.test/path"));CHECK(!pc_cloud_uuid("bad"));
 cloud.transport_alloc=deferred_transport;
 CHECK(pc_cloud_runtime(&cloud,0,NULL)==PC_CLOUD_OK&&cloud.personal.valid);
 m.timeout=true;CHECK(pc_cloud_runtime(&cloud,0,NULL)==PC_CLOUD_TRANSPORT);m.timeout=false;
 m.too_large=true;CHECK(pc_cloud_runtime(&cloud,0,NULL)==PC_CLOUD_TRANSPORT);m.too_large=false;
 cloud.transport_alloc=deferred_no_buffer;CHECK(pc_cloud_runtime(&cloud,0,NULL)==PC_CLOUD_TRANSPORT);
 cloud.transport_alloc=NULL;
 CHECK(pc_cloud_runtime(&cloud,0,NULL)==PC_CLOUD_OK&&state.host_active&&cloud.clock_known&&cloud.active_title_valid);m.corrupt=true;CHECK(pc_cloud_runtime(&cloud,0,NULL)==PC_CLOUD_INVALID);m.corrupt=false;m.wrong_recipient=true;CHECK(pc_cloud_runtime(&cloud,0,NULL)==PC_CLOUD_INVALID);m.wrong_recipient=false;m.malformed=1;CHECK(pc_cloud_runtime(&cloud,0,NULL)==PC_CLOUD_INVALID);m.malformed=0;m.too_large=true;CHECK(pc_cloud_runtime(&cloud,0,NULL)==PC_CLOUD_TRANSPORT);m.too_large=false;
 m.malformed=13;CHECK(pc_cloud_runtime(&cloud,0,NULL)==PC_CLOUD_INVALID);m.malformed=0;
 for(int invalid=9;invalid<=10;invalid++){m.malformed=invalid;CHECK(pc_cloud_runtime(&cloud,0,NULL)==PC_CLOUD_INVALID);}m.malformed=0;

 uint8_t advertisement[30];CHECK(pc_presence_advertisement(&cloud,0,advertisement)&&advertisement[0]==29&&advertisement[4]==0x11);
 char advertised_tag[13];for(unsigned i=0;i<6;i++)snprintf(advertised_tag+i*2,3,"%02x",advertisement[24+i]);CHECK(!strcmp(advertised_tag,cJSON_GetObjectItemCaseSensitive(vectors,"own_presence_tag")->valuestring));
 CHECK(!pc_presence_advertisement(&cloud,15000,advertisement));
 nearby_participants_t nearby;nearby_init(&nearby);nearby_participant_t observation={.rssi=-50,.seen_ms=100,.presence_epoch=(uint32_t)cJSON_GetObjectItemCaseSensitive(vectors,"presence_epoch")->valuedouble};memset(observation.device_id,0x77,16);strcpy(observation.presence_tag,cJSON_GetObjectItemCaseSensitive(vectors,"peer_presence_tag")->valuestring);
 CHECK(pc_presence_observe(&nearby,&observation,device,100,-65)&&nearby_count(&nearby,100)==1);
 nearby_participant_t selected;CHECK(nearby_selected(&nearby,100,&selected)&&selected.presence_epoch==observation.presence_epoch&&!strcmp(selected.presence_tag,observation.presence_tag));
 pc_host_candidate candidate={0};CHECK(pc_cloud_host_candidate(&cloud,activity,&selected,&candidate)==PC_CLOUD_OK&&!strcmp(candidate.device_id,"77777777-7777-7777-7777-777777777777")&&!strcmp(candidate.label,"Rae"));
 pc_host_candidate retained_candidate=candidate;
 m.corrupt=true;CHECK(pc_cloud_host_candidate(&cloud,activity,&selected,&candidate)==PC_CLOUD_INVALID&&!memcmp(&candidate,&retained_candidate,sizeof(candidate)));m.corrupt=false;
 for(int invalid=11;invalid<=12;invalid++){m.malformed=invalid;CHECK(pc_cloud_host_candidate(&cloud,activity,&selected,&candidate)==PC_CLOUD_INVALID&&!memcmp(&candidate,&retained_candidate,sizeof(candidate)));}m.malformed=0;
 CHECK(!pc_presence_observe(&nearby,&observation,device,5100,-65)&&nearby_count(&nearby,5100)==0);
 observation.seen_ms=5200;CHECK(pc_presence_observe(&nearby,&observation,device,5200,-65));int old_selection=nearby.selected;observation.device_id[15]=0x78;CHECK(pc_presence_observe(&nearby,&observation,device,5200,-65)&&nearby_count(&nearby,5200)==2);
 CHECK(nearby_host_count(&nearby,5200)==0);nearby.entries[old_selection].host_eligible=true;nearby.entries[old_selection].host_checked_ms=5200;CHECK(nearby_host_count(&nearby,5200)==1);CHECK(nearby_host_count(&nearby,10200)==0);
 nearby.entries[old_selection].checked_in=true;CHECK(nearby_count(&nearby,5200)==1&&nearby_host_count(&nearby,5200)==1);CHECK(!nearby_selected(&nearby,5200,&selected));CHECK(nearby_prune_checked_selection(&nearby,5200)&&nearby.selected!=old_selection);nearby.entries[nearby.selected].checked_in=true;CHECK(nearby_prune_checked_selection(&nearby,5200)&&nearby.selected==-1);CHECK(!nearby_prune_checked_selection(&nearby,5200));for(unsigned k=0;k<NEARBY_CAPACITY;k++)nearby.entries[k].checked_in=false;nearby.selected=old_selection;
 CHECK(nearby_move(&nearby,1,5200)&&nearby.selected!=old_selection&&nearby_count(&nearby,5200)==2);CHECK(nearby_move(&nearby,-1,5200)&&nearby.selected==old_selection&&nearby_count(&nearby,5200)==2);
 observation.device_id[15]=0x77;observation.rssi=-80;CHECK(!pc_presence_observe(&nearby,&observation,device,5200,-65)&&nearby_count(&nearby,5200)==1);CHECK(nearby.entries[old_selection].device_id[15]==0x77&&!nearby_selected(&nearby,5200,&selected));
 pc_roster_page roster={0};CHECK(!strcmp(cloud.active_activity_id,activity));
 CHECK(pc_cloud_roster(&cloud,activity,0,&roster)==PC_CLOUD_OK&&roster.count==2&&roster.total==2&&!roster.has_more&&roster.title_bitmap_valid&&roster.members[0].name_bitmap_valid);
 CHECK(!strcmp(roster.members[0].name,"Rae")&&!roster.members[0].signed_in);
 pc_roster_page retained=roster;
 for(int invalid=5;invalid<=8;invalid++){m.malformed=invalid;CHECK(pc_cloud_roster(&cloud,activity,0,&roster)==PC_CLOUD_INVALID&&!memcmp(&roster,&retained,sizeof(roster)));}m.malformed=0;
 m.malformed=14;CHECK(pc_cloud_roster(&cloud,activity,0,&roster)==PC_CLOUD_INVALID&&!memcmp(&roster,&retained,sizeof(roster)));m.malformed=0;
 m.corrupt=true;CHECK(pc_cloud_roster(&cloud,activity,0,&roster)==PC_CLOUD_INVALID&&!memcmp(&roster,&retained,sizeof(roster)));m.corrupt=false;
 unsigned calls=m.requests;CHECK(pc_cloud_roster(&cloud,"bad",0,&roster)==PC_CLOUD_INVALID&&m.requests==calls);
 cJSON *result=NULL;set_error=ESP_FAIL;unsigned before=m.requests;CHECK(pc_cloud_batch_start(&cloud,0,batch,activity,&result)==PC_CLOUD_STORAGE&&m.requests==before);set_error=ESP_OK;m.timeout=true;CHECK(pc_cloud_batch_start(&cloud,0,batch,activity,&result)==PC_CLOUD_TRANSPORT);CHECK(store.data.pending[0].kind==PC_PENDING_BATCH&&state.unresolved);pc_store reload;CHECK(pc_store_load(&reload)==ESP_OK&&!strcmp(reload.data.pending[0].operation_id,batch));m.timeout=false;CHECK(pc_cloud_batch_start(&cloud,0,batch,activity,&result)==PC_CLOUD_OK);cJSON_Delete(result);CHECK(pc_cloud_batch_start(&cloud,0,retry,activity,&result)==PC_CLOUD_BUSY);CHECK(pc_cloud_batch_query(&cloud,0,&result)==PC_CLOUD_OK);CHECK(!strcmp(cJSON_GetObjectItemCaseSensitive(result,"state")->valuestring,"partial"));cJSON_Delete(result);m.malformed=2;CHECK(pc_cloud_batch_query(&cloud,0,&result)==PC_CLOUD_INVALID&&store.data.pending[0].kind==PC_PENDING_BATCH);m.malformed=0;CHECK(pc_cloud_batch_retry(&cloud,0,retry,&result)==PC_CLOUD_OK);CHECK(!strcmp(store.data.pending[0].retry_id,retry));cJSON_Delete(result);
 CHECK(pc_cloud_feedback_open(&cloud,session)==PC_CLOUD_OK);m.malformed=3;CHECK(pc_cloud_feedback_poll(&cloud,0,pulse,&m)==PC_CLOUD_INVALID&&m.pulses==0);m.malformed=4;CHECK(pc_cloud_feedback_poll(&cloud,0,pulse,&m)==PC_CLOUD_INVALID&&m.pulses==0);m.malformed=0;CHECK(pc_cloud_feedback_poll(&cloud,0,pulse,&m)==PC_CLOUD_OK&&m.pulses==1);CHECK(pc_cloud_feedback_poll(&cloud,0,pulse,&m)==PC_CLOUD_OK&&m.pulses==1);
 /* ACK loss retries ACK, never the visual feedback. */
 m.ack_timeout=true;CHECK(pc_cloud_feedback_poll(&cloud,0,pulse,&m)==PC_CLOUD_TRANSPORT&&m.pulses==1);m.ack_timeout=false;
 pc_cloud_disconnect(&cloud,1000);CHECK(state.page==PC_WIFI&&!cloud.feedback.active&&!cloud.clock_known);before=m.requests;CHECK(pc_cloud_feedback_poll(&cloud,1000,pulse,&m)==PC_CLOUD_INVALID&&m.requests==before);
 CHECK(pc_cloud_runtime(&cloud,1000,NULL)==PC_CLOUD_OK);CHECK(pc_cloud_feedback_open(&cloud,session)==PC_CLOUD_OK);CHECK(pc_cloud_feedback_poll(&cloud,1000,pulse,&m)==PC_CLOUD_OK&&m.pulses==1);
 /* A late packet is consumed without replaying an expired one-second effect. */
 cloud.feedback.cursor.consumed=0;store.data.feedback_consumed=0;m.latency_ms=12000;CHECK(pc_cloud_feedback_poll(&cloud,1000,pulse,&m)==PC_CLOUD_OK&&m.pulses==1);m.latency_ms=0;
 pc_pending_operation unknown={.kind=PC_PENDING_FRIEND};strcpy(unknown.operation_id,"99999999-9999-9999-9999-999999999999");CHECK(pc_store_pending_begin(&store,1,&unknown)==ESP_OK);CHECK(pc_cloud_operation_query(&cloud,1,&result)==PC_CLOUD_OK);CHECK(!strcmp(cJSON_GetObjectItemCaseSensitive(result,"state")->valuestring,"unknown")&&store.data.pending[1].kind==PC_PENDING_FRIEND);cJSON_Delete(result);

 app_services_bind(&store);network_profiles_t profiles={.version=1};network_profile_t home={.ssid="home",.password="12345678"},work={.ssid="work",.password="new-password"};CHECK(network_profiles_promote(&profiles,&home));CHECK(app_save_networks(&profiles));CHECK(pc_store_load(&reload)==ESP_OK&&reload.data.wifi_count==1&&!strcmp(reload.data.wifi[0].ssid,"home"));CHECK(network_profiles_promote(&profiles,&work));set_error=ESP_FAIL;CHECK(!app_save_networks(&profiles)&&store.data.wifi_count==1);set_error=ESP_OK;CHECK(app_save_networks(&profiles));network_profiles_t restored;CHECK(app_load_networks(&restored)&&restored.count==2&&!strcmp(restored.profiles[1].ssid,"home"));

 for(unsigned i=0;i<6;i++){network_profile_t p={.password="12345678"};snprintf(p.ssid,sizeof(p.ssid),"saved-%u",i);CHECK(network_profiles_promote(&profiles,&p));}CHECK(profiles.count==5&&!strcmp(profiles.profiles[0].ssid,"saved-5")&&!strcmp(profiles.profiles[4].ssid,"saved-1"));CHECK(app_save_networks(&profiles));CHECK(pc_store_load(&reload)==ESP_OK&&reload.data.wifi_count==5&&!strcmp(reload.data.wifi[4].ssid,"saved-1"));
 d=store.data;d.member_id[0]=0;d.hello_skipped=false;CHECK(pc_store_commit(&store,&d)==ESP_OK);pc_init(&state,false,false);pc_startup startup;pc_startup_init(&startup,&cloud);m.enrollment=1;m.ms=0;CHECK(pc_startup_poll(&startup,100)==PC_CLOUD_OK&&startup.phase==PC_BIND_WAITING&&state.page==PC_BIND);CHECK(!strcmp(startup.claim_code,"1234"));CHECK(startup.valid_seconds>0);CHECK(pc_press(&state,PC_POWER,false,101)==PC_NONE&&!state.help);
 m.enrollment=2;CHECK(pc_startup_poll(&startup,200)==PC_CLOUD_OK&&startup.phase==PC_BIND_CONFIRM&&startup.member_label_bitmap_valid);m.malformed=15;CHECK(pc_startup_poll(&startup,200)==PC_CLOUD_OK&&startup.phase==PC_BIND_CONFIRM&&!startup.member_label_bitmap_valid&&startup.member_label[0]);m.malformed=0;before=m.requests;CHECK(pc_startup_confirm(&startup,true,199)==PC_CLOUD_INVALID&&m.requests==before);m.confirm_timeout=true;CHECK(pc_startup_confirm(&startup,true,210)==PC_CLOUD_TRANSPORT&&startup.phase==PC_BIND_CHECKING);m.confirm_timeout=false;set_error=ESP_FAIL;CHECK(pc_startup_poll(&startup,211)==PC_CLOUD_STORAGE&&startup.phase==PC_BIND_STORAGE_ERROR&&!store.data.member_id[0]);set_error=ESP_OK;CHECK(pc_startup_poll(&startup,212)==PC_CLOUD_OK&&!strcmp(store.data.member_id,member));pc_tick(&state,512);CHECK(state.page==PC_BOUND);pc_press(&state,PC_OK,false,513);pc_tick(&state,813);CHECK(state.page==PC_HELLO);
 pc_init(&state,false,true);CHECK(pc_startup_poll(&startup,900)==PC_CLOUD_OK);pc_tick(&state,1200);CHECK(state.page==PC_HELLO);state.host_active=true;CHECK(pc_startup_poll(&startup,1201)==PC_CLOUD_OK&&state.host_active);
 d=store.data;d.member_id[0]=0;CHECK(pc_store_commit(&store,&d)==ESP_OK);pc_init(&state,false,false);pc_startup_init(&startup,&cloud);m.enrollment=2;CHECK(pc_startup_poll(&startup,1300)==PC_CLOUD_OK);CHECK(pc_startup_confirm(&startup,false,1301)==PC_CLOUD_OK&&startup.phase==PC_BIND_REJECTED&&!store.data.member_id[0]);m.enrollment=4;CHECK(pc_startup_poll(&startup,1302)==PC_CLOUD_OK&&startup.phase==PC_BIND_REVOKED&&state.page==PC_BIND);

 /* Durable recovery: timeout never invents success; retry keeps its ID until acknowledged. */
 CHECK(pc_store_pending_clear(&store,0,batch)==ESP_OK);CHECK(pc_store_pending_clear(&store,1,unknown.operation_id)==ESP_OK);
 pc_facts(&state,true,true,true,1400);state.unresolved=false;strcpy(cloud.active_activity_id,activity);
 pc_batch_controller controller;pc_batch_init(&controller,&cloud);m.enrollment=0;
 m.timeout=true;CHECK(pc_batch_start(&controller,batch,activity,1500)==PC_CLOUD_TRANSPORT&&controller.loaded&&!controller.known&&state.unresolved);
 CHECK(pc_batch_dismiss(&controller)==PC_CLOUD_BUSY&&store.data.pending[0].kind==PC_PENDING_BATCH);
 pc_batch_controller rebooted;pc_batch_init(&rebooted,&cloud);CHECK(rebooted.loaded&&!rebooted.known&&!strcmp(rebooted.operation_id,batch));
 m.timeout=false;CHECK(pc_batch_poll(&rebooted,1600)==PC_CLOUD_OK&&rebooted.known&&rebooted.phase==PC_BATCH_SOME_FAILED&&rebooted.total==2&&rebooted.signed_count==1&&rebooted.failed==1&&!state.unresolved);
 pc_tick(&state,1900);CHECK(state.page==PC_BATCH_PARTIAL);
 CHECK(pc_batch_start(&rebooted,retry,activity,1901)==PC_CLOUD_BUSY);
 unsigned saved_at=commits;CHECK(pc_batch_poll(&rebooted,1902)==PC_CLOUD_OK&&state.page==PC_BATCH_PARTIAL&&commits==saved_at);
 m.timeout=true;CHECK(pc_batch_poll(&rebooted,2000)==PC_CLOUD_TRANSPORT&&state.page==PC_BATCH_PARTIAL&&!state.unresolved&&rebooted.known);
 m.timeout=false;CHECK(pc_batch_poll(&rebooted,2100)==PC_CLOUD_OK&&!state.unresolved);
 set_error=ESP_FAIL;CHECK(pc_batch_dismiss(&rebooted)==PC_CLOUD_STORAGE&&rebooted.loaded);set_error=ESP_OK;
 m.retry_timeout=true;CHECK(pc_batch_retry(&rebooted,retry,2200)==PC_CLOUD_TRANSPORT&&!rebooted.known&&state.unresolved&&!strcmp(store.data.pending[0].retry_id,retry));
 pc_batch_init(&rebooted,&cloud);CHECK(rebooted.loaded&&!rebooted.known);m.retry_timeout=false;
 CHECK(pc_batch_poll(&rebooted,2201)==PC_CLOUD_OK&&rebooted.phase==PC_BATCH_SOME_FAILED);
 CHECK(pc_batch_retry(&rebooted,"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",2202)==PC_CLOUD_OK&&rebooted.phase==PC_BATCH_WORKING&&state.unresolved&&!store.data.pending[0].retry_id[0]);
 CHECK(pc_batch_dismiss(&rebooted)==PC_CLOUD_BUSY);
 CHECK(pc_batch_poll(&rebooted,2300)==PC_CLOUD_OK&&rebooted.phase==PC_BATCH_SOME_FAILED);
 m.batch_completed=true;CHECK(pc_batch_poll(&rebooted,2400)==PC_CLOUD_OK&&rebooted.phase==PC_BATCH_ALL_OK&&rebooted.signed_count==2&&rebooted.failed==0);pc_tick(&state,2700);CHECK(state.page==PC_BATCH_SUCCESS&&!state.unresolved);
 CHECK(pc_batch_dismiss(&rebooted)==PC_CLOUD_OK&&!rebooted.loaded&&store.data.pending[0].kind==PC_PENDING_NONE);



 /* Single operation survives lost response and reboot; saved receipt wins before any replay. */
 d=store.data;strcpy(d.member_id,member);CHECK(pc_store_commit(&store,&d)==ESP_OK);
 pc_facts(&state,true,true,true,0);state.unresolved=false;strcpy(cloud.active_activity_id,activity);cloud.server_ms=0;cloud.clock_known=true;
 nearby_participant_t single_peer={.rssi=-50,.seen_ms=0,.presence_epoch=(uint32_t)cJSON_GetObjectItemCaseSensitive(vectors,"presence_epoch")->valuedouble};memset(single_peer.device_id,0x77,16);strcpy(single_peer.presence_tag,cJSON_GetObjectItemCaseSensitive(vectors,"peer_presence_tag")->valuestring);
 pc_single_controller single;pc_single_init(&single,&cloud);set_error=ESP_FAIL;unsigned requests_before=m.requests;
 CHECK(pc_single_begin(&single,"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",activity,&single_peer,0)==PC_CLOUD_STORAGE&&m.requests==requests_before&&!single.loaded);set_error=ESP_OK;
 m.single_timeout=true;CHECK(pc_single_begin(&single,"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",activity,&single_peer,0)==PC_CLOUD_TRANSPORT&&single.loaded&&state.unresolved);
 CHECK(pc_store_load(&reload)==ESP_OK&&!strcmp(reload.data.pending[0].peer_device_id,"77777777-7777-7777-7777-777777777777")&&reload.data.pending[0].detail.single.epoch==single_peer.presence_epoch&&!strcmp(reload.data.pending[0].detail.single.tag,single_peer.presence_tag));
 pc_single_init(&single,&cloud);CHECK(single.loaded);m.single_timeout=false;set_error=ESP_FAIL;
 CHECK(pc_single_recover(&single,NULL,1)==PC_CLOUD_STORAGE&&single.loaded&&store.data.pending[0].kind==PC_PENDING_SINGLE);set_error=ESP_OK;
 requests_before=m.requests;CHECK(pc_single_recover(&single,NULL,2)==PC_CLOUD_OK&&!single.loaded&&!state.unresolved&&m.requests==requests_before+1);pc_tick(&state,302);CHECK(state.page==PC_SINGLE_SUCCESS);
 m.single_saved=false;CHECK(pc_single_begin(&single,"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",activity,&single_peer,6000)==PC_CLOUD_BUSY);


 /* Only explicit retry can replay an unknown request; never change the intent/ID. */
 m.single_not_delivered=true;m.single_timeout=true;CHECK(pc_single_begin(&single,"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",activity,&single_peer,0)==PC_CLOUD_TRANSPORT);
 requests_before=m.requests;CHECK(pc_single_recover(&single,NULL,1)==PC_CLOUD_OK&&single.loaded&&!state.unresolved&&state.page==PC_SINGLE_FAILED&&m.requests==requests_before+1);
 nearby_participant_t wrong_peer=single_peer;wrong_peer.device_id[15]=0x78;CHECK(pc_single_retry(&single,&wrong_peer,2)==PC_CLOUD_BUSY&&single.loaded);
 m.single_timeout=false;requests_before=m.requests;CHECK(pc_single_retry(&single,&single_peer,3)==PC_CLOUD_OK&&!single.loaded&&m.requests==requests_before+1);
 m.single_timeout=true;CHECK(pc_single_begin(&single,"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",activity,&single_peer,0)==PC_CLOUD_TRANSPORT);
 m.runtime_closed=true;CHECK(pc_cloud_runtime(&cloud,5,activity)==PC_CLOUD_OK&&cloud.known_activity_closed&&!state.host_active);
 CHECK(pc_single_recover(&single,NULL,6)==PC_CLOUD_OK&&!single.loaded&&!state.unresolved);pc_tick(&state,306);CHECK(state.page==PC_PLANET);m.runtime_closed=false;m.single_timeout=false;
 pc_facts(&state,true,true,true,0);state.unresolved=false;strcpy(cloud.active_activity_id,activity);cloud.server_ms=0;cloud.known_activity_closed=false;
 m.single_timeout=true;CHECK(pc_single_begin(&single,"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",activity,&single_peer,0)==PC_CLOUD_TRANSPORT);
 CHECK(pc_single_recover(&single,NULL,1)==PC_CLOUD_OK&&!state.unresolved);
 CHECK(pc_single_abandon(&single,2)==PC_CLOUD_OK&&!single.loaded);pc_tick(&state,302);CHECK(state.page==PC_HOST);m.single_timeout=false;
 pc_friend_session friend_session={0};CHECK(pc_friend_request(&cloud,&friend_session)==PC_CLOUD_OK&&!strcmp(friend_session.state,"searching"));CHECK(pc_friend_poll(&cloud,&friend_session)==PC_CLOUD_OK&&!strcmp(friend_session.state,"searching"));
 m.corrupt=true;CHECK(pc_friend_poll(&cloud,&friend_session)==PC_CLOUD_INVALID&&!strcmp(friend_session.state,"searching"));m.corrupt=false;

 m.friend_waiting=true;CHECK(pc_friend_poll(&cloud,&friend_session)==PC_CLOUD_OK&&strlen(friend_session.code)==4);
 pc_facts(&state,true,true,false,10);state.unresolved=false;
 pc_friend_flow flow={0};pc_friend_flow_update(&flow,&friend_session,100);pc_friend_flow_visible(&flow,friend_session.interaction_id,friend_session.code,100);pc_friend_flow_tick(&flow,10099);CHECK(!flow.timed_out);pc_friend_flow_tick(&flow,10100);CHECK(flow.timed_out);
 pc_friend_flow_update(&flow,&friend_session,10200);CHECK(flow.timed_out&&flow.shown_ms==100);
 pc_friend_session fresh_session=friend_session;fresh_session.code[0]=fresh_session.code[0]=='0'?'1':'0';pc_friend_flow_update(&flow,&fresh_session,10300);CHECK(!flow.timed_out&&flow.shown_ms==10300);pc_friend_flow_tick(&flow,30300);CHECK(!flow.timed_out);pc_friend_flow_visible(&flow,fresh_session.interaction_id,fresh_session.code,30300);CHECK(pc_friend_flow_accepts_key(&flow,fresh_session.interaction_id,fresh_session.code,40299));pc_friend_flow_tick(&flow,40300);CHECK(flow.timed_out&&pc_friend_flow_accepts_key(&flow,fresh_session.interaction_id,fresh_session.code,40299));CHECK(!pc_friend_flow_accepts_key(&flow,fresh_session.interaction_id,fresh_session.code,40300));CHECK(!pc_friend_flow_accepts_key(&flow,fresh_session.interaction_id,"0000",30301));
 pc_friend_session expired={0};strcpy(expired.state,"idle");
 pc_friend_flow_update(&flow,&expired,10400);CHECK(flow.timed_out&&!strcmp(flow.session.code,fresh_session.code)&&flow.active);
 CHECK(friend_session.visual.valid&&!friend_session.visual.self.fallback&&!friend_session.visual.peer.fallback&&friend_session.visual.self.hair_length==PC_HAIR_LONG&&friend_session.visual.peer.hair_length==PC_HAIR_SHORT&&friend_session.visual.self.hair_rgb==0x1806&&friend_session.visual.peer.hair_rgb==0xaa45);
 for(int invalid=15;invalid<=20;invalid++){m.malformed=invalid;pc_friend_session malformed;CHECK(pc_friend_poll(&cloud,&malformed)==PC_CLOUD_OK&&!malformed.visual.valid);}m.malformed=0;
 m.malformed=21;pc_friend_session black;CHECK(pc_friend_poll(&cloud,&black)==PC_CLOUD_OK&&black.visual.valid&&black.visual.self.hair_rgb==0);m.malformed=22;pc_friend_session fallback;CHECK(pc_friend_poll(&cloud,&fallback)==PC_CLOUD_OK&&fallback.visual.valid&&!fallback.visual.self.fallback&&fallback.visual.peer.fallback);m.malformed=0;
 pc_friend_session displayed=friend_session;set_error=ESP_FAIL;requests_before=m.requests;
 CHECK(pc_friend_confirm(&cloud,&displayed,&friend_session)==PC_CLOUD_STORAGE&&m.requests==requests_before);set_error=ESP_OK;
 m.friend_timeout=true;CHECK(pc_friend_confirm(&cloud,&displayed,&friend_session)==PC_CLOUD_TRANSPORT&&state.unresolved);
 CHECK(pc_store_load(&reload)==ESP_OK&&!strcmp(reload.data.pending[0].detail.pairing.code,displayed.code)&&!strcmp(reload.data.pending[0].detail.pairing.nonce,displayed.nonce));
 pc_friend_session wrong=displayed;wrong.code[0]=wrong.code[0]=='0'?'1':'0';CHECK(pc_friend_confirm(&cloud,&wrong,&friend_session)==PC_CLOUD_BUSY);
 m.friend_timeout=false;CHECK(pc_friend_confirm(&cloud,&displayed,&friend_session)==PC_CLOUD_OK&&!strcmp(friend_session.state,"waiting"));
 CHECK(pc_store_load(&reload)==ESP_OK);pc_state reboot_state;pc_init(&reboot_state,true,true);pc_cloud reboot_cloud;pc_cloud_init(&reboot_cloud,&reload,&reboot_state,crypto,&reload,transport,&m);m.store=&reload;
 m.friend_saved=true;bool restored_saved=false;pc_friend_session restored_friend={0};set_error=ESP_FAIL;
 CHECK(pc_friend_recover(&reboot_cloud,400,&restored_saved,&restored_friend)==PC_CLOUD_STORAGE&&reload.data.pending[0].kind==PC_PENDING_FRIEND&&!restored_saved);set_error=ESP_OK;
 CHECK(pc_friend_recover(&reboot_cloud,401,&restored_saved,&restored_friend)==PC_CLOUD_OK&&restored_saved&&!reload.data.pending[0].kind&&!strcmp(restored_friend.state,"done")&&!strcmp(restored_friend.interaction_id,displayed.interaction_id)&&restored_friend.visual.valid&&restored_friend.visual.self.hair_length==PC_HAIR_LONG&&restored_friend.visual.peer.hair_rgb==0xaa45&&reboot_state.friend_resume==PC_FRIEND_ANIMATION);
 restored_friend.visual.valid=false;CHECK(pc_friend_visual_refresh(&cloud,&restored_friend)==PC_CLOUD_OK&&restored_friend.visual.valid);
 m.malformed=15;restored_friend.visual.valid=false;CHECK(pc_friend_visual_refresh(&cloud,&restored_friend)==PC_CLOUD_INVALID&&!restored_friend.visual.valid);m.malformed=0;
 store=reload;m.store=&store;state=reboot_state;pc_facts(&state,true,true,false,402);
 m.friend_saved=false;state.unresolved=false;

 pc_pending_operation retire_op={.kind=PC_PENDING_FRIEND,.occurred_at=displayed.occurred_at};strcpy(retire_op.operation_id,"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");strcpy(retire_op.peer_device_id,displayed.device_b);strcpy(retire_op.detail.pairing.nonce,displayed.nonce);strcpy(retire_op.detail.pairing.code,displayed.code);
 CHECK(pc_store_pending_begin(&store,0,&retire_op)==ESP_OK);state.unresolved=true;pc_friend_session retired=displayed;strcpy(retired.interaction_id,retire_op.operation_id);
 m.friend_timeout=true;CHECK(pc_friend_cancel(&cloud,&retired,&friend_session)==PC_CLOUD_TRANSPORT&&store.data.pending[0].kind==PC_PENDING_FRIEND&&state.unresolved);
 m.friend_timeout=false;set_error=ESP_FAIL;CHECK(pc_friend_cancel(&cloud,&retired,&friend_session)==PC_CLOUD_STORAGE&&store.data.pending[0].kind==PC_PENDING_FRIEND);set_error=ESP_OK;
 CHECK(pc_friend_cancel(&cloud,&retired,&friend_session)==PC_CLOUD_OK&&!strcmp(friend_session.state,"idle")&&!store.data.pending[0].kind&&!state.unresolved);
 /* Fresh-board setup is atomic, replay-resistant and never replaces an identity. */
 d=store.data;memset(d.device_id,0,sizeof(d.device_id));memset(d.device_token,0,sizeof(d.device_token));memset(d.server_origin,0,sizeof(d.server_origin));memset(d.member_id,0,sizeof(d.member_id));CHECK(pc_store_commit(&store,&d)==ESP_OK);
 char setup[512];snprintf(setup,sizeof(setup),"{\"device_id\":\"%s\",\"device_token\":\"%064d\",\"server_origin\":\"https://example.test\",\"nonce\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"board_uid\":\"112233445566\"}",device,0);
 CHECK(pc_identity_apply(&store,setup,"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","112233445566")==PC_CLOUD_INVALID&&!store.data.device_id[0]);
 CHECK(pc_identity_apply(&store,setup,"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","665544332211")==PC_CLOUD_INVALID&&!store.data.device_id[0]);
 set_error=ESP_FAIL;CHECK(pc_identity_apply(&store,setup,"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","112233445566")==PC_CLOUD_STORAGE&&!store.data.device_id[0]);set_error=ESP_OK;
 CHECK(pc_identity_apply(&store,setup,"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","112233445566")==PC_CLOUD_OK&&!strcmp(store.data.device_id,device)&&store.data.wifi_count==5);
 CHECK(pc_store_load(&reload)==ESP_OK&&!strcmp(reload.data.device_id,device));
 CHECK(pc_identity_apply(&store,setup,"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","112233445566")==PC_CLOUD_BUSY);
 /* Signed reset clears this app only; invalid signature/write failure preserve the exact old record. */
 d=store.data;memset(d.device_token,'a',64);strcpy(d.member_id,member);d.wifi_count=1;strcpy(d.wifi[0].ssid,"private-test");strcpy(d.wifi[0].password,"test-secret");d.hello_skipped=true;d.palette=2;d.planet_revision=42;CHECK(pc_store_commit(&store,&d)==ESP_OK);
 pc_startup_init(&startup,&cloud);m.enrollment=5;m.corrupt=true;CHECK(pc_startup_poll(&startup,2000)==PC_CLOUD_INVALID&&!startup.reset_ready&&!memcmp(&store.data,&d,sizeof(d)));m.corrupt=false;
 set_error=ESP_FAIL;CHECK(pc_startup_poll(&startup,2001)==PC_CLOUD_STORAGE&&!startup.reset_ready&&!memcmp(&store.data,&d,sizeof(d)));set_error=ESP_OK;
 CHECK(pc_startup_poll(&startup,2002)==PC_CLOUD_OK&&startup.reset_ready);
 CHECK(!store.data.member_id[0]&&!store.data.wifi_count&&!store.data.hello_skipped&&!store.data.planet_revision);
 CHECK(strcmp(store.data.device_id,device)&&strlen(store.data.device_token)==64&&!strcmp(store.data.server_origin,d.server_origin));
 pc_store reloaded;CHECK(pc_store_load(&reloaded)==ESP_OK&&!memcmp(&reloaded.data,&store.data,sizeof(store.data)));
 cJSON_Delete(vectors);printf("cloud/startup protocol: %u assertions passed against actual backend signatures and responses\n",checks);
}
