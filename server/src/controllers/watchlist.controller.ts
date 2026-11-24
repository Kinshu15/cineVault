import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { validateCustomWatchlistName, validatePagination } from '../utils/validation';
import * as watchlistService from '../services/watchlist.service';
import {
  NotFoundError,
  DuplicateWatchlistNameError,
  DefaultWatchlistMutationError,
  ValidationError,
} from '../services/watchlist.service';

/**
 * GET /api/watchlists
 * Retrieves all watchlists belonging to the authenticated user.
 */
export async function getUserWatchlists(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const watchlists = await watchlistService.getUserWatchlists(userId);
    res.status(200).json({ watchlists });
  } catch (error: any) {
    console.error('[WatchlistController] Error in getUserWatchlists:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/watchlists
 * Creates a new custom watchlist for the authenticated user.
 */
export async function createWatchlist(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const rawName = req.body?.name;
    const validation = validateCustomWatchlistName(rawName);
    if (!validation.isValid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const watchlist = await watchlistService.createWatchlist(userId, validation.value);
    res.status(201).json({ watchlist });
  } catch (error: any) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (error instanceof DuplicateWatchlistNameError) {
      res.status(409).json({ error: error.message });
      return;
    }
    console.error('[WatchlistController] Error in createWatchlist:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PATCH /api/watchlists/:id
 * Renames an existing custom watchlist.
 */
export async function renameWatchlist(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    if (!id || typeof id !== 'string' || id.trim() === '') {
      res.status(400).json({ error: 'Watchlist ID is required' });
      return;
    }

    const rawName = req.body?.name;
    const validation = validateCustomWatchlistName(rawName);
    if (!validation.isValid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const watchlist = await watchlistService.renameWatchlist(userId, id.trim(), validation.value);
    res.status(200).json({ watchlist });
  } catch (error: any) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (error instanceof NotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof DefaultWatchlistMutationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (error instanceof DuplicateWatchlistNameError) {
      res.status(409).json({ error: error.message });
      return;
    }
    console.error('[WatchlistController] Error in renameWatchlist:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * DELETE /api/watchlists/:id
 * Deletes an existing custom watchlist.
 */
export async function deleteWatchlist(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    if (!id || typeof id !== 'string' || id.trim() === '') {
      res.status(400).json({ error: 'Watchlist ID is required' });
      return;
    }

    const result = await watchlistService.deleteWatchlist(userId, id.trim());
    res.status(200).json(result);
  } catch (error: any) {
    if (error instanceof NotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof DefaultWatchlistMutationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    console.error('[WatchlistController] Error in deleteWatchlist:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/watchlists/:id/items
 * Retrieves paginated media items inside a specific watchlist.
 */
export async function getWatchlistItems(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    if (!id || typeof id !== 'string' || id.trim() === '') {
      res.status(400).json({ error: 'Watchlist ID is required' });
      return;
    }

    const paginationValidation = validatePagination(req.query?.page, req.query?.limit);
    if (!paginationValidation.isValid) {
      res.status(400).json({ error: paginationValidation.error });
      return;
    }

    const result = await watchlistService.getWatchlistItems(
      userId,
      id.trim(),
      paginationValidation.value
    );
    res.status(200).json(result);
  } catch (error: any) {
    if (error instanceof NotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    console.error('[WatchlistController] Error in getWatchlistItems:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
