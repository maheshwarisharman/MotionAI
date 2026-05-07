/**
 * Gemini service — wraps all Google Gemini API interactions.
 *
 * Provides two distinct calls:
 *  1. enrichPrompt   — turns a vague user prompt into a structured creative brief.
 *  2. generateRemotionCode — generates a self-contained Remotion TSX component.
 *
 * Both methods implement retry logic with exponential backoff (up to 3 attempts).
 */

import {
  GoogleGenerativeAI,
  GenerativeModel,
  HarmBlockThreshold,
  HarmCategory,
} from '@google/generative-ai';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { sanitizeJSX } from '../utils/sanitize.js';
import { SanitizationError, type EnrichedBrief } from '../types/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL_NAME = 'gemini-1.5-pro';
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1_000;

/** Safety settings that prevent the model from blocking creative content */
const SAFETY_SETTINGS = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
  },
];

// ---------------------------------------------------------------------------
// System Prompts
// ---------------------------------------------------------------------------

const ENRICH_SYSTEM_PROMPT = `You are a creative director specializing in motion graphics for YouTube creators.
Your job is to take a vague animation request and turn it into a precise, detailed creative brief for a code generator.

Output a JSON object with this exact shape:
{
  "enrichedPrompt": string,
  "colorPalette": string[],
  "fontStyle": string,
  "animationMood": string,
  "keyScenes": [
    {
      "startSecond": number,
      "description": string,
      "elements": string[]
    }
  ]
}

Rules:
- colorPalette must contain 4–6 hex color codes that match the requested style.
- fontStyle must be one of: "sans-serif", "monospace", "serif", "display".
- keyScenes must map the animation duration with each scene having a unique startSecond.

Output ONLY the JSON. No markdown, no explanation.`;

const CODE_GENERATION_SYSTEM_PROMPT = `You are an expert Remotion and React developer. Generate a single self-contained Remotion composition component based on the creative brief provided.

STRICT RULES:
1. Output ONLY valid TypeScript/TSX code. No markdown fences, no explanation.
2. The component MUST be a default export named "GeneratedAnimation"
3. Use ONLY these allowed imports (they will be available at runtime):
   - import { useCurrentFrame, useVideoConfig, interpolate, spring, Sequence } from 'remotion'
   - import React from 'react'
4. NO external image URLs. Use only CSS gradients, SVG shapes, and inline styles.
5. NO external font imports. Use the fontStyle from the brief as a CSS font-family.
6. All animations MUST use interpolate() or spring() tied to useCurrentFrame()
7. The component must fill a full frame using width and height from useVideoConfig()
8. Handle multiple scenes using the <Sequence from={frameNumber}> component
9. Keep the code under 300 lines
10. Use spring() for entrance animations, interpolate() for continuous ones
11. Use the exact color palette from the creative brief
12. End the animation gracefully (fade out in the last 1 second)

The output will be directly executed in a Remotion renderer.
Any syntax error will cause the entire job to fail. Make the code correct on the first try.`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sleeps for `ms` milliseconds.
 */
async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Strips markdown fences from LLM output that may accidentally include them.
 */
function stripMarkdownFences(text: string): string {
  return text
    .replace(/^```(?:json|tsx|typescript)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

// ---------------------------------------------------------------------------
// GeminiService
// ---------------------------------------------------------------------------

export class GeminiService {
  private readonly model: GenerativeModel;

  constructor() {
    const client = new GoogleGenerativeAI(env.GEMINI_API_KEY);
    this.model = client.getGenerativeModel({
      model: MODEL_NAME,
      safetySettings: SAFETY_SETTINGS,
    });
  }

  // -------------------------------------------------------------------------
  // Public Methods
  // -------------------------------------------------------------------------

  /**
   * Enriches a raw user prompt into a structured creative brief.
   *
   * @param rawPrompt - Original text submitted by the user.
   * @param style     - Requested visual style.
   * @param duration  - Target animation duration in seconds.
   * @returns Parsed EnrichedBrief object ready for code generation.
   * @throws On repeated Gemini failures after MAX_RETRIES attempts.
   */
  async enrichPrompt(
    rawPrompt: string,
    style: string,
    duration: number,
  ): Promise<EnrichedBrief> {
    const userMessage = `Style: ${style}\nDuration: ${duration} seconds\n\nUser request:\n${rawPrompt}`;

    const rawJson = await this.callWithRetry(
      ENRICH_SYSTEM_PROMPT,
      userMessage,
      'enrichPrompt',
    );

    const cleaned = stripMarkdownFences(rawJson);

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error(`Gemini returned non-JSON for enrichPrompt: ${cleaned.slice(0, 200)}`);
    }

    return this.validateEnrichedBrief(parsed);
  }

  /**
   * Generates a self-contained Remotion TSX component from an enriched brief.
   *
   * If the first attempt produces code that fails sanitization, retries once
   * with the sanitization error appended to the prompt.
   *
   * @param brief      - Enriched creative brief from enrichPrompt().
   * @param duration   - Animation duration in seconds.
   * @param resolution - Target resolution string.
   * @returns Valid, sanitized TSX source code as a string.
   * @throws On repeated failures or if sanitization fails after retry.
   */
  async generateRemotionCode(
    brief: EnrichedBrief,
    duration: number,
    resolution: string,
  ): Promise<string> {
    const userMessage = this.buildCodeGenPrompt(brief, duration, resolution);

    let code = await this.callWithRetry(
      CODE_GENERATION_SYSTEM_PROMPT,
      userMessage,
      'generateRemotionCode',
    );

    code = stripMarkdownFences(code);

    // Attempt sanitization — if it fails, retry once with the error context
    try {
      sanitizeJSX(code);
    } catch (err) {
      if (err instanceof SanitizationError) {
        logger.warn({ msg: 'First code generation failed sanitization, retrying', error: err.message });

        const retryMessage = `${userMessage}\n\n--- PREVIOUS ATTEMPT FAILED SANITIZATION ---\nError: ${err.message}\nPlease fix the issue and regenerate.`;
        code = stripMarkdownFences(
          await this.callWithRetry(
            CODE_GENERATION_SYSTEM_PROMPT,
            retryMessage,
            'generateRemotionCode-retry',
          ),
        );
        // Let this throw if it still fails — caller handles it
        sanitizeJSX(code);
      } else {
        throw err;
      }
    }

    return code;
  }

  // -------------------------------------------------------------------------
  // Private Methods
  // -------------------------------------------------------------------------

  /**
   * Calls Gemini with exponential backoff retry logic.
   *
   * @param systemPrompt - Instruction prompt for the model.
   * @param userMessage  - User-side content of the conversation turn.
   * @param context      - Label used in log messages.
   */
  private async callWithRetry(
    systemPrompt: string,
    userMessage: string,
    context: string,
  ): Promise<string> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        logger.debug({ msg: `Gemini call attempt ${attempt}/${MAX_RETRIES}`, context });

        const result = await this.model.generateContent({
          systemInstruction: systemPrompt,
          contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        });

        const candidate = result.response.candidates?.[0];
        if (!candidate) {
          throw new Error('Gemini returned no candidates');
        }

        const text = candidate.content.parts
          .map((p) => (typeof p.text === 'string' ? p.text : ''))
          .join('');

        if (!text.trim()) {
          throw new Error('Gemini returned an empty response');
        }

        return text;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        logger.warn({
          msg: `Gemini attempt ${attempt} failed`,
          context,
          error: lastError.message,
        });

        if (attempt < MAX_RETRIES) {
          const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
          logger.debug({ msg: `Backing off ${backoff}ms before retry`, context });
          await sleep(backoff);
        }
      }
    }

    throw new Error(
      `Gemini call failed after ${MAX_RETRIES} attempts (${context}): ${lastError?.message}`,
    );
  }

  /**
   * Builds the user-facing prompt for the code generation call.
   */
  private buildCodeGenPrompt(
    brief: EnrichedBrief,
    duration: number,
    resolution: string,
  ): string {
    const [width, height] = resolution === '1080p' ? [1920, 1080] : [1280, 720];
    return [
      `Creative Brief:`,
      `Prompt: ${brief.enrichedPrompt}`,
      `Color Palette: ${brief.colorPalette.join(', ')}`,
      `Font Style: ${brief.fontStyle}`,
      `Animation Mood: ${brief.animationMood}`,
      `Duration: ${duration} seconds (${duration * 30} frames at 30fps)`,
      `Resolution: ${width}x${height} (${resolution})`,
      ``,
      `Key Scenes:`,
      ...brief.keyScenes.map(
        (s) =>
          `  - ${s.startSecond}s: ${s.description} [elements: ${s.elements.join(', ')}]`,
      ),
    ].join('\n');
  }

  /**
   * Validates the shape returned by Gemini for the enrichPrompt call.
   */
  private validateEnrichedBrief(data: unknown): EnrichedBrief {
    if (typeof data !== 'object' || data === null) {
      throw new Error('enrichPrompt response is not an object');
    }

    const d = data as Record<string, unknown>;

    if (typeof d['enrichedPrompt'] !== 'string') {
      throw new Error('enrichPrompt response missing enrichedPrompt string');
    }
    if (!Array.isArray(d['colorPalette'])) {
      throw new Error('enrichPrompt response missing colorPalette array');
    }
    if (typeof d['fontStyle'] !== 'string') {
      throw new Error('enrichPrompt response missing fontStyle string');
    }
    if (typeof d['animationMood'] !== 'string') {
      throw new Error('enrichPrompt response missing animationMood string');
    }
    if (!Array.isArray(d['keyScenes'])) {
      throw new Error('enrichPrompt response missing keyScenes array');
    }

    return d as unknown as EnrichedBrief;
  }
}

export const geminiService = new GeminiService();
