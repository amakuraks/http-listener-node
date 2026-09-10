# Request Tester

Captures HTTP requests exactly as sent and shows them in a web dashboard. Point any system at `/listen`, then inspect what it actually sent — headers, query, raw body and all.

Unlike most tools, it records **malformed** payloads instead of rejecting them, and stores binary bodies without corrupting them.

## Requirements

- Node.js 24+ (runs TypeScript directly — no build step)
- MySQL or MariaDB

## Setup

```bash
npm install
cp .env.example .env          # then fill in your database details
npm run migrate:deploy
npm run prisma:generate
```

Create the databases first if they don't exist:

```sql
CREATE DATABASE http_listener CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE http_listener_testing CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

> Quote `DATABASE_PASSWORD` in `.env`. An unquoted `#` silently truncates the value.

## Run

```bash
npm run dev     # watch mode
npm start       # plain
```

Dashboard: <http://localhost:3000/requests>

## Use

```bash
curl -X POST http://localhost:3000/listen/report/1 \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer abc123' \
  -d '{"name":"Monthly Report"}'
# {"status":"OK"}
```

Open the dashboard, click the record, inspect it. **Copy as cURL** rebuilds a runnable command to replay it.

## Routes

| Method | Path | |
|---|---|---|
| `ANY` | `/listen/*` | Capture a request → `200` |
| `GET` | `/requests` | List (paginated, `?page=N`) |
| `GET` | `/requests/:id` | Detail |
| `GET` | `/requests/:id/body` | Raw body |
| `DELETE` | `/requests/:id` | Delete one |
| `DELETE` | `/requests` | Delete all |

Listener responses: `200 OK` · `413 TOO_LARGE` (over `MAX_BODY_SIZE`) · `500 ERROR` (not saved).

## Configuration

| Variable | Default | |
|---|---|---|
| `DATABASE_HOST` / `_PORT` / `_USER` / `_PASSWORD` / `_NAME` | — | Connection |
| `HOST` | `127.0.0.1` | **Keep as loopback** — see below |
| `PORT` | `3000` | |
| `PAGE_SIZE` | `20` | Records per page |
| `MAX_BODY_SIZE` | `50mb` | Larger bodies get `413` |
| `BODY_PREVIEW_CHARS` | `2000` | Shown before "Show more" |
| `BODY_INLINE_MAX` | `131072` | Above this, body isn't sent to the browser |

## Tests

```bash
npm run migrate:test    # prepare the test database (once)
npm test                # 47 tests
npm run typecheck
```

## ⚠️ Security

**There is no authentication, and captured `Authorization` headers, API keys and cookies are stored in cleartext, indefinitely.** That's the point of the tool, but it means:

- Keep `HOST=127.0.0.1`. Exposing it to a network publishes every captured credential.
- Adding authentication and TLS are **prerequisites** for any wider deployment, not enhancements.
- Prefer test credentials over production ones.
- Nothing is auto-deleted — use **Clear All** after each test cycle.

## Docs

- [`docs/spec-driven-document.md`](docs/spec-driven-document.md) — specification
- [`docs/use-cases.md`](docs/use-cases.md) — what the system does
- [`docs/solutions/`](docs/solutions/) — post-mortems worth reading before changing the escaping or size-limit code

## Notes

- `prisma migrate dev` needs shadow-database privileges a least-privilege user won't have. Use `migrate diff` + `migrate deploy` — see the plan in `docs/plans/`.
- `npm i prisma` resolves to a release candidate; versions are pinned exact on purpose.
