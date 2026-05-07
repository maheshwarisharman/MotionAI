/**
 * JSX/TSX code sanitizer for LLM-generated Remotion components.
 * Validates structural correctness and blocks dangerous patterns before
 * the code is written to disk and executed by the renderer.
 */

import { SanitizationError } from '../types/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum acceptable length for generated code (characters) */
const MIN_CODE_LENGTH = 100;

/** Maximum acceptable length for generated code (characters) */
const MAX_CODE_LENGTH = 15_000;

/** Patterns that MUST NOT appear in generated code */
const BLOCKED_PATTERNS: ReadonlyArray<string> = [
  'require(',
  'process.',
  'fs.',
  '__dirname',
  'eval(',
  'fetch(',
  'axios',
  'child_process',
  'import(',
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validates LLM-generated TSX code before it is written to disk and rendered.
 *
 * Checks performed:
 *  1. Length is within acceptable bounds.
 *  2. Contains `export default` — ensures the component is exported.
 *  3. Does NOT contain any blocked / dangerous patterns.
 *  4. Contains `useCurrentFrame` — confirms it is a Remotion component.
 *
 * @param code - Raw TSX source code string from the LLM.
 * @throws {SanitizationError} Descriptive error when any check fails.
 */
export function sanitizeJSX(code: string): void {
  // 1. Length check
  if (code.length < MIN_CODE_LENGTH) {
    throw new SanitizationError(
      `Generated code is too short (${code.length} chars). Minimum is ${MIN_CODE_LENGTH}.`,
    );
  }

  if (code.length > MAX_CODE_LENGTH) {
    throw new SanitizationError(
      `Generated code is too long (${code.length} chars). Maximum is ${MAX_CODE_LENGTH}.`,
    );
  }

  // 2. Must export a default component
  if (!code.includes('export default')) {
    throw new SanitizationError(
      'Generated code does not contain "export default". ' +
        'The component must be exported as the default export.',
    );
  }

  // 3. Block dangerous patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (code.includes(pattern)) {
      throw new SanitizationError(
        `Generated code contains forbidden pattern: "${pattern}". ` +
          'This pattern is not allowed for security reasons.',
      );
    }
  }

  // 4. Must use Remotion frame hook
  if (!code.includes('useCurrentFrame')) {
    throw new SanitizationError(
      'Generated code does not use "useCurrentFrame". ' +
        'All animations must be frame-driven using Remotion hooks.',
    );
  }
}
