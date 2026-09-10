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

test('#O1 binds to loopback, not every interface', () => {
  const address = server.address();
  assert.ok(typeof address === 'object' && address);
  assert.ok(['127.0.0.1', '::1'].includes(address.address), `bound to ${address.address}`);
});

test('#O4 does not advertise x-powered-by', async () => {
  const res = await fetch(`${base}/requests`);
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('#O6 sends a Content-Security-Policy that forbids inline script', async () => {
  const res = await fetch(`${base}/requests`);
  const csp = res.headers.get('content-security-policy') ?? '';
  assert.match(csp, /script-src 'self'/);
  assert.ok(!csp.includes("'unsafe-inline'"), 'unsafe-inline would defeat the control');
  assert.match(csp, /frame-ancestors 'none'/);
});

test('#O6 no view ships an inline event handler', async () => {
  await fetch(`${base}/listen`, { method: 'POST', body: 'x' });
  const record = await prisma.requestLog.findFirstOrThrow({ orderBy: { id: 'desc' } });
  for (const path of ['/requests', `/requests/${record.id}`]) {
    const html = await (await fetch(base + path)).text();
    assert.ok(!/\son(click|submit|change|load|error)=/i.test(html), `inline handler in ${path}`);
  }
});

test('#O5 rejects cross-site delete-all', async () => {
  await fetch(`${base}/listen`, { method: 'POST', body: 'keep me' });
  const res = await fetch(`${base}/requests`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'sec-fetch-site': 'cross-site',
    },
    body: '_method=DELETE',
    redirect: 'manual',
  });
  assert.equal(res.status, 403);
  assert.equal(await prisma.requestLog.count(), 1, 'record must survive a cross-site delete');
});

test('#O5 allows same-origin delete-all', async () => {
  await fetch(`${base}/listen`, { method: 'POST', body: 'delete me' });
  await fetch(`${base}/requests`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'sec-fetch-site': 'same-origin',
    },
    body: '_method=DELETE',
    redirect: 'manual',
  });
  assert.equal(await prisma.requestLog.count(), 0);
});

test('#O5 allows non-browser callers (no Sec-Fetch-Site header)', async () => {
  await fetch(`${base}/listen`, { method: 'POST', body: 'curl target' });
  const res = await fetch(`${base}/requests`, { method: 'DELETE', redirect: 'manual' });
  assert.notEqual(res.status, 403);
  assert.equal(await prisma.requestLog.count(), 0);
});

test('#O5 does not guard the listener - it must accept cross-origin traffic', async () => {
  const res = await fetch(`${base}/listen`, {
    method: 'POST',
    headers: { 'sec-fetch-site': 'cross-site' },
    body: 'from another origin',
  });
  assert.equal(res.status, 200, 'the listener is the product; it must never reject by origin');
  assert.equal(await prisma.requestLog.count(), 1);
});

test('#G1 unknown route returns a rendered 404, not a stack trace', async () => {
  const res = await fetch(`${base}/does-not-exist`);
  assert.equal(res.status, 404);
  const html = await res.text();
  assert.ok(!html.includes('    at '), 'must not contain a stack trace');
  assert.ok(html.includes('Request not found'));
});

test('#G2 oversized body returns 413 and records nothing', async () => {
  // .env.testing sets MAX_BODY_SIZE=1kb so this exercises the real path.
  const oversized = 'x'.repeat(4096);
  const res = await fetch(`${base}/listen`, { method: 'POST', body: oversized });
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { status: 'TOO_LARGE' });
  assert.equal(await prisma.requestLog.count(), 0, 'nothing may be recorded');
});

test('#G2 a body just under the limit is still captured', async () => {
  const res = await fetch(`${base}/listen`, { method: 'POST', body: 'y'.repeat(500) });
  assert.equal(res.status, 200);
  assert.equal(await prisma.requestLog.count(), 1);
});
