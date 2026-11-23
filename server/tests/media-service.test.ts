import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MediaType, WatchlistStatus, Prisma } from '@prisma/client';
import prisma from '../src/lib/prisma';
import * as mediaService from '../src/services/media.service';
import {
  validateMediaMetadata,
  validatePagination,
  isUserMediaCompositeP2002,
} from '../src/utils/validation';

describe('Validation Unit Tests (Media Metadata & Pagination)', () => {
  describe('validateMediaMetadata', () => {
    test('accepts valid metadata with all fields', () => {
      const res = validateMediaMetadata({
        title: 'Interstellar',
        releaseDate: '2014-11-05',
        voteAverage: 8.4,
        posterPath: '/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg',
        overview: 'A team of explorers travel through a wormhole in space...',
      });
      assert.equal(res.isValid, true);
      if (res.isValid) {
        assert.equal(res.value.title, 'Interstellar');
        assert.equal(res.value.releaseDate, '2014-11-05');
        assert.equal(res.value.voteAverage, 8.4);
        assert.equal(res.value.posterPath, '/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg');
      }
    });

    test('accepts valid metadata with only required title', () => {
      const res = validateMediaMetadata({ title: 'Inception' });
      assert.equal(res.isValid, true);
      if (res.isValid) {
        assert.equal(res.value.title, 'Inception');
        assert.equal(res.value.releaseDate, undefined);
      }
    });

    test('rejects empty or whitespace-only title', () => {
      assert.equal(validateMediaMetadata({ title: '' }).isValid, false);
      assert.equal(validateMediaMetadata({ title: '   ' }).isValid, false);
      assert.equal(validateMediaMetadata({}).isValid, false);
    });

    test('rejects title exceeding 255 characters', () => {
      const res = validateMediaMetadata({ title: 'a'.repeat(256) });
      assert.equal(res.isValid, false);
      if (!res.isValid) {
        assert.match(res.error, /cannot exceed 255 characters/i);
      }
    });

    test('validates release date format and calendar validity', () => {
      // Valid calendar dates
      assert.equal(validateMediaMetadata({ title: 'T', releaseDate: '2024-02-29' }).isValid, true); // Leap year
      assert.equal(validateMediaMetadata({ title: 'T', releaseDate: '2023-12-31' }).isValid, true);

      // Invalid format
      assert.equal(validateMediaMetadata({ title: 'T', releaseDate: '11-05-2014' }).isValid, false);
      assert.equal(validateMediaMetadata({ title: 'T', releaseDate: '2014/11/05' }).isValid, false);

      // Invalid calendar days
      assert.equal(validateMediaMetadata({ title: 'T', releaseDate: '2023-02-29' }).isValid, false); // Non-leap year
      assert.equal(validateMediaMetadata({ title: 'T', releaseDate: '2024-02-30' }).isValid, false);
      assert.equal(validateMediaMetadata({ title: 'T', releaseDate: '2024-13-01' }).isValid, false);
      assert.equal(validateMediaMetadata({ title: 'T', releaseDate: '2024-00-10' }).isValid, false);
    });

    test('validates vote average within 0.0 to 10.0 and rejects non-finite', () => {
      assert.equal(validateMediaMetadata({ title: 'T', voteAverage: 0 }).isValid, true);
      assert.equal(validateMediaMetadata({ title: 'T', voteAverage: 10 }).isValid, true);
      assert.equal(validateMediaMetadata({ title: 'T', voteAverage: 7.5 }).isValid, true);

      assert.equal(validateMediaMetadata({ title: 'T', voteAverage: -0.1 }).isValid, false);
      assert.equal(validateMediaMetadata({ title: 'T', voteAverage: 10.1 }).isValid, false);
      assert.equal(validateMediaMetadata({ title: 'T', voteAverage: NaN }).isValid, false);
      assert.equal(validateMediaMetadata({ title: 'T', voteAverage: Infinity }).isValid, false);
    });

    test('validates poster path: accepts flat TMDB paths and rejects nested, dotfiles, URLs, traversal, and invalid extensions', () => {
      // Valid flat TMDB paths
      assert.equal(validateMediaMetadata({ title: 'T', posterPath: '/poster.jpg' }).isValid, true);
      assert.equal(validateMediaMetadata({ title: 'T', posterPath: '/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg' }).isValid, true);
      assert.equal(validateMediaMetadata({ title: 'T', posterPath: '/image-123_abc.png' }).isValid, true);
      assert.equal(validateMediaMetadata({ title: 'T', posterPath: '/movie.webp' }).isValid, true);

      // Rejects nested directories
      assert.equal(validateMediaMetadata({ title: 'T', posterPath: '/sub_dir/image-123.png' }).isValid, false);
      assert.equal(validateMediaMetadata({ title: 'T', posterPath: '/a/b/c.jpg' }).isValid, false);

      // Rejects hidden filenames beginning with a dot
      assert.equal(validateMediaMetadata({ title: 'T', posterPath: '/.hidden.jpg' }).isValid, false);
      assert.equal(validateMediaMetadata({ title: 'T', posterPath: '/.file.png' }).isValid, false);

      // Rejects full URLs
      assert.equal(validateMediaMetadata({ title: 'T', posterPath: 'https://image.tmdb.org/t/p/w500/test.jpg' }).isValid, false);
      assert.equal(validateMediaMetadata({ title: 'T', posterPath: 'http://image.tmdb.org/test.jpg' }).isValid, false);

      // Rejects path traversal attempts
      assert.equal(validateMediaMetadata({ title: 'T', posterPath: '/../etc/passwd.jpg' }).isValid, false);
      assert.equal(validateMediaMetadata({ title: 'T', posterPath: '/./image.jpg' }).isValid, false);
      assert.equal(validateMediaMetadata({ title: 'T', posterPath: '../image.jpg' }).isValid, false);

      // Rejects repeated slashes
      assert.equal(validateMediaMetadata({ title: 'T', posterPath: '//image.jpg' }).isValid, false);
      assert.equal(validateMediaMetadata({ title: 'T', posterPath: '///test.png' }).isValid, false);

      // Rejects backslashes
      assert.equal(validateMediaMetadata({ title: 'T', posterPath: '/sub\\image.jpg' }).isValid, false);
      assert.equal(validateMediaMetadata({ title: 'T', posterPath: '\\image.jpg' }).isValid, false);

      // Rejects URL-encoded traversal attempts
      assert.equal(validateMediaMetadata({ title: 'T', posterPath: '/%2e%2e/image.jpg' }).isValid, false);
      assert.equal(validateMediaMetadata({ title: 'T', posterPath: '/%2fimage.jpg' }).isValid, false);

      // Rejects unsupported extensions
      assert.equal(validateMediaMetadata({ title: 'T', posterPath: '/image.gif' }).isValid, false);
      assert.equal(validateMediaMetadata({ title: 'T', posterPath: '/image.svg' }).isValid, false);
      assert.equal(validateMediaMetadata({ title: 'T', posterPath: '/image.exe' }).isValid, false);
      assert.equal(validateMediaMetadata({ title: 'T', posterPath: '/image.bmp' }).isValid, false);

      // Rejects missing leading slash
      assert.equal(validateMediaMetadata({ title: 'T', posterPath: 'poster.jpg' }).isValid, false);
    });

    test('rejects overview exceeding 4000 characters (strict, no silent truncation)', () => {
      const valid4000 = 'a'.repeat(4000);
      assert.equal(validateMediaMetadata({ title: 'T', overview: valid4000 }).isValid, true);

      const invalid4001 = 'a'.repeat(4001);
      const res = validateMediaMetadata({ title: 'T', overview: invalid4001 });
      assert.equal(res.isValid, false);
      if (!res.isValid) {
        assert.match(res.error, /cannot exceed 4000 characters/i);
      }
    });
  });

  describe('validatePagination', () => {
    test('uses defaults when query parameters are omitted', () => {
      const res = validatePagination(undefined, undefined);
      assert.equal(res.isValid, true);
      if (res.isValid) {
        assert.equal(res.value.page, 1);
        assert.equal(res.value.limit, 20);
      }
    });

    test('accepts valid page and limit values', () => {
      const res = validatePagination('2', '50');
      assert.equal(res.isValid, true);
      if (res.isValid) {
        assert.equal(res.value.page, 2);
        assert.equal(res.value.limit, 50);
      }
    });

    test('accepts maximum limit of 100', () => {
      const res = validatePagination('1', '100');
      assert.equal(res.isValid, true);
      if (res.isValid) assert.equal(res.value.limit, 100);
    });

    test('rejects page < 1, floats, and non-numbers', () => {
      assert.equal(validatePagination('0', '20').isValid, false);
      assert.equal(validatePagination('-1', '20').isValid, false);
      assert.equal(validatePagination('1.5', '20').isValid, false);
      assert.equal(validatePagination('abc', '20').isValid, false);
    });

    test('rejects limit <= 0, > 100, and non-integers', () => {
      assert.equal(validatePagination('1', '0').isValid, false);
      assert.equal(validatePagination('1', '-5').isValid, false);
      assert.equal(validatePagination('1', '101').isValid, false);
      assert.equal(validatePagination('1', '25.5').isValid, false);
      assert.equal(validatePagination('1', 'xyz').isValid, false);
    });
  });

  describe('isUserMediaCompositeP2002', () => {
    function makeError(target: any) {
      return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target },
      });
    }

    test('returns true for exact 3-field composite array (userId, tmdbId, mediaType)', () => {
      assert.equal(isUserMediaCompositeP2002(makeError(['userId', 'tmdbId', 'mediaType'])), true);
      assert.equal(isUserMediaCompositeP2002(makeError(['mediaType', 'userId', 'tmdbId'])), true);
    });

    test('returns false when target has additional fields', () => {
      assert.equal(isUserMediaCompositeP2002(makeError(['userId', 'tmdbId', 'mediaType', 'extra'])), false);
    });

    test('returns false when target has fewer fields', () => {
      assert.equal(isUserMediaCompositeP2002(makeError(['userId', 'tmdbId'])), false);
      assert.equal(isUserMediaCompositeP2002(makeError(['userId'])), false);
    });

    test('returns true for exact string constraint name', () => {
      assert.equal(isUserMediaCompositeP2002(makeError('UserMedia_userId_tmdbId_mediaType_key')), true);
    });

    test('returns false for unrelated constraint strings and targets', () => {
      assert.equal(isUserMediaCompositeP2002(makeError('Watchlist_userId_name_key')), false);
      assert.equal(isUserMediaCompositeP2002(makeError('Watchlist_userId_lower_name_key')), false);
      assert.equal(isUserMediaCompositeP2002(makeError(['userId', 'name'])), false);
      assert.equal(isUserMediaCompositeP2002(makeError(undefined)), false);
      assert.equal(isUserMediaCompositeP2002(null), false);
    });
  });
});

describe('Media Service Unit Tests (Mocked Prisma & Row Locking)', () => {
  const originalTransaction = prisma.$transaction;
  const originalQueryRaw = prisma.$queryRaw;

  function getQueryString(query: any): string {
    if (typeof query === 'string') return query;
    if (Array.isArray(query)) return query.join(' ');
    if (Array.isArray(query?.strings)) return query.strings.join(' ');
    if (typeof query?.sql === 'string') return query.sql;
    return String(query || '');
  }

  beforeEach(() => {
    (prisma as any).$transaction = async (arg: any) => {
      if (typeof arg === 'function') {
        return arg(prisma);
      }
      return Promise.all(arg);
    };
  });

  afterEach(() => {
    prisma.$transaction = originalTransaction;
    prisma.$queryRaw = originalQueryRaw;
  });

  test('addWatchlistMembership: creates new UserMedia and adds membership for untracked title', async () => {
    // 1. Lock watchlist succeeds
    (prisma as any).$queryRaw = async (query: any) => {
      const qStr = getQueryString(query);
      if (qStr.includes('FROM "Watchlist"')) {
        return [{ id: 'wl_1', userId: 'user_1' }];
      }
      // UserMedia lookup returns empty (untracked)
      if (qStr.includes('FROM "UserMedia"')) {
        return [];
      }
      return [];
    };

    let userMediaCreated = false;
    (prisma.userMedia as any).create = async (args: any) => {
      userMediaCreated = true;
      assert.equal(args.data.status, WatchlistStatus.WANT_TO_WATCH);
      return {
        id: 'um_new',
        ...args.data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    };

    (prisma.watchlistItem as any).findUnique = async () => null; // not existing in watchlist
    let membershipCreated = false;
    (prisma.watchlistItem as any).create = async (args: any) => {
      membershipCreated = true;
      return {
        id: 'wli_1',
        watchlistId: 'wl_1',
        userMediaId: 'um_new',
        createdAt: new Date(),
        userMedia: {
          id: 'um_new',
          tmdbId: 157336,
          mediaType: MediaType.MOVIE,
          status: WatchlistStatus.WANT_TO_WATCH,
          title: 'Interstellar',
          posterPath: '/path.jpg',
          releaseDate: '2014-11-05',
          voteAverage: 8.4,
          overview: 'Overview',
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: { watchlistItems: 1 },
        },
      };
    };

    const result = await mediaService.addWatchlistMembership('user_1', 'wl_1', {
      tmdbId: 157336,
      mediaType: MediaType.MOVIE,
      metadata: { title: 'Interstellar', posterPath: '/path.jpg', releaseDate: '2014-11-05', voteAverage: 8.4 },
    });

    assert.equal(userMediaCreated, true);
    assert.equal(membershipCreated, true);
    assert.equal(result.id, 'wli_1');
    assert.equal(result.userMedia.watchlistCount, 1);
  });

  test('addWatchlistMembership: rejects duplicate membership with DuplicateMembershipError (409)', async () => {
    (prisma as any).$queryRaw = async (query: any) => {
      const qStr = getQueryString(query);
      if (qStr.includes('FROM "Watchlist"')) return [{ id: 'wl_1', userId: 'user_1' }];
      if (qStr.includes('FROM "UserMedia"')) return [{ id: 'um_existing', status: WatchlistStatus.WANT_TO_WATCH }];
      return [];
    };
    (prisma.userMedia as any).update = async () => ({ id: 'um_existing' });
    (prisma.watchlistItem as any).findUnique = async () => ({ id: 'existing_membership' });

    await assert.rejects(
      async () => {
        await mediaService.addWatchlistMembership('user_1', 'wl_1', {
          tmdbId: 157336,
          mediaType: MediaType.MOVIE,
          metadata: { title: 'Interstellar' },
        });
      },
      mediaService.DuplicateMembershipError
    );
  });

  test('removeWatchlistMembership: prunes UserMedia when remainingCount is 0 and status is WANT_TO_WATCH', async () => {
    (prisma as any).$queryRaw = async (query: any) => {
      const qStr = getQueryString(query);
      if (qStr.includes('FROM "Watchlist"')) return [{ id: 'wl_1' }];
      if (qStr.includes('FROM "UserMedia"')) return [{ id: 'um_1', status: WatchlistStatus.WANT_TO_WATCH }];
      return [];
    };
    (prisma.watchlistItem as any).findUnique = async () => ({ id: 'wli_1' });
    (prisma.watchlistItem as any).delete = async () => ({ id: 'wli_1' });
    (prisma.watchlistItem as any).count = async () => 0; // 0 remaining

    let userMediaDeleted = false;
    (prisma.userMedia as any).delete = async (args: any) => {
      userMediaDeleted = true;
      assert.equal(args.where.id, 'um_1');
      return { id: 'um_1' };
    };

    const res = await mediaService.removeWatchlistMembership('user_1', 'wl_1', 'um_1');
    assert.equal(userMediaDeleted, true);
    assert.equal(res.userMedia, null);
    assert.match(res.message, /untracked/i);
  });

  test('removeWatchlistMembership: preserves UserMedia when status is WATCHED even if 0 memberships remain', async () => {
    (prisma as any).$queryRaw = async (query: any) => {
      const qStr = getQueryString(query);
      if (qStr.includes('FROM "Watchlist"')) return [{ id: 'wl_1' }];
      if (qStr.includes('FROM "UserMedia"')) return [{ id: 'um_1', status: WatchlistStatus.WATCHED }];
      return [];
    };
    (prisma.watchlistItem as any).findUnique = async () => ({ id: 'wli_1' });
    (prisma.watchlistItem as any).delete = async () => ({ id: 'wli_1' });
    (prisma.watchlistItem as any).count = async () => 0; // 0 remaining

    let userMediaDeleted = false;
    (prisma.userMedia as any).delete = async () => {
      userMediaDeleted = true;
    };

    const res = await mediaService.removeWatchlistMembership('user_1', 'wl_1', 'um_1');
    assert.equal(userMediaDeleted, false);
    assert.ok(res.userMedia !== null);
    assert.equal(res.userMedia?.status, WatchlistStatus.WATCHED);
    assert.equal(res.userMedia?.remainingWatchlistCount, 0);
  });

  test('upsertMediaStatusWithRetry: direct mark as WATCHED creates UserMedia', async () => {
    (prisma as any).$queryRaw = async () => []; // not existing
    (prisma.userMedia as any).create = async (args: any) => ({
      id: 'um_new',
      ...args.data,
      createdAt: new Date(),
      updatedAt: new Date(),
      _count: { watchlistItems: 0 },
    });

    const res = await mediaService.upsertMediaStatusWithRetry('user_1', {
      tmdbId: 157336,
      mediaType: MediaType.MOVIE,
      status: WatchlistStatus.WATCHED,
      metadata: { title: 'Interstellar' },
    });

    assert.ok(res.media !== null);
    assert.equal(res.media?.status, WatchlistStatus.WATCHED);
    assert.equal(res.media?.watchlistCount, 0);
  });

  test('upsertMediaStatusWithRetry: returns null and does not create when untracked title receives WANT_TO_WATCH', async () => {
    (prisma as any).$queryRaw = async () => []; // not existing
    let createCalled = false;
    (prisma.userMedia as any).create = async () => {
      createCalled = true;
    };

    const res = await mediaService.upsertMediaStatusWithRetry('user_1', {
      tmdbId: 157336,
      mediaType: MediaType.MOVIE,
      status: WatchlistStatus.WANT_TO_WATCH,
      metadata: { title: 'Interstellar' },
    });

    assert.equal(createCalled, false);
    assert.equal(res.media, null);
    assert.match(res.message || '', /untracked/i);
  });
});
