/**
 * Unified application error taxonomy.
 *
 * The enum values are intentionally identical to the `@grpc/grpc-js` `status`
 * enum member *names* (e.g. "NOT_FOUND", "UNAUTHENTICATED"). This lets the gRPC
 * layer translate a code straight to a status: `@protobuf-ts/grpc-backend`
 * resolves an `RpcError.code` string against the grpc status enum by name.
 */
export enum AppErrorCode {
	UNAUTHENTICATED = "UNAUTHENTICATED",
	PERMISSION_DENIED = "PERMISSION_DENIED",
	NOT_FOUND = "NOT_FOUND",
	ALREADY_EXISTS = "ALREADY_EXISTS",
	INVALID_ARGUMENT = "INVALID_ARGUMENT",
	FAILED_PRECONDITION = "FAILED_PRECONDITION",
	INTERNAL = "INTERNAL",
}

/**
 * Base class for all typed domain errors. Services and middleware should throw
 * these (or a subclass) so the boundary can classify by type instead of
 * matching on message strings.
 */
export class AppError extends Error {
	readonly code: AppErrorCode;

	constructor(code: AppErrorCode, message: string) {
		super(message);
		this.name = "AppError";
		this.code = code;
		// Restore the prototype chain when extending a built-in.
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

export class UnauthenticatedError extends AppError {
	constructor(message = "Authentication required") {
		super(AppErrorCode.UNAUTHENTICATED, message);
		this.name = "UnauthenticatedError";
	}
}

export class PermissionError extends AppError {
	constructor(message = "Permission denied") {
		super(AppErrorCode.PERMISSION_DENIED, message);
		this.name = "PermissionError";
	}
}

export class NotFoundError extends AppError {
	constructor(message = "Not found") {
		super(AppErrorCode.NOT_FOUND, message);
		this.name = "NotFoundError";
	}
}

export class ConflictError extends AppError {
	constructor(message = "Already exists") {
		super(AppErrorCode.ALREADY_EXISTS, message);
		this.name = "ConflictError";
	}
}

export class ValidationError extends AppError {
	constructor(message = "Invalid argument") {
		super(AppErrorCode.INVALID_ARGUMENT, message);
		this.name = "ValidationError";
	}
}

export class PreconditionError extends AppError {
	constructor(message = "Failed precondition") {
		super(AppErrorCode.FAILED_PRECONDITION, message);
		this.name = "PreconditionError";
	}
}

export class InternalError extends AppError {
	constructor(message = "Internal error") {
		super(AppErrorCode.INTERNAL, message);
		this.name = "InternalError";
	}
}
