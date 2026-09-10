# Use Case Registry — Request Tester

**Last scanned:** 2026-09-10
**Source of truth:** [plan](plans/2026-09-10-http-listener-mvp-plan.md) · [spec](spec-driven-document.md)
**Status:** Pre-implementation

> ⚠️ **Coverage: 0 of 0 source files scanned — no code exists yet.**
> This registry was derived from the approved plan and spec, not from a codebase scan.
> It records **intended** behaviour. Re-run `/usecase` after `/work` to verify each entry
> against real routes, controllers and tests.

---

## Listening

| # | Use Case | Route | Expected Outcome |
|---|---|---|---|
| L1 | External system sends request to listener | `ANY /listen{/*splat}` | `200` `{"status":"OK"}`, one row created |
| L2 | External system sends oversized payload | `ANY /listen{/*splat}` | `413` `{"status":"TOO_LARGE"}`, **nothing recorded** |

**Notes**

- L1 accepts every HTTP method and any path depth under `/listen` (spec §3.1).
- L1 must capture **malformed** payloads verbatim — this is the tool's primary purpose, not
  an edge case.
- L1 must capture **binary** payloads losslessly (base64, `body_encoding`).
- L2 exists only because `MAX_BODY_SIZE` is a documented deviation from spec §15.3. It was
  discovered during `/gate` (#G2) and is absent from the spec — see spec amendment 7.
- A persistence failure returns `500` `{"status":"ERROR"}`, never `200` (spec §16).

---

## Inspection

| # | Use Case | Route | Expected Outcome |
|---|---|---|---|
| I1 | Operator views captured request list | `GET /requests` | Rows newest first, body column never loaded |
| I2 | Operator paginates captured request list | `GET /requests?page=N` | Page clamped; non-numeric and out-of-range accepted |
| I3 | Operator views captured request detail | `GET /requests/:id` | Method, URL, timestamp, headers, query, body |
| I4 | Operator views raw captured body | `GET /requests/:id/body` | Raw bytes, `X-Content-Type-Options: nosniff` |

**Notes**

- I1 and I3 render attacker-controlled data. Escaping (`<%= %>`) plus CSP are **security
  requirements of these use cases**, not implementation detail.
- I3 renders in three tiers: inline, collapsed behind "Show more", or deferred to I4 when the
  body exceeds `BODY_INLINE_MAX`.
- I3 includes cURL reconstruction (Enhancement #2) and JSON pretty-printing (Enhancement #5).
- I4 exists so a large body is never shipped into the browser wholesale.

---

## Deletion

| # | Use Case | Route | Expected Outcome |
|---|---|---|---|
| D1 | Operator deletes single captured request | `DELETE /requests/:id` | Row gone; idempotent on repeat |
| D2 | Operator deletes all captured requests | `DELETE /requests` | Table emptied |

**Notes**

- Both are reached from the browser via `POST` + `_method` override, and directly via
  `DELETE` for API/curl use (spec §10).
- Both are guarded against cross-site invocation (#O5). A cross-origin delete returns `403`
  and **must not** destroy data.
- D2 is confirm-guarded in the UI via `data-confirm`. That guard is delivered by
  `/assets/app.js` — if the script fails to load, the confirmation silently disappears.
- Deletion is permanent. There is no soft delete or undo (spec §2.2).

---

## Operations

| # | Use Case | Mechanism | Expected Outcome |
|---|---|---|---|
| O1 | Operator restricts network exposure | `HOST` env var | Loopback by default; all-interfaces warns loudly |
| O2 | Operator purges captured data for retention | Manual **Clear All** | Storage reclaimed; retention obligation met |

**Notes**

- These are operator procedures rather than code paths, so a code scan will not detect them.
  They are recorded here deliberately: both are the *only* controls standing behind the two
  accepted risks, and an unrecorded control is one that gets quietly dropped.
- **O1 backs AR-1** (captured credentials in cleartext). If the service is exposed beyond
  loopback, that acceptance is void — authentication and TLS become prerequisites.
- **O2 backs AR-2** (unbounded storage growth). There is no automatic retention by design
  (spec §15.2), so this manual step is the entire retention policy.

---

## Traceability

| Use Case | Test coverage |
|---|---|
| L1 | `tests/listen.test.ts` — methods, nested paths, field capture, malformed, binary |
| L2 | `tests/hardening.test.ts` — `#G2` (conditional on `MAX_BODY_SIZE`) |
| I1, I2 | `tests/dashboard.test.ts` — ordering, pagination, clamping |
| I3 | `tests/dashboard.test.ts` — detail fields, XSS escaping |
| I4 | `tests/dashboard.test.ts` — nosniff header |
| D1, D2 | `tests/dashboard.test.ts` + `tests/hardening.test.ts` — `#O5` cross-site rejection |
| O1 | `tests/hardening.test.ts` — `#O1` bind address |
| O2 | Not automated — manual procedure |

---

## Change Log

| Date | Change |
|---|---|
| 2026-09-10 | Registry created from plan. 10 use cases, all NEW. L2, O1 and O2 originated from `/gate` findings and appear in no earlier document. |
