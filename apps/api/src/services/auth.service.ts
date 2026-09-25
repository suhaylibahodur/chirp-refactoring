import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { type AuthContext, createSessionToken } from "../middleware/auth";
import { generateId, hashPassword, isLegacyPasswordHash, verifyPassword } from "./utils";

const { users } = schema;

export interface RegisterInput {
	email: string;
	username: string;
	displayName: string;
	password: string;
}

export interface LoginInput {
	email: string;
	password: string;
}

export async function registerUser(input: RegisterInput) {
	// Check if email already exists
	const existingEmail = await db.select().from(users).where(eq(users.email, input.email)).get();

	if (existingEmail) {
		throw new Error("User with this email already exists");
	}

	// Check if username already exists
	const existingUsername = await db
		.select()
		.from(users)
		.where(eq(users.username, input.username))
		.get();

	if (existingUsername) {
		throw new Error("Username already taken");
	}

	// Hash password
	const passwordHash = await hashPassword(input.password);

	// Create user
	const userId = generateId();
	await db.insert(users).values({
		id: userId,
		email: input.email,
		username: input.username,
		displayName: input.displayName,
		passwordHash,
		role: "user",
	});

	// Create session token
	const sessionToken = createSessionToken({
		userId,
		username: input.username,
		role: "user",
	});

	return { userId, sessionToken };
}

export async function loginUser(input: LoginInput) {
	// Find user by email
	const user = await db.select().from(users).where(eq(users.email, input.email)).get();

	if (!user) {
		throw new Error("Invalid email or password");
	}

	// Check if user is banned
	if (user.bannedAt) {
		throw new Error(`Account banned: ${user.bannedReason || "No reason provided"}`);
	}

	// Verify password
	const valid = await verifyPassword(input.password, user.passwordHash);
	if (!valid) {
		throw new Error("Invalid email or password");
	}

	// Incremental migration: if the stored hash is a legacy SHA-256 hash, we now
	// hold the plaintext for this instant, so upgrade it to bcrypt transparently.
	// Best-effort: the password is already verified, so a failed upgrade must not
	// block an otherwise-valid login — the user stays logged in and simply remains
	// on the legacy hash until their next login retries the upgrade.
	if (isLegacyPasswordHash(user.passwordHash)) {
		try {
			const upgradedHash = await hashPassword(input.password);
			await db.update(users).set({ passwordHash: upgradedHash }).where(eq(users.id, user.id));
		} catch (error) {
			console.error(`Failed to upgrade password hash for user ${user.id}:`, error);
		}
	}

	// Create session token
	const sessionToken = createSessionToken({
		userId: user.id,
		username: user.username,
		role: user.role as AuthContext["role"],
	});

	return { userId: user.id, sessionToken };
}

export async function getCurrentUser(userId: string) {
	const user = await db
		.select({
			id: users.id,
			email: users.email,
			username: users.username,
			displayName: users.displayName,
			avatarUrl: users.avatarUrl,
			bio: users.bio,
			role: users.role,
			createdAt: users.createdAt,
		})
		.from(users)
		.where(eq(users.id, userId))
		.get();

	if (!user) {
		throw new Error("User not found");
	}

	return user;
}
