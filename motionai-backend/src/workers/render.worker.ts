/**
 * BullMQ worker — processes render jobs from the "render-jobs" queue.
 *
 * Supports two job modes determined by the presence of `job.data.editContext`:
 *
 * ┌─────────────────┬──────────────────────────────────────────────────────┐
 * │ Mode            │ LLM calls                                            │
 * ├─────────────────┼──────────────────────────────────────────────────────┤
 * │ Initial gen     │ enrichPrompt  → generateRemotionCode   (2 calls)     │
 * │ Edit / chat     │ generateRemotionCodeFromEdit            (1 call)     │
 * └─────────────────┴──────────────────────────────────────────────────────┘
 *
 * After a successful render the worker:
 *  - Uploads the MP4 to S3
 *  - Updates project.latest_job_id / latest_video_url / enriched_brief in Supabase
 *  - Appends an assistant "completion" message to the project chat
 *
 * Job execution progress:
 *  5%     — Enriching prompt (initial gen only) / parsing edit context
 * 20%     — Generating animation code
 * 35%     — Validating generated code
 * 40%     — Bundling animation
 * 40–90%  — Rendering (mapped from Remotion 0–100)
 * 90%     — Uploading to S3
 * 95%     — Persisting to database
 * 100%    — Complete
 */

import { Worker, Job } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { geminiService } from '../services/gemini.service.js';
import { renderService } from '../services/render.service.js';
import { storageService } from '../services/storage.service.js';
import { databaseService } from '../services/database.service.js';
import { sanitizeJSX } from '../utils/sanitize.js';
import { SanitizationError, type AnimationJobData, type EnrichedBrief } from '../types/index.js';
import { RENDER_QUEUE_NAME, redisConnection } from '../queues/render.queue.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RENDER_PROGRESS_START = 40;
const RENDER_PROGRESS_END = 90;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapRenderProgress(renderPercent: number): number {
  return Math.round(
    RENDER_PROGRESS_START +
      (renderPercent / 100) * (RENDER_PROGRESS_END - RENDER_PROGRESS_START),
  );
}

// ---------------------------------------------------------------------------
// Worker processor
// ---------------------------------------------------------------------------

async function processRenderJob(job: Job<AnimationJobData>): Promise<string> {
  const { jobId, prompt, style, duration, resolution, projectId, editContext } = job.data;
  const isEditMode = !!editContext;

  logger.info({
    msg: 'Processing render job',
    jobId,
    style,
    duration,
    resolution,
    mode: isEditMode ? 'edit' : 'initial',
    projectId,
  });

  // ── Step 1: Enrich prompt OR use cached brief ────────────────────────────
  await job.updateProgress(5);

  let enrichedBrief: EnrichedBrief | null = null;

  if (!isEditMode) {
    // Full pipeline — 2 LLM calls
    logger.info({ msg: 'Enriching prompt', jobId });
    enrichedBrief = await geminiService.enrichPrompt(prompt, style, duration);
    logger.info({ msg: 'Prompt enriched', jobId, mood: enrichedBrief.animationMood });
  } else {
    // Edit mode — skip enrichPrompt, use compact context from DB
    logger.info({ msg: 'Using cached brief context for edit', jobId });
  }

  // ── Step 2: Generate Remotion code ───────────────────────────────────────
  await job.updateProgress(20);
  logger.info({ msg: 'Generating Remotion code', jobId, mode: isEditMode ? 'edit' : 'initial' });

  let tsxCode: string;

  if (isEditMode && editContext) {
    // 1 LLM call — token-efficient edit path
    tsxCode = await geminiService.generateRemotionCodeFromEdit(
      prompt,
      editContext,
      duration,
      resolution,
    );
  } else if (enrichedBrief) {
    // 2 LLM calls — standard path
    tsxCode = await geminiService.generateRemotionCode(enrichedBrief, duration, resolution);
  } else {
    throw new Error('Neither enrichedBrief nor editContext is available');
  }

  logger.info({ msg: 'Code generated', jobId, codeLength: tsxCode.length });

  // ── Step 3: Validate generated code ─────────────────────────────────────
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

  // ── Step 4 + 5: Bundle & render ─────────────────────────────────────────
  await job.updateProgress(40);
  logger.info({ msg: 'Starting bundle and render', jobId });

  const outputPath = await renderService.render({
    jobId,
    tsxCode,
    duration,
    resolution,
    onProgress: async (renderPercent) => {
      await job.updateProgress(mapRenderProgress(renderPercent));
    },
  });

  logger.info({ msg: 'Render complete', jobId, outputPath });

  // ── Step 6: Upload to S3 ─────────────────────────────────────────────────
  await job.updateProgress(90);
  logger.info({ msg: 'Uploading to S3', jobId });

  const downloadUrl = await storageService.uploadAndSign(jobId, outputPath);
  storageService.cleanupLocalFiles(jobId, env.TEMP_DIR);

  logger.info({ msg: 'Upload complete', jobId, downloadUrl });

  // ── Step 7: Persist to Supabase ──────────────────────────────────────────
  await job.updateProgress(95);

  if (projectId) {
    try {
      // Determine which brief to store:
      // - On initial gen: use the freshly enriched brief
      // - On edit: re-use whatever is already stored (editContext is a subset)
      const briefToStore: EnrichedBrief | null = enrichedBrief ?? null;

      if (briefToStore) {
        await databaseService.updateProjectAfterRender(projectId, {
          latestJobId: jobId,
          latestVideoUrl: downloadUrl,
          enrichedBrief: briefToStore,
        });
      } else {
        // Edit mode: only update job / URL fields, keep existing brief
        const db = (await import('../services/supabase.service.js')).getSupabaseClient();
        await db
          .from('projects')
          .update({
            latest_job_id: jobId,
            latest_video_url: downloadUrl,
            updated_at: new Date().toISOString(),
          })
          .eq('id', projectId);
      }

      await databaseService.recordCompletion(projectId, jobId, downloadUrl);
      logger.info({ msg: 'Supabase updated', projectId, jobId });
    } catch (dbErr) {
      // Non-fatal — the render itself succeeded, log and continue
      logger.error({
        msg: 'Failed to persist render result to Supabase',
        projectId,
        jobId,
        error: (dbErr as Error).message,
      });
    }
  }

  // ── Step 8: Complete ─────────────────────────────────────────────────────
  await job.updateProgress(100);
  logger.info({ msg: 'Job complete', jobId });

  return downloadUrl;
}

// ---------------------------------------------------------------------------
// Worker initialization
// ---------------------------------------------------------------------------

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

  worker.on('failed', async (job, err) => {
    if (job) {
      logger.error({
        msg: 'Job failed',
        jobId: job.data.jobId,
        error: err.message,
        stack: err.stack,
      });

      // Record failure in Supabase if project-linked
      if (job.data.projectId) {
        try {
          await databaseService.recordError(job.data.projectId, job.data.jobId, err.message);
        } catch {
          // best-effort
        }
      }
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
