import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { createTestUser } from "../../tests/helpers";
import { db, schema } from "../db";
import { type AuthContext, getJwtSecret, requireAdmin, requireSuperAdmin } from "./auth";

const { users } = schema;

const authFor = (userId: string, role: AuthContext["role"] = "user"): AuthContext => ({
	userId,
	username: "whoever",
	// The claim is deliberately set high to prove authorization ignores it.
	role,
});

describe("getJwtSecret (fail-closed)", () => {
	const original = process.env.GRPC_JWT_SECRET;

	afterEach(() => {
		if (original === undefined) {
			delete process.env.GRPC_JWT_SECRET;
		} else {
			process.env.GRPC_JWT_SECRET = original;
		}
	});

	it("throws when the secret is unset", () => {
		delete process.env.GRPC_JWT_SECRET;
		expect(() => getJwtSecret()).toThrow(/GRPC_JWT_SECRET/);
	});

	it("throws when the secret is too short", () => {
		process.env.GRPC_JWT_SECRET = "too-short";
		expect(() => getJwtSecret()).toThrow(/at least 32/);
	});

	it("returns the secret when it is present and long enough", () => {
		process.env.GRPC_JWT_SECRET = "a-sufficiently-long-secret-value-32c";
		expect(getJwtSecret()).toBe("a-sufficiently-long-secret-value-32c");
	});
});

describe("role checks are verified against the database, not the token claim", () => {
	it("rejects a token that CLAIMS admin when the DB says the user is not privileged", async () => {
		const user = await createTestUser({ role: "user" });
		// Token claim says admin; DB says user. DB must win.
		await expect(requireAdmin(authFor(user.id, "admin"))).rejects.toThrow("Admin access required");
		await expect(requireSuperAdmin(authFor(user.id, "admin"))).rejects.toThrow(
			"Super admin access required",
		);
	});

	it("allows a genuine admin", async () => {
		const admin = await createTestUser({ role: "admin" });
		await expect(requireAdmin(authFor(admin.id))).resolves.toBeUndefined();
		await expect(requireSuperAdmin(authFor(admin.id))).resolves.toBeUndefined();
	});

	it("allows a moderator through requireAdmin but NOT requireSuperAdmin", async () => {
		const mod = await createTestUser({ role: "moderator" });
		await expect(requireAdmin(authFor(mod.id))).resolves.toBeUndefined();
		await expect(requireSuperAdmin(authFor(mod.id))).rejects.toThrow("Super admin access required");
	});

	it("rejects a banned user even if their DB role is admin", async () => {
		const admin = await createTestUser({ role: "admin" });
		await db.update(users).set({ bannedAt: new Date() }).where(eq(users.id, admin.id));
		await expect(requireAdmin(authFor(admin.id, "admin"))).rejects.toThrow("Admin access required");
	});

	it("rejects a non-existent user", async () => {
		await expect(requireAdmin(authFor("does-not-exist", "admin"))).rejects.toThrow(
			"Admin access required",
		);
	});
});
