-- ==============================================================================
-- Phase 2: Personal Watchlist and Viewing History Migration
-- ==============================================================================

BEGIN;

-- Step 1: Temporarily rename legacy WatchlistItem table to preserve all existing data
ALTER TABLE "WatchlistItem" RENAME TO "LegacyWatchlistItem";
ALTER TABLE "LegacyWatchlistItem" RENAME CONSTRAINT "WatchlistItem_pkey" TO "LegacyWatchlistItem_pkey";

-- Step 2: Create the Watchlist table
CREATE TABLE "Watchlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Watchlist_pkey" PRIMARY KEY ("id")
);

-- Step 3: Partial unique index — enforces exactly one default list per user at DB level
CREATE UNIQUE INDEX "one_default_watchlist_per_user" 
ON "Watchlist"("userId") 
WHERE "isDefault" = true;

CREATE UNIQUE INDEX "Watchlist_userId_name_key" 
ON "Watchlist"("userId", "name");

CREATE INDEX "Watchlist_userId_idx" 
ON "Watchlist"("userId");

ALTER TABLE "Watchlist" 
ADD CONSTRAINT "Watchlist_userId_fkey" 
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 4: Backfill default "My Watchlist" for all existing users
INSERT INTO "Watchlist" ("id", "userId", "name", "isDefault", "createdAt", "updatedAt")
SELECT 'wl_' || replace(gen_random_uuid()::text, '-', ''), "id", 'My Watchlist', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User"
ON CONFLICT ("userId") WHERE "isDefault" = true DO NOTHING;

-- Step 5: Create UserMedia table (title is nullable for clean legacy migration)
CREATE TABLE "UserMedia" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tmdbId" INTEGER NOT NULL,
    "mediaType" "MediaType" NOT NULL,
    "status" "WatchlistStatus" NOT NULL DEFAULT 'WANT_TO_WATCH',
    "title" TEXT,
    "posterPath" TEXT,
    "releaseDate" TEXT,
    "voteAverage" DOUBLE PRECISION,
    "overview" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserMedia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserMedia_userId_tmdbId_mediaType_key" 
ON "UserMedia"("userId", "tmdbId", "mediaType");

CREATE INDEX "UserMedia_userId_status_idx" 
ON "UserMedia"("userId", "status");

CREATE INDEX "UserMedia_userId_idx" 
ON "UserMedia"("userId");

ALTER TABLE "UserMedia" 
ADD CONSTRAINT "UserMedia_userId_fkey" 
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 6: Migrate legacy data from LegacyWatchlistItem into UserMedia
-- (Both WANT_TO_WATCH and WATCHED records populate UserMedia; title is set to NULL without artificial placeholders)
INSERT INTO "UserMedia" ("id", "userId", "tmdbId", "mediaType", "status", "title", "createdAt", "updatedAt")
SELECT 'um_' || replace(gen_random_uuid()::text, '-', ''), "userId", "tmdbId", "mediaType", "status", NULL, "createdAt", "updatedAt"
FROM "LegacyWatchlistItem"
ON CONFLICT ("userId", "tmdbId", "mediaType") DO NOTHING;

-- Step 7: Create the new WatchlistItem join table
CREATE TABLE "WatchlistItem" (
    "id" TEXT NOT NULL,
    "watchlistId" TEXT NOT NULL,
    "userMediaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchlistItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WatchlistItem_watchlistId_userMediaId_key" 
ON "WatchlistItem"("watchlistId", "userMediaId");

CREATE INDEX "WatchlistItem_watchlistId_idx" 
ON "WatchlistItem"("watchlistId");

CREATE INDEX "WatchlistItem_userMediaId_idx" 
ON "WatchlistItem"("userMediaId");

ALTER TABLE "WatchlistItem" 
ADD CONSTRAINT "WatchlistItem_watchlistId_fkey" 
FOREIGN KEY ("watchlistId") REFERENCES "Watchlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WatchlistItem" 
ADD CONSTRAINT "WatchlistItem_userMediaId_fkey" 
FOREIGN KEY ("userMediaId") REFERENCES "UserMedia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 8: Populate new WatchlistItem join records ONLY for WANT_TO_WATCH items.
-- WATCHED records are intentionally excluded so they remain in viewing history
-- without appearing in the default "My Watchlist".
INSERT INTO "WatchlistItem" ("id", "watchlistId", "userMediaId", "createdAt")
SELECT 
    'wli_' || replace(gen_random_uuid()::text, '-', ''),
    w."id",
    um."id",
    l."createdAt"
FROM "LegacyWatchlistItem" l
JOIN "Watchlist" w ON w."userId" = l."userId" AND w."isDefault" = true
JOIN "UserMedia" um ON um."userId" = l."userId" AND um."tmdbId" = l."tmdbId" AND um."mediaType" = l."mediaType"
WHERE l."status" = 'WANT_TO_WATCH'
ON CONFLICT ("watchlistId", "userMediaId") DO NOTHING;

-- Step 9: Drop legacy table
DROP TABLE "LegacyWatchlistItem";

COMMIT;
