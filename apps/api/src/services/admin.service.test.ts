import { describe, expect, it } from "vitest";
import { createTestComment, createTestPost, createTestUser } from "../../tests/helpers";
import { countQueries } from "../../tests/query-counter";
import { db, schema } from "../db";
import { getAuditLogs, listReports, listUsers } from "./admin.service";
import { generateId } from "./utils";

async function insertReport(reporterId: string, createdAt?: Date) {
	await db.insert(schema.reports).values({
		id: generateId(),
		reporterId,
		targetType: "post",
		targetId: generateId(),
		reason: "spam",
		createdAt,
	});
}

async function insertAuditLog(adminId: string, createdAt?: Date) {
	await db.insert(schema.auditLogs).values({
		id: generateId(),
		adminId,
		action: "ban_user",
		createdAt,
	});
}

describe("AdminService", () => {
	describe("listUsers", () => {
		it("attaches authored post/comment counts per user", async () => {
			const u1 = await createTestUser();
			const u2 = await createTestUser();
			const p = await createTestPost(u1.id);
			await createTestPost(u1.id);
			await createTestComment(p, u2.id, "c");

			const { users, total } = await listUsers({ limit: 50 });
			expect(total).toBe(2);
			const first = users.find((u) => u.id === u1.id);
			const second = users.find((u) => u.id === u2.id);
			expect(first).toMatchObject({ postCount: 2, commentCount: 0 });
			expect(second).toMatchObject({ postCount: 0, commentCount: 1 });
		});

		it("runs a constant number of queries regardless of user count", async () => {
			for (let i = 0; i < 3; i++) await createTestUser();
			const { queries: few } = await countQueries(() => listUsers({ limit: 50 }));

			for (let i = 0; i < 15; i++) await createTestUser();
			const { queries: many } = await countQueries(() => listUsers({ limit: 50 }));

			expect(few).toBe(many);
			expect(many).toBeLessThanOrEqual(4); // 1 list + 2 batch counts + 1 total
		});
	});

	describe("listReports", () => {
		it("resolves reporter username via join", async () => {
			const reporter = await createTestUser({ username: "reporter-x" });
			await insertReport(reporter.id);

			const { reports, total } = await listReports({ limit: 50 });
			expect(total).toBe(1);
			expect(reports[0].reporterUsername).toBe("reporter-x");
			expect(reports[0].reporterId).toBe(reporter.id);
		});

		it("runs a constant number of queries regardless of report count", async () => {
			const reporter = await createTestUser();
			for (let i = 0; i < 3; i++) await insertReport(reporter.id, new Date(1000 + i));
			const { queries: few } = await countQueries(() => listReports({ limit: 50 }));

			for (let i = 3; i < 18; i++) await insertReport(reporter.id, new Date(1000 + i));
			const { queries: many } = await countQueries(() => listReports({ limit: 50 }));

			expect(few).toBe(many);
			expect(many).toBeLessThanOrEqual(2); // 1 joined list + 1 total
		});
	});

	describe("getAuditLogs", () => {
		it("resolves admin username via join", async () => {
			const admin = await createTestUser({ username: "admin-x", role: "admin" });
			await insertAuditLog(admin.id);

			const { logs, total } = await getAuditLogs({ limit: 50 });
			expect(total).toBe(1);
			expect(logs[0].adminUsername).toBe("admin-x");
			expect(logs[0].adminId).toBe(admin.id);
		});

		it("runs a constant number of queries regardless of log count", async () => {
			const admin = await createTestUser({ role: "admin" });
			for (let i = 0; i < 3; i++) await insertAuditLog(admin.id, new Date(1000 + i));
			const { queries: few } = await countQueries(() => getAuditLogs({ limit: 50 }));

			for (let i = 3; i < 18; i++) await insertAuditLog(admin.id, new Date(1000 + i));
			const { queries: many } = await countQueries(() => getAuditLogs({ limit: 50 }));

			expect(few).toBe(many);
			expect(many).toBeLessThanOrEqual(2); // 1 joined list + 1 total
		});
	});
});
