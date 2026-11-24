import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import app from '../src/index';
import prisma from '../src/lib/prisma';

describe('Watchlist Routes & Express Mounting Integration Tests', () => {
  let server: http.Server;
  let baseUrl: string;

  const testSecret = process.env.JWT_SECRET || 'cinevault_test_jwt_secret_key_12345';
  process.env.JWT_SECRET = testSecret;

  // Generate valid test JWT tokens
  const tokenUserAlpha = jwt.sign(
    { userId: 'user-alpha', email: 'alpha@cinevault.local' },
    testSecret,
    { algorithm: 'HS256', expiresIn: '1h' }
  );

  const tokenUserBeta = jwt.sign(
    { userId: 'user-beta', email: 'beta@cinevault.local' },
    testSecret,
    { algorithm: 'HS256', expiresIn: '1h' }
  );

  const originalFindMany = prisma.watchlist.findMany;
  const originalFindFirst = prisma.watchlist.findFirst;
  const originalCreate = prisma.watchlist.create;
  const originalUpdate = prisma.watchlist.update;
  const originalDelete = prisma.watchlist.delete;
  const originalQueryRaw = prisma.$queryRaw;
  const originalTransaction = prisma.$transaction;
  const originalWatchlistItemFindMany = prisma.watchlistItem.findMany;
  const originalWatchlistItemCount = prisma.watchlistItem.count;

  before(async () => {
    // Start Express app on an ephemeral port (port 0)
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          baseUrl = `http://localhost:${address.port}`;
        }
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  beforeEach(() => {
    (prisma as any).$transaction = async (arg: any) => {
      if (typeof arg === 'function') {
        return arg(prisma);
      }
      return Promise.all(arg);
    };
  });

  afterEach(() => {
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

  // 1. GET without a token returns 401
  test('1. GET /api/watchlists without a token returns 401', async () => {
    const res = await fetch(`${baseUrl}/api/watchlists`);
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.error, 'Authorization token required');
  });

  // 2. POST without a token returns 401
  test('2. POST /api/watchlists without a token returns 401', async () => {
    const res = await fetch(`${baseUrl}/api/watchlists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Anime' }),
    });
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.error, 'Authorization token required');
  });

  // 3. PATCH without a token returns 401
  test('3. PATCH /api/watchlists/:id without a token returns 401', async () => {
    const res = await fetch(`${baseUrl}/api/watchlists/wl_123`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Name' }),
    });
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.error, 'Authorization token required');
  });

  // 4. DELETE without a token returns 401
  test('4. DELETE /api/watchlists/:id without a token returns 401', async () => {
    const res = await fetch(`${baseUrl}/api/watchlists/wl_123`, {
      method: 'DELETE',
    });
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.error, 'Authorization token required');
  });

  // 5. Authenticated GET returns the authenticated user's lists
  test('5. Authenticated GET /api/watchlists returns authenticated user\'s lists', async () => {
    let capturedWhere: any = null;
    (prisma.watchlist as any).findMany = async (args: any) => {
      capturedWhere = args.where;
      return [
        {
          id: 'wl_default_alpha',
          name: 'My Watchlist',
          isDefault: true,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
          _count: { items: 3 },
        },
      ];
    };

    const res = await fetch(`${baseUrl}/api/watchlists`, {
      headers: { Authorization: `Bearer ${tokenUserAlpha}` },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(capturedWhere, { userId: 'user-alpha' });
    assert.equal(data.watchlists.length, 1);
    assert.equal(data.watchlists[0].id, 'wl_default_alpha');
    assert.equal(data.watchlists[0].itemCount, 3);
  });

  // 6. Authenticated POST creates a custom list
  test('6. Authenticated POST /api/watchlists creates a custom list', async () => {
    let capturedCreateData: any = null;
    (prisma.watchlist as any).create = async (args: any) => {
      capturedCreateData = args.data;
      return {
        id: 'wl_custom_alpha_1',
        name: args.data.name,
        isDefault: args.data.isDefault,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    };

    const res = await fetch(`${baseUrl}/api/watchlists`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenUserAlpha}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: '  Sci-Fi Classics  ' }),
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.deepEqual(capturedCreateData, {
      userId: 'user-alpha',
      name: 'Sci-Fi Classics',
      isDefault: false,
    });
    assert.equal(data.watchlist.id, 'wl_custom_alpha_1');
    assert.equal(data.watchlist.name, 'Sci-Fi Classics');
    assert.equal(data.watchlist.isDefault, false);
    assert.equal(data.watchlist.itemCount, 0);
  });

  // 7. Authenticated PATCH renames a custom list
  test('7. Authenticated PATCH /api/watchlists/:id renames a custom list', async () => {
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
      assert.equal(args.data.name, 'Renamed Classics');
      return {
        id: 'wl_custom_1',
        name: 'Renamed Classics',
        isDefault: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { items: 2 },
      };
    };

    const res = await fetch(`${baseUrl}/api/watchlists/wl_custom_1`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${tokenUserAlpha}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: '  Renamed Classics  ' }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.watchlist.name, 'Renamed Classics');
    assert.equal(data.watchlist.itemCount, 2);
  });

  // 8. Authenticated DELETE deletes a custom list
  test('8. Authenticated DELETE /api/watchlists/:id deletes a custom list', async () => {
    (prisma as any).$queryRaw = async () => [{ id: 'wl_custom_to_delete', isDefault: false }];
    (prisma.watchlistItem as any).findMany = async () => [];

    let deletedId: string | null = null;
    (prisma.watchlist as any).delete = async (args: any) => {
      deletedId = args.where.id;
      return { id: args.where.id };
    };

    const res = await fetch(`${baseUrl}/api/watchlists/wl_custom_to_delete`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenUserAlpha}` },
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.message, 'Watchlist deleted successfully');
    assert.equal(deletedId, 'wl_custom_to_delete');
  });

  // 9. Invalid input returns 400
  test('9. Invalid input returns 400 for empty or whitespace-only names', async () => {
    const resEmpty = await fetch(`${baseUrl}/api/watchlists`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenUserAlpha}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: '' }),
    });
    assert.equal(resEmpty.status, 400);

    const resWhitespace = await fetch(`${baseUrl}/api/watchlists`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenUserAlpha}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: '    ' }),
    });
    assert.equal(resWhitespace.status, 400);

    const resOver100 = await fetch(`${baseUrl}/api/watchlists`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenUserAlpha}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'x'.repeat(101) }),
    });
    assert.equal(resOver100.status, 400);
  });

  // 10. Duplicate names return 409
  test('10. Duplicate names return 409 (P2002 violation)', async () => {
    (prisma.watchlist as any).create = async () => {
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target: ['userId', 'lower(name)'] },
      });
    };

    const res = await fetch(`${baseUrl}/api/watchlists`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenUserAlpha}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Anime' }),
    });

    assert.equal(res.status, 409);
    const data = await res.json();
    assert.equal(data.error, 'A watchlist with this name already exists');
  });

  // 11. Default-list rename/delete restrictions remain enforced
  test('11. Default-list rename and delete restrictions return 400', async () => {
    (prisma.watchlist as any).findFirst = async () => {
      return {
        id: 'wl_default',
        name: 'My Watchlist',
        isDefault: true,
      };
    };

    // Rename attempt on default list
    const resRename = await fetch(`${baseUrl}/api/watchlists/wl_default`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${tokenUserAlpha}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Renamed Default' }),
    });
    assert.equal(resRename.status, 400);
    const renameData = await resRename.json();
    assert.equal(renameData.error, 'The default watchlist cannot be renamed');

    // Delete attempt on default list
    (prisma as any).$queryRaw = async () => [{ id: 'wl_default', isDefault: true }];
    const resDelete = await fetch(`${baseUrl}/api/watchlists/wl_default`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenUserAlpha}` },
    });
    assert.equal(resDelete.status, 400);
    const deleteData = await resDelete.json();
    assert.equal(deleteData.error, 'The default watchlist cannot be deleted');
  });

  // 12. A user cannot access another user's watchlist
  test('12. A user cannot access or modify another user\'s watchlist (returns 404)', async () => {
    // When user Beta tries to access user Alpha's list, findFirst with userId: 'user-beta' returns null
    (prisma.watchlist as any).findFirst = async (args: any) => {
      assert.equal(args.where.userId, 'user-beta');
      return null;
    };
    (prisma as any).$queryRaw = async () => [];

    // Beta attempts to rename Alpha's list
    const resPatch = await fetch(`${baseUrl}/api/watchlists/wl_owned_by_alpha`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${tokenUserBeta}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Hijacked' }),
    });
    assert.equal(resPatch.status, 404);
    const patchData = await resPatch.json();
    assert.equal(patchData.error, 'Watchlist not found');

    // Beta attempts to delete Alpha's list
    const resDelete = await fetch(`${baseUrl}/api/watchlists/wl_owned_by_alpha`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenUserBeta}` },
    });
    assert.equal(resDelete.status, 404);
    const deleteData = await resDelete.json();
    assert.equal(deleteData.error, 'Watchlist not found');
  });

  // 13. Request-supplied userId cannot override authenticated identity
  test('13. Request-supplied userId in body cannot override authenticated identity', async () => {
    let capturedCreateData: any = null;
    (prisma.watchlist as any).create = async (args: any) => {
      capturedCreateData = args.data;
      return {
        id: 'wl_created_safe',
        name: args.data.name,
        isDefault: args.data.isDefault,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    };

    const res = await fetch(`${baseUrl}/api/watchlists`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenUserAlpha}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Legit Name',
        userId: 'spoofed_victim_id', // client attempt to inject another user ID
        isDefault: true,             // client attempt to make it a default list
      }),
    });

    assert.equal(res.status, 201);
    assert.deepEqual(capturedCreateData, {
      userId: 'user-alpha', // forced to authenticated user ID
      name: 'Legit Name',
      isDefault: false,     // forced to false
    });
  });

  // Health check endpoint verification
  test('Health check endpoint /api/health continues to work', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'ok');
    assert.ok(data.timestamp);
  });

  // =========================================================================
  // Tests for GET /api/watchlists/:id/items
  // =========================================================================

  test('GET /api/watchlists/:id/items without a token returns 401', async () => {
    const res = await fetch(`${baseUrl}/api/watchlists/wl_1/items`);
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.error, 'Authorization token required');
  });

  test('GET /api/watchlists/:id/items with invalid token returns 401', async () => {
    const res = await fetch(`${baseUrl}/api/watchlists/wl_1/items`, {
      headers: { Authorization: 'Bearer invalid.jwt.token' },
    });
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.error, 'Invalid authentication token');
  });

  test('GET /api/watchlists/:id/items returns 200 with populated list and distinct IDs', async () => {
    (prisma.watchlist as any).findFirst = async (args: any) => {
      if (args.where.id === 'wl_alpha_1' && args.where.userId === 'user-alpha') {
        return {
          id: 'wl_alpha_1',
          name: 'Sci-Fi Classics',
          isDefault: false,
        };
      }
      return null;
    };

    (prisma.watchlistItem as any).findMany = async (args: any) => {
      assert.deepEqual(args.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
      return [
        {
          id: 'wli_membership_101',
          watchlistId: 'wl_alpha_1',
          userMediaId: 'um_record_202',
          createdAt: new Date('2026-03-01T12:00:00Z'),
          userMedia: {
            id: 'um_record_202',
            tmdbId: 550,
            mediaType: 'MOVIE',
            status: 'WANT_TO_WATCH',
            title: 'Fight Club',
            posterPath: '/fightclub.jpg',
            releaseDate: '1999-10-15',
            voteAverage: 8.4,
            overview: 'An insomniac office worker...',
          },
        },
      ];
    };

    (prisma.watchlistItem as any).count = async () => 1;

    const res = await fetch(`${baseUrl}/api/watchlists/wl_alpha_1/items`, {
      headers: { Authorization: `Bearer ${tokenUserAlpha}` },
    });

    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.watchlist.id, 'wl_alpha_1');
    assert.equal(data.watchlist.name, 'Sci-Fi Classics');
    assert.equal(data.watchlist.isDefault, false);
    assert.equal(data.items.length, 1);

    // Verify membership ID vs userMediaId distinction
    assert.equal(data.items[0].id, 'wli_membership_101');
    assert.equal(data.items[0].userMediaId, 'um_record_202');
    assert.equal(data.items[0].userMedia.id, 'um_record_202');
    assert.notEqual(data.items[0].id, data.items[0].userMediaId);
    assert.equal(data.items[0].userMedia.title, 'Fight Club');
    assert.equal(data.items[0].userMedia.status, 'WANT_TO_WATCH');

    assert.deepEqual(data.pagination, {
      page: 1,
      limit: 20,
      totalCount: 1,
      totalPages: 1,
    });
  });

  test('GET /api/watchlists/:id/items returns 200 with totalCount: 0 and totalPages: 0 for empty list', async () => {
    (prisma.watchlist as any).findFirst = async () => ({
      id: 'wl_empty',
      name: 'Empty Watchlist',
      isDefault: false,
    });

    (prisma.watchlistItem as any).findMany = async () => [];
    (prisma.watchlistItem as any).count = async () => 0;

    const res = await fetch(`${baseUrl}/api/watchlists/wl_empty/items?page=1&limit=20`, {
      headers: { Authorization: `Bearer ${tokenUserAlpha}` },
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.items.length, 0);
    assert.deepEqual(data.pagination, {
      page: 1,
      limit: 20,
      totalCount: 0,
      totalPages: 0,
    });
  });

  test('GET /api/watchlists/:id/items returns 404 for foreign-owned or nonexistent watchlist', async () => {
    (prisma.watchlist as any).findFirst = async (args: any) => {
      // User Alpha owns wl_alpha, User Beta owns wl_beta
      if (args.where.id === 'wl_alpha' && args.where.userId === 'user-alpha') {
        return { id: 'wl_alpha', name: 'Alpha List', isDefault: false };
      }
      return null;
    };

    // User Beta tries to access User Alpha's watchlist -> 404
    const resForeign = await fetch(`${baseUrl}/api/watchlists/wl_alpha/items`, {
      headers: { Authorization: `Bearer ${tokenUserBeta}` },
    });
    assert.equal(resForeign.status, 404);
    const dataForeign = await resForeign.json();
    assert.equal(dataForeign.error, 'Watchlist not found');

    // Nonexistent watchlist -> 404
    const resNonexistent = await fetch(`${baseUrl}/api/watchlists/wl_nonexistent/items`, {
      headers: { Authorization: `Bearer ${tokenUserAlpha}` },
    });
    assert.equal(resNonexistent.status, 404);
    const dataNonexistent = await resNonexistent.json();
    assert.equal(dataNonexistent.error, 'Watchlist not found');
  });

  test('GET /api/watchlists/:id/items validates pagination query parameters', async () => {
    const resInvalidPage = await fetch(`${baseUrl}/api/watchlists/wl_1/items?page=0`, {
      headers: { Authorization: `Bearer ${tokenUserAlpha}` },
    });
    assert.equal(resInvalidPage.status, 400);
    const data1 = await resInvalidPage.json();
    assert.match(data1.error, /Page must be a positive integer/);

    const resInvalidLimit = await fetch(`${baseUrl}/api/watchlists/wl_1/items?limit=150`, {
      headers: { Authorization: `Bearer ${tokenUserAlpha}` },
    });
    assert.equal(resInvalidLimit.status, 400);
    const data2 = await resInvalidLimit.json();
    assert.match(data2.error, /Limit must be a positive integer between 1 and 100/);
  });

  test('GET /api/watchlists/:id/items correctly passes custom page and limit to service', async () => {
    let capturedArgs: any = null;
    (prisma.watchlist as any).findFirst = async () => ({
      id: 'wl_paged',
      name: 'Paged List',
      isDefault: false,
    });

    (prisma.watchlistItem as any).findMany = async (args: any) => {
      capturedArgs = args;
      return [];
    };
    (prisma.watchlistItem as any).count = async () => 12;

    const res = await fetch(`${baseUrl}/api/watchlists/wl_paged/items?page=3&limit=5`, {
      headers: { Authorization: `Bearer ${tokenUserAlpha}` },
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(capturedArgs.skip, 10); // (3 - 1) * 5
    assert.equal(capturedArgs.take, 5);
    assert.deepEqual(data.pagination, {
      page: 3,
      limit: 5,
      totalCount: 12,
      totalPages: 3,
    });
  });
});
