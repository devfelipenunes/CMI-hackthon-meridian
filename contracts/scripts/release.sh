#!/usr/bin/env bash
# Usage: scripts/release.sh [tag] [--no-deployments] [--self-test]
#
# Assembles the release artifact bundle (circuits, vks, wasm, parity-vectors and,
# optionally, deployments) and writes dist/<tag>/artifacts-<tag>.tar.gz + SHA256SUMS.
#
# Arguments:
#   tag                 Release tag (vX.Y.Z or vX.Y.Z-rc.N).
#
# Options:
#   --no-deployments    Does not include deployments/testnet.json in the bundle.
#   --self-test         Assembles, packs and checks a test bundle; does not require a tag.
#   -h, --help          Shows this help.
#
# Prerequisites: stellar, sha256sum and tar. The preflight requires check-wasm.sh and
# check-vks.sh to pass and wasm/auction.wasm to match what the build generates.
#
# Example:
#   ./scripts/release.sh v0.1.0-rc.4

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

die() { echo "$*" >&2; exit 1; }

tag=""
no_deployments=false
self_test=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-deployments) no_deployments=true; shift ;;
    --self-test) self_test=true; shift ;;
    -h|--help) awk 'NR>1 && /^#/ {sub(/^# ?/, ""); print; next} NR>1 {exit}' "${BASH_SOURCE[0]}"; exit 0 ;;
    -*) die "unknown argument: $1" ;;
    *) [[ -z "$tag" ]] || die "only one tag"; tag="$1"; shift ;;
  esac
done




preflight() {
  for t in sha256sum tar stellar; do
    command -v "$t" >/dev/null || die "missing $t"
  done
  ./scripts/check-wasm.sh >/dev/null || die "check-wasm.sh failed: run it to see what diverges"
  ./scripts/check-vks.sh >/dev/null || die "check-vks.sh failed: run it to see what diverges"



  ./scripts/build.sh >/dev/null 2>&1 || die "the build failed: run ./scripts/build.sh to see the error"
  if ! git diff --quiet -- wasm/auction.wasm; then
    die "the build changed wasm/auction.wasm: version the build (./scripts/build.sh) before the release"
  fi
}


assemble() {
  local out="$1" with_deployments="$2" f

  mkdir -p "$out"/{circuits,vks,wasm,parity-vectors}

  cp artifacts/circuits/*.json "$out/circuits/"
  cp artifacts/vks/*.vk.bin "$out/vks/"


  for f in wasm/vks/*.vk.bin; do
    [[ ! -e "$out/vks/$(basename "$f")" ]] || die "duplicate VK name between CMI and token: $f"
    cp "$f" "$out/vks/"
  done

  cp target/wasm32v1-none/release/factory.wasm "$out/wasm/factory.wasm"
  cp wasm/auction.wasm "$out/wasm/auction.wasm"
  cp artifacts/parity-vectors/*.json "$out/parity-vectors/"

  if [[ "$with_deployments" == true ]]; then
    mkdir -p "$out/deployments"
    cp deployments/testnet.json "$out/deployments/testnet.json"
  fi



  (cd "$out" && find . -type f ! -name SHA256SUMS -printf '%P\n' | LC_ALL=C sort |
    xargs sha256sum > SHA256SUMS)
}


pack() {
  local tree="$1" t="$2" dest="$3"
  mkdir -p "$dest"

  tar --sort=name --owner=0 --group=0 --numeric-owner --mtime='@0' \
    -czf "$dest/artifacts-$t.tar.gz" -C "$tree" .
  cp "$tree/SHA256SUMS" "$dest/SHA256SUMS"
}


verify() {
  local tarball="$1" work
  work="$(mktemp -d)"
  tar -xzf "$tarball" -C "$work"
  [[ -f "$work/SHA256SUMS" ]] || { rm -rf "$work"; die "the bundle has no SHA256SUMS"; }
  if ! (cd "$work" && sha256sum --quiet -c SHA256SUMS); then
    rm -rf "$work"
    die "the bundle does not match its own SHA256SUMS"
  fi


  local listed actual
  listed="$(cut -d' ' -f3- "$work/SHA256SUMS" | LC_ALL=C sort)"
  actual="$(cd "$work" && find . -type f ! -name SHA256SUMS -printf '%P\n' | LC_ALL=C sort)"
  [[ "$listed" == "$actual" ]] || { rm -rf "$work"; die "there is a file in the bundle not listed in SHA256SUMS"; }
  rm -rf "$work"
}

if [[ "$self_test" == true ]]; then
  preflight
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT

  echo "-- assemble and check a test bundle --"
  assemble "$work/tree" false
  pack "$work/tree" self-test "$work/dist"
  verify "$work/dist/artifacts-self-test.tar.gz"
  for d in circuits vks wasm parity-vectors; do
    [[ -n "$(ls -A "$work/tree/$d")" ]] || die "self-test: $d/ came out empty"
  done
  [[ "$(ls "$work/tree/vks" | wc -l)" -eq $(( $(ls artifacts/vks | wc -l) + 6 )) ]] ||
    die "self-test: vks/ does not have the CMI VKs plus the six token ones"
  echo "OK: the intact bundle checks out"

  echo ""
  echo "-- one flipped byte: must fail --"
  mkdir "$work/bad"
  tar -xzf "$work/dist/artifacts-self-test.tar.gz" -C "$work/bad"
  printf '\xff' | dd of="$work/bad/wasm/auction.wasm" bs=1 seek=0 count=1 conv=notrunc status=none
  if (cd "$work/bad" && sha256sum --quiet -c SHA256SUMS >/dev/null 2>&1); then
    die "self-test FAILED: a flipped byte was NOT detected"
  fi
  echo "OK: rejected"

  echo ""
  echo "-- the same tree twice: the same SHA256SUMS --"
  assemble "$work/tree2" false
  cmp -s "$work/tree/SHA256SUMS" "$work/tree2/SHA256SUMS" || die "self-test: SHA256SUMS is not stable"
  echo "OK: stable"

  echo ""
  echo "self-test OK"
  exit 0
fi

[[ -n "$tag" ]] || die "usage: $0 <tag> [--no-deployments] | --self-test"
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$ ]] || die "tag outside the vX.Y.Z or vX.Y.Z-rc.N format: $tag"



git diff --quiet && git diff --cached --quiet || die "there are uncommitted changes: the release is from an exact commit"
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  [[ "$(git rev-parse "$tag^{commit}")" == "$(git rev-parse HEAD)" ]] ||
    die "tag $tag does not point to HEAD: check it out first"
else
  echo "warning: tag $tag does not exist yet; the bundle is from commit $(git rev-parse --short HEAD)" >&2
fi

if [[ "$no_deployments" == true ]]; then
  echo "warning: bundle without deployments/ - suitable for the quickstart run, not for v0.1.0" >&2
  with_deployments=false
else
  [[ -f deployments/testnet.json ]] ||
    die "missing deployments/testnet.json (step 3.3). For a quickstart-only run: --no-deployments"
  with_deployments=true
fi

preflight

dest="dist/$tag"
[[ ! -e "$dest" ]] || die "$dest already exists; delete it to redo"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
assemble "$work/tree" "$with_deployments"
pack "$work/tree" "$tag" "$dest"
verify "$dest/artifacts-$tag.tar.gz"

echo ""
echo "OK: $dest/artifacts-$tag.tar.gz ($(wc -l < "$dest/SHA256SUMS") files)"
echo "    $dest/SHA256SUMS"
echo "commit: $(git rev-parse HEAD)"
echo "Upload the two files as assets of the release $tag on GitHub."
