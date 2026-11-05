import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  assertApiAvailable,
  isUuidV4,
  readJson,
  requestApi,
} from './_helpers.mjs';

function loadDemoSessionIds() {
  const manifestPath = process.env.DEMO_SESSION_IDS_FILE;
  if (manifestPath) {
    const resolvedPath = path.resolve(process.cwd(), manifestPath);
    assert.ok(fs.existsSync(resolvedPath), `Не найден файл DEMO_SESSION_IDS_FILE: ${resolvedPath}`);
    const parsed = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
    const ids = Array.isArray(parsed) ? parsed : parsed?.sessionIds;
    assert.ok(Array.isArray(ids), 'Файл DEMO_SESSION_IDS_FILE должен содержать массив UUID или объект {"sessionIds": [...]}');
    return ids;
  }

  const raw = process.env.DEMO_SESSION_IDS;
  if (!raw) return null;

  // Accept either a JSON array or a comma-separated list of UUIDs.
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    assert.ok(Array.isArray(parsed), 'DEMO_SESSION_IDS в JSON-формате должен быть массивом');
    return parsed;
  }

  return trimmed.split(',').map((value) => value.trim()).filter(Boolean);
}

const demoSessionIds = loadDemoSessionIds();

// DEPLOY.md says db:seed:mocks creates 15 mock sessions with diagnostics,
// but the documented API has no endpoint to enumerate those sessions.
// Therefore their UUIDs must be supplied from the seed output / a test manifest.
test('Демо-данные: 15 seeded mock sessions доступны через API и содержат диагностику', {
  skip: demoSessionIds
    ? false
    : 'Нет списка UUID мок-сессий. После npm run db:seed:mocks задайте DEMO_SESSION_IDS или DEMO_SESSION_IDS_FILE.',
}, async () => {
  await assertApiAvailable();

  assert.equal(demoSessionIds.length, 15, 'Ожидается ровно 15 UUID тестовых сессий');
  assert.ok(
    demoSessionIds.every(isUuidV4),
    'Каждый элемент DEMO_SESSION_IDS должен быть UUID v4',
  );
  assert.equal(new Set(demoSessionIds).size, 15, 'UUID мок-сессий должны быть уникальными');

  const failures = [];

  for (const [index, sessionId] of demoSessionIds.entries()) {
    const snapshotResponse = await requestApi('/api/session', { sessionId });
    const snapshot = await readJson(snapshotResponse);

    assert.equal(
      snapshotResponse.status,
      200,
      `Мок-сессия #${index + 1} (${sessionId}) не читается через GET /api/session: ${JSON.stringify(snapshot)}`,
    );
    assert.ok(snapshot && typeof snapshot === 'object', `Мок-сессия #${index + 1}: snapshot должен быть JSON-объектом`);
    assert.ok(
      snapshot.profile && typeof snapshot.profile === 'object',
      `Мок-сессия #${index + 1}: у seeded mock session должен быть заполненный profile`,
    );

    const diagnosticResponse = await requestApi('/api/diagnostic/latest', { sessionId });
    const diagnostic = await readJson(diagnosticResponse);

    assert.equal(
      diagnosticResponse.status,
      200,
      `Мок-сессия #${index + 1} (${sessionId}) не имеет сохранённой диагностики: ${JSON.stringify(diagnostic)}`,
    );
    assert.ok(Array.isArray(diagnostic?.answers), `Мок-сессия #${index + 1}: latest.answers должен быть массивом`);
    assert.ok(diagnostic.answers.length > 0, `Мок-сессия #${index + 1}: диагностика не должна быть пустой`);

    // The API contract permits clarification to be null. The seed contract
    // guarantees a diagnostic, not necessarily six clarification answers.
    failures.push({ sessionId, answers: diagnostic.answers.length });
  }

  assert.equal(failures.length, 15);
  assert.ok(failures.every((item) => item.answers > 0));
});
