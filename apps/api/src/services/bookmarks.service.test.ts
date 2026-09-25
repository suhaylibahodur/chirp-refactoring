import { describe, expect, it } from "vitest";
import {
	createTestComment,
	createTestLike,
	createTestPost,
	createTestUser,
} from "../../tests/helpers";
import { countQueries } from "../../tests/query-counter";
import { db, schema } from "../db";
import { getBookmarkedPosts } from "./bookmarks.service";
import { generateId } from "./utils";

async function bookmarkAt(userId: string, postId: string, createdAt: Date) {
	await db.insert(schema.bookmarks).values({ id: generateId(), userId, postId, createdAt });
}

describe("BookmarksService", () => {
	describe("getBookmarkedPosts", () => {
		it("returns [] when the user has no bookmarks", async () => {
			const user = await createTestUser();
			expect(await getBookmarkedPosts(user.id)).toEqual([]);
		});

		it("returns bookmarked posts newest-first with counts and viewer isLiked", async () => {
			const owner = await createTestUser();
			const author = await createTestUser();
			const older = await createTestPost(author.id, "older");
			const newer = await createTestPost(author.id, "newer");

			await createTestLike(owner.id, newer);
			await createTestComment(newer, author.id, "c");

			await bookmarkAt(owner.id, older, new Date(1000));
			await bookmarkAt(owner.id, newer, new Date(2000));

			const result = await getBookmarkedPosts(owner.id, owner.id);

			// Ordered by bookmark createdAt desc.
			expect(result.map((p) => p.id)).toEqual([newer, older]);
			expect(result[0]).toMatchObject({
				id: newer,
				content: "newer",
				likeCount: 1,
				commentCount: 1,
				isLiked: true,
			});
			expect(result[0].author?.username).toBe(author.username);
			// Response shape must not leak bookmark metadata.
			expect(result[0]).not.toHaveProperty("bookmarkedAt");
		});

		it("isLiked is false when no requester is supplied", async () => {
			const owner = await createTestUser();
			const post = await createTestPost(owner.id);
			await createTestLike(owner.id, post);
			await bookmarkAt(owner.id, post, new Date(1000));

			const result = await getBookmarkedPosts(owner.id);
			expect(result[0].isLiked).toBe(false);
		});

		it("runs a constant number of queries regardless of bookmark count", async () => {
			const owner = await createTestUser();
			const author = await createTestUser();

			for (let i = 0; i < 3; i++) {
				const p = await createTestPost(author.id);
				await bookmarkAt(owner.id, p, new Date(1000 + i));
			}
			const { queries: few } = await countQueries(() => getBookmarkedPosts(owner.id, owner.id, 50));

			for (let i = 3; i < 18; i++) {
				const p = await createTestPost(author.id);
				await bookmarkAt(owner.id, p, new Date(1000 + i));
			}
			const { queries: many } = await countQueries(() =>
				getBookmarkedPosts(owner.id, owner.id, 50),
			);

			expect(few).toBe(many);
			expect(many).toBeLessThanOrEqual(5); // 1 ids + 1 posts + 3 batch, never N per row
		});
	});
});
