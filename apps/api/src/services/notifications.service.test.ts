import { describe, expect, it } from "vitest";
import { createTestComment, createTestPost, createTestUser } from "../../tests/helpers";
import { countQueries } from "../../tests/query-counter";
import { db, schema } from "../db";
import { getUserNotifications } from "./notifications.service";
import { generateId } from "./utils";

async function insertNotification(input: {
	userId: string;
	actorId: string;
	type?: string;
	postId?: string;
	commentId?: string;
	createdAt?: Date;
}) {
	await db.insert(schema.notifications).values({
		id: generateId(),
		userId: input.userId,
		actorId: input.actorId,
		type: input.type ?? "like",
		postId: input.postId ?? null,
		commentId: input.commentId ?? null,
		createdAt: input.createdAt,
	});
}

describe("NotificationsService", () => {
	describe("getUserNotifications", () => {
		it("includes actor and truncates post/comment previews to 100 chars", async () => {
			const recipient = await createTestUser();
			const actor = await createTestUser();
			const longContent = "a".repeat(250);
			const postId = await createTestPost(actor.id, longContent);
			const commentId = await createTestComment(postId, actor.id, "b".repeat(250));

			await insertNotification({
				userId: recipient.id,
				actorId: actor.id,
				type: "comment",
				postId,
				commentId,
			});

			const [notification] = await getUserNotifications(recipient.id);

			expect(notification.actor?.username).toBe(actor.username);
			expect(notification.postContent).toBe("a".repeat(100));
			expect(notification.commentContent).toBe("b".repeat(100));
		});

		it("leaves previews null when there is no post or comment", async () => {
			const recipient = await createTestUser();
			const actor = await createTestUser();
			await insertNotification({ userId: recipient.id, actorId: actor.id, type: "follow" });

			const [notification] = await getUserNotifications(recipient.id);
			expect(notification.postContent).toBeNull();
			expect(notification.commentContent).toBeNull();
		});

		it("orders newest first", async () => {
			const recipient = await createTestUser();
			const actor = await createTestUser();
			await insertNotification({
				userId: recipient.id,
				actorId: actor.id,
				createdAt: new Date(1000),
			});
			await insertNotification({
				userId: recipient.id,
				actorId: actor.id,
				createdAt: new Date(2000),
			});

			const notifications = await getUserNotifications(recipient.id);
			expect(notifications[0].createdAt.getTime()).toBeGreaterThan(
				notifications[1].createdAt.getTime(),
			);
		});

		it("runs a constant number of queries regardless of notification count", async () => {
			const recipient = await createTestUser();
			const actor = await createTestUser();
			const postId = await createTestPost(actor.id, "p");

			for (let i = 0; i < 3; i++) {
				await insertNotification({ userId: recipient.id, actorId: actor.id, postId });
			}
			const { queries: few } = await countQueries(() => getUserNotifications(recipient.id, 50));

			for (let i = 0; i < 15; i++) {
				await insertNotification({ userId: recipient.id, actorId: actor.id, postId });
			}
			const { queries: many } = await countQueries(() => getUserNotifications(recipient.id, 50));

			expect(few).toBe(many);
			expect(many).toBeLessThanOrEqual(3); // 1 list + up to 2 preview batches
		});
	});
});
