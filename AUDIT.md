# Chirp Refactoring Audit

> Consolidated per-issue audit of problems found and fixes applied across the whole
> refactoring assessment. Each issue owns its own top-level section; append new sections
> rather than editing existing ones so parallel work merges cleanly.

| Issue | Title | Status |
|---|---|---|
| 1 | The Credential Problem | Fixed + tested (legacy-path sunset deferred) |
| 2 | The Query Performance Problem (N+1) | Fixed + tested |
| 3 | Error Handling & Observability | Fixed + tested |
| 5 | Build Pipeline & Developer Experience | Fixed + verified (pre-existing lint/test debt surfaced, deferred) |

---

## Issue 1 — The Credential Problem

**Date:** 2026-09-25 · **Areas:** `apps/api`, `apps/client-user`, `apps/client-admin`,
`packages/grpc-client`, `packages/db-schema`
**Full spec:** [docs/security/issue-1-credential-problem.md](docs/security/issue-1-credential-problem.md)
_(originally recorded in `docs/security/AUDIT.md`; consolidated here.)_

Two independent vulnerabilities: how credentials are **stored**, and how the client and API
**establish trust**.

### 1a. Credential storage — Critical

**Found:** `apps/api/src/services/utils.ts` hashed passwords with `sha256(password + "salt")`
and compared with `===`. Three defects: (1) SHA-256 is a fast hash, not a password KDF, so
offline brute-force is cheap; (2) the salt is the static shared string `"salt"`, so identical
passwords collide and one rainbow table cracks everyone; (3) non-constant-time comparison.
A leaked `users` table can be cracked at scale and fuels credential-stuffing elsewhere.

**Fix:** moved to **bcrypt** (`bcryptjs`, cost 12) with **rehash-on-login incremental
migration** — no plaintext needed for seeded users. Legacy hashes are detected by prefix
(bcrypt starts with `$2`; legacy rows are bare hex), verified via the retained SHA-256 path
with `crypto.timingSafeEqual`, and transparently upgraded to bcrypt on the user's next
successful login. New registrations use bcrypt directly.
**Deferred (future):** after a grace period, drain remaining legacy accounts via password-reset
email / reset-at-login, then delete the SHA-256 path.

### 1b. Trust establishment — Critical

**Found:** client app servers and the API trusted each other via a JWT signed with a **shared
HMAC secret** that defaulted, silently, to a hardcoded string in source
(`chirp-grpc-jwt-secret-key-at-least-32-chars`) in `middleware/auth.ts` and both clients'
`grpc.server.ts`. Anyone with that secret can forge an `admin` token. Worse, the API trusted
the token's `role` claim verbatim (`validateSessionToken` → `requireAdmin`) instead of checking
the authoritative `users.role` column. Transport was also `createInsecure()` with client TLS
gated on `NODE_ENV`.

**Fix (A + B):**
- **A. Real secret + fail-closed:** removed the hardcoded fallback in all three files, exit at
  startup if `GRPC_JWT_SECRET` is unset/short, rotate the leaked value, document the env var.
- **B. Verify role server-side:** `requireAdmin`/`requireSuperAdmin` resolve the real role from
  the DB by `userId` (JWT proves identity, DB decides authority). Also fixed an exposed
  authorization bug — `updateUserRole` was gated by `requireAdmin` (moderators pass), letting a
  moderator self-promote to admin; role changes / user deletion now require `requireSuperAdmin`,
  all 13 `requireAdmin` call sites were audited into moderator-OK vs admin-only, and a guard was
  added so an admin cannot change their own role.
**Out of scope (future):** Option C — asymmetric keys (RS256/ES256) or mTLS with always-on TLS.

### Status
Implemented with tests (2026-09-25). API test suite passes, including coverage for bcrypt
hashing, legacy→bcrypt migration on login, JWT-secret fail-closed behaviour, DB-verified role
checks, and the moderator→admin / self-role-change guards. Dependency added: `bcryptjs`.

---

## Issue 2 — Query Performance (N+1)

### Problem

Multiple read paths enriched a list of rows by issuing extra queries **per row**
(the N+1 anti-pattern). Cost grew with result-set size, not data volume, and
`Promise.all` around the per-row work hid it in review without reducing the number
of SQL statements (SQLite/better-sqlite-style libsql serializes them anyway). The
per-post enrichment `getPostCounts` was copy-pasted **four times**.

### Fix

Introduced batch enrichment helpers in `apps/api/src/services/enrichment.ts`
(`attachPostCounts`, `attachCommentLikeInfo`, `attachUserContentCounts`). Each takes
an **array** and runs a fixed, small number of `IN (...)` + `GROUP BY` queries plus
an in-memory merge, so query count is constant regardless of list length. Two admin
username lookups were plain missing joins and became `leftJoin`s. All responses are
byte-for-byte identical (same fields, order, `|| 0` / `"Unknown"` fallbacks, null
filtering, `isLiked`/`isFollowing` semantics).

### Before / after query counts

| Operation | File | Before | After |
|---|---|---|---|
| Home feed (10 posts) | `services/feed.service.ts` `getHomeFeed` | 32 | 5 |
| Explore feed (10 posts) | `services/feed.service.ts` `getExploreFeed` | 31 | 3 |
| Bookmarks (10 posts) | `services/bookmarks.service.ts` `getBookmarkedPosts` | 41 | 5 |
| Profile — posts list (10) | `services/posts.service.ts` `getUserPosts` | 32 | 4 |
| Post list (10) | `services/posts.service.ts` `getPosts` | 31 | 4 |
| Search posts (50 results) | `services/search.service.ts` `searchPosts` | 151 | 4 |
| Post comments (10 top + 10 replies) | `services/comments.service.ts` `getPostComments` | 91 | 4 |
| Admin list users (20) | `services/admin.service.ts` `listUsers` | 42 | 4 |
| Admin list reports (20) | `services/admin.service.ts` `listReports` | 22 | 2 |
| Admin audit logs (50) | `services/admin.service.ts` `getAuditLogs` | 52 | 2 |
| Notifications (20) | `services/notifications.service.ts` `getUserNotifications` | ≤41 | 3 |

Counts are `fixed + (per-row × N)` before, and constant (flat as N grows) after.
`getPost` (single row) is unchanged in behaviour and routed through the same helper.
`getUser` (profile header) was already a fixed 5 queries (not N+1) and left as-is.

### Regression protection

- New per-endpoint **query-count tests** (`tests/query-counter.ts` wraps the libsql
  client and counts round-trips) assert the counts stay flat as N grows — these fail
  immediately if a per-row query is reintroduced.
- New **behavioural tests** for the previously-untested `feed`, `bookmarks`, `search`,
  `notifications`, and `admin` services lock the response shape.
- The `attach*` helpers are the single documented path for list enrichment. (Biome has
  no arbitrary AST-selector lint rule, so the query-count tests are the enforcement.)

### Verification

`pnpm --filter @chirp/api test` — 170 passing (138 pre-existing + 32 new).

_Design rationale and rejected alternatives: see `ISSUE-2-QUERY-PERFORMANCE.md`._

---

## Issue 3 — Error Handling & Observability

**Date:** 2026-09-25 · **Areas:** `apps/api` (`grpc/handlers`, `grpc/wrap.ts`, `errors/`,
`observability/`, `middleware/`), `packages/proto`

### Problem

The API handled failures four different, inconsistent ways, and had effectively no
production observability.

**Error-handling strategies found (same failure class surfaced four ways):**

- **A — try/catch → `{ success:false, error }` payload, status OK** (most mutations). The
  transport reports success while the call failed; the error is an opaque English string with
  no machine-readable code, so clients can't distinguish "not found" from "unauthorized" from
  "server error", and metrics/alerts keyed on gRPC status are blind.
- **B — try/catch → re-throw generic `Error`** (`auth.getCurrentUser`). Crosses the wire as
  `UNKNOWN`/`INTERNAL`, stack lost; an expired token looks identical to a server crash.
- **C — swallow → default** (status/count reads). Two flavours: legitimate public-access token
  degradation, and a dangerous blanket `catch {}` that turns a DB outage into "nothing is
  liked / zero followers / no notifications" with **no log line at all**.
- **D — no try/catch; raw propagation** (`feed.getHomeFeed`, admin reads). Auth/authorization
  denials and raw ORM errors both surface as `UNKNOWN`, leaking internals and conflating 401/403
  with 500.

**Observability gap:** only startup `console.log`s. No per-request logging, no correlation/trace
IDs, no structured output — so a user report can't be tied to a request, one request can't be
followed across the handler→service boundary, and swallowed failures leave no trail.

### Fix

Unified taxonomy + a single boundary that also carries tracing and logging.

- **Error taxonomy** (`errors/`): `AppError` hierarchy whose codes equal gRPC status names, so
  translation is a direct lookup. `classifyError` maps typed errors by code and the remaining
  plain-`Error` service throws via a message registry (transitional bridge); unrecognized →
  `INTERNAL`, masked on the wire while the real detail is logged.
- **Boundary wrapper** (`grpc/wrap.ts`): every handler method is wrapped once. It mints/propagates
  a trace id, returns it to the client via **response trailers** (`x-trace-id`) — out-of-band, so
  no response contract changes — emits structured start/finish/duration logs, and maps any uncaught
  error to the correct gRPC status via `RpcError` (no more blanket `UNKNOWN`).
- **Request tracing** (`observability/`): `AsyncLocalStorage` propagates `{traceId, method, userId}`
  through handler→service with **no function-signature changes**; a JSON-to-stdout logger enriches
  every line with that context.
- **Contract preservation:** the `{ success, error }` shape and exact `error` strings (incl.
  per-method fallbacks) are unchanged; the public-access token-swallowing is now an explicit
  `middleware/optional-auth.ts` (same behaviour, now logged); blanket swallow-reads keep their
  defaults but log real faults via `logSwallowed`.
- **Machine-readable code:** added optional `error_code` to all 20 payload response messages in
  `packages/proto` (regenerated) — additive, so existing clients/tests are unaffected.

This merges cleanly with Issue 1: `requireAdmin`/`requireSuperAdmin` (now async, DB-verified)
throw typed `PermissionError`s that the boundary maps to `PERMISSION_DENIED`.

### Error taxonomy → gRPC status

| `AppErrorCode` | gRPC status | Example sources |
|---|---|---|
| `UNAUTHENTICATED` | 16 | invalid/expired token, auth required |
| `PERMISSION_DENIED` | 7 | admin/super-admin required, "your own posts", account banned |
| `NOT_FOUND` | 5 | user/post/comment/report/notification not found |
| `ALREADY_EXISTS` | 6 | username taken, email already exists |
| `INVALID_ARGUMENT` | 3 | content required / >280 chars, invalid role/credentials |
| `FAILED_PRECONDITION` | 9 | edit window expired, reply-to-reply, cannot ban admin |
| `INTERNAL` | 13 | anything unrecognized (message masked on the wire) |

### Verification

`pnpm --filter @chirp/api test` — 222 passing. New tests cover the taxonomy, `classifyError`,
gRPC mapping, `AsyncLocalStorage` propagation, the JSON logger, the boundary wrapper (status
mapping + trace-id trailers), and `resolveOptionalAuth`. Existing handler/service suites and the
Issue 1/2 suites pass unchanged.

---

## Issue 5 — Build Pipeline & Developer Experience

**Date:** 2026-09-25 · **Areas:** `turbo.json`, `.github/workflows`, `.husky`, `package.json`,
`scripts`, root config
**Full spec:** [SETUP.md](SETUP.md) (developer setup guide)

There was no CI, no pre-commit validation, no Node pinning, and the Turbo build graph had
codegen-ordering and cache-correctness gaps. Below is the audit and what was fixed.

### 5a. Turbo build-graph & cache correctness

| Finding | Severity | Concrete failure | Fix |
|---|---|---|---|
| `@chirp/proto#typecheck` didn't depend on `proto:generate` | High | proto's generated output is git-ignored; a clean `pnpm typecheck` fails at `@chirp/proto` before consumers run | `@chirp/proto#typecheck` `dependsOn: ["proto:generate"]` |
| Client route-tree codegen not ordered | High | `routeTree.gen.ts` is git-ignored and only emitted by `vite build`; clean client `typecheck` fails (`Cannot find module './routeTree.gen'`). Was masked by a stale on-disk file | client `typecheck` `dependsOn: ["build"]`; `src/routeTree.gen.ts` added to `build` outputs so cache-restore brings it back |
| `db:migrate` / `db:seed` / `db:generate` were cacheable (`{}`) | High | side-effecting DB ops cached a "success" → migrations/seeds **silently skipped** on cache hit | `cache: false` on all three |
| No `env` on test tasks | Medium | `test:*` pass/fail cached without the env that determined it → stale green | `env: [DATABASE_URL, GRPC_JWT_SECRET, GRPC_PORT, GRPC_API_HOST, HTTP_PORT, SESSION_SECRET]` on `test`/`test:unit`/`test:integration`/`test:e2e` |
| No `globalDependencies` / `globalEnv` | Medium | editing `biome.json` or shared tsconfigs didn't bust caches | `globalDependencies: [biome.json, shared tsconfigs]`, `globalEnv: [NODE_ENV, CI]` |
| `lint` depended on `^build` | Medium | every lint built the whole upstream graph; slow; can't lint a clean checkout | removed `dependsOn` (Biome is syntactic) |
| `@chirp/api#build` declared `dist/**` outputs but `tsc` emits nothing (base `noEmit`; api runs via `tsx`) | Low | `WARNING no output files found`; build never caches | `@chirp/api#build` `outputs: []` |
| `proto:generate` had no `inputs` | Low | cache key didn't track `.proto` sources | `inputs: ["protos/**/*.proto"]` |
| `.env.example` swallowed by `.gitignore` (`.env.*`) | Low | example env file would never be committed | added `!.env.example` negation |

### 5b. CI pipeline (was: none)

Added [.github/workflows/ci.yml](.github/workflows/ci.yml): validates every PR to `main` with
`deps (frozen lockfile) → proto codegen → typecheck → lint → unit test → build`. **Fail-fast**
via a single `turbo run` (Turbo's `--continue` defaults off). **Affected-only** rebuilds via
`--filter=...[origin/main]` (changed packages **and their dependents**), with `fetch-depth: 0`
so the base ref is diffable. Local `.turbo` cache + optional remote cache (`TURBO_TOKEN`/
`TURBO_TEAM`). Node pinned from `.nvmrc`; pnpm from `packageManager`. No DB service needed (DB is
SQLite); dummy secrets satisfy import-time env reads.

### 5c. Pre-commit / pre-push hooks (was: none)

Husky v9, auto-installed via the `prepare` script:
- [.husky/pre-commit](.husky/pre-commit): `lint-staged` runs Biome on **staged files only** — fast.
- [.husky/pre-push](.husky/pre-push): `turbo run typecheck lint --filter=...[origin/main]` — the
  slower, type-aware gate runs once before sharing, not on every commit.

### 5d. Developer experience

- **Node pinning:** added [.nvmrc](.nvmrc) (20.18.1) + `engines` (was: only `packageManager` pinned).
- **E2E orchestration:** replaced the fragile root `test:e2e` shell one-liner (no health-check
  timeout → infinite hang; `kill $API_PID` orphaned the real `tsx` child) with
  [scripts/e2e.sh](scripts/e2e.sh) — bounded health wait, `pkill -P` child cleanup, `trap` teardown.
- **Onboarding:** [.env.example](.env.example) documents required env vars (`DATABASE_URL`,
  `GRPC_JWT_SECRET`, `GRPC_PORT`, `GRPC_API_HOST`, `HTTP_PORT`, `SESSION_SECRET`); [SETUP.md](SETUP.md)
  is a <50-line setup guide (prereqs, install, codegen, DB, run, test).

### Verification

On a wiped checkout (generated proto + route trees + `.turbo` removed): `pnpm typecheck` 12/12 ✅,
`pnpm lint` runs with **0 builds** ✅, `pnpm build` clean with no warnings ✅, and deleting
`routeTree.gen.ts` then re-running `typecheck` hits `FULL TURBO` and restores it (cache-correctness) ✅.

### Deferred — pre-existing debt the new pipeline now surfaces

Not introduced by this work; the pipeline correctly flags it, left for follow-ups:
- **18 pre-existing Biome lint errors** in app code (`FollowButton.tsx`, `apps/api/tests/setup.ts`,
  several gRPC handlers, `middleware/auth.ts`).
- **`@chirp/client-admin` unit test fails** — `auth.test.ts` can't resolve `@tanstack/react-start`
  (a Vitest config gap: it imports server code Vitest isn't set up to transform). `client-user` passes.

Until these are addressed, CI will report failures on `lint` and `client-admin` `test:unit`.
