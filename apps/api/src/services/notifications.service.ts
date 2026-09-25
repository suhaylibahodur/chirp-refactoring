import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { generateId } from "./utils";

const { notifications, users, posts, comments } = schema;

export type NotificationType = "like" | "comment" | "follow" | "mention";

export interface CreateNotificationInput {
	userId: string; // recipient
	type: NotificationType;
	actorId: string; // who triggered the notification
	postId?: string;
	commentId?: string;
}

/**
 * Create a notification (internal helper, used by other services)
 * Returns null if user is notifying themselves (no self-notifications)
 */
export async function createNotification(input: CreateNotificationInput) {
	// Don't notify users about their own actions
	if (input.userId === input.actorId) {
		return null;
	}

	const notificationId = generateId();
	await db.insert(notifications).values({
		id: notificationId,
		userId: input.userId,
		type: input.type,
		actorId: input.actorId,
		postId: input.postId || null,
		commentId: input.commentId || null,
	});

	return { notificationId };
}

/**
 * Get notifications for a user with pagination
 */
export async function getUserNotifications(userId: string, limit = 20, offset = 0) {
	const results = await db
		.select({
			id: notifications.id,
			type: notifications.type,
			read: notifications.read,
			createdAt: notifications.createdAt,
			postId: notifications.postId,
			commentId: notifications.commentId,
			actor: {
				id: users.id,
				username: users.username,
				displayName: users.displayName,
				avatarUrl: users.avatarUrl,
			},
		})
		.from(notifications)
		.leftJoin(users, eq(notifications.actorId, users.id))
		.where(eq(notifications.userId, userId))
		.orderBy(desc(notifications.createdAt))
		.limit(limit)
		.offset(offset);

	// Batch-fetch post/comment content previews for the whole page.
	const postIds = [
		...new Set(results.map((r) => r.postId).filter((id): id is string => id !== null)),
	];
	const commentIds = [
		...new Set(results.map((r) => r.commentId).filter((id): id is string => id !== null)),
	];

	const postRows = postIds.length
		? await db
				.select({ id: posts.id, content: posts.content })
				.from(posts)
				.where(inArray(posts.id, postIds))
		: [];
	const commentRows = commentIds.length
		? await db
				.select({ id: comments.id, content: comments.content })
				.from(comments)
				.where(inArray(comments.id, commentIds))
		: [];

	const postContentById = new Map(postRows.map((p) => [p.id, p.content] as const));
	const commentContentById = new Map(commentRows.map((c) => [c.id, c.content] as const));

	const enrichedResults = results.map((notification) => ({
		...notification,
		postContent: notification.postId
			? postContentById.get(notification.postId)?.substring(0, 100) || null
			: null,
		commentContent: notification.commentId
			? commentContentById.get(notification.commentId)?.substring(0, 100) || null
			: null,
	}));

	return enrichedResults;
}

/**
 * Get unread notification count for a user
 */
export async function getUnreadCount(userId: string) {
	const result = await db
		.select({ count: sql<number>`count(*)` })
		.from(notifications)
		.where(and(eq(notifications.userId, userId), eq(notifications.read, false)))
		.get();

	return { count: result?.count || 0 };
}

/**
 * Mark a single notification as read
 */
export async function markAsRead(notificationId: string, userId: string) {
	const notification = await db
		.select()
		.from(notifications)
		.where(eq(notifications.id, notificationId))
		.get();

	if (!notification) {
		throw new Error("Notification not found");
	}

	if (notification.userId !== userId) {
		throw new Error("Unauthorized");
	}

	await db.update(notifications).set({ read: true }).where(eq(notifications.id, notificationId));

	return { success: true };
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllAsRead(userId: string) {
	await db.update(notifications).set({ read: true }).where(eq(notifications.userId, userId));

	return { success: true };
}

/**
 * Delete a notification
 */
export async function deleteNotification(notificationId: string, userId: string) {
	const notification = await db
		.select()
		.from(notifications)
		.where(eq(notifications.id, notificationId))
		.get();

	if (!notification) {
		throw new Error("Notification not found");
	}

	if (notification.userId !== userId) {
		throw new Error("Unauthorized");
	}

	await db.delete(notifications).where(eq(notifications.id, notificationId));

	return { success: true };
}
