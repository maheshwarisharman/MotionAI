/**
 * ProjectController — handles /api/projects endpoints.
 *
 * Two core flows:
 *  1. create()  — POST /api/projects — first generation, creates project + enqueues render
 *  2. chat()    — POST /api/projects/:id/chat — edit/continuation, reuses stored brief
 *
 * Token optimisation:
 *  - On edit calls the enrichPrompt LLM step is SKIPPED entirely.
 *  - A compact EditContext (≈200 tokens) is derived from the stored EnrichedBrief.
 *  - Only one LLM call (code gen) is made for every edit after the first.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { renderQueue } from "../queues/render.queue.js";
import { databaseService } from "../services/database.service.js";
import {
  estimateWaitSeconds,
  getQueuePosition,
} from "../services/job-status.service.js";
import { publishRealtimeEvent } from "../services/realtime.service.js";
import { logger } from "../utils/logger.js";
import type {
  AnimationJobData,
  CreateProjectRequest,
  ChatRequest,
  EditContext,
  EnrichedBrief,
  ReferenceImageInput,
} from "../types/index.js";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const referenceImageSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    url: z.string().url().optional(),
    dataUrl: z
      .string()
      .regex(
        /^data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=]+$/u,
        "referenceImages dataUrl must be a base64 image data URL",
      )
      .optional(),
  })
  .superRefine((value, ctx) => {
    const count = Number(Boolean(value.url)) + Number(Boolean(value.dataUrl));
    if (count !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Each reference image must include exactly one of "url" or "dataUrl"',
      });
    }
  });

const createProjectSchema = z.object({
  prompt: z.string().min(10).max(1000),
  duration: z.number().int().min(3).max(60),
  resolution: z.enum(["720p", "1080p"]),
  style: z.enum(["modern", "minimal", "bold", "corporate"]),
  referenceImages: z.array(referenceImageSchema).max(4).optional(),
});

const chatSchema = z.object({
  message: z.string().min(3).max(1000),
  referenceImages: z.array(referenceImageSchema).max(4).optional(),
  duration: z.number().int().min(3).max(60).optional(),
  resolution: z.enum(["720p", "1080p"]).optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derives a short project title from the raw prompt (first 60 chars, sentence-cased).
 */
function deriveTitle(prompt: string): string {
  const trimmed = prompt.trim().slice(0, 60);
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Builds a compact EditContext from a stored EnrichedBrief.
 * This is what gets passed to the LLM instead of the full brief — saves ~50% tokens.
 */
function buildEditContext(brief: EnrichedBrief): EditContext {
  // Compress keyScenes to a single summary sentence
  const scenesSummary = brief.keyScenes
    .map((s) => `${s.startSecond}s: ${s.description}`)
    .join("; ");

  return {
    briefSummary: `${brief.enrichedPrompt} Scenes: ${scenesSummary}`.slice(
      0,
      400,
    ),
    colorPalette: brief.colorPalette,
    animationMood: brief.animationMood,
    fontStyle: brief.fontStyle,
  };
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class ProjectController {
  // -------------------------------------------------------------------------
  // POST /api/projects
  // -------------------------------------------------------------------------

  /**
   * Creates a new project and enqueues the first render job.
   *
   * Flow:
   *  1. Validate body
   *  2. Create project row in Supabase
   *  3. Persist user message
   *  4. Enqueue BullMQ render job (full pipeline: enrich + codegen)
   *  5. Update message with jobId
   *  6. Return 202 with projectId + jobId
   */
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parse = createProjectSchema.safeParse(req.body);
      if (!parse.success) {
        const errors = parse.error.errors.map((e) => e.message).join(", ");
        res
          .status(400)
          .json({
            error: `Validation failed: ${errors}`,
            requestId: res.locals["requestId"],
          });
        return;
      }

      const body = parse.data as CreateProjectRequest;
      const jobId = uuidv4();

      // 1. Create project
      const project = await databaseService.createProject({
        title: deriveTitle(body.prompt),
        style: body.style,
        duration: body.duration,
        resolution: body.resolution,
      });

      // 2. Persist user message
      const userMessage = await databaseService.createMessage({
        projectId: project.id,
        role: "user",
        content: body.prompt,
        messageType: "initial_generate",
      });

      await publishRealtimeEvent({
        type: "project.updated",
        projectId: project.id,
        project,
        timestamp: new Date().toISOString(),
      });

      // 3. Enqueue render job (no editContext → full pipeline)

      const jobData: AnimationJobData = {
        jobId,
        prompt: body.prompt,
        duration: body.duration,
        resolution: body.resolution,
        style: body.style,
        projectId: project.id,
        triggerMessageId: userMessage.id,
        referenceImages: body.referenceImages as ReferenceImageInput[] | undefined,
      };

      const job = await renderQueue.add(jobId, jobData, { jobId });

      // 4. Update message with the queued jobId
      await databaseService.setMessageJobId(userMessage.id, jobId);

      const queuedUserMessage = {
        ...userMessage,
        job_id: jobId,
      };

      const queuePosition = await getQueuePosition(job);
      const estimatedWait = estimateWaitSeconds(queuePosition, body.duration);

      await publishRealtimeEvent({
        type: "project.message.created",
        projectId: project.id,
        message: queuedUserMessage,
        timestamp: new Date().toISOString(),
      });

      await publishRealtimeEvent({
        type: "render.job.queued",
        jobId,
        projectId: project.id,
        triggerMessageId: userMessage.id,
        status: "queued",
        position: queuePosition,
        estimatedWaitSeconds: estimatedWait,
        timestamp: new Date().toISOString(),
      });

      const host = `${req.protocol}://${req.get("host")}`;

      logger.info({
        msg: "Project created",
        projectId: project.id,
        jobId,
        requestId: res.locals["requestId"],
      });

      res.status(202).json({
        projectId: project.id,
        jobId,
        status: "queued",
        estimatedWaitSeconds: estimatedWait,

        statusUrl: `${host}/api/animation/status/${jobId}`,
      });
    } catch (err) {
      next(err);
    }
  }

  // -------------------------------------------------------------------------
  // GET /api/projects
  // -------------------------------------------------------------------------

  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const limit = Math.min(
        parseInt((req.query["limit"] as string) ?? "20", 10),
        50,
      );
      const offset = parseInt((req.query["offset"] as string) ?? "0", 10);

      const projects = await databaseService.listProjects(limit, offset);
      res.status(200).json({ projects, limit, offset });
    } catch (err) {
      next(err);
    }
  }

  // -------------------------------------------------------------------------
  // GET /api/projects/:projectId
  // -------------------------------------------------------------------------

  async getOne(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { projectId } = req.params as { projectId: string };

      const [project, messages] = await Promise.all([
        databaseService.getProject(projectId),
        databaseService.getMessages(projectId),
      ]);

      if (!project) {
        res
          .status(404)
          .json({
            error: `Project "${projectId}" not found`,
            requestId: res.locals["requestId"],
          });
        return;
      }

      res.status(200).json({ project, messages });
    } catch (err) {
      next(err);
    }
  }

  // -------------------------------------------------------------------------
  // POST /api/projects/:projectId/chat
  // -------------------------------------------------------------------------

  /**
   * Continues a project conversation — applies an edit.
   *
   * Token optimisation:
   *  - Reads the cached enriched_brief from the project row
   *  - Builds a compact EditContext (~200 tokens) instead of re-enriching
   *  - Passes editContext into the job data so the worker skips enrichPrompt
   *
   * Flow:
   *  1. Validate body
   *  2. Load project (must exist + have a completed render)
   *  3. Persist user edit message
   *  4. Enqueue render job with editContext (skips enrich step in worker)
   *  5. Return 202 with jobId
   */
  async chat(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { projectId } = req.params as { projectId: string };

      const parse = chatSchema.safeParse(req.body);
      if (!parse.success) {
        const errors = parse.error.errors.map((e) => e.message).join(", ");
        res
          .status(400)
          .json({
            error: `Validation failed: ${errors}`,
            requestId: res.locals["requestId"],
          });
        return;
      }

      const body = parse.data as ChatRequest;

      // Load project
      const project = await databaseService.getProject(projectId);
      if (!project) {
        res
          .status(404)
          .json({
            error: `Project "${projectId}" not found`,
            requestId: res.locals["requestId"],
          });
        return;
      }

      if (!project.enriched_brief) {
        res.status(409).json({
          error:
            "No completed generation found for this project. Wait for the initial render to finish before sending edits.",
          requestId: res.locals["requestId"],
        });
        return;
      }

      const duration = body.duration ?? project.duration;
      const resolution = body.resolution ?? project.resolution;
      const jobId = uuidv4();

      // Build compact context — this is the token-saving step
      const editContext: EditContext = buildEditContext(
        project.enriched_brief as EnrichedBrief,
      );

      // Persist user edit message
      const userMessage = await databaseService.createMessage({
        projectId,
        role: "user",
        content: body.message,
        messageType: "edit",
      });

      const jobData: AnimationJobData = {
        jobId,
        prompt: body.message,
        duration,
        resolution,
        style: project.style,
        projectId,
        triggerMessageId: userMessage.id,
        editContext, // presence of this tells the worker to skip enrichPrompt
        referenceImages: body.referenceImages as ReferenceImageInput[] | undefined,
      };

      const job = await renderQueue.add(jobId, jobData, { jobId });
      await databaseService.setMessageJobId(userMessage.id, jobId);

      const queuedUserMessage = {
        ...userMessage,
        job_id: jobId,
      };

      const queuePosition = await getQueuePosition(job);
      const estimatedWait = estimateWaitSeconds(queuePosition, duration);

      await publishRealtimeEvent({
        type: "project.message.created",
        projectId,
        message: queuedUserMessage,
        timestamp: new Date().toISOString(),
      });

      await publishRealtimeEvent({
        type: "render.job.queued",
        jobId,
        projectId,
        triggerMessageId: userMessage.id,
        status: "queued",
        position: queuePosition,
        estimatedWaitSeconds: estimatedWait,
        timestamp: new Date().toISOString(),
      });

      const host = `${req.protocol}://${req.get("host")}`;

      logger.info({
        msg: "Edit job enqueued",
        projectId,
        jobId,
        requestId: res.locals["requestId"],
      });

      res.status(202).json({
        projectId,
        jobId,
        status: "queued",
        estimatedWaitSeconds: estimatedWait,

        statusUrl: `${host}/api/animation/status/${jobId}`,
      });
    } catch (err) {
      next(err);
    }
  }
}

export const projectController = new ProjectController();
