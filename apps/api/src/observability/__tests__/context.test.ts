import { describe, expect, it } from "vitest";
import { getContext, runWithContext, setUserId } from "../context";

describe("request context (AsyncLocalStorage)", () => {
	it("returns undefined outside of a request", () => {
		expect(getContext()).toBeUndefined();
	});

	it("exposes the context within runWithContext", () => {
		runWithContext({ traceId: "t1", method: "Svc.method" }, () => {
			expect(getContext()).toEqual({ traceId: "t1", method: "Svc.method" });
		});
	});

	it("propagates through nested async calls without threading arguments", async () => {
		async function deepInServiceLayer() {
			// Simulate a service function several awaits deep.
			await Promise.resolve();
			await new Promise((r) => setTimeout(r, 1));
			return getContext()?.traceId;
		}

		const seen = await runWithContext({ traceId: "trace-xyz", method: "Feed.getHomeFeed" }, () =>
			deepInServiceLayer(),
		);
		expect(seen).toBe("trace-xyz");
	});

	it("attaches the resolved userId to the active context", () => {
		runWithContext({ traceId: "t2", method: "Svc.method" }, () => {
			setUserId("user-42");
			expect(getContext()?.userId).toBe("user-42");
		});
	});

	it("isolates context between concurrent requests", async () => {
		const results = await Promise.all([
			runWithContext({ traceId: "a", method: "m" }, async () => {
				await new Promise((r) => setTimeout(r, 5));
				return getContext()?.traceId;
			}),
			runWithContext({ traceId: "b", method: "m" }, async () => {
				await new Promise((r) => setTimeout(r, 1));
				return getContext()?.traceId;
			}),
		]);
		expect(results).toEqual(["a", "b"]);
	});
});
