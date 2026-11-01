# Контракт для frontend (Дима)

Источник истины по полям: `docs/API.md` и Zod в `lib/schemas.ts`. Этот файл описывает **последовательность вызовов и хранение**. Никаких «согласованных» полей, которых нет в API, здесь нет.

База: `http://localhost:3000` (локально). JSON UTF-8. Ошибки: `{"error":"...", "details"?: ...}`.

## Главное правило хранения

Frontend **не** хранит результаты диагностики, уточнений, рекомендаций и рефлексии как единственную копию. Браузер может держать только:

- `sessionId` (UUID, который клиент сам генерирует до первого запроса);
- состояние UI (текущий экран, черновик формы).

После перезагрузки экрана данные нужно заново прочитать с backend: `GET /api/session`.

## X-Session-ID

- Обязателен для всех маршрутов сессии.
- Формат: UUID RFC (Zod отклоняет невалидную версию, например `…-d011-…`).
- Клиент генерирует UUID один раз и передаёт **тем же** значением во все запросы школьника.
- Это **не логин**. Кто знает UUID, читает и пишет эту сессию. Отдельной авторизации нет.

Нет заголовка → `401`. Не UUID → `400`. Сессия ещё не создана через track (кроме самого track) → `404`.

## Последовательность экранов

1. Сгенерировать `sessionId`.
2. `POST /api/track/select` — создать сессию и сохранить трек.
3. `GET /api/diagnostic/questions?grade=` — показать анкету (класс 1–11). Список анкет: без `grade`.
4. `POST /api/diagnostic/submit` — сырые ответы в PostgreSQL.
5. При необходимости `GET /api/clarification/questions`, затем `POST /api/clarification/submit` (нужна диагностика, иначе `409`).
6. `POST /api/recommendations/generate` — GigaChat; успех только `201`.
7. Показать `hypotheses` и `nextStepOptions`.
8. `POST /api/reflection`.
9. Возврат на экран: `GET /api/session` (или точечно `GET /api/diagnostic/latest`, `GET /api/recommendations`, `GET /api/reflection`).

Каталог без сессии: `GET /api/health`, `GET /api/professions`, `GET /api/professions/[id]`, `GET /api/trials`.

## Примеры

### Трек

`POST /api/track/select`  
Заголовок: `X-Session-ID: 6f9619ff-8b86-4011-a42d-00cf4fc964ff`

```json
{ "trackType": "explore" }
```

`200`: `{ "sessionId": "6f9619ff-8b86-4011-a42d-00cf4fc964ff", "trackType": "explore", "status": "selected" }`  
`trackType`: `explore` | `interests` | `known_direction`.

### Диагностика

`POST /api/diagnostic/submit`

```json
{
  "answers": [
    { "questionId": "bilet_q1_subjects", "answer": ["Математика", "Информатика"] },
    { "questionId": "bilet_q4_decision", "answer": ["Я еще ни с чем не определился(-лась)"] }
  ]
}
```

`answer`: строка (до 1000), число, boolean или массив строк (элемент до 500 символов). 1–100 вопросов, уникальные `questionId`.

`201`: `{ "diagnosticId", "savedAnswers", "clarificationId", "savedClarificationAnswers", "status": "submitted" }`

Опционально в том же теле `clarificationAnswers` (1–6). Надёжнее отдельный `POST /api/clarification/submit`.

### Уточнения (6 вопросов агента)

`GET /api/clarification/questions` → `data[]` с `question_id`, `type`, `options[].value`.

`POST /api/clarification/submit`

```json
{
  "answers": [
    { "questionId": "agent_q1_likes", "answer": ["data"] },
    { "questionId": "agent_q2_work_style", "answer": "team" }
  ]
}
```

Для multi_choice — массив `value` из каталога или `{ "values": ["other"], "customText": "…" }` только если `allow_custom_text`. Не подставлять произвольный текст вместо `value`.

### Рекомендации

`POST /api/recommendations/generate` тело `{}` или `{ "clarificationAnswers": [...] }`.

Успех **201**. Поля для UI:

- `summary`, `hypotheses[]` (`professionId`, `title`, `reason`, `fitScore`, `scoreKind`)
- `nextStep`
- `nextStepOptions` — ровно три слота: `club`, `college`, `online_course`

`fitScore` — относительный порядок гипотез (`scoreKind: "relative_ranking"`). **Не** процент соответствия и не RIASEC школьника.

`nextStepOptions` элемент:

```json
{
  "type": "college",
  "available": true,
  "title": "Технология машиностроения",
  "organization": "УПК-МЦК",
  "url": "https://example.edu",
  "contactEmail": null,
  "source": "catalog",
  "note": "Данные из проверенного каталога."
}
```

Если данных нет:

```json
{
  "type": "club",
  "available": false,
  "note": "В проверенном каталоге нет кружка или секции для выбранных профессий. Контакты не выдумываются."
}
```

При `available: false` не выдумывать кружок, колледж, курс, телефон или ссылку.

Повторная загрузка: `GET /api/recommendations` → `"status": "saved"`, те же поля.

### Рефлексия

`POST /api/reflection`

```json
{ "rating": "useful", "comment": "Хочу попробовать", "recommendationId": "<uuid>" }
```

`rating`: `useful` | `unsure` | `not_useful`. `recommendationId` должен принадлежать этой сессии.

Чтение: `GET /api/reflection` → `{ "data": [...], "count": n }`.

### Снимок сессии

`GET /api/session` — трек, профиль (если есть), последняя диагностика с уточнениями, последняя рекомендация, список рефлексий.

## Ошибки, которые UI должен уметь показать

| HTTP | Когда |
|---|---|
| 400 | битый JSON или не UUID |
| 401 | нет `X-Session-ID` |
| 404 | нет сессии / нет диагностики / чужая recommendationId |
| 409 | generate или clarification без диагностики |
| 422 | Zod или неизвестный `questionId` уточнения |
| 502 | GigaChat/схема модели; в теле могут быть `parseStage` и `schemaIssues` (пути, не текст модели) |
| 503 | нет ключа AI, пустой каталог, нет миграций, БД отвалилась на health |
| 504 | таймаут AI |

Пока generate идёт, запрос может длиться до `AI_TIMEOUT_MS` (по умолчанию 45 с).

## Что реализовать на frontend (без правок frontend в этом репозитории)

- Генерация и хранение `sessionId` только как ключ API.
- Экраны трека, диагностики по `grade`, 6 уточнений, рекомендации, рефлексия.
- Отрисовка `nextStepOptions` с честным `available: false`.
- Не показывать `fitScore` как «совпадение %».
- Восстановление прогресса через `GET /api/session`.
- Сообщения для 401/400/502/503/504.

## Решения, которые нужны от Димы

- Генерирует ли клиент UUID сам (сейчас backend этого не делает, кроме приёма заголовка).
- Обязательны ли все 6 уточнений перед generate или достаточно диагностики.
- Как показывать `available: false` (текст `note` с API или свой copy).
- Нужен ли экран повторной загрузки по сохранённому `sessionId`.
- Показывать ли справочный `riasec` профессии с `GET /api/professions` — это профиль каталога, не баллы ученика.
- Класс и город: отдельного API профиля нет; `profiles` заполняется seed моков, не обычным track/select.
