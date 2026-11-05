import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Black-box smoke and negative API tests for the Professional Navigator.
 * Requires Node.js 20+ (global fetch and AbortSignal.timeout).
 * Start the Next.js server in another terminal before running this suite.
 *
 * API_BASE_URL defaults to http://localhost:3000.
 * API_TEST_DATABASE=1 enables the optional database-backed /api/trials check.
 * These tests never run migrations or seed data automatically.
 */

const baseUrl = (process.env.API_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const timeoutMs = Number(process.env.API_TEST_TIMEOUT_MS ?? 7000);

async function request(path, init = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function bodyText(response) {
  return response.text();
}

const jsonPostRoutes = [
  '/api/diagnostic/submit',
  '/api/recommendations/generate',
  '/api/reflection',
  '/api/track/select',
];

test('GET /api/health returns 200 JSON and does not expose secrets', async () => {
  const response = await request('/api/health');
  assert.equal(response.status, 200, `GET /api/health returned ${response.status}`);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/i);

  const text = await bodyText(response);
  assert.doesNotThrow(() => JSON.parse(text), 'Health response must be valid JSON');
  assert.doesNotMatch(
    text,
    /postgres(?:ql)?:\/\/[^\s"']+|SESSION_SECRET|GIGACHAT_CREDENTIALS|navigator_dev_password|BEGIN CERTIFICATE/i,
    'Health response must not contain credentials or database connection strings',
  );
});

test('POST /api/health is rejected with 405', async () => {
  const response = await request('/api/health', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 405, `Expected 405; received ${response.status}`);
});

test('JSON POST workflow endpoints reject malformed JSON with a 4xx response', async (t) => {
  for (const path of jsonPostRoutes) {
    await t.test(path, async () => {
      const response = await request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"malformed":',
      });
      const text = await bodyText(response);
      assert.ok(
        response.status >= 400 && response.status < 500,
        `${path} should reject malformed JSON with 4xx, received ${response.status}. Body: ${text.slice(0, 300)}`,
      );
      assert.notEqual(response.status, 404, `${path} must exist`);
      assert.notEqual(response.status, 405, `${path} must accept POST`);
      assert.doesNotMatch(text, /DATABASE_URL|SESSION_SECRET|GIGACHAT_CREDENTIALS|postgres(?:ql)?:\/\//i);
    });
  }
});

test('POST-only workflow endpoints reject GET', async (t) => {
  // Keep this list limited to routes expected to be POST-only by the current project contract.
  // Add /api/reflection only after its supported methods have been confirmed in route.ts.
  for (const path of ['/api/diagnostic/submit', '/api/recommendations/generate', '/api/track/select']) {
    await t.test(path, async () => {
      const response = await request(path, { method: 'GET' });
      assert.equal(response.status, 405, `GET ${path} should return 405, got ${response.status}`);
    });
  }
});

test('GET /api/trials returns JSON when explicitly enabled', {
  skip: process.env.API_TEST_DATABASE !== '1'
    ? 'Set API_TEST_DATABASE=1 only when a dedicated test database is migrated and the app is using it.'
    : false,
}, async () => {
  const response = await request('/api/trials');
  assert.ok(response.status >= 200 && response.status < 300, `GET /api/trials returned ${response.status}`);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/i);
  const payload = await response.json();
  assert.ok(payload !== null && (Array.isArray(payload) || typeof payload === 'object'));
  // seed.mjs only inserts the 'Екатеринбург' region. It does not promise any trial rows.
});
