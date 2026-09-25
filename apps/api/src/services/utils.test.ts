import { describe, expect, it } from "vitest";
import { hashPassword, isLegacyPasswordHash, legacyHashPassword, verifyPassword } from "./utils";

describe("password hashing", () => {
	describe("hashPassword", () => {
		it("produces a bcrypt hash (not a fast SHA-256 digest)", async () => {
			const hash = await hashPassword("password123");
			expect(hash.startsWith("$2")).toBe(true);
			expect(hash).not.toBe(legacyHashPassword("password123"));
		});

		it("uses a per-hash random salt (same password -> different hashes)", async () => {
			const a = await hashPassword("password123");
			const b = await hashPassword("password123");
			expect(a).not.toBe(b);
		});
	});

	describe("legacy scheme (demonstrates the old vulnerability)", () => {
		it("SHA-256 with a static salt makes identical passwords collide", () => {
			// This is exactly why the old scheme was unsafe: no per-user salt.
			expect(legacyHashPassword("hunter2")).toBe(legacyHashPassword("hunter2"));
		});

		it("detects legacy vs bcrypt hashes by format", async () => {
			expect(isLegacyPasswordHash(legacyHashPassword("x"))).toBe(true);
			expect(isLegacyPasswordHash(await hashPassword("x"))).toBe(false);
		});
	});

	describe("verifyPassword", () => {
		it("verifies a bcrypt hash", async () => {
			const hash = await hashPassword("correct horse");
			expect(await verifyPassword("correct horse", hash)).toBe(true);
			expect(await verifyPassword("wrong horse", hash)).toBe(false);
		});

		it("still verifies a legacy SHA-256 hash (backwards compatible)", async () => {
			const legacy = legacyHashPassword("legacypass");
			expect(await verifyPassword("legacypass", legacy)).toBe(true);
			expect(await verifyPassword("nope", legacy)).toBe(false);
		});
	});
});
