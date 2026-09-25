# Security Audit & Spec — Issue 1: The Credential Problem

**Status:** Implemented with tests (2026-09-25). Sunset step (Part 1) deferred; Option C deferred.
**Date:** 2026-09-25
**Scope:** `apps/api` (credential storage + JWT trust), `apps/client-user`, `apps/client-admin`.

This document records two vulnerabilities, the decisions made, and the spec that was
implemented. See [AUDIT.md](./AUDIT.md) for the running status log.

---

## Part 1 — Credential Storage Vulnerability

### The vulnerability

`apps/api/src/services/utils.ts` hashes passwords with a fast general-purpose digest
and a static shared salt:

```ts
const hash = createHash("sha256");
hash.update(password + "salt"); // static salt shared by every user
return hash.digest("hex");
```

Three compounding defects:

1. **Wrong algorithm class.** SHA-256 is fast by design. Password hashing needs a
   deliberately slow / memory-hard KDF (bcrypt, scrypt, Argon2). Fast hashing makes
   offline brute-force / dictionary attacks cheap on commodity GPUs.
2. **Static, shared salt (`"salt"`).** Effectively no salt: identical passwords produce
   identical hashes (leaking password reuse), and a single precomputed rainbow table
   built for the constant salt cracks all users at once. The salt is also in source, so
   it is not secret.
3. **Non-constant-time comparison.** `verifyPassword` uses `hash === hashedPassword`,
   which short-circuits on the first differing byte. Lowest-severity of the three here,
   but not best practice for comparing secrets.

**Exploitation:** an attacker who obtains the `users` table (leaked backup, SQLi
elsewhere, host/insider compromise) can crack millions of rows offline in
minutes-to-hours, reveal password reuse, and credential-stuff recovered passwords
against users' other services.

**Severity: Critical.** Affects every stored credential, cheap fully-offline attack (no
rate limiting helps once the DB leaks), blast radius extends to users' other accounts,
at "millions of accounts" scale.

### Decision

Adopt **bcrypt** (cost 12) with **rehash-on-login incremental migration**. bcrypt is the
lowest-risk, ubiquitous choice and has the simplest migration story. Argon2id is the
theoretically stronger option if we later accept the native dependency and memory tuning;
not chosen now.

Library: **`bcryptjs`** (pure-JS, no native build step — fits this pnpm/Turborepo workspace
cleanly and avoids post-install compilation). It produces standard `$2` bcrypt hashes and its
`compare` is constant-time, so defect (3) is resolved for free.

**Scope split (per product decision):**
- **Implement now:** bcrypt hashing + rehash-on-login migration (sections below).
- **Future only:** the legacy-path sunset (email reset / reset-at-login). Not implemented now.

### Spec — implement now: bcrypt + rehash-on-login

Add dependency `bcryptjs` to `apps/api/package.json`.

1. **Replace the hashing primitives** in `apps/api/src/services/utils.ts`:
   - `hashPassword(password)` → `bcrypt.hash(password, 12)` (per-hash random salt is built in).
   - `verifyPassword(password, storedHash)` → **dispatch on the stored hash's format**
     (see step 3). Must transparently accept both legacy and bcrypt hashes.
2. **Detect legacy hashes by prefix — no DB tag migration needed.** bcrypt hashes always
   start with `$2` (`$2a$`/`$2b$`/`$2y$`); the seeded rows are plain 64-char hex SHA-256 with
   no `$`. So a hash that does **not** start with `$2` is legacy. This avoids touching
   existing rows at all — backwards-compatible with the DB as it stands.
3. **`verifyPassword` dispatch:**
   - Stored hash starts with `$2` → `bcrypt.compare(password, storedHash)`.
   - Otherwise (legacy) → recompute `sha256(password + "salt")` and compare with
     `crypto.timingSafeEqual` (constant-time; fixes the old `===` too).
   - Keep the old SHA-256 logic as a retained internal helper (e.g. `legacyHashPassword`)
     used only by this verify branch — do **not** export it as the primary `hashPassword`.
4. **Rehash on successful login** in `apps/api/src/services/auth.service.ts` (`loginUser`):
   after `verifyPassword` returns true, if the stored hash was legacy (does not start with
   `$2`), compute `bcrypt.hash(input.password, 12)` and `UPDATE users.passwordHash` for that
   user. We hold the plaintext only for that instant; the user notices nothing.
5. **New registrations use bcrypt from day one** — `registerUser` already calls
   `hashPassword`, so switching the primitive covers it with no further change.
6. **Seed data (`apps/api/src/db/seed.ts`).** It currently calls `hashPassword`, so after the
   switch fresh seeds would be bcrypt and would *not* exercise the legacy path. To keep the
   migration testable, seed via the retained `legacyHashPassword` helper (or a seed flag) so
   seeded users start as legacy SHA-256 and get upgraded on first login — mirroring the real
   "existing seeded users we have no plaintext for" scenario.

This is incremental (users migrate as they naturally log in), backwards-compatible (old
hashes keep working until upgraded), and needs no recoverable plaintext for seeded users.

### Future only — sunset of the legacy path (NOT now)

After the migration has run for a **grace period of a few months**, any accounts still on the
legacy SHA-256 scheme are inactive users who never logged back in. To drain them and delete
the old code path, use one of (they can be combined):

- **Email-driven reset:** send a password-reset email to remaining legacy accounts so they
  set a new (bcrypt) password via the reset flow.
- **Reset-at-login prompt:** when a remaining legacy user next logs in, require them to set a
  new password at that moment, which writes a bcrypt hash.

Once no legacy rows remain, **delete the `legacyHashPassword` helper and the SHA-256 verify
branch** entirely. This whole section is future work and is **out of scope for the current
implementation.**

### Options considered (for the record)

| Option | Security | Complexity | Perf / Ops |
|---|---|---|---|
| **bcrypt (chosen)** | Strong, battle-tested, built-in per-hash salt | Low | ~50–100ms/verify, 72-byte input cap, no memory-hardness |
| Argon2id | Strongest (memory-hard) | Low–medium (native dep, tuning) | Higher CPU + RAM per verify |
| scrypt (Node built-in) | Strong, memory-hard | Medium (manage salt storage) | Tunable, no extra dependency |

---

## Part 2 — Trust Establishment Vulnerability

### The vulnerability

The client app servers and the API authenticate to each other with a JWT signed by a
**shared HMAC secret**, with three overlapping problems:

1. **Hardcoded default secret.** Both sides fall back to the same literal string
   `"chirp-grpc-jwt-secret-key-at-least-32-chars"` when `GRPC_JWT_SECRET` is unset
   (`apps/api/src/middleware/auth.ts`, `apps/client-user/src/lib/grpc.server.ts`, and the
   admin equivalent). The secret is in the public source tree and is a *silent* default —
   nothing fails if the env var is missing. Anyone who knows it can forge a valid session
   JWT for any `userId`/`username`/`role`, including `admin`, and call privileged API
   handlers directly.
2. **`role` is asserted by the client, not verified by the API.** The client signs the
   token with `role` from its cookie session; `validateSessionToken` trusts `decoded.role`
   verbatim and feeds it into `requireAdmin`/`requireSuperAdmin`. Authority is decided
   outside the API's trust boundary and never re-checked against the DB.
3. **Insecure transport.** The gRPC server always binds with
   `ServerCredentials.createInsecure()`; the client only uses TLS when
   `NODE_ENV === "production"`. JWTs can be sniffed/replayed on the client↔API path.

**Abuse:** with the known default secret, an attacker who can reach the gRPC port forges an
`admin` token and invokes admin handlers — no login, no client app, no valid account.

### Decision

Implement **Option A + Option B** as the fix.

- **A — Enforce a real secret + fail-closed** closes the *forgery* strand (the hardcoded
  default secret).
- **B — Verify `role` server-side against the DB** closes the *misplaced-trust* strand (the
  API trusting a client-asserted `role`). A alone does not fix this: even with a strong
  secret, a compromised client or a wrong session role would still grant admin, because the
  API never checks the authoritative `role` column. B is what makes the trust fix complete.

**Option C (asymmetric keys / mTLS + always-on TLS) is out of scope** for Issue 1 — it is
defense-in-depth and infrastructure hardening (PKI/cert lifecycle, larger architectural
change), and the transport concern is largely handled at the deployment layer. Recorded as
future hardening only.

### Spec — Option A (real secret + fail-closed)

1. **Remove the hardcoded fallback** in all three locations:
   - `apps/api/src/middleware/auth.ts`
   - `apps/client-user/src/lib/grpc.server.ts`
   - `apps/client-admin/src/lib/grpc.server.ts`
   Read `GRPC_JWT_SECRET` with no default string.
2. **Fail closed on startup.** If `GRPC_JWT_SECRET` is unset or shorter than 32 chars, the
   process must throw/exit at startup rather than run on a known secret.
3. **Rotate the leaked value.** Treat the committed default as compromised; generate a new
   strong secret and set it via real secrets management in every environment.
4. **Document the env var** as required (README / env example) so deployments fail fast
   instead of silently.

### Spec — Option B (verify `role` server-side)

**Principle:** the JWT proves *identity* (`userId`); the API decides *authority* by reading
`role` from the DB (`users` table, `packages/db-schema/src/schema.ts` — the authoritative
column). The `role` claim in the token becomes untrusted.

Current flow in `apps/api/src/grpc/handlers/admin.handler.ts` (13 call sites):

```ts
const auth = validateSessionToken(request.sessionToken); // role = client's claim
requireAdmin(auth);                                       // checks the claim, never the DB
```

Planned changes:

1. **Make the authority checks DB-backed and async** in `apps/api/src/middleware/auth.ts`.
   `requireAdmin` / `requireSuperAdmin` resolve the real role by `userId`:

   ```ts
   // conceptual
   export async function requireAdmin(auth: AuthContext): Promise<void> {
     const user = await db
       .select({ role: users.role, bannedAt: users.bannedAt })
       .from(users)
       .where(eq(users.id, auth.userId))
       .get();

     if (!user || user.bannedAt) throw new Error("Admin access required");
     if (user.role !== "admin" && user.role !== "moderator") {
       throw new Error("Admin access required");
     }
   }
   ```

   `requireSuperAdmin` likewise requires `user.role === "admin"`. This also evaluates
   banned/promoted/demoted state live, not against a stale 5-minute token.
2. **Update call sites.** Each `requireAdmin(auth)` / `requireSuperAdmin(auth)` in
   `admin.handler.ts` becomes `await requireAdmin(auth)` (handlers are already `async`).
3. **Stop trusting `decoded.role` for authorization.** `validateSessionToken` may still
   extract `role` for logging/convenience, but no security decision branches on it.
4. **Client-admin session role check** (`apps/client-admin/src/lib/session.server.ts`) may
   stay for UX (what to render) but is no longer a security boundary — the API is.
5. **Correct the guard on privileged mutations (moderator → admin escalation).** DB-verifying
   the role is *not enough on its own*: `requireAdmin` intentionally passes **both** `admin`
   and `moderator`, and `updateUserRole` (`admin.handler.ts:137`) is gated only by
   `requireAdmin`. So a *genuine* moderator — who passes the DB check legitimately — can call
   `updateUserRole(userId: <self>, role: "admin")` and promote themselves. This is an
   authorization-design bug distinct from the role-trust bug, and it must be fixed as part of
   Option B:
   - **Gate role changes (and user deletion) with `requireSuperAdmin` (admin-only)**, not
     `requireAdmin`. At minimum `updateUserRole`; review `deleteUser` similarly.
   - **Audit all 13 `requireAdmin` call sites** in `admin.handler.ts` and split them into
     *moderator-OK* (e.g. view users, delete a post) vs *admin-only* (change roles, delete
     users). Today moderators get the entire admin surface, which is too broad.
   - **Guardrail in the `updateUserRole` service (shipped):** reject changing one's own
     role (`userId === adminId`), so an admin can't foot-gun themselves.
   - *(Not shipped — unnecessary today.)* A "can't grant a role higher than your own" check
     was considered but omitted: the endpoint is admin-only via `requireSuperAdmin`, and
     `admin` is already the highest role, so there is no higher role to grant. Revisit only
     if a role above `admin` is ever introduced.

**Trade-off:** one extra indexed `SELECT` per privileged call. Admin ops are low-frequency,
so no caching is needed now; a short-TTL `userId → role` cache is the escape hatch if it
ever matters.

*Alternative considered (not chosen): drop `role` from the token entirely so identity and
authority are fully separated. Cleaner, but touches token creation on both clients and
`packages/shared-types`; the DB-backed-check approach gets the same guarantee with a smaller
blast radius.*

### Future hardening (out of scope, recorded for later)

- **Option C — asymmetric / mTLS.** Sign client→API tokens with RS256/ES256 (API verifies
  with a public key and cannot mint tokens; no shared secret to leak), and/or require mutual
  TLS. Bind the server with TLS credentials instead of `createInsecure()`, and stop gating
  client TLS on `NODE_ENV`.

---

## Tests (part of this commit)

Tests for **every change** below ship in the **same commit** as the change — not deferred.
For each vulnerability, tests prove the fix behaves correctly (and, where practical, that the
old behavior was unsafe):

- **Credential storage:** a legacy SHA-256 seeded user can still log in after the change;
  after login the stored hash is upgraded to bcrypt (`$2b$`); new registrations store
  bcrypt; a bcrypt hash of a known password verifies and a wrong password fails.
- **Trust establishment (A):** startup fails when `GRPC_JWT_SECRET` is unset/short; a token
  signed with the old default secret is rejected once a real secret is configured.
- **Trust establishment (B):** a validly-signed token whose `role: "admin"` claim does not
  match the DB is **rejected** by `requireAdmin` (privilege escalation blocked); a user whose
  DB role is `admin`/`moderator` passes; a banned user is rejected even with a valid token.
- **Trust establishment (B — mutation guard):** a genuine **moderator** calling
  `updateUserRole` (e.g. to set their own role to `admin`) is **rejected** by
  `requireSuperAdmin`; an `admin` calling it succeeds; an admin attempting to change their
  *own* role is rejected by the self-role-change guardrail.

---

## Implementation note

When implemented, do this as **two separate commits** — one for credential storage, one for
trust establishment — since they are independent concerns.
