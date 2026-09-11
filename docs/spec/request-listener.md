# Request Tester

## Spec-Driven Development (SDD)

**Version:** 1.1
**Status:** MVP
**Implementation:** Laravel / Node.js

> **Changelog — v1.1 (2026-09-10).** Eight amendments arising from the Node.js
> implementation. Two were defects that prevented the reference code from running at all;
> the rest close gaps found during security review. Amended sections are marked
> **[v1.1]**. See `docs/plans/2026-09-10-http-listener-mvp-plan.md` for the evidence
> behind each.

---

# 1. Purpose

Request Tester is a lightweight HTTP request capture service used for integration testing.

The system provides a single HTTP listener where an external system can send requests. Request Tester records the received request and provides a web interface for inspecting the captured records.

The MVP has three core functions:

1. **Listen**
2. **Record / Log**
3. **Show Records**

The system does not attempt to emulate the target API beyond returning a successful HTTP response.

---

# 2. Scope

## 2.1 In Scope

* Receive HTTP requests
* Accept all HTTP methods
* Accept arbitrary paths under `/listen`
* Record incoming request information
* Store records in a database
* Display captured requests
* Display request details
* Paginate request records
* Delete individual records
* Delete all records
* Return HTTP 200 after successful recording

## 2.2 Out of Scope

The following are explicitly excluded from the MVP:

* Authentication
* Authorization
* Users / teams
* API tokens
* Multiple listeners
* Listener configuration
* Request validation
* Request matching
* Custom response configuration
* Dynamic responses
* Response scenarios
* Request forwarding
* OpenAPI import
* Rate limiting
* Automatic retention
* Background processing
* Automatic deletion
* Complex request filtering
* Webhook retry simulation

## 2.3 Deployment Constraint **[v1.1]**

> **Amendment 8.** Excluding authentication (§2.2) is a reasonable MVP decision, but it was
> stated without the constraint it implies. §4 mandates storing headers **unmasked**, so the
> `requests` table accumulates bearer tokens, API keys and session cookies in cleartext. An
> unauthenticated dashboard over that data is a credential store open to anyone who can
> reach it.
>
> A default web server binding listens on **every network interface**, which on any shared
> network publishes those credentials to every device on it.

Because the MVP has no authentication, the following are **requirements, not
recommendations**:

1. The service shall bind to **loopback (`127.0.0.1`) by default**. Binding to all
   interfaces shall require explicit configuration and shall emit a warning.
2. The service shall not be exposed beyond the local machine or a trusted internal network
   **unless authentication and transport encryption are added first**. Those are then
   prerequisites, not enhancements.
3. The `requests` table shall be classified **Confidential**, and inherits the highest
   classification of any system tested against it.
4. Operators should prefer test or sandbox credentials over production credentials when
   exercising the listener.

### Retention

§15.2 mandates no automatic retention, so captured credentials persist **indefinitely**.
This is deliberate, but it makes manual purging the entire retention policy: operators shall
clear captured requests at the end of each test cycle, and should avoid routing live personal
data through the listener.

---

# 3. Functional Specification

## 3.1 Listen

The system shall provide one listener endpoint:

```text
/listen/*
```

The listener shall accept:

```text
GET
POST
PUT
PATCH
DELETE
OPTIONS
HEAD
```

and any other HTTP methods supported by the underlying web server/framework.

Examples:

```text
GET    /listen
POST   /listen
POST   /listen/report
PUT    /listen/report/1
PATCH  /listen/customer/123/status
DELETE /listen/report/123
```

All paths beginning with `/listen` shall be handled by the listener.

### Processing

When a request arrives:

```text
Incoming HTTP Request
        │
        ▼
   /listen/*
        │
        ▼
 Capture request data
        │
        ▼
 Persist record
        │
        ▼
 Return HTTP 200
```

If the request cannot be persisted, the system shall return an appropriate server error instead of falsely reporting a successful capture.

---

# 4. Record / Log

Every successfully received request shall create one request record.

The system shall capture the following information:

| Field        | Description                   |
| ------------ | ----------------------------- |
| `id`         | Unique record identifier      |
| `method`     | HTTP method                   |
| `url`        | Requested URI/path            |
| `headers`    | All HTTP request headers      |
| `query`      | Query parameters              |
| `body`       | Raw request body              |
| `created_at` | Time the request was recorded |

No special masking or filtering shall be performed in the MVP.

Headers, including authentication or other sensitive headers, shall be stored as received.

## 4.1 Example

Request:

```http
PUT /listen/report/1?debug=true
Content-Type: application/json
Authorization: Bearer abc123
X-Request-ID: req-001

{
    "name": "Monthly Report",
    "status": "completed"
}
```

Stored record:

```json
{
    "id": 1,
    "method": "PUT",
    "url": "/listen/report/1?debug=true",
    "headers": {
        "content-type": ["application/json"],
        "authorization": ["Bearer abc123"],
        "x-request-id": ["req-001"]
    },
    "query": {
        "debug": "true"
    },
    "body": "{\"name\":\"Monthly Report\",\"status\":\"completed\"}",
    "created_at": "2026-09-10T13:30:25Z"
}
```

---

# 5. Database Specification

Only one application table is required for the MVP.

## 5.1 `requests` **[v1.1]**

```text
requests
────────────────────────
id
method
url
headers
query
body
body_encoding      [v1.1]
body_size          [v1.1]
created_at
updated_at
```

Recommended types:

| Column          | Type            | Notes |
| --------------- | --------------- | ----- |
| `id`            | INT / BIGINT / UUID | See amendment 4 below |
| `method`        | VARCHAR         | |
| `url`           | TEXT            | |
| `headers`       | JSON            | Array-valued per §4.1 |
| `query`         | JSON            | |
| `body`          | LONGTEXT        | `TEXT` caps at 64KB — too small |
| `body_encoding` | VARCHAR         | `utf8` or `base64` **[v1.1]** |
| `body_size`     | INT             | Raw byte count **[v1.1]** |
| `created_at`    | TIMESTAMP       | |
| `updated_at`    | TIMESTAMP       | Optional; records are append-only |

> **Amendment 3 — two new columns.**
>
> **`body_encoding`** exists because a naive `toString('utf8')` replaces invalid byte
> sequences with U+FFFD *irreversibly*. A captured PNG, gzip or protobuf payload would be
> silently corrupted. Implementations shall round-trip the bytes through UTF-8 and store
> `utf8` when they survive unchanged, `base64` otherwise. §2.2 does not exclude binary
> payloads, so losing them is a defect rather than a scope decision.
>
> **`body_size`** stores the raw byte count so the request list can display a size without
> loading the body. Without it, rendering one page of 20 records would pull up to 20 large
> bodies into memory purely to measure them. The list query shall not select `body`.

> **Amendment 4 — `id` type.** BIGINT is problematic in JavaScript implementations: it maps
> to the `BigInt` type, and **`JSON.stringify` throws on `BigInt`**, so returning a record
> as JSON fails at runtime. Use `INT` (~2.1 billion rows, far beyond a development tool's
> needs) or serialise `BigInt` explicitly. The Node.js implementation uses `INT`.

> **Charset.** The table shall use `utf8mb4`. This is a security control, not a preference:
> the MariaDB/MySQL client library carries an unfixed SQL-injection advisory reachable only
> under `big5`, `gbk`, `sjis`, `cp932` or `gb18030` client charsets.

`updated_at` is optional if request records are never updated after creation.

---

# 6. Show Records

The system shall provide a dashboard for viewing captured requests.

## 6.1 Request List

The list shall display at minimum:

* Timestamp
* HTTP method
* URL

Example:

```text
Request Tester

Captured Requests

Time                 Method     URL
────────────────────────────────────────────
2026-09-10 13:30:25  PUT        /listen/report/1
2026-09-10 13:29:51  POST       /listen/report
2026-09-10 13:28:04  GET        /listen/report/1
2026-09-10 13:27:22  DELETE     /listen/report/2

              Previous  1  2  3  Next
```

Records should normally be ordered by newest first.

---

# 7. Pagination

The request list shall support pagination using the `page` query parameter.

Example:

```text
/requests?page=2
```

The default page size shall be configurable at the application level.

For the MVP, a simple server-side pagination mechanism is sufficient.

---

# 8. Request Detail

Selecting a request shall display the complete captured information.

Example:

```text
PUT /listen/report/1

2026-09-10 13:30:25

Headers
────────────────────────
Content-Type: application/json
Authorization: Bearer abc123
X-Request-ID: req-001

Query Parameters
────────────────────────
debug = true

Body
────────────────────────
{
    "name": "Monthly Report",
    "status": "completed"
}
```

The detail page shall display:

1. HTTP method
2. URL
3. Timestamp
4. Headers
5. Query parameters
6. Request body

---

# 9. Delete Records

The dashboard shall provide two deletion operations.

## 9.1 Delete Individual Record

A user can delete a specific captured request.

```text
DELETE /requests/{id}
```

After successful deletion, the record shall no longer appear in the request list.

## 9.2 Delete All Records

The dashboard shall provide an operation to delete all captured requests.

```text
DELETE /requests
```

The operation shall remove all request records.

---

# 10. API / Route Specification

The application consists of two functional areas:

### Listener

```text
ANY /listen/{path?}
```

### Dashboard

```text
GET    /requests
GET    /requests/{id}
DELETE /requests/{id}
DELETE /requests
```

The listener and dashboard may be implemented using separate controllers/modules.

---

# 11. Laravel Specification

## 11.1 Route

Laravel shall use a catch-all route:

```php
Route::any('/listen/{path?}', [RequestController::class, 'store'])
    ->where('path', '.*');
```

This allows:

```text
/listen
/listen/foo
/listen/foo/bar
/listen/report/1
```

with any HTTP method.

## 11.2 Controller

Conceptually:

```php
public function store(Request $request)
{
    RequestLog::create([
        'method'  => $request->method(),
        'url'     => $request->getRequestUri(),
        'headers' => $request->headers->all(),
        'query'   => $request->query(),
        'body'    => $request->getContent(),
    ]);

    return response()->json([
        'status' => 'OK',
    ], 200);
}
```

The implementation shall preserve the raw request body.

## 11.3 Model

```text
RequestLog
```

The model shall map to:

```text
requests
```

JSON fields shall use Laravel's JSON casting mechanism where appropriate.

Example:

```php
protected $casts = [
    'headers' => 'array',
    'query'   => 'array',
];
```

## 11.4 Pagination

Use Laravel's built-in pagination:

```php
RequestLog::latest()->paginate(20);
```

The resulting pagination links shall use the `page` query parameter.

---

# 12. Node.js Specification

Node.js shall implement the same behavior and API contract as the Laravel version.

The specific Node.js framework is implementation-dependent. A lightweight HTTP framework such as Express or Fastify is appropriate.

## 12.1 Listener Route

The application shall provide a catch-all listener equivalent to:

```text
ANY /listen/*
```

It must capture:

```text
method
URL
headers
query
body
timestamp
```

## 12.2 Conceptual Express Implementation **[v1.1]**

> **Amendment 1 — routing.** The previous text specified:
>
> ```javascript
> app.all('/listen', captureRequest);
> app.all('/listen/*', captureRequest);   // Express 4 syntax
> ```
>
> This **throws at startup** on Express 5, which is what `npm install express` now
> installs. Express 5 upgraded to `path-to-regexp` v8, which removed unnamed wildcards:
>
> ```
> Missing parameter name at index 9: /listen/*
> ```
>
> Wildcards must be named. A single route with an optional segment replaces both lines.

```javascript
app.all('/listen{/*splat}', express.raw({ type: '*/*', limit: MAX_BODY_SIZE }), captureRequest);
```

Verified to match `/listen`, `/listen/report/1?debug=true` and `/listen/a/b/c/d`.

> **Amendment 2 — body capture.** The previous handler read `req.body`, which implies a
> parsing body parser such as `express.json()`. That is incorrect for this product for
> three reasons:
>
> | Problem | Consequence |
> |---|---|
> | `express.json()` rejects malformed JSON with **HTTP 400** before the handler runs | The tool cannot capture broken payloads — the single most common reason to reach for it |
> | It *parses* the body | Destroys the raw fidelity required by §4 and §11.2 |
> | It defaults to a **100kb** limit | Contradicts §15.3 |
>
> Use `express.raw({ type: '*/*' })`, which yields a `Buffer` for every content type and
> parses nothing.

The handler shall:

1. Read the raw request bytes.
2. Capture all required request information.
3. Create a database record.
4. Return HTTP 200.

Conceptually:

```javascript
async function captureRequest(req, res) {
    // express.raw leaves req.body as {} (NOT an empty Buffer) on a bodyless
    // request such as GET or DELETE. Without this guard, .toString() throws.
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

    try {
        await Request.create({
            method: req.method,
            url: req.originalUrl,
            headers: normalizeHeaders(req.headers),  // see §4.1 note below
            query: req.query,
            ...encodeBody(buf),                      // see §5 body_encoding
            created_at: new Date()
        });
        res.status(200).json({ status: 'OK' });
    } catch (error) {
        res.status(500).json({ status: 'ERROR' });   // §16: never 200 on failure
    }
}
```

### Header shape

Node returns header values as flat strings; §4.1 and the Laravel implementation use arrays.
To keep the two implementations contract-compatible per §12, Node implementations shall
normalise:

```javascript
// { 'content-type': 'application/json' }  ->  { 'content-type': ['application/json'] }
```

The actual implementation must ensure that the body is captured correctly for different
content types, including payloads that are not valid UTF-8.

---

# 13. Node.js Database Layer

The Node.js implementation may use an ORM or query builder.

Suitable choices include:

* Prisma
* Sequelize
* TypeORM
* Knex

The database schema must remain compatible with the defined `requests` specification.

The implementation shall not introduce additional application tables unless required by the selected framework/library.

---

# 14. UI Specification

The MVP requires only two primary screens.

## 14.0 Output Encoding **[v1.1]**

> **Amendment 7 — the dashboard renders attacker-controlled data.** This follows directly
> from Listen → Show but was never stated. Every value on these screens — URL, header names
> and values, query parameters, body — was supplied by an external system through an
> endpoint that accepts arbitrary input by design.
>
> A request carrying `<script>alert(1)</script>` in a header renders that script into the
> detail page. That is textbook **stored cross-site scripting**, arriving through the one
> endpoint whose entire purpose is accepting anything.

Implementations shall:

1. **Escape every captured value on output.** Use the templating engine's escaping form
   (Blade `{{ }}`, EJS `<%= %>`) and never the raw form (`{!! !!}`, `<%- %>`) on captured
   data. The raw form is permitted only for template includes.
2. **Send a Content-Security-Policy** as defence in depth, at minimum
   `default-src 'self'; script-src 'self'` with no `unsafe-inline`. This requires that the
   UI carry no inline `onclick`/`onsubmit` handlers — behaviour belongs in a served script
   file.
3. **Serve raw body responses as `text/plain` with `X-Content-Type-Options: nosniff`**, so a
   captured payload cannot be sniffed into executable HTML.
4. **Protect destructive operations against cross-origin invocation.** Cross-origin form
   POSTs are *not* blocked by browser origin policy, so any page the operator has open could
   silently trigger "delete all". Binding the service to loopback does **not** prevent this,
   because the request originates from the operator's own browser. Reject state-changing
   requests whose `Sec-Fetch-Site` is present and not `same-origin`; treat an absent header
   as a non-browser caller so command-line use of §10 continues to work.

## 14.1 Request List

```text
┌────────────────────────────────────────────────────┐
│ Request Tester                         [Clear All]  │
├────────────────────────────────────────────────────┤
│                                                    │
│ Captured Requests                                  │
│                                                    │
│ Time                 Method     URL                │
│ ────────────────────────────────────────────────── │
│ 13:30:25             PUT        /listen/report/1    │
│ 13:29:51             POST       /listen/report     │
│ 13:28:04             GET        /listen/report/1   │
│                                                    │
│              < Previous  1  2  3  Next >           │
└────────────────────────────────────────────────────┘
```

## 14.2 Request Detail

```text
┌────────────────────────────────────────────────────┐
│ PUT /listen/report/1                               │
│ 2026-09-10 13:30:25                                │
├────────────────────────────────────────────────────┤
│                                                    │
│ Headers                                            │
│ Content-Type: application/json                     │
│ Authorization: Bearer abc123                       │
│                                                    │
│ Query Parameters                                   │
│ debug = true                                       │
│                                                    │
│ Body                                               │
│ {                                                  │
│   "name": "Monthly Report",                        │
│   "status": "completed"                            │
│ }                                                  │
└────────────────────────────────────────────────────┘
```

---

# 15. Non-Functional Requirements

## 15.1 Simplicity

The implementation shall prioritize a minimal architecture.

No service, repository, queue, worker, or abstraction layer shall be introduced unless it provides a concrete benefit to the MVP.

## 15.2 Data Retention

There shall be no automatic retention mechanism.

Request records remain in the database until manually deleted.

## 15.3 Request Size **[v1.1]**

The application shall not impose an arbitrary request-body size restriction.

Any limits imposed by the web server, reverse proxy, framework, PHP runtime, Node.js runtime, or infrastructure are outside the application-level specification.

> **Amendment 5 — a configurable limit is unavoidable.** The original "no limit" wording is
> not implementable as written. Body parsers ship with their own default — `express.raw`
> caps at **100kb** — so an implementation that sets nothing does not get "unlimited", it
> gets 100kb. The limit must be set explicitly to be raised.
>
> A genuinely unbounded body also means unbounded memory per request, which is a
> denial-of-service vector on a service with no rate limiting (§2.2).
>
> Implementations shall therefore expose the limit as configuration (`MAX_BODY_SIZE`,
> default `50mb`) and document the value. Exceeding it returns **HTTP 413**, not a silent
> truncation — see §16.

## 15.4 Performance

The system is intended primarily for development and integration testing.

The MVP does not require:

* horizontal scaling
* distributed processing
* message queues
* caching
* background workers

---

# 16. Error Handling

## Successful Capture

If the request is successfully persisted:

```http
HTTP/1.1 200 OK
```

Example:

```json
{
    "status": "OK"
}
```

## Persistence Failure

If the request cannot be persisted:

```http
HTTP/1.1 500 Internal Server Error
```

The system shall not return HTTP 200 when it knows that the request was not successfully recorded.

## Payload Too Large **[v1.1]**

> **Amendment 6.** The listener previously defined only 200 and 500, leaving the
> oversized-body outcome undefined. A body exceeding `MAX_BODY_SIZE` (§15.3) is rejected by
> the body parser *before* the handler runs, so nothing is recorded — and returning a
> generic 500 would wrongly suggest a server fault the caller cannot act on.

If the request body exceeds the configured limit:

```http
HTTP/1.1 413 Payload Too Large
```

```json
{
    "status": "TOO_LARGE"
}
```

No record is created. The caller shall be told explicitly rather than left to infer that the
capture was dropped.

## Error Responses Shall Not Leak Internals **[v1.1]**

> **Amendment 6b.** Express's built-in error handler writes the **full stack trace,
> including absolute filesystem paths**, into the response body when `NODE_ENV` is not
> `production`. Verified.

Implementations shall register an error handler that logs the fault server-side and returns
a generic response. No response shall contain a stack trace, filesystem path, or database
error text.

---

# 17. Acceptance Criteria

## Listen

* [ ] `GET /listen` is accepted.
* [ ] `POST /listen` is accepted.
* [ ] `PUT /listen/report/1` is accepted.
* [ ] `PATCH /listen/report/1` is accepted.
* [ ] `DELETE /listen/report/1` is accepted.
* [ ] Arbitrary paths under `/listen` are accepted.
* [ ] Successfully captured requests return HTTP 200.
* [ ] **[v1.1]** A malformed payload is captured verbatim, not rejected.
* [ ] **[v1.1]** A body over `MAX_BODY_SIZE` returns HTTP 413 and records nothing.

## Record

* [ ] Every successfully received request creates one database record.
* [ ] HTTP method is recorded.
* [ ] URL is recorded.
* [ ] Headers are recorded.
* [ ] Query parameters are recorded.
* [ ] Request body is recorded.
* [ ] Timestamp is recorded.
* [ ] Multiple requests create separate records.
* [ ] **[v1.1]** Headers are stored in array form, identically in both implementations.
* [ ] **[v1.1]** A binary payload round-trips without loss.

## Show

* [ ] Captured requests are displayed in the dashboard.
* [ ] Records are displayed newest first.
* [ ] Pagination is supported.
* [ ] Individual request details can be viewed.
* [ ] Headers can be inspected.
* [ ] Query parameters can be inspected.
* [ ] Body can be inspected.
* [ ] Individual records can be deleted.
* [ ] All records can be deleted.
* [ ] **[v1.1]** Script tags in captured headers and bodies render escaped, not executed.
* [ ] **[v1.1]** No response contains a stack trace or filesystem path.
* [ ] **[v1.1]** The raw body response carries `X-Content-Type-Options: nosniff`.

## Deployment **[v1.1]**

* [ ] The service binds to loopback by default.
* [ ] Binding to all interfaces requires explicit configuration and warns.
* [ ] A cross-origin delete request is rejected and destroys no data.
* [ ] Command-line delete requests continue to work.

---

# 18. Implementation Structure

## Laravel

Suggested minimal structure:

```text
app/
├── Http/
│   └── Controllers/
│       └── RequestController.php
│
└── Models/
    └── RequestLog.php

database/
└── migrations/
    └── xxxx_create_requests_table.php

resources/
└── views/
    └── requests/
        ├── index.blade.php
        └── show.blade.php

routes/
└── web.php
```

## Node.js

Suggested minimal structure:

```text
src/
├── controllers/
│   └── requestController.js
│
├── models/
│   └── request.js
│
├── routes/
│   └── requestRoutes.js
│
└── views/
    ├── requests/
    │   ├── index
    │   └── show
    └── ...
```

The exact structure may vary depending on the selected Node.js framework.

---

# 19. Core Architecture

The implementation should follow this simple architecture:

```text
                    ┌──────────────────┐
                    │  External System │
                    └────────┬─────────┘
                             │
                             │ HTTP
                             ▼
                    ┌──────────────────┐
                    │  Listen Handler  │
                    │   /listen/*      │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │  Request Record  │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │    requests      │
                    │     table        │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │    Dashboard     │
                    ├──────────────────┤
                    │ Request List     │
                    │ Request Detail   │
                    │ Delete           │
                    └──────────────────┘
```

---

# 20. MVP Definition

The MVP is complete when the following workflow works end-to-end:

```text
1. External system sends:

   POST https://<request-tester>/listen/report/1

2. Request Tester receives the request.

3. Request Tester records:

   Method
   URL
   Headers
   Query
   Body
   Timestamp

4. Request Tester returns:

   HTTP 200

5. User opens the dashboard.

6. User sees the captured request.

7. User opens the request.

8. User can inspect the complete request.

9. User can delete the request.
```

The MVP therefore remains intentionally limited to:

> **Listen → Record → Show**

No API mocking, request matching, response configuration, or integration simulation is required for version 1.
