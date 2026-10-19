# Unmodified BSP display/button/battery/I2C drivers only; application owns rendering and input tasks.
idf_component_register(SRCS "src/bsp_display.c" "src/bsp_button.c" "src/bsp_battery.c" "src/bsp_i2c.c"
 INCLUDE_DIRS "include"
 REQUIRES driver esp_lcd button esp_adc esp_timer)
