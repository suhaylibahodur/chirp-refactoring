/**
 * Test utility that counts the number of SQL round-trips an operation performs.
 *
 * The test `db` module (mocked in tests/setup.ts) exposes the underlying libsql
 * `client`. Drizzle issues exactly one `client.execute()` per SQL statement, so
 * counting those calls is an accurate proxy for the number of queries — which is
 * what the N+1 regression guard cares about.
 *
 * Usage:
 *   const { result, queries } = await countQueries(() => getHomeFeed(userId));
 *   expect(queries).toBeLessThanOrEqual(5);
 */

interface CountingClient {
	execute: (...args: unknown[]) => unknown;
}

export async function countQueries<T>(
	fn: () => Promise<T>,
): Promise<{ result: T; queries: number }> {
	// The mocked db module additionally exports the raw libsql client.
	const mod = (await import("../src/db")) as unknown as { client: CountingClient };
	const client = mod.client;

	const original = client.execute.bind(client);
	let queries = 0;
	client.execute = (...args: unknown[]) => {
		queries++;
		return original(...args);
	};

	try {
		const result = await fn();
		return { result, queries };
	} finally {
		client.execute = original;
	}
}
