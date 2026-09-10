# Shell heredocs silently eat a backslash level — and same-source tests won't catch it

**Date:** 2026-09-10
**Category:** tooling
**Severity:** High — produces silently wrong output that tests confirm as correct

---

## Symptom

`src/lib/curl.ts` was written via a quoted shell heredoc (`<<'EOF'`), which should be
literal. One backslash level was consumed anyway. Two lines broke:

| Intended source | What landed in the file | Runtime effect |
|---|---|---|
| `` join(`'\\''`) `` | `` join(`'\''`) `` | Emits `'''` instead of `'\''` |
| `parts.join(' \\\n')` | `parts.join(' \\n')` | Literal `\n` text, not a newline |

The first is the dangerous one. POSIX single-quote escaping is *close, escaped quote,
reopen*:

```sh
'it'\''s fine'     # correct   -> it's fine
'it'''s fine'      # corrupted -> its fine     (apostrophe DELETED)
```

So the generated cURL command sent **different data than was captured** — in a tool whose
entire purpose is reproducing captured requests faithfully.

## Why the test didn't catch it

The unit test was written in the same heredoc, in the same commit:

```ts
assert.match(command, /'x-note: it'\''s fine'/);   // also lost a backslash
```

A broken expectation matched a broken implementation. **It passed.** The failure that
finally exposed the bug was an unrelated assertion in the same test:

```ts
assert.ok(!command.includes('host:'));   // fails: 'localhost:3000' contains 'host:'
```

Two independent bugs, and the accidental one was what surfaced the real one.

## Fix

**1. Never write escape-sensitive code through a shell heredoc.** Use the file-writing tool
directly. Only `curl.ts` was affected here — `config.ts`, `db.ts`, `headers.ts` and
`body.ts` contained no `\\` sequences and were fine.

**2. Make the literal unmistakable with `String.raw`:**

```ts
const ESCAPED_QUOTE = String.raw`'\''`;   // cannot be mangled by backslash counting
const LINE_CONTINUATION = ' \\\n';

function shellQuote(value: string): string {
  return `'${value.split("'").join(ESCAPED_QUOTE)}'`;
}
```

**3. Assert with `String.raw` too**, so the test cannot drift the same way:

```ts
assert.ok(command.includes(String.raw`-H 'x-note: it'\''s fine'`));
assert.ok(command.includes(' \\\n'), 'expected a real line continuation');
```

## Detection

Find every literal backslash in hand-written source before trusting it:

```bash
grep -rnF '\' src/ tests/
```

Use `-F`. A plain `grep -rn '\\'` gets mangled by the shell and silently reports nothing —
which is exactly how this hid the first time it was looked for.

## Lesson

**Print the actual output; do not infer it from the source.** Reading the code and counting
backslashes produced the wrong conclusion twice. One `console.log` of the generated string
settled it immediately:

```
curl -X POST \n  -H 'x-note: it'''s fine' \n  ...     <- both bugs visible at once
```

Escaping bugs are invisible to inspection and invisible to tests written alongside them.
They are only visible in output.

## Related

- Substring assertions need anchoring: `'host:'` also matches inside `'localhost:3000'`.
  Assert on the surrounding syntax (`-H 'host:`) rather than the bare token.
