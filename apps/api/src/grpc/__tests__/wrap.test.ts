import type { RpcMetadata, ServerCallContext } from "@protobuf-ts/runtime-rpc";
import { RpcError } from "@protobuf-ts/runtime-rpc";
import { describe, expect, it } from "vitest";
import { NotFoundError } from "../../errors/app-error";
import { TRACE_HEADER } from "../../observability/trace";
import { withObservability, wrapHandler } from "../wrap";

function fakeContext(headers: RpcMetadata = {}): ServerCallContext {
	return { headers, trailers: {} as RpcMetadata } as unknown as ServerCallContext;
}

describe("withObservability", () => {
	it("maps a typed domain error to the correct gRPC status, preserving the message", async () => {
		const fn = async () => {
			throw new NotFoundError("Post not found");
		};
		const wrapped = withObservability("Posts.getPost", fn);

		await expect(wrapped({})).rejects.toMatchObject({
			code: "NOT_FOUND",
			message: "Post not found",
		});
		await expect(wrapped({})).rejects.toBeInstanceOf(RpcError);
	});

	it("masks an unexpected internal error but sets code INTERNAL", async () => {
		const fn = async () => {
			throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
		};
		const wrapped = withObservability("Posts.getPost", fn);
		await expect(wrapped({})).rejects.toMatchObject({
			code: "INTERNAL",
			message: "Internal error",
		});
	});

	it("returns the trace id to the client via response trailers", async () => {
		const context = fakeContext();
		const wrapped = withObservability("Feed.getHomeFeed", async () => ({ posts: [] }));

		await wrapped({}, context);
		expect(typeof context.trailers[TRACE_HEADER]).toBe("string");
		expect((context.trailers[TRACE_HEADER] as string).length).toBeGreaterThan(0);
	});

	it("honors an inbound x-trace-id for trace continuity", async () => {
		const context = fakeContext({ [TRACE_HEADER]: "inbound-trace" });
		const wrapped = withObservability("Feed.getHomeFeed", async () => ({ posts: [] }));

		await wrapped({}, context);
		expect(context.trailers[TRACE_HEADER]).toBe("inbound-trace");
	});

	it("propagates the trace id onto thrown errors' metadata", async () => {
		const context = fakeContext({ [TRACE_HEADER]: "inbound-trace" });
		const wrapped = withObservability("Posts.getPost", async () => {
			throw new NotFoundError("Post not found");
		});

		await expect(wrapped({}, context)).rejects.toMatchObject({
			meta: { [TRACE_HEADER]: "inbound-trace" },
		});
	});

	it("works without a context (as unit tests call handlers)", async () => {
		const wrapped = withObservability("Svc.m", async (req: { x: number }) => ({ y: req.x + 1 }));
		await expect(wrapped({ x: 1 })).resolves.toEqual({ y: 2 });
	});

	it("leaves an app-level { success: false } payload untouched", async () => {
		const payload = { success: false, error: "Post not found", errorCode: "NOT_FOUND" };
		const wrapped = withObservability("Posts.createPost", async () => payload);
		await expect(wrapped({})).resolves.toEqual(payload);
	});
});

describe("wrapHandler", () => {
	it("wraps every method and preserves behavior", async () => {
		const impl = {
			async ok() {
				return { success: true };
			},
			async boom() {
				throw new NotFoundError("User not found");
			},
		};
		const wrapped = wrapHandler("TestService", impl);

		await expect(wrapped.ok()).resolves.toEqual({ success: true });
		await expect(wrapped.boom()).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});
