import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

const baseUrl = (process.env.TEST_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
let pool;

function parseDatabaseIdentity(connectionString, variableName) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL connection URL.`);
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  return {
    host: url.hostname.toLowerCase(),
    port: url.port || '5432',
    database,
  };
}

function assertTestEnvironment() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  const appDatabaseUrl = process.env.DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error(
      'TEST_DATABASE_URL is required. Configure it to point to a dedicated test database.'
    );
  }

  if (!appDatabaseUrl) {
    throw new Error(
      'DATABASE_URL is required. The running API and the tests must use the same test database.'
    );
  }

  const testDb = parseDatabaseIdentity(testDatabaseUrl, 'TEST_DATABASE_URL');
  const appDb = parseDatabaseIdentity(appDatabaseUrl, 'DATABASE_URL');

  if (!testDb.database.toLowerCase().includes('test') && process.env.ALLOW_NON_TEST_DATABASE !== 'true') {
    throw new Error(
      `Refusing to run integration tests against database "${testDb.database}". ` +
      'Use a dedicated database whose name contains "test", or explicitly set ALLOW_NON_TEST_DATABASE=true.'
    );
  }

  if (
    testDb.host !== appDb.host ||
    testDb.port !== appDb.port ||
    testDb.database !== appDb.database
  ) {
    throw new Error(
      'DATABASE_URL and TEST_DATABASE_URL must point to the same host, port and database. ' +
      'The API server must use the dedicated test database too.'
    );
  }

  return testDatabaseUrl;
}

export function getTestPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: assertTestEnvironment(),
      max: 2,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
}

export async function queryTestDb(sql, values = []) {
  return getTestPool().query(sql, values);
}

export async function closeTestPool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

export function newSessionId(t) {
  const sessionId = randomUUID();
  t.after(async () => {
    await queryTestDb('DELETE FROM sessions WHERE id = $1::uuid', [sessionId]);
  });
  return sessionId;
}

export async function createSession(t, trackType = 'explore') {
  const sessionId = newSessionId(t);
  const response = await postJson('/api/track/select', {
    sessionId,
    body: { trackType },
  });
  const payload = await readJson(response);

  assert.equal(response.status, 200, `Session creation failed: ${JSON.stringify(payload)}`);
  assert.equal(payload.sessionId, sessionId);
  assert.equal(payload.trackType, trackType);
  return sessionId;
}

export async function requestApi(path, options = {}) {
  const {
    method = 'GET',
    sessionId,
    body,
    rawBody,
    headers = {},
  } = options;

  const requestHeaders = new Headers(headers);
  if (sessionId !== undefined) {
    requestHeaders.set('X-Session-ID', sessionId);
  }
  if (body !== undefined || rawBody !== undefined) {
    requestHeaders.set('Content-Type', 'application/json');
  }

  return fetch(`${baseUrl}${path}`, {
    method,
    headers: requestHeaders,
    body: rawBody !== undefined
      ? rawBody
      : body !== undefined
        ? JSON.stringify(body)
        : undefined,
  });
}

export function postJson(path, options = {}) {
  return requestApi(path, { ...options, method: 'POST' });
}

export async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    assert.fail(`Expected JSON response, received: ${text.slice(0, 500)}`);
  }
}

export async function assertApiAvailable() {
  let response;
  try {
    response = await requestApi('/api/health');
  } catch (error) {
    throw new Error(
      `Cannot reach API at ${baseUrl}. Start the Next.js app before running integration tests.`,
      { cause: error }
    );
  }

  const payload = await readJson(response);
  assert.equal(response.status, 200, `API health check failed: ${JSON.stringify(payload)}`);
  assert.equal(payload.database, 'connected');
}

export function isAiGatewayConfigured() {
  return Boolean(
    process.env.AI_API_BASE_URL &&
    process.env.AI_API_KEY &&
    process.env.AI_MODEL
  );
}
