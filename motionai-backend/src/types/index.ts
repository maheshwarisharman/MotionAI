/**
 * Shared TypeScript types and interfaces for MotionAI backend.
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
