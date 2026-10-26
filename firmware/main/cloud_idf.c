#include "cloud_idf.h"
#include "diagnostic_labels.h"
#include "memory_report.h"
#include "esp_http_client.h"
#include "esp_crt_bundle.h"
#include "esp_tls_errors.h"
#include <errno.h>
#include "esp_timer.h"
#include "esp_log.h"
#include "esp_heap_caps.h"
#include "mbedtls/md.h"
#include "mbedtls/sha256.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static pc_transport_error last_error;
static esp_http_client_handle_t retained;
static bool reuse;
static uint32_t retained_used_ms;
static char retained_origin[193];
void pc_cloud_transport_reuse(bool enabled){reuse=enabled;if(retained&&(!enabled||(uint32_t)((uint32_t)(esp_timer_get_time()/1000)-retained_used_ms)>=15000u||heap_caps_get_free_size(MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT)<12288u)){esp_http_client_cleanup(retained);retained=NULL;retained_origin[0]=0;}}

pc_transport_error pc_cloud_transport_last_error(void){return last_error;}
static uint32_t clock_ms(void *unused){(void)unused;return (uint32_t)(esp_timer_get_time()/1000);}
static bool sign(void *context,const char *text,char out[65]){
 pc_store *store=context;unsigned char key[32],digest[32];
 if(mbedtls_sha256((const unsigned char *)store->data.device_token,strlen(store->data.device_token),key,0)!=0)return false;
 const mbedtls_md_info_t *info=mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
 bool ok=info&&mbedtls_md_hmac(info,key,sizeof(key),(const unsigned char *)text,strlen(text),digest)==0;
 if(ok)for(unsigned i=0;i<32;i++)snprintf(out+i*2,3,"%02x",digest[i]);
 memset(key,0,sizeof(key));memset(digest,0,sizeof(digest));return ok;
}
static bool deadline(esp_http_client_handle_t h,int64_t start){
 int64_t left=10000-(esp_timer_get_time()-start)/1000;if(left<=0)return false;
 return esp_http_client_set_timeout_ms(h,(int)(left<8000?left:8000))==ESP_OK;
}
static bool exchange(void *context,bool get,const char *path,const char *body,char **output,size_t capacity,size_t *allocated_bytes,int *status){
 *output=NULL;*allocated_bytes=0;char *out=NULL;last_error=PC_TRANSPORT_IO;
 pc_store *store=context;char url[384],auth[80];
 if(!pc_cloud_origin_valid(store->data.server_origin)||path[0]!='/'||strlen(path)>180||capacity<2)return false;
 int n=snprintf(url,sizeof(url),"%s%s",store->data.server_origin,path);if(n<0||(size_t)n>=sizeof(url))return false;
 snprintf(auth,sizeof(auth),"Bearer %s",store->data.device_token);
 esp_http_client_config_t config={.url=url,.timeout_ms=8000,.buffer_size=1024,.disable_auto_redirect=true,.crt_bundle_attach=esp_crt_bundle_attach,.keep_alive_enable=true};
 if(retained&&strcmp(retained_origin,store->data.server_origin)){esp_http_client_cleanup(retained);retained=NULL;retained_origin[0]=0;}
 esp_http_client_handle_t h=retained;bool reused=h!=NULL;retained=NULL;
 if(!h)h=esp_http_client_init(&config);
 else if(esp_http_client_set_url(h,url)!=ESP_OK){esp_http_client_cleanup(h);h=NULL;}
 if(!h){memset(auth,0,sizeof(auth));return false;}
 esp_http_client_set_header(h,"Authorization",auth);memset(auth,0,sizeof(auth));
 esp_http_client_set_header(h,"Content-Type","application/json");esp_http_client_set_header(h,"Connection",reuse?"keep-alive":"close");esp_http_client_set_method(h,get?HTTP_METHOD_GET:HTTP_METHOD_POST);
 size_t body_size=get?0:strlen(body),sent=0,used=0;int64_t started=esp_timer_get_time();bool ok=false;const char *reason="open";int last_read=0;int64_t content_length=-1;
 ESP_LOGI("pc_diag_http","start type=%s method=%s cap=%u reused=%d",pc_diag_request(path),get?"GET":"POST",(unsigned)capacity,reused);
 pc_memory_report("tls_before");
 if(!deadline(h,started)||esp_http_client_open(h,(int)body_size)!=ESP_OK)goto done;
 pc_memory_report("tls_open");reason="write";
 while(sent<body_size){if(!deadline(h,started))goto done;int written=esp_http_client_write(h,body+sent,(int)(body_size-sent));if(written<=0)goto done;sent+=(size_t)written;}
 reason="headers";if(!deadline(h,started)||esp_http_client_fetch_headers(h)<0)goto done;
 *status=esp_http_client_get_status_code(h);content_length=esp_http_client_get_content_length(h);reason="allocation";
 /* Allocate only after headers. TLS can still own buffers here; bound the
  * response separately and grow unknown-length bodies only when needed. */
 if(content_length>=0&&(uint64_t)content_length>=capacity){reason="content_too_large";goto done;}
 size_t reserved=content_length>0?(size_t)content_length+1:(capacity<2048?capacity:2048);
 out=calloc(1,reserved);if(!out){last_error=PC_TRANSPORT_MEMORY;goto done;}*output=out;*allocated_bytes=reserved;reason="read";
 while(used<capacity-1){
  if(used==reserved-1){/* Chunked host payloads must not demand an 8KiB block when 5KiB suffices. */size_t next=capacity-reserved<1024?capacity:reserved+1024;char *grown=realloc(out,next);if(!grown){last_error=PC_TRANSPORT_MEMORY;reason="grow";goto done;}out=grown;reserved=next;*output=out;*allocated_bytes=reserved;}
  if(!deadline(h,started))goto done;
  int got=esp_http_client_read(h,out+used,(int)(reserved-1-used));last_read=got;if(got<0){reason="read_error";goto done;}used+=(size_t)got;
  if(esp_http_client_is_complete_data_received(h)){out[used]=0;ok=used>0&&esp_timer_get_time()-started<=10000000;reason=ok?"complete":"empty_or_deadline";break;}
  if(got==0){reason="incomplete_eof";goto done;}
 }
 done:
 if(!ok&&out&&used==capacity-1)reason="capacity_exhausted";
 int socket_code=esp_http_client_get_errno(h);
 ESP_LOGI("pc_diag_http","end type=%s ok=%d reason=%s http=%d received=%u content=%lld cap=%u last_read=%d errno=%d elapsed_ms=%lld free=%u largest=%u",pc_diag_request(path),ok,reason,*status,(unsigned)used,(long long)content_length,(unsigned)capacity,last_read,socket_code,(long long)((esp_timer_get_time()-started)/1000),(unsigned)esp_get_free_heap_size(),(unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_8BIT));
 if(ok)last_error=PC_TRANSPORT_NONE;
 else if(last_error!=PC_TRANSPORT_MEMORY){
  int tls_error=0,flags=0;
  esp_err_t tls=esp_http_client_get_and_clear_last_tls_error(h,&tls_error,&flags);
  int socket_error=esp_http_client_get_errno(h);
  if(tls==ESP_ERR_ESP_TLS_CANNOT_RESOLVE_HOSTNAME)last_error=PC_TRANSPORT_DNS;
  else if(tls==ESP_ERR_ESP_TLS_CONNECTION_TIMEOUT||tls==ESP_ERR_ESP_TLS_SERVER_HANDSHAKE_TIMEOUT||socket_error==ETIMEDOUT||esp_timer_get_time()-started>=10000000)last_error=PC_TRANSPORT_TIMEOUT;
  else if(tls!=ESP_OK||tls_error||flags)last_error=PC_TRANSPORT_TLS;
 }
 if(ok&&reuse&&(*status==200||*status==409)&&esp_http_client_is_persistent_connection(h)){
  retained=h;retained_used_ms=(uint32_t)(esp_timer_get_time()/1000);snprintf(retained_origin,sizeof(retained_origin),"%s",store->data.server_origin);
 }else{esp_http_client_cleanup(h);retained_origin[0]=0;}
 pc_memory_report(ok?"https_ok":"https_failed");if(!ok)ESP_LOGW("popcity_https","Request failed: http=%d free=%u largest=%u",*status,(unsigned)esp_get_free_heap_size(),(unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_8BIT));return ok;
}
void pc_cloud_bind_idf(pc_cloud *c,pc_store *store,pc_state *state){pc_cloud_init(c,store,state,sign,store,NULL,store);c->transport_alloc=exchange;c->monotonic_ms=clock_ms;}
