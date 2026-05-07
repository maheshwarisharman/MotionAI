/**
 * RealtimeService — websocket layer for job/project updates.
 *
 * Design:
 *  - Attaches a WebSocket server to the existing HTTP server at `/ws`
 *  - Uses Redis pub/sub so events fan out across horizontally scaled instances
 *  - Keeps only per-process socket subscription state in memory
 */

import type { IncomingMessage, Server as HttpServer } from "http";

import { Redis } from "ioredis";
import { WebSocketServer, WebSocket } from "ws";
import { v4 as uuidv4 } from "uuid";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { renderQueue } from "../queues/render.queue.js";
import { databaseService } from "./database.service.js";
import { getSupabaseAuthClient } from "./supabase.service.js";
import {
  estimateWaitSeconds,
  getJobStatus,
  inferRenderStage,
} from "./job-status.service.js";

import type {
  AuthUser,
  Project,
  RealtimeClientMessage,
  RealtimeErrorEvent,
  RealtimeProjectSnapshotEvent,
  RealtimeServerEvent,
} from "../types/index.js";

const REALTIME_CHANNEL = "motionai:realtime:events";
const WEBSOCKET_PATH = "/ws";

interface ConnectionState {
  connectionId: string;
  authUser: AuthUser | null;
  subscribedJobIds: Set<string>;
  subscribedProjectIds: Set<string>;
}

class RealtimeService {
  private readonly connections = new Map<WebSocket, ConnectionState>();
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;
  private webSocketServer: WebSocketServer | null = null;
  private initialized = false;

  async initialize(server: HttpServer): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.publisher = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    this.subscriber = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

    this.publisher.on("error", (err: Error) => {
      logger.error({
        msg: "Realtime Redis publisher error",
        error: err.message,
      });
    });

    this.subscriber.on("error", (err: Error) => {
      logger.error({
        msg: "Realtime Redis subscriber error",
        error: err.message,
      });
    });

    await this.subscriber.subscribe(REALTIME_CHANNEL);
    this.subscriber.on("message", (_channel, payload) => {
      this.handlePublishedEvent(payload);
    });

    this.webSocketServer = new WebSocketServer({
      server,
      path: WEBSOCKET_PATH,
    });
    this.webSocketServer.on("connection", (socket, request) => {
      void this.handleConnection(socket, request);
    });

    this.initialized = true;

    logger.info({
      msg: "Realtime websocket server initialized",
      path: WEBSOCKET_PATH,
      channel: REALTIME_CHANNEL,
    });
  }

  async close(): Promise<void> {
    const closeWebSocketServer = async (): Promise<void> => {
      if (!this.webSocketServer) {
        return;
      }

      await new Promise<void>((resolve, reject) => {
        this.webSocketServer?.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });

      this.webSocketServer = null;
    };

    const sockets = Array.from(this.connections.keys());
    for (const socket of sockets) {
      try {
        socket.close(1001, "Server shutting down");
      } catch {
        socket.terminate();
      }
    }
    this.connections.clear();

    await closeWebSocketServer();
    await this.subscriber?.quit();
    await this.publisher?.quit();

    this.subscriber = null;
    this.publisher = null;
    this.initialized = false;

    logger.info({ msg: "Realtime websocket server closed" });
  }

  async publish(event: RealtimeServerEvent): Promise<void> {
    if (!this.publisher) {
      throw new Error("Realtime service is not initialized");
    }

    await this.publisher.publish(REALTIME_CHANNEL, JSON.stringify(event));
  }

  private handlePublishedEvent(payload: string): void {
    try {
      const event = JSON.parse(payload) as RealtimeServerEvent;
      this.dispatchLocalEvent(event);
    } catch (err) {
      logger.error({
        msg: "Failed to parse realtime event payload",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async handleConnection(
    socket: WebSocket,
    request: IncomingMessage,
  ): Promise<void> {
    const connectionId = uuidv4();
    const authUser = await this.resolveAuthUser(request);

    this.connections.set(socket, {
      connectionId,
      authUser,
      subscribedJobIds: new Set<string>(),
      subscribedProjectIds: new Set<string>(),
    });

    logger.info({
      msg: "Realtime client connected",
      connectionId,
      origin: request.headers.origin,
      userId: authUser?.id ?? null,
    });

    this.send(socket, {
      type: "connection.ready",
      connectionId,
      timestamp: new Date().toISOString(),
    });

    socket.on("message", async (rawData) => {
      await this.handleClientMessage(socket, rawData.toString());
    });

    socket.on("close", () => {
      this.connections.delete(socket);
      logger.info({ msg: "Realtime client disconnected", connectionId });
    });

    socket.on("error", (err: Error) => {
      logger.error({
        msg: "Realtime socket error",
        connectionId,
        error: err.message,
      });
    });
  }

  private async handleClientMessage(
    socket: WebSocket,
    payload: string,
  ): Promise<void> {
    const state = this.connections.get(socket);

    if (!state) {
      return;
    }

    let message: RealtimeClientMessage;

    try {
      message = JSON.parse(payload) as RealtimeClientMessage;
    } catch {
      this.sendError(socket, "Invalid JSON payload", "INVALID_MESSAGE");
      return;
    }

    switch (message.type) {
      case "subscribe_job": {
        if (!message.jobId) {
          this.sendError(socket, "jobId is required", "INVALID_MESSAGE");
          return;
        }

        state.subscribedJobIds.add(message.jobId);
        this.send(socket, {
          type: "subscription.confirmed",
          scope: "job",
          jobId: message.jobId,
          timestamp: new Date().toISOString(),
        });

        const status = await getJobStatus(message.jobId);
        if (status) {
          await this.sendJobSnapshot(socket, message.jobId, status);
        }

        return;
      }

      case "unsubscribe_job": {
        state.subscribedJobIds.delete(message.jobId);
        return;
      }

      case "subscribe_project": {
        if (!message.projectId) {
          this.sendError(socket, "projectId is required", "INVALID_MESSAGE");
          return;
        }

        const accessibleProject = await databaseService.getAccessibleProject(
          message.projectId,
          state.authUser?.id ?? null,
        );
        if (!accessibleProject) {
          this.sendError(
            socket,
            `Project "${message.projectId}" not found`,
            "PROJECT_NOT_FOUND",
          );
          return;
        }

        state.subscribedProjectIds.add(message.projectId);
        this.send(socket, {
          type: "subscription.confirmed",
          scope: "project",
          projectId: message.projectId,
          timestamp: new Date().toISOString(),
        });

        await this.sendProjectSnapshot(socket, accessibleProject);
        return;
      }

      case "unsubscribe_project": {
        state.subscribedProjectIds.delete(message.projectId);
        return;
      }

      case "ping": {
        this.send(socket, {
          type: "pong",
          timestamp: new Date().toISOString(),
        });
        return;
      }

      default: {
        this.sendError(socket, "Unsupported message type", "INVALID_MESSAGE");
      }
    }
  }

  private async resolveAuthUser(
    request: IncomingMessage,
  ): Promise<AuthUser | null> {
    try {
      const host = request.headers.host ?? "localhost";
      const requestUrl = new URL(
        request.url ?? WEBSOCKET_PATH,
        `http://${host}`,
      );
      const accessToken = requestUrl.searchParams.get("access_token");

      if (!accessToken) {
        return null;
      }

      const authClient = getSupabaseAuthClient();
      const { data, error } = await authClient.auth.getUser(accessToken);

      if (error || !data.user) {
        logger.warn({
          msg: "Realtime auth token validation failed",
          error: error?.message ?? "Unknown realtime auth error",
        });
        return null;
      }

      return {
        id: data.user.id,
        email: data.user.email ?? null,
        isAnonymous: data.user.is_anonymous ?? false,
      };
    } catch (err) {
      logger.warn({
        msg: "Failed to parse realtime auth token",
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  private async sendProjectSnapshot(
    socket: WebSocket,
    project: Project,
  ): Promise<void> {
    const [messages, latestJobStatus] = await Promise.all([
      databaseService.getMessages(project.id),
      project.latest_job_id
        ? getJobStatus(project.latest_job_id)
        : Promise.resolve(null),
    ]);

    const snapshot: RealtimeProjectSnapshotEvent = {
      type: "project.snapshot",
      projectId: project.id,
      project,
      messages,
      latestJobStatus,
      timestamp: new Date().toISOString(),
    };

    this.send(socket, snapshot);
  }

  private async sendJobSnapshot(
    socket: WebSocket,
    jobId: string,
    status: Awaited<ReturnType<typeof getJobStatus>>,
  ): Promise<void> {
    if (!status) {
      return;
    }

    const job = await renderQueue.getJob(jobId);
    const jobProjectId = job?.data.projectId;
    const jobDuration = job?.data.duration;

    switch (status.status) {
      case "queued": {
        this.send(socket, {
          type: "render.job.queued",
          jobId,
          projectId: jobProjectId,
          triggerMessageId: job?.data.triggerMessageId,
          status: "queued",
          position: status.position,
          estimatedWaitSeconds: jobDuration
            ? estimateWaitSeconds(status.position, jobDuration)
            : 0,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      case "rendering": {
        this.send(socket, {
          type: "render.job.progress",
          jobId,
          projectId: jobProjectId,
          status: "rendering",
          progress: status.progress,
          stage: inferRenderStage(status.progress),
          timestamp: new Date().toISOString(),
        });
        return;
      }

      case "completed": {
        this.send(socket, {
          type: "render.job.completed",
          jobId,
          projectId: jobProjectId,
          status: "completed",
          downloadUrl: status.downloadUrl,
          duration: status.duration,
          resolution: status.resolution,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      case "failed": {
        this.send(socket, {
          type: "render.job.failed",
          jobId,
          projectId: jobProjectId,
          status: "failed",
          error: status.error,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  private dispatchLocalEvent(event: RealtimeServerEvent): void {
    for (const [socket, state] of this.connections.entries()) {
      if (socket.readyState !== WebSocket.OPEN) {
        continue;
      }

      if (this.shouldDeliverEvent(event, state)) {
        this.send(socket, event);
      }
    }
  }

  private shouldDeliverEvent(
    event: RealtimeServerEvent,
    state: ConnectionState,
  ): boolean {
    switch (event.type) {
      case "project.snapshot":
      case "connection.ready":
      case "subscription.confirmed":
      case "pong":
      case "error": {
        return false;
      }

      case "project.updated":
      case "project.message.created": {
        return state.subscribedProjectIds.has(event.projectId);
      }

      case "render.job.queued":
      case "render.job.progress":
      case "render.job.completed":
      case "render.job.failed": {
        const matchesJob = state.subscribedJobIds.has(event.jobId);
        const matchesProject = event.projectId
          ? state.subscribedProjectIds.has(event.projectId)
          : false;
        return matchesJob || matchesProject;
      }
    }
  }

  private send(socket: WebSocket, event: RealtimeServerEvent): void {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify(event));
  }

  private sendError(
    socket: WebSocket,
    error: string,
    code: RealtimeErrorEvent["code"],
  ): void {
    this.send(socket, {
      type: "error",
      error,
      code,
      timestamp: new Date().toISOString(),
    });
  }
}

export const realtimeService = new RealtimeService();

export async function initializeRealtimeServer(
  server: HttpServer,
): Promise<void> {
  await realtimeService.initialize(server);
}

export async function closeRealtimeServer(): Promise<void> {
  await realtimeService.close();
}

export async function publishRealtimeEvent(
  event: RealtimeServerEvent,
): Promise<void> {
  await realtimeService.publish(event);
}

export { WEBSOCKET_PATH, REALTIME_CHANNEL };
