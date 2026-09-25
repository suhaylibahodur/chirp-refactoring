import { logger, serializeError } from "../observability/logger";
import { AppErrorCode } from "./app-error";
import { classifyError } from "./classify";

/**
 * Build the error fields for an app-level `{ success: false, ... }` response.
 *
 * Preserves the exact human message contract (existing clients/tests depend on
 * `error` being the raw thrown message, or the per-method fallback for a
 * non-Error throw) while adding the machine-readable `errorCode` from the
 * taxonomy.
 */
export function errorFields(
	error: unknown,
	fallbackMessage: string,
): { error: string; errorCode: string } {
	const message = error instanceof Error ? error.message : fallbackMessage;
	const { code } = classifyError(error, fallbackMessage);
	return { error: message, errorCode: code };
}

/**
 * Log an error that a read handler intentionally swallows to return a safe
 * default (e.g. anonymous like/follow status). Auth failures are expected and
 * logged at debug; anything else is a real fault and logged at error so it is
 * no longer invisible in production.
 */
export function logSwallowed(error: unknown): void {
	const info = classifyError(error);
	if (info.code === AppErrorCode.UNAUTHENTICATED) {
		logger.debug("swallowed auth error; returning default", { code: info.code });
	} else {
		logger.error("swallowed error; returning default", {
			code: info.code,
			error: serializeError(error),
		});
	}
}
