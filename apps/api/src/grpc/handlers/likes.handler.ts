import type { ILikesService } from "@chirp/proto";
import { errorFields, logSwallowed } from "../../errors/handler-errors";
import { validateSessionToken } from "../../middleware/auth";
import {
	getCommentLikeStatus,
	getPostLikeStatus,
	toggleCommentLike,
	togglePostLike,
} from "../../services/likes.service";
import { wrapHandler } from "../wrap";

const likesService: ILikesService = {
	async togglePostLike(request) {
		try {
			const auth = validateSessionToken(request.sessionToken);
			const result = await togglePostLike(request.postId, auth.userId);

			return {
				success: true,
				liked: result.liked,
			};
		} catch (error) {
			return {
				success: false,
				liked: false,
				...errorFields(error, "Failed to toggle like"),
			};
		}
	},

	async toggleCommentLike(request) {
		try {
			const auth = validateSessionToken(request.sessionToken);
			const result = await toggleCommentLike(request.commentId, auth.userId);

			return {
				success: true,
				liked: result.liked,
			};
		} catch (error) {
			return {
				success: false,
				liked: false,
				...errorFields(error, "Failed to toggle like"),
			};
		}
	},

	async getPostLikeStatus(request) {
		try {
			const auth = validateSessionToken(request.sessionToken);
			const result = await getPostLikeStatus(request.postId, auth.userId);

			return { liked: result.liked };
		} catch (error) {
			logSwallowed(error);
			return { liked: false };
		}
	},

	async getCommentLikeStatus(request) {
		try {
			const auth = validateSessionToken(request.sessionToken);
			const result = await getCommentLikeStatus(request.commentId, auth.userId);

			return { liked: result.liked };
		} catch (error) {
			logSwallowed(error);
			return { liked: false };
		}
	},
};

export const likesHandler = wrapHandler("LikesService", likesService);
