import type { GrpcSessionPayload } from "@chirp/shared-types";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { db, schema } from "../db";

const { users } = schema;

/** Minimum acceptable length for the shared gRPC JWT secret. */
const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Returns the shared gRPC JWT secret, or throws if it is missing or too weak.
 * There is deliberately no insecure default: the process must be configured with a
 * real secret, otherwise anyone knowing a hardcoded value could forge session tokens.
 */
export function getJwtSecret(): string {
	const secret = process.env.GRPC_JWT_SECRET;
	if (!secret || secret.length < MIN_JWT_SECRET_LENGTH) {
		throw new Error(
			`GRPC_JWT_SECRET must be set and at least ${MIN_JWT_SECRET_LENGTH} characters long`,
		);
	}
	return secret;
}

/**
 * Fail-closed startup assertion: call this before the server begins serving so a
 * misconfigured deployment refuses to start rather than running on a known secret.
 */
export function assertGrpcJwtSecret(): void {
	getJwtSecret();
}

export interface AuthContext {
	userId: string;
	username: string;
	role: "user" | "admin" | "moderator";
}

/**
 * Validates a session token and returns the auth context.
 * NOTE: the `role` here is the (client-signed) token claim. It is fine for identity
 * and logging, but authorization decisions must NOT trust it — see requireAdmin /
 * requireSuperAdmin, which resolve the role from the database instead.
 */
export function validateSessionToken(token: string): AuthContext {
	try {
		const decoded = jwt.verify(token, getJwtSecret()) as GrpcSessionPayload;
		return {
			userId: decoded.userId,
			username: decoded.username,
			role: decoded.role,
		};
	} catch (error) {
		throw new Error("Invalid or expired session token");
	}
}

/**
 * Creates a session token from auth context
 */
export function createSessionToken(
	context: AuthContext,
	expiresInSeconds: number = 7 * 24 * 60 * 60,
): string {
	return jwt.sign(
		{
			userId: context.userId,
			username: context.username,
			role: context.role,
		},
		getJwtSecret(),
		{ expiresIn: expiresInSeconds },
	);
}

/**
 * Resolves a user's authoritative role from the database, or null if the user does
 * not exist or is banned. This is the trust boundary: authority comes from the DB,
 * never from the token claim.
 */
async function resolveDbRole(userId: string): Promise<AuthContext["role"] | null> {
	const user = await db
		.select({ role: users.role, bannedAt: users.bannedAt })
		.from(users)
		.where(eq(users.id, userId))
		.get();

	if (!user || user.bannedAt) {
		return null;
	}
	return user.role as AuthContext["role"];
}

/**
 * Requires authentication - throws if token is invalid
 */
export function requireAuth(token: string | undefined): AuthContext {
	if (!token) {
		throw new Error("Authentication required");
	}
	return validateSessionToken(token);
}

/**
 * Requires admin OR moderator role, verified against the database (not the token
 * claim). Throws if the user is not privileged, is banned, or no longer exists.
 */
export async function requireAdmin(context: AuthContext): Promise<void> {
	const role = await resolveDbRole(context.userId);
	if (role !== "admin" && role !== "moderator") {
		throw new Error("Admin access required");
	}
}

/**
 * Requires admin role specifically, verified against the database. Used to gate
 * genuinely privileged mutations (role changes, user deletion) so that a moderator
 * cannot reach them — including to promote themselves to admin.
 */
export async function requireSuperAdmin(context: AuthContext): Promise<void> {
	const role = await resolveDbRole(context.userId);
	if (role !== "admin") {
		throw new Error("Super admin access required");
	}
}
