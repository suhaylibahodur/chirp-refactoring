import type { RpcMetadata } from "@protobuf-ts/runtime-rpc";
import { RpcError } from "@protobuf-ts/runtime-rpc";
import type { ClassifiedError } from "./classify";

/**
 * Build an `RpcError` for the gRPC boundary from a classified error.
 *
 * `@protobuf-ts/grpc-backend` maps `RpcError.code` (a string) to a gRPC status
 * by matching the grpc status enum name — and our `AppErrorCode` values are
 * exactly those names, so no extra lookup is needed.
 *
 * Internal errors are masked: the client sees a generic detail while the real
 * message/stack is logged separately. Known domain errors pass their message
 * through unchanged (clients and tests depend on these strings).
 */
export function toRpcError(info: ClassifiedError, meta?: RpcMetadata): RpcError {
	const detail = info.isInternal ? "Internal error" : info.message;
	return new RpcError(detail, info.code, meta);
}
