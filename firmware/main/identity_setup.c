#include "identity_setup.h"
#include <string.h>
static const char *field(cJSON *r,const char *key){cJSON *v=cJSON_GetObjectItemCaseSensitive(r,key);return cJSON_IsString(v)?v->valuestring:NULL;}
pc_cloud_result pc_identity_apply(pc_store *store,const char *json,const char *nonce,const char *board_uid){
 if(!store||!json||!nonce||strlen(nonce)!=32||!board_uid||strlen(board_uid)!=12||!store->writable)return PC_CLOUD_INVALID;
 if(store->data.device_id[0]||store->data.device_token[0]||store->data.server_origin[0]||store->data.member_id[0])return PC_CLOUD_BUSY;
 for(unsigned i=0;i<PC_PENDING_OPERATIONS;i++)if(store->data.pending[i].kind)return PC_CLOUD_BUSY;
 const char *end=NULL;cJSON *r=cJSON_ParseWithLengthOpts(json,strlen(json)+1,&end,1);
 const char *id=field(r,"device_id"),*token=field(r,"device_token"),*origin=field(r,"server_origin"),*received=field(r,"nonce"),*board=field(r,"board_uid");
 bool valid=id&&pc_cloud_uuid(id)&&token&&strlen(token)==64&&origin&&pc_cloud_origin_valid(origin)&&received&&!strcmp(received,nonce)&&board&&!strcmp(board,board_uid);
 for(unsigned i=0;valid&&i<64;i++)if(!((token[i]>='a'&&token[i]<='f')||(token[i]>='0'&&token[i]<='9')))valid=false;
 pc_cloud_result result=PC_CLOUD_INVALID;
 if(valid){pc_personal_data next=store->data;memcpy(next.device_id,id,37);memcpy(next.device_token,token,65);strcpy(next.server_origin,origin);result=pc_store_commit(store,&next)==ESP_OK?PC_CLOUD_OK:PC_CLOUD_STORAGE;memset(&next,0,sizeof(next));}
 if(token){memset((char *)token,0,strlen(token));}
 cJSON_Delete(r);return result;
}
