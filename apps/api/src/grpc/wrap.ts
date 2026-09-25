import type { ServerCallContext } from "@protobuf-ts/runtime-rpc";
import { classifyError } from "../errors/classify";
import { toRpcError } from "../errors/to-grpc";
import { runWithContext } from "../observability/context";
import { logger, serializeError } from "../observability/logger";
import { extractTraceId, newTraceId, TRACE_HEADER } from "../observability/trace";

// Handlers receive `(request, context?)`. The `@protobuf-ts/grpc-backend`
// adapter always passes a `ServerCallContext`; unit tests call handlers with the
// request only, so `context` must be treated as optional.
type HandlerFn = (request: any, context?: ServerCallContext) => Promise<any>;

/**
 * Cross-cutting boundary for every gRPC method:
 *  1. establishes/propagates a trace id (honoring an inbound `x-trace-id`),
 *  2. returns the trace id to the client via response trailers,
 *  3. emits structured start/finish logs with duration,
 *  4. maps any uncaught error to the correct gRPC status (via `RpcError`),
 *     replacing the previous uncontrolled `UNKNOWN`/`INTERNAL` behavior.
 *
 * App-level `{ success: false }` responses are left untouched (contract
 * preserved) and logged as failures using their `errorCode`.
 */
export function withObservability<F extends HandlerFn>(methodName: string, fn: F): F {
	const wrapped = (request: any, context?: ServerCallContext) => {
		const traceId = extractTraceId(context?.headers) ?? newTraceId();
		if (context) {
			try {
				context.trailers[TRACE_HEADER] = traceId;
			} catch {
				// Trailers unavailable (e.g. in tests) — trace id still logged.
			}
		}

		return runWithContext({ traceId, method: methodName }, async () => {
			const start = Date.now();
			logger.info("request.start");
			try {
				const result = await fn(request, context);
				const durationMs = Date.now() - start;
				if (
					result &&
					typeof result === "object" &&
					(result as { success?: unknown }).success === false
				) {
					const payload = result as { error?: string; errorCode?: string };
					const code = payload.errorCode ?? classifyError(payload.error).code;
					logger.warn("request.failed", { durationMs, code, message: payload.error });
				} else {
					logger.info("request.ok", { durationMs });
				}
				return result;
			} catch (error) {
				const info = classifyError(error);
				const durationMs = Date.now() - start;
				if (info.isInternal) {
					logger.error("request.error", {
						durationMs,
						code: info.code,
						error: serializeError(error),
					});
				} else {
					logger.warn("request.error", { durationMs, code: info.code, message: info.message });
				}
				throw toRpcError(info, { [TRACE_HEADER]: traceId });
			}
		});
	};

	return wrapped as F;
}

/**
 * Wrap every method of a service handler implementation with
 * {@link withObservability}. Method log names are `ServiceName.methodName`.
 */
export function wrapHandler<T extends object>(serviceName: string, impl: T): T {
	const source = impl as Record<string, HandlerFn>;
	const wrapped: Record<string, HandlerFn> = {};
	for (const key of Object.keys(source)) {
		wrapped[key] = withObservability(`${serviceName}.${key}`, source[key].bind(source));
	}
	return wrapped as T;
}
