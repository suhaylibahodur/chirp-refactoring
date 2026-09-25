import { describe, expect, it } from "vitest";
import {
	createTestComment,
	createTestFollow,
	createTestLike,
	createTestPost,
	createTestUser,
} from "../../tests/helpers";
import { countQueries } from "../../tests/query-counter";
import { getExploreFeed, getHomeFeed } from "./feed.service";

describe("FeedService", () => {
	describe("getHomeFeed", () => {
		it("returns the viewer's own and followed users' posts with counts", async () => {
			const viewer = await createTestUser();
			const followed = await createTestUser();
			const stranger = await createTestUser();

			await createTestFollow(viewer.id, followed.id);
			const ownPost = await createTestPost(viewer.id, "mine");
			const followedPost = await createTestPost(followed.id, "followed");
			const strangerPost = await createTestPost(stranger.id, "stranger"); // must NOT appear

			await createTestLike(followed.id, ownPost);
			await createTestComment(ownPost, followed.id, "nice");

			const feed = await getHomeFeed(viewer.id);
			const ids = feed.map((p) => p.id);

			expect(ids).toContain(ownPost);
			expect(ids).toContain(followedPost);
			expect(ids).not.toContain(strangerPost);

			const own = feed.find((p) => p.id === ownPost);
			expect(own).toMatchObject({ likeCount: 1, commentCount: 1, isLiked: false });
			expect(own?.author?.username).toBe(viewer.username);
		});

		it("marks isLiked true for posts the viewer liked", async () => {
			const viewer = await createTestUser();
			const post = await createTestPost(viewer.id, "p");
			await createTestLike(viewer.id, post);

			const feed = await getHomeFeed(viewer.id);
			expect(feed.find((p) => p.id === post)?.isLiked).toBe(true);
		});

		it("runs a constant number of queries regardless of feed size", async () => {
			const viewer = await createTestUser();
			for (let i = 0; i < 3; i++) await createTestPost(viewer.id);
			const { queries: few } = await countQueries(() => getHomeFeed(viewer.id, { limit: 50 }));

			for (let i = 0; i < 15; i++) await createTestPost(viewer.id);
			const { queries: many } = await countQueries(() => getHomeFeed(viewer.id, { limit: 50 }));

			expect(few).toBe(many);
			expect(many).toBeLessThanOrEqual(5); // 1 follows + 1 feed + 3 batch, never N per row
		});
	});

	describe("getExploreFeed", () => {
		it("returns all posts with counts and viewer isLiked", async () => {
			const author = await createTestUser();
			const viewer = await createTestUser();
			const post = await createTestPost(author.id, "explore");
			await createTestLike(viewer.id, post);

			const feed = await getExploreFeed({ userId: viewer.id });
			const entry = feed.find((p) => p.id === post);
			expect(entry).toMatchObject({ likeCount: 1, isLiked: true });
		});

		it("runs a constant number of queries regardless of feed size", async () => {
			const author = await createTestUser();
			for (let i = 0; i < 3; i++) await createTestPost(author.id);
			const { queries: few } = await countQueries(() => getExploreFeed({ limit: 50 }));

			for (let i = 0; i < 15; i++) await createTestPost(author.id);
			const { queries: many } = await countQueries(() => getExploreFeed({ limit: 50 }));

			expect(few).toBe(many);
			expect(many).toBeLessThanOrEqual(3); // 1 feed + 2 batch (no viewer)
		});
	});
});
