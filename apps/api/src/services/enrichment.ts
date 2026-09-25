import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../db";

const { likes, comments, posts } = schema;

/**
 * Batch enrichment helpers.
 *
 * These are the single blessed way to attach per-row aggregates (like/comment
 * counts, per-viewer flags, author content counts) to a list of rows. They each
 * take an **array** and issue a fixed, small number of queries regardless of how
 * many rows are passed in — never one query per row.
 *
 * Do NOT reintroduce the `list.map(row => await countQueries(row))` pattern: it
 * is the N+1 anti-pattern and its cost grows with result-set size. If you need a
 * new aggregate on a list, add a batch helper here instead.
 */

/**
 * Attach like/comment counts and the viewer's `isLiked` flag to a list of posts.
 * Runs 2 queries (+1 when `viewerId` is provided), independent of `posts.length`.
 */
export async function attachPostCounts<T extends { id: string }>(
	postList: T[],
	viewerId?: string,
): Promise<(T & { likeCount: number; commentCount: number; isLiked: boolean })[]> {
	if (postList.length === 0) {
		return [];
	}

	const postIds = postList.map((p) => p.id);

	const likeCounts = await db
		.select({ postId: likes.postId, count: sql<number>`count(*)` })
		.from(likes)
		.where(inArray(likes.postId, postIds))
		.groupBy(likes.postId);

	const commentCounts = await db
		.select({ postId: comments.postId, count: sql<number>`count(*)` })
		.from(comments)
		.where(inArray(comments.postId, postIds))
		.groupBy(comments.postId);

	const likeCountMap = new Map(likeCounts.map((r) => [r.postId, r.count] as const));
	const commentCountMap = new Map(commentCounts.map((r) => [r.postId, r.count] as const));

	let likedSet = new Set<string>();
	if (viewerId) {
		const likedRows = await db
			.select({ postId: likes.postId })
			.from(likes)
			.where(and(eq(likes.userId, viewerId), inArray(likes.postId, postIds)));
		likedSet = new Set(likedRows.map((r) => r.postId).filter((id): id is string => id !== null));
	}

	return postList.map((post) => ({
		...post,
		likeCount: likeCountMap.get(post.id) || 0,
		commentCount: commentCountMap.get(post.id) || 0,
		isLiked: likedSet.has(post.id),
	}));
}

/**
 * Attach like count and the viewer's `isLiked` flag to a list of comments.
 * Runs 1 query (+1 when `viewerId` is provided), independent of `comments.length`.
 */
export async function attachCommentLikeInfo<T extends { id: string }>(
	commentList: T[],
	viewerId?: string,
): Promise<(T & { likeCount: number; isLiked: boolean })[]> {
	if (commentList.length === 0) {
		return [];
	}

	const commentIds = commentList.map((c) => c.id);

	const likeCounts = await db
		.select({ commentId: likes.commentId, count: sql<number>`count(*)` })
		.from(likes)
		.where(inArray(likes.commentId, commentIds))
		.groupBy(likes.commentId);

	const likeCountMap = new Map(likeCounts.map((r) => [r.commentId, r.count] as const));

	let likedSet = new Set<string>();
	if (viewerId) {
		const likedRows = await db
			.select({ commentId: likes.commentId })
			.from(likes)
			.where(and(eq(likes.userId, viewerId), inArray(likes.commentId, commentIds)));
		likedSet = new Set(likedRows.map((r) => r.commentId).filter((id): id is string => id !== null));
	}

	return commentList.map((comment) => ({
		...comment,
		likeCount: likeCountMap.get(comment.id) || 0,
		isLiked: likedSet.has(comment.id),
	}));
}

/**
 * Attach authored post/comment counts to a list of users.
 * Runs 2 queries, independent of `users.length`.
 */
export async function attachUserContentCounts<T extends { id: string }>(
	userList: T[],
): Promise<(T & { postCount: number; commentCount: number })[]> {
	if (userList.length === 0) {
		return [];
	}

	const userIds = userList.map((u) => u.id);

	const postCounts = await db
		.select({ authorId: posts.authorId, count: sql<number>`count(*)` })
		.from(posts)
		.where(inArray(posts.authorId, userIds))
		.groupBy(posts.authorId);

	const commentCounts = await db
		.select({ authorId: comments.authorId, count: sql<number>`count(*)` })
		.from(comments)
		.where(inArray(comments.authorId, userIds))
		.groupBy(comments.authorId);

	const postCountMap = new Map(postCounts.map((r) => [r.authorId, r.count] as const));
	const commentCountMap = new Map(commentCounts.map((r) => [r.authorId, r.count] as const));

	return userList.map((user) => ({
		...user,
		postCount: postCountMap.get(user.id) || 0,
		commentCount: commentCountMap.get(user.id) || 0,
	}));
}
