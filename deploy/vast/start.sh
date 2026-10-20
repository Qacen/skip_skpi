#!/usr/bin/env bash
# Start (or restart) the site + the recognition service on the vast.ai instance.
#   bash start.sh            ML on 127.0.0.1:8000 (GPU), site on 0.0.0.0:3000, https quick tunnel -> prints the public URL
#   TUNNEL=0 bash start.sh   no tunnel (use the vast port mapping or: ssh -L 3000:localhost:3000 ...)
#   A running tunnel is kept on restart, so the public URL stays the same; TUNNEL=new forces a new one.
# Logs and pids: $ROOT/run/*.log, *.pid. Stop: bash stop.sh
set -euo pipefail
ROOT="${ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
PY="${PY:-python3}"
TOOLS="$ROOT/.tools"
RUN="$ROOT/run"
ML_PORT="${ML_PORT:-8000}"
WEB_PORT="${WEB_PORT:-3000}"
TUNNEL="${TUNNEL:-1}"
export HF_HOME="${HF_HOME:-$ROOT/.hf}"
mkdir -p "$RUN"
bash "$(dirname "$0")/stop.sh" services >/dev/null 2>&1 || true

# ---- recognition service (only reachable from this machine; the site calls it on localhost)
# matcher = fine-tuned tower + index rebuilt with it; label reader = base tower (text tower was not tuned)
WDIR="$ROOT/ml/weights"; IDIR="$ROOT/ml/index"
if [ -d "$WDIR/siglip2-naflex-vision-tuned-fp16" ] && [ -f "$IDIR/index_tuned_naflex1024.npz" ]; then
  EMB_DEFAULT="$WDIR/siglip2-naflex-vision-tuned-fp16"; IDX_DEFAULT="$IDIR/index_tuned_naflex1024.npz"; CROP_DEFAULT=1152
  FOUND_MIN_COS="${FOUND_MIN_COS:-0.62}"   # tuned model, calibrated on 100 real photos
else
  EMB_DEFAULT="$WDIR/siglip2-naflex-vision-fp16"; IDX_DEFAULT="$IDIR/index_naflex1024.npz"; CROP_DEFAULT=0
fi
(
  cd "$ROOT/ml"
  export MATCHER=siglip READER=siglip DETECTOR=rfdetr DEVICE="${DEVICE:-cuda}"
  export EMBEDDER_PATH="${EMBEDDER_PATH:-$EMB_DEFAULT}" READER_EMBEDDER_PATH="${READER_EMBEDDER_PATH:-$WDIR/siglip2-naflex-vision-fp16}"
  export INDEX_PATH="${INDEX_PATH:-$IDX_DEFAULT}" READER_TEXT_PATH="$IDIR/reader_text.npz" CROP_PAD=0.10 CROP_MAX_SIDE="${CROP_MAX_SIDE:-$CROP_DEFAULT}"
  [ -n "${FOUND_MIN_COS:-}" ] && export FOUND_MIN_COS
  export CATALOG_PATH="$ROOT/web/data/catalog.json" WEIGHTS_DIR="$ROOT/ml/weights" ALLOW_FORCE=false
  # restart on crash
  nohup bash -c "while true; do '$PY' -m uvicorn app.main:app --host 127.0.0.1 --port $ML_PORT; echo 'ml exited, restarting in 3 s'; sleep 3; done" \
    >"$RUN/ml.log" 2>&1 &
  echo $! >"$RUN/ml.pid"
)

# ---- site (Nuxt SSR server built on the Mac: web/.output)
(
  cd "$ROOT/web"
  export HOST=0.0.0.0 PORT="$WEB_PORT" NODE_ENV=production
  export NUXT_ML_URL="http://127.0.0.1:$ML_PORT" NUXT_ML_TIMEOUT_MS="${NUXT_ML_TIMEOUT_MS:-15000}" NUXT_ML_URL_FILE="$RUN/ml-url.override"
  nohup bash -c "while true; do '$TOOLS/node/bin/node' .output/server/index.mjs; echo 'web exited, restarting in 3 s'; sleep 3; done" \
    >"$RUN/web.log" 2>&1 &
  echo $! >"$RUN/web.pid"
)

wait_http() {  # url seconds name
  for _ in $(seq 1 "$2"); do curl -fs -m 3 -o /dev/null "$1" && { echo "$3 is up"; return 0; }; sleep 1; done
  echo "$3 did not come up in $2 s — see $RUN/${3}.log"; tail -20 "$RUN/${3}.log"; return 1
}
wait_http "http://127.0.0.1:$WEB_PORT/api/wines?limit=1" 60 web
echo "loading models on the GPU (first start ~1-3 min)..."
wait_http "http://127.0.0.1:$ML_PORT/health" 400 ml
curl -s "http://127.0.0.1:$ML_PORT/health"; echo
# the service falls back to the CPU with only a log warning if CUDA fails -> make it loud here
if grep -qiE "using cpu|retrying on cpu|not available" "$RUN/ml.log"; then
  echo "WARNING: the ML service fell back to the CPU (see $RUN/ml.log) — it works, but ~10x slower"
  grep -iE "using cpu|retrying on cpu|not available" "$RUN/ml.log" | tail -3
elif command -v nvidia-smi >/dev/null; then
  echo "GPU processes:"; nvidia-smi --query-compute-apps=pid,used_memory --format=csv,noheader || true
fi

# ---- https quick tunnel (no Cloudflare account; the URL changes on every start)
tunnel_alive() { [ -f "$RUN/tunnel.pid" ] && kill -0 "$(cat "$RUN/tunnel.pid")" 2>/dev/null && [ -s "$RUN/public_url.txt" ]; }
if [ "$TUNNEL" = "new" ] && [ -f "$RUN/tunnel.pid" ]; then kill "$(cat "$RUN/tunnel.pid")" 2>/dev/null || true; rm -f "$RUN/tunnel.pid" "$RUN/public_url.txt"; TUNNEL=1; fi
if [ "$TUNNEL" = "1" ] && tunnel_alive; then
  url=$(cat "$RUN/public_url.txt")
  printf '\n  SITE:  %s/wines   (the same tunnel as before)\n  API:   curl -F file=@photo.jpg %s/api/predict\n\n' "$url" "$url"
elif [ "$TUNNEL" = "1" ]; then
  nohup "$TOOLS/cloudflared" tunnel --no-autoupdate --url "http://127.0.0.1:$WEB_PORT" >"$RUN/tunnel.log" 2>&1 &
  echo $! >"$RUN/tunnel.pid"
  for _ in $(seq 1 60); do
    url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$RUN/tunnel.log" | head -1 || true)
    [ -n "$url" ] && break; sleep 1
  done
  if [ -n "${url:-}" ]; then echo "$url" >"$RUN/public_url.txt"; printf '\n  SITE:  %s/wines\n  API:   curl -F file=@photo.jpg %s/api/predict\n\n' "$url" "$url"
  else echo "tunnel URL not found yet — see $RUN/tunnel.log"; fi
fi
