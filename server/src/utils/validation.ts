import { MediaType, WatchlistStatus } from '@prisma/client';

export const RESERVED_DEFAULT_WATCHLIST_NAME = 'My Watchlist';
export const MAX_WATCHLIST_NAME_LENGTH = 100;

export interface ValidationSuccess<T> {
  isValid: true;
  value: T;
}

export interface ValidationFailure {
  isValid: false;
  error: string;
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

/**
 * Validates a watchlist name:
 * - Must be a string.
 * - Must not be empty or whitespace-only after trimming.
 * - Must not exceed 100 characters.
 */
export function validateWatchlistName(name: unknown): ValidationResult<string> {
  if (typeof name !== 'string') {
    return { isValid: false, error: 'Watchlist name must be a text string' };
  }

  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { isValid: false, error: 'Watchlist name cannot be empty or whitespace only' };
  }

  if (trimmed.length > MAX_WATCHLIST_NAME_LENGTH) {
    return {
      isValid: false,
      error: `Watchlist name cannot exceed ${MAX_WATCHLIST_NAME_LENGTH} characters (received ${trimmed.length})`,
    };
  }

  return { isValid: true, value: trimmed };
}

/**
 * Checks whether a name matches the reserved default watchlist name (case-insensitive).
 */
export function isReservedWatchlistName(name: string): boolean {
  return name.trim().toLowerCase() === RESERVED_DEFAULT_WATCHLIST_NAME.toLowerCase();
}

/**
 * Validates a custom watchlist name:
 * - Must pass general watchlist name validation.
 * - Must NOT match the reserved default name "My Watchlist" (case-insensitive).
 */
export function validateCustomWatchlistName(name: unknown): ValidationResult<string> {
  const baseResult = validateWatchlistName(name);
  if (!baseResult.isValid) {
    return baseResult;
  }

  if (isReservedWatchlistName(baseResult.value)) {
    return {
      isValid: false,
      error: `"${baseResult.value}" is a reserved system name. Custom watchlists cannot be named "${RESERVED_DEFAULT_WATCHLIST_NAME}".`,
    };
  }

  return baseResult;
}

/**
 * Validates a TMDB ID:
 * - Accepts positive integer numbers.
 * - Accepts digit-only numeric strings, trimming surrounding whitespace.
 * - Rejects zero and negative values.
 * - Reject decimals, including decimal strings.
 * - Reject strings containing signs ('+' or '-'), letters, or other non-digit characters.
 * - Reject NaN, Infinity, and non-finite values.
 * - Reject integers outside JavaScript safe integer range.
 * - Reject values exceeding PostgreSQL signed 32-bit INTEGER maximum (2,147,483,647).
 */
export function validateTmdbId(tmdbId: unknown): ValidationResult<number> {
  if (typeof tmdbId !== 'number' && typeof tmdbId !== 'string') {
    return { isValid: false, error: 'TMDB ID must be a valid number' };
  }

  if (typeof tmdbId === 'string' && !/^\d+$/.test(tmdbId.trim())) {
    return { isValid: false, error: 'TMDB ID must contain only digits' };
  }

  const num = Number(tmdbId);

  if (!Number.isSafeInteger(num) || num <= 0 || num > 2147483647) {
    return {
      isValid: false,
      error: 'TMDB ID must be a positive integer within the valid database range',
    };
  }

  return { isValid: true, value: num };
}

/**
 * Validates a MediaType value:
 * - Must match existing Prisma MediaType enum ('MOVIE' or 'TV').
 */
export function validateMediaType(mediaType: unknown): ValidationResult<MediaType> {
  if (typeof mediaType !== 'string') {
    return { isValid: false, error: 'Media type must be a string' };
  }

  const upper = mediaType.toUpperCase();
  if (upper === MediaType.MOVIE || upper === MediaType.TV) {
    return { isValid: true, value: upper as MediaType };
  }

  return {
    isValid: false,
    error: `Invalid media type "${mediaType}". Allowed values are: ${Object.values(MediaType).join(', ')}`,
  };
}

/**
 * Validates a WatchlistStatus value:
 * - Must match existing Prisma WatchlistStatus enum ('WANT_TO_WATCH' or 'WATCHED').
 */
export function validateWatchlistStatus(status: unknown): ValidationResult<WatchlistStatus> {
  if (typeof status !== 'string') {
    return { isValid: false, error: 'Watchlist status must be a string' };
  }

  const upper = status.toUpperCase();
  if (upper === WatchlistStatus.WANT_TO_WATCH || upper === WatchlistStatus.WATCHED) {
    return { isValid: true, value: upper as WatchlistStatus };
  }

  return {
    isValid: false,
    error: `Invalid status "${status}". Allowed values are: ${Object.values(WatchlistStatus).join(', ')}`,
  };
}

export interface MediaMetadata {
  title: string;
  releaseDate?: string;
  voteAverage?: number;
  posterPath?: string;
  overview?: string;
}

/**
 * Validates TMDB metadata snapshot attributes:
 * - title: Required non-empty string, trimmed, 1 <= length <= 255.
 * - releaseDate: Optional string matching YYYY-MM-DD, validated against real calendar days.
 * - voteAverage: Optional finite number, 0.0 <= voteAverage <= 10.0.
 * - posterPath: Optional string starting with '/', matching safe image extension, rejecting URLs, '..', and '.'.
 * - overview: Optional string, max 4000 characters. Rejects > 4000 with error (no silent truncation).
 */
export function validateMediaMetadata(input: unknown): ValidationResult<MediaMetadata> {
  if (!input || typeof input !== 'object') {
    return { isValid: false, error: 'Metadata must be an object' };
  }
  const body = input as Record<string, unknown>;

  // 1. Title validation
  if (typeof body.title !== 'string' || body.title.trim().length === 0) {
    return { isValid: false, error: 'Title is required and cannot be empty' };
  }
  const trimmedTitle = body.title.trim();
  if (trimmedTitle.length > 255) {
    return { isValid: false, error: 'Title cannot exceed 255 characters' };
  }

  // 2. Release date validation (Calendar Check)
  let releaseDate: string | undefined;
  if (body.releaseDate !== undefined && body.releaseDate !== null && body.releaseDate !== '') {
    if (typeof body.releaseDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.releaseDate.trim())) {
      return { isValid: false, error: 'Release date must be in YYYY-MM-DD format' };
    }
    const [year, month, day] = body.releaseDate.trim().split('-').map(Number);
    const parsedDate = new Date(Date.UTC(year, month - 1, day));
    if (
      parsedDate.getUTCFullYear() !== year ||
      parsedDate.getUTCMonth() !== month - 1 ||
      parsedDate.getUTCDate() !== day
    ) {
      return { isValid: false, error: 'Release date must be a valid calendar date' };
    }
    releaseDate = body.releaseDate.trim();
  }

  // 3. Vote average validation
  let voteAverage: number | undefined;
  if (body.voteAverage !== undefined && body.voteAverage !== null && body.voteAverage !== '') {
    if (typeof body.voteAverage !== 'number' || !Number.isFinite(body.voteAverage)) {
      return { isValid: false, error: 'Vote average must be a finite number' };
    }
    if (body.voteAverage < 0 || body.voteAverage > 10) {
      return { isValid: false, error: 'Vote average must be between 0.0 and 10.0' };
    }
    voteAverage = body.voteAverage;
  }

  // 4. Poster path validation (Strict Flat TMDB Format: /^\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/i)
  let posterPath: string | undefined;
  if (body.posterPath !== undefined && body.posterPath !== null && body.posterPath !== '') {
    if (typeof body.posterPath !== 'string') {
      return { isValid: false, error: 'Poster path must be a string' };
    }
    const trimmedPath = body.posterPath.trim();
    if (!/^\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/i.test(trimmedPath)) {
      return {
        isValid: false,
        error:
          'Poster path must be a flat relative path starting with "/" and a valid image extension (.jpg, .jpeg, .png, .webp)',
      };
    }
    posterPath = trimmedPath;
  }

  // 5. Overview validation (Strict non-truncating)
  let overview: string | undefined;
  if (body.overview !== undefined && body.overview !== null) {
    if (typeof body.overview !== 'string') {
      return { isValid: false, error: 'Overview must be a string' };
    }
    if (body.overview.length > 4000) {
      return { isValid: false, error: 'Overview cannot exceed 4000 characters' };
    }
    overview = body.overview;
  }

  return {
    isValid: true,
    value: { title: trimmedTitle, releaseDate, voteAverage, posterPath, overview },
  };
}

/**
 * Validates pagination query parameters:
 * - page: positive integer >= 1 (default 1)
 * - limit: positive integer between 1 and 100 (default 20, capped at 100)
 */
export function validatePagination(
  pageQuery: unknown,
  limitQuery: unknown
): ValidationResult<{ page: number; limit: number }> {
  let page = 1;
  let limit = 20;

  if (pageQuery !== undefined && pageQuery !== null && pageQuery !== '') {
    const parsedPage = Number(pageQuery);
    if (!Number.isSafeInteger(parsedPage) || parsedPage < 1) {
      return { isValid: false, error: 'Page must be a positive integer greater than or equal to 1' };
    }
    page = parsedPage;
  }

  if (limitQuery !== undefined && limitQuery !== null && limitQuery !== '') {
    const parsedLimit = Number(limitQuery);
    if (!Number.isSafeInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      return { isValid: false, error: 'Limit must be a positive integer between 1 and 100' };
    }
    limit = parsedLimit;
  }

  return { isValid: true, value: { page, limit } };
}

/**
 * Checks whether an error is a Prisma P2002 unique constraint violation
 * specifically on UserMedia's exact three-field composite key (userId, tmdbId, mediaType).
 * Does not classify targets containing additional, fewer, or unrelated fields as this constraint.
 */
export function isUserMediaCompositeP2002(error: unknown): boolean {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as any).code === 'P2002'
  ) {
    const rawTarget = (error as any).meta?.target;
    if (Array.isArray(rawTarget)) {
      if (rawTarget.length !== 3) {
        return false;
      }
      const set = new Set(rawTarget);
      return set.has('userId') && set.has('tmdbId') && set.has('mediaType');
    }
    if (typeof rawTarget === 'string') {
      return rawTarget === 'UserMedia_userId_tmdbId_mediaType_key';
    }
  }
  return false;
}
