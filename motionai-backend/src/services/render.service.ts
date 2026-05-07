/**
 * Render service — bundles and renders LLM-generated Remotion TSX to MP4.
 *
 * Execution flow:
 *  1. Write generated TSX to a temp job directory.
 *  2. Write a Remotion entry file that registers the composition.
 *  3. Symlink the project's node_modules into the temp directory.
 *  4. Bundle the entry file with @remotion/bundler.
 *  5. Render to MP4 with @remotion/renderer, reporting progress.
 *  6. Return the output MP4 path.
 */

import path from 'path';
import fs from 'fs';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { env } from '../config/env.js';
import { referenceImageService } from './reference-image.service.js';
import { logger } from '../utils/logger.js';
import type { RenderOptions } from '../types/index.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FPS = 30;
const OUTPUT_FILENAME = 'output.mp4';
const ENTRY_FILENAME = 'index.tsx';
const COMPONENT_FILENAME = 'GeneratedAnimation.tsx';
const COMPOSITION_ID = 'GeneratedAnimation';

const RESOLUTION_MAP = new Map<string, { width: number; height: number }>([
  ['720p', { width: 1280, height: 720 }],
  ['1080p', { width: 1920, height: 1080 }],
]);

const DEFAULT_RESOLUTION = { width: 1280, height: 720 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds the Remotion entry file content that registers the root composition.
 */
function buildEntryFile(duration: number, resolution: string): string {
  const { width, height } = RESOLUTION_MAP.get(resolution) ?? DEFAULT_RESOLUTION;
  const durationInFrames = duration * FPS;

  return `import { registerRoot, Composition } from 'remotion';
import { GeneratedAnimation } from './GeneratedAnimation';

const Root = () => (
  <Composition
    id="${COMPOSITION_ID}"
    component={GeneratedAnimation}
    durationInFrames={${durationInFrames}}
    fps={${FPS}}
    width={${width}}
    height={${height}}
  />
);

registerRoot(Root);
`;
}

// ---------------------------------------------------------------------------
// RenderService
// ---------------------------------------------------------------------------

export class RenderService {
  /**
   * Renders the provided TSX code to an MP4 file on disk.
   *
   * @param options - Render options including jobId, tsxCode, duration, resolution.
   * @returns Absolute path to the rendered MP4 file.
   * @throws If bundling or rendering fails.
   */
  async render(options: RenderOptions): Promise<string> {
    const { jobId, tsxCode, duration, resolution, referenceImages, onProgress } =
      options;

    const jobDir = path.join(env.TEMP_DIR, jobId);
    const componentPath = path.join(jobDir, COMPONENT_FILENAME);
    const entryPath = path.join(jobDir, ENTRY_FILENAME);
    const outputPath = path.join(jobDir, OUTPUT_FILENAME);
    const nodeModulesLink = path.join(jobDir, 'node_modules');

    logger.info({ msg: 'Starting render', jobId, resolution, duration });

    // Step 1: Create job-scoped temp directory
    fs.mkdirSync(jobDir, { recursive: true });
    logger.debug({ msg: 'Created job temp directory', jobDir });

    // Step 2: Write generated component
    fs.writeFileSync(componentPath, tsxCode, 'utf8');
    logger.debug({ msg: 'Wrote GeneratedAnimation.tsx', componentPath });

    // Step 2b: Write any user-supplied reference images into ./assets
    if (referenceImages?.length) {
      referenceImageService.writeImagesToJobDirectory(jobDir, referenceImages);
    }

    // Step 3: Write Remotion entry file
    const entryContent = buildEntryFile(duration, resolution);
    fs.writeFileSync(entryPath, entryContent, 'utf8');
    logger.debug({ msg: 'Wrote Remotion entry file', entryPath });

    // Step 4: Symlink node_modules so the bundler can resolve remotion + react
    const projectNodeModules = path.resolve(process.cwd(), 'node_modules');
    if (!fs.existsSync(nodeModulesLink)) {
      fs.symlinkSync(projectNodeModules, nodeModulesLink, 'dir');
      logger.debug({ msg: 'Symlinked node_modules', from: projectNodeModules, to: nodeModulesLink });
    }

    let bundleLocation: string;

    // Step 5: Bundle the entry file
    try {
      logger.info({ msg: 'Bundling entry file', jobId });
      bundleLocation = await bundle({
        entryPoint: entryPath,
        webpackOverride: (config) => config,
      });
      logger.info({ msg: 'Bundle complete', jobId, bundleLocation });
    } catch (err) {
      logger.error({ msg: 'Bundling failed', jobId, error: (err as Error).message });
      throw new Error(`Bundle step failed: ${(err as Error).message}`);
    }

    // Step 6: Select the composition
    let composition: Awaited<ReturnType<typeof selectComposition>>;
    try {
      composition = await selectComposition({
        serveUrl: bundleLocation,
        id: COMPOSITION_ID,
      });
    } catch (err) {
      logger.error({ msg: 'Composition selection failed', jobId, error: (err as Error).message });
      throw new Error(`Could not select composition "${COMPOSITION_ID}": ${(err as Error).message}`);
    }

    // Step 7: Render to MP4
    try {
      logger.info({ msg: 'Rendering MP4', jobId, outputPath });
      await renderMedia({
        composition,
        serveUrl: bundleLocation,
        codec: 'h264',
        outputLocation: outputPath,
        onProgress: ({ progress }) => {
          const percent = Math.round(progress * 100);
          onProgress(percent);
          logger.debug({ msg: 'Render progress', jobId, percent });
        },
      });
      logger.info({ msg: 'Render complete', jobId, outputPath });
    } catch (err) {
      logger.error({ msg: 'Render failed', jobId, error: (err as Error).message });
      throw new Error(`Render step failed: ${(err as Error).message}`);
    }

    return outputPath;
  }

  /**
   * Removes the temporary job directory from disk.
   * Called by the worker after a successful S3 upload.
   *
   * @param jobId - Job identifier whose temp directory should be deleted.
   */
  cleanupJobDir(jobId: string): void {
    const jobDir = path.join(env.TEMP_DIR, jobId);
    try {
      fs.rmSync(jobDir, { recursive: true, force: true });
      logger.info({ msg: 'Cleaned up job temp directory', jobDir });
    } catch (err) {
      // Non-fatal — log and continue
      logger.warn({ msg: 'Failed to clean up job temp directory', jobDir, error: (err as Error).message });
    }
  }
}

export const renderService = new RenderService();
