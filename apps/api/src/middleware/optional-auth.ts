import { classifyError } from "../errors/classify";
import { logger } from "../observability/logger";
import { validateSessionToken } from "./auth";

/**
 * Resolve an optional session token for endpoints that allow public access.
 *
 * A missing or invalid token yields `undefined` (anonymous) — the endpoint
 * proceeds with public data, exactly as before. Unlike the previous inline
 * `try/catch {}` blocks, the failure is now recorded (at debug) with its
 * classified code, so anonymous fallbacks are observable rather than silent.
 *
 * `validateSessionToken` only performs JWT verification, so its failures are
 * always authentication failures; there is no infrastructure error to leak.
 */
export function resolveOptionalAuth(token?: string): string | undefined {
	if (!token) return undefined;
	try {
		return validateSessionToken(token).userId;
	} catch (error) {
		logger.debug("optional auth: proceeding anonymously", { code: classifyError(error).code });
		return undefined;
	}
}
