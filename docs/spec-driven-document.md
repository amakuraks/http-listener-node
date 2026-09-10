# Request Tester

## Spec-Driven Development (SDD)

**Version:** 1.0
**Status:** MVP
**Implementation:** Laravel / Node.js

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

## 5.1 `requests`

```text
requests
────────────────────────
id
method
url
headers
query
body
created_at
updated_at
```

Recommended types:

| Column       | Type            |
| ------------ | --------------- |
| `id`         | BIGINT / UUID   |
| `method`     | VARCHAR         |
| `url`        | TEXT            |
| `headers`    | JSON            |
| `query`      | JSON            |
| `body`       | TEXT / LONGTEXT |
| `created_at` | TIMESTAMP       |
| `updated_at` | TIMESTAMP       |

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

## 12.2 Conceptual Express Implementation

```javascript
app.all('/listen', captureRequest);
app.all('/listen/*', captureRequest);
```

The handler shall:

1. Read the incoming request.
2. Capture all required request information.
3. Create a database record.
4. Return HTTP 200.

Conceptually:

```javascript
async function captureRequest(req, res) {
    await Request.create({
        method: req.method,
        url: req.originalUrl,
        headers: req.headers,
        query: req.query,
        body: req.body,
        created_at: new Date()
    });

    res.status(200).json({
        status: 'OK'
    });
}
```

The actual implementation must ensure that the body is captured correctly for different content types.

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

## 15.3 Request Size

The application shall not implement its own request-body size restriction.

Any limits imposed by the web server, reverse proxy, framework, PHP runtime, Node.js runtime, or infrastructure are outside the application-level specification.

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

## Record

* [ ] Every successfully received request creates one database record.
* [ ] HTTP method is recorded.
* [ ] URL is recorded.
* [ ] Headers are recorded.
* [ ] Query parameters are recorded.
* [ ] Request body is recorded.
* [ ] Timestamp is recorded.
* [ ] Multiple requests create separate records.

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
