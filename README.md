# Профессиональный навигатор — backend starter

Стартовый backend для MVP из командного документа. Стек: Next.js Route Handlers, TypeScript, PostgreSQL, Docker, Zod. В первой неделе цель — рабочий репозиторий, локальная БД, миграции и базовые API. Подключение GigaChat/RAG и полноценные правила рекомендаций оставлены на неделю 2.

## Что реализовано

- Next.js + TypeScript scaffold.
- PostgreSQL 16 через Docker Compose.
- SQL migration runner с таблицей `schema_migrations`.
- Схема таблиц: sessions, profiles, diagnostics, diagnostic_answers, professions, education_programs, professional_trials, organizations, regions, recommendations, sources, reflections, audit_events, catalog_versions.
- API:
  - `GET /api/health`
  - `POST /api/track/select`
  - `POST /api/diagnostic/submit`
  - `GET /api/trials?region=Екатеринбург&limit=20`
  - `POST /api/reflection`
  - `POST /api/recommendations/generate` — временная заглушка до интеграции ИИ на второй неделе.
- Валидация входных данных через Zod.
- Пример env-файла и Dockerfile.

## Запуск локально

Требования: Docker Desktop, Node.js 22+, npm.

1. Скопировать переменные окружения:
   ```bash
   cp .env.example .env.local
   ```
2. Запустить PostgreSQL:
   ```bash
   docker compose up -d db
   ```
3. Установить зависимости:
   ```bash
   npm install
   ```
4. Применить миграции и seed:
   ```bash
   npm run db:migrate
   npm run db:seed
   ```
5. Запустить приложение:
   ```bash
   npm run dev
   ```
6. Проверить: открыть `http://localhost:3000/api/health`.

`DATABASE_URL` в `.env.local` для запуска Next.js на хосте должен использовать `localhost`. Для app-контейнера в `docker-compose.yml` используется hostname `db`.

## Полный запуск в Docker

```bash
docker compose up --build
```

Примечание: миграции пока запускаются отдельной командой на хосте; если используете только контейнерный сценарий, выполните миграции внутри app-контейнера после старта:
```bash
docker compose exec app npm run db:migrate
docker compose exec app npm run db:seed
```

## Примеры API

Для запросов, связанных с пользовательской сессией, идентификатор UUID передаётся в заголовке `X-Session-ID`, а не в JSON.

### Выбрать трек

```bash
curl -X POST http://localhost:3000/api/track/select \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: 6f9619ff-8b86-d011-b42d-00cf4fc964ff" \
  -d '{"trackType":"explore"}'
```

Допустимые `trackType`: `explore`, `interests`, `known_direction`.

### Отправить ответы диагностики

```bash
curl -X POST http://localhost:3000/api/diagnostic/submit \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: 6f9619ff-8b86-d011-b42d-00cf4fc964ff" \
  -d '{"answers":[{"questionId":"q1","answer":"technology"},{"questionId":"q2","answer":true}]}'
```

Сначала необходимо вызвать `/api/track/select` с тем же `X-Session-ID`.

### Сгенерировать AI-рекомендацию

```bash
curl -X POST http://localhost:3000/api/recommendations/generate \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: 6f9619ff-8b86-d011-b42d-00cf4fc964ff"
```

Для работы требуется настроить `AI_API_BASE_URL`, `AI_API_KEY` и `AI_MODEL` в `.env.local`, а также предварительно отправить диагностику.

Рекомендации генерируются через AI-сервис и сохраняются в PostgreSQL.

### Получить профессиональные пробы

```bash
curl "http://localhost:3000/api/trials?region=Екатеринбург&limit=20"
```

### Сохранить рефлексию

```bash
curl -X POST http://localhost:3000/api/reflection \
  -H "Content-Type: application/json" \
  -H "X-Session-ID: 6f9619ff-8b86-d011-b42d-00cf4fc964ff" \
  -d '{"rating":"useful","comment":"Хочу попробовать"}'
```

Если передаётся `recommendationId`, рекомендация должна принадлежать указанной сессии.

## Загрузка данных

Для загрузки каталога из Excel:

```bash
npm run db:seed
```

Команда проверяет данные перед импортом и загружает их в PostgreSQL.

Повторный импорт обновляет существующие записи каталога по внешним идентификаторам без создания их дубликатов.

## Важные ограничения перед передачей команде

- `X-Session-ID` идентифицирует сессию, но не обеспечивает полноценную аутентификацию и авторизацию.
- Модель контроля доступа необходимо согласовать перед использованием с реальными пользователями.
- Административная авторизация и RLS-политики не реализованы.
- Перед использованием с реальными школьниками необходимо проверить требования 152-ФЗ, согласия, сроки хранения и минимизацию персональных данных.
- Секреты, пароли и `.env.local` нельзя добавлять в Git.
- Перед развёртыванием необходимо проверить конфигурацию окружения и заменить тестовые пароли.
