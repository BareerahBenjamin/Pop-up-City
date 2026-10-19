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
