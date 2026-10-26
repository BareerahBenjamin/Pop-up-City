#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define NEARBY_CAPACITY 16
#define NEARBY_TTL_MS 5000u
/* Application-task owned. BLE callbacks must enqueue sightings, never mutate it. */
typedef struct {
    bool occupied,host_eligible,checked_in;
    uint32_t host_checked_ms;
    uint8_t device_id[16];
    int8_t rssi;
    uint32_t seen_ms;
    uint32_t presence_epoch;
    char presence_tag[13];
} nearby_participant_t;
typedef struct {
    nearby_participant_t entries[NEARBY_CAPACITY];
    int selected; /* Stable slot; expired selection requires explicit navigation. */
} nearby_participants_t;
void nearby_init(nearby_participants_t *list);
bool nearby_observe(nearby_participants_t *list, const uint8_t id[16],
                    int8_t rssi, uint32_t now_ms, int8_t minimum_rssi);
size_t nearby_count(const nearby_participants_t *list, uint32_t now_ms);
bool nearby_move(nearby_participants_t *list, int direction, uint32_t now_ms);
bool nearby_selected(const nearby_participants_t *list, uint32_t now_ms,
                     nearby_participant_t *snapshot);

/* Snapshot only live peers at the physical batch-confirmation instant. */
size_t nearby_snapshot(const nearby_participants_t *list,uint32_t now_ms,nearby_participant_t out[NEARBY_CAPACITY]);

size_t nearby_host_count(const nearby_participants_t *,uint32_t now_ms);

/* Remove a completed selection; select the next pending peer or clear selection. */
bool nearby_prune_checked_selection(nearby_participants_t *,uint32_t);
