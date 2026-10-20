# Сервис на Kaggle T4 + временная ссылка Cloudflare

Тот же сервис, что и локально (`app.main:app`), только на GPU T4. Наружу он открывается через [Cloudflare quick tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/). Аккаунт Cloudflare не нужен. Адрес вида `https://<слова>.trycloudflare.com` работает, пока запущена сессия.

## Запуск

1. Kaggle → **New Notebook** → **File → Import notebook** → `ml/kaggle/serve_t4.ipynb`, или скопировать 2 ячейки из него вручную.
2. **Settings**:
   - **Accelerator** → **GPU T4 x2**, для сервиса хватает одной T4;
   - **Internet** → **On**, нужен для pip и cloudflared.
3. **Add Input**:
   - датасет `qujvxta/wine-ml-service` — код сервиса, индекс каталога, тексты для ридера, `catalog.json`;
   - вывод ноутбука `qujvxta/wine-tuned-export` — дообученная vision-часть (HF `dobermanjohn/secret_a`: блоки 19–26 + head), fp16, 0.8 ГБ. Если он подключён, матчер работает на ней (`--model auto`) со своим индексом `index_tuned_naflex1024.npz`, кропом до 1152 и `FOUND_MIN_COS=0.62`;
   - вывод ноутбука `qujvxta/wine-ml-export` — базовая vision-часть SigLIP2 в fp16, 0.8 ГБ. На ней работает ридер года и цвета, потому что текстовые эмбеддинги выровнены с базой. Без него модель скачается с Hugging Face целиком, это 4.5 ГБ, дольше.
   - `--model base` — матчер на базовой модели, как было до дообучения.
4. **Run All**. Примерно через 2 минуты в выводе появится адрес:

```
PUBLIC URL:  https://tribunal-reserved-ensure-emails.trycloudflare.com
docs:        https://.../docs
predict:     curl -F file=@photo.jpg https://.../predict
```

Адрес также записан в `/kaggle/working/tunnel_url.txt`.

5. Проверка с любой машины:

```bash
curl -F file=@photo.jpg https://<адрес>/predict
```

   Для сайта: из корня `lct` выполнить `echo "https://<адрес>" > web/ml-url.txt` (сайт перечитывает файл при каждом скане; :8010 остаётся запасным). Эта строка печатается рядом с PUBLIC URL.

Ячейка держит сервер `--hours` часов, по умолчанию 11. Ячейку не останавливать, вкладку можно закрыть. Интерактивная сессия Kaggle живёт до 12 часов, но может закрыться при долгом бездействии. Для надёжного прогона: **Save Version → Save & Run All (Commit)**. Адрес тогда смотреть в логе запущенной версии: **Output → Logs**.

Если туннель упадёт, `serve.py` перезапустит его сам, но адрес при этом сменится. Новый адрес будет в логе, строка `NEW PUBLIC URL`.

## Замеры (Kaggle T4, 87 real-photo, оригиналы 12 Мп)

| | top1 | top5 | exact+probable top1 | p50 | p90 |
|---|---|---|---|---|---|
| через туннель (с машины Kaggle) | 0.793 | 0.931 | 0.918 | 0.91 с | 1.20 с |
| localhost на той же машине | 0.793 | 0.931 | 0.918 | 0.81 с | 1.06 с |

Время сервера: медиана 0.7–0.8 с. Из них примерно 0.2 с — декодирование 12 Мп, 0.1–0.2 с — детекция, по 86 мс — эмбеддинг каждой бутылки и зоны этикетки главной бутылки. `/predict` считает только главную бутылку. SLA 3 с выдерживается с запасом.

Проверка целиком (сервер, туннель, прогон 87 фото через публичный адрес) — кернел `qujvxta/wine-ml-serve-smoke` (`wine_seg/kernels/ml_serve_smoke`).

## Ограничения

- Авторизации нет: кто знает адрес, может слать запросы. Адрес не публиковать.
- Адрес меняется при каждом запуске. Постоянный адрес — это named tunnel: нужен аккаунт Cloudflare и токен в Kaggle Secrets. Сейчас этого нет.
- У quick tunnel нет SLA, Cloudflare держит его для тестов. На время проверки жюри лучше держать запасной вариант, например тот же сервис локально.
