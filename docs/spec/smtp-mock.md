# SMTP Mock — Spec-Driven Development Document

**Project:** Testing Tools
**Feature:** SMTP Mock / SMTP Listener
**Status:** MVP Specification
**Technology:** Node.js
**Related Feature:** Existing HTTP Request Listener

---

# 1. Purpose

The SMTP Mock provides an SMTP endpoint that allows internal systems and applications to send test emails without delivering them to real recipients.

Emails sent to the SMTP Mock are captured, associated with a configured inbox, stored as records, and displayed through a web dashboard.

The feature is intended for:

* Development
* Integration testing
* QA testing
* Troubleshooting email generation
* Inspecting email metadata and content

The SMTP Mock is not intended to deliver email to external recipients.

---

# 2. Product Context

The SMTP Mock is part of the broader Testing Tools platform.

The platform follows the general pattern:

```text
Listener
   ↓
Receive data
   ↓
Record
   ↓
Display records
```

The existing HTTP Request Listener follows this model.

The SMTP Mock extends the platform with:

```text
SMTP Listener
   ↓
Receive email
   ↓
Associate with inbox
   ↓
Record email
   ↓
Display email
```

Future listener types may be added without fundamentally changing the dashboard.

---

# 3. Technology

The MVP uses Node.js as the application platform.

Node.js is responsible for:

* Web frontend
* Web/API server
* SMTP server
* SMTP authentication
* TLS
* MIME processing
* Persistence
* Inbox management

A browser accesses the dashboard directly through the Node.js application.

```text
Browser
   │
   │ HTTP
   ▼
Node.js Application
   │
   ├── Web UI
   ├── REST API
   ├── SMTP Listener
   ├── Message Processing
   └── Database
```

The implementation SHOULD keep the SMTP functionality separated from the web application internally.

---

# 4. Goals

## 4.1 MVP Goals

The SMTP Mock MUST:

1. Listen for SMTP connections.
2. Support ports:

   * 25
   * 587
   * 2525
3. Support SMTP authentication.
4. Associate one SMTP credential with exactly one inbox.
5. Support STARTTLS.
6. Support an internally trusted/self-signed TLS certificate.
7. Receive email messages.
8. Store received email information.
9. Display received emails through the web dashboard.
10. Display useful email metadata.
11. Support text and HTML email bodies.
12. Identify attachments.
13. Display attachment metadata.
14. Store attachment contents when implementation effort is low.
15. Allow inbox deletion.
16. Allow email deletion.
17. Support pagination.
18. Enforce a reasonable maximum SMTP message size.

---

# 5. Non-Goals

The following are outside MVP scope.

## 5.1 Administrative Authentication

The administration interface does not require:

* Admin login
* Admin roles
* Admin permissions
* User management
* RBAC

Administrative authentication/authorization may be added later.

## 5.2 Email Delivery

The SMTP Mock MUST NOT relay received messages to external recipients.

It is a sink/mock server.

```text
Application
    ↓
SMTP Mock
    ↓
Store
    ↓
Display
```

It MUST NOT behave as an external mail relay.

## 5.3 SMTP Port 465

Implicit TLS / SMTPS on port 465 is not required for MVP.

## 5.4 Advanced SMTP Features

The following are not required for MVP:

* SMTPUTF8
* Advanced SMTP extensions
* External SMTP delivery
* SMTP relay
* DKIM
* SPF processing
* DMARC processing
* Advanced mail routing

---

# 6. High-Level Architecture

```text
                         Testing Tools
                              │
                 ┌────────────┴────────────┐
                 │                         │
          HTTP Listener              SMTP Listener
                 │                         │
                 └────────────┬────────────┘
                              │
                         Node.js App
                              │
                 ┌────────────┼────────────┐
                 │            │            │
                 ▼            ▼            ▼
              Web UI        REST API    Persistence
                 │                         │
                 └────────────┬────────────┘
                              ▼
                           Database
```

The HTTP Listener and SMTP Listener are protocol-specific components within the same Testing Tools application.

---

# 7. Node.js Application Responsibilities

Node.js MUST provide:

### Web application

* Dashboard
* Inbox management
* Email listing
* Email detail
* Delete operations
* Pagination
* API

### SMTP service

* SMTP protocol
* SMTP authentication
* STARTTLS
* TLS certificates
* SMTP envelope processing
* MIME parsing
* Message-size enforcement
* Email persistence

---

# 8. Suggested Node.js Structure

The implementation SHOULD separate protocol and application concerns.

Example:

```text
src/
│
├── server/
│   ├── web-server.js
│   └── smtp-server.js
│
├── http/
│   └── listener/
│
├── smtp/
│   ├── authentication.js
│   ├── message-parser.js
│   ├── envelope.js
│   └── tls.js
│
├── api/
│   ├── inboxes.js
│   └── emails.js
│
├── web/
│   ├── pages/
│   ├── components/
│   └── assets/
│
├── database/
│   ├── models/
│   └── migrations/
│
├── services/
│
└── config/
```

The exact framework can be selected during implementation.

A lightweight Node.js web framework such as Express or Fastify MAY be used.

For the frontend, server-rendered HTML is sufficient for MVP. A separate React/Vue frontend is not required unless already used by the existing HTTP Listener.

---

# 9. SMTP Endpoints

The SMTP Mock MUST listen on:

| Port | Protocol                      | TLS      |
| ---- | ----------------------------- | -------- |
| 25   | SMTP                          | STARTTLS |
| 587  | SMTP Submission               | STARTTLS |
| 2525 | SMTP Submission / Alternative | STARTTLS |

Port 465 is excluded from MVP.

---

# 10. TLS Requirements

The MVP MUST support STARTTLS.

Expected flow:

```text
Client
  │
  │ Connect
  ▼
SMTP Server
  │
  │ EHLO
  ▼
SMTP Server
  │
  │ STARTTLS
  ▼
TLS handshake
  │
  ▼
Encrypted SMTP connection
  │
  │ AUTH
  ▼
Authenticated session
```

SMTP authentication SHOULD occur after TLS has been established.

---

# 11. TLS Certificate

The MVP will use an internal/self-signed certificate.

Example hostname:

```text
smtp-mock.test.local
```

Example DNS/hosts entry:

```text
10.10.10.50 smtp-mock.test.local
```

The certificate MUST contain the SMTP hostname in its Subject Alternative Name (SAN).

Example:

```text
DNS:smtp-mock.test.local
```

Test systems SHOULD trust the self-signed certificate rather than disabling certificate validation.

---

# 12. Public Deployment

If the SMTP Mock is later exposed publicly:

* A publicly trusted TLS certificate SHOULD be used.
* The self-signed certificate SHOULD be replaced.
* SMTP authentication MUST remain enabled.
* Network-level access controls SHOULD be considered.
* The administration interface SHOULD preferably remain restricted.

Replacing the certificate MUST NOT require architectural changes to the SMTP feature.

---

# 13. SMTP Authentication

SMTP authentication is required independently from administrative authentication.

The SMTP client MUST authenticate before submitting a message.

Example:

```text
Username: application-a
Password: ********
```

The credential identifies the target inbox.

---

# 14. Credential-to-Inbox Relationship

An inbox MUST have exactly one SMTP credential.

A credential MUST map to exactly one inbox.

Example:

```text
application-a
      ↓
   Inbox A

application-b
      ↓
   Inbox B
```

Multiple credentials per inbox are outside MVP scope.

---

# 15. SMTP Password Storage

Because the password must be displayable through the dashboard, a one-way password hash alone is insufficient.

The password SHOULD therefore be encrypted at rest.

```text
Plain password
      ↓
Encryption
      ↓
Database
      ↓
Decryption when required
      ↓
Dashboard
```

The encryption key MUST NOT be stored alongside the encrypted password in the database.

Passwords MUST NOT appear in application logs.

---

# 16. Inbox Data Model

```text
SMTP Inbox
├── ID
├── Name
├── Username
├── Encrypted Password
├── Created At
└── Updated At
```

An inbox contains zero or more email records.

---

# 17. Email Data Model

An email record SHOULD contain:

```text
Email
├── ID
├── Inbox ID
│
├── Envelope
│   ├── MAIL FROM
│   └── RCPT TO
│
├── Headers
│   ├── From
│   ├── To
│   ├── CC
│   ├── Subject
│   ├── Date
│   ├── Message-ID
│   ├── Reply-To
│   └── Other headers
│
├── Body
│   ├── Text
│   └── HTML
│
├── Attachments
│
└── Metadata
    ├── Size
    └── Received At
```

---

# 18. SMTP Envelope

The SMTP envelope MUST be stored separately from email headers.

Example:

```text
MAIL FROM:<system@example.com>
RCPT TO:<test@example.com>
```

These values MUST NOT be assumed to be identical to:

```text
From:
To:
```

The system SHOULD therefore maintain:

```text
EnvelopeFrom
EnvelopeRecipients
```

separately from:

```text
From
To
CC
BCC
```

---

# 19. BCC

The system MUST preserve SMTP envelope recipients even when recipients do not appear in the email headers.

The SMTP envelope is authoritative for determining message recipients.

---

# 20. MIME / Email Parsing

The SMTP server SHOULD use an established MIME parsing library.

The system SHOULD extract:

* Headers
* Plain text body
* HTML body
* Attachments
* Attachment filenames
* Content types
* Attachment sizes

The raw email SHOULD be retained if practical.

Retaining the raw message is preferred because it provides a reliable debugging representation.

---

# 21. Attachments

## Required

The system MUST detect attachments and record:

```text
Filename
Content-Type
Size
```

The UI MUST display attachment metadata.

Example:

```text
Attachments

invoice.pdf    application/pdf    245 KB
report.xlsx    application/vnd... 82 KB
```

## Optional

If attachment binary storage is low effort with the selected MIME library, the actual attachment SHOULD be stored.

If not, only metadata is required.

Attachment storage MUST NOT block the MVP.

---

# 22. Email Size Limit

The SMTP server MUST enforce a maximum message size.

MVP default:

```text
25 MB
```

The limit applies to the complete SMTP message, including:

* Headers
* Body
* MIME structure
* Attachments

Messages exceeding the limit MUST be rejected.

The SMTP server SHOULD advertise the size through the SMTP `SIZE` extension if supported.

---

# 23. SMTP Message Flow

Successful flow:

```text
Client
  │
  │ Connect :587
  ▼
SMTP Server
  │
  │ EHLO
  ▼
SMTP Server
  │
  │ STARTTLS
  ▼
TLS
  │
  │ EHLO
  ▼
SMTP Server
  │
  │ AUTH
  ▼
Authentication
  │
  │ MAIL FROM
  ▼
Envelope
  │
  │ RCPT TO
  ▼
Recipients
  │
  │ DATA
  ▼
MIME message
  │
  ▼
Parse
  │
  ▼
Persist
  │
  ▼
250 OK
```

---

# 24. Inbox Routing

After authentication:

```text
SMTP username
      ↓
Credential lookup
      ↓
Inbox
      ↓
Receive message
      ↓
Store under Inbox ID
```

The authenticated credential determines the target inbox.

---

# 25. Email Persistence

The email MUST be persisted before the SMTP server reports successful acceptance.

```text
DATA
 ↓
Receive message
 ↓
Parse
 ↓
Persist
 ↓
250 Message accepted
```

The server MUST NOT report successful acceptance when persistence has failed.

---

# 26. Web Dashboard

The Node.js application MUST provide a web interface.

Example:

```text
http://testing-tools.internal
```

The dashboard SHOULD have:

```text
Dashboard
│
├── HTTP Listeners
│
├── SMTP
│   ├── Inboxes
│   └── Emails
│
└── Settings
```

The UI should be designed so future listener types can be added without redesigning the entire navigation model.

---

# 27. SMTP Inbox List

The dashboard MUST provide an inbox list.

Example:

```text
SMTP Inboxes

┌────────────────────────────────────────────┐
│ Name       Username       Emails           │
├────────────────────────────────────────────┤
│ App A      application-a  24               │
│ App B      application-b  12               │
│ App C      application-c   3               │
└────────────────────────────────────────────┘
```

The user SHOULD be able to:

* Create inbox
* View inbox
* View credentials
* Delete inbox

---

# 28. Create Inbox

The dashboard MUST allow creation of an inbox.

Required fields:

```text
Name
Username
Password
```

Username MUST be unique within the SMTP Mock.

A successful creation creates exactly one SMTP credential associated with the inbox.

---

# 29. Inbox Detail

The inbox detail page MUST display:

```text
Inbox: Application A

Username: application-a
Password: test-password

Emails: 24
```

The page MUST list received emails.

Recommended columns:

```text
Received
From
To
Subject
Size
```

---

# 30. Email Detail

The email detail page SHOULD display:

### Envelope

```text
MAIL FROM
RCPT TO
```

### Headers

```text
From
To
CC
BCC
Reply-To
Date
Message-ID
```

### Body

```text
Text
HTML
```

### Attachments

```text
Filename
Content Type
Size
```

### Metadata

```text
Received At
Message Size
```

---

# 31. Email Deletion

Users MUST be able to delete an individual email.

Deleting an email MUST also delete associated stored attachment data.

---

# 32. Inbox Deletion

Users MUST be able to delete an inbox.

Deleting an inbox MUST remove:

* Inbox
* SMTP credential
* Associated email records
* Associated stored attachments

The UI SHOULD require confirmation.

---

# 33. Clear Inbox

The dashboard SHOULD provide:

```text
Clear Inbox
```

This deletes all email records while preserving the inbox and credentials.

This is particularly useful for integration testing.

---

# 34. Pagination

Email lists MUST support pagination.

Example:

```text
1–50 of 382
```

The API SHOULD support:

```text
?page=1
&per_page=50
```

The default page size SHOULD be defined centrally.

---

# 35. Sorting

Email lists MUST default to:

```text
Received At DESC
```

Newest emails appear first.

---

# 36. Search

Basic search SHOULD be supported if implementation effort is low.

Potential searchable fields:

* Subject
* From
* To

Advanced full-text search is outside MVP scope.

---

# 37. REST API

The Node.js application SHOULD expose REST endpoints.

Conceptually:

```text
GET    /api/smtp/inboxes
POST   /api/smtp/inboxes
GET    /api/smtp/inboxes/:id
DELETE /api/smtp/inboxes/:id

GET    /api/smtp/inboxes/:id/emails
GET    /api/smtp/emails/:id
DELETE /api/smtp/emails/:id

DELETE /api/smtp/inboxes/:id/emails
```

The API naming SHOULD be aligned with the existing HTTP Listener API.

---

# 38. Listener Model

The SMTP Mock SHOULD use the common Listener concept already established for the Testing Tools platform.

Conceptually:

```text
Listener
├── ID
├── Name
├── Type = SMTP
├── Status
├── Configuration
└── Created At
```

SMTP configuration may contain:

```text
Ports
TLS configuration
Certificate configuration
Message size limit
```

---

# 39. Future Unified Listener Model

The architecture SHOULD support:

```text
Listeners
├── HTTP
├── SMTP
└── Future
```

Protocol-specific records remain separate:

```text
HTTP Listener
    ↓
HTTP Records

SMTP Listener
    ↓
SMTP Inboxes
    ↓
SMTP Records
```

Common listener management and dashboard infrastructure should be shared.

---

# 40. Security Requirements

Even without administrative authentication, the SMTP service MUST implement basic security controls.

### Required

* SMTP authentication
* TLS/STARTTLS support
* Password encryption at rest
* No password logging
* Message size limit
* No external SMTP relay
* No unnecessary exposure of SMTP credentials through APIs

### Recommended

* Restrict access through internal firewall/network rules
* Trust the internal certificate on test machines
* Run Node.js using a non-administrative OS account
* Restrict database access
* Protect encryption keys through environment variables or secret management

---

# 41. Internal DNS

The MVP is expected to use an internal hostname.

Example:

```text
smtp-mock.test.local
```

The hostname MUST resolve to the SMTP server.

Example:

```text
10.10.10.50 smtp-mock.test.local
```

The TLS certificate MUST correspond to the hostname used by SMTP clients.

---

# 42. Logging

The Node.js application SHOULD log:

```text
Connection established
Authentication success/failure
Message accepted
Message rejected
Message size exceeded
Parsing failure
Persistence failure
Connection closed
```

Logs MUST NOT contain:

* SMTP passwords
* Full email bodies by default
* Sensitive attachment contents

A message ID or internal record ID SHOULD be used to correlate SMTP activity with dashboard records.

---

# 43. Error Handling

The system MUST handle:

* Invalid credentials
* Invalid SMTP commands
* Invalid recipients
* TLS negotiation failure
* Message exceeding size limit
* MIME parsing failure
* Database failure
* Attachment storage failure
* Client disconnect during DATA
* Concurrent connections

A failed SMTP transaction MUST NOT leave a partially accepted email record.

---

# 44. Concurrency

The SMTP listener MUST support multiple simultaneous SMTP connections.

```text
Application A ──┐
Application B ──┤
Application C ──┼──► SMTP Listener
Application D ──┘
```

Each SMTP session MUST be independently handled.

---

# 45. Data Integrity

Each email MUST have a unique internal record ID.

Recommended identifiers:

```text
Internal Email ID
SMTP Message-ID
```

The SMTP `Message-ID` is optional and MUST NOT be used as the database primary identifier.

---

# 46. Retention

Unlimited retention is acceptable for MVP, subject to available storage.

Automatic retention policies are outside MVP scope.

Future options may include:

```text
Delete emails older than N days
Maximum emails per inbox
Maximum storage per inbox
```

---

# 47. Non-Functional Requirements

## Performance

The SMTP service SHOULD support multiple concurrent clients without blocking the web dashboard.

## Reliability

Successfully accepted messages MUST be persisted.

## Recoverability

Stored emails MUST remain available after Node.js service restart.

## Observability

SMTP processing errors MUST be visible in application logs.

## Maintainability

SMTP protocol implementation MUST remain separated from HTTP listener protocol logic.

---

# 48. Suggested Database Structure

```text
listeners
────────────────────
id
name
type
configuration
created_at
updated_at


smtp_inboxes
────────────────────
id
listener_id
name
username
encrypted_password
created_at
updated_at


smtp_emails
────────────────────
id
inbox_id

envelope_from
envelope_recipients

from
to
cc
bcc

subject
headers

text_body
html_body

raw_message

size
received_at

created_at
updated_at


smtp_attachments
────────────────────
id
email_id
filename
content_type
size
storage_path NULL
created_at
updated_at
```

`storage_path` may be null when attachment binary content is not stored.

---

# 49. SMTP Listener Configuration

Example:

```json
{
  "ports": [25, 587, 2525],
  "tls": {
    "enabled": true,
    "mode": "starttls"
  },
  "max_message_size": 26214400
}
```

Certificate and private-key locations SHOULD be supplied through secure application configuration rather than stored directly in the database.

---

# 50. Acceptance Criteria

## AC-01 — SMTP Connection

**Given** the SMTP server is running
**When** a client connects to port 25, 587, or 2525
**Then** the SMTP server accepts the connection.

## AC-02 — STARTTLS

**Given** an SMTP client connects
**When** the client issues `EHLO`
**Then** the server advertises STARTTLS.

**When** the client issues `STARTTLS`
**Then** the server establishes TLS.

## AC-03 — Authentication

**Given** a valid inbox credential
**When** the client authenticates
**Then** authentication succeeds.

**Given** an invalid credential
**When** the client authenticates
**Then** authentication fails and no message is accepted.

## AC-04 — Inbox Routing

**Given** credential `application-a` belongs to Inbox A
**When** an authenticated client sends an email
**Then** the email is stored under Inbox A.

## AC-05 — Email Persistence

**Given** a valid authenticated SMTP session
**When** the client submits a valid email
**Then** the email is persisted before successful SMTP acceptance is returned.

## AC-06 — Envelope Preservation

**Given** an SMTP message has a specific `MAIL FROM` and `RCPT TO`
**When** the message is stored
**Then** the SMTP envelope values are available independently of email headers.

## AC-07 — HTML Email

**Given** an email contains an HTML body
**When** the email is opened
**Then** the HTML body can be viewed.

## AC-08 — Text Email

**Given** an email contains a plain-text body
**When** the email is opened
**Then** the text body can be viewed.

## AC-09 — Attachments

**Given** an email contains attachments
**When** the email is received
**Then** attachment filenames, content types, and sizes are recorded.

If attachment storage is enabled, attachment content MUST be available for download.

## AC-10 — Maximum Message Size

**Given** the configured maximum is 25 MB
**When** a client attempts to submit a message larger than 25 MB
**Then** the SMTP server rejects the message.

## AC-11 — Email Deletion

**Given** an email exists
**When** the user deletes it
**Then** the email is no longer displayed.

Stored attachment content MUST also be removed.

## AC-12 — Inbox Deletion

**Given** an inbox exists
**When** the user deletes it
**Then** the inbox and its associated emails are deleted.

## AC-13 — Pagination

**Given** an inbox contains more emails than the configured page size
**When** the inbox is opened
**Then** emails are displayed using pagination.

## AC-14 — Persistence Across Restart

**Given** an email has been successfully accepted
**When** the Node.js service is restarted
**Then** the email remains available.

## AC-15 — Concurrent Connections

**Given** multiple applications connect simultaneously
**When** each application submits an email
**Then** each email is independently processed and stored in the correct inbox.

---

# 51. Testing Strategy

## Unit Tests

Test:

* Credential lookup
* Inbox routing
* Email parsing
* Attachment parsing
* Message-size validation
* Data transformation
* Password encryption/decryption

## SMTP Integration Tests

Test:

* Port 25
* Port 587
* Port 2525
* STARTTLS
* Authentication
* Invalid credentials
* Multiple recipients
* BCC
* HTML email
* Plain text email
* Attachments
* Oversized email
* Multiple simultaneous clients

## Web/API Tests

Test:

* Inbox creation
* Inbox retrieval
* Inbox deletion
* Email listing
* Email detail
* Email deletion
* Clear inbox
* Pagination

## End-to-End Test

```text
Test Application
      │
      │ SMTP + STARTTLS
      ▼
SMTP Mock
      │
      ▼
Authenticate
      │
      ▼
Send email
      │
      ▼
Database
      │
      ▼
Node.js Web Dashboard
      │
      ▼
Email visible
```

---

# 52. Implementation Order

## Phase 1 — Platform Integration

1. Review the existing HTTP Listener.
2. Identify common Listener/Record infrastructure.
3. Preserve existing HTTP behavior.
4. Establish SMTP-specific module boundaries.
5. Move common web/API functionality into reusable Node.js components if necessary.

## Phase 2 — SMTP Server

1. Add Node.js SMTP server.
2. Add ports 25, 587, and 2525.
3. Implement SMTP authentication.
4. Implement inbox lookup.
5. Implement STARTTLS.
6. Configure internal certificate.
7. Add message-size limit.

## Phase 3 — Message Processing

1. Receive SMTP DATA.
2. Parse MIME.
3. Extract headers.
4. Extract text body.
5. Extract HTML body.
6. Extract attachment metadata.
7. Optionally persist attachment content.
8. Persist email.

## Phase 4 — Web Dashboard

1. Inbox list.
2. Create inbox.
3. Inbox detail.
4. Credential display.
5. Email list.
6. Email detail.
7. Delete email.
8. Delete inbox.
9. Clear inbox.
10. Pagination.

## Phase 5 — Testing

1. SMTP protocol tests.
2. TLS tests.
3. Authentication tests.
4. MIME tests.
5. Attachment tests.
6. Persistence tests.
7. Concurrent connection tests.
8. API tests.
9. End-to-end tests.

---

# 53. Future Extensions

The architecture SHOULD leave room for:

* Port 465 / implicit TLS
* Public CA certificates
* Admin authentication
* Multiple credentials per inbox
* Email search
* Retention policies
* Attachment preview
* Raw MIME viewer
* Email source viewer
* Email export
* Inbox sharing
* API access
* Webhooks
* SMTP delivery simulation
* Additional listener types

Potential future architecture:

```text
Testing Tools
│
├── HTTP Listener
├── SMTP Listener
├── WebSocket Listener
├── TCP Listener
├── Webhook Listener
└── Future Listener
```

---

# 54. Final MVP Definition

The SMTP Mock MVP is complete when a developer can configure an application with:

```text
SMTP Host: smtp-mock.test.local
SMTP Port: 587
Security: STARTTLS
Username: application-a
Password: ********
```

send an email, and then open the Testing Tools dashboard to see:

```text
Inbox: Application A

Email
────────────────────────────────────
From: system@example.com
To: developer@example.com
Subject: Test Email
Received: 2026-09-11 09:30:12

Body:
Hello from the application.

Attachments:
invoice.pdf (245 KB)
```

The same Node.js application must continue supporting the existing HTTP Request Listener.

SMTP is implemented as another listener type within the Testing Tools platform rather than as a separate application.
