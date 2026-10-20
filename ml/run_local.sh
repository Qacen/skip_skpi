#!/bin/bash
# Local real service on a Mac (Apple Silicon, MPS): RF-DETR-Seg + SigLIP2 naflex-1024 matcher + label reader.
#   ./run_local.sh [port]            MODEL=tuned (default if its weights exist) | base
# tuned: fine-tuned vision tower (HF dobermanjohn/secret_a, exported by Kaggle qujvxta/wine-tuned-export) + index_tuned;
#        the label reader keeps the BASE tower (text embeddings are aligned with it). base: weights/siglip2-naflex-vision-fp16.
cd "$(dirname "$0")"
export MATCHER=siglip READER=siglip DETECTOR=rfdetr DEVICE=${DEVICE:-mps} PYTORCH_ENABLE_MPS_FALLBACK=1
MODEL=${MODEL:-$([ -d weights/siglip2-naflex-vision-tuned-fp16 ] && echo tuned || echo base)}
if [ "$MODEL" = tuned ]; then
  export EMBEDDER_PATH=${EMBEDDER_PATH:-weights/siglip2-naflex-vision-tuned-fp16}
  export INDEX_PATH=${INDEX_PATH:-index/index_tuned_naflex1024.npz}
  export READER_EMBEDDER_PATH=${READER_EMBEDDER_PATH:-weights/siglip2-naflex-vision-fp16}
  export CROP_MAX_SIDE=${CROP_MAX_SIDE:-1152}
  export FOUND_MIN_COS=${FOUND_MIN_COS:-0.62}
else
  export EMBEDDER_PATH=${EMBEDDER_PATH:-weights/siglip2-naflex-vision-fp16}
fi
echo "model=$MODEL embedder=$EMBEDDER_PATH index=${INDEX_PATH:-default} found_min_cos=${FOUND_MIN_COS:-default}" >&2
exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "${1:-8010}"
