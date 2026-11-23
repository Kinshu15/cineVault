import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { validateCustomWatchlistName } from '../utils/validation';

export class NotFoundError extends Error {
  constructor(message = 'Watchlist not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class DuplicateWatchlistNameError extends Error {
  constructor(message = 'A watchlist with this name already exists') {
    super(message);
    this.name = 'DuplicateWatchlistNameError';
  }
}

export class DefaultWatchlistMutationError extends Error {
  constructor(message = 'Default watchlist cannot be modified') {
    super(message);
    this.name = 'DefaultWatchlistMutationError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export interface WatchlistSummary {
  id: string;
  name: string;
  isDefault: boolean;
  itemCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Maps Prisma P2002 errors targeting watchlist name uniqueness to DuplicateWatchlistNameError.
 * Safely parses error.meta?.target whether it is an array of strings, a single string, or undefined.
 * Preserves or rethrows all other errors.
 */
export function handlePrismaError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const rawTarget = error.meta?.target;
    let targetList: string[] = [];

    if (Array.isArray(rawTarget)) {
      targetList = rawTarget.filter((item): item is string => typeof item === 'string');
    } else if (typeof rawTarget === 'string') {
      targetList = [rawTarget];
    }

    // Check for watchlist name uniqueness conflicts:
    // - ["userId", "lower(name)"] (functional index: Watchlist_userId_lower_name_key)
    // - ["userId", "name"] (case-sensitive index: Watchlist_userId_name_key)
    // - "Watchlist_userId_lower_name_key" or "Watchlist_userId_name_key" (string targets)
    // - "lower(name)" or "name" (single column/expression string targets)
    //
    // Note: If target is ["userId"] (partial default index: one_default_watchlist_per_user),
    // isNameConflict will be false, and the original error is preserved and rethrown.
    const isNameConflict = targetList.some(
      (t) =>
        t === 'name' ||
        t === 'lower(name)' ||
        t === 'Watchlist_userId_lower_name_key' ||
        t === 'Watchlist_userId_name_key'
    );

    if (isNameConflict) {
      throw new DuplicateWatchlistNameError('A watchlist with this name already exists');
    }
  }
  throw error;
}

/**
 * Retrieves all watchlists for a given authenticated user.
 * - Always scoped to userId.
 * - Includes accurate itemCount aggregated via Prisma _count.
 * - Orders default list first, followed by custom lists by createdAt ascending.
 */
export async function getUserWatchlists(userId: string): Promise<WatchlistSummary[]> {
  const watchlists = await prisma.watchlist.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      isDefault: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: { items: true },
      },
    },
    orderBy: [
      { isDefault: 'desc' },
      { createdAt: 'asc' },
    ],
  });

  return watchlists.map((w) => ({
    id: w.id,
    name: w.name,
    isDefault: w.isDefault,
    itemCount: w._count.items,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  }));
}

/**
 * Creates a new custom watchlist for the authenticated user.
 * - Validates name (non-empty, <=100 chars, not reserved default name).
 * - Always forces isDefault = false.
 * - Handles duplicate name conflicts via database unique constraints.
 */
export async function createWatchlist(userId: string, name: string): Promise<WatchlistSummary> {
  const validation = validateCustomWatchlistName(name);
  if (!validation.isValid) {
    throw new ValidationError(validation.error);
  }

  try {
    const created = await prisma.watchlist.create({
      data: {
        userId,
        name: validation.value,
        isDefault: false,
      },
      select: {
        id: true,
        name: true,
        isDefault: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      id: created.id,
      name: created.name,
      isDefault: created.isDefault,
      itemCount: 0,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  } catch (error: unknown) {
    handlePrismaError(error);
  }
}

/**
 * Renames an existing custom watchlist.
 * - Scoped by both watchlistId and userId (prevents cross-user mutations).
 * - Rejects renaming the default watchlist.
 * - Validates new name (not empty, <=100 chars, not reserved name).
 * - Handles duplicate name conflicts via database unique constraints.
 */
export async function renameWatchlist(
  userId: string,
  watchlistId: string,
  newName: string
): Promise<WatchlistSummary> {
  const validation = validateCustomWatchlistName(newName);
  if (!validation.isValid) {
    throw new ValidationError(validation.error);
  }

  // Look up watchlist scoped to this user
  const existing = await prisma.watchlist.findFirst({
    where: {
      id: watchlistId,
      userId,
    },
    select: {
      id: true,
      name: true,
      isDefault: true,
    },
  });

  if (!existing) {
    throw new NotFoundError('Watchlist not found');
  }

  if (existing.isDefault) {
    throw new DefaultWatchlistMutationError('The default watchlist cannot be renamed');
  }

  try {
    const updated = await prisma.watchlist.update({
      where: { id: watchlistId },
      data: {
        name: validation.value,
      },
      select: {
        id: true,
        name: true,
        isDefault: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { items: true },
        },
      },
    });

    return {
      id: updated.id,
      name: updated.name,
      isDefault: updated.isDefault,
      itemCount: updated._count.items,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  } catch (error: unknown) {
    handlePrismaError(error);
  }
}

/**
 * Deletes an existing custom watchlist.
 * Follows the global lock hierarchy:
 * 1. Level 1 Lock: Exclusive lock on target Watchlist row.
 * 2. Identifies all affected UserMedia IDs.
 * 3. Level 2 Lock: Exclusive locks on affected UserMedia rows in ascending ID order.
 * 4. Deletes Watchlist (cascades WatchlistItem rows).
 * 5. Prunes orphaned UserMedia records with status WANT_TO_WATCH and 0 remaining memberships.
 */
export async function deleteWatchlist(
  userId: string,
  watchlistId: string
): Promise<{ message: string }> {
  return await prisma.$transaction(async (tx) => {
    // Level 1 Lock: Lock Watchlist row
    const lockedWl = await tx.$queryRaw<Array<{ id: string; isDefault: boolean }>>`
      SELECT "id", "isDefault" FROM "Watchlist"
      WHERE "id" = ${watchlistId} AND "userId" = ${userId}
      FOR UPDATE;
    `;

    if (lockedWl.length === 0) {
      throw new NotFoundError('Watchlist not found');
    }

    if (lockedWl[0].isDefault) {
      throw new DefaultWatchlistMutationError('The default watchlist cannot be deleted');
    }

    // Identify all affected userMediaIds in this watchlist
    const items = await tx.watchlistItem.findMany({
      where: { watchlistId },
      select: { userMediaId: true },
    });

    const userMediaIds = Array.from(new Set(items.map((i) => i.userMediaId)));

    // Level 2 Lock: Lock affected UserMedia rows in deterministic ascending ID order
    if (userMediaIds.length > 0) {
      userMediaIds.sort();
      await tx.$queryRaw`
        SELECT "id", "status" FROM "UserMedia"
        WHERE "id" = ANY(${userMediaIds})
        ORDER BY "id" ASC
        FOR UPDATE;
      `;
    }

    // Delete Watchlist (cascades to delete WatchlistItem records)
    await tx.watchlist.delete({
      where: { id: watchlistId },
    });

    // Prune orphaned WANT_TO_WATCH media with 0 remaining memberships
    if (userMediaIds.length > 0) {
      for (const mediaId of userMediaIds) {
        const remaining = await tx.watchlistItem.count({
          where: { userMediaId: mediaId },
        });

        if (remaining === 0) {
          const media = await tx.userMedia.findUnique({
            where: { id: mediaId },
            select: { status: true },
          });

          if (media?.status === 'WANT_TO_WATCH') {
            await tx.userMedia.delete({
              where: { id: mediaId },
            });
          }
        }
      }
    }

    return { message: 'Watchlist deleted successfully' };
  });
}
