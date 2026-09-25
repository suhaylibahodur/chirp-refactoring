import type { IFollowsService } from "@chirp/proto";
import { errorFields, logSwallowed } from "../../errors/handler-errors";
import { validateSessionToken } from "../../middleware/auth";
import {
	getFollowerCount,
	getFollowingCount,
	getFollowStatus,
	toggleFollow,
} from "../../services/follows.service";
import { wrapHandler } from "../wrap";

const followsService: IFollowsService = {
	async toggleFollow(request) {
		try {
			const auth = validateSessionToken(request.sessionToken);
			const result = await toggleFollow(request.username, auth.userId);

			return {
				success: true,
				following: result.following,
			};
		} catch (error) {
			return {
				success: false,
				following: false,
				...errorFields(error, "Failed to toggle follow"),
			};
		}
	},

	async getFollowStatus(request) {
		try {
			const auth = validateSessionToken(request.sessionToken);
			const result = await getFollowStatus(request.username, auth.userId);

			return { following: result.following };
		} catch (error) {
			logSwallowed(error);
			return { following: false };
		}
	},

	async getFollowerCount(request) {
		try {
			const result = await getFollowerCount(request.username);
			return { count: result.count };
		} catch (error) {
			logSwallowed(error);
			return { count: 0 };
		}
	},

	async getFollowingCount(request) {
		try {
			const result = await getFollowingCount(request.username);
			return { count: result.count };
		} catch (error) {
			logSwallowed(error);
			return { count: 0 };
		}
	},
};

export const followsHandler = wrapHandler("FollowsService", followsService);
