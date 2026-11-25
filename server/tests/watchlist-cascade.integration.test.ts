import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { PrismaClient } from '@prisma/client';
import prisma from '../src/lib/prisma';
import * as watchlistService from '../src/services/watchlist.service';

const CONTAINER_NAME = 'cinevault-cascade-pg';
const TEST_PORT = 5434;
const TEST_DB_URL = `postgresql://postgres:postgres@localhost:${TEST_PORT}/cinevault_cascade_test?schema=public`;

describe('Real PostgreSQL Cascade & UserMedia Preservation Integration Test', () => {
  let testPrisma: PrismaClient;
  const originalWatchlist = prisma.watchlist;
  const originalUserMedia = prisma.userMedia;
  const originalWatchlistItem = (prisma as any).watchlistItem;
  const originalTransaction = prisma.$transaction;
  const originalQueryRaw = prisma.$queryRaw;

  before(async () => {
    // 1. Verify Docker availability
    try {
      execSync('docker info', { stdio: 'pipe' });
    } catch (dockerErr) {
      throw new Error('Docker daemon is not running or unavailable. Aborting integration test.');
    }

    // Clean up any stale container with the same name
    try {
      execSync(`docker rm -f ${CONTAINER_NAME}`, { stdio: 'pipe' });
    } catch {
      // Ignored if container didn't exist
    }

    // 2. Start isolated disposable PostgreSQL 16 container
    console.log(`[Integration Test] Starting disposable PostgreSQL 16 container "${CONTAINER_NAME}" on port ${TEST_PORT}...`);
    execSync(
      `docker run --name ${CONTAINER_NAME} -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=cinevault_cascade_test -p ${TEST_PORT}:5432 -d postgres:16-alpine`,
      { stdio: 'pipe' }
    );

    // 3. Wait for PostgreSQL to become ready
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

    // 4. Apply all project migrations to the disposable database
    const migrationsDir = path.resolve(__dirname, '../prisma/migrations');
    const migrationFiles = [
      '20261122142624_init/migration.sql',
      '20261122150330_add_google_id/migration.sql',
      '20261123140000_phase2_watchlist_and_viewing_history/migration.sql',
      '20261123180000_add_case_insensitive_watchlist_name_unique_index/migration.sql',
    ];

    for (const relPath of migrationFiles) {
      const sql = fs.readFileSync(path.join(migrationsDir, relPath), 'utf-8');
      execSync(`docker exec -i ${CONTAINER_NAME} psql -U postgres -d cinevault_cascade_test`, {
        input: sql,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }
    console.log('[Integration Test] All migrations applied to disposable PostgreSQL instance.');

    // 5. Connect real PrismaClient to disposable test database
    testPrisma = new PrismaClient({
      datasources: {
        db: {
          url: TEST_DB_URL,
        },
      },
    });
    await testPrisma.$connect();

    // 6. Direct watchlistService's database operations to the disposable test database
    (prisma as any).watchlist = testPrisma.watchlist;
    (prisma as any).userMedia = testPrisma.userMedia;
    (prisma as any).watchlistItem = testPrisma.watchlistItem;
    (prisma as any).$transaction = testPrisma.$transaction.bind(testPrisma);
    (prisma as any).$queryRaw = testPrisma.$queryRaw.bind(testPrisma);
  });

  after(async () => {
    // Restore original prisma delegates
    (prisma as any).watchlist = originalWatchlist;
    (prisma as any).userMedia = originalUserMedia;
    (prisma as any).watchlistItem = originalWatchlistItem;
    (prisma as any).$transaction = originalTransaction;
    (prisma as any).$queryRaw = originalQueryRaw;

    if (testPrisma) {
      await testPrisma.$disconnect();
    }

    // Stop and remove the disposable container
    try {
      execSync(`docker rm -f ${CONTAINER_NAME}`, { stdio: 'pipe' });
      console.log(`[Integration Test] Disposable container "${CONTAINER_NAME}" stopped and removed.`);
    } catch (e: any) {
      console.warn(`[Integration Test] Warning cleaning up container: ${e.message}`);
    }
  });

  test('deleting a custom watchlist cascades WatchlistItem but preserves UserMedia with WATCHED status', async () => {
    // Step 1: Create a test User
    const testUser = await testPrisma.user.create({
      data: {
        email: 'cascade_tester@cinevault.local',
        displayName: 'Cascade Tester',
        watchlists: {
          create: {
            name: 'My Watchlist',
            isDefault: true,
          },
        },
      },
    });
    assert.ok(testUser.id, 'Test user must be created');

    // Step 2: Create a UserMedia record with WATCHED status and full metadata
    const userMedia = await testPrisma.userMedia.create({
      data: {
        userId: testUser.id,
        tmdbId: 157336,
        mediaType: 'MOVIE',
        status: 'WATCHED',
        title: 'Interstellar',
        releaseDate: '2014-11-05',
        voteAverage: 8.4,
      },
    });
    assert.ok(userMedia.id, 'UserMedia record must be created');
    assert.equal(userMedia.status, 'WATCHED');
    assert.equal(userMedia.title, 'Interstellar');

    // Step 3: Create a custom watchlist using watchlistService.createWatchlist()
    const customWatchlist = await watchlistService.createWatchlist(testUser.id, 'Sci-Fi Masterpieces');
    assert.ok(customWatchlist.id, 'Custom watchlist must be created');
    assert.equal(customWatchlist.name, 'Sci-Fi Masterpieces');
    assert.equal(customWatchlist.isDefault, false);

    // Step 4: Create a WatchlistItem linking the custom watchlist and UserMedia
    const watchlistItem = await testPrisma.watchlistItem.create({
      data: {
        watchlistId: customWatchlist.id,
        userMediaId: userMedia.id,
      },
    });
    assert.ok(watchlistItem.id, 'WatchlistItem join row must be created');

    // Step 5: Confirm the custom watchlist itemCount is 1
    const userWatchlistsBefore = await watchlistService.getUserWatchlists(testUser.id);
    const targetListBefore = userWatchlistsBefore.find((w) => w.id === customWatchlist.id);
    assert.ok(targetListBefore, 'Target watchlist must be listed');
    assert.equal(targetListBefore.itemCount, 1, 'Custom watchlist itemCount must be 1');

    // Step 6: Delete the custom watchlist using watchlistService.deleteWatchlist()
    const deleteResult = await watchlistService.deleteWatchlist(testUser.id, customWatchlist.id);
    assert.equal(deleteResult.message, 'Watchlist deleted successfully');

    // Step 7: Verify the Watchlist no longer exists in PostgreSQL
    const foundWatchlist = await testPrisma.watchlist.findUnique({
      where: { id: customWatchlist.id },
    });
    assert.equal(foundWatchlist, null, 'Deleted watchlist must not exist in database');

    // Step 8: Verify the WatchlistItem membership no longer exists in PostgreSQL (cascade)
    const foundWatchlistItem = await testPrisma.watchlistItem.findUnique({
      where: { id: watchlistItem.id },
    });
    assert.equal(foundWatchlistItem, null, 'WatchlistItem must be deleted by PostgreSQL ON DELETE CASCADE');

    // Step 9: Verify UserMedia STILL exists in PostgreSQL
    const foundUserMedia = await testPrisma.userMedia.findUnique({
      where: { id: userMedia.id },
    });
    assert.ok(foundUserMedia !== null, 'UserMedia record must still exist in database');

    // Step 10: Verify its WATCHED status and all supplied metadata remain unchanged
    assert.equal(foundUserMedia.status, 'WATCHED', 'UserMedia status must remain strictly WATCHED');
    assert.equal(foundUserMedia.tmdbId, 157336, 'UserMedia tmdbId must remain 157336');
    assert.equal(foundUserMedia.mediaType, 'MOVIE', 'UserMedia mediaType must remain MOVIE');
    assert.equal(foundUserMedia.title, 'Interstellar', 'UserMedia title must remain Interstellar');
    assert.equal(foundUserMedia.releaseDate, '2014-11-05', 'UserMedia releaseDate must remain 2014-11-05');
    assert.equal(foundUserMedia.voteAverage, 8.4, 'UserMedia voteAverage must remain 8.4');
  });
});
