import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import { MediaType, WatchlistStatus } from '@prisma/client';
import app from '../src/index';
import prisma from '../src/lib/prisma';
import * as mediaController from '../src/controllers/media.controller';
import { NotFoundError, DuplicateMembershipError } from '../src/services/media.service';

describe('Media Routes & Server Mounting Integration Tests', () => {
  let server: http.Server;
  let baseUrl: string;

  const testSecret = process.env.JWT_SECRET || 'cinevault_test_jwt_secret_key_12345';
  process.env.JWT_SECRET = testSecret;

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

  // Original service function delegates
  const originalAddWatchlistMembership = mediaController.services.addWatchlistMembership;
  const originalRemoveWatchlistMembership = mediaController.services.removeWatchlistMembership;
  const originalUpsertMediaStatusWithRetry = mediaController.services.upsertMediaStatusWithRetry;
  const originalUpdateMediaStatusById = mediaController.services.updateMediaStatusById;
  const originalGetWatchedHistory = mediaController.services.getWatchedHistory;
  const originalWatchlistFindMany = prisma.watchlist.findMany;
  const originalWatchlistCreate = prisma.watchlist.create;

  before(async () => {
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

  afterEach(() => {
    mediaController.services.addWatchlistMembership = originalAddWatchlistMembership;
    mediaController.services.removeWatchlistMembership = originalRemoveWatchlistMembership;
    mediaController.services.upsertMediaStatusWithRetry = originalUpsertMediaStatusWithRetry;
    mediaController.services.updateMediaStatusById = originalUpdateMediaStatusById;
    mediaController.services.getWatchedHistory = originalGetWatchedHistory;
    prisma.watchlist.findMany = originalWatchlistFindMany;
    prisma.watchlist.create = originalWatchlistCreate;
  });

  // 1. Unauthenticated requests return 401
  describe('1. Authentication enforcement', () => {
    test('POST /api/watchlists/:id/items without token returns 401', async () => {
      const res = await fetch(`${baseUrl}/api/watchlists/wl_1/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tmdbId: 100, mediaType: 'MOVIE', metadata: { title: 'Test' } }),
      });
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.error, 'Authorization token required');
    });

    test('DELETE /api/watchlists/:id/items/:userMediaId without token returns 401', async () => {
      const res = await fetch(`${baseUrl}/api/watchlists/wl_1/items/um_1`, {
        method: 'DELETE',
      });
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.error, 'Authorization token required');
    });

    test('POST /api/media/status without token returns 401', async () => {
      const res = await fetch(`${baseUrl}/api/media/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tmdbId: 100, mediaType: 'MOVIE', status: 'WATCHED', metadata: { title: 'Test' } }),
      });
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.error, 'Authorization token required');
    });

    test('PATCH /api/media/:id/status without token returns 401', async () => {
      const res = await fetch(`${baseUrl}/api/media/um_1/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'WATCHED' }),
      });
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.error, 'Authorization token required');
    });

    test('GET /api/media/history without token returns 401', async () => {
      const res = await fetch(`${baseUrl}/api/media/history`);
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.error, 'Authorization token required');
    });
  });

  // 2. Authenticated requests reach appropriate service
  describe('2. Authenticated service dispatch', () => {
    test('POST /api/watchlists/:id/items dispatches to addWatchlistMembership with 201', async () => {
      let calledUserId = '';
      let calledWatchlistId = '';
      let calledInput: any = null;

      mediaController.services.addWatchlistMembership = async (userId: string, wlId: string, input: any) => {
        calledUserId = userId;
        calledWatchlistId = wlId;
        calledInput = input;
        return {
          id: 'wli_100',
          watchlistId: wlId,
          userMediaId: 'um_100',
          createdAt: new Date(),
          userMedia: {
            id: 'um_100',
            tmdbId: input.tmdbId,
            mediaType: input.mediaType,
            status: WatchlistStatus.WANT_TO_WATCH,
            title: input.metadata.title,
            posterPath: input.metadata.posterPath ?? null,
            releaseDate: input.metadata.releaseDate ?? null,
            voteAverage: input.metadata.voteAverage ?? null,
            overview: input.metadata.overview ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
            watchlistCount: 1,
          },
        };
      };

      const res = await fetch(`${baseUrl}/api/watchlists/wl_abc/items`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenUserAlpha}`,
        },
        body: JSON.stringify({
          tmdbId: 157336,
          mediaType: 'MOVIE',
          metadata: {
            title: 'Interstellar',
            releaseDate: '2014-11-05',
            voteAverage: 8.4,
            posterPath: '/interstellar.jpg',
          },
        }),
      });

      assert.equal(res.status, 201);
      const data = await res.json();
      assert.equal(calledUserId, 'user-alpha');
      assert.equal(calledWatchlistId, 'wl_abc');
      assert.equal(calledInput.tmdbId, 157336);
      assert.equal(calledInput.mediaType, 'MOVIE');
      assert.equal(calledInput.metadata.title, 'Interstellar');
      assert.equal(data.item.id, 'wli_100');
    });

    test('DELETE /api/watchlists/:id/items/:userMediaId dispatches to removeWatchlistMembership with 200', async () => {
      let calledUserId = '';
      let calledWlId = '';
      let calledUmId = '';

      mediaController.services.removeWatchlistMembership = async (uId: string, wlId: string, umId: string) => {
        calledUserId = uId;
        calledWlId = wlId;
        calledUmId = umId;
        return {
          message: 'Media untracked because it has no watchlist memberships and is not watched',
          userMedia: null,
        };
      };

      const res = await fetch(`${baseUrl}/api/watchlists/wl_abc/items/um_xyz`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tokenUserAlpha}` },
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(calledUserId, 'user-alpha');
      assert.equal(calledWlId, 'wl_abc');
      assert.equal(calledUmId, 'um_xyz');
      assert.equal(data.userMedia, null);
    });

    test('POST /api/media/status dispatches to upsertMediaStatusWithRetry with 200', async () => {
      let calledUserId = '';
      let calledInput: any = null;

      mediaController.services.upsertMediaStatusWithRetry = async (uId: string, input: any) => {
        calledUserId = uId;
        calledInput = input;
        return {
          media: {
            id: 'um_550',
            tmdbId: input.tmdbId,
            mediaType: input.mediaType,
            status: input.status,
            title: input.metadata.title,
            posterPath: null,
            releaseDate: null,
            voteAverage: null,
            overview: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            watchlistCount: 0,
          },
        };
      };

      const res = await fetch(`${baseUrl}/api/media/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenUserAlpha}`,
        },
        body: JSON.stringify({
          tmdbId: 550,
          mediaType: 'MOVIE',
          status: 'WATCHED',
          metadata: { title: 'Fight Club' },
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(calledUserId, 'user-alpha');
      assert.equal(calledInput.status, 'WATCHED');
      assert.equal(data.media.title, 'Fight Club');
    });

    test('PATCH /api/media/:id/status dispatches to updateMediaStatusById with 200', async () => {
      let calledUserId = '';
      let calledMediaId = '';
      let calledStatus = '';

      mediaController.services.updateMediaStatusById = async (uId: string, mId: string, status: any) => {
        calledUserId = uId;
        calledMediaId = mId;
        calledStatus = status;
        return {
          media: {
            id: mId,
            tmdbId: 157336,
            mediaType: 'MOVIE',
            status,
            title: 'Interstellar',
            posterPath: null,
            releaseDate: null,
            voteAverage: null,
            overview: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            watchlistCount: 1,
          },
        };
      };

      const res = await fetch(`${baseUrl}/api/media/um_999/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenUserAlpha}`,
        },
        body: JSON.stringify({ status: 'WATCHED' }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(calledUserId, 'user-alpha');
      assert.equal(calledMediaId, 'um_999');
      assert.equal(calledStatus, 'WATCHED');
      assert.equal(data.media.status, 'WATCHED');
    });

    test('GET /api/media/history dispatches to getWatchedHistory with 200', async () => {
      let calledUserId = '';
      let calledPagination: any = null;

      mediaController.services.getWatchedHistory = async (uId: string, pagination: any) => {
        calledUserId = uId;
        calledPagination = pagination;
        return {
          history: [
            {
              id: 'um_1',
              tmdbId: 550,
              mediaType: 'MOVIE',
              status: WatchlistStatus.WATCHED,
              title: 'Fight Club',
              posterPath: null,
              releaseDate: null,
              voteAverage: null,
              overview: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              watchlistCount: 0,
            },
          ],
          pagination: {
            page: pagination.page,
            limit: pagination.limit,
            totalCount: 1,
            totalPages: 1,
          },
        };
      };

      const res = await fetch(`${baseUrl}/api/media/history?page=2&limit=15`, {
        headers: { Authorization: `Bearer ${tokenUserAlpha}` },
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(calledUserId, 'user-alpha');
      assert.equal(calledPagination.page, 2);
      assert.equal(calledPagination.limit, 15);
      assert.equal(data.history.length, 1);
      assert.equal(data.pagination.page, 2);
    });
  });

  // 3. Validation: Invalid route IDs and request bodies return 400
  describe('3. Input validation errors return 400', () => {
    test('POST /api/watchlists/:id/items with invalid tmdbId returns 400', async () => {
      const res = await fetch(`${baseUrl}/api/watchlists/wl_1/items`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenUserAlpha}`,
        },
        body: JSON.stringify({
          tmdbId: -5,
          mediaType: 'MOVIE',
          metadata: { title: 'Valid Title' },
        }),
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /positive integer/i);
    });

    test('POST /api/watchlists/:id/items with invalid mediaType returns 400', async () => {
      const res = await fetch(`${baseUrl}/api/watchlists/wl_1/items`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenUserAlpha}`,
        },
        body: JSON.stringify({
          tmdbId: 100,
          mediaType: 'AUDIOBOOK',
          metadata: { title: 'Valid Title' },
        }),
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /invalid media type/i);
    });

    test('POST /api/watchlists/:id/items with empty title returns 400', async () => {
      const res = await fetch(`${baseUrl}/api/watchlists/wl_1/items`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenUserAlpha}`,
        },
        body: JSON.stringify({
          tmdbId: 100,
          mediaType: 'MOVIE',
          metadata: { title: '   ' },
        }),
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /title is required/i);
    });

    test('POST /api/watchlists/:id/items with nested posterPath returns 400', async () => {
      const res = await fetch(`${baseUrl}/api/watchlists/wl_1/items`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenUserAlpha}`,
        },
        body: JSON.stringify({
          tmdbId: 100,
          mediaType: 'MOVIE',
          metadata: { title: 'Test', posterPath: '/sub_dir/image.png' },
        }),
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /poster path must be a flat relative path/i);
    });

    test('POST /api/media/status with invalid status returns 400', async () => {
      const res = await fetch(`${baseUrl}/api/media/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenUserAlpha}`,
        },
        body: JSON.stringify({
          tmdbId: 100,
          mediaType: 'MOVIE',
          status: 'DROPPED',
          metadata: { title: 'Test' },
        }),
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /invalid status/i);
    });

    test('PATCH /api/media/:id/status with invalid status returns 400', async () => {
      const res = await fetch(`${baseUrl}/api/media/um_1/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenUserAlpha}`,
        },
        body: JSON.stringify({ status: 'INVALID' }),
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /invalid status/i);
    });

    test('PATCH /api/media/%20/status with whitespace-only id returns 400', async () => {
      const res = await fetch(`${baseUrl}/api/media/%20/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenUserAlpha}`,
        },
        body: JSON.stringify({ status: 'WATCHED' }),
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /media id is required/i);
    });
  });

  // 4. Missing or foreign-owned resources return 404
  describe('4. Missing or foreign-owned resources return 404', () => {
    test('POST /api/watchlists/:id/items returns 404 when watchlist not found', async () => {
      mediaController.services.addWatchlistMembership = async () => {
        throw new NotFoundError('Watchlist not found');
      };

      const res = await fetch(`${baseUrl}/api/watchlists/foreign_wl/items`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenUserAlpha}`,
        },
        body: JSON.stringify({
          tmdbId: 100,
          mediaType: 'MOVIE',
          metadata: { title: 'Test' },
        }),
      });

      assert.equal(res.status, 404);
      const data = await res.json();
      assert.equal(data.error, 'Watchlist not found');
    });

    test('DELETE /api/watchlists/:id/items/:userMediaId returns 404 when item not found', async () => {
      mediaController.services.removeWatchlistMembership = async () => {
        throw new NotFoundError('Watchlist item not found');
      };

      const res = await fetch(`${baseUrl}/api/watchlists/wl_1/items/missing_um`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tokenUserAlpha}` },
      });

      assert.equal(res.status, 404);
      const data = await res.json();
      assert.equal(data.error, 'Watchlist item not found');
    });

    test('PATCH /api/media/:id/status returns 404 when media record not found', async () => {
      mediaController.services.updateMediaStatusById = async () => {
        throw new NotFoundError('Media record not found');
      };

      const res = await fetch(`${baseUrl}/api/media/foreign_um/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenUserAlpha}`,
        },
        body: JSON.stringify({ status: 'WATCHED' }),
      });

      assert.equal(res.status, 404);
      const data = await res.json();
      assert.equal(data.error, 'Media record not found');
    });
  });

  // 5. Duplicate membership returns 409
  describe('5. Duplicate membership handling', () => {
    test('POST /api/watchlists/:id/items returns 409 on DuplicateMembershipError', async () => {
      mediaController.services.addWatchlistMembership = async () => {
        throw new DuplicateMembershipError('Media is already in this watchlist');
      };

      const res = await fetch(`${baseUrl}/api/watchlists/wl_1/items`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenUserAlpha}`,
        },
        body: JSON.stringify({
          tmdbId: 100,
          mediaType: 'MOVIE',
          metadata: { title: 'Test' },
        }),
      });

      assert.equal(res.status, 409);
      const data = await res.json();
      assert.equal(data.error, 'Media is already in this watchlist');
    });
  });

  // 6. Untracked WANT_TO_WATCH returns 200 with media: null
  describe('6. Untracked WANT_TO_WATCH response', () => {
    test('POST /api/media/status returns 200 with media: null for untracked WANT_TO_WATCH', async () => {
      mediaController.services.upsertMediaStatusWithRetry = async () => {
        return {
          media: null,
          message: 'Media is untracked because it has no watchlist memberships and is not watched',
        };
      };

      const res = await fetch(`${baseUrl}/api/media/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenUserAlpha}`,
        },
        body: JSON.stringify({
          tmdbId: 100,
          mediaType: 'MOVIE',
          status: 'WANT_TO_WATCH',
          metadata: { title: 'Untracked Movie' },
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.media, null);
      assert.match(data.message, /untracked/i);
    });
  });

  // 7. Watched history pagination defaults & validation
  describe('7. Watched history pagination', () => {
    test('GET /api/media/history uses page=1 and limit=20 by default', async () => {
      let receivedPagination: any = null;
      mediaController.services.getWatchedHistory = async (_userId: string, pagination: any) => {
        receivedPagination = pagination;
        return { history: [], pagination: { ...pagination, totalCount: 0, totalPages: 1 } };
      };

      const res = await fetch(`${baseUrl}/api/media/history`, {
        headers: { Authorization: `Bearer ${tokenUserAlpha}` },
      });

      assert.equal(res.status, 200);
      assert.equal(receivedPagination.page, 1);
      assert.equal(receivedPagination.limit, 20);
    });

    test('GET /api/media/history rejects invalid pagination parameters with 400', async () => {
      const res0 = await fetch(`${baseUrl}/api/media/history?page=0`, {
        headers: { Authorization: `Bearer ${tokenUserAlpha}` },
      });
      assert.equal(res0.status, 400);

      const resLimit = await fetch(`${baseUrl}/api/media/history?limit=101`, {
        headers: { Authorization: `Bearer ${tokenUserAlpha}` },
      });
      assert.equal(resLimit.status, 400);

      const resNeg = await fetch(`${baseUrl}/api/media/history?page=-1`, {
        headers: { Authorization: `Bearer ${tokenUserAlpha}` },
      });
      assert.equal(resNeg.status, 400);

      const resAlpha = await fetch(`${baseUrl}/api/media/history?limit=xyz`, {
        headers: { Authorization: `Bearer ${tokenUserAlpha}` },
      });
      assert.equal(resAlpha.status, 400);
    });
  });

  // 8. Security: Request-supplied userId cannot override authenticated identity
  describe('8. Identity spoofing prevention', () => {
    test('POST /api/watchlists/:id/items ignores userId in request body', async () => {
      let passedUserId = '';
      mediaController.services.addWatchlistMembership = async (userId: string) => {
        passedUserId = userId;
        return {
          id: 'wli_1',
          watchlistId: 'wl_1',
          userMediaId: 'um_1',
          createdAt: new Date(),
          userMedia: {
            id: 'um_1',
            tmdbId: 100,
            mediaType: 'MOVIE',
            status: WatchlistStatus.WANT_TO_WATCH,
            title: 'Test',
            posterPath: null,
            releaseDate: null,
            voteAverage: null,
            overview: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            watchlistCount: 1,
          },
        };
      };

      const res = await fetch(`${baseUrl}/api/watchlists/wl_1/items`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenUserAlpha}`,
        },
        body: JSON.stringify({
          userId: 'attacker_override_id',
          tmdbId: 100,
          mediaType: 'MOVIE',
          metadata: { title: 'Test' },
        }),
      });

      assert.equal(res.status, 201);
      assert.equal(passedUserId, 'user-alpha', 'Must use JWT user-alpha, not attacker_override_id');
    });

    test('POST /api/media/status ignores userId in request body', async () => {
      let passedUserId = '';
      mediaController.services.upsertMediaStatusWithRetry = async (userId: string) => {
        passedUserId = userId;
        return {
          media: {
            id: 'um_1',
            tmdbId: 100,
            mediaType: 'MOVIE',
            status: WatchlistStatus.WATCHED,
            title: 'Test',
            posterPath: null,
            releaseDate: null,
            voteAverage: null,
            overview: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            watchlistCount: 0,
          },
        };
      };

      const res = await fetch(`${baseUrl}/api/media/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenUserAlpha}`,
        },
        body: JSON.stringify({
          userId: 'attacker_override_id',
          tmdbId: 100,
          mediaType: 'MOVIE',
          status: 'WATCHED',
          metadata: { title: 'Test' },
        }),
      });

      assert.equal(res.status, 200);
      assert.equal(passedUserId, 'user-alpha');
    });

    test('PATCH /api/media/:id/status ignores userId in request body', async () => {
      let passedUserId = '';
      mediaController.services.updateMediaStatusById = async (userId: string) => {
        passedUserId = userId;
        return {
          media: {
            id: 'um_1',
            tmdbId: 100,
            mediaType: 'MOVIE',
            status: WatchlistStatus.WATCHED,
            title: 'Test',
            posterPath: null,
            releaseDate: null,
            voteAverage: null,
            overview: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            watchlistCount: 0,
          },
        };
      };

      const res = await fetch(`${baseUrl}/api/media/um_1/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenUserAlpha}`,
        },
        body: JSON.stringify({
          userId: 'attacker_override_id',
          status: 'WATCHED',
        }),
      });

      assert.equal(res.status, 200);
      assert.equal(passedUserId, 'user-alpha');
    });
  });

  // 9. Unexpected service errors return safe HTTP 500
  describe('9. Internal server error handling', () => {
    test('returns 500 without leaking stack trace or database internals on unexpected error', async () => {
      mediaController.services.addWatchlistMembership = async () => {
        throw new Error('FATAL: raw database connection refused at 10.0.0.1:5432');
      };

      const originalConsoleError = console.error;
      console.error = () => {};

      try {
        const res = await fetch(`${baseUrl}/api/watchlists/wl_1/items`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokenUserAlpha}`,
          },
          body: JSON.stringify({
            tmdbId: 100,
            mediaType: 'MOVIE',
            metadata: { title: 'Test' },
          }),
        });

        assert.equal(res.status, 500);
        const data = await res.json();
        assert.equal(data.error, 'Internal server error');
        assert.equal(data.stack, undefined);
        assert.equal(data.message, undefined);
      } finally {
        console.error = originalConsoleError;
      }
    });
  });

  // 10. Existing watchlist CRUD and health routes remain functional
  describe('10. Preserved existing routes', () => {
    test('GET /api/health continues to work', async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.status, 'ok');
    });

    test('GET /api/watchlists continues to work', async () => {
      (prisma.watchlist as any).findMany = async () => [
        {
          id: 'wl_default',
          name: 'My Watchlist',
          isDefault: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: { items: 0 },
        },
      ];

      const res = await fetch(`${baseUrl}/api/watchlists`, {
        headers: { Authorization: `Bearer ${tokenUserAlpha}` },
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.watchlists.length, 1);
      assert.equal(data.watchlists[0].name, 'My Watchlist');
    });

    test('POST /api/watchlists continues to work', async () => {
      (prisma.watchlist as any).create = async (args: any) => ({
        id: 'wl_new',
        name: args.data.name,
        isDefault: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { items: 0 },
      });

      const res = await fetch(`${baseUrl}/api/watchlists`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenUserAlpha}`,
        },
        body: JSON.stringify({ name: 'Classics' }),
      });

      assert.equal(res.status, 201);
      const data = await res.json();
      assert.equal(data.watchlist.name, 'Classics');
    });
  });
});
