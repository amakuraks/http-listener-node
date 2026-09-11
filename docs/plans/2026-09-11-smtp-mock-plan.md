# Implementation Plan — SMTP Mock MVP

**Date:** 2026-09-11
**Brainstorm:** [2026-09-11-smtp-mock.md](../brainstorms/2026-09-11-smtp-mock.md)
**Spec:** [spec/smtp-mock.md](../spec/smtp-mock.md)
**Status:** Ready for `/gate`

---

## Use Case Impact

```text
AFFECTED USE CASES:

- MODIFIED: L1, L2              - files relocate; /listen URL unchanged
            I1, I2, I3, I4      - /requests -> /http/requests
            D1, D2              - /requests -> /http/requests
            O1                  - HOST splits into WEB_HOST + SMTP_BIND

- NEW:      M1  application submits email via SMTP -> stored in credential's inbox
            M2  application submits invalid credential -> rejected, nothing stored
            M3  application submits oversized message -> 552, nothing stored
            M4  operator creates inbox
            M5  operator views inbox + paginated emails
            M6  operator views email detail (HTML/Text/Raw/Headers)
            M7  operator views attachment metadata
            M8  operator deletes email
            M9  operator deletes inbox (cascade)
            M10 operator clears inbox, keeps credentials
            M11 operator reads SMTP credentials from dashboard
            M12 operator exposes SMTP without exposing the dashboard

- REMOVED:  (none)
```

---

## Structure Check — no cleanup required

| Signal | Threshold | Actual |
|---|---|---|
| Largest source file | 500+ lines | **152** (`requestsController.ts`) |
| Logic in templates | any | none — controllers pass prepared data |
| Duplicated logic | any | none found |
| Missing types | any | fully typed, `tsc --noEmit` clean |

The existing code is well-structured. **Phase 1 is a relocation to support a second
listener, not a repair.** No restructuring warning applies.

---

## Verified Library Facts

Checked against the `smtp-server` and `mailparser` documentation during planning, not
recalled. These drive several design decisions below.

| Fact | Consequence |
|---|---|
| `allowInsecureAuth: false` (default) means AUTH is not advertised until TLS is active | This is how `SMTP_REQUIRE_TLS=true` is enforced — no custom check needed |
| If `hideSTARTTLS: true` **or** STARTTLS is in `disabledCommands`, AUTH is permitted unencrypted **regardless of `allowInsecureAuth`** | This is what makes the no-certificate path work at all |
| `stream.sizeExceeded` and `stream.byteLength` update in real time during `onData` | `byteLength` supplies the true wire size for free; no manual counting |
| `size` only advertises SIZE and checks the **declared** value in MAIL FROM; enforcement is the application's job | The `sizeExceeded` check after `end` is mandatory, not defensive |
| `MailParser` attachment parts **stall the parser** until `part.release()` is called | Forgetting `release()` hangs every message with an attachment |
| Attachment `part.size` is only populated after the content stream is consumed | Tally bytes from the `data` event rather than reading `part.size` early |
| `err.responseCode` on the error passed to a callback sets the SMTP reply code | 552 oversize, 451 persistence failure |

### Refinement to the brainstorm's TLS table

The brainstorm said "both cert files absent -> start without STARTTLS, warn loudly." That
is incoherent when `SMTP_REQUIRE_TLS=true`, which is the default. Corrected rule:

| `SMTP_REQUIRE_TLS` | Certs | Behaviour |
|---|---|---|
| `true` | both present | STARTTLS advertised; AUTH withheld until TLS. **Normal operation** |
| `true` | absent | **Fail fast.** Message names both fixes: supply certs, or set `SMTP_REQUIRE_TLS=false` |
| `false` | both present | STARTTLS advertised but optional; AUTH also offered in plaintext. Warn at boot |
| `false` | absent | `hideSTARTTLS: true`; AUTH in plaintext. Warn at boot |
| either | exactly one present | **Fail fast.** Half a TLS config is a typo |

---

## Tooling Constraints

From [docs/solutions/](../solutions/), these are not optional:

1. **Never write escape-sensitive code through a shell heredoc.** `elide.ts` contains regex
   and escape sequences. Use the file-writing tool. See
   [heredoc-backslash-mangling.md](../solutions/tooling/heredoc-backslash-mangling.md).
2. **`pkill` does not exist in Git Bash here.** Use `taskkill //F //IM node.exe //T` and
   verify the port is free before trusting a restart. See
   [stale-dev-server-pkill-missing.md](../solutions/tooling/stale-dev-server-pkill-missing.md).
3. **Scale test thresholds together.** Lowering `SMTP_MAX_MESSAGE_SIZE` in `.env.testing`
   without lowering `RAW_MESSAGE_MAX` makes the truncation branch unreachable while the
   suite still reports green. See
   [size-guard-bypassed-by-second-render.md](../solutions/correctness/size-guard-bypassed-by-second-render.md).

---

# Phase 1 — Restructure

Pattern: **Package by Feature** (modular monolith). Each feature owns its routes,
controllers, lib and views; genuinely shared code moves to `shared/`.

### T1.1 — Install dependencies

```bash
npm install smtp-server mailparser
npm install --save-dev @types/smtp-server @types/mailparser nodemailer @types/nodemailer
```

**Verify:** `node -e "require('smtp-server'); require('mailparser'); console.log('ok')"`
→ prints `ok`.

### T1.2 — Create the skeleton and relocate

Use `git mv` so history follows the files.

```bash
mkdir -p src/shared/{middleware,lib,views/partials}
mkdir -p src/features/http-listener/{lib,views}
mkdir -p src/features/smtp-mock/{smtp,services,lib,views}
mkdir -p certs

git mv src/middleware/errorHandler.ts       src/shared/middleware/
git mv src/middleware/sameOriginOnly.ts     src/shared/middleware/
git mv src/middleware/securityHeaders.ts    src/shared/middleware/
git mv src/views/error.ejs                  src/shared/views/
git mv src/views/not-found.ejs              src/shared/views/
git mv src/views/partials/head.ejs          src/shared/views/partials/
git mv src/views/partials/foot.ejs          src/shared/views/partials/

git mv src/controllers/listenController.ts    src/features/http-listener/
git mv src/controllers/requestsController.ts  src/features/http-listener/
git mv src/lib/body.ts                        src/features/http-listener/lib/
git mv src/lib/curl.ts                        src/features/http-listener/lib/
git mv src/lib/headers.ts                     src/features/http-listener/lib/
git mv src/views/index.ejs                    src/features/http-listener/views/requests-index.ejs
git mv src/views/show.ejs                     src/features/http-listener/views/requests-show.ejs

rm -r src/controllers src/routes src/middleware src/lib src/views
```

`src/routes/listen.ts` and `src/routes/requests.ts` are merged into a single feature
router in T1.6, so they are deleted rather than moved.

**Verify:** `git status` shows renames, not delete+add pairs.

### T1.3 — `src/shared/lib/bytes.ts`

`formatBytes` is needed by both features. Move it out of `body.ts`.

```ts
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
```

Delete `formatBytes` from `features/http-listener/lib/body.ts` and re-point its importers.

### T1.4 — `src/shared/lib/pagination.ts`

Extracted verbatim from the clamping logic in `requestsController.index`, which both
features now need.

```ts
export interface Page {
  current: number;
  totalPages: number;
  skip: number;
  take: number;
}

/**
 * Clamps a user-supplied page number to the available range. Non-numeric and
 * out-of-range values are accepted rather than rejected (use case I2) - a bad ?page=
 * must never 400 a read-only dashboard view.
 */
export function paginate(raw: unknown, total: number, pageSize: number): Page {
  const requested = Number.parseInt(String(raw ?? '1'), 10);
  const page = Number.isNaN(requested) || requested < 1 ? 1 : requested;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, totalPages);
  return { current, totalPages, skip: (current - 1) * pageSize, take: pageSize };
}
```

**Verify:** `npm test` — existing pagination assertions in `tests/dashboard.test.ts` still pass.

### T1.5 — `src/config.ts`

Adds the SMTP block, splits the bind address (fixes brainstorm **P3**), and validates the
encryption key at boot.

```ts
import { readFileSync } from 'node:fs';

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) throw new Error(`${name} must be an integer, got: ${raw}`);
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

function ports(name: string, fallback: number[]): number[] {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw.split(',').map((part) => {
    const port = Number.parseInt(part.trim(), 10);
    if (Number.isNaN(port) || port < 1 || port > 65535) {
      throw new Error(`${name} contains an invalid port: ${part}`);
    }
    return port;
  });
}

/**
 * AES-256 needs exactly 32 bytes. A short key is a silent downgrade, so it fails at boot
 * rather than at the first authentication attempt.
 */
function credentialKey(): Buffer {
  const key = Buffer.from(required('SMTP_CRED_KEY'), 'base64');
  if (key.length !== 32) {
    throw new Error(
      `SMTP_CRED_KEY must decode to exactly 32 bytes, got ${key.length}. ` +
        'Generate one with: openssl rand -base64 32',
    );
  }
  return key;
}

/**
 * Both files or neither. One present means a typo, and starting without TLS because a
 * path was misspelled is exactly the failure this must not produce.
 */
function tlsMaterial(): { key: Buffer; cert: Buffer } | null {
  const certPath = process.env.SMTP_TLS_CERT_PATH;
  const keyPath = process.env.SMTP_TLS_KEY_PATH;
  if (!certPath && !keyPath) return null;
  if (!certPath || !keyPath) {
    throw new Error('SMTP_TLS_CERT_PATH and SMTP_TLS_KEY_PATH must be set together.');
  }
  return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
}

const engine = process.env.DATABASE_ENGINE ?? 'mysql';
if (engine !== 'mysql') {
  throw new Error(`DATABASE_ENGINE="${engine}" is not supported. MVP supports "mysql" only.`);
}

const tls = tlsMaterial();
const requireTls = bool('SMTP_REQUIRE_TLS', true);

// Fails fast rather than silently downgrading to plaintext when TLS was demanded.
if (requireTls && tls === null) {
  throw new Error(
    'SMTP_REQUIRE_TLS=true but no certificate is configured. ' +
      'Set SMTP_TLS_CERT_PATH and SMTP_TLS_KEY_PATH, or set SMTP_REQUIRE_TLS=false.',
  );
}

export const config = {
  db: {
    host: required('DATABASE_HOST'),
    port: int('DATABASE_PORT', 3306),
    user: required('DATABASE_USER'),
    password: process.env.DATABASE_PASSWORD ?? '',
    database: required('DATABASE_NAME'),
    connectionLimit: 5,
  },

  // WEB_HOST replaces HOST. The old name is still honoured so existing .env files keep
  // working. Loopback by default: this dashboard displays SMTP passwords in cleartext.
  host: process.env.WEB_HOST ?? process.env.HOST ?? '127.0.0.1',
  port: int('PORT', 3000),
  pageSize: int('PAGE_SIZE', 20),
  maxBodySize: process.env.MAX_BODY_SIZE ?? '50mb',
  bodyPreviewChars: int('BODY_PREVIEW_CHARS', 2000),
  bodyInlineMax: int('BODY_INLINE_MAX', 131072),

  smtp: {
    // Separate from the web bind address on purpose: SMTP must be reachable by test
    // applications, the credential-displaying dashboard must not be.
    bind: process.env.SMTP_BIND ?? '0.0.0.0',
    ports: ports('SMTP_PORTS', [587, 2525]),
    hostname: process.env.SMTP_HOSTNAME ?? 'smtp-mock.test.local',
    maxMessageSize: int('SMTP_MAX_MESSAGE_SIZE', 26214400),
    requireTls,
    tls,
    credentialKey: credentialKey(),
    rawMessageMax: int('RAW_MESSAGE_MAX', 262144),
    pageSize: int('SMTP_PAGE_SIZE', 50),
    maxClients: int('SMTP_MAX_CLIENTS', 50),
  },
} as const;
```

**Verify:** `SMTP_CRED_KEY=short npm start` fails with the 32-byte message, not a stack trace.

### T1.6 — `src/features/http-listener/routes.ts`

Merges the two old routers. The listener stays at `/listen`; the dashboard moves to
`/http/requests`.

```ts
import { Router, raw, urlencoded } from 'express';
import methodOverride from 'method-override';
import { config } from '../../config.ts';
import { sameOriginOnly } from '../../shared/middleware/sameOriginOnly.ts';
import { capture } from './listenController.ts';
import * as requests from './requestsController.ts';

const router = Router();

/**
 * VERIFIED: spec 12.2's '/listen/*' THROWS on Express 5 - path-to-regexp v8 removed
 * unnamed wildcards. The braces make the trailing segment optional.
 *
 * This route is NOT moved under /http. External systems are already configured against
 * /listen, and the listener must keep accepting cross-origin requests: that is the
 * product. It also stays free of urlencoded/methodOverride/sameOriginOnly below.
 */
router.all('/listen{/*splat}', raw({ type: '*/*', limit: config.maxBodySize }), capture);

const dashboard = Router();
dashboard.use(urlencoded({ extended: false }));
dashboard.use(
  methodOverride((req) => {
    const body: unknown = req.body;
    if (body !== null && typeof body === 'object' && '_method' in body) {
      const record = body as Record<string, unknown>;
      const method = record._method;
      delete record._method;
      if (typeof method === 'string') return method;
    }
    return req.method;
  }),
);
dashboard.use(sameOriginOnly); // AFTER methodOverride so req.method is effective

dashboard.get('/requests', requests.index);
dashboard.get('/requests/:id', requests.show);
dashboard.get('/requests/:id/body', requests.rawBody);
dashboard.delete('/requests/:id', requests.destroy);
dashboard.delete('/requests', requests.destroyAll);

router.use('/http', dashboard);

export default router;
```

Update `requestsController.ts` redirect targets: `/requests` → `/http/requests`, and the
template link `href="/requests/<%= item.id %>"` → `/http/requests/...`.

### T1.7 — Shared navigation and landing page

`src/shared/views/partials/head.ejs` — brand becomes the platform, nav gains both listeners.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><%= title %> · Testing Tools</title>
  <!-- Deliberately NOT deferred: must run before first paint to avoid a theme flash. -->
  <script src="/assets/theme.js"></script>
  <link rel="stylesheet" href="/assets/style.css">
  <script src="/assets/app.js" defer></script>
</head>
<body>
<header class="topbar">
  <a class="brand" href="/">Testing Tools</a>
  <nav class="main-nav">
    <a href="/http/requests" <%= nav === 'http' ? 'class="active"' : '' %>>HTTP</a>
    <a href="/smtp/inboxes" <%= nav === 'smtp' ? 'class="active"' : '' %>>SMTP</a>
  </nav>
  <button type="button" class="theme-toggle" data-theme-toggle aria-label="Switch theme">☾</button>
</header>
<main>
```

Every `include('partials/head', {...})` call must now pass `nav`. `src/shared/views/home.ejs`
renders two listener cards linking to `/http/requests` and `/smtp/inboxes`.

### T1.8 — 301 redirects (enhancement #1)

In `src/server.ts`, before the 404 handler:

```ts
/**
 * The dashboard moved from /requests to /http/requests when the app became a platform.
 * 301 rather than 302: the move is permanent and bookmarks should be rewritten. Note
 * that browsers cache 301s aggressively - this is hard to walk back.
 */
app.get(/^\/requests(\/.*)?$/, (req, res) => {
  res.redirect(301, `/http${req.originalUrl}`);
});
```

`app.get` with a RegExp is used rather than a path string because Express 5's
path-to-regexp no longer accepts the `/requests/*` form (same root cause as the `/listen`
wildcard finding).

### T1.9 — `src/server.ts`

```ts
import express from 'express';
import path from 'node:path';
import { config } from './config.ts';
import { prisma } from './db.ts';
import httpListenerRoutes from './features/http-listener/routes.ts';
import smtpRoutes from './features/smtp-mock/routes.ts';
import { createSmtpServers } from './features/smtp-mock/smtp/server.ts';
import { errorHandler } from './shared/middleware/errorHandler.ts';
import { securityHeaders } from './shared/middleware/securityHeaders.ts';

const app = express();
app.disable('x-powered-by');
app.use(securityHeaders);

app.set('view engine', 'ejs');

/**
 * Feature-local view directories. Express searches this array in order, so template names
 * must be globally unique - hence the requests-/smtp- prefixes. Shared partials resolve
 * because shared/views is on the list.
 */
app.set('views', [
  path.join(import.meta.dirname, 'shared/views'),
  path.join(import.meta.dirname, 'features/http-listener/views'),
  path.join(import.meta.dirname, 'features/smtp-mock/views'),
]);

app.use('/assets', express.static(path.join(import.meta.dirname, 'public')));

app.use(httpListenerRoutes);
app.use(smtpRoutes);

app.get('/', (_req, res) => res.render('home', { title: 'Testing Tools', nav: 'home' }));
app.get(/^\/requests(\/.*)?$/, (req, res) => res.redirect(301, `/http${req.originalUrl}`));

app.use((_req, res) => res.status(404).render('not-found', { title: 'Not found', nav: '' }));
app.use(errorHandler);

const server = app.listen(config.port, config.host, () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  console.log(`Testing Tools dashboard on http://${config.host}:${port}`);
  console.log('  HTTP listener  ANY  /listen/*');
  console.log('  HTTP dashboard GET  /http/requests');
  console.log('  SMTP dashboard GET  /smtp/inboxes');
  if (config.host === '0.0.0.0' || config.host === '::') {
    console.warn('  ! Dashboard bound to ALL interfaces with no authentication.');
    console.warn('    SMTP credentials are displayed in cleartext and readable by anyone.');
  }
});

const smtpServers = createSmtpServers();

/**
 * Close the web listener, every SMTP listener, then the database pool. Without this,
 * each restart under --watch leaks a connection, and the pool limit is 5.
 */
function shutdown(signal: string): void {
  console.log(`\n${signal} received, shutting down.`);
  const closings = [
    new Promise<void>((resolve) => server.close(() => resolve())),
    ...smtpServers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
  ];
  void Promise.all(closings).then(() => prisma.$disconnect().then(() => process.exit(0)));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

export { app, server, smtpServers };
```

### T1.10 — Update test imports and URLs

`tests/*.ts` import paths follow the moves; `/requests` becomes `/http/requests`
throughout. Add one assertion for the new redirect.

**Verify Phase 1:** `npm run typecheck` clean, `npm test` fully green, and
`curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://127.0.0.1:3000/requests`
prints `301 http://127.0.0.1:3000/http/requests`.

---

# Phase 2 — Database

### T2.1 — `prisma/schema.prisma`

Append three models. `RequestLog` is untouched.

```prisma
model SmtpInbox {
  id                Int      @id @default(autoincrement())
  name              String   @db.VarChar(191)
  username          String   @unique @db.VarChar(191)
  encryptedPassword String   @map("encrypted_password") @db.Text
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt      @map("updated_at")

  emails            SmtpEmail[]

  @@map("smtp_inboxes")
}

model SmtpEmail {
  id                 Int       @id @default(autoincrement())
  inboxId            Int       @map("inbox_id")
  inbox              SmtpInbox @relation(fields: [inboxId], references: [id], onDelete: Cascade)

  envelopeFrom       String    @map("envelope_from") @db.VarChar(320)
  envelopeRecipients Json      @map("envelope_recipients")

  headerFrom         String?   @map("header_from") @db.Text
  headerTo           String?   @map("header_to")   @db.Text
  headerCc           String?   @map("header_cc")   @db.Text
  subject            String?   @db.Text
  messageId          String?   @map("message_id")  @db.Text
  headers            Json

  textBody           String?   @map("text_body") @db.LongText
  htmlBody           String?   @map("html_body") @db.LongText

  rawMessage         String?   @map("raw_message")      @db.MediumText
  rawTruncated       Boolean   @default(false) @map("raw_truncated")
  rawElidedBytes     Int       @default(0)     @map("raw_elided_bytes")

  size               Int
  receivedAt         DateTime  @default(now()) @map("received_at")

  attachments        SmtpAttachment[]

  @@index([inboxId, id(sort: Desc)])
  @@map("smtp_emails")
}

model SmtpAttachment {
  id          Int       @id @default(autoincrement())
  emailId     Int       @map("email_id")
  email       SmtpEmail @relation(fields: [emailId], references: [id], onDelete: Cascade)

  filename    String?   @db.VarChar(255)
  contentType String    @map("content_type") @db.VarChar(255)
  size        Int

  @@index([emailId])
  @@map("smtp_attachments")
}
```

Deliberate deviations from spec §48 — no `listener_id` (no `listeners` table), no `bcc`
column (always empty by definition; derived from the envelope), no `storage_path` (no
attachment content in MVP).

### T2.2 / T2.3 — Migrate and generate

```bash
npm run migrate -- --name smtp_mock
npm run prisma:generate
npm run migrate:test
```

**Verify:** `SHOW TABLES` lists `smtp_inboxes`, `smtp_emails`, `smtp_attachments`; and
`SHOW CREATE TABLE smtp_emails` shows `raw_message mediumtext` plus the
`(inbox_id, id DESC)` index.

---

# Phase 3 — Backend: SMTP core

### T3.1 — `src/features/smtp-mock/lib/crypto.ts`

Pattern: **authenticated encryption (AEAD)**. GCM rather than CBC so a tampered
ciphertext fails loudly instead of decrypting to garbage.

```ts
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96 bits - the size GCM is specified for

/**
 * Spec 15 requires the SMTP password to be displayable in the dashboard, so a one-way
 * hash is not an option. It is encrypted at rest instead, with the key supplied through
 * the environment and never stored in the database.
 *
 * Format: base64(iv) : base64(authTag) : base64(ciphertext)
 */
export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString('base64')).join(':');
}

export function decryptSecret(stored: string, key: Buffer): string {
  const [iv, tag, data] = stored.split(':');
  if (!iv || !tag || !data) throw new Error('malformed ciphertext');

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Constant-time comparison. A length mismatch returns early - timingSafeEqual throws on
 * unequal lengths, and password length is not the secret worth protecting here.
 */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** 24 characters of URL-safe randomness. Used by enhancement #2. */
export function generatePassword(): string {
  return randomBytes(18).toString('base64url');
}
```

### T3.2 — `src/features/smtp-mock/smtp/elide.ts`

The centrepiece. Pattern: **incremental line-oriented state machine**, split into a pure
core (testable with a string) and a thin `Writable` wrapper (streams, never buffers).

⚠️ Write this file with the file-writing tool. It contains backslash escapes that a shell
heredoc will silently corrupt.

```ts
import { Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

export interface ElideResult {
  raw: string;
  elidedBytes: number;
  truncated: boolean;
}

const BOUNDARY = /boundary\s*=\s*(?:"([^"]*)"|([^;\s]+))/i;
const HEADER = /^([\w-]+)\s*:\s*(.*)$/;

/**
 * Rebuilds a MIME message with attachment payloads replaced by a marker.
 *
 * Raw is retained because a parser only shows what it RECOVERED, not what the sending
 * application actually emitted - and the difference is the bug being hunted. But raw is
 * only large because of attachments, whose bytes we deliberately do not store. Eliding
 * them keeps every header, every boundary and both body parts while collapsing a 27 MB
 * message to roughly 15 KB, so the size cap almost never fires.
 *
 * Degrades safely: an unparseable message matches no boundary, nothing is elided, and
 * the byte cap alone applies.
 */
export class MimeElider {
  readonly #max: number;
  readonly #lines: string[] = [];
  readonly #boundaries = new Set<string>();

  #length = 0;
  #truncated = false;
  #elidedBytes = 0;

  #inHeaders = true; // a message begins with its own headers
  #headerLines: string[] = [];
  #skipping = false;
  #skippedBytes = 0;

  constructor(max: number) {
    this.#max = max;
  }

  pushLine(line: string): void {
    if (this.#isBoundary(line)) {
      this.#flushSkipped();
      this.#emit(line);
      this.#inHeaders = true;
      this.#headerLines = [];
      return;
    }

    if (this.#inHeaders) {
      if (line === '') {
        this.#closeHeaders();
        return;
      }
      this.#headerLines.push(line);
      return;
    }

    if (this.#skipping) {
      this.#skippedBytes += line.length + 2; // + CRLF
      return;
    }
    this.#emit(line);
  }

  finish(): ElideResult {
    // A message can end while still inside headers or an elided part.
    if (this.#inHeaders) this.#closeHeaders();
    this.#flushSkipped();
    return {
      raw: this.#lines.join('\r\n'),
      elidedBytes: this.#elidedBytes,
      truncated: this.#truncated,
    };
  }

  /**
   * A boundary delimiter is "--" + the declared boundary, optionally followed by "--" to
   * close the multipart. Boundaries are tracked in a flat Set rather than a stack: nested
   * multiparts each declare their own, and any of them may legitimately appear next.
   */
  #isBoundary(line: string): boolean {
    if (!line.startsWith('--')) return false;
    const value = line.slice(2).replace(/--$/, '').trimEnd();
    return this.#boundaries.has(value);
  }

  #closeHeaders(): void {
    const headers = unfold(this.#headerLines);
    const contentType = headers.get('content-type') ?? '';
    const disposition = headers.get('content-disposition') ?? '';
    const encoding = headers.get('content-transfer-encoding') ?? '';

    const boundary = BOUNDARY.exec(contentType);
    if (boundary) this.#boundaries.add(boundary[1] ?? boundary[2] ?? '');

    for (const line of this.#headerLines) this.#emit(line);
    this.#emit('');

    this.#inHeaders = false;
    this.#headerLines = [];
    this.#skipping = shouldElide(contentType, disposition, encoding);
  }

  #flushSkipped(): void {
    if (!this.#skipping) return;
    this.#elidedBytes += this.#skippedBytes;
    this.#emit(`[-- ${this.#skippedBytes.toLocaleString('en-US')} bytes of payload elided --]`);
    this.#emit('');
    this.#skipping = false;
    this.#skippedBytes = 0;
  }

  #emit(line: string): void {
    if (this.#truncated) return;
    const cost = line.length + 2;
    if (this.#length + cost > this.#max) {
      this.#truncated = true;
      return;
    }
    this.#lines.push(line);
    this.#length += cost;
  }
}

/**
 * Elide a part when it is an attachment by disposition, or when it is base64-encoded and
 * not text. Text parts are kept whatever their encoding - a quoted-printable or base64
 * HTML body is exactly the thing someone opens this tool to inspect.
 */
function shouldElide(contentType: string, disposition: string, encoding: string): boolean {
  const type = contentType.toLowerCase();
  if (/^\s*attachment/i.test(disposition) || /filename\s*=/i.test(disposition)) return true;
  if (!encoding.toLowerCase().includes('base64')) return false;
  return !type.startsWith('text/') && !type.startsWith('multipart/');
}

/** RFC 5322 folding: a line beginning with space or tab continues the previous header. */
function unfold(lines: string[]): Map<string, string> {
  const out = new Map<string, string>();
  let name = '';
  for (const line of lines) {
    if (/^[ \t]/.test(line) && name) {
      out.set(name, `${out.get(name) ?? ''} ${line.trim()}`);
      continue;
    }
    const match = HEADER.exec(line);
    if (!match) continue;
    name = match[1]!.toLowerCase();
    out.set(name, match[2]!);
  }
  return out;
}

/** Convenience wrapper for tests and any non-streaming caller. */
export function elideMime(source: string, max: number): ElideResult {
  const elider = new MimeElider(max);
  for (const line of source.split(/\r?\n/)) elider.pushLine(line);
  return elider.finish();
}

/**
 * Streaming wrapper. StringDecoder is used rather than chunk.toString() so a multi-byte
 * UTF-8 sequence straddling a chunk boundary is not corrupted.
 */
export class RawElider extends Writable {
  readonly #elider: MimeElider;
  readonly #decoder = new StringDecoder('utf8');
  #remainder = '';
  #result: ElideResult | null = null;

  constructor(max: number) {
    super();
    this.#elider = new MimeElider(max);
  }

  override _write(chunk: Buffer, _enc: BufferEncoding, done: (e?: Error) => void): void {
    const text = this.#remainder + this.#decoder.write(chunk);
    const lines = text.split(/\r?\n/);
    this.#remainder = lines.pop() ?? ''; // may be a partial line
    for (const line of lines) this.#elider.pushLine(line);
    done();
  }

  override _final(done: (e?: Error) => void): void {
    const tail = this.#remainder + this.#decoder.end();
    if (tail !== '') this.#elider.pushLine(tail);
    this.#result = this.#elider.finish();
    done();
  }

  result(): ElideResult {
    if (this.#result === null) throw new Error('RawElider.result() called before finish');
    return this.#result;
  }
}
```

**Known limitation:** output is normalised to CRLF, and 8-bit non-UTF-8 body bytes become
U+FFFD. SMTP mandates CRLF and MIME text parts are encoded, so this affects only
`Content-Transfer-Encoding: 8bit` binary content — which is elided anyway. Recorded in
Open Items.

### T3.3 — `src/features/smtp-mock/smtp/auth.ts`

```ts
import type { SMTPServerAuthentication, SMTPServerSession } from 'smtp-server';
import { config } from '../../../config.ts';
import { prisma } from '../../../db.ts';
import { decryptSecret, secretsMatch } from '../lib/crypto.ts';

export interface InboxUser {
  inboxId: number;
  username: string;
}

/**
 * The credential IS the routing decision (spec 24). RCPT TO is recorded as metadata and
 * never consulted, so an authenticated session accepts mail for any recipient address and
 * files all of it under the credential's inbox.
 */
export function onAuth(
  auth: SMTPServerAuthentication,
  session: SMTPServerSession,
  callback: (err: Error | null, response?: { user: InboxUser }) => void,
): void {
  void (async () => {
    const username = auth.username ?? '';
    const password = auth.password ?? '';

    try {
      const inbox = await prisma.smtpInbox.findUnique({
        where: { username },
        select: { id: true, username: true, encryptedPassword: true },
      });

      // Identical response for unknown user and wrong password: distinguishing them
      // would let an attacker enumerate valid usernames.
      if (!inbox || !secretsMatch(decryptSecret(inbox.encryptedPassword, config.smtp.credentialKey), password)) {
        console.warn(`[smtp] auth failed for "${username}" from ${session.remoteAddress}`);
        callback(new Error('Invalid username or password'));
        return;
      }

      console.log(`[smtp] auth ok for "${username}" from ${session.remoteAddress}`);
      callback(null, { user: { inboxId: inbox.id, username: inbox.username } });
    } catch (error) {
      // Never let the password reach a log line or an SMTP reply (spec 40).
      console.error(`[smtp] auth error for "${username}": ${(error as Error).message}`);
      callback(new Error('Temporary authentication failure'));
    }
  })();
}
```

### T3.4 — `src/features/smtp-mock/smtp/ingest.ts`

```ts
import type { Readable } from 'node:stream';
import { MailParser } from 'mailparser';
import { RawElider, type ElideResult } from './elide.ts';

export interface AttachmentMeta {
  filename: string | null;
  contentType: string;
  size: number;
}

export interface ParsedMessage {
  headers: Map<string, unknown>;
  text: string | null;
  html: string | null;
  attachments: AttachmentMeta[];
}

/**
 * The raw message and the parsed message are both needed, and the source can only be read
 * once - so it is tee'd. Both pipes are attached synchronously before either promise is
 * awaited; the slower consumer governs backpressure.
 */
export function ingest(
  stream: Readable,
  rawMax: number,
): Promise<{ raw: ElideResult; parsed: ParsedMessage }> {
  const rawDone = collectRaw(stream, rawMax);
  const parsedDone = parseMessage(stream);
  return Promise.all([rawDone, parsedDone]).then(([raw, parsed]) => ({ raw, parsed }));
}

function collectRaw(stream: Readable, max: number): Promise<ElideResult> {
  return new Promise((resolve, reject) => {
    const elider = new RawElider(max);
    elider.on('finish', () => resolve(elider.result()));
    elider.on('error', reject);
    stream.pipe(elider);
  });
}

function parseMessage(stream: Readable): Promise<ParsedMessage> {
  return new Promise((resolve, reject) => {
    const parser = new MailParser();
    const attachments: AttachmentMeta[] = [];
    let headers: Map<string, unknown> = new Map();
    let text: string | null = null;
    let html: string | null = null;

    parser.on('headers', (map: Map<string, unknown>) => {
      headers = map;
    });

    parser.on('data', (part: any) => {
      if (part.type === 'attachment') {
        // VERIFIED: the parser STALLS until release() is called, and part.size is only
        // populated once the content stream has been consumed. So the bytes are counted
        // as they arrive and discarded - attachment content is not stored (decision #6).
        let size = 0;
        part.content.on('data', (chunk: Buffer) => {
          size += chunk.length;
        });
        part.content.on('end', () => {
          attachments.push({
            filename: part.filename ?? null,
            contentType: part.contentType ?? 'application/octet-stream',
            size,
          });
          part.release();
        });
        return;
      }

      if (part.type === 'text') {
        text = part.text ?? null;
        html = part.html ?? null;
      }
    });

    parser.on('end', () => resolve({ headers, text, html, attachments }));
    parser.on('error', reject);

    stream.pipe(parser);
  });
}
```

### T3.5 — `src/features/smtp-mock/services/emailService.ts`

```ts
import { prisma } from '../../../db.ts';
import type { ElideResult } from '../smtp/elide.ts';
import type { ParsedMessage } from '../smtp/ingest.ts';

export interface Envelope {
  mailFrom: string;
  rcptTo: string[];
}

function headerString(headers: Map<string, unknown>, key: string): string | null {
  const value = headers.get(key);
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  // mailparser returns structured address objects for from/to/cc.
  const structured = value as { text?: string };
  return structured.text ?? JSON.stringify(value);
}

/**
 * One INSERT, one transaction. Spec 25 requires persistence to complete before the SMTP
 * server reports acceptance, and spec 43 forbids a partially accepted record - both come
 * free from a single statement, which is the main reason attachment bytes and raw both
 * live in the database rather than on disk.
 */
export async function persist(
  inboxId: number,
  envelope: Envelope,
  parsed: ParsedMessage,
  raw: ElideResult,
  size: number,
): Promise<number> {
  const headers = Object.fromEntries(parsed.headers);

  const email = await prisma.smtpEmail.create({
    data: {
      inboxId,
      envelopeFrom: envelope.mailFrom,
      envelopeRecipients: envelope.rcptTo,
      headerFrom: headerString(parsed.headers, 'from'),
      headerTo: headerString(parsed.headers, 'to'),
      headerCc: headerString(parsed.headers, 'cc'),
      subject: headerString(parsed.headers, 'subject'),
      messageId: headerString(parsed.headers, 'message-id'),
      headers: JSON.parse(JSON.stringify(headers)),
      textBody: parsed.text,
      htmlBody: parsed.html,
      rawMessage: raw.raw,
      rawTruncated: raw.truncated,
      rawElidedBytes: raw.elidedBytes,
      size,
      attachments: {
        create: parsed.attachments.map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          size: a.size,
        })),
      },
    },
    select: { id: true },
  });

  return email.id;
}
```

### T3.6 — `src/features/smtp-mock/smtp/server.ts`

```ts
import { SMTPServer, type SMTPServerSession } from 'smtp-server';
import type { Readable } from 'node:stream';
import { config } from '../../../config.ts';
import { onAuth, type InboxUser } from './auth.ts';
import { ingest } from './ingest.ts';
import { persist } from '../services/emailService.ts';

function smtpError(message: string, responseCode: number): Error {
  return Object.assign(new Error(message), { responseCode });
}

function onData(
  stream: Readable & { sizeExceeded?: boolean; byteLength?: number },
  session: SMTPServerSession,
  callback: (err?: Error | null, message?: string) => void,
): void {
  void (async () => {
    const user = session.user as unknown as InboxUser | undefined;
    if (!user) {
      callback(smtpError('Authentication required', 530));
      return;
    }

    try {
      const { raw, parsed } = await ingest(stream, config.smtp.rawMessageMax);

      // VERIFIED: the `size` option only advertises SIZE and checks the value DECLARED in
      // MAIL FROM. A client that under-declares is caught only here. Checked after the
      // stream ends, and before anything is written.
      if (stream.sizeExceeded) {
        console.warn(`[smtp] message from "${user.username}" exceeded the size limit; nothing recorded`);
        callback(smtpError('Message exceeds maximum allowed size', 552));
        return;
      }

      const id = await persist(
        user.inboxId,
        {
          mailFrom: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
          rcptTo: session.envelope.rcptTo.map((r) => r.address),
        },
        parsed,
        raw,
        stream.byteLength ?? 0,
      );

      console.log(`[smtp] stored email #${id} for "${user.username}" (${stream.byteLength} bytes)`);
      callback(null, `Message accepted as ${id}`);
    } catch (error) {
      // Spec 25: never report acceptance when persistence is known to have failed.
      // 451 is a TEMPORARY failure, so a well-behaved client retries.
      console.error(`[smtp] ingest failed for "${user.username}": ${(error as Error).message}`);
      callback(smtpError('Temporary failure storing message', 451));
    }
  })();
}

export function createSmtpServers(): SMTPServer[] {
  const { tls, requireTls } = config.smtp;

  if (tls === null) {
    console.warn('[smtp] no TLS certificate configured - AUTH will be accepted in cleartext.');
  } else if (!requireTls) {
    console.warn('[smtp] SMTP_REQUIRE_TLS=false - AUTH is also accepted before STARTTLS.');
  }

  return config.smtp.ports.map((port) => {
    const server = new SMTPServer({
      name: config.smtp.hostname,
      secure: false, // STARTTLS mode; implicit TLS (port 465) is enhancement #11
      ...(tls ? { key: tls.key, cert: tls.cert } : {}),

      // VERIFIED: hiding STARTTLS is what makes smtp-server advertise AUTH on an
      // unencrypted connection at all. Without a certificate there is nothing to upgrade
      // to, so it must be hidden or no client can ever authenticate.
      hideSTARTTLS: tls === null,

      // VERIFIED: false (the default) withholds AUTH until TLS is established. That is
      // the entire enforcement mechanism for SMTP_REQUIRE_TLS - no custom check needed.
      allowInsecureAuth: !requireTls,

      authMethods: ['PLAIN', 'LOGIN'],
      authOptional: false, // spec 13: no message is accepted without a credential
      size: config.smtp.maxMessageSize,
      maxClients: config.smtp.maxClients,
      disableReverseLookup: true, // a DNS round-trip per connection buys nothing here
      logger: false, // our own logging; the bundled logger prints AUTH payloads

      onAuth,
      onData,
      onConnect(session, callback) {
        console.log(`[smtp] connect from ${session.remoteAddress} on :${port}`);
        callback();
      },
      onClose(session) {
        console.log(`[smtp] close ${session.remoteAddress}`);
      },
    });

    server.on('error', (error) => console.error(`[smtp:${port}] ${error.message}`));
    server.listen(port, config.smtp.bind, () => {
      const mode = tls ? (requireTls ? 'STARTTLS required' : 'STARTTLS optional') : 'no TLS';
      console.log(`  SMTP listening on ${config.smtp.bind}:${port} (${mode})`);
    });

    return server;
  });
}
```

**Note on parse failure:** a message that `mailparser` cannot parse still reaches `persist`
with null bodies and the raw retained, and still returns 250. That mirrors use case L1 —
*"must capture malformed payloads verbatim; this is the tool's primary purpose, not an edge
case"* — and retaining raw is precisely what makes the failure diagnosable.

---

# Phase 4 — Backend services, routes and views

### T4.1 — `src/features/smtp-mock/services/inboxService.ts`

```ts
import { prisma } from '../../../db.ts';
import { config } from '../../../config.ts';
import { encryptSecret, decryptSecret, generatePassword } from '../lib/crypto.ts';

export async function list() {
  return prisma.smtpInbox.findMany({
    select: {
      id: true,
      name: true,
      username: true,
      createdAt: true,
      _count: { select: { emails: true } },
    },
    orderBy: { id: 'asc' },
  });
}

export async function create(name: string, username: string, password: string) {
  return prisma.smtpInbox.create({
    data: {
      name,
      username,
      encryptedPassword: encryptSecret(password, config.smtp.credentialKey),
    },
    select: { id: true },
  });
}

/** The dashboard displays the password (spec 29), so it is decrypted on read. */
export async function findWithPassword(id: number) {
  const inbox = await prisma.smtpInbox.findUnique({ where: { id } });
  if (!inbox) return null;
  return { ...inbox, password: decryptSecret(inbox.encryptedPassword, config.smtp.credentialKey) };
}

export { generatePassword };
```

### T4.2 — `src/features/smtp-mock/inboxesController.ts`

Mirrors `requestsController` conventions: `LIST_COLUMNS`-style explicit selects, `parseId`,
`deleteMany` for idempotent deletes, `paginate` from `shared/lib`.

Handlers: `index`, `create`, `show` (inbox + paginated email list + copy-ready SMTP config
block for enhancement #4), `destroy`, `clear`. `create` accepts an empty password field and
substitutes `generatePassword()` (enhancement #2). Duplicate username is caught on Prisma
error code `P2002` and re-rendered as a field error, never a 500.

### T4.3 — `src/features/smtp-mock/emailsController.ts`

Four handlers. `show` loads metadata and attachments but **not** `rawMessage` — a second
query fetches it only for the Raw tab, following the two-query pattern that
[size-guard-bypassed-by-second-render.md](../solutions/correctness/size-guard-bypassed-by-second-render.md)
established.

```ts
export async function html(req: Request, res: Response): Promise<void> {
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).send('Invalid id'); return; }

  const record = await prisma.smtpEmail.findUnique({ where: { id }, select: { htmlBody: true } });
  if (!record) { res.status(404).send('Not found'); return; }

  const allowRemote = req.query.images === 'on'; // enhancement #9

  /**
   * This response is attacker-controlled HTML rendered as HTML - the single most dangerous
   * surface in the app. Three controls, none sufficient alone:
   *
   *  1. sandbox on the parent iframe (no allow-scripts, no allow-same-origin)
   *  2. this CSP, which must REPLACE the global one rather than inherit it
   *  3. nosniff
   *
   * CRITICAL: the global CSP sets frame-ancestors 'none', which would block our OWN
   * dashboard from framing this and render a blank box with no visible error. It must be
   * overridden to 'self' here.
   */
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'none'",
      "style-src 'unsafe-inline'", // email CSS is inline by nature
      allowRemote ? 'img-src data: https: http:' : 'img-src data:',
      "script-src 'none'",
      "frame-ancestors 'self'",
    ].join('; '),
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(record.htmlBody ?? '<p>No HTML body.</p>');
}
```

`raw` mirrors `requestsController.rawBody` exactly: `text/plain; charset=utf-8` + `nosniff`.

### T4.4 — `src/features/smtp-mock/routes.ts`

Same middleware stack as the HTTP dashboard — `urlencoded`, `methodOverride`,
`sameOriginOnly` — mounted at `/smtp`. Routes exactly as tabled in the brainstorm §8.

### T4.5 — Views

| File | Contents |
|---|---|
| `smtp-inboxes.ejs` | Table: Name, Username, Emails, Created, Delete. Create form with a "generate" checkbox |
| `smtp-inbox.ejs` | Credentials panel + copy-ready config block, email table (Received/From/To/Subject/Size), search box, pagination, Clear Inbox |
| `smtp-email.ejs` | Envelope, headers, derived BCC, attachment table, and the four body tabs |

The email detail tabs use native `<details>`/radio-driven CSS, not JavaScript — consistent
with the existing three-tier body rendering, and they keep working if `/assets/app.js` fails
to load. The HTML tab holds `<iframe sandbox src="/smtp/emails/<%= record.id %>/html">`.

Derived BCC, computed in the controller and passed in prepared:

```ts
const headerAddresses = new Set(
  [record.headerTo, record.headerCc].join(',').toLowerCase().match(/[\w.+-]+@[\w.-]+/g) ?? [],
);
const bcc = (record.envelopeRecipients as string[]).filter(
  (address) => !headerAddresses.has(address.toLowerCase()),
);
```

Elision must be visible, never silent:

```html
<% if (record.rawTruncated || record.rawElidedBytes > 0) { %>
  <p class="warn">
    <%= formatBytes(record.rawElidedBytes) %> of attachment payload elided<% if (record.rawTruncated) { %>,
    and the stored copy was truncated at the <%= formatBytes(rawMax) %> cap<% } %>.
    Attachment metadata is listed below. Message size on the wire: <%= formatBytes(record.size) %>.
  </p>
<% } %>
```

### T4.6 — `src/public/app.js` and `style.css`

Three additions, all progressive enhancement:

- **Copy button** (#4) — `navigator.clipboard.writeText` on `[data-copy]`
- **Live refresh** (#8) — on `[data-refresh]` inbox pages, poll `?page=1` every 5s and swap
  the table body. Pauses when the tab is hidden (`document.hidden`) and when a search term
  is active
- **Remote images toggle** (#9) — re-points the iframe `src` with `?images=on`

`style.css` gains `.main-nav`, `.tabs`, `.email-frame`, `.attachment-table`, `.warn`, all
using the existing CSS custom properties so both themes work without new declarations.

**Verify Phase 4:** `npm run typecheck` clean; create an inbox in the browser, confirm the
password displays, and confirm the HTML tab renders inside the iframe rather than blank.

---

# Phase 5 — Testing and verification

### T5.1 — `.env.testing`

⚠️ Scale the limits **together**. `SMTP_MAX_MESSAGE_SIZE` below `RAW_MESSAGE_MAX` makes the
truncation branch unreachable while the suite still reports green — the exact failure
recorded in `size-guard-bypassed-by-second-render.md`.

```bash
WEB_HOST=127.0.0.1
PORT=0
SMTP_BIND=127.0.0.1
SMTP_PORTS=0                    # ephemeral - never collide with a real 587/2525
SMTP_MAX_MESSAGE_SIZE=8192
RAW_MESSAGE_MAX=2048            # reachable: 2048 < 8192
SMTP_REQUIRE_TLS=false          # no certificate in CI
SMTP_CRED_KEY=<fixed 32-byte base64 test key>
SMTP_PAGE_SIZE=5
```

`SMTP_PORTS=0` requires `createSmtpServers` to expose each server's actual bound port, the
same way `tests/support.ts` already does for the web server.

### T5.2 — `tests/smtp-elide.test.ts`

Pure, no I/O. Fixtures as `String.raw` template literals so escapes cannot drift.

| Case | Assertion |
|---|---|
| plain text, no multipart | output identical to input, `elidedBytes === 0` |
| multipart/alternative, text + html | both bodies intact, nothing elided |
| multipart/mixed with a base64 PDF | PDF payload absent, part headers and closing boundary present |
| nested mixed → alternative | inner boundary recognised, both text parts kept |
| base64 `text/html` part | **not** elided |
| malformed boundary | degrades to cap only, no crash |
| body over the cap | `truncated === true`, output ≤ cap |
| chunk split mid-line and mid-UTF-8 | `RawElider` output equals `elideMime` output |

Absence assertions, not just presence — `assert.ok(!result.raw.includes('JVBERi0x'))`.

### T5.3 — `tests/smtp-crypto.test.ts`

Round-trip; tamper detection (flip a ciphertext byte → `final()` throws); wrong key throws;
`secretsMatch` true/false and length-mismatch; two encryptions of the same plaintext differ
(random IV).

### T5.4 — `tests/smtp-server.test.ts`

`nodemailer` as the client against the ephemeral port.

Valid auth → 250 and a row; invalid auth → rejected, zero rows; unauthenticated MAIL FROM →
530; oversized message → 552 **and zero rows**; multi-recipient; BCC preserved in
`envelopeRecipients` but absent from headers; HTML and text bodies; attachment metadata
recorded with content absent; four concurrent senders land in four correct inboxes;
credential A's message never appears in inbox B.

One log assertion: capture `console.log`/`warn` during an auth cycle and assert the password
string appears in none of it (spec §40).

### T5.5 / T5.6 — Dashboard and hardening

Inbox CRUD, pagination clamping, clear-inbox preserves credentials, cascade delete leaves no
orphan `smtp_emails` or `smtp_attachments` rows, XSS escaping of a hostile subject.

Hardening: `/smtp/emails/:id/html` returns `frame-ancestors 'self'` (**not** `'none'`) and
`script-src 'none'`; `/smtp/emails/:id/raw` returns `nosniff`; a cross-site
`sec-fetch-site` header on every SMTP `DELETE` returns 403 **and destroys nothing**.

**Verify Phase 5:** `npm test` green, `npm run typecheck` clean, and
`grep -rnF '\' src/features/smtp-mock/` reviewed by eye — the `-F` is required, per the
heredoc finding.

---

# Phase 6 — Post-MVP (deferred, not part of the MVP definition)

Accepted in brainstorming but deliberately sequenced after a working MVP.

### Enhancement #6 — Attachment content and download

Add `content Bytes? @db.LongBlob` to `SmtpAttachment` plus `ATTACHMENT_MAX_STORE=5mb`.
`ingest` buffers a part only while `size <= threshold`, otherwise discards as now. Download
route: `Content-Disposition: attachment`, sanitised filename, `application/octet-stream`,
`nosniff`. Requires `max_allowed_packet` verified on the target server.

### Enhancement #11 — Port 465 implicit TLS

A third `SMTPServer` with `secure: true` on 465. Unlike 587/2525 it **cannot start without a
certificate**, so it is skipped with a warning when `tls === null`.

---

## Acceptance Criteria

- [ ] `npm run typecheck` clean and `npm test` green
- [ ] `GET /requests` returns 301 to `/http/requests`; every pre-existing HTTP listener use case (L1, L2, I1–I4, D1, D2) still passes
- [ ] `ANY /listen/*` is unchanged in URL and behaviour
- [ ] `POST /smtp/inboxes` creates an inbox with exactly one credential; duplicate username is a field error, not a 500
- [ ] A client authenticating as `application-a` and sending to any recipient has the message stored under Inbox A (**AC-04**)
- [ ] Invalid credentials are rejected and no email row is created (**AC-03**)
- [ ] With a certificate present and `SMTP_REQUIRE_TLS=true`, `EHLO` advertises STARTTLS and AUTH is **absent** until TLS is established (**AC-02**)
- [ ] `SMTP_REQUIRE_TLS=true` with no certificate fails at boot with a message naming both fixes
- [ ] A message exceeding the size limit is rejected with 552 and **zero rows are written** (**AC-10**)
- [ ] Persistence failure returns 451, never 250 (**AC-05**)
- [ ] `envelopeRecipients` retains BCC addresses absent from headers (**AC-06**, **§19**)
- [ ] Text and HTML bodies are both viewable; HTML renders in a sandboxed iframe with `frame-ancestors 'self'` and `script-src 'none'` (**AC-07**, **AC-08**)
- [ ] Attachment filename, content type and size are recorded and displayed; no attachment bytes are stored (**AC-09**)
- [ ] A message with a 20 MB attachment stores under 32 KB of `raw_message`, and the UI states how many bytes were elided
- [ ] `size` always reports the true wire size, never the stored size
- [ ] Deleting an email removes its attachment rows; deleting an inbox removes its emails and attachments (**AC-11**, **AC-12**)
- [ ] Clear Inbox empties emails and preserves the credential (**§33**)
- [ ] Email lists paginate, newest first (**AC-13**, **§35**)
- [ ] Emails survive a service restart (**AC-14**)
- [ ] Four concurrent senders land in four correct inboxes (**AC-15**)
- [ ] No SMTP password appears in any log line, SMTP reply, or error message (**§40**, **§42**)
- [ ] `WEB_HOST` and `SMTP_BIND` are independently configurable, and the old `HOST` still works
- [ ] The §54 end-to-end flow succeeds: configure host/port/STARTTLS/username/password, send, and see the email in the dashboard

---

## Open Items for `/gate`

1. **Raw is normalised to CRLF and decoded as UTF-8.** 8-bit non-UTF-8 body bytes become
   U+FFFD. Acceptable (SMTP mandates CRLF; such content is elided anyway) but it is a
   deviation from "verbatim" and should be an explicit decision, not a silent one.
2. **`SMTP_PORTS=0` in tests** requires `createSmtpServers` to return bound ports. Confirm
   the shape before writing the integration suite against it.
3. **301 caching.** Browsers cache it hard. Confirm the URL move is final before shipping.
4. **`session.user` is typed `unknown`** by `@types/smtp-server`; the cast in `onData` is
   the boundary where that type is asserted. Worth a runtime shape check.
5. **`maxClients: 50`** is a guess. No basis for it beyond "more than a test suite needs".
6. **`prisma.smtpEmail.create` with nested `attachments.create`** — confirm Prisma 7 wraps
   this in a single transaction. Spec §43's "no partially accepted record" depends on it.
7. **PM2** — `max_memory_restart: '500M'` may need revisiting now that SMTP shares the
   process, though the streaming design keeps per-session peak in the hundreds of KB.
