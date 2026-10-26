#!/usr/bin/env bash










set -euo pipefail




IMAGE="stellar/quickstart:v672-b1475.1-testing@sha256:1d57fcdc3bc3775f841c4eed877cfc10e406ab7b879c0531844549aeff52ff0a"
NAME="cmi-localnet"
PORT="${CMI_LOCALNET_PORT:-8000}"
RPC="http://localhost:$PORT/soroban/rpc"
FRIENDBOT="http://localhost:$PORT/friendbot"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

die() { echo "$*" >&2; exit 1; }

require_docker() {
  command -v docker >/dev/null || die "falta o docker (a rede local é o stellar/quickstart, S-13)"
  docker info >/dev/null 2>&1 || die "o docker não está respondendo (o daemon está rodando? o usuário tem acesso?)"
}

rpc_healthy() {
  curl -sf -X POST "$RPC" -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' 2>/dev/null | grep -q '"healthy"'
}

friendbot_ready() {

  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' "$FRIENDBOT" 2>/dev/null || true)"
  [[ "$code" == 2* || "$code" == 4* ]]
}



forget_deployment() {
  rm -f "$root/deployments/local.json" "$root/contracts/deployments/quickstart.json"
}

wait_ready() {
  local i
  for i in $(seq 1 120); do
    if rpc_healthy && friendbot_ready; then
      echo "ok: rede local pronta em $RPC"
      return
    fi
    sleep 2
  done
  die "a rede local não ficou pronta em 4 minutos (docker logs $NAME)"
}

up() {
  require_docker
  if [[ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null || true)" == "true" ]]; then
    echo "-- $NAME já está rodando --"
  else
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    forget_deployment
    echo "-- subindo $IMAGE --"
    docker run -d --name "$NAME" -p "$PORT:8000" "$IMAGE" \
      --local --enable-soroban-rpc --limits testnet >/dev/null
  fi
  wait_ready
}

down() {
  require_docker
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  forget_deployment
  echo "ok: $NAME removido"
}

status() {
  if rpc_healthy; then
    echo "ok: rede local respondendo em $RPC"
  else
    echo "a rede local não está respondendo em $RPC" >&2
    exit 1
  fi
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  status) status ;;
  *) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
