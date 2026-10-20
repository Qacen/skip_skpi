#!/usr/bin/env bash
# Minimal re-implementation of the organiser's scoring script: POST each photo to /api/predict (multipart "file"),
# read back {"slug": "..."} and curl's own wall time (-w time_total). No JSON parsing dependency beyond curl itself.
# For real metrics (accuracy@1, R@5, F1@1/F1@5, latency percentiles, misses) use eval_service.py instead - this
# script only mimics what the organiser's bash script is described to do (TZ) and dumps a plain CSV.
#
# Usage: scripts/eval_service.sh [photos_dir] [url] [out_csv]
#   scripts/eval_service.sh ../wine_seg/runs/rp http://localhost:3000/api/predict eval_result.csv
set -euo pipefail

DIR="${1:-../wine_seg/runs/rp}"
URL="${2:-http://localhost:3000/api/predict}"
OUT="${3:-eval_result.csv}"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

echo "file,slug,time_total_s" > "$OUT"
shopt -s nullglob
for f in "$DIR"/*.webp "$DIR"/*.jpg "$DIR"/*.jpeg "$DIR"/*.png; do
  t=$(curl -s -o "$TMP" -w '%{time_total}' -F "file=@${f}" "$URL")
  slug=$(sed -n 's/.*"slug"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$TMP")
  printf '%s,%s,%s\n' "$(basename "$f")" "$slug" "$t" >> "$OUT"
  printf '%s -> %s (%ss)\n' "$(basename "$f")" "${slug:-<empty>}" "$t"
done
echo "wrote $OUT"
