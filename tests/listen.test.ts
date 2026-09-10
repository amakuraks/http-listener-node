import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { server } from '../src/server.ts';
import { baseUrl } from './support.ts';
import { prisma } from '../src/db.ts';

let base: string;

before(async () => {
  base = await baseUrl();
});

beforeEach(async () => {
  await prisma.requestLog.deleteMany();
});

after(async () => {
  server.close();
  await prisma.$disconnect();
});

test('accepts every method on arbitrary /listen paths (spec 17)', async () => {
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const res = await fetch(`${base}/listen/report/1`, { method });
    assert.equal(res.status, 200, `${method} should be accepted`);
  }
  assert.equal(await prisma.requestLog.count(), 6);
});

test('accepts deeply nested paths and bare /listen', async () => {
  assert.equal((await fetch(`${base}/listen/a/b/c/d`)).status, 200);
  assert.equal((await fetch(`${base}/listen`)).status, 200);
});

test('records every captured field (spec 4)', async () => {
  await fetch(`${base}/listen/report/1?debug=true`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-request-id': 'req-001' },
    body: '{"name":"Monthly Report","status":"completed"}',
  });

  const record = await prisma.requestLog.findFirstOrThrow({ orderBy: { id: 'desc' } });
  assert.equal(record.method, 'PUT');
  assert.equal(record.url, '/listen/report/1?debug=true');
  assert.deepEqual(record.query, { debug: 'true' });
  assert.equal(record.body, '{"name":"Monthly Report","status":"completed"}');

  const headers = record.headers as Record<string, string[]>;
  assert.deepEqual(headers['x-request-id'], ['req-001']); // array shape, spec 4.1
  assert.deepEqual(headers['content-type'], ['application/json']);
});

test('captures malformed JSON that express.json() would reject', async () => {
  const res = await fetch(`${base}/listen`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"name":"Monthly Report"',
  });
  assert.equal(res.status, 200);
  const record = await prisma.requestLog.findFirstOrThrow({ orderBy: { id: 'desc' } });
  assert.equal(record.body, '{"name":"Monthly Report"');
});

test('captures binary bodies losslessly', async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]);
  await fetch(`${base}/listen`, {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: png,
  });
  const record = await prisma.requestLog.findFirstOrThrow({ orderBy: { id: 'desc' } });
  assert.equal(record.bodyEncoding, 'base64');
  assert.deepEqual(new Uint8Array(Buffer.from(record.body ?? '', 'base64')), png);
});

test('each request creates exactly one record', async () => {
  await fetch(`${base}/listen`, { method: 'POST', body: 'one' });
  await fetch(`${base}/listen`, { method: 'POST', body: 'two' });
  assert.equal(await prisma.requestLog.count(), 2);
});

test('bodyless requests store an empty body, not a crash', async () => {
  const res = await fetch(`${base}/listen`, { method: 'GET' });
  assert.equal(res.status, 200);
  const record = await prisma.requestLog.findFirstOrThrow({ orderBy: { id: 'desc' } });
  assert.equal(record.body, '');
  assert.equal(record.bodySize, 0);
  assert.equal(record.bodyEncoding, 'utf8');
});
