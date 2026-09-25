import { getContext } from "./context";

/**
 * Structured JSON logger. Emits one JSON object per line to stdout. Every line
 * is automatically enriched with the active request context (traceId, method,
 * userId) so logs across the handler → service boundary correlate.
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<Level | "silent", number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
	silent: 100,
};

function resolveThreshold(): number {
	const configured = process.env.LOG_LEVEL?.toLowerCase() as Level | "silent" | undefined;
	if (configured && configured in LEVEL_WEIGHT) {
		return LEVEL_WEIGHT[configured];
	}
	// Keep test output clean unless a level is explicitly requested.
	if (process.env.VITEST) return LEVEL_WEIGHT.silent;
	return LEVEL_WEIGHT.info;
}

const threshold = resolveThreshold();

type Fields = Record<string, unknown>;

/** Serialize an unknown thrown value into a safe, JSON-friendly shape. */
export function serializeError(error: unknown): Fields {
	if (error instanceof Error) {
		return { name: error.name, message: error.message, stack: error.stack };
	}
	return { value: String(error) };
}

function emit(level: Level, msg: string, fields?: Fields): void {
	if (LEVEL_WEIGHT[level] < threshold) return;

	const context = getContext();
	const line: Fields = {
		ts: new Date().toISOString(),
		level,
		msg,
		...(context
			? { traceId: context.traceId, method: context.method, userId: context.userId }
			: {}),
		...fields,
	};

	try {
		process.stdout.write(`${JSON.stringify(line)}\n`);
	} catch {
		// Never let logging throw into the request path.
	}
}

export const logger = {
	debug: (msg: string, fields?: Fields) => emit("debug", msg, fields),
	info: (msg: string, fields?: Fields) => emit("info", msg, fields),
	warn: (msg: string, fields?: Fields) => emit("warn", msg, fields),
	error: (msg: string, fields?: Fields) => emit("error", msg, fields),
};
