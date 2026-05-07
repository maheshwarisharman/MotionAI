/**
 * Animation controller — handles HTTP request/response for animation endpoints.
 * Business logic lives in services; this layer only orchestrates and formats.
 */

import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { renderQueue } from '../queues/render.queue.js';
import { logger } from '../utils/logger.js';
import type {
  AnimationRequest,
  AnimationJobData,
  JobStatusResponse,
} from '../types/index.js';

// ---------------------------------------------------------------------------
// Validation Schema
// ---------------------------------------------------------------------------

const animationRequestSchema = z.object({
  prompt: z
    .string()
    .min(10, 'Prompt must be at least 10 characters')
    .max(1000, 'Prompt must be at most 1000 characters'),
  duration: z
    .number()
    .int()
    .min(3, 'Duration must be at least 3 seconds')
    .max(60, 'Duration must be at most 60 seconds'),
  resolution: z.enum(['720p', '1080p'], {
    errorMap: () => ({ message: 'Resolution must be "720p" or "1080p"' }),
  }),
  style: z.enum(['modern', 'minimal', 'bold', 'corporate'], {
    errorMap: () => ({
      message: 'Style must be one of: modern, minimal, bold, corporate',
    }),
  }),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Estimates the queue wait time based on position and approximate render time.
 *
 * @param position - 1-indexed position in the queue.
 * @param duration - Animation duration in seconds (used for rough time estimate).
 */
function estimateWaitSeconds(position: number, duration: number): number {
  // Rough estimate: each job takes ~2× the animation duration plus 60s overhead
  const secondsPerJob = duration * 2 + 60;
  return position * secondsPerJob;
}

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
  async generate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parseResult = animationRequestSchema.safeParse(req.body);

      if (!parseResult.success) {
        const errors = parseResult.error.errors.map((e) => e.message).join(', ');
        res.status(400).json({
          error: `Validation failed: ${errors}`,
          requestId: res.locals['requestId'] as string,
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
      const waitingJobs = await renderQueue.getWaiting();
      const position = waitingJobs.findIndex((j) => j.id === job.id) + 1;
      const queuePosition = position > 0 ? position : 1;
      const estimatedWaitSeconds = estimateWaitSeconds(queuePosition, body.duration);

      const host = `${req.protocol}://${req.get('host')}`;
      const statusUrl = `${host}/api/animation/status/${jobId}`;

      logger.info({
        msg: 'Animation job enqueued',
        jobId,
        position: queuePosition,
        estimatedWaitSeconds,
        requestId: res.locals['requestId'],
      });

      res.status(202).json({
        jobId,
        status: 'queued',
        estimatedWaitSeconds,
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
  async getStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { jobId } = req.params as { jobId: string };

      if (!jobId) {
        res.status(400).json({
          error: 'jobId parameter is required',
          requestId: res.locals['requestId'] as string,
        });
        return;
      }

      const job = await renderQueue.getJob(jobId);

      if (!job) {
        res.status(404).json({
          error: `Job "${jobId}" not found`,
          requestId: res.locals['requestId'] as string,
        });
        return;
      }

      const state = await job.getState();
      const progress = typeof job.progress === 'number' ? job.progress : 0;

      let response: JobStatusResponse;

      switch (state) {
        case 'waiting':
        case 'delayed': {
          const waitingJobs = await renderQueue.getWaiting();
          const pos = waitingJobs.findIndex((j) => j.id === job.id) + 1;
          response = {
            jobId,
            status: 'queued',
            position: pos > 0 ? pos : 1,
          };
          break;
        }

        case 'active': {
          response = {
            jobId,
            status: 'rendering',
            progress,
          };
          break;
        }

        case 'completed': {
          // returnvalue is the download URL stored by the worker
          const downloadUrl = job.returnvalue as string;
          const jobData = job.data as AnimationJobData;
          response = {
            jobId,
            status: 'completed',
            downloadUrl,
            duration: jobData.duration,
            resolution: jobData.resolution,
          };
          break;
        }

        case 'failed': {
          response = {
            jobId,
            status: 'failed',
            error: job.failedReason ?? 'An unexpected error occurred. Please try again.',
          };
          break;
        }

        default: {
          response = {
            jobId,
            status: 'queued',
            position: 1,
          };
        }
      }

      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  }
}

export const animationController = new AnimationController();
