/**
 * Project routes — /api/projects
 */

import { Router } from 'express';
import { projectController } from '../controllers/project.controller.js';
import { optionalSupabaseAuth } from '../middleware/auth.middleware.js';

const router = Router();

router.use((req, res, next) => {
  optionalSupabaseAuth(req, res, next);
});

/** POST /api/projects — create project + first generation */
router.post('/', (req, res, next) => projectController.create(req, res, next));

/** GET /api/projects — list all projects */
router.get('/', (req, res, next) => projectController.list(req, res, next));

/** GET /api/projects/:projectId — get project details + chat history */
router.get('/:projectId', (req, res, next) => projectController.getOne(req, res, next));

/** POST /api/projects/:projectId/chat — send edit / continue conversation */
router.post('/:projectId/chat', (req, res, next) => projectController.chat(req, res, next));

export default router;
