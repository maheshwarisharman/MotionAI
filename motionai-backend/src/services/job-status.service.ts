/**
 * Shared helpers for mapping BullMQ job state into API / realtime payloads.
 */

import type { Job } from 'bullmq';
import { renderQueue } from '../queues/render.queue.js';
import type {
  AnimationJobData,
  JobStatusResponse,
  RenderJobStage,
} from '../types/index.js';

/**
 * Rough queue estimate reused by both HTTP responses and websocket events.
 */
export function estimateWaitSeconds(position: number, duration: number): number {
  return position * (duration * 2 + 60);
}

/**
 * Derives a coarse render stage from the worker's BullMQ progress values.
 */
export function inferRenderStage(progress: number): RenderJobStage {
  if (progress <= 0) return 'starting';
  if (progress < 20) return 'enriching_prompt';
  if (progress < 35) return 'generating_code';
  if (progress < 40) return 'validating_code';
  if (progress < 90) return progress === 40 ? 'bundling' : 'rendering';
  if (progress < 95) return 'uploading';
  return 'persisting';
}

/**
 * Finds a waiting job's queue position (1-indexed). Falls back to 1.
 */
export async function getQueuePosition(job: Job<AnimationJobData>): Promise<number> {
  const waitingJobs = await renderQueue.getWaiting();
  const position = waitingJobs.findIndex((queuedJob) => queuedJob.id === job.id) + 1;
  return position > 0 ? position : 1;
}

/**
 * Returns the public API status shape for a BullMQ job ID.
 */
export async function getJobStatus(jobId: string): Promise<JobStatusResponse | null> {
  const job = await renderQueue.getJob(jobId);

  if (!job) {
    return null;
  }

  const state = await job.getState();
  const progress = typeof job.progress === 'number' ? job.progress : 0;
  const jobData = job.data as AnimationJobData;

  switch (state) {
    case 'waiting':
    case 'delayed': {
      return {
        jobId,
        status: 'queued',
        position: await getQueuePosition(job),
      };
    }

    case 'active': {
      return {
        jobId,
        status: 'rendering',
        progress,
      };
    }

    case 'completed': {
      return {
        jobId,
        status: 'completed',
        downloadUrl: job.returnvalue as string,
        duration: jobData.duration,
        resolution: jobData.resolution,
      };
    }

    case 'failed': {
      return {
        jobId,
        status: 'failed',
        error: job.failedReason ?? 'An unexpected error occurred. Please try again.',
      };
    }

    default: {
      return {
        jobId,
        status: 'queued',
        position: 1,
      };
    }
  }
}
