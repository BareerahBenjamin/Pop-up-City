#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
test_dir=$(mktemp -d /private/tmp/pop-city-core.XXXXXX)
trap 'rm -rf "$test_dir"' EXIT HUP INT TERM
"${CC:-cc}" -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined \
 -I"$root/components/pop_city_core/include" "$root/tests/test_product.c" \
 "$root/components/pop_city_core/pop_city.c" \
 "$root/components/pop_city_core/feedback_consumer.c" \
 "$root/components/pop_city_core/key_policy.c" -o "$test_dir/test_product"
"$test_dir/test_product"
"${CC:-cc}" -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined \
 -I"$root/tests/stubs" -I"$root/main" -I"$root/components/pop_city_core/include" \
 "$root/tests/test_storage.c" "$root/main/event_storage.c" \
 "$root/main/event_save_model.c" "$root/main/personal_store.c" \
 "$root/components/pop_city_core/feedback_consumer.c" -o "$test_dir/test_storage"
"$test_dir/test_storage"
python3 "$root/tools/validate_event_app.py"
# macOS uses system CommonCrypto as an independent reference for Node HMAC interoperability.
if [ "$(uname -s)" = Darwin ]; then
 node "$root/tests/make_cloud_vectors.mjs" "$test_dir/cloud-vectors.json"
 # Keep third-party cJSON unchanged; Apple's deprecated sprintf warning is scoped to it only.
 "${CC:-cc}" -std=c11 -Wall -Wextra -Werror -Wno-deprecated-declarations -fsanitize=address,undefined \
  -I"$root/tests/vendor/cjson" -c "$root/tests/vendor/cjson/cJSON.c" -o "$test_dir/cjson.o"
 "${CC:-cc}" -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined \
  -I"$root/tests/stubs" -I"$root/main" -I"$root/components/pop_city_core/include" -I"$root/tests/vendor/cjson" \
  "$root/tests/test_cloud.c" "$root/main/identity_setup.c" "$root/main/batch_controller.c" "$root/main/single_attendance.c" "$root/main/friend_protocol.c" "$root/main/friend_visual.c" "$root/main/friend_flow.c" "$root/main/startup.c" "$root/main/app_services.c" "$root/main/network_profiles.c" "$root/main/cloud_protocol.c" "$root/main/personal_visual.c" "$root/main/proximity.c" "$root/main/nearby_participants.c" "$root/main/event_storage.c" \
  "$root/main/event_save_model.c" "$root/main/personal_store.c" \
  "$root/components/pop_city_core/pop_city.c" "$root/components/pop_city_core/feedback_consumer.c" \
  "$test_dir/cjson.o" -o "$test_dir/test_cloud"
 "$test_dir/test_cloud" "$test_dir/cloud-vectors.json"
 python3 "$root/tests/test_initialize.py" "$test_dir/cloud-vectors.json"
else
 echo 'Cloud/CommonCrypto interoperability test: NOT RUN (requires macOS); core/storage tests above still run.'
fi
"${CC:-cc}" -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined \
 -I"$root/main" "$root/tests/test_blufi_input.c" "$root/main/blufi_input.c" "$root/main/network_profiles.c" -o "$test_dir/test_blufi_input"
"$test_dir/test_blufi_input"
"${CC:-cc}" -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined \
 -I"$root/main" "$root/tests/test_network_scan.c" "$root/main/network_scan_model.c" "$root/main/network_profiles.c" -o "$test_dir/test_network_scan"
"$test_dir/test_network_scan"

"${CC:-cc}" -std=c11 -Wall -Wextra -Werror -Wno-deprecated-declarations -fsanitize=address,undefined \
 -I"$root/main" -I"$root/tests/vendor/cjson" \
 "$root/tests/test_personal_visual.c" "$root/main/personal_visual.c" "$root/tests/vendor/cjson/cJSON.c" -o "$test_dir/test_personal_visual"
"$test_dir/test_personal_visual"
python3 "$root/tests/test_portable.py"

"${CC:-cc}" -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined \
 -I"$root/main" "$root/tests/test_friend_visual.c" "$root/main/friend_visual.c" -o "$test_dir/test_friend_visual"
"$test_dir/test_friend_visual"

"${CC:-cc}" -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined \
 -I"$root/main" "$root/tests/test_pixel_glyphs.c" -o "$test_dir/test_pixel_glyphs"
"$test_dir/test_pixel_glyphs"

if [ ! -f "$test_dir/cjson.o" ]; then
 "${CC:-cc}" -std=c11 -Wall -Wextra -Werror -Wno-deprecated-declarations -fsanitize=address,undefined \
  -I"$root/tests/vendor/cjson" -c "$root/tests/vendor/cjson/cJSON.c" -o "$test_dir/cjson.o"
fi
"${CC:-cc}" -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined \
 -I"$root/main" -I"$root/tests/vendor/cjson" "$root/tests/test_cjk_name.c" "$root/main/cjk_name.c" "$test_dir/cjson.o" -o "$test_dir/test_cjk_name"
node "$root/tests/pixel_name_vectors.mjs" "$test_dir/pixel-name-vectors.json"
"$test_dir/test_cjk_name" "$root/main/generated/cjk_font.bin" "$test_dir/pixel-name-vectors.json"

"${CC:-cc}" -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined \
 -I"$root/main" "$root/tests/test_network_handoff.c" "$root/main/network_handoff.c" \
 "$root/main/blufi_input.c" "$root/main/network_profiles.c" -o "$test_dir/test_network_handoff"
"$test_dir/test_network_handoff"
"${CC:-cc}" -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined \
 -DCONFIG_PLANET_SERVER_ORIGIN='"https://example.invalid"' \
 -I"$root/tests/network_stubs" -I"$root/tests/stubs" -I"$root/main" \
 -I"$root/components/pop_city_core/include" -I"$root/tests/vendor/cjson" \
 "$root/tests/test_network_setup.c" "$root/main/network_setup.c" "$root/main/network_profiles.c" -o "$test_dir/test_network_setup"
for scenario in none five fallback auth same dhcp timeout save session; do
 "$test_dir/test_network_setup" "$scenario"
done

"${CC:-cc}" -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined \
 -I"$root/tests/stubs" -I"$root/main" -I"$root/components/pop_city_core/include" \
 "$root/tests/test_legacy_import.c" "$root/main/legacy_import.c" "$root/main/event_storage.c" \
 "$root/main/event_save_model.c" "$root/main/personal_store.c" -o "$test_dir/test_legacy_import"
"$test_dir/test_legacy_import"

"${CC:-cc}" -std=gnu11 -Wall -Wextra -Werror -fsanitize=address,undefined \
 -I"$root/tests/panel_stubs" -I"$root/tests/stubs" -I"$root/main" \
 "$root/tests/test_panel_renderer.c" "$root/main/panel_renderer.c" -o "$test_dir/test_panel"
"$test_dir/test_panel"

"${CC:-cc}" -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined \
 -I"$root/main" "$root/tests/test_network_commands.c" -o "$test_dir/test_commands"
"$test_dir/test_commands"
