/**
 * Express application entry point for MotionAI backend.
 *
 * Startup sequence:
 *  1. Validate environment variables (fails fast).
 *  2. Ensure TEMP_DIR exists on disk.
 *  3. Register middleware (helmet, cors, json, request-id, logger).
 *  4. Mount API routes.
 *  5. Register global error handler.
 *  6. Start BullMQ render worker.
 *  7. Start HTTP server.
 *  8. Register SIGTERM/SIGINT handlers for graceful shutdown.
 */

import "dotenv/config";
import { createServer } from "http";
import express, {
  type Request,
  type Response,
  type NextFunction,
  type ErrorRequestHandler,
} from "express";
import helmet from "helmet";
import cors from "cors";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

// Config & utils — import env first so Zod validates before anything else runs
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";

// Routes
import animationRoutes from "./routes/animation.routes.js";
import projectRoutes from "./routes/project.routes.js";

// Worker
import { createRenderWorker } from "./workers/render.worker.js";

// Queue (imported to establish Redis connection early)
import { renderQueue } from "./queues/render.queue.js";
import {
  closeRealtimeServer,
  initializeRealtimeServer,
  WEBSOCKET_PATH,
} from "./services/realtime.service.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const app = express();

// ── Security headers ────────────────────────────────────────────────────────
app.use(helmet());

// ── CORS ────────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: env.NODE_ENV === "development" ? "*" : undefined,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// ── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: "30mb" }));

// ── Request ID middleware ────────────────────────────────────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  res.locals["requestId"] = uuidv4();
  res.setHeader("X-Request-ID", res.locals["requestId"] as string);
  next();
});

// ── Request logger ───────────────────────────────────────────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();

  res.on("finish", () => {
    logger.info({
      msg: "HTTP request",
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - startTime,
      requestId: res.locals["requestId"],
    });
  });

  next();
});

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── API routes ───────────────────────────────────────────────────────────────
app.use("/api/animation", animationRoutes);
app.use("/api/projects", projectRoutes);

// ── 404 handler ──────────────────────────────────────────────────────────────
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: `Route ${req.method} ${req.path} not found`,
    requestId: res.locals["requestId"] as string,
  });
});

// ── Global error handler ─────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const errorHandler: ErrorRequestHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  const requestId = res.locals["requestId"] as string;

  // Log full error internally (with stack trace)
  logger.error({
    msg: "Unhandled error",
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    requestId,
  });

  // Never expose stack traces in production
  const message =
    env.NODE_ENV === "production"
      ? "An internal server error occurred"
      : err instanceof Error
        ? err.message
        : "An internal server error occurred";

  res.status(500).json({ error: message, requestId });
};

app.use(errorHandler);

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function start(): Promise<void> {
  // 1. Ensure scratch directory exists
  fs.mkdirSync(env.TEMP_DIR, { recursive: true });
  logger.info({ msg: "Temp directory ready", path: env.TEMP_DIR });

  // 2. Start BullMQ render worker
  const worker = createRenderWorker();

  // 3. Start HTTP + WebSocket server
  const server = createServer(app);
  await initializeRealtimeServer(server);

  server.listen(env.PORT, () => {
    logger.info({
      msg: "🚀 MotionAI server started",
      port: env.PORT,
      env: env.NODE_ENV,
      websocketPath: WEBSOCKET_PATH,
    });
  });

  // ---------------------------------------------------------------------------
  // Graceful shutdown
  // ---------------------------------------------------------------------------

  async function shutdown(signal: string): Promise<void> {
    logger.info({ msg: `Received ${signal}, starting graceful shutdown` });

    // Stop accepting new HTTP connections
    server.close(() => {
      logger.info({ msg: "HTTP server closed" });
    });

    // Wait for active BullMQ jobs to finish (up to 30s)
    const shutdownTimeout = setTimeout(() => {
      logger.warn({ msg: "Graceful shutdown timed out, forcing exit" });
      process.exit(1);
    }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);

    try {
      await closeRealtimeServer();
      await worker.close();
      await renderQueue.close();
      logger.info({ msg: "Worker, queue, and realtime server closed cleanly" });
    } catch (err) {
      logger.error({
        msg: "Error during worker shutdown",
        error: (err as Error).message,
      });
    } finally {
      clearTimeout(shutdownTimeout);
      process.exit(0);
    }
  }

  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
}

start().catch((err: unknown) => {
  logger.error({ msg: "Fatal startup error", error: (err as Error).message });
  process.exit(1);
});

export default app;
