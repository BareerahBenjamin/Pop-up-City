#include "cloud_idf.h"
#include "esp_http_client.h"
#include "esp_crt_bundle.h"
#include "esp_timer.h"
#include "mbedtls/md.h"
#include "mbedtls/sha256.h"
#include <stdio.h>
#include <string.h>
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
static bool exchange(void *context,bool get,const char *path,const char *body,char *out,size_t capacity,int *status){
 pc_store *store=context;char url[384],auth[80];
 if(!pc_cloud_origin_valid(store->data.server_origin)||path[0]!='/'||strlen(path)>180||capacity<2)return false;
 int n=snprintf(url,sizeof(url),"%s%s",store->data.server_origin,path);if(n<0||(size_t)n>=sizeof(url))return false;
 snprintf(auth,sizeof(auth),"Bearer %s",store->data.device_token);
 esp_http_client_config_t config={.url=url,.timeout_ms=8000,.buffer_size=1024,.disable_auto_redirect=true,.crt_bundle_attach=esp_crt_bundle_attach};
 esp_http_client_handle_t h=esp_http_client_init(&config);if(!h){memset(auth,0,sizeof(auth));return false;}
 esp_http_client_set_header(h,"Authorization",auth);memset(auth,0,sizeof(auth));
 esp_http_client_set_header(h,"Content-Type","application/json");esp_http_client_set_header(h,"Connection","close");esp_http_client_set_method(h,get?HTTP_METHOD_GET:HTTP_METHOD_POST);
 size_t body_size=get?0:strlen(body),sent=0,used=0;int64_t started=esp_timer_get_time();bool ok=false;
 if(!deadline(h,started)||esp_http_client_open(h,(int)body_size)!=ESP_OK)goto done;
 while(sent<body_size){if(!deadline(h,started))goto done;int written=esp_http_client_write(h,body+sent,(int)(body_size-sent));if(written<=0)goto done;sent+=(size_t)written;}
 if(!deadline(h,started)||esp_http_client_fetch_headers(h)<0)goto done;
 *status=esp_http_client_get_status_code(h);
 while(used<capacity-1){if(!deadline(h,started))goto done;int got=esp_http_client_read(h,out+used,(int)(capacity-1-used));if(got<0)goto done;used+=(size_t)got;
  if(esp_http_client_is_complete_data_received(h)){out[used]=0;ok=used>0&&esp_timer_get_time()-started<=10000000;break;}
  if(got==0)goto done;
 }
 done:esp_http_client_cleanup(h);return ok;
}
void pc_cloud_bind_idf(pc_cloud *c,pc_store *store,pc_state *state){pc_cloud_init(c,store,state,sign,store,exchange,store);c->monotonic_ms=clock_ms;}
