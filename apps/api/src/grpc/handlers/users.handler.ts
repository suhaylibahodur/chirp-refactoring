import type { IUsersService } from "@chirp/proto";
import { errorFields } from "../../errors/handler-errors";
import { validateSessionToken } from "../../middleware/auth";
import { resolveOptionalAuth } from "../../middleware/optional-auth";
import { getUser, updateProfile } from "../../services/users.service";
import { toProtoTimestamp } from "../../services/utils";
import { wrapHandler } from "../wrap";

const usersService: IUsersService = {
	async getUser(request) {
		const userId = resolveOptionalAuth(request.sessionToken);

		const user = await getUser(request.username, userId);

		return {
			id: user.id,
			email: user.email,
			username: user.username,
			displayName: user.displayName,
			avatarUrl: user.avatarUrl || undefined,
			bio: user.bio || undefined,
			role: user.role,
			createdAt: toProtoTimestamp(user.createdAt),
			followerCount: user.followerCount,
			followingCount: user.followingCount,
			postCount: user.postCount,
			isFollowing: user.isFollowing,
		};
	},

	async updateProfile(request) {
		try {
			const auth = validateSessionToken(request.sessionToken);
			await updateProfile({
				userId: auth.userId,
				displayName: request.displayName || undefined,
				bio: request.bio || undefined,
				avatarUrl: request.avatarUrl || undefined,
			});

			return { success: true };
		} catch (error) {
			return {
				success: false,
				...errorFields(error, "Failed to update profile"),
			};
		}
	},
};

export const usersHandler = wrapHandler("UsersService", usersService);
