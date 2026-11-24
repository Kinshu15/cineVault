/**
 * cineVault — Mobile Backend API Types
 *
 * Defines TypeScript interfaces and request/response shapes for
 * CineVault backend Watchlist and Media APIs.
 */

/**
 * Backend-supported media types.
 */
export type BackendMediaType = 'MOVIE' | 'TV';

/**
 * Flexible input type accepting both TMDB lowercase and backend uppercase.
 */
export type MediaInputType = 'movie' | 'tv' | 'MOVIE' | 'TV';

/**
 * Global user-tracking status.
 */
export type WatchlistStatus = 'WANT_TO_WATCH' | 'WATCHED';

/**
 * Metadata submitted when tracking a title from TMDB.
 */
export interface MediaMetadataInput {
  title: string;
  posterPath?: string | null;
  releaseDate?: string | null;
  voteAverage?: number | null;
  overview?: string | null;
}

/**
 * Standard pagination query parameters.
 */
export interface PaginationParams {
  page?: number;
  limit?: number;
}

/**
 * Standard pagination metadata returned by list endpoints.
 */
export interface PaginationMetadata {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
}

/**
 * Summary representation of a user watchlist.
 */
export interface WatchlistSummary {
  id: string;
  name: string;
  isDefault: boolean;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Minimal watchlist descriptor associated with an item or lookup.
 */
export interface WatchlistReference {
  id: string;
  name: string;
  isDefault: boolean;
}

/**
 * Watchlist membership detail returned in GET /api/watchlists/:id/items.
 * Note: 'id' is membership ID (WatchlistItem.id); 'userMediaId' is UserMedia.id.
 */
export interface WatchlistItemDetail {
  id: string;
  watchlistId: string;
  userMediaId: string;
  createdAt: string;
  userMedia: {
    id: string;
    tmdbId: number;
    mediaType: BackendMediaType;
    status: WatchlistStatus;
    title: string | null;
    posterPath: string | null;
    releaseDate: string | null;
    voteAverage: number | null;
    overview: string | null;
  };
}

/**
 * Response for GET /api/watchlists/:id/items.
 */
export interface WatchlistItemsResponse {
  watchlist: WatchlistReference;
  items: WatchlistItemDetail[];
  pagination: PaginationMetadata;
}

/**
 * Full UserMedia record representation.
 */
export interface UserMediaSummary {
  id: string;
  tmdbId: number;
  mediaType: BackendMediaType;
  status: WatchlistStatus;
  title: string | null;
  posterPath: string | null;
  releaseDate: string | null;
  voteAverage: number | null;
  overview: string | null;
  createdAt?: string;
  updatedAt?: string;
  watchlistCount?: number;
}

/**
 * Detailed media tracking information returned by GET /api/media/:mediaType/:tmdbId.
 */
export interface TrackedMediaDetail {
  id: string;
  tmdbId: number;
  mediaType: BackendMediaType;
  status: WatchlistStatus;
  title: string | null;
  posterPath: string | null;
  releaseDate: string | null;
  voteAverage: number | null;
  overview: string | null;
  watchlists: WatchlistReference[];
}

/**
 * Response for GET /api/media/:mediaType/:tmdbId.
 */
export interface MediaTrackingResponse {
  tracked: boolean;
  media: TrackedMediaDetail | null;
}

/**
 * Response for POST /api/watchlists/:id/items.
 */
export interface AddWatchlistItemResponse {
  item: {
    id: string;
    watchlistId: string;
    userMediaId: string;
    createdAt: string;
    userMedia: UserMediaSummary;
  };
}

/**
 * Response for DELETE /api/watchlists/:id/items/:userMediaId.
 */
export interface RemoveWatchlistItemResponse {
  message: string;
  userMedia: {
    id: string;
    status: WatchlistStatus;
    watchlistCount: number;
  } | null;
}

/**
 * Response for POST /api/media/status.
 * When status is 'WANT_TO_WATCH' and title is untracked, media is null.
 */
export interface UpsertMediaStatusResponse {
  media: UserMediaSummary | null;
  message?: string;
}

/**
 * Response for PATCH /api/media/:id/status.
 */
export interface UpdateMediaStatusResponse {
  media: UserMediaSummary;
}

/**
 * Response for GET /api/media/history.
 */
export interface WatchedHistoryResponse {
  history: UserMediaSummary[];
  pagination: PaginationMetadata;
}
