import type { INotificationsService } from "@chirp/proto";
import { errorFields, logSwallowed } from "../../errors/handler-errors";
import { validateSessionToken } from "../../middleware/auth";
import {
	deleteNotification,
	getUnreadCount,
	getUserNotifications,
	markAllAsRead,
	markAsRead,
} from "../../services/notifications.service";
import { toProtoTimestamp } from "../../services/utils";
import { wrapHandler } from "../wrap";

const notificationsService: INotificationsService = {
	async getNotifications(request) {
		try {
			const auth = validateSessionToken(request.sessionToken);
			const notifications = await getUserNotifications(
				auth.userId,
				request.limit || 20,
				request.offset || 0,
			);

			return {
				notifications: notifications.map((n) => ({
					id: n.id,
					type: n.type,
					read: n.read,
					actor: n.actor
						? {
								id: n.actor.id,
								username: n.actor.username,
								displayName: n.actor.displayName,
								avatarUrl: n.actor.avatarUrl || undefined,
							}
						: undefined,
					postId: n.postId || undefined,
					commentId: n.commentId || undefined,
					postContent: n.postContent || undefined,
					commentContent: n.commentContent || undefined,
					createdAt: toProtoTimestamp(n.createdAt),
				})),
			};
		} catch (error) {
			logSwallowed(error);
			return { notifications: [] };
		}
	},

	async getUnreadCount(request) {
		try {
			const auth = validateSessionToken(request.sessionToken);
			const result = await getUnreadCount(auth.userId);
			return { count: result.count };
		} catch (error) {
			logSwallowed(error);
			return { count: 0 };
		}
	},

	async markAsRead(request) {
		try {
			const auth = validateSessionToken(request.sessionToken);
			await markAsRead(request.notificationId, auth.userId);
			return { success: true };
		} catch (error) {
			return {
				success: false,
				...errorFields(error, "Failed to mark as read"),
			};
		}
	},

	async markAllAsRead(request) {
		try {
			const auth = validateSessionToken(request.sessionToken);
			await markAllAsRead(auth.userId);
			return { success: true };
		} catch (error) {
			return {
				success: false,
				...errorFields(error, "Failed to mark all as read"),
			};
		}
	},

	async deleteNotification(request) {
		try {
			const auth = validateSessionToken(request.sessionToken);
			await deleteNotification(request.notificationId, auth.userId);
			return { success: true };
		} catch (error) {
			return {
				success: false,
				...errorFields(error, "Failed to delete notification"),
			};
		}
	},
};

export const notificationsHandler = wrapHandler("NotificationsService", notificationsService);
