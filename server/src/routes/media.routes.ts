import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import * as mediaController from '../controllers/media.controller';

const router = Router();

// Require JWT authentication for all media routes
router.use(authenticateJWT);

// GET /api/media/history - Retrieve paginated watched history
router.get('/history', mediaController.getWatchedHistory);

// POST /api/media/status - Upsert media status (from title/details views)
router.post('/status', mediaController.upsertMediaStatus);

// PATCH /api/media/:id/status - Update media status by UserMedia ID
router.patch('/:id/status', mediaController.updateMediaStatus);

export default router;
