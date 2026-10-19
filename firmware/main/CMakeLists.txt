# Product integration entry; readiness remains gated until all interactions pass.
idf_component_register(SRCS "app_main.c" "personal_visual.c" "display_status.c" "friend_visual.c" "panel_renderer.c" "generated/screens.c" "event_storage.c" "event_save_model.c" "personal_store.c" "cloud_protocol.c" "proximity.c" "cloud_idf.c" "startup.c" "identity_setup.c" "identity_usb.c" "batch_controller.c" "single_attendance.c" "friend_protocol.c" "friend_flow.c" "network_worker.c" "app_services.c"
 "network_setup.c" "network_profiles.c" "network_scan_model.c" "network_radio_scan.c" "network_blufi.c"
 "blufi_input.c" "blufi_security.c" "nearby_ble.c" "nearby_participants.c" "terminal_wifi.c"
 EMBED_FILES "generated/screens.rle"
 INCLUDE_DIRS "." REQUIRES esp_hw_support esp_driver_usb_serial_jtag passport_board nvs_flash pop_city_core json esp_http_client mbedtls esp_timer esp_wifi esp_netif bt)
