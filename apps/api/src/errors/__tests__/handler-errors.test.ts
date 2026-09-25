import { beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../observability/logger";
import { NotFoundError } from "../app-error";
import { errorFields, logSwallowed } from "../handler-errors";

describe("errorFields", () => {
	it("preserves the raw Error message and adds the taxonomy code", () => {
		expect(errorFields(new Error("Post not found"), "fallback")).toEqual({
			error: "Post not found",
			errorCode: "NOT_FOUND",
		});
		expect(errorFields(new NotFoundError("User not found"), "fallback")).toEqual({
			error: "User not found",
			errorCode: "NOT_FOUND",
		});
	});

	it("falls back to the per-method message for a non-Error throw", () => {
		expect(errorFields("weird", "Failed to create post")).toEqual({
			error: "Failed to create post",
			errorCode: "INTERNAL",
		});
	});
});

describe("logSwallowed", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("logs auth failures at debug (expected anonymous fallback)", () => {
		const debug = vi.spyOn(logger, "debug");
		const error = vi.spyOn(logger, "error");
		logSwallowed(new Error("Invalid or expired session token"));
		expect(debug).toHaveBeenCalledTimes(1);
		expect(error).not.toHaveBeenCalled();
	});

	it("logs a genuine fault at error so it is no longer invisible", () => {
		const debug = vi.spyOn(logger, "debug");
		const error = vi.spyOn(logger, "error");
		logSwallowed(new Error("connect ECONNREFUSED 127.0.0.1:5432"));
		expect(error).toHaveBeenCalledTimes(1);
		expect(debug).not.toHaveBeenCalled();
	});
});
