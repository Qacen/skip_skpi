# Развёртывание на vast.ai (сайт + распознавание на GPU)

Одна машина с GPU, например RTX 3060 12 ГБ.
- Распознавание (`ml/`, FastAPI: RF-DETR + SigLIP2 на CUDA) слушает только `127.0.0.1:8000`.
- Сайт (Nuxt, `web/.output`) слушает порт 3000, наружу выходит через https-туннель Cloudflare. Аккаунт не нужен.
- Если процесс упадёт, он перезапустится сам.

## 1. На Mac: архив

```bash
bash deploy/vast/make_bundle.sh      # -> deploy/vast/wine-deploy.tar.gz (~27 МБ)
```

`--with-weights` добавит в архив веса SigLIP (0.8 ГБ), и тогда на сервере не придётся качать 4.5 ГБ с Hugging Face. Обычно это не нужно: у сервера канал быстрее.

## 2. На vast: Jupyter

1. **Upload**: загрузите `wine-deploy.tar.gz` и `deploy_vast.ipynb`.
2. Откройте `deploy_vast.ipynb` и выполните ячейки по порядку:
   - **распаковка** архива в `/workspace/wine`;
   - **setup.sh** — один раз, 5–10 минут: Node 22, cloudflared, Python-зависимости (CUDA-torch из образа сохраняется), веса SigLIP с Hugging Face и RF-DETR;
   - **start.sh** — поднимает ML на GPU, сайт и туннель, печатает `SITE: https://….trycloudflare.com/wines`;
   - **проверка** — `/api/predict` на фото «Формула Q» и `/api/ml/status`.

Ссылка лежит в `/workspace/wine/run/public_url.txt`. Логи — в `/workspace/wine/run/*.log`.

Ссылка сохраняется при повторном `start.sh`, пока туннель жив. Новую ссылку дают:
- `bash stop.sh` без аргументов — останавливает всё, включая туннель;
- `TUNNEL=new bash start.sh`;
- перезапуск машины.

## Обновление без смены ссылки

1. На Mac: `bash deploy/vast/make_bundle.sh`.
2. В Jupyter загрузите новые `wine-deploy.tar.gz` и `deploy_vast.ipynb`, выполните первую ячейку (распаковка) и ячейку запуска.

Ячейку setup при обновлении можно пропустить, если не менялись зависимости. Сайт и ML перезапустятся, туннель и ссылка останутся прежними.

## Без туннеля: SSH

Если в vast есть SSH-доступ:

```bash
ssh -p <порт> root@<ip> -L 3000:localhost:3000 -L 8000:localhost:8000
```

После этого сайт открывается на http://localhost:3000, а камера в браузере работает (localhost считается безопасным источником). На `localhost:8000` доступен ML, его можно подключить к локальному сайту через `web/ml-url.txt`. Запуск без туннеля: `TUNNEL=0 bash start.sh`.

## Параметры (env для start.sh)

| Переменная | По умолчанию | |
|---|---|---|
| `DEVICE` | `cuda` | `cpu` — если GPU нет |
| `WEB_PORT`, `ML_PORT` | 3000, 8000 | |
| `TUNNEL` | 1 | 0 — без cloudflared |
| `EMBEDDER_PATH` | `ml/weights/siglip2-naflex-vision-fp16`, если веса есть в архиве, иначе `google/siglip2-so400m-patch16-naflex` | |
| `NUXT_ML_TIMEOUT_MS` | 15000 | |
| `PY` | `python3` | Python с CUDA-torch |

Адрес туннеля без авторизации: кто его знает, тот может слать запросы. Не публикуйте его, ключи и секреты на машине не храните.
