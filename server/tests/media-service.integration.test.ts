import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { PrismaClient, MediaType, WatchlistStatus } from '@prisma/client';
import prisma from '../src/lib/prisma';
import * as mediaService from '../src/services/media.service';
import * as watchlistService from '../src/services/watchlist.service';

const CONTAINER_NAME = 'cinevault-media-service-pg';
const TEST_PORT = 5435;
const TEST_DB_URL = `postgresql://postgres:postgres@localhost:${TEST_PORT}/cinevault_media_test?schema=public`;

describe('Media Service & Watchlist Deletion Real PostgreSQL Integration Test', () => {
  let testPrisma: PrismaClient;
  const originalWatchlist = prisma.watchlist;
  const originalUserMedia = prisma.userMedia;
  const originalWatchlistItem = prisma.watchlistItem;
  const originalTransaction = prisma.$transaction;
  const originalQueryRaw = prisma.$queryRaw;

  before(async () => {
    // 1. Verify Docker availability
    try {
      execSync('docker info', { stdio: 'pipe' });
    } catch {
      throw new Error('Docker daemon is not running or unavailable. Aborting integration test.');
    }

    try {
      execSync(`docker rm -f ${CONTAINER_NAME}`, { stdio: 'pipe' });
    } catch {
      // Ignored
    }

    // 2. Start isolated disposable PostgreSQL 16 container
    console.log(`[Integration Test] Starting disposable PostgreSQL 16 container "${CONTAINER_NAME}" on port ${TEST_PORT}...`);
    execSync(
      `docker run --name ${CONTAINER_NAME} -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=cinevault_media_test -p ${TEST_PORT}:5432 -d postgres:16-alpine`,
      { stdio: 'pipe' }
    );

    // 3. Wait for PostgreSQL readiness
    let isReady = false;
    for (let i = 0; i < 30; i++) {
      try {
        execSync(`docker exec ${CONTAINER_NAME} pg_isready -U postgres`, { stdio: 'pipe' });
        isReady = true;
        break;
      } catch {
        execSync('sleep 1');
      }
    }
    if (!isReady) {
      throw new Error('Disposable PostgreSQL container failed to become ready in time.');
    }

    // 4. Apply all migrations
    const migrationsDir = path.resolve(__dirname, '../prisma/migrations');
    const migrationFiles = [
      '20261122142624_init/migration.sql',
      '20261122150330_add_google_id/migration.sql',
      '20261123140000_phase2_watchlist_and_viewing_history/migration.sql',
      '20261123180000_add_case_insensitive_watchlist_name_unique_index/migration.sql',
    ];

    for (const relPath of migrationFiles) {
      const sql = fs.readFileSync(path.join(migrationsDir, relPath), 'utf-8');
      execSync(`docker exec -i ${CONTAINER_NAME} psql -U postgres -d cinevault_media_test`, {
        input: sql,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }
    console.log('[Integration Test] All migrations applied to disposable PostgreSQL instance.');

    // 5. Connect real PrismaClient to test DB
    testPrisma = new PrismaClient({
      datasources: { db: { url: TEST_DB_URL } },
    });
    await testPrisma.$connect();

    // 6. Direct global prisma delegates to test database
    (prisma as any).watchlist = testPrisma.watchlist;
    (prisma as any).userMedia = testPrisma.userMedia;
    (prisma as any).watchlistItem = testPrisma.watchlistItem;
    (prisma as any).$queryRaw = testPrisma.$queryRaw.bind(testPrisma);
    (prisma as any).$transaction = testPrisma.$transaction.bind(testPrisma);
  });

  after(async () => {
    (prisma as any).watchlist = originalWatchlist;
    (prisma as any).userMedia = originalUserMedia;
    (prisma as any).watchlistItem = originalWatchlistItem;
    (prisma as any).$transaction = originalTransaction;
    (prisma as any).$queryRaw = originalQueryRaw;

    if (testPrisma) {
      await testPrisma.$disconnect();
    }

    try {
      execSync(`docker rm -f ${CONTAINER_NAME}`, { stdio: 'pipe' });
      console.log(`[Integration Test] Disposable container "${CONTAINER_NAME}" stopped and removed.`);
    } catch {
      // Ignored
    }
  });

  test('full lifecycle: add membership, duplicate rejection, shared lists, status transitions, and whole-watchlist deletion pruning', async () => {
    // 1. Create test user and two watchlists
    const user = await testPrisma.user.create({
      data: {
        email: 'alice@cinevault.local',
        displayName: 'Alice',
        watchlists: {
          create: [
            { name: 'My Watchlist', isDefault: true },
            { name: 'Sci-Fi', isDefault: false },
            { name: 'Favorites', isDefault: false },
          ],
        },
      },
      include: { watchlists: true },
    });

    const sciFiList = user.watchlists.find((w) => w.name === 'Sci-Fi')!;
    const favList = user.watchlists.find((w) => w.name === 'Favorites')!;
    assert.ok(sciFiList && favList);

    // 2. Add previously untracked title to Sci-Fi list
    const addedItem = await mediaService.addWatchlistMembership(user.id, sciFiList.id, {
      tmdbId: 157336,
      mediaType: MediaType.MOVIE,
      metadata: {
        title: 'Interstellar',
        releaseDate: '2014-11-05',
        voteAverage: 8.4,
        posterPath: '/interstellar.jpg',
        overview: 'Space exploration wormhole',
      },
    });
    assert.ok(addedItem.id);
    assert.equal(addedItem.userMedia.status, WatchlistStatus.WANT_TO_WATCH);
    assert.equal(addedItem.userMedia.title, 'Interstellar');
    assert.equal(addedItem.userMedia.watchlistCount, 1);

    // 3. Reject duplicate addition of same title to same watchlist
    await assert.rejects(
      async () => {
        await mediaService.addWatchlistMembership(user.id, sciFiList.id, {
          tmdbId: 157336,
          mediaType: MediaType.MOVIE,
          metadata: { title: 'Interstellar' },
        });
      },
      mediaService.DuplicateMembershipError
    );

    // 4. Add same title to second watchlist (Favorites) -> Shared membership
    const sharedItem = await mediaService.addWatchlistMembership(user.id, favList.id, {
      tmdbId: 157336,
      mediaType: MediaType.MOVIE,
      metadata: { title: 'Interstellar' },
    });
    assert.equal(sharedItem.userMediaId, addedItem.userMediaId);
    assert.equal(sharedItem.userMedia.watchlistCount, 2);

    // 5. Remove membership from Favorites -> Preserves UserMedia because Sci-Fi membership remains
    const removeRes1 = await mediaService.removeWatchlistMembership(user.id, favList.id, addedItem.userMediaId);
    assert.ok(removeRes1.userMedia !== null);
    assert.equal(removeRes1.userMedia?.remainingWatchlistCount, 1);

    const userMediaCheck1 = await testPrisma.userMedia.findUnique({ where: { id: addedItem.userMediaId } });
    assert.ok(userMediaCheck1 !== null, 'UserMedia must be preserved when 1 membership remains');

    // 6. Direct mark-as-watched for untracked title
    const directWatchedRes = await mediaService.upsertMediaStatusWithRetry(user.id, {
      tmdbId: 550,
      mediaType: MediaType.MOVIE,
      status: WatchlistStatus.WATCHED,
      metadata: { title: 'Fight Club' },
    });
    assert.ok(directWatchedRes.media !== null);
    assert.equal(directWatchedRes.media?.status, WatchlistStatus.WATCHED);
    assert.equal(directWatchedRes.media?.watchlistCount, 0);

    // 7. Verify watched history query
    const history = await mediaService.getWatchedHistory(user.id, { page: 1, limit: 10 });
    assert.equal(history.pagination.totalCount, 1);
    assert.equal(history.history[0].title, 'Fight Club');

    // 8. Transition directly watched media from WATCHED to WANT_TO_WATCH with 0 memberships -> Pruned!
    const downgradeRes = await mediaService.updateMediaStatusById(
      user.id,
      directWatchedRes.media!.id,
      WatchlistStatus.WANT_TO_WATCH
    );
    assert.equal(downgradeRes.media, null);

    const checkFightClub = await testPrisma.userMedia.findUnique({ where: { id: directWatchedRes.media!.id } });
    assert.equal(checkFightClub, null, 'Directly tracked media must be pruned when set to WANT_TO_WATCH with 0 memberships');

    // 9. Whole-watchlist deletion: Delete Sci-Fi list (containing Interstellar with WANT_TO_WATCH and 0 other memberships)
    // Interstellar should be pruned from database!
    await watchlistService.deleteWatchlist(user.id, sciFiList.id);

    const checkInterstellar = await testPrisma.userMedia.findUnique({ where: { id: addedItem.userMediaId } });
    assert.equal(checkInterstellar, null, 'Orphaned WANT_TO_WATCH media must be pruned during whole-watchlist deletion');
  });

  test('concurrency Test A: membership addition vs whole-watchlist deletion on the same list', async () => {
    // 1. Create a user and a custom watchlist
    const user = await testPrisma.user.create({
      data: {
        email: 'concurrent_del@cinevault.local',
        displayName: 'Concurrent Delete Tester',
        watchlists: {
          create: [{ name: 'Action List', isDefault: false }],
        },
      },
      include: { watchlists: true },
    });
    const watchlist = user.watchlists[0];

    // 2. Launch addWatchlistMembership and deleteWatchlist concurrently in separate database transactions
    const [addResult, deleteResult] = await Promise.allSettled([
      mediaService.addWatchlistMembership(user.id, watchlist.id, {
        tmdbId: 80801,
        mediaType: MediaType.MOVIE,
        metadata: { title: 'Concurrent Movie 80801' },
      }),
      watchlistService.deleteWatchlist(user.id, watchlist.id),
    ]);

    // Deletion must always succeed in either serialization order
    assert.equal(deleteResult.status, 'fulfilled', 'deleteWatchlist must succeed');

    // Addition must either:
    // Outcome 1: Succeeded before deletion (addResult fulfilled). Deletion then cleans up list & prunes orphaned WANT_TO_WATCH.
    // Outcome 2: Deletion ran first (addResult rejected with NotFoundError: Watchlist not found).
    if (addResult.status === 'rejected') {
      const err = (addResult as PromiseRejectedResult).reason;
      assert.ok(
        err.name === 'NotFoundError' || err.message?.includes('not found'),
        `Expected NotFoundError when deletion commits first, got: ${err}`
      );
    } else {
      assert.equal(addResult.status, 'fulfilled');
    }

    // Verify database consistency:
    // Watchlist is deleted
    const wlCheck = await testPrisma.watchlist.findUnique({ where: { id: watchlist.id } });
    assert.equal(wlCheck, null, 'Watchlist must be deleted');

    // No orphaned WatchlistItem rows
    const itemCheck = await testPrisma.watchlistItem.count({ where: { watchlistId: watchlist.id } });
    assert.equal(itemCheck, 0, 'No WatchlistItems should exist for deleted list');

    // No orphaned WANT_TO_WATCH UserMedia remains
    const mediaCheck = await testPrisma.userMedia.findUnique({
      where: {
        userId_tmdbId_mediaType: {
          userId: user.id,
          tmdbId: 80801,
          mediaType: MediaType.MOVIE,
        },
      },
    });
    assert.equal(mediaCheck, null, 'No orphaned UserMedia should remain in database');
  });

  test('concurrency Test B: concurrent direct upserts exercise P2002 recovery in fresh transaction', async () => {
    const user = await testPrisma.user.create({
      data: {
        email: 'concurrent_upsert@cinevault.local',
        displayName: 'Concurrent Upsert Tester',
      },
    });

    const targetTmdbId = 99901;

    // Launch two upsertMediaStatusWithRetry calls concurrently for the same user, tmdbId, and mediaType
    const [res1, res2] = await Promise.all([
      mediaService.upsertMediaStatusWithRetry(user.id, {
        tmdbId: targetTmdbId,
        mediaType: MediaType.MOVIE,
        status: WatchlistStatus.WATCHED,
        metadata: { title: 'Concurrent Movie 99901 (Thread 1)' },
      }),
      mediaService.upsertMediaStatusWithRetry(user.id, {
        tmdbId: targetTmdbId,
        mediaType: MediaType.MOVIE,
        status: WatchlistStatus.WATCHED,
        metadata: { title: 'Concurrent Movie 99901 (Thread 2)' },
      }),
    ]);

    // Both calls must complete successfully
    assert.ok(res1.media !== null);
    assert.ok(res2.media !== null);
    assert.equal(res1.media?.status, WatchlistStatus.WATCHED);
    assert.equal(res2.media?.status, WatchlistStatus.WATCHED);

    // Both must point to the exact same UserMedia record ID
    assert.equal(res1.media?.id, res2.media?.id);

    // Exactly one UserMedia record must exist in the database
    const records = await testPrisma.userMedia.findMany({
      where: {
        userId: user.id,
        tmdbId: targetTmdbId,
        mediaType: MediaType.MOVIE,
      },
    });
    assert.equal(records.length, 1, 'Exactly one UserMedia record must exist');
    assert.equal(records[0].status, WatchlistStatus.WATCHED);
  });

  test('concurrency Test C: membership removal vs marking WATCHED on the same media', async () => {
    const user = await testPrisma.user.create({
      data: {
        email: 'concurrent_removal@cinevault.local',
        displayName: 'Concurrent Removal Tester',
        watchlists: {
          create: [{ name: 'Test List', isDefault: false }],
        },
      },
      include: { watchlists: true },
    });
    const watchlist = user.watchlists[0];

    // Seed: Track title in the watchlist with WANT_TO_WATCH
    const seeded = await mediaService.addWatchlistMembership(user.id, watchlist.id, {
      tmdbId: 77701,
      mediaType: MediaType.MOVIE,
      metadata: { title: 'Concurrent Movie 77701' },
    });
    const mediaId = seeded.userMediaId;

    // Run removeWatchlistMembership and updateMediaStatusById(..., WATCHED) concurrently
    const [removeResult, updateResult] = await Promise.allSettled([
      mediaService.removeWatchlistMembership(user.id, watchlist.id, mediaId),
      mediaService.updateMediaStatusById(user.id, mediaId, WatchlistStatus.WATCHED),
    ]);

    // Inspect the serialized order based on which transaction acquired the UserMedia lock first:
    const mediaInDb = await testPrisma.userMedia.findUnique({ where: { id: mediaId } });

    if (updateResult.status === 'fulfilled') {
      // Outcome 1: Status update acquired lock first, set status = WATCHED.
      // Removal then deleted membership, saw status = WATCHED, and preserved the record.
      assert.equal(removeResult.status, 'fulfilled', 'Removal should fulfill when status is WATCHED');
      assert.ok(mediaInDb !== null, 'WATCHED media must be preserved');
      assert.equal(mediaInDb?.status, WatchlistStatus.WATCHED);
    } else {
      // Outcome 2: Removal acquired lock first, deleted membership, saw WANT_TO_WATCH with 0 remaining, and pruned it.
      // Status update then found 0 rows under lock and threw NotFoundError.
      assert.equal(removeResult.status, 'fulfilled', 'Removal should fulfill');
      const err = (updateResult as PromiseRejectedResult).reason;
      assert.ok(
        err.name === 'NotFoundError' || err.message?.includes('not found'),
        `Expected NotFoundError when media was pruned first, got: ${err}`
      );
      assert.equal(mediaInDb, null, 'Pruned media must not exist in database');
    }

    // Invariant: Under no circumstance should an orphaned WANT_TO_WATCH record with 0 memberships exist
    if (mediaInDb) {
      assert.equal(mediaInDb.status, WatchlistStatus.WATCHED, 'Any preserved media must have status WATCHED');
    }
  });
});
