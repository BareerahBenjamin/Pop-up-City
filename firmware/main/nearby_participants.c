#include "nearby_participants.h"
#include <string.h>

static bool live(const nearby_participant_t *p, uint32_t now)
{
    return p->occupied && (uint32_t)(now - p->seen_ms) < NEARBY_TTL_MS;
}
void nearby_init(nearby_participants_t *list)
{
    memset(list, 0, sizeof(*list));
    list->selected = -1;
}
bool nearby_observe(nearby_participants_t *list, const uint8_t id[16],
                    int8_t rssi, uint32_t now, int8_t minimum_rssi)
{
    if (!list || !id) return false;
    int slot = -1;
    for (int i = 0; i < NEARBY_CAPACITY; ++i) {
        nearby_participant_t *p = &list->entries[i];
        if ((p->occupied || i == list->selected) && !memcmp(p->device_id, id, 16)) {
            /* Weak sightings invalidate a previous strong sighting immediately. */
            if (rssi < minimum_rssi) { p->occupied = false; return false; }
            p->occupied = true; p->rssi = rssi; p->seen_ms = now;
            return true;
        }
        if (slot < 0 && i != list->selected && !live(p, now)) slot = i;
    }
    if (rssi < minimum_rssi || slot < 0) return false;
    list->entries[slot] = (nearby_participant_t){.occupied=true, .rssi=rssi, .seen_ms=now};
    memcpy(list->entries[slot].device_id, id, 16);
    /* Select once on initial entry; never switch people because RSSI changed. */
    if (list->selected < 0) list->selected = slot;
    return true;
}
size_t nearby_count(const nearby_participants_t *list, uint32_t now)
{
    size_t count = 0;
    for (int i = 0; i < NEARBY_CAPACITY; ++i) count += live(&list->entries[i], now);
    return count;
}
bool nearby_move(nearby_participants_t *list, int direction, uint32_t now)
{
    if (!list || !direction) return false;
    int step = direction > 0 ? 1 : -1;
    int base = list->selected < 0 ? (step > 0 ? NEARBY_CAPACITY-1 : 0) : list->selected;
    for (int n = 1; n <= NEARBY_CAPACITY; ++n) {
        int i = (base + step*n + NEARBY_CAPACITY) % NEARBY_CAPACITY;
        if (live(&list->entries[i], now)) { list->selected = i; return true; }
    }
    return false;
}
bool nearby_selected(const nearby_participants_t *list, uint32_t now,
                     nearby_participant_t *snapshot)
{
    if (!list || !snapshot || list->selected < 0 || list->selected >= NEARBY_CAPACITY ||
        !live(&list->entries[list->selected], now)) return false;
    *snapshot = list->entries[list->selected];
    return true;
}

size_t nearby_snapshot(const nearby_participants_t *list,uint32_t now,nearby_participant_t out[NEARBY_CAPACITY])
{
    if(!list||!out)return 0;
    size_t count=0;
    for(int i=0;i<NEARBY_CAPACITY;i++)if(live(&list->entries[i],now))out[count++]=list->entries[i];
    return count;
}
