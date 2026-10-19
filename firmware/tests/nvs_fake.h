#pragma once
#include "nvs.h"
#include <assert.h>
#include <string.h>
static uint8_t committed[1536],staged[1536],other_app[1536];static size_t length,staged_length;
static esp_err_t init_error,open_error,set_error,commit_error,read_error;
static unsigned staged_handle;static bool staged_valid;static unsigned writes,commits,checks;
#define CHECK(x) do{assert(x);checks++;}while(0)
esp_err_t nvs_flash_init_partition(const char *p){assert(!strcmp(p,"event_save"));return init_error;}
esp_err_t nvs_open_from_partition(const char *p,const char *ns,int mode,nvs_handle_t *h){assert(!strcmp(p,"event_save"));assert(!strcmp(ns,"popcity")||!strcmp(ns,"other_app"));if(open_error)return open_error;if(mode==NVS_READONLY&&!length)return ESP_ERR_NVS_NOT_FOUND;*h=!strcmp(ns,"other_app")?2:1;return ESP_OK;}
esp_err_t nvs_get_blob(nvs_handle_t h,const char *key,void *b,size_t *n){assert((h==1||h==2)&&!strcmp(key,"record"));if(h==2){if(!b){*n=sizeof(other_app);return ESP_OK;}if(*n<sizeof(other_app))return ESP_ERR_INVALID_SIZE;memcpy(b,other_app,sizeof(other_app));*n=sizeof(other_app);return ESP_OK;}if(read_error)return read_error;if(!length)return ESP_ERR_NVS_NOT_FOUND;if(!b){*n=length;return ESP_OK;}if(*n<length)return ESP_ERR_INVALID_SIZE;memcpy(b,committed,length);*n=length;return ESP_OK;}
esp_err_t nvs_set_blob(nvs_handle_t h,const char *key,const void *b,size_t n){assert((h==1||h==2)&&!strcmp(key,"record"));staged_handle=h;writes++;if(set_error)return set_error;assert(n<=sizeof(staged));memcpy(staged,b,n);staged_length=n;staged_valid=true;return ESP_OK;}
esp_err_t nvs_commit(nvs_handle_t h){assert(h==1||h==2);commits++;if(commit_error)return commit_error;if(staged_valid){assert(staged_handle==h);if(h==2)memcpy(other_app,staged,staged_length);else{memcpy(committed,staged,staged_length);length=staged_length;}staged_valid=false;}return ESP_OK;}
void nvs_close(nvs_handle_t h){assert(h==1||h==2);staged_valid=false;}
