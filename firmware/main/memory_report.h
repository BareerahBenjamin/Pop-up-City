#pragma once
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
/* Numeric diagnostics only; no names, URLs, account data or credentials. */
static inline void pc_memory_report(const char *stage){
 ESP_LOGI("popcity_memory","stage=%s free=%u min=%u largest=%u stack_min=%u",stage,
  (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT),
  (unsigned)heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT),
  (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT),
  (unsigned)uxTaskGetStackHighWaterMark(NULL));
}
