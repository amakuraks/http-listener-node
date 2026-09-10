import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHeaders } from '../src/lib/headers.ts';
import { encodeBody, decodeBody, formatBytes, prettyJson } from '../src/lib/body.ts';
import { toCurl } from '../src/lib/curl.ts';

test('normalizeHeaders wraps flat strings in arrays (spec 4.1)', () => {
  assert.deepEqual(
    normalizeHeaders({ 'content-type': 'application/json', 'set-cookie': ['a=1', 'b=2'] }),
    { 'content-type': ['application/json'], 'set-cookie': ['a=1', 'b=2'] },
  );
});

test('normalizeHeaders drops undefined values', () => {
  assert.deepEqual(normalizeHeaders({ 'x-a': undefined, 'x-b': '1' }), { 'x-b': ['1'] });
});

test('encodeBody stores valid UTF-8 verbatim', () => {
  const result = encodeBody(Buffer.from('{"name":"Monthly Report"}', 'utf8'));
  assert.equal(result.bodyEncoding, 'utf8');
  assert.equal(result.body, '{"name":"Monthly Report"}');
  assert.equal(result.bodySize, 25);
});

test('encodeBody stores malformed JSON verbatim - it must still be captured', () => {
  const result = encodeBody(Buffer.from('{"name":"Monthly Report"', 'utf8'));
  assert.equal(result.body, '{"name":"Monthly Report"');
});

test('encodeBody round-trips binary without loss', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe]);
  const result = encodeBody(png);
  assert.equal(result.bodyEncoding, 'base64');
  assert.deepEqual(decodeBody(result.body, 'base64'), png);
});

test('encodeBody handles an empty buffer', () => {
  assert.deepEqual(encodeBody(Buffer.alloc(0)), { body: '', bodyEncoding: 'utf8', bodySize: 0 });
});

test('prettyJson returns null on malformed JSON instead of throwing', () => {
  assert.equal(prettyJson('{"a":1', 'application/json'), null);
  assert.equal(prettyJson('{"a":1}', 'text/plain'), null);
  assert.equal(prettyJson('{"a":1}', 'application/json'), '{\n  "a": 1\n}');
});

test('formatBytes is human readable', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
});

test('toCurl escapes embedded single quotes', () => {
  const command = toCurl({
    method: 'POST',
    url: '/listen',
    headers: { 'x-note': ["it's fine"] },
    body: '',
    bodyEncoding: 'utf8',
    baseUrl: 'http://localhost:3000',
  });
  // String.raw so the expectation is literal. An earlier version used a regex that lost
  // a backslash, so a broken expectation matched a broken implementation and passed.
  assert.ok(
    command.includes(String.raw`-H 'x-note: it'\''s fine'`),
    `apostrophe not escaped POSIX-style, got:\n${command}`,
  );
});

test('toCurl uses a real line continuation, not a literal backslash-n', () => {
  const command = toCurl({
    method: 'POST',
    url: '/listen',
    headers: { 'x-a': ['1'] },
    body: '',
    bodyEncoding: 'utf8',
    baseUrl: 'http://localhost:3000',
  });
  assert.ok(command.includes(' \\\n'), 'expected backslash followed by a newline');
  assert.ok(!command.includes('\\n  '), 'literal backslash-n would break the command');
});

test('toCurl drops headers curl regenerates', () => {
  const command = toCurl({
    method: 'POST',
    url: '/listen',
    headers: { host: ['example.com'], 'content-length': ['42'], 'x-keep': ['yes'] },
    body: '',
    bodyEncoding: 'utf8',
    baseUrl: 'http://localhost:3000',
  });
  // The bare substring 'host:' also occurs inside 'localhost:3000', so match the -H flag.
  assert.ok(!command.includes("-H 'host:"), 'host header must be dropped');
  assert.ok(!command.includes("-H 'content-length:"), 'content-length must be dropped');
  assert.ok(command.includes("-H 'x-keep: yes'"), 'unrelated headers must be kept');
});

test('toCurl does not inline an omitted body (#R1 regression guard)', () => {
  const secret = 'Z'.repeat(5000);
  const command = toCurl({
    method: 'POST',
    url: '/listen',
    headers: {},
    body: secret,
    bodyEncoding: 'utf8',
    bodyOmitted: true,
    bodySize: secret.length,
    baseUrl: 'http://localhost:3000',
  });
  assert.ok(!command.includes('ZZZ'), 'an omitted body must never be inlined');
  assert.ok(command.includes('@body.bin'));
  assert.ok(command.includes('4.9 KB'), 'placeholder should state the size');
});

test('toCurl inlines a normal body', () => {
  const command = toCurl({
    method: 'POST',
    url: '/listen',
    headers: {},
    body: '{"a":1}',
    bodyEncoding: 'utf8',
    baseUrl: 'http://localhost:3000',
  });
  assert.ok(command.includes(`--data-binary '{"a":1}'`));
});
