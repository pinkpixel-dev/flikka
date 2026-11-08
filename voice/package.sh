#!/usr/bin/env bash
# Packs a release build of flikka-voice for Flikka to download: the binary, Dawn next to it (found through the
# binary's $ORIGIN run path), Flikka's LICENSE and the third-party notices, as one .tar.gz plus its .sha256.
# Checks the newest glibc it needs and that it runs. Usage: ./package.sh [output dir]   (after cargo build --release
# and ./notices.sh). MAX_GLIBC: the newest glibc allowed (default 2.39, Ubuntu 24.04's).
set -euo pipefail
cd "$(dirname "$0")"
out="$(realpath -m "${1:-dist}")"
version=$(sed -n 's/^version = "\(.*\)"$/\1/p' Cargo.toml | head -1)
name="flikka-voice-${version}-x86_64-linux"
stage="$out/$name"
rm -rf "$stage" && mkdir -p "$stage"
cp target/release/flikka-voice "$stage/"
cp -L target/release/libwebgpu_dawn.so "$stage/"
cp ../LICENSE "$stage/LICENSE"
cp THIRD_PARTY_NOTICES.txt "$stage/"

# The newest glibc symbol either file asks for decides the oldest Linux it runs on.
needed=$(objdump -T "$stage/flikka-voice" "$stage/libwebgpu_dawn.so" | grep -o 'GLIBC_[0-9.]*' | sed 's/GLIBC_//' | sort -V | tail -1)
allowed="${MAX_GLIBC:-2.39}"
echo "needs glibc $needed (allowed: $allowed)"
if [ "$(printf '%s\n%s\n' "$needed" "$allowed" | sort -V | tail -1)" != "$allowed" ]; then
  echo "flikka-voice needs glibc $needed, newer than $allowed: build it on an older system" >&2
  exit 1
fi
# It starts, finds Dawn next to it, and answers.
empty=$(mktemp -d)
[ "$(env -i "$stage/flikka-voice" voices --voices "$empty")" = "[]" ] || { echo "flikka-voice didn't start" >&2; exit 1; }
rmdir "$empty"

tar -czf "$out/$name.tar.gz" -C "$out" "$name"
(cd "$out" && sha256sum "$name.tar.gz" > "$name.tar.gz.sha256")
rm -rf "$stage"
echo "packed $out/$name.tar.gz ($(du -h "$out/$name.tar.gz" | cut -f1))"
cat "$out/$name.tar.gz.sha256"
