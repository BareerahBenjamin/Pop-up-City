#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#define NETWORK_SCAN_MAX 16u
typedef struct {char ssid[33];int8_t rssi;uint8_t security;} network_scan_row_t;
typedef struct {network_scan_row_t rows[NETWORK_SCAN_MAX];size_t count,selected;} network_scan_list_t;
void network_scan_reset(network_scan_list_t *list);
/* security: 0 open, 1 personal password, 2 unsupported enterprise. */
bool network_scan_add(network_scan_list_t *list,const char *ssid,int rssi,unsigned security);
void network_scan_move(network_scan_list_t *list,int direction);
const network_scan_row_t *network_scan_selected(const network_scan_list_t *list);
