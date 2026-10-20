FROM python:3.12-slim

WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Optional real detector (RF-DETR-Seg Small): build with
#   docker build --build-arg WITH_DETECTOR=1 -t wine-ml .
# to install CPU-only torch (smaller than the default CUDA wheels) plus
# rfdetr. Left out by default so a plain build stays small/fast and the
# service still runs (DETECTOR=auto falls back to the stub with a warning).
ARG WITH_DETECTOR=0
COPY requirements-detector.txt .
RUN if [ "$WITH_DETECTOR" = "1" ]; then \
        pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu && \
        pip install --no-cache-dir -r requirements-detector.txt; \
    fi

COPY app ./app

# Weights are downloaded on first use (see WEIGHTS_DIR); bake the RF-DETR
# checkpoint into the image instead by COPY-ing it here and pre-warming it
# in a build step if a fully offline image is needed.
RUN mkdir -p /srv/weights

RUN useradd --create-home --uid 1000 appuser \
    && chown -R appuser:appuser /srv
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
