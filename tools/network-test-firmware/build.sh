#!/bin/sh
# Rebuild network-test.bin from ESP-IDF's protocols/http_request example.
# Needs an exported ESP-IDF v5.5 environment (idf.py and esptool on PATH).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
: "${IDF_PATH:?export an ESP-IDF v5.5 environment first}"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp -R "$IDF_PATH/examples/protocols/http_request" "$work/app"
cp "$here/sdkconfig.defaults" "$work/app/sdkconfig.defaults"
cd "$work/app"
idf.py set-target esp32c3 >/dev/null
idf.py build >/dev/null
cd build
esptool.py --chip esp32c3 merge_bin -o "$here/network-test.bin" @flash_args
shasum -a 256 "$here/network-test.bin"
