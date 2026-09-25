import { AppError, AppErrorCode } from "./app-error";

export interface ClassifiedError {
	/** Taxonomy code (also a valid gRPC status name). */
	code: AppErrorCode;
	/** The original human-readable message (unchanged). */
	message: string;
	/** True when this is an unexpected/internal failure that must be masked on the wire. */
	isInternal: boolean;
}

/**
 * Exact-match registry for the plain-`Error` messages the service layer still
 * throws today. Typed `AppError`s bypass this table entirely (classified by
 * their `.code`). This registry is the transitional bridge until every service
 * throws a typed error; anything unmatched falls through to INTERNAL.
 */
const EXACT: Record<string, AppErrorCode> = {
	// Authentication
	"Invalid or expired session token": AppErrorCode.UNAUTHENTICATED,
	"Invalid token": AppErrorCode.UNAUTHENTICATED,
	"Authentication required": AppErrorCode.UNAUTHENTICATED,
	// Authorization
	Unauthorized: AppErrorCode.PERMISSION_DENIED,
	"Admin access required": AppErrorCode.PERMISSION_DENIED,
	"Super admin access required": AppErrorCode.PERMISSION_DENIED,
	"You can only edit your own posts": AppErrorCode.PERMISSION_DENIED,
	"You can only delete your own posts": AppErrorCode.PERMISSION_DENIED,
	"You can only delete your own comments": AppErrorCode.PERMISSION_DENIED,
	// Conflicts
	"Username already taken": AppErrorCode.ALREADY_EXISTS,
	"User with this email already exists": AppErrorCode.ALREADY_EXISTS,
	"Email already exists": AppErrorCode.ALREADY_EXISTS,
	// Validation
	"Post content is required": AppErrorCode.INVALID_ARGUMENT,
	"Post content must be 280 characters or less": AppErrorCode.INVALID_ARGUMENT,
	"Post content exceeds 280 characters": AppErrorCode.INVALID_ARGUMENT,
	"Comment content is required": AppErrorCode.INVALID_ARGUMENT,
	"Invalid role": AppErrorCode.INVALID_ARGUMENT,
	"Invalid email or password": AppErrorCode.INVALID_ARGUMENT,
	"Invalid credentials": AppErrorCode.INVALID_ARGUMENT,
	// Preconditions
	"Edit window has expired (5 minutes)": AppErrorCode.FAILED_PRECONDITION,
	"Cannot reply to a reply": AppErrorCode.FAILED_PRECONDITION,
	"Cannot ban admin users": AppErrorCode.FAILED_PRECONDITION,
	"Cannot delete admin users": AppErrorCode.FAILED_PRECONDITION,
	"You cannot follow yourself": AppErrorCode.FAILED_PRECONDITION,
	"User is not banned": AppErrorCode.FAILED_PRECONDITION,
};

/** Fallback pattern matches for dynamic messages not covered by EXACT. */
function matchByPattern(message: string): AppErrorCode | undefined {
	if (/ not found$/i.test(message)) return AppErrorCode.NOT_FOUND;
	if (/^Account banned/i.test(message)) return AppErrorCode.PERMISSION_DENIED;
	if (/already (exists|taken)/i.test(message)) return AppErrorCode.ALREADY_EXISTS;
	return undefined;
}

/**
 * Classify any thrown value into the error taxonomy.
 *
 * - `AppError` → its own code (authoritative).
 * - plain `Error` → EXACT registry, then pattern match, else INTERNAL.
 * - anything else (string, undefined, ...) → INTERNAL, using `fallbackMessage`.
 */
export function classifyError(error: unknown, fallbackMessage = "Internal error"): ClassifiedError {
	if (error instanceof AppError) {
		return {
			code: error.code,
			message: error.message,
			isInternal: error.code === AppErrorCode.INTERNAL,
		};
	}

	if (error instanceof Error) {
		const code = EXACT[error.message] ?? matchByPattern(error.message);
		if (code) {
			return { code, message: error.message, isInternal: false };
		}
		return { code: AppErrorCode.INTERNAL, message: error.message, isInternal: true };
	}

	return { code: AppErrorCode.INTERNAL, message: fallbackMessage, isInternal: true };
}
