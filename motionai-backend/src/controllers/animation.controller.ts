/**
 * Animation controller — handles HTTP request/response for animation endpoints.
 * Business logic lives in services; this layer only orchestrates and formats.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { renderQueue } from "../queues/render.queue.js";
import {
  estimateWaitSeconds,
  getJobStatus,
  getQueuePosition,
} from "../services/job-status.service.js";
import { publishRealtimeEvent } from "../services/realtime.service.js";
import { logger } from "../utils/logger.js";
import type { AnimationRequest, AnimationJobData } from "../types/index.js";

// ---------------------------------------------------------------------------
// Validation Schema

// ---------------------------------------------------------------------------

const animationRequestSchema = z.object({
  prompt: z
    .string()
    .min(10, "Prompt must be at least 10 characters")
    .max(1000, "Prompt must be at most 1000 characters"),
  duration: z
    .number()
    .int()
    .min(3, "Duration must be at least 3 seconds")
    .max(60, "Duration must be at most 60 seconds"),
  resolution: z.enum(["720p", "1080p"], {
    errorMap: () => ({ message: 'Resolution must be "720p" or "1080p"' }),
  }),
  style: z.enum(["modern", "minimal", "bold", "corporate"], {
    errorMap: () => ({
      message: "Style must be one of: modern, minimal, bold, corporate",
    }),
  }),
});

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class AnimationController {
  /**
   * POST /api/animation/generate
   *
   * Validates the request body, enqueues a render job, and returns a 202
   * response with the job ID and a URL to poll for status.
   */
  async generate(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const parseResult = animationRequestSchema.safeParse(req.body);

      if (!parseResult.success) {
        const errors = parseResult.error.errors
          .map((e) => e.message)
          .join(", ");
        res.status(400).json({
          error: `Validation failed: ${errors}`,
          requestId: res.locals["requestId"] as string,
        });
        return;
      }

      const body = parseResult.data as AnimationRequest;
      const jobId = uuidv4();

      const jobData: AnimationJobData = {
        jobId,
        prompt: body.prompt,
        duration: body.duration,
        resolution: body.resolution,
        style: body.style,
      };

      const job = await renderQueue.add(jobId, jobData, { jobId });

      // Determine queue position for estimated wait time
      const queuePosition = await getQueuePosition(job);
      const estimatedWait = estimateWaitSeconds(queuePosition, body.duration);

      await publishRealtimeEvent({
        type: "render.job.queued",
        jobId,
        status: "queued",
        position: queuePosition,
        estimatedWaitSeconds: estimatedWait,
        timestamp: new Date().toISOString(),
      });

      const host = `${req.protocol}://${req.get("host")}`;

      const statusUrl = `${host}/api/animation/status/${jobId}`;

      logger.info({
        msg: "Animation job enqueued",
        jobId,
        position: queuePosition,
        estimatedWaitSeconds: estimatedWait,
        requestId: res.locals["requestId"],
      });

      res.status(202).json({
        jobId,
        status: "queued",
        estimatedWaitSeconds: estimatedWait,
        statusUrl,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/animation/status/:jobId
   *
   * Returns the current status of a render job. Maps BullMQ job state to the
   * API's status union type.
   */
  async getStatus(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { jobId } = req.params as { jobId: string };

      if (!jobId) {
        res.status(400).json({
          error: "jobId parameter is required",
          requestId: res.locals["requestId"] as string,
        });
        return;
      }

      const response = await getJobStatus(jobId);

      if (!response) {
        res.status(404).json({
          error: `Job "${jobId}" not found`,
          requestId: res.locals["requestId"] as string,
        });
        return;
      }

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }
}

export const animationController = new AnimationController();
