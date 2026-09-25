import bcrypt from "bcryptjs";
import { createHash, timingSafeEqual } from "crypto";

/** Work factor for bcrypt. ~cost 12 is a common 2020s default. */
const BCRYPT_COST = 12;

/**
 * Generate a simple ID
 */
export function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Legacy SHA-256 hashing (fast digest + static shared salt). INSECURE — retained
 * only so that already-seeded users can still be verified during the incremental
 * migration to bcrypt. Do not use for new hashes; see {@link hashPassword}.
 */
export function legacyHashPassword(password: string): string {
	const hash = createHash("sha256");
	hash.update(`${password}salt`);
	return hash.digest("hex");
}

/**
 * Returns true if a stored hash was produced by the legacy SHA-256 scheme rather
 * than bcrypt. bcrypt hashes always start with "$2" (e.g. "$2a$", "$2b$"); legacy
 * hashes are bare 64-char hex, so anything not starting with "$2" is legacy.
 */
export function isLegacyPasswordHash(storedHash: string): boolean {
	return !storedHash.startsWith("$2");
}

/**
 * Hash a password with bcrypt (per-hash random salt is built in).
 */
export async function hashPassword(password: string): Promise<string> {
	return bcrypt.hash(password, BCRYPT_COST);
}

/**
 * Verify a password against a stored hash. Transparently accepts both bcrypt
 * hashes and legacy SHA-256 hashes so existing users keep working during migration.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
	if (isLegacyPasswordHash(storedHash)) {
		// Constant-time comparison of the legacy digests.
		const candidate = Buffer.from(legacyHashPassword(password));
		const expected = Buffer.from(storedHash);
		if (candidate.length !== expected.length) {
			return false;
		}
		return timingSafeEqual(candidate, expected);
	}
	return bcrypt.compare(password, storedHash);
}

/**
 * Convert Date to protobuf Timestamp
 */
export function toProtoTimestamp(date: Date): { seconds: bigint; nanos: number } {
	const ms = date.getTime();
	return {
		seconds: BigInt(Math.floor(ms / 1000)),
		nanos: (ms % 1000) * 1000000,
	};
}

/**
 * Convert protobuf Timestamp to Date
 */
export function fromProtoTimestamp(timestamp: { seconds: bigint; nanos: number }): Date {
	return new Date(Number(timestamp.seconds) * 1000 + timestamp.nanos / 1000000);
}
