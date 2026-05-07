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
import {
  SanitizationError,
  type EnrichedBrief,
  type PreparedReferenceImage,
} from '../types/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL_NAME = 'gemini-3-flash-preview';
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
- If reference images are provided, preserve their subject identity and visual cues in the brief.
- Output VALID JSON ONLY.
- Never truncate the response.
- Never wrap JSON in markdown.
- Never include explanation text.

Output ONLY the JSON. No markdown, no explanation.`;

const CODE_GENERATION_SYSTEM_PROMPT = `You are an expert Remotion and React developer. Generate a single self-contained Remotion composition component based on the creative brief provided.

STRICT RULES:
1. Output ONLY valid TypeScript/TSX code. No markdown fences, no explanation.
2. The component MUST be a default export named "GeneratedAnimation"
3. Use ONLY these allowed imports:
   - import { useCurrentFrame, useVideoConfig, interpolate, spring, Sequence } from 'remotion'
   - import React from 'react'
   - Relative image imports from './assets/<filename>' when reference images are provided
4. NEVER use external image URLs.
5. NO external font imports.
6. All animations MUST use interpolate() or spring() tied to useCurrentFrame()
7. The component must fill a full frame using width and height from useVideoConfig()
8. Handle multiple scenes using <Sequence from={frameNumber}>
9. Keep the code under 300 lines
10. Use spring() for entrance animations
11. Use the exact color palette from the creative brief
12. End the animation gracefully
13. Use ONLY ASCII punctuation
14. If reference images are provided, animate them directly
15. Every interpolate() call MUST have equal-length inputRange and outputRange arrays.
16. interpolate() outputRange values MUST be numeric only.
17. Never use colors, strings, percentages, or transforms inside interpolate().
18. For colors and transforms, interpolate numeric values separately.
19. Never generate undefined variables.
20. Every spring() call MUST include both fps and frame.
21. Do not generate dynamic array lengths.
22. Never use map() to build interpolate ranges.
23. Prefer simple deterministic animations.
24. Use simple linear animation patterns only.
25. Maximum 2 interpolate() calls per animated element.
26. Avoid nested transforms.
27. Do not generate procedural particle systems.
28. Do not generate dynamically computed ranges.

The output will be directly executed in a Remotion renderer.
Any syntax or runtime error will fail the render.`;

/**
 * Minimal system prompt used for edit/refinement calls.
 */
const EDIT_SYSTEM_PROMPT = `You are an expert Remotion/React developer making targeted edits to an animation.

STRICT RULES:
1. Output ONLY valid TypeScript/TSX. No markdown.
2. Default export must be named "GeneratedAnimation".
3. Allowed imports ONLY:
   - remotion
   - React
   - local ./assets imports
4. No external URLs or font imports.
5. All animations tied to useCurrentFrame().
6. Fill the full frame.
7. Under 300 lines.
8. ASCII punctuation only.
9. Apply ONLY requested changes.
10. Every interpolate() call MUST have matching inputRange/outputRange lengths.
11. interpolate() outputRange values MUST be numeric only.
12. Every spring() call MUST include fps and frame.`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeGeneratedCode(text: string): string {
  return text
    .replace(/^```(?:json|tsx|typescript)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/。/g, '.')
    .replace(/，/g, ',')
    .replace(/；/g, ';')
    .replace(/：/g, ':')
    .replace(/“/g, '"')
    .replace(/”/g, '"')
    .replace(/‘/g, "'")
    .replace(/’/g, "'")
    .trim();
}

/**
 * Runtime hardening for Remotion code.
 * Fixes common hallucinated interpolate/spring issues.
 */
function hardenRemotionCode(code: string): string {
  let safe = code;

  // ---------------------------------------------------
  // Fix interpolate range mismatches
  // ---------------------------------------------------

  safe = safe.replace(
    /interpolate\(\s*([^,]+),\s*\[([^\]]+)\],\s*\[([^\]]+)\]/g,
    (_, value, inputRange, outputRange) => {
      const inVals = inputRange
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);

      const outVals = outputRange
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);

      const minLen = Math.min(inVals.length, outVals.length);

      return `interpolate(${value}, [${inVals
        .slice(0, minLen)
        .join(', ')}], [${outVals.slice(0, minLen).join(', ')}]`;
    },
  );

  // ---------------------------------------------------
  // Replace invalid numeric outputs
  // ---------------------------------------------------

  safe = safe.replace(
    /interpolate\(\s*([^,]+),\s*\[([^\]]+)\],\s*\[([^\]]+)\]/g,
    (match, value, inputRange, outputRange) => {
      const outputs = outputRange
        .split(',')
        .map((s: string) => s.trim());

      const numericOutputs = outputs.every((o: string) =>
        /^-?\d+(\.\d+)?$/.test(o),
      );

      if (!numericOutputs) {
        return `interpolate(${value}, [0, 1], [0, 1]`;
      }

      return match;
    },
  );

  // ---------------------------------------------------
  // Ensure spring includes fps/frame
  // ---------------------------------------------------

  safe = safe.replace(/spring\(\{([^}]+)\}\)/g, (match) => {
    if (!match.includes('fps')) {
      return `spring({ fps, frame })`;
    }

    if (!match.includes('frame')) {
      return `spring({ fps, frame })`;
    }

    return match;
  });

  return safe;
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

  async enrichPrompt(
    rawPrompt: string,
    style: string,
    duration: number,
    referenceImages: PreparedReferenceImage[] = [],
  ): Promise<EnrichedBrief> {
    const userMessage = `Style: ${style}
Duration: ${duration} seconds

User request:
${rawPrompt}`;

    const rawJson = await this.callWithRetry(
      ENRICH_SYSTEM_PROMPT,
      this.buildUserParts(userMessage, referenceImages),
      'enrichPrompt',
    );

    const cleaned = sanitizeGeneratedCode(rawJson);

    let parsed: unknown;

    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error(
        `Gemini returned non-JSON for enrichPrompt: ${cleaned.slice(0, 200)}`,
      );
    }

    return this.validateEnrichedBrief(parsed);
  }

  async generateRemotionCode(
    brief: EnrichedBrief,
    duration: number,
    resolution: string,
    referenceImages: PreparedReferenceImage[] = [],
  ): Promise<string> {
    const userMessage = this.buildCodeGenPrompt(
      brief,
      duration,
      resolution,
      referenceImages,
    );

    let code = await this.callWithRetry(
      CODE_GENERATION_SYSTEM_PROMPT,
      this.buildUserParts(userMessage, referenceImages),
      'generateRemotionCode',
    );

    code = sanitizeGeneratedCode(code);
    code = hardenRemotionCode(code);

    try {
      sanitizeJSX(code);
      this.validateRuntimeSafety(code);
    } catch (err) {
      if (err instanceof SanitizationError) {
        logger.warn({
          msg: 'First code generation failed sanitization, retrying',
          error: err.message,
        });

        const retryMessage = `${userMessage}

--- PREVIOUS ATTEMPT FAILED ---
Error: ${err.message}
Please fix and regenerate.`;

        code = sanitizeGeneratedCode(
          await this.callWithRetry(
            CODE_GENERATION_SYSTEM_PROMPT,
            this.buildUserParts(retryMessage, referenceImages),
            'generateRemotionCode-retry',
          ),
        );

        code = hardenRemotionCode(code);

        sanitizeJSX(code);
        this.validateRuntimeSafety(code);
      } else {
        throw err;
      }
    }

    return code;
  }

  async generateRemotionCodeFromEdit(
    editInstruction: string,
    context: import('../types/index.js').EditContext,
    duration: number,
    resolution: string,
    referenceImages: PreparedReferenceImage[] = [],
  ): Promise<string> {
    const [width, height] =
      resolution === '1080p' ? [1920, 1080] : [1280, 720];

    const userMessage = [
      `Current animation summary: ${context.briefSummary}`,
      `Colors: ${context.colorPalette.join(', ')}`,
      `Mood: ${context.animationMood} | Font: ${context.fontStyle}`,
      `Duration: ${duration}s (${duration * 30} frames at 30fps)`,
      `Resolution: ${width}x${height}`,
      this.buildReferenceImageText(referenceImages),
      ``,
      `User edit request: ${editInstruction}`,
    ].join('\n');

    let code = await this.callWithRetry(
      EDIT_SYSTEM_PROMPT,
      this.buildUserParts(userMessage, referenceImages),
      'generateRemotionCodeFromEdit',
    );

    code = sanitizeGeneratedCode(code);
    code = hardenRemotionCode(code);

    try {
      sanitizeJSX(code);
      this.validateRuntimeSafety(code);
    } catch (err) {
      if (err instanceof SanitizationError) {
        logger.warn({
          msg: 'Edit code failed sanitization, retrying',
          error: (err as Error).message,
        });

        const retryMessage = `${userMessage}

--- PREVIOUS ATTEMPT FAILED ---
Error: ${(err as Error).message}
Fix it and regenerate.`;

        code = sanitizeGeneratedCode(
          await this.callWithRetry(
            EDIT_SYSTEM_PROMPT,
            this.buildUserParts(retryMessage, referenceImages),
            'generateRemotionCodeFromEdit-retry',
          ),
        );

        code = hardenRemotionCode(code);

        sanitizeJSX(code);
        this.validateRuntimeSafety(code);
      } else {
        throw err;
      }
    }

    return code;
  }

  // -------------------------------------------------------------------------
  // Retry + Generation
  // -------------------------------------------------------------------------

  private async callWithRetry(
    systemPrompt: string,
    parts: Array<
      | { text: string }
      | { inlineData: { mimeType: string; data: string } }
    >,
    context: string,
  ): Promise<string> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        logger.debug({
          msg: `Gemini call attempt ${attempt}/${MAX_RETRIES}`,
          context,
        });

        const result = await this.model.generateContent({
          systemInstruction: systemPrompt,

          contents: [
            {
              role: 'user',
              parts,
            },
          ],

          generationConfig: {
            temperature: 0.2,
            topP: 0.8,
            topK: 20,
            maxOutputTokens: 8192,
            responseMimeType: context.includes('enrichPrompt')
              ? 'application/json'
              : 'text/plain',
          },
        });

        const candidate = result.response.candidates?.[0];

        if (!candidate) {
          throw new Error('Gemini returned no candidates');
        }

        const text = candidate.content.parts
          .map((p) => (typeof p.text === 'string' ? p.text : ''))
          .join('');

        if (!text.trim()) {
          throw new Error('Gemini returned empty response');
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

          logger.debug({
            msg: `Backing off ${backoff}ms`,
            context,
          });

          await sleep(backoff);
        }
      }
    }

    throw new Error(
      `Gemini call failed after ${MAX_RETRIES} attempts (${context}): ${lastError?.message}`,
    );
  }

  // -------------------------------------------------------------------------
  // Prompt Builders
  // -------------------------------------------------------------------------

  private buildCodeGenPrompt(
    brief: EnrichedBrief,
    duration: number,
    resolution: string,
    referenceImages: PreparedReferenceImage[],
  ): string {
    const [width, height] =
      resolution === '1080p' ? [1920, 1080] : [1280, 720];

    return [
      `Creative Brief:`,
      `Prompt: ${brief.enrichedPrompt}`,
      `Color Palette: ${brief.colorPalette.join(', ')}`,
      `Font Style: ${brief.fontStyle}`,
      `Animation Mood: ${brief.animationMood}`,
      `Duration: ${duration} seconds (${duration * 30} frames at 30fps)`,
      `Resolution: ${width}x${height} (${resolution})`,
      this.buildReferenceImageText(referenceImages),
      ``,
      `Key Scenes:`,
      ...brief.keyScenes.map(
        (s) =>
          `- ${s.startSecond}s: ${s.description} [elements: ${s.elements.join(
            ', ',
          )}]`,
      ),
    ].join('\n');
  }

  private buildReferenceImageText(
    referenceImages: PreparedReferenceImage[],
  ): string {
    if (!referenceImages.length) {
      return 'Reference Images: none';
    }

    return [
      'Reference Images:',
      ...referenceImages.map(
        (image, index) =>
          `- Image ${index + 1}: available as ./assets/${image.filename}`,
      ),
      'Import assets exactly from the listed paths.',
    ].join('\n');
  }

  private buildUserParts(
    text: string,
    referenceImages: PreparedReferenceImage[],
  ): Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > {
    const parts: Array<
      { text: string } | { inlineData: { mimeType: string; data: string } }
    > = [{ text }];

    for (const image of referenceImages) {
      parts.push({
        inlineData: {
          mimeType: image.mimeType,
          data: image.base64Data,
        },
      });
    }

    return parts;
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  private validateEnrichedBrief(data: unknown): EnrichedBrief {
    if (typeof data !== 'object' || data === null) {
      throw new Error('enrichPrompt response is not an object');
    }

    const d = data as Record<string, unknown>;

    if (typeof d['enrichedPrompt'] !== 'string') {
      throw new Error('Missing enrichedPrompt');
    }

    if (!Array.isArray(d['colorPalette'])) {
      throw new Error('Missing colorPalette');
    }

    if (typeof d['fontStyle'] !== 'string') {
      throw new Error('Missing fontStyle');
    }

    if (typeof d['animationMood'] !== 'string') {
      throw new Error('Missing animationMood');
    }

    if (!Array.isArray(d['keyScenes'])) {
      throw new Error('Missing keyScenes');
    }

    return d as unknown as EnrichedBrief;
  }

  private validateRuntimeSafety(code: string): void {
    const interpolateRegex =
      /interpolate\(\s*[^,]+,\s*\[([^\]]+)\],\s*\[([^\]]+)\]/g;

    let match;

    while ((match = interpolateRegex.exec(code)) !== null) {
      const inputLen = match[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean).length;

      const outputLen = match[2]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean).length;

      if (inputLen !== outputLen) {
        throw new Error(
          `Unsafe interpolate(): inputRange(${inputLen}) !== outputRange(${outputLen})`,
        );
      }
    }
  }
}

export const geminiService = new GeminiService();