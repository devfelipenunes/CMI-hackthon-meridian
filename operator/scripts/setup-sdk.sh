#!/usr/bin/env bash











set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

git_cmd=(git)
if [[ "${GIT_SSH:-0}" == "1" ]]; then
  git_cmd=(git -c url."git@github.com:".insteadOf="https://github.com/")
fi

"${git_cmd[@]}" submodule update --init


(cd ../sdk && "${git_cmd[@]}" submodule update --init)

(cd ../sdk && ./scripts/check-toolchain.sh && pnpm install --frozen-lockfile && pnpm build && pnpm test:unit)

pnpm install
