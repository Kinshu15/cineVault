-- ==============================================================================
-- Add functional unique index on Watchlist (userId, LOWER(name))
-- Enforces case-insensitive watchlist name uniqueness per user at database level.
-- Prevents duplicate names such as "Anime", "anime", and "ANIME" for the same user.
-- ==============================================================================

BEGIN;

CREATE UNIQUE INDEX "Watchlist_userId_lower_name_key"
ON "Watchlist" ("userId", LOWER("name"));

COMMIT;
