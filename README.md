ссылка на демо - [https://drive.google.com/file/d/1lebhSzWLp5dGU15oXGap-nRdLI6V_Ijt/view?usp=sharing](https://drive.google.com/drive/folders/1BLDYPYWfEy3DYylkB1gRFctQfTz7rStC?usp=sharing)

# РСХБ.Цифра — сканер российских вин

Сервис для платформы «Своё Вино»: пользователь фотографирует этикетку бутылки, сервис находит нужную позицию в каталоге (2112 российских вин) и сразу показывает одну карточку — производитель, регион, сорт, описание, рейтинг Роскачества, к чему подать — без экрана «выберите из вариантов». Если вина в каталоге нет, показывает честное «не найдено» и аналоги из других виноделен. Мобильный интерфейс сделан в стилистике портала vino-svoe.ru; распознавание — computer vision (детекция бутылки + эмбеддинг этикетки), без OCR на горячем пути.

Два независимых сервиса за одним docker-compose: **web** (Nuxt 4 — сайт, API, каталог) и **ml** (FastAPI — детекция и сопоставление с каталогом). Контракт между ними — HTTP JSON, описан в [`ml/ML_SERVICE.md`](ml/ML_SERVICE.md); каждый меняется независимо от другого.

## Результат

| Метрика (реальные фото, вино есть в каталоге) | Значение |
|---|---|
| **F1 (macro, top-1)** | **0.948** |
| **Recall@1** | **0.961** |
| **Recall@5** | **1.000** |
| Детектор RF-DETR, фото (RTX 6000 Pro) | 10.8 мс |
| Эмбеддинг SigLIP 2, картинка (RTX 6000 Pro) | 7.1 мс |
| Фото → эмбеддинг целиком: детектор + кроп + SigLIP (RTX 6000 Pro) | 34.2 мс |
| Полный ответ сервиса на сервере (RTX 3060) | ~0.43 с |

Модель — SigLIP 2 so400m NaFlex, дообученная на задаче «фото из магазина → карточка каталога» (веса: [`dobermanjohn/secret_a`](https://huggingface.co/dobermanjohn/secret_a)), архитектура — [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Структура репозитория

```
web/            Nuxt 4 сайт + API (мобильный UI, каталог, карточка, сомелье)
  app/pages/       экраны: wines (каталог), scan (камера), scan/result, wines/:slug (карточка), my
  app/components/  шапка, сканер, карточки, фильтры, цифровой сомелье
  server/api/       /api/wines*, /api/predict, /api/wines/search-by-photo, /api/sommelier, /api/ml/status
  server/utils/     catalog (единая точка замены на БД), analogs, recognizer (клиент ml), prominence
  data/             дамп каталога (catalog.json, wines/<slug>.json) — см. scripts/build_catalog.py
  scripts/          выгрузка каталога, eval_service.py (метрики сервиса, см. ниже)
ml/             FastAPI-сервис распознавания (отдельный процесс/контейнер, масштабируется независимо)
  app/              pipeline (Detector → Matcher → LabelReader), FastAPI-эндпоинты, конфиг
  weights/, index/  веса детектора/эмбеддера и индекс векторов каталога (в .gitignore, качаются/строятся отдельно)
  kaggle/           запуск на Kaggle T4 + временный туннель (без своего GPU)
deploy/vast/    деплой сайта + ml на GPU-сервер vast.ai (один Jupyter-ноутбук, без GPU у самой команды)
docker-compose.yml   web + ml одной командой
```

Подробности каждого слоя — в собственных доках: [`web/README.md`](web/README.md), [`web/ARCHITECTURE.md`](web/ARCHITECTURE.md), [`ml/README.md`](ml/README.md), [`ml/ML_SERVICE.md`](ml/ML_SERVICE.md), [`deploy/vast/README.md`](deploy/vast/README.md). Этот файл и [`ARCHITECTURE.md`](ARCHITECTURE.md) — верхнеуровневая карта по требованиям ТЗ; пайплайн и границы слоёв разобраны в `ARCHITECTURE.md`.

## Быстрый старт

### Локально: ml + web по отдельности

```bash
# 1. сервис распознавания, порт 8000 (или 8010, см. ml/README.md)
cd ml
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt -r requirements-detector.txt -r requirements-matcher.txt
MATCHER=siglip READER=siglip DEVICE=mps .venv/bin/uvicorn app.main:app --port 8000   # DEVICE=cpu на не-Mac

# 2. сайт, порт 3000
cd web && npm install && NUXT_ML_URL=http://127.0.0.1:8000 npm run dev
```

Без `requirements-detector.txt`/`requirements-matcher.txt` и без `MATCHER=siglip` сервис поднимается с детерминированной заглушкой матчинга (детекция бутылок при этом настоящая) — удобно для разработки фронтенда без GPU. Без `NUXT_ML_URL` (и без `web/ml-url.txt`) сайт работает в собственном демо-режиме — псевдорезультат по хешу фото, вообще без вызова `ml/`.

### Docker: оба сервиса одной командой

```bash
docker compose up --build   # -> http://localhost:3000, Swagger ml -> http://localhost:8000/docs (нужен NVIDIA GPU + nvidia-container-toolkit)
docker compose -f docker-compose.yml -f docker-compose.cpu.yml up --build   # без GPU: тот же образ и модель, ~5-10 с на фото
```

`ml` собирается из `deploy/docker/Dockerfile.ml-gpu` (образ на базе CUDA-PyTorch) сразу с настоящей моделью — `MATCHER=siglip`, `READER=siglip`, `DETECTOR=rfdetr`, `DEVICE=cuda` и пути на дообученные веса зашиты в `ENV` образа, заглушки нет. При первом старте контейнер сам скачивает с Hugging Face обе вижн-башни SigLIP2 — базовую `google/siglip2-so400m-patch16-naflex` и дообученную `dobermanjohn/secret_a` (суммарно ~5 ГБ, `deploy/vast/build_models.py`) — в volume `ml-weights`, поэтому у `HEALTHCHECK` образа `start_period` 15 минут. Оверрайд `docker-compose.cpu.yml` меняет только `DEVICE=cpu` и снимает резервирование GPU — модель остаётся той же дообученной, просто без CUDA (медленнее). Старый `ml/Dockerfile` (CPU-заглушка по умолчанию, `--build-arg WITH_DETECTOR=1` для RF-DETR) корневым `docker-compose.yml` больше не используется — это отдельный образ для локальной сборки только `ml/` (см. `ml/README.md`).

### GPU-сервер (vast.ai): один ноутбук

Для демонстрации на GPU без своего железа — `deploy/vast/deploy_vast.ipynb` в Jupyter на арендованной машине: распаковка бандла → `setup.sh` (зависимости, веса) → `start.sh` (поднимает `ml` на CUDA, сайт и cloudflare-туннель, печатает публичный URL). Подробности, переменные `start.sh` и работа без туннеля (по SSH) — в [`deploy/vast/README.md`](deploy/vast/README.md).

## Переменные окружения

### web (`web/.env`, см. `web/nuxt.config.ts`)

| Переменная | По умолчанию | Смысл |
|---|---|---|
| `NUXT_ML_URL` | *(пусто)* | Адрес(а) сервиса распознавания через запятую, пробуются по порядку; пусто → сайт работает в демо-режиме (псевдорезультат по хешу фото, без вызова `ml/`) |
| `NUXT_ML_URL_FILE` | `ml-url.txt` | Файл-оверрайд рядом с приложением (например, временный адрес туннеля Kaggle/vast); перечитывается при каждом скане, пробуется первым |
| `NUXT_ML_TIMEOUT_MS` | `8000` | Сколько ждать ответа `ml/` на один запрос, мс. На локальном Mac (MPS) нужно ближе к 30000, на GPU-сервере хватает 5000–8000 |
| `NUXT_PUBLIC_DEMO_BANNER` | `1` | `0` — скрыть в интерфейсе плашку демо-режима |

### ml (`ml/.env` или env контейнера, см. `ml/app/config.py`)

Общие:

| Переменная | По умолчанию | Смысл |
|---|---|---|
| `CATALOG_PATH` | `web/data/catalog.json` | Каталог вин (slug, атрибуты) |
| `DEVICE` | `cpu` | `cpu` / `mps` / `cuda`; недоступное устройство — тихий откат на `cpu` |
| `MAX_UPLOAD_MB` | `15` | Лимит размера фото |
| `CORS_ORIGINS` | *(пусто)* | Список origin через запятую; пусто — CORS выключен |
| `ALLOW_FORCE` | `false` | Разрешить `?force=found\|not_found` на `/recognize` для тестов UI (в проде выключено) |
| `NEIGHBORS_K` | `10` | Длина `neighbors` (кандидатов из индекса) по умолчанию |

Детекция бутылок (RF-DETR-Seg Small):

| Переменная | По умолчанию | Смысл |
|---|---|---|
| `DETECTOR` | `auto` | `auto` — RF-DETR, если установлен и загрузился, иначе заглушка; `rfdetr` — требовать настоящую модель; `stub` — всегда заглушка (тесты) |
| `WEIGHTS_DIR` | `ml/weights` | Куда скачивается/откуда читается чекпойнт RF-DETR (~135 МБ, один раз) |
| `DETECT_THRESHOLD` | `0.45` | Минимальный score детекции для показа бутылки |
| `RESCUE_THRESHOLD` | `0.25` | Более низкий порог, которым «спасают» только центральную бутылку (пережатие JPEG может уронить score ниже 0.45) |
| `CENTRAL_MIN_HEIGHT` | `0.35` | Минимальная высота бокса (доля кадра), чтобы считаться «центральной» бутылкой для правила выше |
| `PRIMARY_RULE` | `center_line` | Выбор главной бутылки: `center_line` (пересекает вертикальную центр-линию) или `area_center` (площадь × близость к центру) |
| `MIN_BOTTLE_AREA` | `0.012` | Минимальная площадь бокса (доля кадра), меньше — шум |
| `MAX_BOTTLES` | `8` | Не больше стольких бутылок на фото (самые крупные) |

Сопоставление с каталогом (SigLIP2):

| Переменная | По умолчанию | Смысл |
|---|---|---|
| `MATCHER` | `stub` | `siglip` — включить настоящий матчер (SigLIP2); `stub` — детерминированная заглушка (по хешу файла) |
| `READER` | `stub` | `siglip` — zero-shot чтение цвета/года по этикетке; `stub` — всегда пусто |
| `EMBEDDER_PATH` | `google/siglip2-so400m-patch16-naflex` | HF id или локальная папка с весами vision tower (общая для матчера и ридера) |
| `READER_EMBEDDER_PATH` | = `EMBEDDER_PATH` | Башня для ридера, если матчер указывает на дообученную модель (ридер должен остаться на базовой башне, см. «Текущая модель») |
| `INDEX_PATH` | `ml/index/index_naflex1024.npz` | Индекс векторов каталога (см. «Текущая модель» — должен быть построен той же моделью, что и `EMBEDDER_PATH`) |
| `READER_TEXT_PATH` | `ml/index/reader_text.npz` | Текстовые эмбеддинги для чтения года/цвета |
| `FOUND_MIN_COS` | `0.76` | Порог «найдено» по косинусу top-1 (калибруется под конкретную модель/индекс, см. `ml/ML_SERVICE.md §7`) |
| `CROP_PAD` | `0.10` | Отступ вокруг bbox бутылки перед эмбеддингом |
| `CROP_MAX_SIDE` | `0` (выкл.) | Даунскейл кропа перед процессором; дообученная модель обучалась с thumbnail 1152 — при использовании её весов выставляется `1152` |
| `EMBED_PATCHES` | `1024` | `max_num_patches` NaFlex |
| `READ_BOTTLES` | `primary` | Каким бутылкам считать зону этикетки для ридера: `primary` (только главная) или `all` |
| `STUB_NOT_FOUND_EVERY` | `6` | Только при `MATCHER=stub`: каждый N-й запрос — `not_found` (`0` — всегда `found`) |

Полный и всегда актуальный список — в коде: `ml/app/config.py`.

## API для организатора (скрипт оценки)

Плоский контракт, который ожидает скрипт оценки кейсодержателя:

```bash
curl -F "file=@bottle.jpg" http://localhost:3000/api/predict
# -> {"slug": "wine-slug"}            (или {"slug": ""}, если не найдено/ошибка)
```

`POST /api/predict` на сайте — тонкая обёртка над `POST {NUXT_ML_URL}/predict` в `ml/` (тот же контракт можно вызвать напрямую на `ml/`, минуя сайт). Всегда отдаёт top-1 главной бутылки, даже когда сервис не уверен — пустой ответ хуже, чем возможная ошибка. На фото без файла/декодируемого изображения — `400`; на внутреннюю ошибку — `{"slug": ""}` со статусом `200`, чтобы не срывать прогон скрипта.

Полная карточка и confidence — на эндпоинте, которым пользуется интерфейс сканера:

```bash
curl -F "file=@bottle.jpg" http://localhost:3000/api/wines/search-by-photo
```

Отвечает JSON с `status` (`found`/`not_found`), `wine` (полная карточка: производитель, регион, сорт, описание, рейтинг, «к чему подать»…), `analogs` (аналоги из других виноделен), координатами детекций для UI и `confidence: { top1, margin, top5: [{slug, score}] }` — метрика уверенности для топ-1 и топ-5, которую просит ТЗ (в интерфейс не выводится, только в API). Полная схема ответа `ml/` (детекция, маски, several bottles) — `ml/ML_SERVICE.md`. Карточка по slug напрямую: `GET /api/wines/:slug`.

## Метрики сервиса (скрипт оценки F1/времени ответа)

`web/scripts/eval_service.py` шлёт размеченные фото по одному в `POST /api/predict` работающего сайта — точно так же, как это будет делать скрипт кейсодержателя — засекает время каждого запроса и сверяет `slug` с ground truth; дополнительно зовёт `POST /api/wines/search-by-photo` на том же фото, чтобы посчитать R@5/F1@5 по `confidence.top5`. Автономный скрипт на stdlib (`urllib`), установка зависимостей не нужна.

```bash
python3 web/scripts/eval_service.py --subset exact
python3 web/scripts/eval_service.py --subset all --limit 20
python3 web/scripts/eval_service.py \
  --url http://localhost:3000 \
  --labels ml/eval/rp_eval.csv \
  --photos <папка с фото из Kaggle-датасета apnicarduvin1245/real-photo>
```

`--url` — адрес сайта (по умолчанию `http://localhost:3000`); `--labels` — CSV с колонками `photo_id,file,subset,target_slug,alt_slugs,...` (в репозитории — `ml/eval/rp_eval.csv`); `--photos` — папка с файлами `file` из CSV (по умолчанию `wine_seg/runs/rp`, там же лежат сами фото `.webp`; та же разметка продублирована в [`ml/eval/rp_eval.csv`](ml/eval/rp_eval.csv) для Kaggle-кернела обучения — без самих фото); `--subset` — только одно подмножество (`exact`/`probable`/`same_line`/`all`); `--limit` — ограничить число фото; `--timeout` — таймаут запроса, с. Сайт должен быть уже поднят (см. «Быстрый старт») и указывать на нужный `ml/` (заглушку или настоящую модель) через `NUXT_ML_URL`.

Метрики по подвыборкам и общие (accuracy@1, R@5, F1@1 macro, F1@5 macro, латентность p50/p90/max) печатаются markdown-таблицей в консоль и пишутся в `web/data/metrics.json`; та же страница читает их через `GET /api/metrics` на скрытом экране `/metrics`. Упрощённый аналог, ближе к тому, что реально делает bash-скрипт организатора (по кругу POST в `/api/predict`, CSV `file,slug,time_total_s`), — `web/scripts/eval_service.sh [папка_с_фото] [url] [out.csv]`.

## Текущая модель

- **Детекция.** RF-DETR-Seg Small (Apache-2.0), zero-shot по классу COCO «bottle» — находит бутылку и её маску, дальше по маске оценивается зона этикетки.
- **Сопоставление.** SigLIP2 so400m NaFlex (`google/siglip2-so400m-patch16-naflex`), дообучены последние 8 блоков vision-энкодера (блоки 19–26) + `post_layernorm` + pooling head контрастивным обучением на кропах бутылок (PyTorch Lightning). Веса — [HF `dobermanjohn/secret_a`](https://huggingface.co/dobermanjohn/secret_a/tree/main) (чекпойнт `last_weights.ckpt`); в сервис модель собирается скриптом `deploy/vast/build_models.py` (база + дообученные веса → fp16 vision tower), индекс каталога, построенный той же моделью, лежит в `ml/index/index_tuned_naflex1024.npz`; подключается в `ml/` через `EMBEDDER_PATH`/`INDEX_PATH` (см. таблицу выше и `ml/ML_SERVICE.md`).
- **Индекс каталога** пересобран той же процедурой кропа, что и обучающая/валидационная выборка: прозрачность → белый фон, главная бутылка RF-DETR-Seg (порог 0.30), отступ +10 %, `thumbnail` до 1152 px, 1024 NaFlex-патча — а не старым zero-shot рецептом.
- **Замер на валидации** (реальные фото «у полки», вино есть в каталоге): **F1 0.948, Recall@1 0.961, Recall@5 1.000** (базовая модель: 0.838 / 0.868 / 0.981).
- Zero-shot базовая модель (без дообучения) как référence — real-photo top1 0.793, exact+probable 0.918 (описана в `ml/ML_SERVICE.md`); дообучение — основной источник прироста качества над ней.

## Ограничения

- **Скорость на CPU.** SigLIP2 so400m — тяжёлая модель: на CPU (4 потока) эмбеддинг одного кропа занимает ~5–11 с, что уже больше целевого SLA 3 с. Заявленный SLA достижим на GPU (CUDA) или Apple Silicon (MPS); без GPU сервис остаётся корректным, но медленным.
- **Публичный адрес сервиса меняется.** Демо на Kaggle T4 или vast.ai отдаётся через быстрый туннель Cloudflare (`*.trycloudflare.com`) без аккаунта — адрес новый при каждом перезапуске туннеля/машины, подключается к сайту через `web/ml-url.txt`, а не хардкодом.
- **Покрытие — только каталог «Своё Вино».** Вино вне каталога (2112 позиций) принципиально не может быть найдено; сервис отвечает честным `not_found` и аналогами, а не выдумывает совпадение.
- **Near-duplicate позиции.** Одна и та же этикетка с разным годом/категорией/сладостью — главный источник ошибок: по чистому изображению бутылки они неотличимы, сладость с этикетки визуально не читается моделью (нужен OCR/VLM, на горячем пути не используется).
- **Год и цвет читаются приблизительно.** `LabelReader` (`READER=siglip`) — zero-shot оценка по эмбеддингу, не полноценный OCR; сверка с каталогом на карточке — подсказка, а не гарантированно верный факт.
- **SLA и метрики валидации измерены на GPU** (Kaggle T4 / карта деплоя vast.ai), а не на CPU конечного пользователя; цифры в этом файле и в `ml/ML_SERVICE.md` относятся к этой конфигурации.
- **Публичный туннель без авторизации.** Кто знает адрес `*.trycloudflare.com`, может слать в сервис запросы; секреты и ключи на сервере не хранятся, адрес не публикуется за пределами демо (см. `deploy/vast/README.md`).
- **Каталог — статичный дамп** (`web/data/catalog.json`), обновляется пересборкой (`web/scripts/build_catalog.py`), а не онлайн-синхронизацией со Strapi/БД; на прод-переезд на PostgreSQL/Strapi пайплайн рассчитан (`server/utils/catalog.ts`), но не выполнен в этом репозитории.
- **Docker Compose по умолчанию требует NVIDIA GPU.** `docker compose up` сразу поднимает настоящую дообученную модель (`deploy/docker/Dockerfile.ml-gpu`, CUDA) и на первом старте качает с Hugging Face ~5 ГБ весов; без GPU — оверрайд `docker-compose.cpu.yml` (та же модель на CPU, медленнее). Лёгкий вариант с заглушкой матчинга и без скачивания весов — только локальный запуск `ml/` напрямую (без `MATCHER=siglip`, см. «Быстрый старт»), не через корневой `docker-compose.yml`.
