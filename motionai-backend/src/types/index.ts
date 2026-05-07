/**
 * Shared TypeScript types and interfaces for MotionAI backend.
 *
 * Extended with Project / Message / Chat types for the conversation
 * continuation feature (Supabase-backed).
 */

// ---------------------------------------------------------------------------
// Request / Response Shapes
// ---------------------------------------------------------------------------

/** Body shape for POST /api/animation/generate */
export interface AnimationRequest {
  /** User's raw animation description (10–1000 chars) */
  prompt: string;
  /** Duration of the animation in seconds (3–60) */
  duration: number;
  /** Output resolution */
  resolution: '720p' | '1080p';
  /** Visual style applied to the animation */
  style: 'modern' | 'minimal' | 'bold' | 'corporate';
}

/** Union of all possible status response shapes */
export type JobStatusResponse =
  | QueuedStatusResponse
  | RenderingStatusResponse
  | CompletedStatusResponse
  | FailedStatusResponse;

export interface QueuedStatusResponse {
  jobId: string;
  status: 'queued';
  position: number;
}

export interface RenderingStatusResponse {
  jobId: string;
  status: 'rendering';
  /** Render progress from 0 to 100 */
  progress: number;
}

export interface CompletedStatusResponse {
  jobId: string;
  status: 'completed';
  /** Pre-signed S3 URL valid for 1 hour */
  downloadUrl: string;
  duration: number;
  resolution: string;
}

export interface FailedStatusResponse {
  jobId: string;
  status: 'failed';
  /** Human-readable error message — never exposes stack traces */
  error: string;
}

// ---------------------------------------------------------------------------
// BullMQ Job Payload
// ---------------------------------------------------------------------------

/** Data stored inside a BullMQ render job */
export interface AnimationJobData {
  /** Original user prompt */
  prompt: string;
  /** Animation duration in seconds */
  duration: number;
  /** Output resolution */
  resolution: '720p' | '1080p';
  /** Visual style */
  style: 'modern' | 'minimal' | 'bold' | 'corporate';
  /** Unique job identifier (same as BullMQ job ID) */
  jobId: string;
  /** Human-readable error captured on failure */
  errorMessage?: string;
  /** Pre-signed download URL stored on completion */
  downloadUrl?: string;
  /**
   * Supabase project ID — present on all jobs so the worker can
   * persist results back to the database.
   */
  projectId?: string;
  /**
   * Message ID in the messages table that triggered this render.
   * Used to update the message with the resulting job_id.
   */
  triggerMessageId?: string;
  /**
   * Compact context string passed to the LLM for edit requests.
   * Omitted on the first generation (undefined).
   */
  editContext?: EditContext;
}

// ---------------------------------------------------------------------------
// Project & Chat Domain
// ---------------------------------------------------------------------------

/** Stored project row in Supabase */
export interface Project {
  id: string;
  created_at: string;
  updated_at: string;
  title: string;
  style: 'modern' | 'minimal' | 'bold' | 'corporate';
  duration: number;
  resolution: '720p' | '1080p';
  latest_job_id: string | null;
  latest_video_url: string | null;
  /** Serialised EnrichedBrief — reused for token-efficient edit calls */
  enriched_brief: EnrichedBrief | null;
}

/** Stored message row in Supabase */
export interface Message {
  id: string;
  project_id: string;
  created_at: string;
  role: 'user' | 'assistant';
  content: string;
  job_id: string | null;
  message_type: 'initial_generate' | 'edit' | 'completion' | 'error';
}

/** Body shape for POST /api/projects */
export interface CreateProjectRequest {
  prompt: string;
  duration: number;
  resolution: '720p' | '1080p';
  style: 'modern' | 'minimal' | 'bold' | 'corporate';
}

/** Body shape for POST /api/projects/:id/chat */
export interface ChatRequest {
  /** User edit message (e.g. "make the background darker") */
  message: string;
  /**
   * Optionally override duration / resolution for this render.
   * If omitted, the project's existing values are reused.
   */
  duration?: number;
  resolution?: '720p' | '1080p';
}

/**
 * Compact context passed from controller → LLM for edit calls.
 * Keeps token count low by summarising the previous brief rather
 * than re-sending the full prompt history.
 */
export interface EditContext {
  /** One-line summary of the existing animation */
  briefSummary: string;
  /** Hex colors from the previous brief */
  colorPalette: string[];
  /** Mood tag */
  animationMood: string;
  /** Font style */
  fontStyle: 'sans-serif' | 'monospace' | 'serif' | 'display';
}

// ---------------------------------------------------------------------------
// Gemini Service
// ---------------------------------------------------------------------------

/** One scene in the enriched creative brief */
export interface KeyScene {
  startSecond: number;
  description: string;
  elements: string[];
}

/** Output shape from Gemini Call 1 — enrichPrompt */
export interface EnrichedBrief {
  enrichedPrompt: string;
  /** Array of 4–6 hex color codes matching the requested style */
  colorPalette: string[];
  /** CSS font-family keyword */
  fontStyle: 'sans-serif' | 'monospace' | 'serif' | 'display';
  /** Emotional tone of the animation */
  animationMood: string;
  keyScenes: KeyScene[];
}

// ---------------------------------------------------------------------------
// Render Service
// ---------------------------------------------------------------------------

/** Options passed to the render service */
export interface RenderOptions {
  /** Unique job identifier used for temp directory namespacing */
  jobId: string;
  /** LLM-generated TSX source code */
  tsxCode: string;
  /** Animation duration in seconds */
  duration: number;
  /** Output resolution */
  resolution: '720p' | '1080p';
  /** Callback invoked with render progress 0–100 */
  onProgress: (progress: number) => void;
}

// ---------------------------------------------------------------------------
// Custom Errors
// ---------------------------------------------------------------------------

/** Thrown when generated JSX fails sanitization checks */
export class SanitizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SanitizationError';
    // Maintains proper prototype chain in ES5 compiled output
    Object.setPrototypeOf(this, SanitizationError.prototype);
  }
}
