import type { Request, Response } from 'express';
import { prisma } from '../db.ts';
import { config } from '../config.ts';
import { decodeBody, formatBytes, prettyJson, type BodyEncoding } from '../lib/body.ts';
import { toCurl } from '../lib/curl.ts';

/** Columns safe to load in bulk - deliberately excludes `body`. */
const LIST_COLUMNS = {
  id: true,
  method: true,
  url: true,
  bodySize: true,
  createdAt: true,
} as const;

/** Detail metadata - also excludes `body`, which is fetched separately and conditionally. */
const DETAIL_COLUMNS = {
  id: true,
  method: true,
  url: true,
  headers: true,
  query: true,
  bodyEncoding: true,
  bodySize: true,
  createdAt: true,
} as const;

/**
 * Express 5 types route params as `string | string[]`: path-to-regexp v8 yields an array
 * for repeated params. `:id` is never repeated here, but the type must be handled, and
 * taking the first element is the safe reading if one ever arrives.
 */
function parseId(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = Number.parseInt(value ?? '', 10);
  return Number.isNaN(id) ? null : id;
}

export async function index(req: Request, res: Response): Promise<void> {
  const requested = Number.parseInt(String(req.query.page ?? '1'), 10);
  const page = Number.isNaN(requested) || requested < 1 ? 1 : requested;

  const total = await prisma.requestLog.count();
  const totalPages = Math.max(1, Math.ceil(total / config.pageSize));
  const current = Math.min(page, totalPages);

  const items = await prisma.requestLog.findMany({
    select: LIST_COLUMNS,
    orderBy: { id: 'desc' },
    skip: (current - 1) * config.pageSize,
    take: config.pageSize,
  });

  res.render('index', { items, page: current, totalPages, total, formatBytes });
}

export async function show(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).send('Invalid id');
    return;
  }

  // Metadata first, WITHOUT body: a body over the inline cap must never be loaded into
  // memory just to be discarded. body_size exists precisely so this decision is cheap.
  const record = await prisma.requestLog.findUnique({ where: { id }, select: DETAIL_COLUMNS });
  if (!record) {
    res.status(404).render('not-found');
    return;
  }

  const headers = record.headers as Record<string, string[]>;
  const query = record.query as Record<string, unknown>;
  const encoding = record.bodyEncoding as BodyEncoding;
  const isBinary = encoding === 'base64';
  const tooLarge = record.bodySize > config.bodyInlineMax;
  const inlineable = !isBinary && !tooLarge && record.bodySize > 0;

  // Second query only when the body will actually be rendered.
  const body = inlineable
    ? ((await prisma.requestLog.findUnique({ where: { id }, select: { body: true } }))?.body ?? '')
    : '';

  const displayBody = inlineable ? (prettyJson(body, headers['content-type']?.[0]) ?? body) : '';
  const preview = displayBody.slice(0, config.bodyPreviewChars);
  const rest = displayBody.slice(config.bodyPreviewChars);

  res.render('show', {
    record,
    headers,
    query,
    isBinary,
    tooLarge,
    preview,
    rest,
    sizeLabel: formatBytes(record.bodySize),
    curl: toCurl({
      method: record.method,
      url: record.url,
      headers,
      body,
      bodyEncoding: encoding,
      // Without this the cURL block would re-embed a body the page just declined to show.
      bodyOmitted: !inlineable,
      bodySize: record.bodySize,
      baseUrl: `${req.protocol}://${req.get('host') ?? 'localhost'}`,
    }),
  });
}

export async function rawBody(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).send('Invalid id');
    return;
  }

  const record = await prisma.requestLog.findUnique({
    where: { id },
    select: { body: true, bodyEncoding: true },
  });
  if (!record) {
    res.status(404).send('Not found');
    return;
  }

  const encoding = record.bodyEncoding as BodyEncoding;

  // The payload is attacker-controlled. text/plain alone is not enough - without
  // nosniff a browser may sniff HTML out of it and execute embedded script.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Content-Type',
    encoding === 'base64' ? 'application/octet-stream' : 'text/plain; charset=utf-8',
  );
  res.send(decodeBody(record.body ?? '', encoding));
}

export async function destroy(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id);
  if (id !== null) {
    // deleteMany, not delete: idempotent when the row is already gone
    // (double submit, browser back button).
    await prisma.requestLog.deleteMany({ where: { id } });
  }
  res.redirect('/requests');
}

export async function destroyAll(_req: Request, res: Response): Promise<void> {
  await prisma.requestLog.deleteMany();
  res.redirect('/requests');
}
