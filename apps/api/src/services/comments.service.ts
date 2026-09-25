import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "../db";
import { attachCommentLikeInfo } from "./enrichment";
import { processMentions } from "./mentions.service";
import { createNotification } from "./notifications.service";
import { generateId } from "./utils";

const { comments, users, posts } = schema;

export interface CreateCommentInput {
	postId: string;
	content: string;
	authorId: string;
	parentId?: string;
}

export async function createComment(input: CreateCommentInput) {
	if (!input.content || input.content.length === 0) {
		throw new Error("Comment content is required");
	}

	// Verify post exists
	const post = await db.select().from(posts).where(eq(posts.id, input.postId)).get();

	if (!post) {
		throw new Error("Post not found");
	}

	// If parentId provided, verify parent comment exists
	if (input.parentId) {
		const parentComment = await db
			.select()
			.from(comments)
			.where(eq(comments.id, input.parentId))
			.get();

		if (!parentComment) {
			throw new Error("Parent comment not found");
		}

		// Only allow one level of nesting
		if (parentComment.parentId) {
			throw new Error("Cannot reply to a reply");
		}
	}

	const commentId = generateId();
	await db.insert(comments).values({
		id: commentId,
		content: input.content,
		postId: input.postId,
		authorId: input.authorId,
		parentId: input.parentId || null,
	});

	// Create notification for post author
	await createNotification({
		userId: post.authorId,
		type: "comment",
		actorId: input.authorId,
		postId: input.postId,
		commentId,
	});

	// Process mentions and create notifications
	await processMentions(input.content, input.authorId, input.postId, commentId);

	return { commentId };
}

export async function getPostComments(postId: string, userId?: string) {
	// Get top-level comments
	const topLevelComments = await db
		.select({
			id: comments.id,
			content: comments.content,
			createdAt: comments.createdAt,
			parentId: comments.parentId,
			author: {
				id: users.id,
				username: users.username,
				displayName: users.displayName,
				avatarUrl: users.avatarUrl,
			},
		})
		.from(comments)
		.leftJoin(users, eq(comments.authorId, users.id))
		.where(and(eq(comments.postId, postId), isNull(comments.parentId)));

	const topLevelIds = topLevelComments.map((c) => c.id);

	// Batch-fetch every reply for every top-level comment in one query.
	const replies = topLevelIds.length
		? await db
				.select({
					id: comments.id,
					content: comments.content,
					createdAt: comments.createdAt,
					parentId: comments.parentId,
					author: {
						id: users.id,
						username: users.username,
						displayName: users.displayName,
						avatarUrl: users.avatarUrl,
					},
				})
				.from(comments)
				.leftJoin(users, eq(comments.authorId, users.id))
				.where(inArray(comments.parentId, topLevelIds))
		: [];

	// Enrich top-level comments and replies with like info in a single batched pass.
	const enriched = await attachCommentLikeInfo([...topLevelComments, ...replies], userId);
	const enrichedTop = enriched.slice(0, topLevelComments.length);
	const enrichedReplies = enriched.slice(topLevelComments.length);

	// Group replies back under their parent, preserving fetch order.
	type EnrichedReply = (typeof enrichedReplies)[number];
	const repliesByParent = new Map<string, Array<EnrichedReply & { replies: never[] }>>();
	for (const reply of enrichedReplies) {
		if (!reply.parentId) continue;
		const group = repliesByParent.get(reply.parentId) ?? [];
		group.push({ ...reply, replies: [] });
		repliesByParent.set(reply.parentId, group);
	}

	return enrichedTop.map((comment) => ({
		...comment,
		replies: repliesByParent.get(comment.id) ?? [],
	}));
}

export async function deleteComment(commentId: string, userId: string) {
	const comment = await db.select().from(comments).where(eq(comments.id, commentId)).get();

	if (!comment) {
		throw new Error("Comment not found");
	}

	if (comment.authorId !== userId) {
		throw new Error("You can only delete your own comments");
	}

	await db.delete(comments).where(eq(comments.id, commentId));

	return { success: true };
}
