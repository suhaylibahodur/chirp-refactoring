import { describe, expect, it } from "vitest";
import {
	createTestComment,
	createTestCommentLike,
	createTestLike,
	createTestPost,
	createTestUser,
} from "../../tests/helpers";
import { countQueries } from "../../tests/query-counter";
import { attachCommentLikeInfo, attachPostCounts, attachUserContentCounts } from "./enrichment";

describe("enrichment helpers", () => {
	describe("attachPostCounts", () => {
		it("returns [] and runs no queries for empty input", async () => {
			const { result, queries } = await countQueries(() => attachPostCounts([]));
			expect(result).toEqual([]);
			expect(queries).toBe(0);
		});

		it("attaches correct like/comment counts and viewer isLiked", async () => {
			const author = await createTestUser();
			const viewer = await createTestUser();
			const other = await createTestUser();
			const p1 = await createTestPost(author.id, "one");
			const p2 = await createTestPost(author.id, "two");

			await createTestLike(viewer.id, p1);
			await createTestLike(other.id, p1);
			await createTestComment(p1, other.id, "c1");
			await createTestComment(p1, other.id, "c2");

			const enriched = await attachPostCounts([{ id: p1 }, { id: p2 }], viewer.id);

			expect(enriched[0]).toMatchObject({
				id: p1,
				likeCount: 2,
				commentCount: 2,
				isLiked: true,
			});
			expect(enriched[1]).toMatchObject({
				id: p2,
				likeCount: 0,
				commentCount: 0,
				isLiked: false,
			});
		});

		it("preserves input order and extra fields", async () => {
			const author = await createTestUser();
			const a = await createTestPost(author.id, "a");
			const b = await createTestPost(author.id, "b");

			const enriched = await attachPostCounts([
				{ id: b, content: "b" },
				{ id: a, content: "a" },
			]);

			expect(enriched.map((p) => p.id)).toEqual([b, a]);
			expect(enriched.map((p) => p.content)).toEqual(["b", "a"]);
		});

		it("runs a constant number of queries regardless of list size", async () => {
			const author = await createTestUser();
			const viewer = await createTestUser();
			const small = [];
			for (let i = 0; i < 3; i++) small.push({ id: await createTestPost(author.id) });
			const large = [];
			for (let i = 0; i < 25; i++) large.push({ id: await createTestPost(author.id) });

			const { queries: qSmall } = await countQueries(() => attachPostCounts(small, viewer.id));
			const { queries: qLarge } = await countQueries(() => attachPostCounts(large, viewer.id));

			expect(qSmall).toBe(qLarge);
			expect(qLarge).toBeLessThanOrEqual(3); // 2 counts + 1 viewer-liked, never N per row
		});

		it("runs one fewer query when no viewer is supplied", async () => {
			const author = await createTestUser();
			const posts = [{ id: await createTestPost(author.id) }];

			const { queries: withViewer } = await countQueries(() => attachPostCounts(posts, author.id));
			const { queries: withoutViewer } = await countQueries(() => attachPostCounts(posts));

			expect(withoutViewer).toBe(withViewer - 1);
		});
	});

	describe("attachCommentLikeInfo", () => {
		it("attaches like count and viewer isLiked, flat query count", async () => {
			const author = await createTestUser();
			const viewer = await createTestUser();
			const postId = await createTestPost(author.id);
			const c1 = await createTestComment(postId, author.id, "c1");
			const c2 = await createTestComment(postId, author.id, "c2");
			await createTestCommentLike(viewer.id, c1);

			const enriched = await attachCommentLikeInfo([{ id: c1 }, { id: c2 }], viewer.id);
			expect(enriched[0]).toMatchObject({ id: c1, likeCount: 1, isLiked: true });
			expect(enriched[1]).toMatchObject({ id: c2, likeCount: 0, isLiked: false });

			const many = [];
			for (let i = 0; i < 20; i++) {
				many.push({ id: await createTestComment(postId, author.id) });
			}
			const { queries } = await countQueries(() => attachCommentLikeInfo(many, viewer.id));
			expect(queries).toBeLessThanOrEqual(2);
		});
	});

	describe("attachUserContentCounts", () => {
		it("attaches authored post/comment counts, flat query count", async () => {
			const u1 = await createTestUser();
			const u2 = await createTestUser();
			const p = await createTestPost(u1.id);
			await createTestPost(u1.id);
			await createTestComment(p, u2.id, "c");

			const enriched = await attachUserContentCounts([{ id: u1.id }, { id: u2.id }]);
			expect(enriched[0]).toMatchObject({ id: u1.id, postCount: 2, commentCount: 0 });
			expect(enriched[1]).toMatchObject({ id: u2.id, postCount: 0, commentCount: 1 });

			const { queries } = await countQueries(() =>
				attachUserContentCounts([{ id: u1.id }, { id: u2.id }]),
			);
			expect(queries).toBeLessThanOrEqual(2);
		});
	});
});
