#!/usr/bin/env bash










set -euo pipefail

REPO="zolvency-CMI/contracts"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASES_DIR="${ARTIFACTS_RELEASES_DIR:-$ROOT/packages/artifacts/releases}"

tag="${1:-}"
if [[ -z "$tag" ]]; then
  echo "uso: $0 <tag> [--from-dir <dir>]" >&2
  exit 2
fi
shift
from_dir=""
if [[ "${1:-}" == "--from-dir" ]]; then
  from_dir="${2:?--from-dir exige um diretório}"
fi

work="$(mktemp -d)"
trap 'rm -rf -- "${work:?}"' EXIT

if [[ -n "$from_dir" ]]; then
  cp -R "$from_dir/." "$work/"
else
  command -v gh >/dev/null || { echo "erro: gh não encontrado; use --from-dir" >&2; exit 1; }
  gh release download "$tag" -R "$REPO" -D "$work"
  for tarball in "$work"/*.tar.gz; do
    [[ -e "$tarball" ]] || continue
    tar -xzf "$tarball" -C "$work" && rm -f -- "$tarball"
  done
fi

if [[ ! -f "$work/SHA256SUMS" ]]; then
  echo "erro: a release $tag não tem SHA256SUMS" >&2
  exit 1
fi
if ! (cd "$work" && sha256sum --quiet -c SHA256SUMS); then
  echo "erro: sha256 não confere na release $tag; nada foi instalado" >&2
  exit 1
fi

mkdir -p "$RELEASES_DIR"
dest="$RELEASES_DIR/$tag"
if [[ -e "$dest" ]]; then
  echo "erro: $dest já existe; apague-o para reinstalar" >&2
  exit 1
fi
cp -R "$work" "$dest.partial"
mv "$dest.partial" "$dest"
echo "ok: artefatos de $tag em $dest"
