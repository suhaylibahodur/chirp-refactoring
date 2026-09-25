import type { IFeedService, PostResponse } from "@chirp/proto";
import { validateSessionToken } from "../../middleware/auth";
import { resolveOptionalAuth } from "../../middleware/optional-auth";
import { getExploreFeed, getHomeFeed } from "../../services/feed.service";
import { toProtoTimestamp } from "../../services/utils";
import { wrapHandler } from "../wrap";

function toPostResponse(post: any): PostResponse {
	return {
		id: post.id,
		content: post.content,
		createdAt: toProtoTimestamp(post.createdAt),
		updatedAt: toProtoTimestamp(post.updatedAt),
		author: post.author
			? {
					id: post.author.id || "",
					username: post.author.username || "",
					displayName: post.author.displayName || "",
					avatarUrl: post.author.avatarUrl || undefined,
				}
			: { id: "", username: "", displayName: "" },
		likeCount: post.likeCount || 0,
		commentCount: post.commentCount || 0,
		isLiked: post.isLiked || false,
	};
}

const feedService: IFeedService = {
	async getHomeFeed(request) {
		// Requires auth: an invalid/missing token throws and the boundary wrapper
		// maps it to UNAUTHENTICATED instead of an opaque UNKNOWN.
		const auth = validateSessionToken(request.sessionToken);
		const posts = await getHomeFeed(auth.userId, {
			limit: request.pagination?.limit || 20,
			offset: request.pagination?.offset || 0,
		});

		return {
			posts: posts.map(toPostResponse),
		};
	},

	async getExploreFeed(request) {
		const userId = resolveOptionalAuth(request.sessionToken);

		const posts = await getExploreFeed({
			limit: request.pagination?.limit || 20,
			offset: request.pagination?.offset || 0,
			userId,
		});

		return {
			posts: posts.map(toPostResponse),
		};
	},
};

export const feedHandler = wrapHandler("FeedService", feedService);
