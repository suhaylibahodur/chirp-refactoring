import { node } from "@elysiajs/node";
import { Elysia } from "elysia";
import { startGrpcServer } from "./grpc/server";
import { logger } from "./observability/logger";

const GRPC_PORT = Number(process.env.GRPC_PORT) || 50051;
const HTTP_PORT = Number(process.env.HTTP_PORT) || 3001;

// Start gRPC server first — health check must not report ok until gRPC is ready
const grpcServer = await startGrpcServer(GRPC_PORT);

// Start Elysia HTTP server for health checks (only after gRPC is bound)
const app = new Elysia({ adapter: node() })
	.get("/health", () => ({ status: "ok", grpc: `localhost:${GRPC_PORT}` }))
	.get("/", () => ({
		name: "Chirp API",
		version: "1.0.0",
		grpcPort: GRPC_PORT,
		httpPort: HTTP_PORT,
	}))
	.listen(HTTP_PORT);

logger.info("Chirp API started", { httpPort: HTTP_PORT, grpcPort: GRPC_PORT });

// Graceful shutdown
process.on("SIGTERM", () => {
	logger.info("shutting down", { signal: "SIGTERM" });
	grpcServer.forceShutdown();
	process.exit(0);
});

process.on("SIGINT", () => {
	logger.info("shutting down", { signal: "SIGINT" });
	grpcServer.forceShutdown();
	process.exit(0);
});

export { app, grpcServer };
