#!/usr/bin/env bash
# Start the ML service on 127.0.0.1:${ML_PORT:-8000} (reach it via: ssh -p <port> root@<ip> -L 8000:localhost:8000).
#   RT_DET_PRECISION=amp|fp32  RT_DET_COMPILE=off|default|max-autotune  EMBED_PRECISION=auto|fp16|amp|fp32  RT_FORCE=1 (allow amp/compile on GTX 10xx)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"; PY="${PY:-python3}"; PORT="${ML_PORT:-8000}"; export HF_HOME="${HF_HOME:-$ROOT/.hf}"
pkill -f "uvicorn app.main:app --host 127.0.0.1 --port $PORT" 2>/dev/null || true
cd "$ROOT/ml"; W="$ROOT/ml/weights"; I="$ROOT/ml/index"
export MATCHER=siglip READER=siglip DETECTOR=rfdetr DEVICE=cuda WEIGHTS_DIR="$W" CATALOG_PATH="$I/catalog.json"
export EMBEDDER_PATH="$W/siglip2-naflex-vision-tuned-fp16" READER_EMBEDDER_PATH="$W/siglip2-naflex-vision-fp16" INDEX_PATH="$I/index_tuned_naflex1024.npz"
export READER_TEXT_PATH="$I/reader_text.npz" CROP_MAX_SIDE=1152 FOUND_MIN_COS="${FOUND_MIN_COS:-0.62}"
export RT_INDEX_PATH="$I/index_merged_tuned.npz" RT_NAMES_PATH="$I/wines_merged.csv"
export RT_DET_PRECISION="${RT_DET_PRECISION:-amp}" RT_DET_COMPILE="${RT_DET_COMPILE:-max-autotune}" EMBED_PRECISION="${EMBED_PRECISION:-auto}"
nohup "$PY" -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT" > "$ROOT/ml.log" 2>&1 &
echo "loading models + compile warm-up (1-5 min)..."
for i in $(seq 1 600); do curl -fs -m 2 "http://127.0.0.1:$PORT/health" >/dev/null && break; sleep 1; done
curl -s "http://127.0.0.1:$PORT/rt/info"; echo
curl -s -F file=@"$ROOT/test.jpg" "http://127.0.0.1:$PORT/rt/detect" | head -c 300; echo
echo "log: $ROOT/ml.log"
