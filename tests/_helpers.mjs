import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export const BASE_URL = (process.env.TEST_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidV4(value) {
  return typeof value === 'string' && UUID_V4_RE.test(value);
}

export function newSessionId() {
  return randomUUID();
}

export async function requestApi(route, options = {}) {
  const {
    method = 'GET',
    sessionId,
    body,
    headers = {},
  } = options;

  const requestHeaders = new Headers(headers);
  if (sessionId !== undefined) requestHeaders.set('X-Session-ID', sessionId);
  if (body !== undefined) requestHeaders.set('Content-Type', 'application/json');

  try {
    return await fetch(`${BASE_URL}${route}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(
      `Не удалось обратиться к ${BASE_URL}${route}. Убедитесь, что backend запущен и TEST_BASE_URL указан верно.`,
      { cause: error },
    );
  }
}

export function postJson(route, options = {}) {
  return requestApi(route, { ...options, method: 'POST' });
}

export async function readJson(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    assert.fail(`Ожидался JSON, получен ответ: ${text.slice(0, 500)}`);
  }
}

export async function assertApiAvailable() {
  const response = await requestApi('/api/health');
  const payload = await readJson(response);

  assert.equal(response.status, 200, `GET /api/health: ${JSON.stringify(payload)}`);
  assert.equal(payload?.status, 'ok');
  assert.equal(payload?.database, 'connected');
}

export async function createSession(trackType = 'interests') {
  const sessionId = newSessionId();
  const response = await postJson('/api/track/select', {
    sessionId,
    body: { trackType },
  });
  const payload = await readJson(response);

  assert.equal(
    response.status,
    200,
    `POST /api/track/select должен вернуть 200: ${JSON.stringify(payload)}`,
  );
  assert.equal(payload?.sessionId, sessionId);
  assert.equal(payload?.trackType, trackType);
  assert.equal(payload?.status, 'selected');

  return sessionId;
}

export async function submitDiagnostic(sessionId, answers) {
  const response = await postJson('/api/diagnostic/submit', {
    sessionId,
    body: { answers },
  });
  const payload = await readJson(response);

  assert.equal(
    response.status,
    201,
    `POST /api/diagnostic/submit должен вернуть 201: ${JSON.stringify(payload)}`,
  );
  assert.equal(payload?.status, 'submitted');
  assert.equal(payload?.savedAnswers, answers.length);
  assert.ok(isUuidV4(payload?.diagnosticId), 'diagnosticId должен быть UUID v4');

  return payload;
}

export function extractQuestionId(question) {
  return question?.question_id ?? question?.questionId;
}

/**
 * Формирует валидный тестовый ответ по опубликованной структуре
 * GET /api/clarification/questions: question_id, type, options[].value.
 * Выбор берётся из первого разрешённого значения каталога, а не придумывается.
 */
export function buildAnswerFromQuestion(question) {
  const questionId = extractQuestionId(question);
  assert.ok(typeof questionId === 'string' && questionId.length > 0, 'У вопроса должен быть question_id');

  const type = String(question?.type ?? '').toLowerCase();
  const options = Array.isArray(question?.options) ? question.options : [];
  const values = options
    .map((option) => option?.value)
    .filter((value) => typeof value === 'string' && value.length > 0);

  if (type.includes('multi')) {
    assert.ok(values.length > 0, `У multi_choice-вопроса ${questionId} нет options[].value`);
    return { questionId, answer: [values[0]] };
  }

  if (values.length > 0) {
    return { questionId, answer: values[0] };
  }

  if (type.includes('text') || type.includes('open')) {
    return { questionId, answer: 'Тестовый ответ интеграционного теста' };
  }

  if (type.includes('scale') || type.includes('rating')) {
    return { questionId, answer: 3 };
  }

  throw new Error(
    `Не удалось сформировать тестовый ответ для вопроса ${questionId} (type=${type || 'не указан'}): ` +
    'в контракте нет доступных options[].value и неизвестен тип свободного ответа.',
  );
}
