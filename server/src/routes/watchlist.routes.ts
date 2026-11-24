import { Router } from 'express';
import { authenticateJWT } from '../middleware/auth.middleware';
import * as watchlistController from '../controllers/watchlist.controller';
import * as mediaController from '../controllers/media.controller';

const router = Router();

// Require JWT authentication for all watchlist routes
router.use(authenticateJWT);

// GET /api/watchlists - Retrieve authenticated user's watchlists
router.get('/', watchlistController.getUserWatchlists);

// POST /api/watchlists - Create a custom watchlist
router.post('/', watchlistController.createWatchlist);

// PATCH /api/watchlists/:id - Rename a custom watchlist
router.patch('/:id', watchlistController.renameWatchlist);

// DELETE /api/watchlists/:id - Delete a custom watchlist
router.delete('/:id', watchlistController.deleteWatchlist);

// GET /api/watchlists/:id/items - Retrieve paginated items inside a watchlist
router.get('/:id/items', watchlistController.getWatchlistItems);

// POST /api/watchlists/:id/items - Add a media title to a watchlist
router.post('/:id/items', mediaController.addWatchlistItem);

// DELETE /api/watchlists/:id/items/:userMediaId - Remove a media title from a watchlist
router.delete('/:id/items/:userMediaId', mediaController.removeWatchlistItem);

export default router;
