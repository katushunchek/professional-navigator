import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  assertApiAvailable,
  createSession,
  newSessionId,
  postJson,
  queryTestDb,
  readJson,
} from './helpers.mjs';

test('POST /api/diagnostic/submit: проверка доступности API', async () => {
  await assertApiAvailable();
});

test('POST /api/diagnostic/submit: без X-Session-ID возвращает 401', async () => {
  const response = await postJson('/api/diagnostic/submit', {
    body: { answers: [{ questionId: 'test_q1', answer: 1 }] },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 401);
  assert.match(payload.error, /X-Session-ID/i);
});

test('POST /api/diagnostic/submit: некорректный UUID возвращает 400', async () => {
  const response = await postJson('/api/diagnostic/submit', {
    sessionId: 'invalid-session-id',
    body: { answers: [{ questionId: 'test_q1', answer: 1 }] },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 400);
  assert.match(payload.error, /valid UUID/i);
});

test('POST /api/diagnostic/submit: неизвестная сессия возвращает 404', async () => {
  const response = await postJson('/api/diagnostic/submit', {
    sessionId: randomUUID(),
    body: { answers: [{ questionId: 'test_q1', answer: 1 }] },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 404);
  assert.match(payload.error, /Session not found/i);
});

test('POST /api/diagnostic/submit: пустой answers возвращает 422', async (t) => {
  const sessionId = await createSession(t);
  const response = await postJson('/api/diagnostic/submit', {
    sessionId,
    body: { answers: [] },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 422);
  assert.equal(payload.error, 'Validation failed');
});

test('POST /api/diagnostic/submit: повторяющиеся questionId возвращают 422', async (t) => {
  const sessionId = await createSession(t);
  const response = await postJson('/api/diagnostic/submit', {
    sessionId,
    body: {
      answers: [
        { questionId: 'q_duplicate', answer: 1 },
        { questionId: 'q_duplicate', answer: 2 },
      ],
    },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 422);
  assert.equal(payload.error, 'Validation failed');
  assert.ok(Array.isArray(payload.details));
  assert.ok(payload.details.some((issue) => issue.message === 'Duplicate questionId'));
});

test('POST /api/diagnostic/submit: неподдерживаемый тип answer возвращает 422', async (t) => {
  const sessionId = await createSession(t);
  const response = await postJson('/api/diagnostic/submit', {
    sessionId,
    body: {
      answers: [{ questionId: 'q_null', answer: null }],
    },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 422);
  assert.equal(payload.error, 'Validation failed');
});

test('POST /api/diagnostic/submit: некорректный JSON возвращает 400', async (t) => {
  const sessionId = await createSession(t);
  const response = await postJson('/api/diagnostic/submit', {
    sessionId,
    rawBody: '{"answers": [',
  });
  const payload = await readJson(response);

  assert.equal(response.status, 400);
  assert.match(payload.error, /valid JSON/i);
});

test('POST /api/diagnostic/submit: сохраняет ответы разных типов в PostgreSQL', async (t) => {
  const sessionId = await createSession(t);
  const answers = [
    { questionId: 'test_number', answer: 2 },
    { questionId: 'test_string', answer: 'Мне нравится анализировать данные' },
    { questionId: 'test_boolean', answer: true },
    { questionId: 'test_array', answer: ['спорт', 'наука'] },
  ];

  const response = await postJson('/api/diagnostic/submit', {
    sessionId,
    body: { answers },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 201);
  assert.equal(payload.status, 'submitted');
  assert.equal(payload.savedAnswers, answers.length);
  assert.match(payload.diagnosticId, /^[0-9a-f-]{36}$/i);

  const stored = await queryTestDb(
    `SELECT question_id, answer
       FROM diagnostic_answers
      WHERE diagnostic_id = $1::uuid
      ORDER BY question_id ASC`,
    [payload.diagnosticId]
  );

  assert.equal(stored.rowCount, answers.length);
  const actualByQuestion = Object.fromEntries(
    stored.rows.map((row) => [row.question_id, row.answer])
  );
  for (const item of answers) {
    assert.deepEqual(actualByQuestion[item.questionId], item.answer);
  }

  const diagnostic = await queryTestDb(
    'SELECT session_id FROM diagnostics WHERE id = $1::uuid',
    [payload.diagnosticId]
  );
  assert.equal(diagnostic.rowCount, 1);
  assert.equal(diagnostic.rows[0].session_id, sessionId);
});
