# leadleap-sheets-sync

Сервис на **Node.js** для ежедневной синхронизации **инсайтов Meta Ads** (Facebook) в **Google Sheets**. Данные подставляются в заранее подготовленные блоки на вкладках вида **`MONTH_NAME YEAR`** (например, `MARCH 2026`).

---

## Стек и требования

| Параметр | Значение |
|----------|----------|
| Язык | **JavaScript** (без TypeScript) |
| Модули | **ES Modules** (`"type": "module"` в `package.json`) |
| Node.js | **20+** |
| HTTP к Meta | встроенный **`fetch`** |
| Google API | **`googleapis`** (Sheets API v4) |
| Расписание | **`node-cron`** |
| Конфиг окружения | **`dotenv`** |

---

## Зависимости

- `googleapis` — авторизация сервисным аккаунтом и работа с таблицами
- `node-cron` — запуск по расписанию
- `dotenv` — переменные из `.env`

---

## Структура репозитория

```
leadleap-sheets-sync/
  package.json
  .gitignore
  project.md              # этот файл
  .env                    # локально (не в git)
  src/
    index.js              # вход: cron, CLI, syncDay, агрегация и запись
    config.js             # проекты, getGoogleAuth()
    meta-fetcher.js       # Meta Graph API insights
    sheet-scanner.js      # поиск блоков и колонок (в т.ч. несколько блоков в одной строке)
    sheets-writer.js      # запись в ячейки (batchUpdate)
    metrics.js            # CPL, CPM, CPC, CTR
```

---

## Как это работает (общий поток)

1. Для даты `YYYY-MM-DD` вычисляется имя вкладки: **`{ENGLISH_MONTH_UPPER} {YEAR}`** из месяца этой даты.
2. Для каждого **проекта** из `config.js`:
   - Загружаются инсайты из Meta за этот день на уровне **campaign** (с пагинацией).
   - Читается вся вкладка таблицы и **сканируются блоки** (см. ниже).
   - Для каждого **campaignMapping**:
     - Отфильтровываются кампании, у которых имя содержит подстроку `match` (без учёта регистра).
     - Суммируются impressions, clicks (см. ниже), spend и **результат** из `actions` по `resultAction`; опционально — **add to cart** по `addToCartAction`.
     - Считаются производные метрики (`metrics.js`), к объекту метрик добавляется **`addToCart`**, если задано в маппинге.
     - Находится блок в листе с именем `block` (сравнение без учёта регистра).
     - Если **spend > 0** (после округления в метриках), вызывается **`writeBlockData`**; ошибки записи логируются и не прерывают остальные маппинги.
3. Строка **TOTAL** в таблице **не перезаписывается** скриптом — предполагаются формулы Google Sheets. Функция **`updateTotals`** в `sheets-writer.js` сохранена, но **из `index.js` не вызывается**.

---

## Переменные окружения

Общие:

| Переменная | Назначение |
|------------|------------|
| `META_ACCESS_TOKEN` | токен доступа к Meta Graph API |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | JSON ключа сервисного аккаунта в **Base64** |

По проектам (ID таблицы и рекламный аккаунт Meta без префикса `act_`):

| Префикс env | Проект в `config.js` |
|-------------|----------------------|
| `..._FURNICUTA` | Furnicuța |
| `..._FABRIK` | Fabrik Home |
| `..._MMCARGO` | MM Cargo |
| `..._OOWELL` | OO.WELL |
| `META_AD_ACCOUNT_ID_OOWELL_PURCHASE` | OO.WELL Purchase (та же таблица, что у `GOOGLE_SPREADSHEET_ID_OOWELL`) |
| `..._TOPMAG` | TOPMAG |

Имена переменных: `GOOGLE_SPREADSHEET_ID_*`, `META_AD_ACCOUNT_ID_*` по шаблону из `config.js`.

Авторизация Google: **`getGoogleAuth()`** декодирует Base64 в JSON, создаёт **`GoogleAuth`** со scope **`https://www.googleapis.com/auth/spreadsheets`**.

---

## Конфигурация проектов (`src/config.js`)

Массив **`projects`**. Каждый проект: `name`, `spreadsheetId`, `adAccountId`, `campaignMapping`.

Поля маппинга:

| Поле | Описание |
|------|----------|
| `match` | подстрока в **названии кампании** (case-insensitive) |
| `block` | имя блока на листе (строка сразу под «META ADS» / «FACEBOOK ADS») |
| `resultAction` | ключ **`action_type`** в объекте **`actions`** после фетча |
| `addToCartAction` | опционально; значение в колонку Add to cart, если сканер нашёл заголовок |

### Текущие проекты (кратко)

| name | Особенности |
|------|-------------|
| **Furnicuța** | LEAD FORM (`lead`), MESSAGES (messaging conversation) |
| **Fabrik Home** | MESSAGE, PURCHASE + `addToCartAction` |
| **MM Cargo** | LEAD FORM, MESSAGES |
| **OO.WELL** | LEAD FORM, PURCHASE, Website Lead (`fb_pixel_lead`) |
| **OO.WELL Purchase** | та же таблица, отдельный **`META_AD_ACCOUNT_ID_OOWELL_PURCHASE`**, только PURCHASE |
| **TOPMAG** | MESSAGE, PRODUCT, CATALOG (`fb_pixel_lead`), PURCHASE |

---

## Meta: `src/meta-fetcher.js`

- Endpoint: **`GET https://graph.facebook.com/v21.0/act_{adAccountId}/insights`**
- Параметры: `time_range` (один день), `level=campaign`, `limit=500`
- Поля: `campaign_name`, `impressions`, `clicks`, `inline_link_clicks`, `spend`, `actions`
- **Клики** в агрегате: **`inline_link_clicks`**, иначе **`clicks`**
- **`actions`**: массив сворачивается в **`{ [action_type]: суммарный value }`**
- **Пагинация** по **`paging.next`**
- При ошибке — лог, возврат **`[]`**

Логи: старт запроса; итог с числом кампаний и **`actionTypes`** по каждой.

---

## Метрики: `src/metrics.js`

**`calculateMetrics(impressions, clicks, leads, spend)`** — округление до **6** знаков; **`cpl` / `cpm` / `cpc` / `ctr`** с **`null`**, если делитель ноль.

**CTR** = clicks / impressions, где **clicks** — ссылочные, если Meta вернула **`inline_link_clicks`**.

---

## Сканер: `src/sheet-scanner.js`

### Структура блока

1. **META ADS** или **FACEBOOK ADS** (нормализация регистра).
2. Следующая строка — **имя блока**.
3. Следующая — **строка заголовков** (обязательные колонки ниже).
4. Данные до строки **TOTAL**.

### Несколько блоков в одной строке (горизонтально)

В одной строке листа может быть **несколько** меток META/FACEBOOK ADS в **разных колонках**. Сканер:

- собирает **все** такие колонки;
- для **каждой** запускает ту же логику блока;
- затем сдвигает внешний индекс строки к **`max(totalRowIndex)`** по **успешно** найденным блокам этой строки, чтобы не задвоить разбор.

### `findHeaderColumns(headerRow, startCol = 0)`

Поиск заголовков **только с колонки `startCol` и правее** — чтобы не цеплять колонки **левого** соседнего блока при горизонтальной вёрстке. В **`scanSheet`** вторым аргументом передаётся индекс колонки метки (**`c`**).

### Колонки

**Обязательные:** DATE, IMPRESSIONS, CLICKS (в т.ч. «LINK CLICK…»), колонка результата (LEADS / варианты **LEADS…**, **WEBSITE LEADS**, **WEBSITE…**, **MESSAGING CONVERSATION…**, **PURCHASE** и т.д.), расход (SUMA / SPEND / AMOUNT SPENT…).

**Опциональные (**`-1`**, если нет):** add to cart, CPL, CPM, CPC, CTR (гибкие длинные заголовки).

В консоль пишется каждый найденный блок и объект **`columns`**.

---

## Запись: `src/sheets-writer.js`

**`writeBlockData`** — **`spreadsheets.values.batchUpdate`**: значения пишутся в **независимые** колонки (возможны «дыры» между метриками).

**`valueInputOption`:** **`RAW`**.

---

## Оркестрация: `src/index.js`

- **`aggregateCampaigns(insights, match, resultAction, addToCartAction?)`**
- Отладочные логи (временные/диагностические): **`[agg-match]`**, **`[metrics-debug]`**, **`[block-match]`**, **`[spend-check]`**
- Запись обёрнута в **`try/catch`**: сбой **`writeBlockData`** логируется, цикл маппингов продолжается

---

## Расписание и запуск

```bash
npm start
# или
node src/index.js
```

- Cron: **`0 3 * * *`**, timezone **`UTC`** → синхронизация **вчера** по UTC.
- Ручной запуск: **`node src/index.js 2026-03-22`**

---

## Ограничения и безопасность

- Номер строки дня — из **`DD`** в дате.
- Запись при условии **`metrics.spend > 0`**.
- **`META_ACCESS_TOKEN`** и **`GOOGLE_SERVICE_ACCOUNT_KEY`** не коммитить; **`.env`** в **`.gitignore`**.

---

## Расширение

- Новый клиент: объект в **`projects`** + переменные в **`.env`** (и на Railway / в хостинге).
- Новый **resultAction** — ключ из сырого ответа Meta **`actions`**.
- Новый заголовок колонки — доработка **`findHeaderColumns`** и при необходимости **`writeBlockData`**.
