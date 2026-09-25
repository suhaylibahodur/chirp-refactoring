# Issue 2 — The Query Performance Problem

**Status:** Implemented. All refactors, tests, and `AUDIT.md` landed on this branch.
**Scope:** Application-layer query pattern across `apps/api/src/services/*`. Not DB tuning.
**Author:** suhayli-bahodur

> Implementation note: the plan below was executed on a single branch (not three separate
> PRs). Shared helpers live in `apps/api/src/services/enrichment.ts`; query-count regression
> tests use `apps/api/tests/query-counter.ts`; before/after results are recorded in the root
> `AUDIT.md`. `pnpm --filter @chirp/api test` → 170 passing (138 pre-existing + 32 new).

---

## 1. Summary

Many read paths in the API enrich a list of rows by firing extra queries **per row**. This is the
**N+1 query anti-pattern**. Query load grows with the number of rows returned, not with data
volume, so it looks fine in dev and collapses the database under real traffic.

`Promise.all` is used around the per-row work, which hides the problem in code review but does not
fix it: it changes concurrency, not the number of SQL statements. On SQLite (better-sqlite3,
synchronous, single connection) the calls serialize anyway.

The assessment names three operations (home feed, bookmarks, profile). A sweep of the whole services
layer found the **same anti-pattern in 4 more services / 7 more call sites**. The core enrichment
`getPostCounts` is copy-pasted **four times** (`feed`, `posts`, `search`, plus open-coded in
`bookmarks`). This spec profiles every occurrence, states before/after query counts, picks a fix,
and lists the exact changes. It does **not** implement anything yet.

---

## 2. Anti-pattern

Every affected service has the shape:

```
list query  →  result.map(row => await perRowQueries(row))
```

- Load is a function of **result-set size**, not data size. A 10-row page costs the same whether the
  DB holds 10 rows or 10 billion — so indexes/DB tuning cannot fix it. It is an app-layer bug.
- Round-trip + statement-prep overhead dominates the trivial `count(*)`/lookup work, paid 30–150× per
  page view.
- `getUserPosts` has **no `LIMIT`** (`posts.service.ts:201`), so its per-row cost multiplies over a
  user's entire post history — unbounded.
- The enrichment logic is **duplicated**, so every new list endpoint reinvents it and reintroduces
  the bug.

---

## 3. Before — profiled query counts (authenticated user)

Formula: **fixed queries + (per-row queries × N)**.

### Primary (assessment) operations

| Operation | Source | Fixed | Per-row × N | **Total (N=10)** |
|---|---|---|---|---|
| Home feed (10 posts) | `feed.service.ts:42` | 2 | 3 × 10 | **32** |
| Bookmarks (10 posts) | `bookmarks.service.ts:56` | 1 | 4 × 10 | **41** |
| Profile page (10 posts) | `users.service.ts:13` + `posts.service.ts:194` | 7 | 3 × 10 | **37** |

- **Home feed = 2 + 3N.** 1 following-list + 1 feed SELECT, then per post: like count + comment count
  + isLiked = 3.
- **Bookmarks = 1 + 4N.** 1 bookmark-ID query, then per bookmark: post fetch + like count + comment
  count + isLiked = 4. Worst per-row cost — even the post body is fetched one row at a time.
- **Profile = getUser (5) + getUserPosts (2 + 3N).** Own-profile view skips `isFollowing` (→ 36).
  Unpaginated, so real cost is `7 + 3×(all posts)`.

### Additional occurrences found in the sweep

| Operation | Source | Before (typical) | Notes |
|---|---|---|---|
| `searchPosts` | `search.service.ts:36` | **151** (N=50) | 4th copy of `getPostCounts`; identical to feed |
| `getPostComments` | `comments.service.ts:93` | **~91** (T=10, R=3) | N+1 on comments **and** replies (two levels) |
| `listUsers` (admin) | `admin.service.ts:21` | **42** (N=20) | post count + comment count per user |
| `getUserNotifications` | `notifications.service.ts:43` | **up to 41** (N=20) | post + comment preview per notification |
| `listReports` (admin) | `admin.service.ts:242` | **22** (N=20) | reporter username per report — should be a JOIN |
| `getAuditLogs` (admin) | `admin.service.ts:394` | **52** (N=50) | admin username per log — should be a JOIN |

`getPostComments` per-row breakdown: `1 + T×(2 like-info + 1 replies) + (T×R)×2 like-info`.

---

## 4. After — target query counts

Fix collapses per-row queries into a **constant** number, independent of N.

| Operation | Before | **After** | Shape after |
|---|---|---|---|
| Home feed (10) | 32 | **5** | 1 following + 1 feed + 3 batch |
| Bookmarks (10) | 41 | **~5** | 1 IDs + 1 posts batch + 3 batch |
| Profile page (10) | 37 | **~9** | getUser 5 + getUserPosts (1 user + 1 posts + 3 batch) |
| `searchPosts` (50) | 151 | **~4** | 1 search + 3 batch |
| `getPostComments` | ~91 | **~4** | 1 top-level + 1 replies (batched) + like counts + viewer set |
| `listUsers` (20) | 42 | **~4** | 1 users + 1 postcounts + 1 commentcounts + 1 total |
| `getUserNotifications` (20) | ≤41 | **~3** | 1 notifs + 1 post previews + 1 comment previews |
| `listReports` (20) | 22 | **2** | 1 reports⋈users + 1 total |
| `getAuditLogs` (50) | 52 | **2** | 1 logs⋈users + 1 total |

All stay flat as N grows.

---

## 5. Recommended fix — batched `IN (...)` + in-memory merge

Chosen over JOIN+GROUP BY and correlated subqueries for the count-enrichment cases because it is the
easiest to prove **byte-for-byte identical** to today's output, has **no fan-out/double-count risk**
(each aggregate is its own query), handles the per-viewer flags with a trivial Set membership test,
and suits SQLite well. The two admin username-lookup cases are simpler still and become plain JOINs.

For a page of posts (viewer optional):

1. Collect `postIds` from the already-fetched list.
2. `SELECT postId, count(*) FROM likes    WHERE postId IN (:ids) GROUP BY postId` — 1 query.
3. `SELECT postId, count(*) FROM comments WHERE postId IN (:ids) GROUP BY postId` — 1 query.
4. If viewer present: `SELECT postId FROM likes WHERE userId = :viewer AND postId IN (:ids)` — 1
   query → build a `Set` for `isLiked`.
5. Merge into a `Map<postId, {likeCount, commentCount, isLiked}>`; default missing counts to `0`
   exactly as today's `|| 0`.

### Reusable utilities (the regression guard)

One **batch-only** helper family so the wrong thing (a per-row query) is no longer reachable. Each
takes an **array**, never a single id — so the natural call site is already batched and new endpoints
inherit the fix by copy-paste.

```ts
// apps/api/src/services/post-enrichment.ts  (new)
attachPostCounts<T extends { id: string }>(
  posts: T[],
  viewerId?: string,
): Promise<(T & { likeCount: number; commentCount: number; isLiked: boolean })[]>

// Sibling helpers for the other N+1 shapes (same technique, different table/column):
attachCommentLikeInfo<T extends { id: string }>(comments: T[], viewerId?: string): ...  // likes.commentId
attachUserContentCounts<T extends { id: string }>(users: T[]): ...                      // posts/comments per author
```

---

## 6. Alternatives considered (not chosen)

- **JOIN + GROUP BY:** 1 query total, but joining `likes` *and* `comments` fans out rows; requires
  `COUNT(DISTINCT …)` + a self-join for the viewer flag. Correct but easy to get subtly wrong.
- **Correlated subqueries / `EXISTS` in the SELECT:** 1 statement, clean per-viewer `EXISTS`, no
  fan-out. Good fallback; depends on indexes on `likes.postId` / `comments.postId`.
- **Denormalized counter columns:** O(1) reads but adds write-path complexity, drift risk, and a
  backfill; still can't store per-viewer flags. Over-engineered for this scope.

(Plain foreign-key lookups — `listReports`, `getAuditLogs` — are just missing JOINs, not a
count-enrichment problem, so they use a `leftJoin` rather than a batch helper.)

---

## 7. Plan — what I will do (on approval)

Analysis/refactor only; no schema or API-contract changes. Grouped so each PR stays provably
identical.

### PR 1 — Post-count N+1 (the primary fix + free extension)
1. **Add `apps/api/src/services/post-enrichment.ts`** with `attachPostCounts(posts, viewerId?)`
   (batched `IN (...)`, §5). Single source of truth.
2. **`feed.service.ts`** — replace `map → getPostCounts` in `getHomeFeed` and `getExploreFeed` with
   `attachPostCounts`. Delete the local `getPostCounts`.
3. **`posts.service.ts`** — same in `getPosts` and `getUserPosts`; route single-row `getPost` through
   the same helper (array of one). Delete the duplicated `getPostCounts`.
4. **`bookmarks.service.ts`** — batch-fetch bookmarked posts in one `posts.id IN (:ids)` query,
   preserve `bookmarkedAt` ordering, then `attachPostCounts`. Removes per-row post fetch **and** counts.
5. **`search.service.ts`** — replace `map → getPostCounts` in `searchPosts` with `attachPostCounts`.
   Delete the 4th copy of `getPostCounts`.

### PR 2 — Sibling N+1 shapes (fast-follow)
6. **`comments.service.ts`** — add `attachCommentLikeInfo`; batch the replies fetch for all top-level
   comments in one query; enrich all comments + replies with two batch queries. Delete
   `getCommentLikeInfo`.
7. **`admin.service.ts` `listUsers`** — add `attachUserContentCounts`; replace per-user post/comment
   counts with two batched `IN (...)` group-by queries.
8. **`notifications.service.ts` `getUserNotifications`** — batch post-content and comment-content
   previews with two `IN (...)` queries mapped back in memory.

### PR 3 — Missing JOINs (trivial, low-risk)
9. **`admin.service.ts` `listReports`** — `leftJoin(users)` for `reporterUsername`; drop the per-row
   lookup. Preserve the `"Unknown"` fallback for null.
10. **`admin.service.ts` `getAuditLogs`** — `leftJoin(users)` for `adminUsername`; same fallback.

### Cross-cutting (all PRs)
11. **Guarantee identical responses** — field names, ordering, `|| 0` / `"Unknown"` defaults,
    `isLiked`/`isFollowing` semantics, and null-row filtering all preserved. Diff responses against
    `main` on a seeded fixture before/after each change.
12. **Tests for every change (required).** Every service function we touch gets test coverage — no
    exceptions:
    - **Behavioural test** per touched endpoint asserting the response is unchanged (shape, ordering,
      counts, `isLiked`/`isFollowing`, `"Unknown"` fallbacks, null filtering) against a seeded DB.
      Covers previously-untested services too (`search`, `notifications`, `admin`, `bookmarks`).
    - **Query-count regression test** per touched endpoint asserting the §4 target counts, via a
      counting wrapper around the db (better-sqlite3 statement hook / proxy). This is the guard that
      fails the moment N+1 is reintroduced.
    - Tests live beside the service as `*.service.test.ts`, matching the existing convention.
13. **Enforcement of the pattern.** The repo lints with **Biome**, which has no arbitrary AST-selector
    rule (ESLint's `no-restricted-syntax` equivalent), so the guard is behavioural rather than static:
    the **query-count regression tests** (item 12) fail the moment a per-row query is reintroduced, and
    the `attach*` helpers are documented as the single blessed path (item 15). Noted as the realistic
    substitute for a custom lint rule.
14. **Update root `AUDIT.md` (required).** Maintain a committed audit write-up at the repo root
    (`/AUDIT.md`) recording, per fix: the file, the anti-pattern, before/after query counts, and the
    approach. Scoped under an **"Issue 2 — Query Performance"** top-level section so a parallel task
    appending its own section merges without conflict (resolve any overlap at integration time).
15. **Docs** — short note (README/CLAUDE.md) pointing new list endpoints at the `attach*` helpers.

### Left as-is / out of scope
- `getUser` (`users.service.ts:13`) — fixed 5 queries, not N+1. Optional later consolidation, noted
  not scoped.
- `getUserDetails`, `getDashboardStats` (admin) — fixed handful of queries, not N+1.
- DB indexing/tuning, schema migrations, denormalized counters, and pagination for `getUserPosts`
  (flagged separately). No gRPC/API contract changes.

### Acceptance criteria
- Every touched endpoint returns responses identical to `main` (field-for-field, order-for-order).
- Per-operation query counts hit the §4 targets and stay flat as N grows.
- All four copies of `getPostCounts` (+ `getCommentLikeInfo`) removed; replaced by the shared
  `attach*` helpers.
- **Every changed service function has both a behavioural test and a query-count test; all pass.**
- Query-count regression tests act as the guard against reintroducing N+1 (no Biome AST rule available).
- **Root `AUDIT.md` updated** with a per-fix before/after entry under the Issue 2 section.
- `pnpm build` and the full existing test suite still pass.
