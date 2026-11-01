# API-контракты — Профессиональный навигатор

Статус: рабочая документация API для backend MVP. Существующие поля сохранены; новые поля и маршруты **аддитивны**.

## Общие правила

- Локальный адрес: `http://localhost:3000`
- Формат: JSON (UTF-8).
- Идентификатор сессии: заголовок `X-Session-ID` (UUID).
- Формат ошибок: `{"error": "описание ошибки"}`. При Zod-ошибке может быть дополнительное поле `details`.
- `X-Session-ID` **не** является аутентификацией. Любой, кто знает UUID, работает с данными этой сессии.

## 1. Проверка состояния

**GET** `/api/health`

`200 OK`:

```json
{
  "status": "ok",
  "database": "connected",
  "service": "professional-navigator-api",
  "aiConfigured": false
}
```

`aiConfigured` — заданы ли `AI_API_BASE_URL`, `AI_API_KEY` и `AI_MODEL`. Это не проверка доступности шлюза. Если БД недоступна — `503` и `"database": "disconnected"`.

## 2. Выбор трека

**POST** `/api/track/select`

Заголовок: `X-Session-ID: <UUID>`

```json
{ "trackType": "explore" }
```

Допустимо: `explore`, `interests`, `known_direction`.

`200 OK`: `{ "sessionId", "trackType", "status": "selected" }`

Ошибки: 400, 401, 422, 500.

## 3. Вопросы диагностики

**GET** `/api/diagnostic/questions`  
**GET** `/api/diagnostic/questions?grade=9`

Без `grade` — список анкет из `data/bilet_questions_master.json`.  
С `grade` (1–11) — полная анкета для класса. Для 1–5 используется мок-версия «1-5 класс».

Ошибки: 400 (некорректный grade), 404 (нет анкеты).

## 4. Отправка диагностики

**POST** `/api/diagnostic/submit`

Тело (старый контракт сохраняется):

```json
{
  "answers": [
    { "questionId": "q1", "answer": "Мне нравится программирование" },
    { "questionId": "q2", "answer": "Люблю анализировать данные" }
  ]
}
```

- `answers`: 1–100, уникальные `questionId`.
- `answer`: строка, число, boolean или массив строк.
- Опционально `clarificationAnswers` (1–6 элементов, те же правила, что у `/api/clarification/submit`).

`201 Created`:

```json
{
  "diagnosticId": "a12b34cd-1234-4567-8901-123456789abc",
  "savedAnswers": 2,
  "clarificationId": null,
  "savedClarificationAnswers": 0,
  "status": "submitted"
}
```

`clarificationId` / `savedClarificationAnswers` — аддитивные поля. Нужна существующая сессия (сначала track/select).

Ошибки: 400, 401, 404, 422, 503 (нет миграций), 500.

## 5. Последняя диагностика сессии

**GET** `/api/diagnostic/latest`

Заголовок `X-Session-ID`. `200` с `answers` и `clarification` (или `null`). `404` если диагностики нет.

## 6. Уточняющие вопросы агента

**GET** `/api/clarification/questions` — 6 вопросов из `data/agent_clarification.json`.

**POST** `/api/clarification/submit`

```json
{
  "answers": [
    { "questionId": "agent_q2_work_style", "answer": "team" }
  ]
}
```

Для `multi_choice` допустимы массив строк или `{ "values": ["tech"], "customText": "..." }` только если у опции `allow_custom_text`. Значения сверяются с каталогом.

Нужна сохранённая диагностика (`409` если её нет). `201`: `{ "clarificationId", "savedAnswers", "status": "submitted" }`.

## 7. Генерация рекомендаций

**POST** `/api/recommendations/generate`

Тело может быть пустым `{}` (старый контракт) или содержать `clarificationAnswers`.

Логика:

1. Проверка сессии.
2. Чтение последней диагностики; `409` если нет.
3. Сохранение уточнений, если переданы.
4. Загрузка профиля, активных профессий, программ и проб.
5. Запрос к AI Gateway (GigaChat, OpenAI-compatible).
6. Валидация JSON модели. Названия профессий подменяются из каталога по UUID.
7. Сборка `nextStepOptions` из программ БД и, если нужно, из `navigator_full_graph.json` без выдуманных телефонов и ссылок.
8. Сохранение в `recommendations` (включая JSONB `pathways`).

`201 Created` (поля `summary`, `hypotheses`, `trials`, `nextStep`, `model`, `createdAt` сохранены):

```json
{
  "status": "generated",
  "recommendationId": "60df6779-2890-4fa2-93a9-959df65134f1",
  "sessionId": "72863e2d-f598-4692-9bc8-8f77e98659ba",
  "summary": "Интерес к анализу данных и технике.",
  "hypotheses": [
    {
      "professionId": "ec5a249f-50a3-465d-ad12-c69c83b9180f",
      "title": "Аналитик данных",
      "reason": "Содержательные ответы про анализ данных.",
      "fitScore": 70,
      "scoreKind": "relative_ranking"
    }
  ],
  "trials": [],
  "nextStep": "Изучить подходящие профессиональные направления.",
  "nextStepOptions": [
    {
      "type": "club",
      "available": false,
      "note": "В проверенном каталоге нет кружка или секции для выбранных профессий. Контакты не выдумываются."
    },
    {
      "type": "college",
      "available": true,
      "title": "Технология машиностроения",
      "organization": "УПК-МЦК",
      "url": "https://example.edu",
      "source": "catalog",
      "note": "Данные из проверенного каталога."
    },
    {
      "type": "online_course",
      "available": false,
      "note": "В проверенном каталоге нет онлайн-курса с проверенной ссылкой для выбранных профессий."
    }
  ],
  "model": "GigaChat-2-Pro",
  "createdAt": "2026-10-28T11:53:36.017Z"
}
```

`fitScore` — относительный порядок гипотез модели, **не** психометрия, **не** процент соответствия, **не** RIASEC школьника. Профиль RIASEC профессии может присутствовать в каталоге как справочное поле.

Ошибки:

- 400 — некорректный UUID или JSON
- 401 — нет заголовка
- 404 — нет сессии
- 409 — нет диагностики
- 422 — невалидные clarifications
- 502 — ошибка/невалидный ответ AI. Тело может содержать `parseStage` и `schemaIssues` (`path` + `code` без текста модели и без ответов ученика).
- 503 — нет конфигурации AI, пустой каталог, устаревшая схема
- 504 — таймаут AI
- 500 — внутренняя ошибка

Переменные: `AI_API_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, опционально `AI_TIMEOUT_MS`. Ключ не логируется.

## 8. Чтение последней рекомендации

**GET** `/api/recommendations`

Заголовок `X-Session-ID`. Форма близка к ответу generate, `"status": "saved"`. `404` если записей нет.

## 9. Рефлексия

**POST** `/api/reflection`

```json
{ "rating": "useful", "comment": "Рекомендации были полезны" }
```

`rating`: `useful` | `unsure` | `not_useful`. `recommendationId` и `comment` необязательны. Если `recommendationId` задан, запись должна принадлежать сессии (`404` иначе).

`201`: `{ "id", "created_at", "status": "saved" }`

## 10. Профессии и пробы

**GET** `/api/professions` — список активных профессий (в т.ч. справочный `riasec` каталога).

**GET** `/api/professions/[id]` — карточка по UUID или `external_id` (например `prof_001`).

**GET** `/api/trials?region=Екатеринбург&limit=20` — активные профпробы. `limit` 1–100.

## 11. Результаты ручного интеграционного тестирования (исторические)

Дата: 28 октября 2026 года (локальное окружение предыдущей итерации).

| Проверка | Результат |
|---|---|
| Подключение PostgreSQL | Успешно |
| Каталог профессий | 200 OK, 40 записей |
| Создание сессии | 200 OK |
| Сохранение диагностики | 201, 4 ответа |
| Генерация через GigaChat-2-Pro | 201 Created |
| Хранение русского текста | Подтверждена |
| Без X-Session-ID | 401 |
| Несуществующая сессия | 404 |
| Некорректный UUID | 400 |
| Пустой массив answers | 422 |

Повтор этого прогона в текущей итерации не утверждается, пока команды не выполнены заново.

## 12. Ограничения

- Нет полноценной авторизации и RLS.
- Частота запросов к ИИ не ограничена на уровне приложения.
- Кружки и онлайн-курсы часто отсутствуют в источнике — API честно возвращает `available: false`.
- Frontend не должен показывать `fitScore` как процент «совпадения с профессией».
