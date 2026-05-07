/**
 * BullMQ worker — processes render jobs from the "render-jobs" queue.
 *
 * Job execution order:
 *  1.  5% — Enriching prompt with AI
 *  2. 20% — Generating animation code
 *  3. 35% — Validating generated code
 *  4. 40% — Bundling animation
 *  5. 40–90% — Rendering (mapped from Remotion 0–100)
 *  6. 90% — Uploading to storage
 *  7. 100% — Complete
 */

import { Worker, Job } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { geminiService } from '../services/gemini.service.js';
import { renderService } from '../services/render.service.js';
import { storageService } from '../services/storage.service.js';
import { sanitizeJSX } from '../utils/sanitize.js';
import { SanitizationError, type AnimationJobData } from '../types/index.js';
import { RENDER_QUEUE_NAME, redisConnection } from '../queues/render.queue.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Progress range reserved for the Remotion render step (0–100 → 40–90) */
const RENDER_PROGRESS_START = 40;
const RENDER_PROGRESS_END = 90;

// ---------------------------------------------------------------------------
// Worker processor
// ---------------------------------------------------------------------------

/**
 * Maps a Remotion render progress value (0–100) to the job progress range (40–90).
 */
function mapRenderProgress(renderPercent: number): number {
  return Math.round(
    RENDER_PROGRESS_START +
      (renderPercent / 100) * (RENDER_PROGRESS_END - RENDER_PROGRESS_START),
  );
}

/**
 * Main job processor function — orchestrates the full render pipeline.
 */
async function processRenderJob(job: Job<AnimationJobData>): Promise<string> {
  const { jobId, prompt, style, duration, resolution } = job.data;

  logger.info({ msg: 'Processing render job', jobId, style, duration, resolution });

  // ── Step 1: Enrich prompt ──────────────────────────────────────────────────
  await job.updateProgress(5);
  logger.info({ msg: 'Enriching prompt', jobId });

  const enrichedBrief = await geminiService.enrichPrompt(prompt, style, duration);
  logger.info({ msg: 'Prompt enriched', jobId, mood: enrichedBrief.animationMood });

  // ── Step 2: Generate Remotion code ────────────────────────────────────────
  await job.updateProgress(20);
  logger.info({ msg: 'Generating Remotion code', jobId });

  const tsxCode = await geminiService.generateRemotionCode(enrichedBrief, duration, resolution);
  logger.info({ msg: 'Code generated', jobId, codeLength: tsxCode.length });

  // ── Step 3: Validate generated code ───────────────────────────────────────
  await job.updateProgress(35);
  logger.info({ msg: 'Validating generated code', jobId });

  try {
    sanitizeJSX(tsxCode);
  } catch (err) {
    if (err instanceof SanitizationError) {
      logger.error({ msg: 'Code sanitization failed', jobId, error: err.message });
      throw new Error('AI generated invalid code, please retry');
    }
    throw err;
  }

  // ── Step 4 + 5: Bundle & render ───────────────────────────────────────────
  await job.updateProgress(40);
  logger.info({ msg: 'Starting bundle and render', jobId });

  const outputPath = await renderService.render({
    jobId,
    tsxCode,
    duration,
    resolution,
    onProgress: async (renderPercent) => {
      const mapped = mapRenderProgress(renderPercent);
      await job.updateProgress(mapped);
    },
  });

  logger.info({ msg: 'Render complete', jobId, outputPath });

  // ── Step 6: Upload to S3 ──────────────────────────────────────────────────
  await job.updateProgress(90);
  logger.info({ msg: 'Uploading to S3', jobId });

  const downloadUrl = await storageService.uploadAndSign(jobId, outputPath);

  // Clean up local temp files after successful upload
  storageService.cleanupLocalFiles(jobId, env.TEMP_DIR);

  logger.info({ msg: 'Upload complete', jobId, downloadUrl });

  // ── Step 7: Mark complete ─────────────────────────────────────────────────
  await job.updateProgress(100);
  logger.info({ msg: 'Job complete', jobId });

  return downloadUrl;
}

// ---------------------------------------------------------------------------
// Worker initialization
// ---------------------------------------------------------------------------

/**
 * Creates and returns the BullMQ worker instance.
 * Called once at application startup.
 */
export function createRenderWorker(): Worker<AnimationJobData> {
  const worker = new Worker<AnimationJobData>(
    RENDER_QUEUE_NAME,
    processRenderJob,
    {
      connection: redisConnection,
      concurrency: env.MAX_RENDER_CONCURRENT,
    },
  );

  worker.on('active', (job) => {
    logger.info({ msg: 'Job started', jobId: job.data.jobId });
  });

  worker.on('completed', (job, returnValue) => {
    logger.info({ msg: 'Job completed', jobId: job.data.jobId, downloadUrl: returnValue });
  });

  worker.on('failed', (job, err) => {
    if (job) {
      logger.error({
        msg: 'Job failed',
        jobId: job.data.jobId,
        error: err.message,
        stack: err.stack,
      });
    } else {
      logger.error({ msg: 'Unknown job failed', error: err.message });
    }
  });

  worker.on('error', (err) => {
    logger.error({ msg: 'Worker error', error: err.message });
  });

  logger.info({
    msg: 'Render worker initialized',
    queue: RENDER_QUEUE_NAME,
    concurrency: env.MAX_RENDER_CONCURRENT,
  });

  return worker;
}
