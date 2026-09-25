# Chirp — Security Audit Log

A single running record of security issues found during the refactoring assessment, the
decisions taken, and their status. One entry per issue. Detailed specs live in sibling files
(linked per entry).

| Issue | Title | Status | Detail |
|---|---|---|---|
| 1 | The Credential Problem | **Fixed + tested** (sunset step deferred) | [issue-1-credential-problem.md](./issue-1-credential-problem.md) |

---

## Issue 1 — The Credential Problem

**Date:** 2026-09-25 · **Areas:** `apps/api`, `apps/client-user`, `apps/client-admin`,
`packages/grpc-client`, `packages/db-schema`
**Full spec:** [issue-1-credential-problem.md](./issue-1-credential-problem.md)

Two independent vulnerabilities: how credentials are **stored**, and how the client and API
**establish trust**.

### 1a. Credential storage — **Critical**

**Found:** `apps/api/src/services/utils.ts` hashes passwords with `sha256(password + "salt")`
and compares with `===`. Three defects: (1) SHA-256 is a fast hash, not a password KDF, so
offline brute-force is cheap; (2) the salt is the static shared string `"salt"`, so identical
passwords collide and one rainbow table cracks everyone; (3) non-constant-time comparison.
A leaked `users` table can be cracked at scale and fuels credential-stuffing elsewhere.

**Decision:** move to **bcrypt** (`bcryptjs`, cost 12) with **rehash-on-login incremental
migration** — no plaintext needed for seeded users. Legacy hashes are detected by prefix
(bcrypt starts with `$2`; legacy rows are bare hex), verified via the retained SHA-256 path
with `crypto.timingSafeEqual`, and transparently upgraded to bcrypt on the user's next
successful login. New registrations use bcrypt directly.

**Scope now:** bcrypt + rehash-on-login.
**Future only (not now):** after a few-months grace period, drain remaining legacy accounts
via password-reset email or a reset-at-login prompt, then delete the SHA-256 path.

### 1b. Trust establishment — **Critical**

**Found:** client app servers and the API trust each other via a JWT signed with a **shared
HMAC secret** that defaults, silently, to a hardcoded string in source
(`chirp-grpc-jwt-secret-key-at-least-32-chars`) in `middleware/auth.ts` and both clients'
`grpc.server.ts`. Anyone with that secret can forge an `admin` token. Worse, the API trusts
the token's `role` claim verbatim (`validateSessionToken` → `requireAdmin`) instead of
checking the authoritative `users.role` column. Transport is also `createInsecure()` with
client TLS gated on `NODE_ENV`.

**Decision — implement A + B:**
- **A. Real secret + fail-closed:** remove the hardcoded fallback in all three files, exit at
  startup if `GRPC_JWT_SECRET` is unset/short, rotate the leaked value, document the env var.
- **B. Verify role server-side:** make `requireAdmin`/`requireSuperAdmin` resolve the real
  role from the DB by `userId` (JWT proves identity, DB decides authority); stop branching on
  the claim. **Plus** correct an authorization-design bug this exposes: `updateUserRole` is
  gated by `requireAdmin`, which passes moderators too, so a *genuine* moderator can promote
  themselves to admin. Fix by gating role changes / user deletion with `requireSuperAdmin`
  (admin-only), auditing all 13 `requireAdmin` call sites into moderator-OK vs admin-only, and
  adding guardrails (no self-role-change; can't grant a role above your own).

**Out of scope (future hardening):** Option C — asymmetric keys (RS256/ES256) or mTLS with
always-on TLS. Documented only.

### Tests (planned, per assessment)

- Legacy seeded user still logs in; hash upgrades to bcrypt on login; new registrations are
  bcrypt.
- Startup fails without a real `GRPC_JWT_SECRET`; a token signed with the old default is
  rejected once a real secret is set.
- A token whose `role` claim doesn't match the DB is rejected; a genuine moderator calling
  `updateUserRole` (self→admin) is rejected by `requireSuperAdmin`; self-role-change is
  rejected.

### Status

**Implemented with tests** (2026-09-25). All 158 API tests pass, including new coverage for
bcrypt hashing, legacy→bcrypt migration on login, JWT-secret fail-closed behavior, DB-verified
role checks, and the moderator→admin / self-role-change guards.

Changed: `apps/api` (`services/utils.ts`, `services/auth.service.ts`, `services/admin.service.ts`,
`middleware/auth.ts`, `grpc/server.ts`, `grpc/handlers/admin.handler.ts`, `db/seed.ts`,
`.env.example`, plus test/setup helpers), and the client secret handling in
`apps/client-user` and `apps/client-admin`. Dependency added: `bcryptjs`.

**Deferred (future):** the legacy-path sunset (email reset / reset-at-login) and Option C
(asymmetric keys / mTLS + always-on TLS).

Pre-existing, unrelated: `pnpm --filter @chirp/api typecheck` reports errors from the
un-generated `@chirp/proto` package (concrete service exports missing); this is not caused by
these changes.
