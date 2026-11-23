import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { PrismaClient, MediaType, WatchlistStatus } from '@prisma/client';
import app from '../src/index';
import prisma from '../src/lib/prisma';

// Configuration
const CONTAINER_NAME = 'cinevault-e2e-pg-5436';
const DB_PORT = 5436;
const SERVER_PORT = 5437;
const BASE_URL = `http://localhost:${SERVER_PORT}`;
const DB_URL = `postgresql://postgres:postgres@localhost:${DB_PORT}/cinevault_e2e_test?schema=public`;
const JWT_SECRET = process.env.JWT_SECRET || 'cinevault_e2e_jwt_secret_test_key_12345';
process.env.JWT_SECRET = JWT_SECRET;
process.env.DATABASE_URL = DB_URL;

interface ManifestResource {
  type: 'USER' | 'WATCHLIST' | 'USER_MEDIA' | 'WATCHLIST_ITEM';
  id: string;
  identifier: string;
  ownerUserId: string;
  lifecycleStatus: 'ACTIVE' | 'DELETED' | 'CLEANED_UP';
  watchlistId?: string;
  userMediaId?: string;
  stepCreated: string;
  stepDeleted?: string;
}

interface Manifest {
  runId: string;
  createdAt: string;
  updatedAt: string;
  runStatus: 'INITIALIZING' | 'IN_PROGRESS' | 'COMPLETED' | 'CLEANUP_IN_PROGRESS' | 'CLEANED_UP' | 'CLEANUP_FAILED';
  environment: 'disposable_local';
  userRoots: string[];
  resources: ManifestResource[];
}

const runId = `e2e_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
const manifestPath = path.resolve(__dirname, `../.e2e-manifest-${runId}.json`);
const tempManifestPath = path.resolve(__dirname, `../.e2e-manifest-${runId}.json.tmp`);
const containingDir = path.dirname(manifestPath);

/**
 * Atomically writes the manifest to disk using write -> fsync(file) -> rename -> fsync(dir).
 */
function writeManifestAtomic(manifest: Manifest): void {
  manifest.updatedAt = new Date().toISOString();
  const json = JSON.stringify(manifest, null, 2);

  // 1. Write to temp file
  const fd = fs.openSync(tempManifestPath, 'w');
  try {
    fs.writeSync(fd, json);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  // 2. Atomic rename
  fs.renameSync(tempManifestPath, manifestPath);

  // 3. Fsync containing directory
  try {
    const dirFd = fs.openSync(containingDir, 'r');
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch (err: any) {
    if (['EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM'].includes(err.code)) {
      console.warn(
        `[E2E Manifest Warning] Directory fsync unsupported on this filesystem (${err.code}). ` +
        `File data is durable via file fsync, but directory entry durability relies on OS sync flush.`
      );
    } else {
      throw new Error(`[E2E Manifest Fatal] Directory fsync failed: ${err.message}`);
    }
  }
}

async function runE2EPhase1() {
  console.log('================================================================');
  console.log(`[E2E Phase 1] Starting execution with runId: ${runId}`);
  console.log(`[E2E Phase 1] Manifest path: ${manifestPath}`);
  console.log('================================================================');

  let testPrisma: PrismaClient | null = null;
  let server: http.Server | null = null;

  // Step A: Pre-generate authoritative user roots and initialize durable manifest BEFORE any DB writes
  const userAlphaId = crypto.randomUUID();
  const userBetaId = crypto.randomUUID();
  const userAlphaEmail = `e2e_alpha_${runId}@cinevault.test`;
  const userBetaEmail = `e2e_beta_${runId}@cinevault.test`;

  const manifest: Manifest = {
    runId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    runStatus: 'INITIALIZING',
    environment: 'disposable_local',
    userRoots: [userAlphaId, userBetaId],
    resources: [
      {
        type: 'USER',
        id: userAlphaId,
        identifier: userAlphaEmail,
        ownerUserId: userAlphaId,
        lifecycleStatus: 'ACTIVE',
        stepCreated: 'Setup',
      },
      {
        type: 'USER',
        id: userBetaId,
        identifier: userBetaEmail,
        ownerUserId: userBetaId,
        lifecycleStatus: 'ACTIVE',
        stepCreated: 'Setup',
      },
    ],
  };

  // Write initial manifest to disk BEFORE touching database
  writeManifestAtomic(manifest);
  console.log('[E2E Phase 1] Authoritative user roots persisted to durable manifest before DB provisioning.');

  try {
    // 1. Verify Docker & clean stale container
    try {
      execSync(`docker rm -f ${CONTAINER_NAME}`, { stdio: 'pipe' });
    } catch {}

    // 2. Start PostgreSQL 16 Alpine container
    console.log(`[E2E Phase 1] Starting disposable container "${CONTAINER_NAME}" on port ${DB_PORT}...`);
    execSync(
      `docker run --name ${CONTAINER_NAME} -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=cinevault_e2e_test -p ${DB_PORT}:5432 -d postgres:16-alpine`,
      { stdio: 'pipe' }
    );

    // 3. Wait for readiness
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
    assert.ok(isReady, 'PostgreSQL container failed to become ready');
    console.log('[E2E Phase 1] Disposable PostgreSQL container is ready.');

    // 4. Apply all project migrations
    const migrationsDir = path.resolve(__dirname, '../prisma/migrations');
    const migrationFiles = [
      '20261122142624_init/migration.sql',
      '20261122150330_add_google_id/migration.sql',
      '20261123140000_phase2_watchlist_and_viewing_history/migration.sql',
      '20261123180000_add_case_insensitive_watchlist_name_unique_index/migration.sql',
    ];

    for (const relPath of migrationFiles) {
      const sql = fs.readFileSync(path.join(migrationsDir, relPath), 'utf-8');
      execSync(`docker exec -i ${CONTAINER_NAME} psql -U postgres -d cinevault_e2e_test`, {
        input: sql,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }
    console.log('[E2E Phase 1] All migrations applied successfully to disposable database.');

    // 5. Connect real PrismaClient to disposable test DB
    testPrisma = new PrismaClient({
      datasources: { db: { url: DB_URL } },
    });
    await testPrisma.$connect();

    // 6. Bind global prisma delegates to test database
    (prisma as any).user = testPrisma.user;
    (prisma as any).watchlist = testPrisma.watchlist;
    (prisma as any).userMedia = testPrisma.userMedia;
    (prisma as any).watchlistItem = testPrisma.watchlistItem;
    (prisma as any).$queryRaw = testPrisma.$queryRaw.bind(testPrisma);
    (prisma as any).$transaction = testPrisma.$transaction.bind(testPrisma);

    // 7. Provision User Alpha & Default Watchlist
    await testPrisma.user.create({
      data: {
        id: userAlphaId,
        email: userAlphaEmail,
        displayName: `E2E Alpha (${runId})`,
      },
    });
    const defWlAlpha = await testPrisma.watchlist.create({
      data: {
        userId: userAlphaId,
        name: 'My Watchlist',
        isDefault: true,
      },
    });
    manifest.resources.push({
      type: 'WATCHLIST',
      id: defWlAlpha.id,
      identifier: 'My Watchlist (Default Alpha)',
      ownerUserId: userAlphaId,
      lifecycleStatus: 'ACTIVE',
      stepCreated: 'Setup',
    });
    writeManifestAtomic(manifest);

    // 8. Provision User Beta & Default Watchlist
    await testPrisma.user.create({
      data: {
        id: userBetaId,
        email: userBetaEmail,
        displayName: `E2E Beta (${runId})`,
      },
    });
    const defWlBeta = await testPrisma.watchlist.create({
      data: {
        userId: userBetaId,
        name: 'My Watchlist',
        isDefault: true,
      },
    });
    manifest.resources.push({
      type: 'WATCHLIST',
      id: defWlBeta.id,
      identifier: 'My Watchlist (Default Beta)',
      ownerUserId: userBetaId,
      lifecycleStatus: 'ACTIVE',
      stepCreated: 'Setup',
    });
    manifest.runStatus = 'IN_PROGRESS';
    writeManifestAtomic(manifest);
    console.log('[E2E Phase 1] Test users and default watchlists provisioned in DB.');

    // 9. Mint JWTs strictly AFTER user confirmation in DB
    const tokenAlpha = jwt.sign(
      { userId: userAlphaId, email: userAlphaEmail },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '1h' }
    );
    const tokenBeta = jwt.sign(
      { userId: userBetaId, email: userBetaEmail },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '1h' }
    );
    console.log('[E2E Phase 1] In-memory JWTs minted for User Alpha and User Beta.');

    // 10. Start Real Express HTTP Server
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server!.listen(SERVER_PORT, () => {
        console.log(`[E2E Phase 1] Real Express HTTP server listening at ${BASE_URL}`);
        resolve();
      });
    });

    // Helper for HTTP requests
    async function apiRequest(method: string, endpoint: string, token?: string, body?: any) {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (body) headers['Content-Type'] = 'application/json';

      const res = await fetch(`${BASE_URL}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      let json: any = null;
      try {
        json = await res.json();
      } catch {}
      return { status: res.status, data: json };
    }

    console.log('\n--- EXECUTING APPROVED E2E TEST SCENARIOS ---\n');

    // Step 0.1: Unauthenticated request rejection
    console.log('[Step 0.1] Testing unauthenticated rejection on GET /api/watchlists...');
    const step01 = await apiRequest('GET', '/api/watchlists');
    assert.equal(step01.status, 401);
    assert.equal(step01.data.error, 'Authorization token required');
    console.log('  ✔ Step 0.1 passed (401 with "Authorization token required")');

    // Step 0.2: Invalid token rejection
    console.log('[Step 0.2] Testing invalid token rejection on GET /api/watchlists...');
    const step02 = await apiRequest('GET', '/api/watchlists', 'invalid_bogus_token');
    assert.equal(step02.status, 401);
    assert.equal(step02.data.error, 'Invalid authentication token');
    console.log('  ✔ Step 0.2 passed (401 with "Invalid authentication token")');

    // Step 1: Retrieve default watchlist
    console.log('[Step 1] Retrieving default watchlist for User Alpha...');
    const step1 = await apiRequest('GET', '/api/watchlists', tokenAlpha);
    assert.equal(step1.status, 200);
    assert.ok(step1.data.watchlists.length >= 1);
    const defWlResult = step1.data.watchlists.find((w: any) => w.isDefault);
    assert.ok(defWlResult);
    assert.equal(defWlResult.id, defWlAlpha.id);
    assert.equal(defWlResult.name, 'My Watchlist');
    assert.equal(defWlResult.itemCount, 0);
    console.log('  ✔ Step 1 passed (default watchlist present, isDefault=true, itemCount=0)');

    // Step 2.1: Create custom watchlist (W1)
    console.log('[Step 2.1] Creating custom watchlist W1 ("Sci-Fi E2E")...');
    const step21 = await apiRequest('POST', '/api/watchlists', tokenAlpha, { name: 'Sci-Fi E2E' });
    assert.equal(step21.status, 201);
    const w1Id = step21.data.watchlist.id;
    assert.equal(step21.data.watchlist.name, 'Sci-Fi E2E');
    assert.equal(step21.data.watchlist.isDefault, false);
    manifest.resources.push({
      type: 'WATCHLIST',
      id: w1Id,
      identifier: 'Sci-Fi Classics (W1)',
      ownerUserId: userAlphaId,
      lifecycleStatus: 'ACTIVE',
      stepCreated: 'Step 2.1',
    });
    writeManifestAtomic(manifest);
    console.log(`  ✔ Step 2.1 passed (created W1: ${w1Id})`);

    // Step 2.2: Rename custom watchlist (W1)
    console.log('[Step 2.2] Renaming custom watchlist W1 to "Sci-Fi Classics"...');
    const step22 = await apiRequest('PATCH', `/api/watchlists/${w1Id}`, tokenAlpha, { name: 'Sci-Fi Classics' });
    assert.equal(step22.status, 200);
    assert.equal(step22.data.watchlist.name, 'Sci-Fi Classics');
    console.log('  ✔ Step 2.2 passed (renamed W1)');

    // Step 3: Add Movie to W1 (creates UserMedia UM1 and WatchlistItem WLI_1)
    console.log('[Step 3] Adding Movie (TMDB 990001) to W1...');
    const step3 = await apiRequest('POST', `/api/watchlists/${w1Id}/items`, tokenAlpha, {
      tmdbId: 990001,
      mediaType: 'MOVIE',
      metadata: {
        title: 'E2E Core Film',
        releaseDate: '2024-01-01',
        voteAverage: 8.5,
        posterPath: '/movie1.jpg',
      },
    });
    assert.equal(step3.status, 201);
    const wli1Id = step3.data.item.id;
    const um1Id = step3.data.item.userMediaId;
    assert.equal(step3.data.item.userMedia.status, WatchlistStatus.WANT_TO_WATCH);
    assert.equal(step3.data.item.userMedia.watchlistCount, 1);
    manifest.resources.push({
      type: 'USER_MEDIA',
      id: um1Id,
      identifier: 'tmdb:990001:MOVIE (UM1)',
      ownerUserId: userAlphaId,
      lifecycleStatus: 'ACTIVE',
      stepCreated: 'Step 3',
    });
    manifest.resources.push({
      type: 'WATCHLIST_ITEM',
      id: wli1Id,
      identifier: 'UM1 in W1',
      ownerUserId: userAlphaId,
      watchlistId: w1Id,
      userMediaId: um1Id,
      lifecycleStatus: 'ACTIVE',
      stepCreated: 'Step 3',
    });
    writeManifestAtomic(manifest);
    console.log(`  ✔ Step 3 passed (UM1: ${um1Id}, WLI_1: ${wli1Id})`);

    // Step 4: Add TV Show to W1 (creates UserMedia UM_TV and WatchlistItem WLI_TV)
    console.log('[Step 4] Adding TV Show (TMDB 990003) to W1...');
    const step4 = await apiRequest('POST', `/api/watchlists/${w1Id}/items`, tokenAlpha, {
      tmdbId: 990003,
      mediaType: 'TV',
      metadata: {
        title: 'E2E Series',
        posterPath: '/tv1.png',
      },
    });
    assert.equal(step4.status, 201);
    const wliTvId = step4.data.item.id;
    const umTvId = step4.data.item.userMediaId;
    assert.equal(step4.data.item.userMedia.mediaType, MediaType.TV);
    assert.equal(step4.data.item.userMedia.watchlistCount, 1);
    manifest.resources.push({
      type: 'USER_MEDIA',
      id: umTvId,
      identifier: 'tmdb:990003:TV (UM_TV)',
      ownerUserId: userAlphaId,
      lifecycleStatus: 'ACTIVE',
      stepCreated: 'Step 4',
    });
    manifest.resources.push({
      type: 'WATCHLIST_ITEM',
      id: wliTvId,
      identifier: 'UM_TV in W1',
      ownerUserId: userAlphaId,
      watchlistId: w1Id,
      userMediaId: umTvId,
      lifecycleStatus: 'ACTIVE',
      stepCreated: 'Step 4',
    });
    writeManifestAtomic(manifest);
    console.log(`  ✔ Step 4 passed (UM_TV: ${umTvId}, WLI_TV: ${wliTvId})`);

    // Step 5.1: Create 2nd custom list (W2)
    console.log('[Step 5.1] Creating 2nd custom watchlist W2 ("Favorites E2E")...');
    const step51 = await apiRequest('POST', '/api/watchlists', tokenAlpha, { name: 'Favorites E2E' });
    assert.equal(step51.status, 201);
    const w2Id = step51.data.watchlist.id;
    manifest.resources.push({
      type: 'WATCHLIST',
      id: w2Id,
      identifier: 'Favorites E2E (W2)',
      ownerUserId: userAlphaId,
      lifecycleStatus: 'ACTIVE',
      stepCreated: 'Step 5.1',
    });
    writeManifestAtomic(manifest);
    console.log(`  ✔ Step 5.1 passed (created W2: ${w2Id})`);

    // Step 5.2: Add Movie 1 to W2 (verifies UserMedia reuse and creates WLI_SHARED_W2)
    console.log('[Step 5.2] Adding Movie 1 to W2 (verifying UserMedia reuse)...');
    const step52 = await apiRequest('POST', `/api/watchlists/${w2Id}/items`, tokenAlpha, {
      tmdbId: 990001,
      mediaType: 'MOVIE',
      metadata: { title: 'E2E Core Film' },
    });
    assert.equal(step52.status, 201);
    const wliSharedW2Id = step52.data.item.id;
    assert.equal(step52.data.item.userMediaId, um1Id, 'Must reuse the exact same UserMedia ID');
    assert.equal(step52.data.item.userMedia.watchlistCount, 2);
    manifest.resources.push({
      type: 'WATCHLIST_ITEM',
      id: wliSharedW2Id,
      identifier: 'UM1 in W2',
      ownerUserId: userAlphaId,
      watchlistId: w2Id,
      userMediaId: um1Id,
      lifecycleStatus: 'ACTIVE',
      stepCreated: 'Step 5.2',
    });
    writeManifestAtomic(manifest);
    console.log(`  ✔ Step 5.2 passed (reused UM1, created WLI_SHARED_W2: ${wliSharedW2Id})`);

    // Step 6: Reject duplicate membership in W2
    console.log('[Step 6] Verifying duplicate membership rejection in W2 (409 Conflict)...');
    const step6 = await apiRequest('POST', `/api/watchlists/${w2Id}/items`, tokenAlpha, {
      tmdbId: 990001,
      mediaType: 'MOVIE',
      metadata: { title: 'E2E Core Film' },
    });
    assert.equal(step6.status, 409);
    assert.equal(step6.data.error, 'Media is already in this watchlist');
    console.log('  ✔ Step 6 passed (409 duplicate membership rejected)');

    // Step 7: Mark Movie 1 WATCHED (Global status update)
    console.log('[Step 7] Marking Movie 1 WATCHED globally across lists...');
    const step7 = await apiRequest('POST', '/api/media/status', tokenAlpha, {
      tmdbId: 990001,
      mediaType: 'MOVIE',
      status: 'WATCHED',
      metadata: { title: 'E2E Core Film' },
    });
    assert.equal(step7.status, 200);
    assert.equal(step7.data.media.id, um1Id);
    assert.equal(step7.data.media.status, WatchlistStatus.WATCHED);
    assert.equal(step7.data.media.watchlistCount, 2);
    const dbCheckUm1 = await testPrisma.userMedia.findUnique({ where: { id: um1Id } });
    assert.equal(dbCheckUm1?.status, WatchlistStatus.WATCHED);
    console.log('  ✔ Step 7 passed (status is globally WATCHED)');

    // Step 8: Remove membership from W2 (Shared membership removal)
    console.log('[Step 8] Removing Movie 1 membership from W2 (shared title)...');
    const step8 = await apiRequest('DELETE', `/api/watchlists/${w2Id}/items/${um1Id}`, tokenAlpha);
    assert.equal(step8.status, 200);
    assert.equal(step8.data.userMedia.id, um1Id);
    assert.equal(step8.data.userMedia.remainingWatchlistCount, 1);
    // Update manifest: WLI_SHARED_W2 is deleted
    const mEntryWliW2 = manifest.resources.find((r) => r.id === wliSharedW2Id)!;
    mEntryWliW2.lifecycleStatus = 'DELETED';
    mEntryWliW2.stepDeleted = 'Step 8';
    writeManifestAtomic(manifest);
    // DB check: UM1 still exists because W1 membership remains
    const dbCheckUm1PostW2 = await testPrisma.userMedia.findUnique({ where: { id: um1Id } });
    assert.ok(dbCheckUm1PostW2 !== null, 'UM1 must be preserved when 1 membership remains');
    console.log('  ✔ Step 8 passed (W2 membership removed, UM1 preserved)');

    // Step 9: Remove final membership of WANT_TO_WATCH (Prune)
    console.log('[Step 9] Removing final membership of TV Show from W1 (verifying prune)...');
    const step9 = await apiRequest('DELETE', `/api/watchlists/${w1Id}/items/${umTvId}`, tokenAlpha);
    assert.equal(step9.status, 200);
    assert.equal(step9.data.userMedia, null);
    assert.match(step9.data.message, /untracked/i);
    // Update manifest: WLI_TV and UM_TV are deleted
    const mEntryWliTv = manifest.resources.find((r) => r.id === wliTvId)!;
    mEntryWliTv.lifecycleStatus = 'DELETED';
    mEntryWliTv.stepDeleted = 'Step 9';
    const mEntryUmTv = manifest.resources.find((r) => r.id === umTvId)!;
    mEntryUmTv.lifecycleStatus = 'DELETED';
    mEntryUmTv.stepDeleted = 'Step 9';
    writeManifestAtomic(manifest);
    // DB check: UM_TV deleted from database
    const dbCheckUmTv = await testPrisma.userMedia.findUnique({ where: { id: umTvId } });
    assert.equal(dbCheckUmTv, null, 'Orphaned WANT_TO_WATCH media must be pruned from DB');
    console.log('  ✔ Step 9 passed (UM_TV pruned from database)');

    // Step 10: Remove final membership of WATCHED (Preserve)
    console.log('[Step 10] Removing final membership of Movie 1 from W1 (verifying WATCHED preservation)...');
    const step10 = await apiRequest('DELETE', `/api/watchlists/${w1Id}/items/${um1Id}`, tokenAlpha);
    assert.equal(step10.status, 200);
    assert.equal(step10.data.userMedia.id, um1Id);
    assert.equal(step10.data.userMedia.status, WatchlistStatus.WATCHED);
    assert.equal(step10.data.userMedia.remainingWatchlistCount, 0);
    // Update manifest: WLI_1 is deleted, but UM1 remains ACTIVE
    const mEntryWli1 = manifest.resources.find((r) => r.id === wli1Id)!;
    mEntryWli1.lifecycleStatus = 'DELETED';
    mEntryWli1.stepDeleted = 'Step 10';
    writeManifestAtomic(manifest);
    // DB check: UM1 remains in DB with status WATCHED and 0 memberships
    const dbCheckUm1Watched = await testPrisma.userMedia.findUnique({ where: { id: um1Id } });
    assert.ok(dbCheckUm1Watched !== null, 'WATCHED media must remain in DB even with 0 memberships');
    assert.equal(dbCheckUm1Watched.status, WatchlistStatus.WATCHED);
    console.log('  ✔ Step 10 passed (WATCHED media preserved in DB with 0 memberships)');

    // Step 11: Direct mark WATCHED without adding to any watchlist
    console.log('[Step 11] Directly marking Standalone Movie (TMDB 990004) WATCHED...');
    const step11 = await apiRequest('POST', '/api/media/status', tokenAlpha, {
      tmdbId: 990004,
      mediaType: 'MOVIE',
      status: 'WATCHED',
      metadata: { title: 'Direct Watched Standalone' },
    });
    assert.equal(step11.status, 200);
    const umDirectId = step11.data.media.id;
    assert.equal(step11.data.media.status, WatchlistStatus.WATCHED);
    assert.equal(step11.data.media.watchlistCount, 0);
    manifest.resources.push({
      type: 'USER_MEDIA',
      id: umDirectId,
      identifier: 'tmdb:990004:MOVIE (UM_DIRECT)',
      ownerUserId: userAlphaId,
      lifecycleStatus: 'ACTIVE',
      stepCreated: 'Step 11',
    });
    writeManifestAtomic(manifest);
    console.log(`  ✔ Step 11 passed (UM_DIRECT: ${umDirectId})`);

    // Step 12: Verify untracked WANT_TO_WATCH behavior
    console.log('[Step 12] Verifying untracked WANT_TO_WATCH behavior for unadded title (TMDB 990002)...');
    const step12 = await apiRequest('POST', '/api/media/status', tokenAlpha, {
      tmdbId: 990002,
      mediaType: 'MOVIE',
      status: 'WANT_TO_WATCH',
      metadata: { title: 'Untracked Film' },
    });
    assert.equal(step12.status, 200);
    assert.equal(step12.data.media, null);
    assert.match(step12.data.message, /untracked/i);
    const dbCheckUntracked = await testPrisma.userMedia.findUnique({
      where: {
        userId_tmdbId_mediaType: {
          userId: userAlphaId,
          tmdbId: 990002,
          mediaType: MediaType.MOVIE,
        },
      },
    });
    assert.equal(dbCheckUntracked, null, 'No row should be created for untracked WANT_TO_WATCH');
    console.log('  ✔ Step 12 passed (returns media: null, 0 rows in DB)');

    // Step 13: Genuine Whole-Watchlist Deletion Scenario
    console.log('[Step 13] Executing Genuine Whole-Watchlist Deletion Scenario (W_DEL vs W_SURVIVE)...');
    // 13.1 Create W_SURVIVE
    const step131 = await apiRequest('POST', '/api/watchlists', tokenAlpha, { name: 'Surviving List' });
    assert.equal(step131.status, 201);
    const wSurviveId = step131.data.watchlist.id;
    manifest.resources.push({
      type: 'WATCHLIST',
      id: wSurviveId,
      identifier: 'Surviving List (W_SURVIVE)',
      ownerUserId: userAlphaId,
      lifecycleStatus: 'ACTIVE',
      stepCreated: 'Step 13.1',
    });
    writeManifestAtomic(manifest);

    // 13.2 Create W_DEL
    const step132 = await apiRequest('POST', '/api/watchlists', tokenAlpha, { name: 'Deletion Test List' });
    assert.equal(step132.status, 201);
    const wDelId = step132.data.watchlist.id;
    manifest.resources.push({
      type: 'WATCHLIST',
      id: wDelId,
      identifier: 'Deletion Test List (W_DEL)',
      ownerUserId: userAlphaId,
      lifecycleStatus: 'ACTIVE',
      stepCreated: 'Step 13.2',
    });
    writeManifestAtomic(manifest);

    // 13.3 Add Exclusive WANT_TO_WATCH (TMDB 990005) to W_DEL
    const step133 = await apiRequest('POST', `/api/watchlists/${wDelId}/items`, tokenAlpha, {
      tmdbId: 990005,
      mediaType: 'MOVIE',
      metadata: { title: 'Deletion Test Orphan' },
    });
    assert.equal(step133.status, 201);
    const umOrphanId = step133.data.item.userMediaId;
    const wliDelOrphanId = step133.data.item.id;
    manifest.resources.push({
      type: 'USER_MEDIA',
      id: umOrphanId,
      identifier: 'tmdb:990005:MOVIE (UM_ORPHAN)',
      ownerUserId: userAlphaId,
      lifecycleStatus: 'ACTIVE',
      stepCreated: 'Step 13.3',
    });
    manifest.resources.push({
      type: 'WATCHLIST_ITEM',
      id: wliDelOrphanId,
      identifier: 'UM_ORPHAN in W_DEL',
      ownerUserId: userAlphaId,
      watchlistId: wDelId,
      userMediaId: umOrphanId,
      lifecycleStatus: 'ACTIVE',
      stepCreated: 'Step 13.3',
    });
    writeManifestAtomic(manifest);

    // 13.4 Add Exclusive WATCHED (TMDB 990006) to W_DEL and mark WATCHED
    const step134a = await apiRequest('POST', `/api/watchlists/${wDelId}/items`, tokenAlpha, {
      tmdbId: 990006,
      mediaType: 'MOVIE',
      metadata: { title: 'Deletion Test Watched' },
    });
    assert.equal(step134a.status, 201);
    const umWatchedId = step134a.data.item.userMediaId;
    const wliDelWatchedId = step134a.data.item.id;
    const step134b = await apiRequest('POST', '/api/media/status', tokenAlpha, {
      tmdbId: 990006,
      mediaType: 'MOVIE',
      status: 'WATCHED',
      metadata: { title: 'Deletion Test Watched' },
    });
    assert.equal(step134b.status, 200);
    manifest.resources.push({
      type: 'USER_MEDIA',
      id: umWatchedId,
      identifier: 'tmdb:990006:MOVIE (UM_WATCHED)',
      ownerUserId: userAlphaId,
      lifecycleStatus: 'ACTIVE',
      stepCreated: 'Step 13.4',
    });
    manifest.resources.push({
      type: 'WATCHLIST_ITEM',
      id: wliDelWatchedId,
      identifier: 'UM_WATCHED in W_DEL',
      ownerUserId: userAlphaId,
      watchlistId: wDelId,
      userMediaId: umWatchedId,
      lifecycleStatus: 'ACTIVE',
      stepCreated: 'Step 13.4',
    });
    writeManifestAtomic(manifest);

    // 13.5 Add Shared Movie (TMDB 990007) to W_DEL and W_SURVIVE
    const step135a = await apiRequest('POST', `/api/watchlists/${wDelId}/items`, tokenAlpha, {
      tmdbId: 990007,
      mediaType: 'MOVIE',
      metadata: { title: 'Deletion Test Shared' },
    });
    assert.equal(step135a.status, 201);
    const umSharedId = step135a.data.item.userMediaId;
    const wliDelSharedId = step135a.data.item.id;

    const step135b = await apiRequest('POST', `/api/watchlists/${wSurviveId}/items`, tokenAlpha, {
      tmdbId: 990007,
      mediaType: 'MOVIE',
      metadata: { title: 'Deletion Test Shared' },
    });
    assert.equal(step135b.status, 201);
    const wliSurviveSharedId = step135b.data.item.id;
    assert.equal(step135b.data.item.userMediaId, umSharedId);

    manifest.resources.push({
      type: 'USER_MEDIA',
      id: umSharedId,
      identifier: 'tmdb:990007:MOVIE (UM_SHARED)',
      ownerUserId: userAlphaId,
      lifecycleStatus: 'ACTIVE',
      stepCreated: 'Step 13.5',
    });
    manifest.resources.push({
      type: 'WATCHLIST_ITEM',
      id: wliDelSharedId,
      identifier: 'UM_SHARED in W_DEL',
      ownerUserId: userAlphaId,
      watchlistId: wDelId,
      userMediaId: umSharedId,
      lifecycleStatus: 'ACTIVE',
      stepCreated: 'Step 13.5',
    });
    manifest.resources.push({
      type: 'WATCHLIST_ITEM',
      id: wliSurviveSharedId,
      identifier: 'UM_SHARED in W_SURVIVE',
      ownerUserId: userAlphaId,
      watchlistId: wSurviveId,
      userMediaId: umSharedId,
      lifecycleStatus: 'ACTIVE',
      stepCreated: 'Step 13.5',
    });
    writeManifestAtomic(manifest);

    // 13.6 DELETE W_DEL
    console.log('[Step 13.6] Deleting custom watchlist W_DEL...');
    const step136 = await apiRequest('DELETE', `/api/watchlists/${wDelId}`, tokenAlpha);
    assert.equal(step136.status, 200);

    // Update manifest for deleted resources
    manifest.resources.find((r) => r.id === wDelId)!.lifecycleStatus = 'DELETED';
    manifest.resources.find((r) => r.id === wDelId)!.stepDeleted = 'Step 13.6';

    manifest.resources.find((r) => r.id === umOrphanId)!.lifecycleStatus = 'DELETED';
    manifest.resources.find((r) => r.id === umOrphanId)!.stepDeleted = 'Step 13.6';

    manifest.resources.find((r) => r.id === wliDelOrphanId)!.lifecycleStatus = 'DELETED';
    manifest.resources.find((r) => r.id === wliDelOrphanId)!.stepDeleted = 'Step 13.6';

    manifest.resources.find((r) => r.id === wliDelWatchedId)!.lifecycleStatus = 'DELETED';
    manifest.resources.find((r) => r.id === wliDelWatchedId)!.stepDeleted = 'Step 13.6';

    manifest.resources.find((r) => r.id === wliDelSharedId)!.lifecycleStatus = 'DELETED';
    manifest.resources.find((r) => r.id === wliDelSharedId)!.stepDeleted = 'Step 13.6';
    writeManifestAtomic(manifest);

    // 13.7 Verify Database State
    const dbWDel = await testPrisma.watchlist.findUnique({ where: { id: wDelId } });
    assert.equal(dbWDel, null, 'W_DEL must be deleted');

    const dbWliDelCount = await testPrisma.watchlistItem.count({ where: { watchlistId: wDelId } });
    assert.equal(dbWliDelCount, 0, 'W_DEL items must be cascaded');

    const dbUmOrphan = await testPrisma.userMedia.findUnique({ where: { id: umOrphanId } });
    assert.equal(dbUmOrphan, null, 'Orphaned WANT_TO_WATCH (UM_ORPHAN) must be pruned from DB');

    const dbUmWatched = await testPrisma.userMedia.findUnique({ where: { id: umWatchedId } });
    assert.ok(dbUmWatched !== null, 'UM_WATCHED must remain in DB with 0 memberships');
    assert.equal(dbUmWatched.status, WatchlistStatus.WATCHED);

    const dbUmShared = await testPrisma.userMedia.findUnique({ where: { id: umSharedId } });
    assert.ok(dbUmShared !== null, 'UM_SHARED must remain in DB');

    const dbWliSurvive = await testPrisma.watchlistItem.findUnique({ where: { id: wliSurviveSharedId } });
    assert.ok(dbWliSurvive !== null, 'Membership in W_SURVIVE must remain intact');
    console.log('  ✔ Step 13 passed (W_DEL deleted, UM_ORPHAN pruned, UM_WATCHED preserved, UM_SHARED preserved in W_SURVIVE)');

    // Step 14: Default list delete protection
    console.log('[Step 14] Testing default list delete protection...');
    const step14 = await apiRequest('DELETE', `/api/watchlists/${defWlAlpha.id}`, tokenAlpha);
    assert.equal(step14.status, 400);
    assert.equal(step14.data.error, 'The default watchlist cannot be deleted');
    console.log('  ✔ Step 14 passed (400 default list cannot be deleted)');

    // Step 15: Watched history & pagination
    console.log('[Step 15] Verifying watched history and pagination...');
    const step15All = await apiRequest('GET', '/api/media/history', tokenAlpha);
    assert.equal(step15All.status, 200);
    assert.equal(step15All.data.pagination.totalCount, 3, 'Must contain exactly 3 WATCHED records (UM1, UM_DIRECT, UM_WATCHED)');
    assert.equal(step15All.data.history.length, 3);

    const step15Page1 = await apiRequest('GET', '/api/media/history?page=1&limit=2', tokenAlpha);
    assert.equal(step15Page1.status, 200);
    assert.equal(step15Page1.data.history.length, 2);
    assert.equal(step15Page1.data.pagination.page, 1);
    assert.equal(step15Page1.data.pagination.limit, 2);

    const step15Page2 = await apiRequest('GET', '/api/media/history?page=2&limit=2', tokenAlpha);
    assert.equal(step15Page2.status, 200);
    assert.equal(step15Page2.data.history.length, 1);
    assert.equal(step15Page2.data.pagination.page, 2);
    console.log('  ✔ Step 15 passed (watched history total=3, deterministic pagination verified)');

    // Step 16: Cross-user ownership isolation
    console.log('[Step 16] Verifying cross-user ownership isolation (User Beta vs User Alpha)...');
    const step16Lists = await apiRequest('GET', '/api/watchlists', tokenBeta);
    assert.equal(step16Lists.status, 200);
    assert.equal(step16Lists.data.watchlists.length, 1);
    assert.equal(step16Lists.data.watchlists[0].id, defWlBeta.id);

    // User Beta tries to add to User Alpha's list W1 -> 404
    const step16Add = await apiRequest('POST', `/api/watchlists/${w1Id}/items`, tokenBeta, {
      tmdbId: 990001,
      mediaType: 'MOVIE',
      metadata: { title: 'Hack attempt' },
    });
    assert.equal(step16Add.status, 404);
    assert.equal(step16Add.data.error, 'Watchlist not found');

    // User Beta tries to update User Alpha's media UM1 -> 404
    const step16Patch = await apiRequest('PATCH', `/api/media/${um1Id}/status`, tokenBeta, {
      status: 'WANT_TO_WATCH',
    });
    assert.equal(step16Patch.status, 404);
    assert.equal(step16Patch.data.error, 'Media record not found');

    // User Beta viewing history -> totalCount: 0
    const step16History = await apiRequest('GET', '/api/media/history', tokenBeta);
    assert.equal(step16History.status, 200);
    assert.equal(step16History.data.pagination.totalCount, 0);
    assert.equal(step16History.data.history.length, 0);
    console.log('  ✔ Step 16 passed (complete isolation: User Alpha resources return 404 for User Beta)');

    // Step 17: Complete Resource Accounting Reconciliation
    console.log('[Step 17] Reconciling complete 21-resource manifest against PostgreSQL database...');
    const activeResources = manifest.resources.filter((r) => r.lifecycleStatus === 'ACTIVE');
    const deletedResources = manifest.resources.filter((r) => r.lifecycleStatus === 'DELETED');
    assert.equal(manifest.resources.length, 21, 'Total manifest resources must be exactly 21');
    assert.equal(deletedResources.length, 9, 'Deleted resources must be exactly 9');
    assert.equal(activeResources.length, 12, 'Active resources must be exactly 12');

    // Verify DB row counts directly for userRoots:
    const dbUserCount = await testPrisma.user.count({ where: { id: { in: manifest.userRoots } } });
    assert.equal(dbUserCount, 2);

    const dbWlCount = await testPrisma.watchlist.count({ where: { userId: { in: manifest.userRoots } } });
    assert.equal(dbWlCount, 5, 'Must have 5 active watchlists in DB (W_DEF_A, W_DEF_B, W1, W2, W_SURVIVE)');

    const dbUmCount = await testPrisma.userMedia.count({ where: { userId: { in: manifest.userRoots } } });
    assert.equal(dbUmCount, 4, 'Must have 4 active user media in DB (UM1, UM_DIRECT, UM_WATCHED, UM_SHARED)');

    const dbWliCount = await testPrisma.watchlistItem.count({
      where: { watchlist: { userId: { in: manifest.userRoots } } },
    });
    assert.equal(dbWliCount, 1, 'Must have exactly 1 active watchlist item in DB (WLI_SURVIVE_SHARED)');

    manifest.runStatus = 'COMPLETED';
    writeManifestAtomic(manifest);
    console.log('  ✔ Step 17 passed (21 total resources: 9 DELETED, 12 ACTIVE verified in PostgreSQL)');

    console.log('\n================================================================');
    console.log('[E2E Phase 1] ALL SCENARIOS PASSED WITH ZERO REGRESSIONS!');
    console.log('================================================================\n');
  } finally {
    // 18. Stop Server
    if (server) {
      console.log('[E2E Phase 1] Stopping Express HTTP server...');
      await new Promise<void>((resolve) => {
        server!.close(() => resolve());
      });
      console.log('[E2E Phase 1] Express HTTP server stopped.');
    }

    // 19. Disconnect Prisma
    if (testPrisma) {
      console.log('[E2E Phase 1] Disconnecting test Prisma client...');
      await testPrisma.$disconnect();
    }

    // 20. Stop and remove Docker container
    console.log(`[E2E Phase 1] Stopping and removing disposable container "${CONTAINER_NAME}"...`);
    try {
      execSync(`docker rm -f ${CONTAINER_NAME}`, { stdio: 'pipe' });
      console.log(`[E2E Phase 1] Disposable container "${CONTAINER_NAME}" removed.`);
    } catch (e: any) {
      console.warn(`[E2E Phase 1] Warning removing container: ${e.message}`);
    }
  }

  return { manifest, manifestPath };
}

runE2EPhase1()
  .then(({ manifest, manifestPath }) => {
    console.log('\n================================================================');
    console.log(`[E2E Phase 1] SUCCESSFUL EXECUTION COMPLETE`);
    console.log(`Durable Manifest Path: ${manifestPath}`);
    console.log(`Run Status: ${manifest.runStatus}`);
    console.log(`Authoritative User Roots:`);
    manifest.userRoots.forEach((root) => console.log(`  - ${root}`));
    console.log('\nResource Breakdown:');
    console.log(`  Total Recorded: ${manifest.resources.length}`);
    console.log(`  Currently ACTIVE in DB: ${manifest.resources.filter((r) => r.lifecycleStatus === 'ACTIVE').length}`);
    console.log(`  DELETED during test steps: ${manifest.resources.filter((r) => r.lifecycleStatus === 'DELETED').length}`);
    console.log('================================================================\n');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n[E2E Phase 1 FATAL ERROR]:', err);
    process.exit(1);
  });
