#!/usr/bin/env bash
# Builds THIRD_PARTY_NOTICES.txt: the licenses of everything compiled into flikka-voice or shipped next to it.
# Needs cargo-about 0.9 (`cargo install cargo-about --locked --features cli`). Usage: ./notices.sh [output]
set -euo pipefail
cd "$(dirname "$0")"
out="${1:-THIRD_PARTY_NOTICES.txt}"
rule=$(printf '=%.0s' {1..80})
thin=$(printf -- '-%.0s' {1..80})
{
  printf '%s\nflikka-voice: third-party notices\n%s\n\n' "$rule" "$rule"
  printf 'flikka-voice is Apache-2.0 (LICENSE). It is built from Narra'"'"'s speech engine and these parts.\n\n'
  printf '%s\nNative code linked into flikka-voice or shipped next to it\n%s\n\n' "$rule" "$rule"
  # pyke's builds of ONNX Runtime and Dawn come without their license files, so copies are kept in licenses/.
  while IFS='|' read -r name url file; do
    printf '%s\n%s\n%s\n\n' "$thin" "$name" "$url"
    cat "licenses/$file"
    printf '\n'
  done <<'LIST'
ONNX Runtime 1.28.0 (linked into flikka-voice)|https://github.com/microsoft/onnxruntime|onnxruntime-LICENSE.txt
ONNX Runtime third-party notices|https://github.com/microsoft/onnxruntime/blob/v1.28.0/ThirdPartyNotices.txt|onnxruntime-ThirdPartyNotices.txt
Dawn (libwebgpu_dawn.so, shipped with flikka-voice)|https://dawn.googlesource.com/dawn|dawn-LICENSE.txt
Oniguruma (built into flikka-voice through onig_sys)|https://github.com/kkos/oniguruma|oniguruma-COPYING.txt
LIST
  printf '%s\nRust crates compiled into flikka-voice\n%s\n' "$rule" "$rule"
  cargo about generate about.hbs
} > "$out"
echo "wrote $out ($(wc -l < "$out") lines)"
