import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestUser } from "../../tests/helpers";
import { db, schema } from "../db";
import { updateUserRole } from "./admin.service";

const { users } = schema;

describe("admin.service updateUserRole", () => {
	it("rejects an admin changing their own role (self-lockout / self-escalation guard)", async () => {
		const admin = await createTestUser({ role: "admin" });

		await expect(updateUserRole(admin.id, "user", admin.id)).rejects.toThrow(
			"Cannot change your own role",
		);

		// Role unchanged.
		const after = await db.select().from(users).where(eq(users.id, admin.id)).get();
		expect(after?.role).toBe("admin");
	});

	it("allows changing another user's role", async () => {
		const admin = await createTestUser({ role: "admin" });
		const target = await createTestUser({ role: "user" });

		await updateUserRole(target.id, "moderator", admin.id);

		const after = await db.select().from(users).where(eq(users.id, target.id)).get();
		expect(after?.role).toBe("moderator");
	});

	it("rejects an invalid role value", async () => {
		const admin = await createTestUser({ role: "admin" });
		const target = await createTestUser({ role: "user" });

		await expect(updateUserRole(target.id, "superuser", admin.id)).rejects.toThrow("Invalid role");
	});
});
