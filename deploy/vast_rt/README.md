# Распознавание вин в реальном времени: сервер на vast.ai + локальный клиент

Сервер: только ML (RF-DETR-Seg Small + SigLIP2 naflex-1024, дообученная), слушает 127.0.0.1:8000.
Клиент (`rt_client.py`, у вас на машине): камера/видео → `/rt/detect` (все бутылки, без фильтра) → **локальный** фильтр первого ряда
(ползунки в окне «filter»), трекинг оптическим потоком, самый резкий кроп каждой бутылки → `/rt/identify` (18 181 вино: «Своё вино» + AMWINE + winedb_ru).

## 1. Сервер (vast.ai, SSH)
```bash
# с вашей машины
scp -P <PORT> wine_rt.zip root@<IP>:/workspace/
ssh -p <PORT> root@<IP> -L 8000:localhost:8000
# на сервере
cd /workspace && unzip -o wine_rt.zip -d wine_rt && cd wine_rt
bash setup_rt.sh          # один раз: зависимости, веса с Hugging Face (~5 ГБ), проверка GPU
bash start_rt.sh          # запуск; печатает /rt/info (какая точность/компиляция реально включились)
tail -f ml.log
```
Параметры `start_rt.sh` (env): `RT_DET_PRECISION=amp|fp32`, `RT_DET_COMPILE=off|default|max-autotune`, `EMBED_PRECISION=auto|fp16|amp|fp32`, `RT_FORCE=1`.

## 2. Клиент (ваша машина, пока открыт ssh -L 8000:localhost:8000)
```bash
pip install opencv-python numpy requests pillow
python rt_client.py --src 0                         # веб-камера
python rt_client.py --src video.mov --save out.mp4  # файл, проигрывается в реальном темпе
```
Окно «filter»: порог score, высота относительно самой высокой бутылки, площадь маски относительно топ-3, мин. высота, порог показа названия (cos), мин. резкость.
Клавиши: `q` выход, `b` рамки вкл/выкл (зелёные — прошли фильтр, красные — отброшены), пробел — пауза.

## API
- `POST /rt/detect?threshold=0.25&poly=1` (file) → `bottles: [{bbox, score, mask_area, polygon}]`, `ms`
- `POST /rt/identify?k=5` (files: один или несколько кропов) → `results: [[{id, source, name, cos}]]`, `ms`
- `GET /rt/info` — GPU, реально включённые точность и compile
- `/predict`, `/recognize` — прежний сервис (каталог «Своё вино»)

## GTX 1080 Ti — важно
- **Смешанная точность на 1080 Ti медленнее, а не быстрее.** У Pascal (cc 6.1) нет тензорных ядер, fp16 там в ~64 раза медленнее fp32.
  Поэтому на cc < 7.0 сервер сам ставит fp32 и пишет об этом в лог; `RT_FORCE=1` включит amp принудительно (для замера).
- **`torch.compile` (max-autotune) на 1080 Ti не работает**: Triton, на котором он строится, требует cc ≥ 7.0. На 1080 Ti сервер отключит compile и
  продолжит в eager. На RTX 20xx/30xx/40xx (cc ≥ 7.5) amp + max-autotune включатся как заказано (первый запуск компилирует 1–5 мин).
- Свежие сборки PyTorch под CUDA 12.8 Pascal уже не поддерживают; `setup_rt.sh` ставит сборку cu126.
