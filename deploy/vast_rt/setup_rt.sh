#!/usr/bin/env bash
# vast.ai (GTX 1080 Ti / any CUDA GPU): ML service only, real-time endpoints. Run once:  bash setup_rt.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"; PY="${PY:-python3}"; export HF_HOME="${HF_HOME:-$ROOT/.hf}"
nvidia-smi --query-gpu=name,compute_cap,memory.total,driver_version --format=csv,noheader
CC=$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader | head -1 | cut -d. -f1)
# Pascal (GTX 10xx, cc 6.x) is not supported by the newest CUDA 12.8 wheels -> pin cu126 wheels there
if ! "$PY" -c 'import torch, torchvision; assert torch.cuda.is_available(); torchvision.ops.nms(torch.zeros(1,4,device="cuda"), torch.zeros(1,device="cuda"), .5)' 2>/dev/null; then
  "$PY" -m pip install -q --upgrade "torch<2.9" "torchvision<0.24" --index-url https://download.pytorch.org/whl/cu126
fi
"$PY" -m pip install -q -r "$ROOT/ml/requirements.txt" -r "$ROOT/ml/requirements-matcher.txt" "rfdetr>=1.11.0" huggingface_hub
"$PY" -c 'import torch; print("torch", torch.__version__, torch.cuda.get_device_name(0), "cc", torch.cuda.get_device_capability(0))'
"$PY" "$ROOT/ml/build_models.py" "$ROOT"           # base + fine-tuned SigLIP2 vision towers from Hugging Face (~5 GB download once)
(cd "$ROOT/ml" && DEVICE=cuda WEIGHTS_DIR="$ROOT/ml/weights" "$PY" -c 'from app.detector_rfdetr import RFDETRDetector; RFDETRDetector(); print("rfdetr ok")')
echo "done -> bash $ROOT/start_rt.sh"
