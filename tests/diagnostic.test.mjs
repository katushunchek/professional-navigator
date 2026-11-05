import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  assertApiAvailable,
  buildAnswerFromQuestion,
  createSession,
  extractQuestionId,
  isUuidV4,
  postJson,
  readJson,
  requestApi,
  submitDiagnostic,
} from './_helpers.mjs';

const BVB_ANSWERS = [
  {
    questionId: 'bilet_q1_subjects',
    answer: ['Математика', 'Информатика'],
  },
  {
    questionId: 'bilet_q4_decision',
    answer: ['Я еще ни с чем не определился(-лась)'],
  },
];

test('health: backend и PostgreSQL доступны', async () => {
  await assertApiAvailable();
});

test('POST /api/diagnostic/submit: без X-Session-ID возвращает 401', async () => {
  const response = await postJson('/api/diagnostic/submit', {
    body: { answers: BVB_ANSWERS },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 401);
  assert.equal(typeof payload?.error, 'string');
});

test('POST /api/diagnostic/submit: невалидный X-Session-ID возвращает 400', async () => {
  const response = await postJson('/api/diagnostic/submit', {
    sessionId: 'not-a-uuid',
    body: { answers: BVB_ANSWERS },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 400);
  assert.equal(typeof payload?.error, 'string');
});

test('POST /api/track/select: создаёт сессию с контрактным статусом 200', async () => {
  const sessionId = randomUUID();
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
});

test('POST /api/diagnostic/submit: пустой answers возвращает 422', async () => {
  const sessionId = await createSession();
  const response = await postJson('/api/diagnostic/submit', {
    sessionId,
    body: { answers: [] },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 422);
  assert.equal(typeof payload?.error, 'string');
});

test('POST /api/diagnostic/submit: повторяющиеся questionId возвращают 422', async () => {
  const sessionId = await createSession();
  const response = await postJson('/api/diagnostic/submit', {
    sessionId,
    body: {
      answers: [
        { questionId: 'test_duplicate_q', answer: 'Первый ответ' },
        { questionId: 'test_duplicate_q', answer: 'Второй ответ' },
      ],
    },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 422);
  assert.equal(typeof payload?.error, 'string');
});

test('GET /api/diagnostic/questions?grade=9: возвращает анкету для класса', async () => {
  const response = await requestApi('/api/diagnostic/questions?grade=9');
  const payload = await readJson(response);

  assert.equal(response.status, 200, `Не удалось получить анкету: ${JSON.stringify(payload)}`);
  assert.ok(payload !== null && typeof payload === 'object', 'Ожидалось JSON-содержимое анкеты');
});

test('BvB: сохраняет ответы диагностики и возвращает их через latest', async () => {
  const sessionId = await createSession('interests');
  const submitted = await submitDiagnostic(sessionId, BVB_ANSWERS);

  assert.ok(isUuidV4(submitted.diagnosticId));
  // Additive response fields from the current API contract.
  assert.equal(submitted.clarificationId, null);
  assert.equal(submitted.savedClarificationAnswers, 0);

  const latestResponse = await requestApi('/api/diagnostic/latest', { sessionId });
  const latest = await readJson(latestResponse);

  assert.equal(latestResponse.status, 200, `Не удалось прочитать диагностику: ${JSON.stringify(latest)}`);
  assert.ok(Array.isArray(latest?.answers), 'GET /api/diagnostic/latest должен вернуть answers[]');
  assert.equal(latest.answers.length, BVB_ANSWERS.length);

  const savedIds = latest.answers.map((item) => item?.questionId ?? item?.question_id);
  for (const answer of BVB_ANSWERS) {
    assert.ok(savedIds.includes(answer.questionId), `Ответ ${answer.questionId} не найден в latest`);
  }
  assert.ok(Object.hasOwn(latest, 'clarification'), 'Ответ latest должен содержать clarification');
  assert.equal(latest.clarification, null);
});

test('POST /api/clarification/submit: без сохранённой диагностики возвращает 409', async () => {
  const sessionId = await createSession();
  const response = await postJson('/api/clarification/submit', {
    sessionId,
    body: {
      answers: [{ questionId: 'agent_q2_work_style', answer: 'team' }],
    },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 409);
  assert.equal(typeof payload?.error, 'string');
});

test('BvB + 6 уточнений: сохраняет уточнения отдельным endpoint и читает их обратно', async () => {
  const sessionId = await createSession('interests');
  await submitDiagnostic(sessionId, BVB_ANSWERS);

  const questionsResponse = await requestApi('/api/clarification/questions');
  const questionsPayload = await readJson(questionsResponse);

  assert.equal(
    questionsResponse.status,
    200,
    `Не удалось получить уточняющие вопросы: ${JSON.stringify(questionsPayload)}`,
  );
  assert.ok(Array.isArray(questionsPayload?.data), 'Ожидалось data[] из /api/clarification/questions');
  assert.equal(questionsPayload.data.length, 6, 'Контракт описывает ровно шесть вопросов агента');

  const clarificationAnswers = questionsPayload.data.map(buildAnswerFromQuestion);
  const ids = clarificationAnswers.map((answer) => answer.questionId);
  assert.equal(new Set(ids).size, 6, 'question_id уточнений должны быть уникальны');
  assert.ok(ids.every((id) => typeof id === 'string' && id.length > 0));

  const submitResponse = await postJson('/api/clarification/submit', {
    sessionId,
    body: { answers: clarificationAnswers },
  });
  const submitPayload = await readJson(submitResponse);

  assert.equal(
    submitResponse.status,
    201,
    `POST /api/clarification/submit должен вернуть 201: ${JSON.stringify(submitPayload)}`,
  );
  assert.equal(submitPayload?.status, 'submitted');
  assert.equal(submitPayload?.savedAnswers, 6);
  assert.ok(isUuidV4(submitPayload?.clarificationId), 'clarificationId должен быть UUID v4');

  const latestResponse = await requestApi('/api/diagnostic/latest', { sessionId });
  const latest = await readJson(latestResponse);

  assert.equal(latestResponse.status, 200);
  assert.ok(Array.isArray(latest?.answers));
  assert.ok(latest?.clarification, 'Последняя диагностика должна содержать сохранённые уточнения');

  const sessionResponse = await requestApi('/api/session', { sessionId });
  const sessionSnapshot = await readJson(sessionResponse);
  assert.equal(
    sessionResponse.status,
    200,
    `GET /api/session должен восстановить сессию: ${JSON.stringify(sessionSnapshot)}`,
  );
  assert.ok(sessionSnapshot && typeof sessionSnapshot === 'object');
});
