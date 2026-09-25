import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request context propagated implicitly through the async call tree
 * (handler → service → db) via `AsyncLocalStorage`, so the trace id reaches
 * every log line without threading an argument through each function.
 */
export interface RequestContext {
	traceId: string;
	method: string;
	userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with the given request context active for its entire async subtree. */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
	return storage.run(context, fn);
}

/** The active request context, or `undefined` outside of a request. */
export function getContext(): RequestContext | undefined {
	return storage.getStore();
}

/** Attach the resolved user id to the active context (for log correlation). */
export function setUserId(userId: string): void {
	const context = storage.getStore();
	if (context) {
		context.userId = userId;
	}
}
