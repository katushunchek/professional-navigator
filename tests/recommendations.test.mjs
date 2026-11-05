import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  assertApiAvailable,
  createSession,
  isAiGatewayConfigured,
  postJson,
  readJson,
} from './helpers.mjs';

test('POST /api/recommendations/generate: проверка доступности API', async () => {
  await assertApiAvailable();
});

test('POST /api/recommendations/generate: без X-Session-ID возвращает 401', async () => {
  const response = await postJson('/api/recommendations/generate', { body: {} });
  const payload = await readJson(response);

  assert.equal(response.status, 401);
  assert.match(payload.error, /X-Session-ID/i);
});

test('POST /api/recommendations/generate: некорректный UUID возвращает 400', async () => {
  const response = await postJson('/api/recommendations/generate', {
    sessionId: 'not-a-uuid',
    body: {},
  });
  const payload = await readJson(response);

  assert.equal(response.status, 400);
  assert.match(payload.error, /valid UUID/i);
});

test('POST /api/recommendations/generate: неизвестная сессия возвращает 404', async () => {
  const response = await postJson('/api/recommendations/generate', {
    sessionId: randomUUID(),
    body: {},
  });
  const payload = await readJson(response);

  assert.equal(response.status, 404);
  assert.match(payload.error, /Session not found/i);
});

test('POST /api/recommendations/generate: не начинает генерацию без диагностики', async (t) => {
  const sessionId = await createSession(t);
  const response = await postJson('/api/recommendations/generate', {
    sessionId,
    body: {},
  });
  const payload = await readJson(response);

  // В текущем обработчике настройки AI проверяются раньше наличия диагностики.
  // Поэтому ответ будет 503 при не настроенном AI Gateway и 409 — при настроенном.
  if (isAiGatewayConfigured()) {
    assert.equal(response.status, 409);
    assert.match(payload.error, /Complete the diagnostic/i);
  } else {
    assert.equal(response.status, 503);
    assert.match(payload.error, /AI service is not configured/i);
  }
});
