# ML-сервис распознавания винных этикеток

Отдельный Python-микросервис на FastAPI. Принимает фото (одна или несколько
бутылок в кадре) и возвращает по каждой найденной бутылке позицию каталога с
координатами детекции и оценками уверенности.

**Статус:** детекция бутылок — настоящая модель, **RF-DETR-Seg Small**
(сегментация, работает локально на CPU/MPS). Сопоставление с каталогом
(matching) и чтение атрибутов (OCR) пока остаются детерминированной заглушкой
(stub) — контракт API уже финальный, поэтому фронтенд (Nuxt-сайт в `../web`)
и скрипт организаторов могут тестироваться end-to-end уже сейчас. Когда
появится настоящий matcher/reader, поменяются только внутренности
`app/pipeline.py` — контракт `/recognize`, `/predict`, `/health` не изменится.

## Запуск локально

```bash
cd ml
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt            # сервис без детектора (заглушка матчинга)

# Настоящий детектор (RF-DETR-Seg Small) — отдельно, тяжёлые зависимости
# (torch + rfdetr, ~250 МБ). Первый прогон скачивает чекпойнт (~135 МБ) в
# WEIGHTS_DIR (по умолчанию ml/weights/).
pip install -r requirements-detector.txt

uvicorn app.main:app --reload --port 8000
```

Открыть `http://localhost:8000/docs` — интерактивная документация (Swagger UI).

Без `requirements-detector.txt` сервис прекрасно работает — при
`DETECTOR=auto` (по умолчанию) он тихо откатывается на `StubDetector` с
предупреждением в логах.

### Через Docker

```bash
# Без детектора (лёгкий образ, только заглушка):
docker build -t wine-ml .

# С настоящим детектором (CPU-only torch, отдельный build arg):
docker build --build-arg WITH_DETECTOR=1 -t wine-ml .

docker run --rm -p 8000:8000 \
  -v /absolute/path/to/web/data/catalog.json:/srv/data/catalog.json:ro \
  -v /absolute/path/to/ml/weights:/srv/weights \
  -e CATALOG_PATH=/srv/data/catalog.json \
  wine-ml
```

## Переменные окружения

| Переменная            | По умолчанию                              | Описание                                                                 |
|-----------------------|--------------------------------------------|---------------------------------------------------------------------------|
| `CATALOG_PATH`         | `<repo>/web/data/catalog.json`             | Путь к каталогу вин (JSON-список объектов с `slug`, `title`, `manufacturer`, `color`, `sweetness`, `year`, ...) |
| `STUB_NOT_FOUND_EVERY` | `6`                                         | Каждый N-й запрос (по хэшу байт фото + bbox бутылки) заглушка отвечает `not_found`. `0` — отключает `not_found` (всегда `found`) |
| `MAX_UPLOAD_MB`        | `15`                                        | Максимальный размер загружаемого файла в МБ, иначе `413`                 |
| `ALLOW_FORCE`          | `false`                                     | Разрешить `?force=found\|not_found` в `/recognize` для тестирования UI (действует на каждую бутылку) |
| `CORS_ORIGINS`         | *(пусто)*                                   | Список origin через запятую для CORS; пусто — CORS middleware не включается |
| `DETECTOR`             | `auto`                                      | `auto` — RF-DETR, если он импортируется и загружается, иначе `stub` (с предупреждением в логах); `rfdetr` — требовать настоящую модель (падать, если не загрузилась); `stub` — всегда заглушка (используется в тестах) |
| `DETECT_THRESHOLD`     | `0.45`                                      | Минимальный score детекции, ниже — бокс отбрасывается ещё до dedup/фильтра по площади |
| `MIN_BOTTLE_AREA`      | `0.012`                                     | Минимальная площадь бокса как доля площади фото; меньше — бутылка отбрасывается (шум) |
| `MAX_BOTTLES`          | `8`                                         | Оставить не больше стольких бутылок на фото (самые крупные по площади)   |
| `WEIGHTS_DIR`          | `<ml>/weights`                              | Куда скачивается/откуда читается чекпойнт `rf-detr-seg-small.pt` (~135 МБ, качается один раз при первом запуске) |
| `DEVICE`               | `cpu`                                       | `cpu` или `mps`; если `mps` запрошен, но недоступен (или не загрузился), тихий откат на `cpu` |

## Контракт API

Все координаты — целые пиксели **в EXIF-повёрнутом изображении** (через
`PIL.ImageOps.exif_transpose`): `width`/`height` — это размеры уже
повёрнутой картинки, ровно то, что увидит пользователь.

### `POST /recognize`

`multipart/form-data`, поле `file`. Необязательный query-параметр
`force=found|not_found` (работает только если `ALLOW_FORCE=true`) — чтобы
детерминированно получить нужный статус у **каждой** бутылки при
тестировании интерфейса. Необязательный `max_bottles=N` (1–64) — сопоставлять
только N самых крупных бутылок, порядок слева направо и основная бутылка
сохраняются; так живой AR получает быстрый ответ по переднему ряду
(`web/server/api/wines/ar-frame.post.ts`, N = 6), а фото остаётся с `MAX_BOTTLES`.

Детектор находит **все** бутылки на фото (см. «Как работает детекция» ниже),
каждая получает собственный `match`/`read` (matching пока заглушка, но уже
на уровне конкретной бутылки, а не всего фото). Верхнеуровневые
`status`/`slug`/`confidence`/`read` — это копия `match`/`read` **основной**
(`primary`) бутылки, для обратной совместимости с `/predict` и старыми
клиентами, которые ещё не читают `detection.bottles`.

```bash
curl -F "file=@bottle.jpg" "http://localhost:8000/recognize"
curl -F "file=@bottle.jpg" "http://localhost:8000/recognize?force=not_found"
```

Пример ответа (`200`, две бутылки в кадре):

```json
{
  "status": "found",
  "slug": "leto-risling-2024-polusuhoe-vino",
  "confidence": { "top1": 0.93, "margin": 0.23, "top5": [ /* 5 кандидатов */ ] },
  "read": { "color": "white", "sweetness": "semi-dry", "vintage": "2024", "text": null },
  "primary": 1,
  "detection": {
    "image": { "width": 3024, "height": 4032 },
    "detector": "rfdetr-seg-small",
    "bottles": [
      {
        "bbox": [1, 12, 753, 3524],
        "label_bbox": [47, 284, 709, 3241],
        "center": [377, 1768],
        "score": 0.941,
        "source": "detector",
        "match": {
          "status": "found",
          "slug": "uva-vallis-sovinon-blan",
          "confidence": { "top1": 0.88, "margin": 0.24, "top5": [ /* ... */ ] },
          "read": { "color": "white", "sweetness": "dry", "vintage": null, "text": null }
        }
      },
      {
        "bbox": [711, 19, 2403, 3999],
        "label_bbox": [813, 901, 2303, 3679],
        "center": [1557, 2009],
        "score": 0.959,
        "source": "detector",
        "match": {
          "status": "found",
          "slug": "leto-risling-2024-polusuhoe-vino",
          "confidence": { "top1": 0.93, "margin": 0.23, "top5": [ /* ... */ ] },
          "read": { "color": "white", "sweetness": "semi-dry", "vintage": "2024", "text": null }
        }
      }
    ]
  },
  "timing_ms": { "decode": 151.6, "detect": 398.9, "match": 1.3, "read": 0.01, "total": 551.8 },
  "model": { "name": "wine-label-stub", "version": "0.2.0-multibottle" },
  "demo": true
}
```

Поля бутылки:
- `bbox` — прямоугольник самой бутылки.
- `label_bbox` — более узкая область этикетки внутри `bbox` (для будущего
  кропа под matching/OCR); `null`, если не удалось определить.
- `center` — центр `bbox` (для `full_image` — центр всего изображения).
- `score` — уверенность детектора; для `source: "full_image"` всегда `0.0`.
- `source` — `"detector"` (настоящая/заглушечная детекция) или
  `"full_image"` — псевдо-бутылка на всё фото, когда детектор ничего не
  нашёл (например, кроп вплотную на этикетку).
- `match`/`read` — то же самое, что раньше было на верхнем уровне ответа, но
  теперь на уровне конкретной бутылки.

`primary` — индекс основной бутылки в `detection.bottles` (всегда валиден).
Выбирается как бутылка с максимальным `area * (1 - 0.5 * dist_to_center / half_diagonal)`
— то есть крупная и близкая к центру кадра бутылка предпочитается мелкой
или бутылке с краю.

Ответ при `status: "not_found"` (по primary-бутылке) — `slug: null`, `read`
заполнен по кандидату top1 (это предположение, а не подтверждённое
совпадение). То же самое верно на уровне каждой отдельной бутылки в
`detection.bottles[i].match`.

Ошибки: `400 {"detail": "..."}` — файл не передан или не декодируется как
изображение; `413 {"detail": "..."}` — файл больше `MAX_UPLOAD_MB`.

### `POST /predict`

Эндпоинт для проверяющего скрипта организаторов. Принимает **либо**
`multipart/form-data` с полем `file` или `image`, **либо** сырое тело
запроса с `Content-Type: image/*` или `application/octet-stream`. Использует
тот же pipeline, что и `/recognize`, и возвращает slug **primary**-бутылки.

```bash
curl -F "file=@bottle.jpg" "http://localhost:8000/predict"
curl --data-binary @bottle.jpg -H "Content-Type: image/jpeg" "http://localhost:8000/predict"
```

Ответ — **плоский** JSON без лишних полей:

```json
{ "slug": "leto-risling-2024-polusuhoe-vino" }
```

или `{ "slug": "" }`, если не найдено.

### `GET /health`

```json
{
  "status": "ok",
  "model": { "name": "wine-label-stub", "version": "0.2.0-multibottle" },
  "catalog_size": 2105,
  "detector": "rfdetr-seg-small",
  "detector_ready": true
}
```

`detector` — какой детектор сейчас активен (`rfdetr-seg-small` или `stub`,
с учётом отката при `DETECTOR=auto`). `detector_ready` — успел ли он уже
загрузиться (модель грузится один раз при старте сервера, см. ниже); не
форсирует загрузку сам по себе, только сообщает текущее состояние.

### `GET /`

Редирект на `/docs`.

## Как работает детекция

### RF-DETR-Seg Small (`DETECTOR=rfdetr`/`auto`, реальная модель)

Модель (`rfdetr.RFDETRSegSmall`, чекпойнт ~135 МБ) грузится **один раз** при
старте процесса (FastAPI `lifespan`, см. `app/main.py`) — первый HTTP-запрос
не ждёт загрузки. На каждом фото:

1. Фото уменьшается так, чтобы длинная сторона была ≤ 1280 px (для скорости
   на CPU); детекция идёт на уменьшенной копии, боксы/маски потом
   пересчитываются обратно в координаты исходного фото.
2. `model.predict(image, threshold=DETECT_THRESHOLD)` → оставляем только
   COCO-класс `44` ("bottle").
3. Пост-обработка (`app/detect_postprocess.py`, детектор-независимая, есть
   отдельные unit-тесты на синтетических боксах):
   - **dedup** — если IoU двух боксов `> 0.6` или один на `>= 90%` содержится
     в другом, оставляем бокс с более высоким score;
   - **фильтр по площади** — выбрасываем боксы меньше `MIN_BOTTLE_AREA` доли
     площади фото (шум);
   - **cap** — оставляем не больше `MAX_BOTTLES` самых крупных по площади;
   - **сортировка** — бутылки идут слева направо по `bbox[0]` (x1);
   - **primary** — argmax `area * (1 - 0.5 * dist(center, центр фото) / half_diagonal)`.
4. **`label_bbox`** считается по профилю ширины маски по строкам внутри
   `bbox`: находим "плечо" бутылки — первую строку сверху, где ширина маски
   достигает `>= 85%` от максимальной ширины по всем строкам, — и берём
   `[x1+0.06w, shoulder+0.04h, x2-0.06w, y2-0.08h]`, обрезая по `bbox`. Если
   маски нет или плечо не нашлось — эвристика `45%..80%` высоты `bbox`
   (как раньше делал `StubDetector`).
5. Если после всей пост-обработки не осталось ни одной бутылки (например,
   кроп вплотную на этикетку без видимого горлышка/донышка) — возвращается
   одна псевдо-бутылка на всё изображение: `source: "full_image"`,
   `score: 0.0`, `center` — центр фото, `label_bbox: null`.

`model.optimize_for_inference()` вызывается, только если у установленной
версии `rfdetr` есть такой метод и он не падает на CPU; иначе пропускается
без ошибки — на CPU инференс и так укладывается в ~300–450 мс на фото
3024×4032 (проверено, см. отчёт по запуску).

### Заглушка (`DETECTOR=stub`, используется в тестах)

- **Детекция** (`StubDetector`): всегда ровно одна бутылка. `bbox` — фиксированная
  центральная вертикальная полоса изображения (доля от ширины/высоты зависит от
  того, портретное фото или альбомное); `label_bbox` — нижне-средняя часть `bbox`;
  `source: "detector"`, `primary: 0`.

### Сопоставление и чтение атрибутов (пока заглушка для всех детекторов)

- **Сопоставление** (`StubMatcher`): берётся SHA1 от сырых байт файла **и
  bbox конкретной бутылки** (`sha1(raw_bytes + b"|x1,y1,x2,y2")`) — поэтому
  разные бутылки на одном многобутылочном фото детерминированно получают
  разные, независимые совпадения. По кускам хэша выбираются 5 разных позиций
  каталога и оценки в `[0,1]`. Логика зеркалит демо-режим фронтенда
  (`web/server/utils/recognizer.ts`), чтобы поведение совпадало, пока нет
  настоящего матчера.
- **Чтение атрибутов** (`StubLabelReader`): `color`/`sweetness`/`vintage`
  берутся из top-1 позиции каталога **этой бутылки**; `text` (OCR) — всегда `null`.

## Как подключить настоящий matcher/reader

Детекция уже настоящая (см. выше); осталось заменить два оставшихся
интерфейса в `app/pipeline.py` (`Matcher`, `LabelReader`) — класс `Pipeline`
и контракт `/recognize`, `/predict`, `/health` не меняются:

1. **`Matcher.match(image, bottle, raw_bytes, force=None) -> MatchResult`**
   — заменить `StubMatcher` на: обрезать `image` по `bottle.label_bbox` (или
   `bottle.bbox`, если `label_bbox is None`) → эмбеддинг через **SigLIP2** →
   приближённый top-K поиск по **pgvector** в базе каталога → шаг
   **re-ranking** (кросс-энкодер или бустинг по метаданным) для выбора
   финального top1/top5. Параметр `force` — служебный хук только для
   заглушки/тестирования UI, настоящему матчеру он не нужен.
2. **`LabelReader.read(image, bottle, match, catalog) -> ReadResult`** —
   заменить `StubLabelReader` на OCR (классический движок или маленькая VLM)
   для поля `text` и классификаторы/эвристики для `color`/`sweetness`/`vintage`,
   которые можно сверять с найденной позицией каталога.

`app/main.py` и `app/schemas.py` трогать не нужно — они уже реализуют финальный
контракт. `Pipeline.run()` в `app/pipeline.py` детектирует один раз, затем
матчит и читает атрибуты каждой найденной бутылки независимо, и заполняет
`timing_ms`.
