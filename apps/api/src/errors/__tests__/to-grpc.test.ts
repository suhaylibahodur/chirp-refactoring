import { status as GrpcStatus } from "@grpc/grpc-js";
import { RpcError } from "@protobuf-ts/runtime-rpc";
import { describe, expect, it } from "vitest";
import { AppErrorCode } from "../app-error";
import { toRpcError } from "../to-grpc";

describe("toRpcError", () => {
	it("produces an RpcError whose code is a valid gRPC status name", () => {
		const err = toRpcError({
			code: AppErrorCode.NOT_FOUND,
			message: "Post not found",
			isInternal: false,
		});
		expect(err).toBeInstanceOf(RpcError);
		expect(err.code).toBe("NOT_FOUND");
		// The adapter resolves this name against the grpc status enum.
		expect(typeof GrpcStatus[err.code as keyof typeof GrpcStatus]).toBe("number");
	});

	it("passes known domain messages through unchanged", () => {
		const err = toRpcError({
			code: AppErrorCode.PERMISSION_DENIED,
			message: "Admin access required",
			isInternal: false,
		});
		expect(err.message).toBe("Admin access required");
		expect(err.code).toBe("PERMISSION_DENIED");
	});

	it("masks internal error messages but keeps the INTERNAL code", () => {
		const err = toRpcError({
			code: AppErrorCode.INTERNAL,
			message: "connect ECONNREFUSED 127.0.0.1:5432",
			isInternal: true,
		});
		expect(err.message).toBe("Internal error");
		expect(err.code).toBe("INTERNAL");
	});

	it("carries metadata (e.g. the trace id) onto the error", () => {
		const err = toRpcError(
			{ code: AppErrorCode.NOT_FOUND, message: "Post not found", isInternal: false },
			{ "x-trace-id": "trace-123" },
		);
		expect(err.meta["x-trace-id"]).toBe("trace-123");
	});
});
