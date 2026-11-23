import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateWatchlistName,
  validateCustomWatchlistName,
  isReservedWatchlistName,
  validateTmdbId,
  validateMediaType,
  validateWatchlistStatus,
  RESERVED_DEFAULT_WATCHLIST_NAME,
  MAX_WATCHLIST_NAME_LENGTH,
} from '../src/utils/validation';
import { MediaType, WatchlistStatus } from '@prisma/client';

describe('Validation Utilities (server/src/utils/validation.ts)', () => {
  describe('validateWatchlistName', () => {
    test('accepts valid watchlist names and trims whitespace', () => {
      const res1 = validateWatchlistName('Anime');
      assert.equal(res1.isValid, true);
      if (res1.isValid) assert.equal(res1.value, 'Anime');

      const res2 = validateWatchlistName('  Sci-Fi Classics  ');
      assert.equal(res2.isValid, true);
      if (res2.isValid) assert.equal(res2.value, 'Sci-Fi Classics');
    });

    test('accepts name of exactly 100 characters', () => {
      const name100 = 'a'.repeat(MAX_WATCHLIST_NAME_LENGTH);
      const res = validateWatchlistName(name100);
      assert.equal(res.isValid, true);
      if (res.isValid) assert.equal(res.value.length, 100);
    });

    test('rejects empty and whitespace-only names', () => {
      const resEmpty = validateWatchlistName('');
      assert.equal(resEmpty.isValid, false);

      const resWhitespace = validateWatchlistName('    ');
      assert.equal(resWhitespace.isValid, false);
      if (!resWhitespace.isValid) {
        assert.match(resWhitespace.error, /empty or whitespace/i);
      }
    });

    test('rejects non-string inputs', () => {
      assert.equal(validateWatchlistName(null).isValid, false);
      assert.equal(validateWatchlistName(undefined).isValid, false);
      assert.equal(validateWatchlistName(12345).isValid, false);
      assert.equal(validateWatchlistName({}).isValid, false);
    });

    test('rejects names exceeding 100 characters', () => {
      const name101 = 'a'.repeat(101);
      const res = validateWatchlistName(name101);
      assert.equal(res.isValid, false);
      if (!res.isValid) {
        assert.match(res.error, /cannot exceed 100 characters/i);
      }
    });
  });

  describe('isReservedWatchlistName & validateCustomWatchlistName', () => {
    test('correctly identifies case-insensitive reserved default name', () => {
      assert.equal(isReservedWatchlistName('My Watchlist'), true);
      assert.equal(isReservedWatchlistName('my watchlist'), true);
      assert.equal(isReservedWatchlistName('MY WATCHLIST'), true);
      assert.equal(isReservedWatchlistName('  My Watchlist  '), true);
      assert.equal(isReservedWatchlistName('mY wAtChLiSt'), true);

      assert.equal(isReservedWatchlistName('My Watchlist 2'), false);
      assert.equal(isReservedWatchlistName('Custom List'), false);
    });

    test('validateCustomWatchlistName rejects reserved default name', () => {
      const res1 = validateCustomWatchlistName('My Watchlist');
      assert.equal(res1.isValid, false);
      if (!res1.isValid) {
        assert.match(res1.error, /reserved system name/i);
      }

      const res2 = validateCustomWatchlistName('  my watchlist  ');
      assert.equal(res2.isValid, false);

      const res3 = validateCustomWatchlistName('MY WATCHLIST');
      assert.equal(res3.isValid, false);
    });

    test('validateCustomWatchlistName accepts valid custom names', () => {
      const res1 = validateCustomWatchlistName('Weekend Binge');
      assert.equal(res1.isValid, true);
      if (res1.isValid) assert.equal(res1.value, 'Weekend Binge');

      const res2 = validateCustomWatchlistName('Anime 2026');
      assert.equal(res2.isValid, true);
    });
  });

  describe('validateTmdbId', () => {
    test('accepts valid positive integers as number or numeric string', () => {
      const res1 = validateTmdbId(157336);
      assert.equal(res1.isValid, true);
      if (res1.isValid) assert.equal(res1.value, 157336);

      const res2 = validateTmdbId('157336');
      assert.equal(res2.isValid, true);
      if (res2.isValid) assert.equal(res2.value, 157336);

      const res3 = validateTmdbId(1);
      assert.equal(res3.isValid, true);
      if (res3.isValid) assert.equal(res3.value, 1);

      // Whitespace trimmed numeric string
      const res4 = validateTmdbId(' 157336 ');
      assert.equal(res4.isValid, true);
      if (res4.isValid) assert.equal(res4.value, 157336);

      // Max PostgreSQL 32-bit signed integer (2147483647)
      const res5 = validateTmdbId(2147483647);
      assert.equal(res5.isValid, true);
      if (res5.isValid) assert.equal(res5.value, 2147483647);

      const res6 = validateTmdbId('2147483647');
      assert.equal(res6.isValid, true);
      if (res6.isValid) assert.equal(res6.value, 2147483647);
    });

    test('rejects 0, negative numbers, and floats', () => {
      assert.equal(validateTmdbId(0).isValid, false);
      assert.equal(validateTmdbId(-5).isValid, false);
      assert.equal(validateTmdbId(3.14).isValid, false);
      assert.equal(validateTmdbId('0').isValid, false);
      assert.equal(validateTmdbId('-100').isValid, false);
      assert.equal(validateTmdbId('12.34').isValid, false);
      assert.equal(validateTmdbId('1.5').isValid, false);
      assert.equal(validateTmdbId('-5').isValid, false);
    });

    test('rejects signed strings, letters, and non-digit characters', () => {
      assert.equal(validateTmdbId('+5').isValid, false);
      assert.equal(validateTmdbId('+157336').isValid, false);
      assert.equal(validateTmdbId('abc').isValid, false);
      assert.equal(validateTmdbId('123a').isValid, false);
      assert.equal(validateTmdbId('a123').isValid, false);
      assert.equal(validateTmdbId('12 34').isValid, false);
    });

    test('rejects empty and whitespace-only inputs', () => {
      assert.equal(validateTmdbId('').isValid, false);
      assert.equal(validateTmdbId('   ').isValid, false);
    });

    test('rejects NaN, Infinity, and non-finite values', () => {
      assert.equal(validateTmdbId(NaN).isValid, false);
      assert.equal(validateTmdbId(Infinity).isValid, false);
      assert.equal(validateTmdbId(-Infinity).isValid, false);
    });

    test('rejects integers outside PostgreSQL 32-bit INTEGER and JS safe integer range', () => {
      // 1 beyond Postgres 32-bit signed int max
      assert.equal(validateTmdbId(2147483648).isValid, false);
      assert.equal(validateTmdbId('2147483648').isValid, false);

      // JS safe integer boundary
      assert.equal(validateTmdbId(Number.MAX_SAFE_INTEGER + 1).isValid, false);
      assert.equal(validateTmdbId('9007199254740992').isValid, false);
    });

    test('rejects non-numeric object and primitive inputs', () => {
      assert.equal(validateTmdbId(null).isValid, false);
      assert.equal(validateTmdbId(undefined).isValid, false);
      assert.equal(validateTmdbId({}).isValid, false);
      assert.equal(validateTmdbId([]).isValid, false);
      assert.equal(validateTmdbId(true).isValid, false);
    });
  });

  describe('validateMediaType', () => {
    test('accepts valid MOVIE and TV values (case-insensitive)', () => {
      const res1 = validateMediaType('MOVIE');
      assert.equal(res1.isValid, true);
      if (res1.isValid) assert.equal(res1.value, MediaType.MOVIE);

      const res2 = validateMediaType('movie');
      assert.equal(res2.isValid, true);
      if (res2.isValid) assert.equal(res2.value, MediaType.MOVIE);

      const res3 = validateMediaType('TV');
      assert.equal(res3.isValid, true);
      if (res3.isValid) assert.equal(res3.value, MediaType.TV);

      const res4 = validateMediaType('tv');
      assert.equal(res4.isValid, true);
      if (res4.isValid) assert.equal(res4.value, MediaType.TV);
    });

    test('rejects invalid media types', () => {
      assert.equal(validateMediaType('ANIME').isValid, false);
      assert.equal(validateMediaType('SERIES').isValid, false);
      assert.equal(validateMediaType('FILM').isValid, false);
      assert.equal(validateMediaType('').isValid, false);
      assert.equal(validateMediaType(null).isValid, false);
      assert.equal(validateMediaType(123).isValid, false);
    });
  });

  describe('validateWatchlistStatus', () => {
    test('accepts valid WANT_TO_WATCH and WATCHED values (case-insensitive)', () => {
      const res1 = validateWatchlistStatus('WANT_TO_WATCH');
      assert.equal(res1.isValid, true);
      if (res1.isValid) assert.equal(res1.value, WatchlistStatus.WANT_TO_WATCH);

      const res2 = validateWatchlistStatus('want_to_watch');
      assert.equal(res2.isValid, true);
      if (res2.isValid) assert.equal(res2.value, WatchlistStatus.WANT_TO_WATCH);

      const res3 = validateWatchlistStatus('WATCHED');
      assert.equal(res3.isValid, true);
      if (res3.isValid) assert.equal(res3.value, WatchlistStatus.WATCHED);

      const res4 = validateWatchlistStatus('watched');
      assert.equal(res4.isValid, true);
      if (res4.isValid) assert.equal(res4.value, WatchlistStatus.WATCHED);
    });

    test('rejects invalid statuses', () => {
      assert.equal(validateWatchlistStatus('PENDING').isValid, false);
      assert.equal(validateWatchlistStatus('DROPPED').isValid, false);
      assert.equal(validateWatchlistStatus('IN_PROGRESS').isValid, false);
      assert.equal(validateWatchlistStatus('').isValid, false);
      assert.equal(validateWatchlistStatus(null).isValid, false);
    });
  });
});
