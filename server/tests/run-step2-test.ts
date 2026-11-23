import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const testDbUrl = 'postgresql://postgres:postgres@localhost:5433/cinevault_test?schema=public';

async function main() {
  console.log('================================================================');
  console.log('cineVault Step 2.0: Functional Unique Index Migration Test Suite');
  console.log('================================================================\n');

  // Step A: Apply migrations up to Phase 2 (without the new functional index first)
  console.log('Step A: Applying initial Phase 1 and Phase 2 migrations...');

  const migrationsDir = path.resolve(__dirname, '../prisma/migrations');
  const initSql = fs.readFileSync(path.join(migrationsDir, '20261122142624_init/migration.sql'), 'utf-8');
  const googleIdSql = fs.readFileSync(path.join(migrationsDir, '20261122150330_add_google_id/migration.sql'), 'utf-8');
  const phase2Sql = fs.readFileSync(path.join(migrationsDir, '20261123140000_phase2_watchlist_and_viewing_history/migration.sql'), 'utf-8');
  const newIndexSql = fs.readFileSync(path.join(migrationsDir, '20261123180000_add_case_insensitive_watchlist_name_unique_index/migration.sql'), 'utf-8');

  // Use docker exec to run psql directly on the container
  function runSqlInDocker(sql: string) {
    execSync(`docker exec -i cinevault-test-pg psql -U postgres -d cinevault_test`, {
      input: sql,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  // Reset database schema cleanly
  runSqlInDocker('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');

  // Apply Phase 1 & Phase 2
  runSqlInDocker(initSql);
  runSqlInDocker(googleIdSql);
  runSqlInDocker(phase2Sql);
  console.log('✔ Phase 1 and Phase 2 migrations applied successfully.');

  const prisma = new PrismaClient({
    datasources: { db: { url: testDbUrl } },
  });

  try {
    // Get PostgreSQL version
    const versionResult = await prisma.$queryRaw<Array<{ version: string }>>`SELECT version();`;
    console.log('\nPostgreSQL Version:');
    console.log(versionResult[0]?.version);

    // Seed representative data to test pre-flight check
    console.log('\n--- Step B: Seeding data before index creation ---');
    const seedUser = await prisma.user.create({
      data: {
        email: 'alice@example.com',
        displayName: 'Alice',
        watchlists: {
          create: [
            { name: 'My Watchlist', isDefault: true },
            { name: 'Sci-Fi', isDefault: false },
            { name: 'Documentaries', isDefault: false },
          ],
        },
      },
    });
    console.log(`Seeded user ${seedUser.id} with watchlists: "My Watchlist", "Sci-Fi", "Documentaries"`);

    // Step B: Run Pre-Flight Collision Detection Query
    console.log('\n--- Step C: Pre-Flight Collision Detection Query ---');
    const collisionQuery = `
      SELECT
        "userId",
        LOWER("name") AS "normalizedName",
        COUNT(*) AS "occurrenceCount",
        ARRAY_AGG("id") AS "conflictingWatchlistIds",
        ARRAY_AGG("name") AS "conflictingNames"
      FROM "Watchlist"
      GROUP BY "userId", LOWER("name")
      HAVING COUNT(*) > 1;
    `;
    const collisions = await prisma.$queryRawUnsafe<any[]>(collisionQuery);
    console.log('Collision Detection Query output:', JSON.stringify(collisions, null, 2));
    assert.equal(collisions.length, 0, 'Must have 0 collisions before creating index');
    console.log('✔ Pre-flight collision check passed: 0 collisions found.');

    // Step D: Apply the dedicated functional unique index migration
    console.log('\n--- Step D: Applying Migration 20261124000000_add_case_insensitive_watchlist_name_unique_index ---');
    runSqlInDocker(newIndexSql);
    console.log('✔ Functional unique index created successfully.');

    // Verify index existence in pg_indexes
    const indexCheck = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef FROM pg_indexes 
      WHERE tablename = 'Watchlist' AND indexname = 'Watchlist_userId_lower_name_key';
    `;
    console.log('Index in pg_indexes:', indexCheck);
    assert.equal(indexCheck.length, 1, 'Functional index must exist in pg_indexes');
    assert.match(indexCheck[0].indexdef, /lower\(\(?name\)?\)/i, 'Index definition must index lower(name)');
    console.log('✔ Index verified in pg_indexes:', indexCheck[0].indexdef);

    // Step E: Run all 8 required test cases
    console.log('\n================================================================');
    console.log('Running All 8 Functional Unique Index Test Cases via Prisma Client');
    console.log('================================================================\n');

    // Create 2 test users for the test suite
    const userA = await prisma.user.create({
      data: {
        email: 'userA@example.com',
        displayName: 'User A',
        watchlists: {
          create: { name: 'My Watchlist', isDefault: true },
        },
      },
    });

    const userB = await prisma.user.create({
      data: {
        email: 'userB@example.com',
        displayName: 'User B',
        watchlists: {
          create: { name: 'My Watchlist', isDefault: true },
        },
      },
    });

    // Test 1: Two different users can each create a watchlist named Anime
    console.log('--- Test 1: Cross-user identical name support ---');
    const wlA_Anime = await prisma.watchlist.create({
      data: { userId: userA.id, name: 'Anime', isDefault: false },
    });
    const wlB_Anime = await prisma.watchlist.create({
      data: { userId: userB.id, name: 'Anime', isDefault: false },
    });
    assert.ok(wlA_Anime.id && wlB_Anime.id);
    console.log(`✔ User A list created (id: ${wlA_Anime.id}) and User B list created (id: ${wlB_Anime.id})`);

    // Test 2: One user can create Anime, but cannot create anime
    console.log('\n--- Test 2: Reject lowercase variant (anime) for same user ---');
    let errCase2: any = null;
    try {
      await prisma.watchlist.create({
        data: { userId: userA.id, name: 'anime', isDefault: false },
      });
    } catch (err: any) {
      errCase2 = err;
    }
    assert.ok(errCase2, 'Must fail to create "anime"');
    assert.equal(errCase2.code, 'P2002');
    console.log('Observed Prisma Error Code:', errCase2.code);
    console.log('Observed Prisma Error Meta:', JSON.stringify(errCase2.meta));
    console.log('✔ Test 2 Passed: Rejected "anime" with P2002.');

    // Test 3: One user cannot create ANIME after creating Anime
    console.log('\n--- Test 3: Reject uppercase variant (ANIME) for same user ---');
    let errCase3: any = null;
    try {
      await prisma.watchlist.create({
        data: { userId: userA.id, name: 'ANIME', isDefault: false },
      });
    } catch (err: any) {
      errCase3 = err;
    }
    assert.ok(errCase3, 'Must fail to create "ANIME"');
    assert.equal(errCase3.code, 'P2002');
    console.log('Observed Prisma Error Code:', errCase3.code);
    console.log('Observed Prisma Error Meta:', JSON.stringify(errCase3.meta));
    console.log('✔ Test 3 Passed: Rejected "ANIME" with P2002.');

    // Test 4: Renaming a watchlist to a case-variant of another existing list fails
    console.log('\n--- Test 4: Renaming a watchlist to a case-variant of another existing list fails ---');
    const wlA_Action = await prisma.watchlist.create({
      data: { userId: userA.id, name: 'Action', isDefault: false },
    });
    let errCase4: any = null;
    try {
      await prisma.watchlist.update({
        where: { id: wlA_Action.id },
        data: { name: 'aNiMe' },
      });
    } catch (err: any) {
      errCase4 = err;
    }
    assert.ok(errCase4, 'Renaming "Action" to "aNiMe" must fail');
    assert.equal(errCase4.code, 'P2002');
    console.log('Observed Prisma Error Code:', errCase4.code);
    console.log('Observed Prisma Error Meta:', JSON.stringify(errCase4.meta));
    console.log('✔ Test 4 Passed: Renaming "Action" to "aNiMe" rejected with P2002.');

    // Test 5: Two concurrent inserts for the same user using Anime and anime cannot both succeed
    console.log('\n--- Test 5: Concurrent inserts (Anime vs anime) for same user ---');
    const userC = await prisma.user.create({
      data: {
        email: 'userC@example.com',
        displayName: 'User C',
      },
    });

    const concurrentResults = await Promise.allSettled([
      prisma.watchlist.create({
        data: { userId: userC.id, name: 'Anime', isDefault: false },
      }),
      prisma.watchlist.create({
        data: { userId: userC.id, name: 'anime', isDefault: false },
      }),
    ]);

    const fulfilled = concurrentResults.filter((r) => r.status === 'fulfilled');
    const rejected = concurrentResults.filter((r) => r.status === 'rejected');

    console.log(`Concurrent results: ${fulfilled.length} succeeded, ${rejected.length} failed`);
    assert.equal(fulfilled.length, 1, 'Exactly one concurrent creation must succeed');
    assert.equal(rejected.length, 1, 'Exactly one concurrent creation must fail');

    const concurrentErr = (rejected[0] as PromiseRejectedResult).reason;
    assert.equal(concurrentErr.code, 'P2002');
    console.log('Concurrent Failed Error Code:', concurrentErr.code);
    console.log('Concurrent Failed Error Meta:', JSON.stringify(concurrentErr.meta));
    console.log('✔ Test 5 Passed: Exactly 1 concurrent insert succeeded, exactly 1 failed with P2002.');

    // Test 6: The existing case-sensitive unique constraint continues working
    console.log('\n--- Test 6: Exact match duplicate fails ---');
    let errCase6: any = null;
    try {
      await prisma.watchlist.create({
        data: { userId: userA.id, name: 'Anime', isDefault: false },
      });
    } catch (err: any) {
      errCase6 = err;
    }
    assert.ok(errCase6, 'Exact duplicate must fail');
    assert.equal(errCase6.code, 'P2002');
    console.log('Exact Match Error Code:', errCase6.code);
    console.log('Exact Match Error Meta:', JSON.stringify(errCase6.meta));
    console.log('✔ Test 6 Passed: Exact match failed with P2002.');

    // Test 7: The partial unique index for one default watchlist per user remains unaffected
    console.log('\n--- Test 7: Partial unique index (one default watchlist per user) unaffected ---');
    let errCase7: any = null;
    try {
      await prisma.watchlist.create({
        data: { userId: userA.id, name: 'Second Default List', isDefault: true },
      });
    } catch (err: any) {
      errCase7 = err;
    }
    assert.ok(errCase7, 'Second default watchlist must fail');
    assert.equal(errCase7.code, 'P2002');
    console.log('Second Default List Error Code:', errCase7.code);
    console.log('Second Default List Error Meta:', JSON.stringify(errCase7.meta));
    console.log('✔ Test 7 Passed: Second default list rejected by partial unique index.');

    // Test 8: Normal distinct names such as Anime and Action can coexist for one user
    console.log('\n--- Test 8: Normal distinct names can coexist for one user ---');
    const userALists = await prisma.watchlist.findMany({
      where: { userId: userA.id },
      select: { name: true, isDefault: true },
    });
    console.log('User A watchlists:', userALists.map((l) => `${l.name} (isDefault: ${l.isDefault})`));
    const names = userALists.map((l) => l.name);
    assert.ok(names.includes('Anime'), 'User A has Anime');
    assert.ok(names.includes('Action'), 'User A has Action');
    console.log('✔ Test 8 Passed: Both "Anime" and "Action" coexist for User A.');

    console.log('\n================================================================');
    console.log('ALL TESTS COMPLETED AND VERIFIED SUCCESSFULLY!');
    console.log('================================================================\n');

  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
