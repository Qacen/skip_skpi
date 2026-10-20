# ML-сервис распознавания вин — спецификация

Документ для команды или агента, который делает ML-пайплайн. Здесь описано, что сервис принимает и отдаёт (контракт с сайтом и со скриптом организаторов), как он устроен внутри, какие у нас данные и замеры и какие требования по скорости. Контракт важнее реализации: сайт (`../web`) уже работает с ним. Поля можно добавлять, но нельзя переименовывать и нельзя менять их смысл.

Текущее состояние кода в этой папке — FastAPI-сервис с заглушкой матчинга. Детекция бутылок — настоящая: RF-DETR-Seg Small, локально, если установлены `requirements-detector.txt`. Настоящий матчинг подключается заменой классов в `app/pipeline.py` (см. «Внутреннее устройство»).

## 1. Задача и критерии

Кейс «РСХБ.Цифра»: пользователь фотографирует бутылку российского вина, сайт сразу показывает одну карточку из каталога vino-svoe.ru (2105 вин). Если вина в каталоге нет — честное «не найдено» и аналоги.

Критерии оценки:
- точность — 50;
- функция после поиска — 20;
- архитектура — 15;
- дизайн — 10;
- скорость — 5.

Точность проверяет скрипт организаторов: он шлёт фото и ждёт плоский JSON `{"slug": "wine-slug"}`, SLA < 3 с на фото.

Требования ТЗ, которые касаются ML:
- после скана сразу одна карточка, без экрана «выберите из вариантов»;
- confidence для топ-1 и топ-5 отдаётся только в API, в интерфейсе не показывается;
- если вина нет в каталоге, нужен честный `not_found`: сайт покажет похожие вина из других виноделен. Ложное «найдено» хуже, чем «не найдено».

## 2. Эндпоинты

| Метод | Путь | Кто вызывает | Ответ |
|---|---|---|---|
| POST | `/recognize` | сайт (`web/server/utils/recognizer.ts`) | полный ответ (раздел 3) |
| POST | `/predict` | скрипт организаторов (напрямую или через `web /api/predict`) | `{"slug": "..."}` — **всегда top-1 главной бутылки, даже при not_found** (в тесте организаторов все фото из каталога, пустой ответ = гарантированная ошибка); `""` только при внутренней ошибке |
| GET | `/health` | docker healthcheck, сайт | `{status, model, detector, detector_ready, catalog_size, index?}` |
| GET | `/docs`, `/openapi.json` | люди, генерация клиентов | Swagger / JSON Schema |
| POST | `/index/upsert` *(план)* | Strapi/админка при добавлении вина | добавить или обновить векторы вина |
| DELETE | `/index/{slug}` *(план)* | админка | убрать вино из индекса |
| GET | `/index/stats` *(план)* | мониторинг | размер индекса, версия модели, дата сборки |

**Вход** `/recognize` и `/predict`: `multipart/form-data`, поле `file` (для `/predict` также поле `image` или сырое тело `image/*` / `application/octet-stream`). Лимит 15 МБ.

**Форматы:** JPEG, PNG, WEBP, желательно HEIC (добавить `pillow-heif`).

**Нормализация на входе:**
- поворот по EXIF (`ImageOps.exif_transpose`);
- PNG с прозрачностью накладывается на фон сайта `#fdfbf6`, а не на чёрный;
- все координаты в ответе — целые пиксели изображения после поворота по EXIF, в размере, в котором его прислали. Сайт присылает уже нормализованное фото ≤ 1600 px (JPEG 0.9), скрипт организаторов может прислать оригинал 12 Мп.

**Query-параметры** `/recognize`:
- `force=found|not_found` — только для тестов UI, работает при `ALLOW_FORCE=true`, в проде выключен;
- `masks=polygon|rle|none` (по умолчанию `polygon`);
- `k=10` — сколько ближайших вин вернуть, 1–50.

**Ошибки:** `400 {"detail": "..."}` — нет файла или не декодируется; `413` — больше лимита; `503` — модель не загружена. `/predict` отдаёт top-1 главной бутылки и при not_found (not_found и аналоги — только для сайта через `/recognize`), а на любую внутреннюю ошибку отвечает `{"slug": ""}` со статусом 200, чтобы не сорвать прогон организаторов, и пишет ошибку в лог.

## 3. Ответ `/recognize`

```jsonc
{
  "api_version": "1.1",
  // Копия матча ГЛАВНОЙ бутылки: обратная совместимость, это же отдаёт /predict
  "status": "found",                      // "found" | "not_found"
  "slug": "fanagoriya-cru-lermont-...",   // null при not_found
  "confidence": { "top1": 0.91, "margin": 0.22,
                  "top5": [ { "slug": "...", "score": 0.91 }, ... ] },   // ровно 5 (или меньше, если индекс меньше)
  "read": { "color": "red", "sweetness": "dry", "vintage": "2021", "text": "ФАНАГОРИЯ CRU ..." },
  "primary": 0,                           // индекс главной бутылки в detection.bottles (всегда валиден)

  "detection": {
    "image": { "width": 1200, "height": 1600 },
    "detector": "rfdetr-seg-small",       // | "stub"
    "bottles": [                          // слева направо по bbox.x1; минимум 1 элемент
      {
        "bbox": [412, 180, 760, 1490],    // детекция бутылки, px [x1,y1,x2,y2]
        "score": 0.93,
        "source": "detector",             // "detector" | "full_image" (бутылок не нашли, ищем по всему кадру)
        "center": [586, 835],             // сюда сайт ставит точку (центр bbox или центр масс маски)
        "mask": {                         // сегментация бутылки; null если маски нет или masks=none
          "polygon": [[430, 190], [455, 182], ...],   // упрощённый внешний контур, px, ≤ 96 точек
          "area": 301245,                 // площадь маски в px
          "rle": null                     // COCO RLE {size:[h,w], counts:"..."} — только при masks=rle
        },
        "label": {                        // фронтальная этикетка (ниже плеч); null если не нашли
          "bbox": [440, 820, 735, 1260],
          "polygon": [[...]] ,            // null, пока нет детектора этикеток (сейчас эвристика по маске)
          "score": 0.81,
          "source": "detector"            // "detector" | "heuristic"
        },
        "match": {
          "status": "found",
          "slug": "fanagoriya-cru-lermont-...",
          "confidence": { "top1": 0.91, "margin": 0.22, "top5": [ ... ] },
          "neighbors": [                  // ID ближайших вин каталога после переранжирования, по убыванию score, длина k
            { "slug": "fanagoriya-cru-lermont-...", "score": 0.91, "embed_score": 0.88, "source": "catalog" },
            { "slug": "fanagoriya-cru-cabernet-...", "score": 0.69, "embed_score": 0.71, "source": "video" }
          ],
          "read": { "color": "red", "sweetness": "dry", "vintage": "2021", "text": "..." }
        }
      }
    ]
  },
  "timing_ms": { "decode": 12, "detect": 88, "embed": 90, "search": 1, "rerank": 0, "read": 0, "total": 195 },
  "model": { "name": "siglip2-naflex-1024+rfdetr-seg-s", "version": "2026-10-01", "index_version": "catalog-2105@2026-09-29" },
  "demo": false                           // true, пока матчинг — заглушка
}
```

Правила, на которые опирается сайт:
- `detection.bottles` не пустой. Если детектор ничего не нашёл — одна псевдобутылка на весь кадр: `source: "full_image"`, `score: 0`, `center` в центре кадра, `mask: null`.
- Бутылки упорядочены слева направо. `primary` = argmax(площадь × (1 − 0.5 · расстояние центра бутылки от центра кадра / полудиагональ)).
- Верхнеуровневые `status/slug/confidence/read` в точности совпадают с `bottles[primary].match`.
- `neighbors[0].slug == match.slug`, если `found`. `confidence.top1 == neighbors[0].score`, `margin == neighbors[0].score − neighbors[1].score`, `top5 == neighbors[:5]` (slug + score).
- `score` в [0, 1], больше — ближе. Порог `found`/`not_found` сервис выбирает сам (калибровка, раздел 7) и не отдаёт наружу.
- Фильтр бутылок, чтобы на полках не было мусора:
  - порог уверенности `DETECT_THRESHOLD` (0.45);
  - дубли убираются, если IoU > 0.6 или одна рамка на ≥ 90 % внутри другой;
  - площадь не меньше `MIN_BOTTLE_AREA` (1.2 % кадра);
  - не больше `MAX_BOTTLES` (8) самых крупных.
- Бутылки заднего ряда (видно только горлышко или плечи) матчить бессмысленно. Такие можно отдавать с `match.status = "not_found"` и `read = {}` или отфильтровывать; признаки описаны в `wine_seg/PLAN.md` (линия плеча, доля этикетки).

## 4. Как сайт использует поля

| Поле | Где на сайте |
|---|---|
| `bottles[].center` | точка на бутылке (одна бутылка) или цветной кружок с номером (несколько) на экране `/scan/result` |
| `bottles[].bbox` | какие бутылки отметить: сайт считает заметность = площадь × (1 − 0.5 · удалённость от центра); одна явно преобладающая → только она, иначе передний ряд (≥ 40 % заметности и ≥ 60 % высоты лучшей); мелкие бутылки сзади не отмечаются. Поэтому ML должен отдавать все бутылки, а не только главную |
| `bottles[].match.slug` → карточка | мини-карточка на каждую отмеченную бутылку: одна — плашка под фото, несколько — колонка справа с теми же цветными номерами |
| `bottles[].mask`, `label`, `match.neighbors`, `timing_ms`, `model` | на сайте не показываются и в браузер не передаются (web оставляет только bbox/center/match/read); нужны для API, отладки и оценки ML |
| `match.read` | «Сверка с этикеткой» на карточке: цвет, сладость и год на фото против каталога, сохранение с урожаем |
| `primary` + верхние поля | полная карточка и аналоги главной бутылки; `/predict` |
| `status: not_found` | честная плашка «нет в каталоге» и аналоги в стиле `read` или топ-5 |
| `confidence` | только API (ТЗ), в интерфейсе не показывается |

## 5. Внутреннее устройство

```
decode (EXIF, альфа → #fdfbf6, ресайз ≤ 1280 для детектора)
  → Detector      RF-DETR-Seg Small, COCO bottle (class 44) → маски → фильтр → зона этикетки
  → Matcher       для каждой бутылки: кроп bbox + 10 % → SigLIP2 naflex-1024 эмбеддинг (батчем)
                  → pgvector top-K по индексу → агрегация по slug (max) → neighbors
  → Reranker      (опц.) OCR/VLM этикетки главной бутылки → пересортировка топ-5, когда margin мал
  → LabelReader   read{color, sweetness, vintage, text}
  → решение found/not_found (порог по top1 и margin) → ответ
```

В коде это три протокола в `app/pipeline.py`: `Detector`, `Matcher`, `LabelReader`. `Pipeline` их только вызывает и засекает время. Модели грузятся один раз при старте (lifespan), выбор через env: `DETECTOR=auto|rfdetr|stub`, `DEVICE=cpu|mps|cuda`.

**Индекс** (PostgreSQL + pgvector; до переезда в БД допустим файл `.npy` в памяти, поиск по 10⁴ векторов < 1 мс):

```sql
CREATE TABLE wine_vectors (
  id           bigserial PRIMARY KEY,
  slug         text NOT NULL,              -- ID вина в каталоге (= slug портала)
  source       text NOT NULL,              -- catalog | video | real_photo | user_feedback
  view         text,                       -- crop | label
  model        text NOT NULL,              -- версия эмбеддера; при смене модели индекс пересобирается
  embedding    vector(1152) NOT NULL,      -- SigLIP2 so400m
  created_at   timestamptz DEFAULT now()
);
CREATE INDEX ON wine_vectors USING hnsw (embedding vector_cosine_ops);
```

Что кладём в индекс:
- фото карточек каталога (1 вектор на вино: среднее эмбеддингов фото карточки и полосы этикетки 30–92 %) — `index/index_naflex1024.npz`, 2105 векторов;
- ракурсы из видео (814, 163 вина) **не кладём**: на real-photo они портят поиск (top1 0.793 → 0.644, полочные кропы «притягивают» фото пользователей). Вариант с ними — `index/index_naflex1024_with_video.npz`;
- позже — подтверждённые пользовательские фото (проверять на real-photo перед включением).

Для одного вина хранится несколько векторов, агрегируются по max.

## 6. Что уже есть (данные и замеры)

Всё лежит в `../wine_seg/`. Журнал экспериментов — `PLAN.md`, это главный источник.

**Каталог.** 2105 вин: `../web/data/catalog.json` — slug, title, производитель, цвет, сладость, сорта, год, img. Фото бутылок — `../web/public/img/wines/<slug>.webp`.

**Разметка из видео:** `wine_seg/runs/lbl/final/` (`views.csv`, `wines.csv`, README).
- 1080 уникальных вин, 3847 ракурсов с ID;
- у 163 вин есть ссылка на карточку vino-svoe (356 бутылок, 814 ракурсов).

**Real-photo eval:** 87 фото — exact 53, probable 8, same_line 26. Kaggle `qujvxta/wine-rp-evalset`, локально `wine_seg/runs/rp/`.

**Датасет детекции этикеток:** Kaggle `tmama23/wine-labeldet-dataset`.
- форматы COCO, YOLO-seg, YOLO-det;
- классы `front_label` и `other_label`;
- видео разбито по 5-минутным группам, WineSensed — по vintage.

**Лучшие текущие результаты (без дообучения):**
- **SigLIP2 naflex-1024, кроп бутылки +10 % против каталога:** real-photo top1 0.793, top5 0.931 (exact 0.906, exact + probable 0.918).
- **Видео → каталог:** R@1 0.670, R@5 0.929. По вину, при усреднении ракурсов: R@1 0.730, R@5 0.976.
- **Дообученный SigLIP2-384:** последние 4 блока vision и 3 блока text, SupCon, 3 фолда по сессиям. Видео → каталог 0.666 → 0.774 (R@5 0.965), real-photo 0.690 → 0.770.
- **Следующий шаг** — дообучить naflex-1024 на кропах бутылок.

**Что не помогает:**
- переранжирование по zero-shot атрибутам SigLIP (сладость SigLIP не читает);
- ключевые точки: ловят шаблон этикетки, а не конкретное вино;
- SAM3 для зоны этикетки: +0.5 с, без прироста;
- вырезка без фона: хуже, чем кроп с фоном.

Для переранжирования топ-5 нужен настоящий OCR или VLM. Например, Qwen3-VL-2B (`wine_seg/lib/wine_label_ocr.py`): сладость 85.5 %, год 91 %, ~1.2 с на T4. Запускать только для главной бутылки и только когда `margin` мал.

**Детекция.** RF-DETR-Seg Small zero-shot, COCO bottle — решение для прода (Apache-2.0). Бутылка находится в 94 % полочных кропов. На видео recall бутылок с видимой этикеткой около 0.75: подводят смазанные кадры за стеклом.

**Латентность на T4:**

| Этап | Время |
|---|---|
| ресайз 12 Мп | 136 мс |
| RF-DETR | 88 мс |
| эмбеддинг naflex | ~90 мс |
| поиск | 0.3 мс |
| итого без VLM | ≈ 0.35 с |

**Латентность на CPU (4 потока):** RF-DETR 0.45 с, naflex-1024 4.8 с. Значит, для SLA 3 с нужен GPU или лёгкий эмбеддер на CPU.

## 7. Как мерить

**Метрики:**
- top1 и top5 по slug;
- F1 macro по винам;
- доля правильных `not_found` на фото вин, которых нет в каталоге (same_line и чужие);
- p50 и p90 полного `/recognize`.

**Наборы:**
- real-photo 87 — главный, близок к фото жюри;
- ракурсы из видео с привязкой к каталогу, сплит по сессиям съёмки (группы 5–10 минут, чтобы одна бутылка не попала и в train, и в val).

**Порог `not_found`.** Подбирается по top1 и margin на отложенной части так, чтобы ложных `found` на винах вне каталога было ≤ 5 %. Фиксируется в конфиге вместе с версией модели.

**Регресс-тесты.** Контракт проверяется в `tests/test_api.py`: поля, типы, `primary`, порядок бутылок, `neighbors`, плоский `/predict`. При изменении модели тесты должны остаться зелёными.

## 8. Конфигурация

| Переменная | По умолчанию | Смысл |
|---|---|---|
| `CATALOG_PATH` | `../web/data/catalog.json` | каталог (slug, атрибуты) |
| `DETECTOR` | `auto` | `rfdetr` / `stub` / `auto` (rfdetr, если установлен) |
| `DEVICE` | `cpu` | `cpu` / `mps` / `cuda` |
| `MATCHER` / `READER` | `stub` / `stub` | `siglip` — SigLIP2 naflex-1024 (`app/matcher_siglip.py`, `app/reader_siglip.py`), эмбеддер общий, грузится один раз при старте |
| `EMBEDDER_PATH` | `google/siglip2-so400m-patch16-naflex` | HF id или папка с весами vision tower |
| `INDEX_PATH` / `READER_TEXT_PATH` | `ml/index/index_naflex1024.npz` / `ml/index/reader_text.npz` | индекс векторов каталога / текстовые эмбеддинги для ридера (год, цвет) |
| `FOUND_MIN_COS`, `CROP_PAD`, `EMBED_PATCHES` | 0.76 / 0.10 / 1024 | порог found по cos top-1, отступ кропа, naflex max_num_patches |
| `WEIGHTS_DIR` | `ml/weights` | куда RF-DETR и эмбеддер кладут веса (в .gitignore) |
| `DETECT_THRESHOLD`, `MIN_BOTTLE_AREA`, `MAX_BOTTLES` | 0.45 / 0.012 / 8 | фильтр бутылок |
| `ALLOW_FORCE` | `false` | `?force=` для тестов UI |
| `MAX_UPLOAD_MB` | 15 | лимит файла |
| `DATABASE_URL` | — | pgvector (когда появится) |
| `NEIGHBORS_K` | 10 | длина `neighbors` по умолчанию |

## 9. Запуск и деплой

```bash
cd ml && python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt -r requirements-detector.txt -r requirements-matcher.txt
.venv/bin/uvicorn app.main:app --port 8000       # заглушка матчинга; сайт ждёт его на NUXT_ML_URL
./run_local.sh 8010                              # настоящий матчер на Mac (MPS): MATCHER=siglip READER=siglip DEVICE=mps
.venv/bin/python -m pytest -q
.venv/bin/python scripts/eval_realphoto.py --url http://127.0.0.1:8010 --photos "~/Downloads/Реальные фото" --eval ../wine_seg/runs/rp/evalds/rp_eval.csv
```

Артефакты настоящего матчера (Kaggle-кернел `qujvxta/wine-ml-export`): `weights/siglip2-naflex-vision-fp16/` — только vision-часть SigLIP2 в fp16, 0.8 ГБ (эмбеддинги совпадают с полной моделью, cos 1.0); `index/index_naflex1024.npz`; `index/reader_text.npz` — готовые текстовые эмбеддинги для чтения года и цвета (текстовая часть модели в сервисе не нужна).

Замер на real-photo 87 через HTTP `/recognize`: top1 0.793, exact+probable 0.918 (top5 0.984). Mac M-серии (MPS, fp16): p50 2.0 с, p90 3.6 с. T4: см. `kaggle/README.md`.

**Kaggle T4 + временная ссылка Cloudflare** — `kaggle/serve_t4.ipynb` / `kaggle/serve.py`, инструкция в `kaggle/README.md`.

Docker: `docker compose up --build` из корня (`ml` + `web`). Образ ML собирается с `--build-arg WITH_DETECTOR=1` (CPU torch). Для GPU — отдельный образ на CUDA-базе, контракт тот же.

## 10. Что сделать (по порядку)

1. `Matcher`:
   - SigLIP2 naflex-1024 по кропу +10 %;
   - индекс из фото каталога и 814 ракурсов видео;
   - `neighbors` top-K с агрегацией по slug;
   - порог `not_found` по real-photo;
   - добиться top1 ≥ 0.79 на real-photo 87 при p90 < 1 с на GPU.
2. `LabelReader`: цвет, сладость, год (zero-shot по зоне этикетки даёт год 0.89, цвет 0.82). Сладость — только через OCR или VLM.
3. Дообучение naflex-1024 на кропах бутылок (SupCon, сплит по сессиям).
4. Детектор этикеток (`tmama23/wine-labeldet-dataset`) → `label.polygon`, `source: "detector"`.
5. Reranker на OCR или VLM для главной бутылки при малом `margin`.
6. pgvector и `/index/upsert` для новых вин из админки.
