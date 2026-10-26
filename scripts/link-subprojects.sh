#!/usr/bin/env bash










set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

link() {
  local path="$1" target="$2"
  local full="$root/$path"
  if [ -L "$full" ]; then
    rm -f "$full"
  elif [ -e "$full" ]; then
    if [ -d "$full" ] && [ -z "$(ls -A "$full" 2>/dev/null)" ]; then
      rmdir "$full"
    else
      echo "skip: $path já existe e não está vazio" >&2
      return 0
    fi
  fi
  mkdir -p "$(dirname "$full")"
  ln -s "$target" "$full"
  echo "linked $path -> $target"
}


link "web/sdk" "../sdk"
link "web/specs" "../specs"

link "sdk/contracts" "../contracts"
link "sdk/specs" "../specs"


link "contracts/specs" "../specs"

echo
echo "Pronto. Agora: cd sdk && pnpm install && pnpm test"
