# A size guard is only as strong as its *least* guarded consumer

**Date:** 2026-09-10
**Category:** correctness
**Severity:** P1 — memory exhaustion, triggerable by any external caller

---

## What was wrong

The request detail page renders a captured body in three tiers: inline, collapsed behind a
toggle, or — above `BODY_INLINE_MAX` — not sent to the browser at all, with a link to a raw
endpoint instead.

The controller implemented that correctly:

```ts
const displayBody = isBinary || tooLarge ? '' : (prettyJson(body, ct) ?? body);
```

Then, forty lines later, it rendered a "Copy as cURL" block from the **same body variable**,
which had never been blanked:

```ts
curl: toCurl({ ..., body, ... })   // full body, every time
```

The page said *"too large to display inline"* and shipped the payload anyway.

## Why it mattered

Verified with a 200KB body against a 131072-byte limit:

```
detail page says     : TOO LARGE (correct)
detail page HTML size: 206760 bytes
contains the payload : YES - body leaked into page
```

At the configured `MAX_BODY_SIZE=50mb`, opening one detail page would build and transmit a
**50MB HTML document**. Any external system could plant that payload, because the capture
endpoint accepts arbitrary input by design. After the fix: **2026 bytes**.

## Why the tests missed it

This is the instructive half.

`.env.testing` set `MAX_BODY_SIZE=1kb` — deliberately, so the oversized-body test would
exercise a real 413 instead of passing vacuously. But the display thresholds were left at
production values:

| Setting | Test value | Needed to reach the tier |
|---|---|---|
| `MAX_BODY_SIZE` | 1024 B | — |
| `BODY_PREVIEW_CHARS` | 2000 B | > 2000 B — **impossible** |
| `BODY_INLINE_MAX` | 131072 B | > 131072 B — **impossible** |

No test body could exceed 1024 bytes, so **two of the three display tiers were unreachable**.
The suite reported full green over a code path it could not execute.

A change made to *strengthen* one test silently disabled coverage of a neighbouring feature.

## Fix

1. Blank the body for every consumer, not just the visible one, and give the placeholder
   real information:

   ```ts
   const inlineable = !isBinary && !tooLarge && record.bodySize > 0;
   const body = inlineable ? await loadBody(id) : '';   // never loaded when not shown
   curl: toCurl({ ..., body, bodyOmitted: !inlineable, bodySize: record.bodySize })
   ```

2. Scale test thresholds **together**, so the relationships between them survive:
   `MAX_BODY_SIZE=1kb`, `BODY_PREVIEW_CHARS=50`, `BODY_INLINE_MAX=200`.

3. Add a regression assertion that checks for *absence*, at both levels:

   ```ts
   assert.ok(!html.includes('C'.repeat(210)), 'body leaked into the page');
   assert.ok(!command.includes('ZZZ'), 'an omitted body must never be inlined');
   ```

## Lessons

1. **A guarded value needs guarding at every consumer.** Blanking a variable for the branch
   you are thinking about does nothing for the one further down the function. Prefer never
   loading the expensive value over remembering to skip it three times.
2. **Limits are a system of related numbers.** Changing one in a test environment without the
   others does not make the tests stricter — it can make whole branches unreachable while the
   suite still reports green.
3. **Test absence, not just presence.** Every assertion here was of the form "the page says
   TOO LARGE", which was true the whole time. Nothing asserted the payload was *gone*.
4. **A green suite proves the paths it runs.** After lowering any limit, confirm which
   branches remain reachable.

## Related

- [heredoc-backslash-mangling.md](../tooling/heredoc-backslash-mangling.md) — the other case
  in this project where a test passed against broken code.
