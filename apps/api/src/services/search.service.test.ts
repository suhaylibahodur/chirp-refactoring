import { describe, expect, it } from "vitest";
import {
	createTestComment,
	createTestLike,
	createTestPost,
	createTestUser,
} from "../../tests/helpers";
import { countQueries } from "../../tests/query-counter";
import { searchPosts, searchUsers } from "./search.service";

describe("SearchService", () => {
	describe("searchPosts", () => {
		it("returns [] for an empty query", async () => {
			expect(await searchPosts("")).toEqual([]);
			expect(await searchPosts("   ")).toEqual([]);
		});

		it("matches post content and attaches counts and viewer isLiked", async () => {
			const author = await createTestUser();
			const viewer = await createTestUser();
			const match = await createTestPost(author.id, "hello drizzle world");
			await createTestPost(author.id, "unrelated");

			await createTestLike(viewer.id, match);
			await createTestComment(match, author.id, "c");

			const result = await searchPosts("drizzle", viewer.id);

			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({
				id: match,
				likeCount: 1,
				commentCount: 1,
				isLiked: true,
			});
			expect(result[0].author?.username).toBe(author.username);
		});

		it("runs a constant number of queries regardless of match count", async () => {
			const author = await createTestUser();
			for (let i = 0; i < 3; i++) await createTestPost(author.id, `match ${i}`);
			const { queries: few } = await countQueries(() => searchPosts("match", author.id));

			for (let i = 3; i < 18; i++) await createTestPost(author.id, `match ${i}`);
			const { queries: many } = await countQueries(() => searchPosts("match", author.id));

			expect(few).toBe(many);
			expect(many).toBeLessThanOrEqual(4); // 1 search + 3 batch, never N per row
		});
	});

	describe("searchUsers", () => {
		it("matches on username or display name", async () => {
			const user = await createTestUser({ username: "findme", displayName: "Nope" });
			await createTestUser({ username: "other", displayName: "Zzz" });

			const result = await searchUsers("findme");
			expect(result.map((u) => u.id)).toContain(user.id);
		});
	});
});
