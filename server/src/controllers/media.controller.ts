import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import {
  validateTmdbId,
  validateMediaType,
  validateWatchlistStatus,
  validateMediaMetadata,
  validatePagination,
} from '../utils/validation';
import * as mediaService from '../services/media.service';
import { NotFoundError, DuplicateMembershipError } from '../services/media.service';

/**
 * Service delegates container allowing clean service mocking in route/controller unit tests.
 */
export const services = {
  addWatchlistMembership: mediaService.addWatchlistMembership,
  removeWatchlistMembership: mediaService.removeWatchlistMembership,
  upsertMediaStatusWithRetry: mediaService.upsertMediaStatusWithRetry,
  updateMediaStatusById: mediaService.updateMediaStatusById,
  getWatchedHistory: mediaService.getWatchedHistory,
  getMediaTrackedStatus: mediaService.getMediaTrackedStatus,
};

/**
 * POST /api/watchlists/:id/items
 * Adds a media item to an authenticated user's watchlist.
 */
export async function addWatchlistItem(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const watchlistId = req.params.id;
    if (!watchlistId || typeof watchlistId !== 'string' || watchlistId.trim() === '') {
      res.status(400).json({ error: 'Watchlist ID is required' });
      return;
    }

    if (!req.body || typeof req.body !== 'object') {
      res.status(400).json({ error: 'Request body must be an object' });
      return;
    }

    const tmdbIdValidation = validateTmdbId(req.body.tmdbId);
    if (!tmdbIdValidation.isValid) {
      res.status(400).json({ error: tmdbIdValidation.error });
      return;
    }

    const mediaTypeValidation = validateMediaType(req.body.mediaType);
    if (!mediaTypeValidation.isValid) {
      res.status(400).json({ error: mediaTypeValidation.error });
      return;
    }

    const metadataValidation = validateMediaMetadata(req.body.metadata);
    if (!metadataValidation.isValid) {
      res.status(400).json({ error: metadataValidation.error });
      return;
    }

    const item = await services.addWatchlistMembership(userId, watchlistId.trim(), {
      tmdbId: tmdbIdValidation.value,
      mediaType: mediaTypeValidation.value,
      metadata: metadataValidation.value,
    });

    res.status(201).json({ item });
  } catch (error: any) {
    if (error instanceof DuplicateMembershipError || error?.name === 'DuplicateMembershipError') {
      res.status(409).json({ error: error.message });
      return;
    }
    if (error instanceof NotFoundError || error?.name === 'NotFoundError') {
      res.status(404).json({ error: error.message });
      return;
    }
    console.error('[MediaController] Error in addWatchlistItem:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * DELETE /api/watchlists/:id/items/:userMediaId
 * Removes a media item from an authenticated user's watchlist.
 */
export async function removeWatchlistItem(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const watchlistId = req.params.id;
    if (!watchlistId || typeof watchlistId !== 'string' || watchlistId.trim() === '') {
      res.status(400).json({ error: 'Watchlist ID is required' });
      return;
    }

    const userMediaId = req.params.userMediaId;
    if (!userMediaId || typeof userMediaId !== 'string' || userMediaId.trim() === '') {
      res.status(400).json({ error: 'UserMedia ID is required' });
      return;
    }

    const result = await services.removeWatchlistMembership(
      userId,
      watchlistId.trim(),
      userMediaId.trim()
    );

    res.status(200).json(result);
  } catch (error: any) {
    if (error instanceof NotFoundError || error?.name === 'NotFoundError') {
      res.status(404).json({ error: error.message });
      return;
    }
    console.error('[MediaController] Error in removeWatchlistItem:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/media/status
 * Sets global media status (e.g. marked as WATCHED or WANT_TO_WATCH from title details).
 * Handles untracked WANT_TO_WATCH returning media: null.
 */
export async function upsertMediaStatus(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!req.body || typeof req.body !== 'object') {
      res.status(400).json({ error: 'Request body must be an object' });
      return;
    }

    const tmdbIdValidation = validateTmdbId(req.body.tmdbId);
    if (!tmdbIdValidation.isValid) {
      res.status(400).json({ error: tmdbIdValidation.error });
      return;
    }

    const mediaTypeValidation = validateMediaType(req.body.mediaType);
    if (!mediaTypeValidation.isValid) {
      res.status(400).json({ error: mediaTypeValidation.error });
      return;
    }

    const statusValidation = validateWatchlistStatus(req.body.status);
    if (!statusValidation.isValid) {
      res.status(400).json({ error: statusValidation.error });
      return;
    }

    const metadataValidation = validateMediaMetadata(req.body.metadata);
    if (!metadataValidation.isValid) {
      res.status(400).json({ error: metadataValidation.error });
      return;
    }

    const result = await services.upsertMediaStatusWithRetry(userId, {
      tmdbId: tmdbIdValidation.value,
      mediaType: mediaTypeValidation.value,
      status: statusValidation.value,
      metadata: metadataValidation.value,
    });

    res.status(200).json(result);
  } catch (error: any) {
    if (error instanceof NotFoundError || error?.name === 'NotFoundError') {
      res.status(404).json({ error: error.message });
      return;
    }
    console.error('[MediaController] Error in upsertMediaStatus:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * PATCH /api/media/:id/status
 * Updates the status of an existing UserMedia record by primary ID.
 */
export async function updateMediaStatus(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const mediaId = req.params.id;
    if (!mediaId || typeof mediaId !== 'string' || mediaId.trim() === '') {
      res.status(400).json({ error: 'Media ID is required' });
      return;
    }

    if (!req.body || typeof req.body !== 'object') {
      res.status(400).json({ error: 'Request body must be an object' });
      return;
    }

    const statusValidation = validateWatchlistStatus(req.body.status);
    if (!statusValidation.isValid) {
      res.status(400).json({ error: statusValidation.error });
      return;
    }

    const result = await services.updateMediaStatusById(
      userId,
      mediaId.trim(),
      statusValidation.value
    );

    res.status(200).json(result);
  } catch (error: any) {
    if (error instanceof NotFoundError || error?.name === 'NotFoundError') {
      res.status(404).json({ error: error.message });
      return;
    }
    console.error('[MediaController] Error in updateMediaStatus:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/media/history
 * Retrieves paginated watched viewing history for the authenticated user.
 */
export async function getWatchedHistory(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const paginationValidation = validatePagination(req.query.page, req.query.limit);
    if (!paginationValidation.isValid) {
      res.status(400).json({ error: paginationValidation.error });
      return;
    }

    const result = await services.getWatchedHistory(userId, paginationValidation.value);
    res.status(200).json(result);
  } catch (error: any) {
    console.error('[MediaController] Error in getWatchedHistory:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/media/:mediaType/:tmdbId
 * Retrieves tracking status, global status, and watchlist memberships for a title.
 */
export async function getMediaTrackedStatus(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const mediaTypeValidation = validateMediaType(req.params.mediaType);
    if (!mediaTypeValidation.isValid) {
      res.status(400).json({ error: mediaTypeValidation.error });
      return;
    }

    const tmdbIdValidation = validateTmdbId(req.params.tmdbId);
    if (!tmdbIdValidation.isValid) {
      res.status(400).json({ error: tmdbIdValidation.error });
      return;
    }

    const result = await services.getMediaTrackedStatus(
      userId,
      tmdbIdValidation.value,
      mediaTypeValidation.value
    );

    res.status(200).json(result);
  } catch (error: any) {
    console.error('[MediaController] Error in getMediaTrackedStatus:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
