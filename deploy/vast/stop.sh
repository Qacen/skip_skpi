#!/usr/bin/env bash
# Stop what start.sh started.   bash stop.sh          everything, including the https tunnel (its URL is lost)
#                               bash stop.sh services the site + ML only; the tunnel and its URL stay (used by start.sh)
ROOT="${ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
RUN="$ROOT/run"
names="tunnel web ml"; [ "${1:-}" = "services" ] && names="web ml"
for name in $names; do
  f="$RUN/$name.pid"
  [ -f "$f" ] || continue
  pid=$(cat "$f")
  pkill -P "$pid" 2>/dev/null || true   # the restart loop's child (uvicorn / node)
  kill "$pid" 2>/dev/null || true
  rm -f "$f"
  echo "stopped $name"
done
