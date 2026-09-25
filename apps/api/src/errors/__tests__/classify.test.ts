import { describe, expect, it } from "vitest";
import { AppErrorCode, NotFoundError, PermissionError, ValidationError } from "../app-error";
import { classifyError } from "../classify";

describe("classifyError", () => {
	it("uses the code of a typed AppError", () => {
		expect(classifyError(new NotFoundError("Post not found"))).toEqual({
			code: AppErrorCode.NOT_FOUND,
			message: "Post not found",
			isInternal: false,
		});
		expect(classifyError(new PermissionError("Admin access required")).code).toBe(
			AppErrorCode.PERMISSION_DENIED,
		);
		expect(classifyError(new ValidationError("Invalid role")).code).toBe(
			AppErrorCode.INVALID_ARGUMENT,
		);
	});

	it("maps known plain-Error messages via the registry", () => {
		const cases: Array<[string, AppErrorCode]> = [
			["Invalid or expired session token", AppErrorCode.UNAUTHENTICATED],
			["Invalid token", AppErrorCode.UNAUTHENTICATED],
			["Admin access required", AppErrorCode.PERMISSION_DENIED],
			["User not found", AppErrorCode.NOT_FOUND],
			["Username already taken", AppErrorCode.ALREADY_EXISTS],
			["Post content must be 280 characters or less", AppErrorCode.INVALID_ARGUMENT],
			["Cannot ban admin users", AppErrorCode.FAILED_PRECONDITION],
		];
		for (const [message, code] of cases) {
			const result = classifyError(new Error(message));
			expect(result.code).toBe(code);
			expect(result.isInternal).toBe(false);
			expect(result.message).toBe(message);
		}
	});

	it("matches dynamic messages by pattern", () => {
		expect(classifyError(new Error("Comment not found")).code).toBe(AppErrorCode.NOT_FOUND);
		expect(classifyError(new Error("Account banned: spam")).code).toBe(
			AppErrorCode.PERMISSION_DENIED,
		);
	});

	it("treats unrecognized Errors as INTERNAL and preserves the message", () => {
		const result = classifyError(new Error("Something unexpected exploded"));
		expect(result.code).toBe(AppErrorCode.INTERNAL);
		expect(result.isInternal).toBe(true);
		expect(result.message).toBe("Something unexpected exploded");
	});

	it("treats non-Error throws as INTERNAL with the fallback message", () => {
		const result = classifyError("boom", "Registration failed");
		expect(result.code).toBe(AppErrorCode.INTERNAL);
		expect(result.isInternal).toBe(true);
		expect(result.message).toBe("Registration failed");
	});
});
