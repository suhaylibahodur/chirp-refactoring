import type { CommentResponse, ICommentsService } from "@chirp/proto";
import { errorFields } from "../../errors/handler-errors";
import { validateSessionToken } from "../../middleware/auth";
import { resolveOptionalAuth } from "../../middleware/optional-auth";
import { createComment, deleteComment, getPostComments } from "../../services/comments.service";
import { toProtoTimestamp } from "../../services/utils";
import { wrapHandler } from "../wrap";

function toCommentResponse(comment: any): CommentResponse {
	return {
		id: comment.id,
		content: comment.content,
		createdAt: toProtoTimestamp(comment.createdAt),
		parentId: comment.parentId || undefined,
		author: comment.author
			? {
					id: comment.author.id || "",
					username: comment.author.username || "",
					displayName: comment.author.displayName || "",
					avatarUrl: comment.author.avatarUrl || undefined,
				}
			: { id: "", username: "", displayName: "" },
		likeCount: comment.likeCount || 0,
		isLiked: comment.isLiked || false,
		replies: (comment.replies || []).map(toCommentResponse),
	};
}

const commentsService: ICommentsService = {
	async createComment(request) {
		try {
			const auth = validateSessionToken(request.sessionToken);
			const result = await createComment({
				postId: request.postId,
				content: request.content,
				authorId: auth.userId,
				parentId: request.parentId || undefined,
			});

			return {
				success: true,
				commentId: result.commentId,
			};
		} catch (error) {
			return {
				success: false,
				commentId: "",
				...errorFields(error, "Failed to create comment"),
			};
		}
	},

	async getPostComments(request) {
		const userId = resolveOptionalAuth(request.sessionToken);

		const comments = await getPostComments(request.postId, userId);

		return {
			comments: comments.map(toCommentResponse),
		};
	},

	async deleteComment(request) {
		try {
			const auth = validateSessionToken(request.sessionToken);
			await deleteComment(request.commentId, auth.userId);

			return { success: true };
		} catch (error) {
			return {
				success: false,
				...errorFields(error, "Failed to delete comment"),
			};
		}
	},
};

export const commentsHandler = wrapHandler("CommentsService", commentsService);
