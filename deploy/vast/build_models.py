#!/usr/bin/env python3
"""Builds the two vision towers the service needs, from public Hugging Face repos (no secrets):
  ml/weights/siglip2-naflex-vision-fp16/        base google/siglip2-so400m-patch16-naflex  -> label reader (READER_EMBEDDER_PATH)
  ml/weights/siglip2-naflex-vision-tuned-fp16/  base + dobermanjohn/secret_a (tuned blocks) -> matcher (EMBEDDER_PATH)
Usage: python build_models.py <repo root>"""
import os
import sys

import torch
from huggingface_hub import hf_hub_download
from transformers import AutoModel, AutoProcessor, Siglip2VisionModel

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
W = os.path.join(ROOT, "ml", "weights")
BASE, TUNED = os.path.join(W, "siglip2-naflex-vision-fp16"), os.path.join(W, "siglip2-naflex-vision-tuned-fp16")
MID = "google/siglip2-so400m-patch16-naflex"

if os.path.isdir(BASE) and os.path.isdir(TUNED):
    print("both vision towers already built"); sys.exit(0)
full = AutoModel.from_pretrained(MID, torch_dtype=torch.float32)
proc = AutoProcessor.from_pretrained(MID)


def save_tower(dst: str) -> None:
    vm = Siglip2VisionModel(full.config.vision_config)
    tgt = getattr(vm, "vision_model", vm)            # older transformers wrap the tower in .vision_model, newer do not
    miss, unexp = tgt.load_state_dict(full.vision_model.state_dict(), strict=False)
    assert not miss and not unexp, (miss[:5], unexp[:5])
    vm.half().save_pretrained(dst, safe_serialization=True)
    proc.image_processor.save_pretrained(dst)
    print("saved", dst, sum(os.path.getsize(os.path.join(dst, f)) for f in os.listdir(dst)) // 2**20, "MB")


if not os.path.isdir(BASE):
    save_tower(BASE)                                  # before the tuned weights are applied
if not os.path.isdir(TUNED):
    ck = torch.load(hf_hub_download("dobermanjohn/secret_a", "last_weights.ckpt"), map_location="cpu", weights_only=True)
    sd = {k[2:]: v.float() for k, v in ck["state_dict"].items() if k.startswith("m.")}
    keys = set(full.state_dict())
    assert all(k in keys for k in sd), [k for k in sd if k not in keys][:5]
    miss, unexp = full.load_state_dict(sd, strict=False)
    assert not unexp
    print(f"tuned tensors applied: {len(sd)}")
    save_tower(TUNED)
