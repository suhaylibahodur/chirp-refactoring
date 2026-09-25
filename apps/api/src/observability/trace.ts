import { randomUUID } from "node:crypto";
import type { RpcMetadata } from "@protobuf-ts/runtime-rpc";

/** Metadata key used to carry the trace id inbound (client) and outbound (trailer). */
export const TRACE_HEADER = "x-trace-id";

/** Generate a fresh trace id for a request that arrived without one. */
export function newTraceId(): string {
	return randomUUID();
}

/**
 * Read an inbound trace id from request metadata, if the client supplied one
 * (enables trace continuity across service hops). Returns `undefined` otherwise.
 */
export function extractTraceId(headers?: Readonly<RpcMetadata>): string | undefined {
	if (!headers) return undefined;
	const value = headers[TRACE_HEADER];
	const traceId = Array.isArray(value) ? value[0] : value;
	return traceId && traceId.length > 0 ? traceId : undefined;
}
