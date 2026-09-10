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

async function seed(count: number): Promise<void> {
  for (let i = 1; i <= count; i += 1) {
    await fetch(`${base}/listen/item/${i}`, { method: 'POST', body: `payload-${i}` });
  }
}

test('lists captured requests newest first', async () => {
  await seed(3);
  const html = await (await fetch(`${base}/requests`)).text();
  assert.ok(html.includes('/listen/item/3'));
  assert.ok(html.indexOf('/listen/item/3') < html.indexOf('/listen/item/1'));
});

test('shows an empty state when nothing is captured', async () => {
  const html = await (await fetch(`${base}/requests`)).text();
  assert.ok(html.includes('No requests captured yet'));
});

test('paginates with the page query parameter (spec 7)', async () => {
  await seed(25);
  const page2 = await (await fetch(`${base}/requests?page=2`)).text();
  assert.ok(page2.includes('Page 2 of 2'));
});

test('clamps an out-of-range or non-numeric page instead of erroring', async () => {
  await seed(2);
  assert.equal((await fetch(`${base}/requests?page=999`)).status, 200);
  assert.equal((await fetch(`${base}/requests?page=abc`)).status, 200);
  assert.equal((await fetch(`${base}/requests?page=-5`)).status, 200);
});

test('detail page shows headers, query and body', async () => {
  await fetch(`${base}/listen/report/1?debug=true`, {
    method: 'PUT',
    headers: { 'x-request-id': 'req-001' },
    body: 'hello world',
  });
  const record = await prisma.requestLog.findFirstOrThrow({ orderBy: { id: 'desc' } });
  const html = await (await fetch(`${base}/requests/${record.id}`)).text();
  assert.ok(html.includes('x-request-id'));
  assert.ok(html.includes('req-001'));
  assert.ok(html.includes('debug'));
  assert.ok(html.includes('hello world'));
});

test('ESCAPES script tags from captured data (stored XSS guard)', async () => {
  await fetch(`${base}/listen`, {
    method: 'POST',
    headers: { 'x-evil': '<script>alert(1)</script>' },
    body: '<script>alert(2)</script>',
  });
  const record = await prisma.requestLog.findFirstOrThrow({ orderBy: { id: 'desc' } });
  const html = await (await fetch(`${base}/requests/${record.id}`)).text();
  assert.ok(!html.includes('<script>alert(1)</script>'), 'header must be escaped');
  assert.ok(!html.includes('<script>alert(2)</script>'), 'body must be escaped');
  assert.ok(html.includes('&lt;script&gt;'), 'escaped form should be present');
});

test('raw body endpoint sets nosniff and returns exact bytes', async () => {
  await fetch(`${base}/listen`, { method: 'POST', body: 'raw payload' });
  const record = await prisma.requestLog.findFirstOrThrow({ orderBy: { id: 'desc' } });
  const res = await fetch(`${base}/requests/${record.id}/body`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(await res.text(), 'raw payload');
});

test('missing record renders 404, invalid id renders 400', async () => {
  assert.equal((await fetch(`${base}/requests/999999`)).status, 404);
  assert.equal((await fetch(`${base}/requests/not-a-number`)).status, 400);
});

test('deletes a single record', async () => {
  await seed(2);
  const record = await prisma.requestLog.findFirstOrThrow({ orderBy: { id: 'desc' } });
  await fetch(`${base}/requests/${record.id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: '_method=DELETE',
    redirect: 'manual',
  });
  assert.equal(await prisma.requestLog.count(), 1);
});

test('deleting an already-deleted record is idempotent', async () => {
  await seed(1);
  const record = await prisma.requestLog.findFirstOrThrow({ orderBy: { id: 'desc' } });
  for (let i = 0; i < 2; i += 1) {
    const res = await fetch(`${base}/requests/${record.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: '_method=DELETE',
      redirect: 'manual',
    });
    assert.equal(res.status, 302, 'second delete must not error');
  }
  assert.equal(await prisma.requestLog.count(), 0);
});

test('deletes all records', async () => {
  await seed(3);
  await fetch(`${base}/requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: '_method=DELETE',
    redirect: 'manual',
  });
  assert.equal(await prisma.requestLog.count(), 0);
});
