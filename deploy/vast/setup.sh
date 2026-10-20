#!/usr/bin/env bash
# One-time setup on a vast.ai GPU instance (PyTorch/CUDA image, Jupyter or SSH).
# Expects the bundle unpacked into $ROOT (see make_bundle.sh):  $ROOT/{ml,web,deploy}
#   bash $ROOT/deploy/vast/setup.sh
# Installs Node 22 (for the Nuxt server), the ML Python deps (keeps the image's CUDA torch), cloudflared (https tunnel),
# and pre-downloads the SigLIP2 vision weights + RF-DETR checkpoint so the first start is fast.
set -euo pipefail
ROOT="${ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
PY="${PY:-python3}"
TOOLS="$ROOT/.tools"
export HF_HOME="${HF_HOME:-$ROOT/.hf}"
mkdir -p "$TOOLS" "$HF_HOME" "$ROOT/ml/weights"
log() { printf '\n== %s\n' "$*"; }

case "$(uname -m)" in x86_64) NARCH=x64; CARCH=amd64 ;; aarch64|arm64) NARCH=arm64; CARCH=arm64 ;; *) echo "unsupported arch $(uname -m)"; exit 1 ;; esac

log "GPU / Python"
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader || echo "nvidia-smi not found (CPU only?)"
"$PY" -c 'import sys; print("python", sys.version.split()[0]); assert sys.version_info >= (3, 10), "need Python >= 3.10"'
"$PY" -c 'import torch; print("torch", torch.__version__, "cuda", torch.cuda.is_available())' 2>/dev/null || echo "torch not installed yet"

log "Node 22"
if [ ! -x "$TOOLS/node/bin/node" ]; then
  base=https://nodejs.org/dist/latest-v22.x
  file=$(curl -fsSL "$base/SHASUMS256.txt" | awk '{print $2}' | grep "linux-$NARCH.tar.xz$" | head -1)
  curl -fsSL "$base/$file" | tar -xJ -C "$TOOLS"
  mv "$TOOLS/${file%.tar.xz}" "$TOOLS/node"
fi
"$TOOLS/node/bin/node" -v

log "cloudflared (https quick tunnel for the site)"
if [ ! -x "$TOOLS/cloudflared" ]; then
  curl -fsSL -o "$TOOLS/cloudflared" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$CARCH"
  chmod +x "$TOOLS/cloudflared"
fi
"$TOOLS/cloudflared" --version | head -1

log "Python deps (the image's CUDA torch is kept)"
# torch + torchvision must be a matched CUDA pair: check a compiled torchvision op, not just the import
if ! "$PY" -c 'import torch, torchvision; torchvision.ops.nms(torch.zeros(1, 4), torch.zeros(1), 0.5)' 2>/dev/null; then
  echo "installing a matched torch + torchvision (CUDA 12.4 wheels)"
  "$PY" -m pip install -q --upgrade torch torchvision --index-url https://download.pytorch.org/whl/cu124
fi
"$PY" -m pip install -q --upgrade-strategy only-if-needed \
  -r "$ROOT/ml/requirements.txt" -r "$ROOT/ml/requirements-matcher.txt" "rfdetr>=1.11.0"
"$PY" - <<'EOF'
import torch, torchvision
print("torch", torch.__version__, "torchvision", torchvision.__version__, "cuda", torch.cuda.is_available())
if not torch.cuda.is_available():
    raise SystemExit("CUDA is not available to this Python: the models would silently run on the CPU (10x slower). Check the instance / image.")
torchvision.ops.nms(torch.zeros(1, 4, device="cuda"), torch.zeros(1, device="cuda"), 0.5)
print("gpu:", torch.cuda.get_device_name(0))
EOF

log "Service code imports on this Python"
(cd "$ROOT/ml" && "$PY" -c 'import app.main, app.matcher_siglip, app.reader_siglip, app.detector_rfdetr; print("ok")')

log "Weights: base + fine-tuned SigLIP2 vision towers (Hugging Face: google/siglip2-so400m-patch16-naflex + dobermanjohn/secret_a, ~5 GB once)"
"$PY" "$ROOT/deploy/vast/build_models.py" "$ROOT"
(cd "$ROOT/ml" && DEVICE=cuda WEIGHTS_DIR="$ROOT/ml/weights" "$PY" -c 'from app.detector_rfdetr import RFDETRDetector; RFDETRDetector(); print("rfdetr ok (cuda)")')

log "done — now: bash $ROOT/deploy/vast/start.sh"
