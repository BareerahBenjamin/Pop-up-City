#include "event_save_model.h"
#include <string.h>
_Static_assert(24u+1u+37u+37u+65u+193u+1u+PC_WIFI_PROFILES*98u+PC_PENDING_OPERATIONS*(112u+83u)+37u+8u+1u+16u<=PC_RECORD_BYTES-4u,"wire fields exceed record capacity");
static uint32_t get32(const uint8_t *p){return (uint32_t)p[0]|(uint32_t)p[1]<<8|(uint32_t)p[2]<<16|(uint32_t)p[3]<<24;}
static void put32(uint8_t *p,uint32_t n){for(unsigned i=0;i<4;i++)p[i]=(uint8_t)(n>>(i*8));}
static uint32_t checksum(const uint8_t *p,size_t n){uint32_t h=2166136261u;for(size_t i=0;i<n;i++){h^=p[i];h*=16777619u;}return h;}
static bool terminated(const char *s,size_t n){return memchr(s,0,n)!=NULL;}
static bool uuid_or_empty(const char s[37]){if(!terminated(s,37))return false;if(!s[0])return true;if(strlen(s)!=36)return false;for(unsigned i=0;i<36;i++){if(i==8||i==13||i==18||i==23){if(s[i]!='-')return false;}else if(!((s[i]>='a'&&s[i]<='f')||(s[i]>='0'&&s[i]<='9')))return false;}return true;}
bool pc_app_id_valid(const char *s){if(!s)return false;size_t n=strlen(s);if(n<3||n>15||s[0]<'a'||s[0]>'z')return false;for(size_t i=1;i<n;i++)if(!((s[i]>='a'&&s[i]<='z')||(s[i]>='0'&&s[i]<='9')||s[i]=='_'))return false;return true;}
static bool fixed_hex(const char *s,unsigned size){if(s[size])return false;for(unsigned i=0;i<size;i++)if(!((s[i]>='a'&&s[i]<='f')||(s[i]>='0'&&s[i]<='9')))return false;return true;}
bool pc_personal_valid(const pc_personal_data *d){
 if(!d||!uuid_or_empty(d->device_id)||!uuid_or_empty(d->member_id)||!terminated(d->device_token,sizeof(d->device_token))||!terminated(d->server_origin,sizeof(d->server_origin))||d->wifi_count>PC_WIFI_PROFILES||!uuid_or_empty(d->feedback_session)||d->feedback_consumed>9007199254740991ULL||d->palette>4)return false;
 if(d->feedback_consumed&&!d->feedback_session[0])return false;
 if(d->device_token[0]){if(strlen(d->device_token)!=64)return false;for(unsigned i=0;i<64;i++)if(!((d->device_token[i]>='0'&&d->device_token[i]<='9')||(d->device_token[i]>='a'&&d->device_token[i]<='f')))return false;}
 for(unsigned i=0;i<PC_WIFI_PROFILES;i++)if(!terminated(d->wifi[i].ssid,33)||!terminated(d->wifi[i].password,65))return false;
 for(unsigned i=0;i<PC_PENDING_OPERATIONS;i++){const pc_pending_operation *p=&d->pending[i];if(p->kind>PC_PENDING_BATCH||!uuid_or_empty(p->operation_id)||!uuid_or_empty(p->activity_id)||!uuid_or_empty(p->retry_id))return false;if(p->kind&&(!p->operation_id[0]||(p->kind!=PC_PENDING_FRIEND&&!p->activity_id[0])))return false;if(!p->kind&&(p->operation_id[0]||p->activity_id[0]||p->retry_id[0]))return false;}
 for(unsigned i=0;i<PC_PENDING_OPERATIONS;i++){
  const pc_pending_operation *p=&d->pending[i];if(!uuid_or_empty(p->peer_device_id))return false;
  if(!p->peer_device_id[0]){if(p->occurred_at)return false;continue;}
  if(!p->occurred_at||p->occurred_at>9007199254740991ULL)return false;
  if(p->kind==PC_PENDING_SINGLE){if(!p->detail.single.epoch||!fixed_hex(p->detail.single.tag,12))return false;}
  else if(p->kind==PC_PENDING_FRIEND){if(!fixed_hex(p->detail.pairing.nonce,32)||p->detail.pairing.code[4])return false;for(unsigned n=0;n<4;n++)if(p->detail.pairing.code[n]<'0'||p->detail.pairing.code[n]>'9')return false;}
  else return false;
 }
 for(unsigned i=0;i<PC_PENDING_OPERATIONS;i++)for(unsigned j=i+1;j<PC_PENDING_OPERATIONS;j++)if(d->pending[i].kind&&d->pending[j].kind&&!strcmp(d->pending[i].operation_id,d->pending[j].operation_id))return false;
 return true;
}
/* Pack only logical fields. Canonical zero padding avoids persisting stale RAM bytes. */
static void string_write(uint8_t **p,const char *s,size_t size){size_t n=strlen(s);memcpy(*p,s,n);*p+=size;}
bool pc_record_encode(const char *id,const pc_personal_data *d,event_save_record_t *r){
 if(!r||!pc_app_id_valid(id)||!pc_personal_valid(d))return false;
 memset(r,0,sizeof(*r));uint8_t *p=r->bytes;put32(p,EVENT_SAVE_MAGIC);put32(p+4,EVENT_SAVE_SCHEMA_VERSION);memcpy(p+8,id,strlen(id));p+=24;*p++=d->hello_skipped?1:0;
 string_write(&p,d->device_id,37);string_write(&p,d->member_id,37);string_write(&p,d->device_token,65);string_write(&p,d->server_origin,193);*p++=d->wifi_count;
 for(unsigned i=0;i<PC_WIFI_PROFILES;i++){string_write(&p,d->wifi[i].ssid,33);string_write(&p,d->wifi[i].password,65);}
 for(unsigned i=0;i<PC_PENDING_OPERATIONS;i++){const pc_pending_operation *q=&d->pending[i];*p++=q->kind;string_write(&p,q->operation_id,37);string_write(&p,q->activity_id,37);string_write(&p,q->retry_id,37);}
 string_write(&p,d->feedback_session,37);put32(p,(uint32_t)d->feedback_consumed);put32(p+4,(uint32_t)(d->feedback_consumed>>32));p+=8;*p++=d->palette;
 put32(p,d->planet_revision);put32(p+4,d->legacy_primary);put32(p+8,d->legacy_secondary);put32(p+12,d->legacy_launches);
 p+=16;
 for(unsigned i=0;i<PC_PENDING_OPERATIONS;i++){
  const pc_pending_operation *q=&d->pending[i];string_write(&p,q->peer_device_id,37);put32(p,(uint32_t)q->occurred_at);put32(p+4,(uint32_t)(q->occurred_at>>32));p+=8;
  if(q->peer_device_id[0]&&q->kind==PC_PENDING_FRIEND){string_write(&p,q->detail.pairing.nonce,33);string_write(&p,q->detail.pairing.code,5);}
  else {if(q->peer_device_id[0]&&q->kind==PC_PENDING_SINGLE){put32(p,q->detail.single.epoch);uint8_t *tag=p+4;string_write(&tag,q->detail.single.tag,13);}p+=38;}
 }
 put32(r->bytes+PC_RECORD_BYTES-4,checksum(r->bytes,PC_RECORD_BYTES-4));return true;
}
static void string_read(const uint8_t **p,char *out,size_t n){memcpy(out,*p,n);*p+=n;}
bool pc_record_decode(const void *bytes,size_t size,const char *id,pc_personal_data *out,bool *migrated){
 if(!bytes||!out||!pc_app_id_valid(id)||(size!=32&&size!=PC_RECORD_BYTES))return false;
 const uint8_t *b=bytes;
 if(get32(b)!=EVENT_SAVE_MAGIC||get32(b+size-4)!=checksum(b,size-4))return false;
 uint32_t version=get32(b+4);pc_personal_data d={0};
 if(version==1&&size==32){if(strlen(id)>7||!memchr(b+8,0,8)||strcmp((const char *)b+8,id))return false;d.legacy_primary=get32(b+16);d.legacy_secondary=get32(b+20);d.legacy_launches=get32(b+24);if(migrated)*migrated=true;*out=d;return true;}
 if((version!=2&&version!=3)||size!=PC_RECORD_BYTES||!memchr(b+8,0,16)||strcmp((const char *)b+8,id))return false;
 const uint8_t *p=b+24;if(*p>1)return false;d.hello_skipped=*p++!=0;
 string_read(&p,d.device_id,37);string_read(&p,d.member_id,37);string_read(&p,d.device_token,65);string_read(&p,d.server_origin,193);d.wifi_count=*p++;
 for(unsigned i=0;i<PC_WIFI_PROFILES;i++){string_read(&p,d.wifi[i].ssid,33);string_read(&p,d.wifi[i].password,65);}
 for(unsigned i=0;i<PC_PENDING_OPERATIONS;i++){pc_pending_operation *q=&d.pending[i];q->kind=*p++;string_read(&p,q->operation_id,37);string_read(&p,q->activity_id,37);string_read(&p,q->retry_id,37);}
 string_read(&p,d.feedback_session,37);d.feedback_consumed=(uint64_t)get32(p)|(uint64_t)get32(p+4)<<32;p+=8;d.palette=*p++;d.planet_revision=get32(p);d.legacy_primary=get32(p+4);d.legacy_secondary=get32(p+8);d.legacy_launches=get32(p+12);
 p+=16;
 if(version==3)for(unsigned i=0;i<PC_PENDING_OPERATIONS;i++){
  pc_pending_operation *q=&d.pending[i];string_read(&p,q->peer_device_id,37);q->occurred_at=(uint64_t)get32(p)|((uint64_t)get32(p+4)<<32);p+=8;
  if(q->kind==PC_PENDING_FRIEND){string_read(&p,q->detail.pairing.nonce,33);string_read(&p,q->detail.pairing.code,5);}
  else {if(q->kind==PC_PENDING_SINGLE){q->detail.single.epoch=get32(p);const uint8_t *tag=p+4;string_read(&tag,q->detail.single.tag,13);}p+=38;}
 }
 if(!pc_personal_valid(&d))return false;
 if(migrated)*migrated=version==2;
 *out=d;return true;
}
bool event_save_record_valid(const event_save_record_t *r,const char *id){pc_personal_data d;return r&&pc_record_decode(r->bytes,sizeof(r->bytes),id,&d,NULL);}
