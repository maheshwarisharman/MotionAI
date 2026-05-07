/**
 * BullMQ render queue definition.
 * Exports a single shared Queue instance connected via REDIS_URL.
 */

import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import type { AnimationJobData } from '../types/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const RENDER_QUEUE_NAME = 'render-jobs';

// ---------------------------------------------------------------------------
// Redis Connection
// ---------------------------------------------------------------------------

export const redisConnection = new Redis(env.REDIS_URL, {
  /** Disable automatic JSON parsing — BullMQ handles serialization */
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redisConnection.on('connect', () => {
  logger.info({ msg: 'Redis connected', url: env.REDIS_URL });
});

redisConnection.on('error', (err: Error) => {
  logger.error({ msg: 'Redis connection error', error: err.message });
});

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export const renderQueue = new Queue<AnimationJobData>(RENDER_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    /** Retry failed jobs up to 2 times automatically */
    attempts: 1,
    backoff: {
      type: 'exponential',
      delay: 2_000,
    },
    /** Keep completed jobs for 1 hour */
    removeOnComplete: {
      age: 3_600,
    },
    /** Keep failed jobs for 24 hours */
    removeOnFail: {
      age: 86_400,
    },
  },
});
