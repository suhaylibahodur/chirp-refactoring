# Chirp Refactoring Audit

> Per-issue audit of problems found and fixes applied. Each issue owns its own
> top-level section; append new sections rather than editing existing ones so
> parallel work merges cleanly.

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
