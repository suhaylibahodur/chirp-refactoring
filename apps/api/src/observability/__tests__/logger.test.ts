import { afterEach, describe, expect, it, vi } from "vitest";

// The logger's level threshold is resolved at module load, so we load a fresh
// module graph with LOG_LEVEL enabled to observe emitted lines.
async function freshLogger(level = "debug") {
	vi.resetModules();
	vi.stubEnv("LOG_LEVEL", level);
	const context = await import("../context");
	const logging = await import("../logger");
	return { ...logging, ...context };
}

describe("structured logger", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it("emits a single JSON line enriched with the active request context", async () => {
		const { logger, runWithContext } = await freshLogger("info");
		const writes: string[] = [];
		vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
			writes.push(String(chunk));
			return true;
		});

		runWithContext({ traceId: "tid-1", method: "Feed.getHomeFeed", userId: "u1" }, () => {
			logger.info("request.ok", { durationMs: 5 });
		});

		expect(writes).toHaveLength(1);
		expect(writes[0].endsWith("\n")).toBe(true);
		const line = JSON.parse(writes[0]);
		expect(line).toMatchObject({
			level: "info",
			msg: "request.ok",
			traceId: "tid-1",
			method: "Feed.getHomeFeed",
			userId: "u1",
			durationMs: 5,
		});
		expect(typeof line.ts).toBe("string");
	});

	it("suppresses lines below the configured threshold", async () => {
		const { logger } = await freshLogger("warn");
		const writes: string[] = [];
		vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
			writes.push(String(chunk));
			return true;
		});

		logger.info("should be suppressed");
		logger.warn("should appear");

		expect(writes).toHaveLength(1);
		expect(JSON.parse(writes[0]).msg).toBe("should appear");
	});
});
