#!/bin/sh
# Same as `node lab.mjs ...`, for a machine whose Node.js is missing or older than 22 (common in AI sandboxes):
# it fetches Node 22 once into .lab-node/ (no root needed), then runs the lab with it. NODE_MIRROR=<mirror of nodejs.org/dist>.
set -e
TOP=$(cd "$(dirname "$0")" && pwd)
ok() { "$1" -e 'process.exit(+process.versions.node.split(".")[0]>=22?0:1)' 2>/dev/null; }
if command -v node >/dev/null 2>&1 && ok node; then exec node "$TOP/lab.mjs" "$@"; fi
N="$TOP/.lab-node/bin/node"
if [ ! -x "$N" ] || ! ok "$N"; then
  case "$(uname -s)" in Linux) os=linux;; Darwin) os=darwin;; *) echo "ERR no Node.js 22+: install it from nodejs.org" >&2; exit 1;; esac
  case "$(uname -m)" in x86_64|amd64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo "ERR no Node.js build for $(uname -m): install Node.js 22+" >&2; exit 1;; esac
  base="${NODE_MIRROR:-https://nodejs.org/dist}/latest-v22.x"
  fetch() { if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"; elif command -v wget >/dev/null 2>&1; then wget -q "$1" -O "$2"; \
    else python3 -c 'import sys,urllib.request;urllib.request.urlretrieve(sys.argv[1],sys.argv[2])' "$1" "$2"; fi; }
  tmp="$TOP/.lab-node.tmp"; rm -rf "$tmp"; mkdir -p "$tmp"
  echo "fetching Node.js 22 ($os-$arch) into .lab-node/ ..." >&2
  fetch "$base/SHASUMS256.txt" "$tmp/sums" || { echo "ERR cannot reach $base (network blocked? set NODE_MIRROR or install Node.js 22+)" >&2; exit 1; }
  line=$(grep " node-v[0-9.]*-$os-$arch.tar.gz\$" "$tmp/sums" | head -1); f=${line##* }
  [ -n "$f" ] || { echo "ERR no $os-$arch build listed at $base" >&2; exit 1; }
  fetch "$base/$f" "$tmp/$f"
  want=${line%% *}; got=$( (sha256sum "$tmp/$f" 2>/dev/null || shasum -a 256 "$tmp/$f") | cut -d' ' -f1)
  [ "$want" = "$got" ] || { echo "ERR checksum mismatch for $f" >&2; exit 1; }
  tar -xzf "$tmp/$f" -C "$tmp" && rm -rf "$TOP/.lab-node" && mv "$tmp/${f%.tar.gz}" "$TOP/.lab-node" && rm -rf "$tmp"
fi
PATH="$TOP/.lab-node/bin:$PATH" exec "$N" "$TOP/lab.mjs" "$@"
