#!/usr/bin/env bash
# On the Mac: build the site and pack what the vast.ai instance needs into deploy/vast/wine-deploy.tar.gz (~60 MB).
#   bash deploy/vast/make_bundle.sh                 SigLIP weights are downloaded on the server from Hugging Face
#   bash deploy/vast/make_bundle.sh --with-weights  + the 0.8 GB fp16 vision tower from ml/weights (no HF download)
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../.." && pwd)
OUT="$REPO/deploy/vast/wine-deploy.tar.gz"
echo "building the site..."
(cd "$REPO/web" && npx nuxt build >/dev/null)
cp "$REPO/web/public/__test/p2.jpg" "$REPO/deploy/vast/test.jpg" 2>/dev/null || true   # smoke-test photo (Formula Q)
files=(web/.output web/data/catalog.json
       ml/app ml/requirements.txt ml/requirements-matcher.txt ml/requirements-detector.txt
       ml/index/index_naflex1024.npz ml/index/reader_text.npz
       deploy/vast/setup.sh deploy/vast/start.sh deploy/vast/stop.sh deploy/vast/build_models.py deploy/vast/test.jpg)
[ -f "$REPO/ml/index/index_tuned_naflex1024.npz" ] && files+=(ml/index/index_tuned_naflex1024.npz)
[ "${1:-}" = "--with-weights" ] && files+=(ml/weights/siglip2-naflex-vision-fp16)
for f in "${files[@]}"; do [ -e "$REPO/$f" ] || { echo "missing: $f"; exit 1; }; done
# --no-xattrs/--no-mac-metadata: no macOS provenance headers (GNU tar on the server warns about every file otherwise)
COPYFILE_DISABLE=1 tar -C "$REPO" --no-xattrs --no-mac-metadata --exclude='__pycache__' --exclude='.DS_Store' \
  --exclude='web/.output/public/__test' -czf "$OUT" "${files[@]}"
ls -lh "$OUT"
# stamp size + sha256 into the notebook: its first cell refuses a partially uploaded archive
SIZE=$(stat -f%z "$OUT" 2>/dev/null || stat -c%s "$OUT"); SHA=$(shasum -a 256 "$OUT" | cut -d' ' -f1)
python3 - "$REPO/deploy/vast/deploy_vast.ipynb" "$SIZE" "$SHA" <<'PY'
import json, re, sys
path, size, sha = sys.argv[1], sys.argv[2], sys.argv[3]
nb = json.load(open(path))
for c in nb["cells"]:
    c["source"] = [re.sub(r"^EXPECTED_SIZE, EXPECTED_SHA256 = .*?  #", f"EXPECTED_SIZE, EXPECTED_SHA256 = {size}, '{sha}'  #", l) for l in c["source"]]
json.dump(nb, open(path, "w"), ensure_ascii=False, indent=1)
PY
echo "size $SIZE sha256 $SHA (written into deploy_vast.ipynb — upload BOTH files again)"
echo "upload it to the instance (Jupyter: Upload button, or scp) and run deploy_vast.ipynb"
