import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import prisma from '../src/lib/prisma';
import * as watchlistController from '../src/controllers/watchlist.controller';
import * as watchlistService from '../src/services/watchlist.service';
import { AuthRequest } from '../src/middleware/auth.middleware';

// Helper to create mock Express response
function createMockResponse() {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.body = data;
      return this;
    },
  };
  return res;
}

// Helper to create mock Express request
function createMockRequest(options: {
  userId?: string;
  email?: string;
  params?: Record<string, string>;
  body?: any;
}): AuthRequest {
  return {
    user: options.userId ? { userId: options.userId, email: options.email || 'user@example.com' } : undefined,
    params: options.params || {},
    body: options.body || {},
    headers: {},
  } as unknown as AuthRequest;
}

describe('Watchlist Controller & Service Unit Tests (Mocked Prisma)', () => {
  const originalFindMany = prisma.watchlist.findMany;
  const originalFindFirst = prisma.watchlist.findFirst;
  const originalCreate = prisma.watchlist.create;
  const originalUpdate = prisma.watchlist.update;
  const originalDelete = prisma.watchlist.delete;
  const originalQueryRaw = prisma.$queryRaw;
  const originalTransaction = prisma.$transaction;
  const originalWatchlistItemFindMany = prisma.watchlistItem.findMany;
  const originalWatchlistItemCount = prisma.watchlistItem.count;

  beforeEach(() => {
    (prisma as any).$transaction = async (arg: any) => {
      if (typeof arg === 'function') {
        return arg(prisma);
      }
      return Promise.all(arg);
    };
  });

  afterEach(() => {
    // Restore original prisma methods
    prisma.watchlist.findMany = originalFindMany;
    prisma.watchlist.findFirst = originalFindFirst;
    prisma.watchlist.create = originalCreate;
    prisma.watchlist.update = originalUpdate;
    prisma.watchlist.delete = originalDelete;
    prisma.$queryRaw = originalQueryRaw;
    prisma.$transaction = originalTransaction;
    prisma.watchlistItem.findMany = originalWatchlistItemFindMany;
    prisma.watchlistItem.count = originalWatchlistItemCount;
  });

  // 1. GET returns only the authenticated user's watchlists
  test('1. GET returns only the authenticated user\'s watchlists', async () => {
    let capturedWhere: any = null;
    (prisma.watchlist as any).findMany = async (args: any) => {
      capturedWhere = args.where;
      return [
        {
          id: 'wl_default',
          name: 'My Watchlist',
          isDefault: true,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
          _count: { items: 3 },
        },
      ];
    };

    const req = createMockRequest({ userId: 'user-alpha' });
    const res = createMockResponse();

    await watchlistController.getUserWatchlists(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(capturedWhere, { userId: 'user-alpha' });
    assert.equal(res.body.watchlists.length, 1);
    assert.equal(res.body.watchlists[0].id, 'wl_default');
  });

  // 2. Default watchlist appears first
  test('2. Default watchlist appears first in output', async () => {
    (prisma.watchlist as any).findMany = async (args: any) => {
      // Prisma query orders by isDefault: desc, createdAt: asc
      assert.deepEqual(args.orderBy, [{ isDefault: 'desc' }, { createdAt: 'asc' }]);
      return [
        {
          id: 'wl_default',
          name: 'My Watchlist',
          isDefault: true,
          createdAt: new Date('2026-01-02T00:00:00Z'),
          updatedAt: new Date('2026-01-02T00:00:00Z'),
          _count: { items: 5 },
        },
        {
          id: 'wl_custom_1',
          name: 'Anime',
          isDefault: false,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
          _count: { items: 2 },
        },
      ];
    };

    const req = createMockRequest({ userId: 'user-alpha' });
    const res = createMockResponse();

    await watchlistController.getUserWatchlists(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.watchlists[0].isDefault, true);
    assert.equal(res.body.watchlists[0].name, 'My Watchlist');
    assert.equal(res.body.watchlists[1].isDefault, false);
    assert.equal(res.body.watchlists[1].name, 'Anime');
  });

  // 3. Custom lists are ordered by creation time
  test('3. Custom lists are ordered by creation time', async () => {
    (prisma.watchlist as any).findMany = async () => {
      return [
        {
          id: 'wl_default',
          name: 'My Watchlist',
          isDefault: true,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
          _count: { items: 0 },
        },
        {
          id: 'wl_custom_early',
          name: 'First Custom',
          isDefault: false,
          createdAt: new Date('2026-01-02T00:00:00Z'),
          updatedAt: new Date('2026-01-02T00:00:00Z'),
          _count: { items: 1 },
        },
        {
          id: 'wl_custom_late',
          name: 'Second Custom',
          isDefault: false,
          createdAt: new Date('2026-01-03T00:00:00Z'),
          updatedAt: new Date('2026-01-03T00:00:00Z'),
          _count: { items: 4 },
        },
      ];
    };

    const req = createMockRequest({ userId: 'user-alpha' });
    const res = createMockResponse();

    await watchlistController.getUserWatchlists(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.watchlists[1].name, 'First Custom');
    assert.equal(res.body.watchlists[2].name, 'Second Custom');
  });

  // 4. GET returns accurate item counts
  test('4. GET returns accurate item counts mapped from _count', async () => {
    (prisma.watchlist as any).findMany = async () => {
      return [
        {
          id: 'wl_1',
          name: 'Sci-Fi',
          isDefault: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: { items: 17 },
        },
      ];
    };

    const req = createMockRequest({ userId: 'user-alpha' });
    const res = createMockResponse();

    await watchlistController.getUserWatchlists(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.watchlists[0].itemCount, 17);
    assert.equal(res.body.watchlists[0]._count, undefined, '_count internal field must not be leaked');
  });

  // 5. POST creates a custom watchlist
  test('5. POST creates a custom watchlist with isDefault=false and itemCount=0', async () => {
    let capturedCreateData: any = null;
    (prisma.watchlist as any).create = async (args: any) => {
      capturedCreateData = args.data;
      return {
        id: 'wl_new_123',
        name: args.data.name,
        isDefault: args.data.isDefault,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    };

    const req = createMockRequest({
      userId: 'user-alpha',
      body: { name: '  Anime 2026  ' },
    });
    const res = createMockResponse();

    await watchlistController.createWatchlist(req, res);

    assert.equal(res.statusCode, 201);
    assert.deepEqual(capturedCreateData, {
      userId: 'user-alpha',
      name: 'Anime 2026', // trimmed
      isDefault: false,
    });
    assert.equal(res.body.watchlist.id, 'wl_new_123');
    assert.equal(res.body.watchlist.name, 'Anime 2026');
    assert.equal(res.body.watchlist.isDefault, false);
    assert.equal(res.body.watchlist.itemCount, 0);
  });

  // 6. POST rejects invalid names
  test('6. POST rejects empty names, whitespace-only names, and names over 100 characters', async () => {
    let createCalled = false;
    (prisma.watchlist as any).create = async () => {
      createCalled = true;
    };

    // Empty name
    const reqEmpty = createMockRequest({ userId: 'user-alpha', body: { name: '' } });
    const resEmpty = createMockResponse();
    await watchlistController.createWatchlist(reqEmpty, resEmpty);
    assert.equal(resEmpty.statusCode, 400);

    // Whitespace only
    const reqWhitespace = createMockRequest({ userId: 'user-alpha', body: { name: '     ' } });
    const resWhitespace = createMockResponse();
    await watchlistController.createWatchlist(reqWhitespace, resWhitespace);
    assert.equal(resWhitespace.statusCode, 400);

    // Over 100 characters
    const reqOver100 = createMockRequest({ userId: 'user-alpha', body: { name: 'a'.repeat(101) } });
    const resOver100 = createMockResponse();
    await watchlistController.createWatchlist(reqOver100, resOver100);
    assert.equal(resOver100.statusCode, 400);

    assert.equal(createCalled, false, 'Prisma create must never be called for invalid names');
  });

  // 7. POST rejects reserved name variants
  test('7. POST rejects reserved default name variants (case-insensitive)', async () => {
    let createCalled = false;
    (prisma.watchlist as any).create = async () => {
      createCalled = true;
    };

    const reservedVariants = ['My Watchlist', 'my watchlist', 'MY WATCHLIST', '  my WatchList  '];

    for (const variant of reservedVariants) {
      const req = createMockRequest({ userId: 'user-alpha', body: { name: variant } });
      const res = createMockResponse();
      await watchlistController.createWatchlist(req, res);
      assert.equal(res.statusCode, 400, `Variant "${variant}" must be rejected with 400`);
      assert.match(res.body.error, /reserved system name/i);
    }

    assert.equal(createCalled, false, 'Prisma create must never be called for reserved names');
  });

  // 8. POST handles duplicate names with HTTP 409
  test('8. POST handles duplicate names with HTTP 409 (P2002 on lower(name))', async () => {
    (prisma.watchlist as any).create = async () => {
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target: ['userId', 'lower(name)'] },
      });
    };

    const req = createMockRequest({ userId: 'user-alpha', body: { name: 'Anime' } });
    const res = createMockResponse();

    await watchlistController.createWatchlist(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, 'A watchlist with this name already exists');
  });

  // 9. PATCH renames a custom watchlist
  test('9. PATCH renames a custom watchlist successfully', async () => {
    (prisma.watchlist as any).findFirst = async (args: any) => {
      assert.equal(args.where.id, 'wl_custom_1');
      assert.equal(args.where.userId, 'user-alpha');
      return {
        id: 'wl_custom_1',
        name: 'Old Name',
        isDefault: false,
      };
    };

    (prisma.watchlist as any).update = async (args: any) => {
      assert.equal(args.where.id, 'wl_custom_1');
      assert.equal(args.data.name, 'New Name');
      return {
        id: 'wl_custom_1',
        name: 'New Name',
        isDefault: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { items: 4 },
      };
    };

    const req = createMockRequest({
      userId: 'user-alpha',
      params: { id: 'wl_custom_1' },
      body: { name: '  New Name  ' },
    });
    const res = createMockResponse();

    await watchlistController.renameWatchlist(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.watchlist.name, 'New Name');
    assert.equal(res.body.watchlist.itemCount, 4);
  });

  // 10. PATCH rejects default-list renaming
  test('10. PATCH rejects default-list renaming with HTTP 400', async () => {
    (prisma.watchlist as any).findFirst = async () => {
      return {
        id: 'wl_default_1',
        name: 'My Watchlist',
        isDefault: true,
      };
    };

    let updateCalled = false;
    (prisma.watchlist as any).update = async () => {
      updateCalled = true;
    };

    const req = createMockRequest({
      userId: 'user-alpha',
      params: { id: 'wl_default_1' },
      body: { name: 'Renamed Default' },
    });
    const res = createMockResponse();

    await watchlistController.renameWatchlist(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'The default watchlist cannot be renamed');
    assert.equal(updateCalled, false, 'Default list must never be updated');
  });

  // 11. PATCH rejects duplicate names, including case variants
  test('11. PATCH rejects duplicate names, including case variants, with HTTP 409', async () => {
    (prisma.watchlist as any).findFirst = async () => {
      return {
        id: 'wl_custom_1',
        name: 'Action',
        isDefault: false,
      };
    };

    (prisma.watchlist as any).update = async () => {
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target: ['userId', 'lower(name)'] },
      });
    };

    const req = createMockRequest({
      userId: 'user-alpha',
      params: { id: 'wl_custom_1' },
      body: { name: 'anime' },
    });
    const res = createMockResponse();

    await watchlistController.renameWatchlist(req, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, 'A watchlist with this name already exists');
  });

  // 12. PATCH returns 404 for nonexistent or foreign-owned IDs
  test('12. PATCH returns 404 for nonexistent or foreign-owned IDs', async () => {
    (prisma.watchlist as any).findFirst = async (args: any) => {
      // Scoped lookup returns null if ID doesn't exist or doesn't belong to userId
      return null;
    };

    const req = createMockRequest({
      userId: 'user-alpha',
      params: { id: 'wl_foreign_or_missing' },
      body: { name: 'New Name' },
    });
    const res = createMockResponse();

    await watchlistController.renameWatchlist(req, res);

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, 'Watchlist not found');
  });

  // 13. DELETE removes a custom watchlist
  test('13. DELETE removes a custom watchlist with HTTP 200', async () => {
    (prisma as any).$queryRaw = async () => [{ id: 'wl_custom_1', isDefault: false }];
    (prisma.watchlistItem as any).findMany = async () => [];

    let deletedId: string | null = null;
    (prisma.watchlist as any).delete = async (args: any) => {
      deletedId = args.where.id;
      return { id: args.where.id };
    };

    const req = createMockRequest({
      userId: 'user-alpha',
      params: { id: 'wl_custom_1' },
    });
    const res = createMockResponse();

    await watchlistController.deleteWatchlist(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.message, 'Watchlist deleted successfully');
    assert.equal(deletedId, 'wl_custom_1');
  });

  // 14. DELETE rejects default-list deletion
  test('14. DELETE rejects default-list deletion with HTTP 400', async () => {
    (prisma as any).$queryRaw = async () => [{ id: 'wl_default_1', isDefault: true }];

    let deleteCalled = false;
    (prisma.watchlist as any).delete = async () => {
      deleteCalled = true;
    };

    const req = createMockRequest({
      userId: 'user-alpha',
      params: { id: 'wl_default_1' },
    });
    const res = createMockResponse();

    await watchlistController.deleteWatchlist(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'The default watchlist cannot be deleted');
    assert.equal(deleteCalled, false, 'Default list must never be deleted');
  });

  // 15. DELETE returns 404 for nonexistent or foreign-owned IDs
  test('15. DELETE returns 404 for nonexistent or foreign-owned IDs', async () => {
    (prisma as any).$queryRaw = async () => [];

    const req = createMockRequest({
      userId: 'user-alpha',
      params: { id: 'wl_nonexistent' },
    });
    const res = createMockResponse();

    await watchlistController.deleteWatchlist(req, res);

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, 'Watchlist not found');
  });

  // 16. Deleting a list removes its memberships but preserves WATCHED UserMedia and its metadata
  test('16. Deleting a list invokes only watchlist.delete (relying on DB cascade) and never mutates UserMedia', async () => {
    (prisma as any).$queryRaw = async () => [{ id: 'wl_custom_with_watched_media', isDefault: false }];
    (prisma.watchlistItem as any).findMany = async () => [{ userMediaId: 'um_watched' }];
    (prisma.watchlistItem as any).count = async () => 0;
    (prisma.userMedia as any).findUnique = async () => ({ status: 'WATCHED' });

    let watchlistDeleteCalled = false;
    (prisma.watchlist as any).delete = async (args: any) => {
      watchlistDeleteCalled = true;
      assert.equal(args.where.id, 'wl_custom_with_watched_media');
      return { id: args.where.id };
    };

    // Spy on UserMedia methods to ensure they are never invoked for WATCHED records
    let userMediaDeleted = false;
    const origUserMediaDelete = prisma.userMedia.delete;
    (prisma.userMedia as any).delete = async () => {
      userMediaDeleted = true;
    };

    try {
      const req = createMockRequest({
        userId: 'user-alpha',
        params: { id: 'wl_custom_with_watched_media' },
      });
      const res = createMockResponse();

      await watchlistController.deleteWatchlist(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(watchlistDeleteCalled, true);
      assert.equal(userMediaDeleted, false, 'WATCHED UserMedia must not be deleted during watchlist deletion');
    } finally {
      prisma.userMedia.delete = origUserMediaDelete;
    }
  });

  describe('handlePrismaError defensive target parsing', () => {
    function makeP2002Error(target: any) {
      return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target },
      });
    }

    test('correctly maps target as array with "lower(name)"', () => {
      assert.throws(
        () => watchlistService.handlePrismaError(makeP2002Error(['userId', 'lower(name)'])),
        watchlistService.DuplicateWatchlistNameError
      );
    });

    test('correctly maps target as array with "name"', () => {
      assert.throws(
        () => watchlistService.handlePrismaError(makeP2002Error(['userId', 'name'])),
        watchlistService.DuplicateWatchlistNameError
      );
    });

    test('correctly maps target as single string', () => {
      assert.throws(
        () => watchlistService.handlePrismaError(makeP2002Error('Watchlist_userId_lower_name_key')),
        watchlistService.DuplicateWatchlistNameError
      );
      assert.throws(
        () => watchlistService.handlePrismaError(makeP2002Error('Watchlist_userId_name_key')),
        watchlistService.DuplicateWatchlistNameError
      );
      assert.throws(
        () => watchlistService.handlePrismaError(makeP2002Error('lower(name)')),
        watchlistService.DuplicateWatchlistNameError
      );
      assert.throws(
        () => watchlistService.handlePrismaError(makeP2002Error('name')),
        watchlistService.DuplicateWatchlistNameError
      );
    });

    test('safely filters non-string elements in target array', () => {
      assert.throws(
        () => watchlistService.handlePrismaError(makeP2002Error(['userId', 12345, null, 'lower(name)'])),
        watchlistService.DuplicateWatchlistNameError
      );
    });

    test('rethrows original Prisma error when target is ["userId"] (partial default-list index)', () => {
      const err = makeP2002Error(['userId']);
      assert.throws(
        () => watchlistService.handlePrismaError(err),
        (thrown: any) => thrown === err && thrown.code === 'P2002'
      );
    });

    test('rethrows original Prisma error when target is string "userId"', () => {
      const err = makeP2002Error('userId');
      assert.throws(
        () => watchlistService.handlePrismaError(err),
        (thrown: any) => thrown === err && thrown.code === 'P2002'
      );
    });

    test('rethrows original Prisma error when target is undefined, null, or non-string object', () => {
      const errUndefined = makeP2002Error(undefined);
      assert.throws(
        () => watchlistService.handlePrismaError(errUndefined),
        (thrown: any) => thrown === errUndefined
      );

      const errNull = makeP2002Error(null);
      assert.throws(
        () => watchlistService.handlePrismaError(errNull),
        (thrown: any) => thrown === errNull
      );

      const errObj = makeP2002Error({ custom: 'target' });
      assert.throws(
        () => watchlistService.handlePrismaError(errObj),
        (thrown: any) => thrown === errObj
      );
    });

    test('rethrows non-P2002 Prisma error', () => {
      const nonP2002 = new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: '6.19.3',
      });
      assert.throws(
        () => watchlistService.handlePrismaError(nonP2002),
        (thrown: any) => thrown === nonP2002
      );
    });

    test('rethrows general non-Prisma error', () => {
      const generalErr = new Error('Database connection lost');
      assert.throws(
        () => watchlistService.handlePrismaError(generalErr),
        (thrown: any) => thrown === generalErr
      );
    });
  });
});
