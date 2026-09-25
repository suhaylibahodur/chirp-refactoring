import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestUser } from "../../tests/helpers";
import { db, schema } from "../db";
import { getCurrentUser, loginUser, registerUser } from "./auth.service";
import { isLegacyPasswordHash } from "./utils";

const { users } = schema;

describe("AuthService", () => {
	describe("registerUser", () => {
		it("registers a new user with valid input", async () => {
			const result = await registerUser({
				email: "new@example.com",
				username: "newuser",
				displayName: "New User",
				password: "password123",
			});

			expect(result.userId).toBeDefined();
			expect(result.sessionToken).toBeDefined();

			// Verify user was created in database
			const user = await db.select().from(users).where(eq(users.id, result.userId)).get();

			expect(user).toBeDefined();
			expect(user?.email).toBe("new@example.com");
			expect(user?.username).toBe("newuser");
			expect(user?.role).toBe("user");
		});

		it("rejects duplicate email", async () => {
			await createTestUser({ email: "taken@example.com" });

			await expect(
				registerUser({
					email: "taken@example.com",
					username: "newuser",
					displayName: "New User",
					password: "password123",
				}),
			).rejects.toThrow("User with this email already exists");
		});

		it("rejects duplicate username", async () => {
			await createTestUser({ username: "takenname" });

			await expect(
				registerUser({
					email: "new@example.com",
					username: "takenname",
					displayName: "New User",
					password: "password123",
				}),
			).rejects.toThrow("Username already taken");
		});
	});

	describe("loginUser", () => {
		it("logs in with valid credentials", async () => {
			await createTestUser({
				email: "login@example.com",
				password: "correctpassword",
			});

			const result = await loginUser({
				email: "login@example.com",
				password: "correctpassword",
			});

			expect(result.userId).toBeDefined();
			expect(result.sessionToken).toBeDefined();
		});

		it("logs in a legacy (SHA-256) user and upgrades their hash to bcrypt", async () => {
			const user = await createTestUser({
				email: "legacy@example.com",
				password: "legacypass",
				legacyHash: true,
			});

			// Precondition: seeded with a legacy hash.
			const before = await db.select().from(users).where(eq(users.id, user.id)).get();
			expect(isLegacyPasswordHash(before?.passwordHash)).toBe(true);

			const result = await loginUser({
				email: "legacy@example.com",
				password: "legacypass",
			});
			expect(result.sessionToken).toBeDefined();

			// The stored hash is transparently migrated to bcrypt on successful login.
			const after = await db.select().from(users).where(eq(users.id, user.id)).get();
			expect(after?.passwordHash.startsWith("$2")).toBe(true);
			expect(after?.passwordHash).not.toBe(before?.passwordHash);
		});

		it("stores new registrations with a bcrypt hash", async () => {
			const { userId } = await registerUser({
				email: "fresh@example.com",
				username: "freshuser",
				displayName: "Fresh User",
				password: "password123",
			});

			const user = await db.select().from(users).where(eq(users.id, userId)).get();
			expect(user?.passwordHash.startsWith("$2")).toBe(true);
		});

		it("rejects invalid email", async () => {
			await expect(
				loginUser({
					email: "nonexistent@example.com",
					password: "password123",
				}),
			).rejects.toThrow("Invalid email or password");
		});

		it("rejects invalid password", async () => {
			await createTestUser({
				email: "user@example.com",
				password: "correctpassword",
			});

			await expect(
				loginUser({
					email: "user@example.com",
					password: "wrongpassword",
				}),
			).rejects.toThrow("Invalid email or password");
		});

		it("rejects banned user", async () => {
			const user = await createTestUser({
				email: "banned@example.com",
				password: "password123",
			});

			// Ban the user
			await db
				.update(users)
				.set({
					bannedAt: new Date(),
					bannedReason: "Violated ToS",
				})
				.where(eq(users.id, user.id));

			await expect(
				loginUser({
					email: "banned@example.com",
					password: "password123",
				}),
			).rejects.toThrow("Account banned: Violated ToS");
		});
	});

	describe("getCurrentUser", () => {
		it("returns user data for valid userId", async () => {
			const testUser = await createTestUser({
				email: "current@example.com",
				username: "currentuser",
				displayName: "Current User",
			});

			const user = await getCurrentUser(testUser.id);

			expect(user.id).toBe(testUser.id);
			expect(user.email).toBe("current@example.com");
			expect(user.username).toBe("currentuser");
			expect(user.displayName).toBe("Current User");
			expect(user.role).toBe("user");
		});

		it("throws for non-existent user", async () => {
			await expect(getCurrentUser("nonexistent-id")).rejects.toThrow("User not found");
		});
	});
});
