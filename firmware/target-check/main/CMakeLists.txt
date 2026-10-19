idf_component_register(SRCS "check_main.c" "../../main/event_storage.c"
 "../../main/event_save_model.c" "../../main/personal_store.c" "../../main/cloud_protocol.c" "../../main/proximity.c" "../../main/cloud_idf.c" "../../main/startup.c" "../../main/identity_setup.c" "../../main/identity_usb.c" "../../main/batch_controller.c" "../../main/single_attendance.c" "../../main/friend_protocol.c" "../../main/friend_flow.c" "../../main/network_worker.c" "../../main/app_services.c"
 "../../main/network_setup.c" "../../main/network_profiles.c"
 "../../main/network_scan_model.c" "../../main/network_radio_scan.c" "../../main/network_blufi.c"
 "../../main/blufi_input.c" "../../main/blufi_security.c" "../../main/nearby_ble.c"
 "../../main/nearby_participants.c" "../../main/terminal_wifi.c"
 INCLUDE_DIRS "../../main" REQUIRES esp_hw_support esp_driver_usb_serial_jtag nvs_flash pop_city_core json esp_http_client mbedtls esp_timer esp_wifi esp_netif bt)

