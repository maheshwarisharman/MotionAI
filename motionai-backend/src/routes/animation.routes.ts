/**
 * Animation routes — registers all /api/animation endpoints.
 */

import { Router } from 'express';
import { animationController } from '../controllers/animation.controller.js';

const router = Router();

/**
 * POST /api/animation/generate
 * Accepts an animation prompt and enqueues a render job.
 */
router.post('/generate', (req, res, next) => {
  animationController.generate(req, res, next);
});

/**
 * GET /api/animation/status/:jobId
 * Returns the current status of a render job.
 */
router.get('/status/:jobId', (req, res, next) => {
  animationController.getStatus(req, res, next);
});

export default router;
