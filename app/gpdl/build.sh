#!/usr/bin/env bash
# gpdl: fetch EFF rs-google-play at a pinned commit, make execute_request/get_default_headers public, cargo build.
# Output: app/.lab/tools/gpdl and gpdl-devices.properties (bdslab_x86_64: the x86_64 build of an app; profile.mjs)
# (nothing else is written outside app/.lab and app/gpdl/target)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); lab="$here/../.lab"; src="$lab/rs-google-play"
REV=eb423a3edfc653a1d533d4b7f6c9148d5bc144a8
if [ ! -d "$src/.git" ] || [ "$(git -C "$src" rev-parse HEAD)" != "$REV" ]; then
  rm -rf "$src"; mkdir -p "$src"
  git -C "$src" init -q
  git -C "$src" fetch -q --depth 1 https://github.com/EFForg/rs-google-play "$REV"
  git -C "$src" checkout -q FETCH_HEAD
fi
lib="$src/gpapi/src/lib.rs"
sed -i.bak -e 's/^    async fn execute_request(/    pub async fn execute_request(/' -e 's/^    fn get_default_headers(/    pub fn get_default_headers(/' "$lib"
grep -q '^    pub async fn execute_request(' "$lib" && grep -q '^    pub fn get_default_headers(' "$lib" || { echo "gpapi の形が変わりました（$REV）" >&2; exit 1; }
cargo build --release --manifest-path "$here/Cargo.toml"
mkdir -p "$lab/tools"; cp "$here/target/release/gpdl" "$lab/tools/gpdl"
# the x86_64 device profile from the same source (without it only the arm64 build is fetched: not fatal)
node "$here/profile.mjs" "$src/gpapi/device.properties" "$lab/tools/gpdl-devices.properties" || true
echo "$lab/tools/gpdl"
