import { MediaType, WatchlistStatus } from '@prisma/client';
import prisma from '../lib/prisma';
import { MediaMetadata, isUserMediaCompositeP2002 } from '../utils/validation';

export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class DuplicateMembershipError extends Error {
  constructor(message = 'Media is already in this watchlist') {
    super(message);
    this.name = 'DuplicateMembershipError';
  }
}

export interface UserMediaSummary {
  id: string;
  tmdbId: number;
  mediaType: MediaType;
  status: WatchlistStatus;
  title: string | null;
  posterPath: string | null;
  releaseDate: string | null;
  voteAverage: number | null;
  overview: string | null;
  createdAt: Date;
  updatedAt: Date;
  watchlistCount: number;
}

export interface WatchlistItemSummary {
  id: string;
  watchlistId: string;
  userMediaId: string;
  createdAt: Date;
  userMedia: UserMediaSummary;
}

export interface MediaOperationResult {
  media: UserMediaSummary | null;
  message?: string;
}

export interface WatchedHistoryResult {
  history: UserMediaSummary[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
  };
}

export interface AddWatchlistItemInput {
  tmdbId: number;
  mediaType: MediaType;
  metadata: MediaMetadata;
}

export interface UpsertMediaStatusInput {
  tmdbId: number;
  mediaType: MediaType;
  status: WatchlistStatus;
  metadata: MediaMetadata;
}

function formatUserMedia(record: any): UserMediaSummary {
  return {
    id: record.id,
    tmdbId: record.tmdbId,
    mediaType: record.mediaType,
    status: record.status,
    title: record.title,
    posterPath: record.posterPath,
    releaseDate: record.releaseDate,
    voteAverage: record.voteAverage,
    overview: record.overview,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    watchlistCount: record._count?.watchlistItems ?? record.watchlistCount ?? 0,
  };
}

function formatWatchlistItem(item: any): WatchlistItemSummary {
  return {
    id: item.id,
    watchlistId: item.watchlistId,
    userMediaId: item.userMediaId,
    createdAt: item.createdAt,
    userMedia: formatUserMedia(item.userMedia),
  };
}

/**
 * Adds a media title to a watchlist following the global lock hierarchy:
 * 1. Level 1 Lock: Exclusive lock on target Watchlist row.
 * 2. Level 2 Lock: Exclusive lock on UserMedia row (or bounded P2002 retry creation).
 * 3. Membership insertion and duplicate check.
 */
export async function addWatchlistMembership(
  userId: string,
  watchlistId: string,
  input: AddWatchlistItemInput
): Promise<WatchlistItemSummary> {
  let attempt = 0;

  while (attempt <= 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Level 1 Lock: Lock the Watchlist row
        const lockedWl = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Watchlist"
          WHERE "id" = ${watchlistId} AND "userId" = ${userId}
          FOR UPDATE;
        `;
        if (lockedWl.length === 0) {
          throw new NotFoundError('Watchlist not found');
        }

        // Level 2 Lock: Look up existing UserMedia with lock
        const lockedMedia = await tx.$queryRaw<Array<{ id: string; status: WatchlistStatus }>>`
          SELECT "id", "status" FROM "UserMedia"
          WHERE "userId" = ${userId}
            AND "tmdbId" = ${input.tmdbId}
            AND "mediaType" = ${input.mediaType}::"MediaType"
          FOR UPDATE;
        `;

        let userMediaId: string;

        if (lockedMedia.length > 0) {
          userMediaId = lockedMedia[0].id;
          // Refresh metadata snapshot if provided
          await tx.userMedia.update({
            where: { id: userMediaId },
            data: {
              title: input.metadata.title,
              ...(input.metadata.posterPath !== undefined && { posterPath: input.metadata.posterPath }),
              ...(input.metadata.releaseDate !== undefined && { releaseDate: input.metadata.releaseDate }),
              ...(input.metadata.voteAverage !== undefined && { voteAverage: input.metadata.voteAverage }),
              ...(input.metadata.overview !== undefined && { overview: input.metadata.overview }),
            },
          });
        } else {
          // Record does not exist: create new UserMedia with status WANT_TO_WATCH
          const created = await tx.userMedia.create({
            data: {
              userId,
              tmdbId: input.tmdbId,
              mediaType: input.mediaType,
              status: WatchlistStatus.WANT_TO_WATCH,
              title: input.metadata.title,
              posterPath: input.metadata.posterPath ?? null,
              releaseDate: input.metadata.releaseDate ?? null,
              voteAverage: input.metadata.voteAverage ?? null,
              overview: input.metadata.overview ?? null,
            },
          });
          userMediaId = created.id;
        }

        // Check if membership already exists in this watchlist
        const existingMembership = await tx.watchlistItem.findUnique({
          where: {
            watchlistId_userMediaId: {
              watchlistId,
              userMediaId,
            },
          },
        });
        if (existingMembership) {
          throw new DuplicateMembershipError('Media is already in this watchlist');
        }

        // Create membership
        const item = await tx.watchlistItem.create({
          data: {
            watchlistId,
            userMediaId,
          },
          include: {
            userMedia: {
              include: {
                _count: { select: { watchlistItems: true } },
              },
            },
          },
        });

        return formatWatchlistItem(item);
      });
    } catch (error: unknown) {
      if (attempt === 0 && isUserMediaCompositeP2002(error)) {
        attempt++;
        // Aborted transaction was closed by $transaction; retry once in a fresh transaction
        continue;
      }
      throw error;
    }
  }

  throw new Error('Unexpected retry loop termination');
}

/**
 * Removes a media title from a watchlist following the global lock hierarchy:
 * 1. Level 1 Lock: Exclusive lock on target Watchlist row.
 * 2. Level 2 Lock: Exclusive lock on target UserMedia row.
 * 3. Deletes WatchlistItem membership.
 * 4. Pruning: If 0 memberships remain and status is WANT_TO_WATCH, deletes UserMedia.
 */
export async function removeWatchlistMembership(
  userId: string,
  watchlistId: string,
  userMediaId: string
): Promise<{
  message: string;
  userMedia: { id: string; status: WatchlistStatus; remainingWatchlistCount: number } | null;
}> {
  return await prisma.$transaction(async (tx) => {
    // Level 1 Lock: Lock the Watchlist row
    const lockedWl = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Watchlist"
      WHERE "id" = ${watchlistId} AND "userId" = ${userId}
      FOR UPDATE;
    `;
    if (lockedWl.length === 0) {
      throw new NotFoundError('Watchlist not found');
    }

    // Level 2 Lock: Lock target UserMedia row
    const lockedMedia = await tx.$queryRaw<Array<{ id: string; status: WatchlistStatus }>>`
      SELECT "id", "status" FROM "UserMedia"
      WHERE "id" = ${userMediaId} AND "userId" = ${userId}
      FOR UPDATE;
    `;
    if (lockedMedia.length === 0) {
      throw new NotFoundError('Media record not found');
    }

    // Verify membership exists
    const membership = await tx.watchlistItem.findUnique({
      where: {
        watchlistId_userMediaId: {
          watchlistId,
          userMediaId,
        },
      },
    });
    if (!membership) {
      throw new NotFoundError('Media item not found in this watchlist');
    }

    // Delete membership
    await tx.watchlistItem.delete({
      where: {
        watchlistId_userMediaId: {
          watchlistId,
          userMediaId,
        },
      },
    });

    // Count remaining memberships under lock
    const remainingCount = await tx.watchlistItem.count({
      where: { userMediaId },
    });

    // Prune if 0 memberships remain and status is WANT_TO_WATCH
    if (remainingCount === 0 && lockedMedia[0].status === WatchlistStatus.WANT_TO_WATCH) {
      await tx.userMedia.delete({
        where: { id: userMediaId },
      });
      return {
        message: 'Item removed from watchlist and untracked',
        userMedia: null,
      };
    }

    return {
      message: 'Item removed from watchlist successfully',
      userMedia: {
        id: userMediaId,
        status: lockedMedia[0].status,
        remainingWatchlistCount: remainingCount,
      },
    };
  });
}

/**
 * Direct mark-watched or status update by TMDB ID.
 * Follows Level 2 row locking on UserMedia with bounded P2002 retry in a fresh transaction.
 */
export async function upsertMediaStatusWithRetry(
  userId: string,
  input: UpsertMediaStatusInput
): Promise<MediaOperationResult> {
  let attempt = 0;

  while (attempt <= 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        // Level 2 Lock on UserMedia row
        const lockedMedia = await tx.$queryRaw<Array<{ id: string; status: WatchlistStatus }>>`
          SELECT "id", "status" FROM "UserMedia"
          WHERE "userId" = ${userId}
            AND "tmdbId" = ${input.tmdbId}
            AND "mediaType" = ${input.mediaType}::"MediaType"
          FOR UPDATE;
        `;

        if (lockedMedia.length > 0) {
          const mediaId = lockedMedia[0].id;
          const membershipCount = await tx.watchlistItem.count({
            where: { userMediaId: mediaId },
          });

          // Invariant: transitioning to WANT_TO_WATCH with 0 memberships -> Prune
          if (input.status === WatchlistStatus.WANT_TO_WATCH && membershipCount === 0) {
            await tx.userMedia.delete({ where: { id: mediaId } });
            return {
              media: null,
              message: 'Media untracked because it has no watchlist memberships and is not watched',
            };
          }

          // Update status and metadata
          const updated = await tx.userMedia.update({
            where: { id: mediaId },
            data: {
              status: input.status,
              title: input.metadata.title,
              ...(input.metadata.posterPath !== undefined && { posterPath: input.metadata.posterPath }),
              ...(input.metadata.releaseDate !== undefined && { releaseDate: input.metadata.releaseDate }),
              ...(input.metadata.voteAverage !== undefined && { voteAverage: input.metadata.voteAverage }),
              ...(input.metadata.overview !== undefined && { overview: input.metadata.overview }),
            },
            include: {
              _count: { select: { watchlistItems: true } },
            },
          });
          return { media: formatUserMedia(updated) };
        }

        // Record does not exist
        if (input.status === WatchlistStatus.WANT_TO_WATCH) {
          // Untracked title with WANT_TO_WATCH and 0 memberships is not created
          return {
            media: null,
            message: 'Media is untracked because it has no watchlist memberships and is not watched',
          };
        }

        // Create new UserMedia with status WATCHED
        const created = await tx.userMedia.create({
          data: {
            userId,
            tmdbId: input.tmdbId,
            mediaType: input.mediaType,
            status: WatchlistStatus.WATCHED,
            title: input.metadata.title,
            posterPath: input.metadata.posterPath ?? null,
            releaseDate: input.metadata.releaseDate ?? null,
            voteAverage: input.metadata.voteAverage ?? null,
            overview: input.metadata.overview ?? null,
          },
          include: {
            _count: { select: { watchlistItems: true } },
          },
        });

        return { media: formatUserMedia(created) };
      });
    } catch (error: unknown) {
      if (attempt === 0 && isUserMediaCompositeP2002(error)) {
        attempt++;
        continue;
      }
      throw error;
    }
  }

  throw new Error('Unexpected retry loop termination');
}

/**
 * Changes status of an existing UserMedia record by ID.
 * Follows Level 2 row locking on UserMedia.
 */
export async function updateMediaStatusById(
  userId: string,
  mediaId: string,
  newStatus: WatchlistStatus
): Promise<MediaOperationResult> {
  return await prisma.$transaction(async (tx) => {
    // Level 2 Lock: Lock target UserMedia row
    const locked = await tx.$queryRaw<Array<{ id: string; status: WatchlistStatus }>>`
      SELECT "id", "status" FROM "UserMedia"
      WHERE "id" = ${mediaId} AND "userId" = ${userId}
      FOR UPDATE;
    `;
    if (locked.length === 0) {
      throw new NotFoundError('Media record not found');
    }

    // Count memberships under lock
    const membershipCount = await tx.watchlistItem.count({
      where: { userMediaId: mediaId },
    });

    // Invariant: transitioning to WANT_TO_WATCH with 0 memberships -> Prune
    if (newStatus === WatchlistStatus.WANT_TO_WATCH && membershipCount === 0) {
      await tx.userMedia.delete({ where: { id: mediaId } });
      return {
        media: null,
        message: 'Media untracked because it has no watchlist memberships and is not watched',
      };
    }

    // Update status
    const updated = await tx.userMedia.update({
      where: { id: mediaId },
      data: { status: newStatus },
      include: {
        _count: { select: { watchlistItems: true } },
      },
    });

    return { media: formatUserMedia(updated) };
  });
}

/**
 * Retrieves paginated watched history for the authenticated user.
 * Ordered by updatedAt DESC, id DESC.
 */
export async function getWatchedHistory(
  userId: string,
  pagination: { page: number; limit: number }
): Promise<WatchedHistoryResult> {
  const skip = (pagination.page - 1) * pagination.limit;

  const [items, totalCount] = await Promise.all([
    prisma.userMedia.findMany({
      where: {
        userId,
        status: WatchlistStatus.WATCHED,
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip,
      take: pagination.limit,
      include: {
        _count: { select: { watchlistItems: true } },
      },
    }),
    prisma.userMedia.count({
      where: {
        userId,
        status: WatchlistStatus.WATCHED,
      },
    }),
  ]);

  const totalPages = Math.ceil(totalCount / pagination.limit) || 1;

  return {
    history: items.map(formatUserMedia),
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      totalCount,
      totalPages,
    },
  };
}
