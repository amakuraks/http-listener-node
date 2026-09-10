# `pkill` doesn't exist in Git Bash on Windows — stale servers survive and serve old code

**Date:** 2026-09-10
**Category:** tooling
**Severity:** Medium — sends you debugging a bug that was already fixed

---

## Symptom

`POST /requests/:id` with `_method=DELETE` returned **404** against the running dev server,
while the identical request in the test suite **passed**. Reproduced with both `curl` and
`fetch`, so it was not a client quirk. Same source file, same code path, opposite results.

Roughly twenty minutes went into theories that were all wrong:

- duplicate `Content-Type` from `curl -d` plus an explicit `-H` (disproved: only one sent)
- `curl` vs `fetch` differences (disproved: both 404)
- the CSRF guard interfering (disproved: it returns 403, never 404)

## Cause

Every cleanup step had been:

```bash
pkill -f "src/server.ts"
```

**`pkill` is not available in this Git Bash.** It failed with `command not found` — but the
message was buried in output that was being filtered, and the exit status was swallowed by
`;`. So the command was a silent no-op, every time.

Five `node.exe` processes were still running. Port 3000 was held by a server started
**before** the `methodOverride` fix. Each "restart" logged `listening on 3000` from a
process that never actually bound, while requests kept reaching the stale one.

The test suite passed because it starts its own server in-process on port 0 — it never
touched the zombie.

## Fix

Use `taskkill` on Windows, and verify the port is actually free before trusting a restart:

```bash
taskkill //F //IM node.exe //T 2>/dev/null    # note: // is Git Bash's escape for /
sleep 2
curl -s -m 2 -o /dev/null -w "%{http_code}\n" http://localhost:3000/ || echo "free"
```

To kill only this project's server rather than every Node process:

```bash
netstat -ano | grep ":3000.*LISTENING"        # last column is the PID
taskkill //F //PID <pid>
```

## Prevention

1. **Never assume a kill worked.** Confirm the port is free before starting a replacement.
2. **A "listening" log line does not prove the new process is serving traffic.** If the port
   is taken, the new process should fail to bind — but if it crashes and an older one keeps
   serving, the log still looks healthy at a glance.
3. **Prefer a fresh port over killing.** Binding to `PORT=0` and reading the assigned port,
   the way the test suite does, sidesteps the whole class of problem.
4. **When tests and a manual run disagree, suspect the environment before the code.** The
   test suite is usually the more trustworthy of the two: it builds its own world from
   scratch every run.

## Lesson

The bug had already been fixed and committed. Everything after that point was debugging a
process that no longer matched the source on disk.

When a manual check contradicts a passing test, verify **which build is actually answering**
before forming any theory about the code.
