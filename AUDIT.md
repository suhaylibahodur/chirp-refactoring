# Chirp Refactoring Audit

> Consolidated per-issue audit of problems found and fixes applied across the whole
> refactoring assessment. Each issue owns its own top-level section; append new sections
> rather than editing existing ones so parallel work merges cleanly.

| Issue | Title | Status |
|---|---|---|
| 1 | The Credential Problem | Fixed + tested (legacy-path sunset deferred) |
| 2 | The Query Performance Problem (N+1) | Fixed + tested |

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
