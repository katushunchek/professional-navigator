import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertApiAvailable,
  newSessionId,
  postJson,
  queryTestDb,
  readJson,
} from './helpers.mjs';

test('POST /api/track/select: проверка доступности API', async () => {
  await assertApiAvailable();
});

test('POST /api/track/select: без X-Session-ID возвращает 401', async () => {
  const response = await postJson('/api/track/select', {
    body: { trackType: 'explore' },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 401);
  assert.match(payload.error, /X-Session-ID/i);
});

test('POST /api/track/select: некорректный UUID возвращает 400', async () => {
  const response = await postJson('/api/track/select', {
    sessionId: 'not-a-uuid',
    body: { trackType: 'explore' },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 400);
  assert.match(payload.error, /valid UUID/i);
});

test('POST /api/track/select: неизвестный trackType возвращает 422', async (t) => {
  const sessionId = newSessionId(t);
  const response = await postJson('/api/track/select', {
    sessionId,
    body: { trackType: 'unknown_track' },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 422);
  assert.equal(payload.error, 'Validation failed');
});

test('POST /api/track/select: создаёт новую сессию', async (t) => {
  const sessionId = newSessionId(t);
  const response = await postJson('/api/track/select', {
    sessionId,
    body: { trackType: 'explore' },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 200);
  assert.deepEqual(payload, {
    sessionId,
    trackType: 'explore',
    status: 'selected',
  });

  const stored = await queryTestDb(
    'SELECT id, track_type FROM sessions WHERE id = $1::uuid',
    [sessionId]
  );
  assert.equal(stored.rowCount, 1);
  assert.equal(stored.rows[0].track_type, 'explore');
});

test('POST /api/track/select: обновляет тип существующей сессии', async (t) => {
  const sessionId = newSessionId(t);

  const firstResponse = await postJson('/api/track/select', {
    sessionId,
    body: { trackType: 'explore' },
  });
  assert.equal(firstResponse.status, 200);

  const secondResponse = await postJson('/api/track/select', {
    sessionId,
    body: { trackType: 'interests' },
  });
  const payload = await readJson(secondResponse);

  assert.equal(secondResponse.status, 200);
  assert.equal(payload.trackType, 'interests');

  const stored = await queryTestDb(
    'SELECT track_type FROM sessions WHERE id = $1::uuid',
    [sessionId]
  );
  assert.equal(stored.rowCount, 1);
  assert.equal(stored.rows[0].track_type, 'interests');
});
