import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth", () => ({
	validateSessionToken: vi.fn(),
}));

import { validateSessionToken } from "../auth";
import { resolveOptionalAuth } from "../optional-auth";

describe("resolveOptionalAuth", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns undefined when no token is provided", () => {
		expect(resolveOptionalAuth(undefined)).toBeUndefined();
		expect(resolveOptionalAuth("")).toBeUndefined();
		expect(validateSessionToken).not.toHaveBeenCalled();
	});

	it("returns the userId for a valid token", () => {
		vi.mocked(validateSessionToken).mockReturnValue({
			userId: "user-1",
			username: "u",
			role: "user",
		});
		expect(resolveOptionalAuth("good-token")).toBe("user-1");
	});

	it("degrades to anonymous (undefined) for an invalid token", () => {
		vi.mocked(validateSessionToken).mockImplementation(() => {
			throw new Error("Invalid or expired session token");
		});
		expect(resolveOptionalAuth("bad-token")).toBeUndefined();
	});
});
