import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {
  BackendMediaType,
  MediaInputType,
  WatchlistStatus,
  MediaMetadataInput,
  PaginationParams,
  PaginationMetadata,
  WatchlistSummary,
  WatchlistsResponse,
  WatchlistReference,
  WatchlistItemDetail,
  WatchlistItemsResponse,
  UserMediaSummary,
  TrackedMediaDetail,
  MediaTrackingResponse,
  AddWatchlistItemResponse,
  RemoveWatchlistItemResponse,
  UpsertMediaStatusResponse,
  UpdateMediaStatusResponse,
  WatchedHistoryResponse,
} from '../../types/api';

export * from '../../types/api';

const SECURE_STORE_TOKEN_KEY = 'cinevault_jwt_token';

export interface UserProfile {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthResponse {
  token: string;
  user: UserProfile;
}

export class ApiError extends Error {
  status: number;
  data?: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/**
 * Resolves the backend base URL:
 * - Uses EXPO_PUBLIC_API_URL if configured.
 * - On Android emulator, falls back to http://10.0.2.2:5001.
 * - On iOS simulator or web, falls back to http://localhost:5001.
 * Note: Physical Android/iOS devices require EXPO_PUBLIC_API_URL set to your machine's LAN IP.
 */
export const getApiBaseUrl = (): string => {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL.replace(/\/+$/, '');
  }
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:5001';
  }
  return 'http://localhost:5001';
};

// SecureStore JWT Storage Operations
export async function getStoredToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(SECURE_STORE_TOKEN_KEY);
  } catch (error) {
    console.warn('[SecureStore] Failed to read token:', error);
    return null;
  }
}

export async function storeToken(token: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(SECURE_STORE_TOKEN_KEY, token);
  } catch (error) {
    console.error('[SecureStore] Failed to store token:', error);
    throw error;
  }
}

export async function clearStoredToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(SECURE_STORE_TOKEN_KEY);
  } catch (error) {
    console.warn('[SecureStore] Failed to clear token:', error);
  }
}

/**
 * Exchanges verified Google ID Token for cineVault JWT session.
 * Endpoint: POST /api/auth/google
 */
export async function postGoogleLogin(idToken: string): Promise<AuthResponse> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/api/auth/google`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ idToken }),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const message = (data && data.error) || `Authentication failed (HTTP ${res.status})`;
    throw new ApiError(message, res.status, data);
  }

  return data as AuthResponse;
}

/**
 * Reusable internal helper for authenticated API requests.
 *
 * Token semantics:
 * - If token === undefined (omitted), retrieves token from SecureStore.
 * - If typeof token === 'string', uses the token directly.
 * - If token === null, treats the request as unauthenticated (does not call SecureStore or set header).
 */
export async function authenticatedRequest<T>(
  endpoint: string,
  options: RequestInit = {},
  token?: string | null
): Promise<T> {
  let resolvedToken: string | null = null;
  if (token === undefined) {
    resolvedToken = await getStoredToken();
  } else if (typeof token === 'string') {
    resolvedToken = token;
  } else {
    // Explicit null token -> unauthenticated request
    resolvedToken = null;
  }

  const baseUrl = getApiBaseUrl();
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = `${baseUrl}${cleanEndpoint}`;

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (resolvedToken) {
    headers['Authorization'] = `Bearer ${resolvedToken}`;
  }

  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const message = (data && data.error) || `Request failed (HTTP ${res.status})`;
    throw new ApiError(message, res.status, data);
  }

  return data as T;
}

/**
 * Fetches authenticated user profile using cineVault JWT.
 * Endpoint: GET /api/auth/me
 */
export async function fetchCurrentUser(token: string): Promise<UserProfile> {
  const data = await authenticatedRequest<{ user: UserProfile }>(
    '/api/auth/me',
    { method: 'GET' },
    token
  );
  return data.user;
}

// =============================================================================
// Watchlist API Methods
// =============================================================================

/**
 * 1. Retrieves all watchlists for the authenticated user and distinct saved title count.
 * Endpoint: GET /api/watchlists
 */
export async function getWatchlists(token?: string | null): Promise<WatchlistsResponse> {
  return await authenticatedRequest<WatchlistsResponse>(
    '/api/watchlists',
    { method: 'GET' },
    token
  );
}

/**
 * 2. Creates a new custom watchlist.
 * Endpoint: POST /api/watchlists
 */
export async function createWatchlist(
  name: string,
  token?: string | null
): Promise<WatchlistSummary> {
  const data = await authenticatedRequest<{ watchlist: WatchlistSummary }>(
    '/api/watchlists',
    {
      method: 'POST',
      body: JSON.stringify({ name }),
    },
    token
  );
  return data.watchlist;
}

/**
 * 3. Renames an existing custom watchlist.
 * Endpoint: PATCH /api/watchlists/:id
 */
export async function renameWatchlist(
  id: string,
  name: string,
  token?: string | null
): Promise<WatchlistSummary> {
  const data = await authenticatedRequest<{ watchlist: WatchlistSummary }>(
    `/api/watchlists/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    },
    token
  );
  return data.watchlist;
}

/**
 * 4. Deletes an existing custom watchlist.
 * Endpoint: DELETE /api/watchlists/:id
 */
export async function deleteWatchlist(
  id: string,
  token?: string | null
): Promise<{ message: string }> {
  return await authenticatedRequest<{ message: string }>(
    `/api/watchlists/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
    token
  );
}

/**
 * 5. Retrieves paginated media items inside a watchlist.
 * Endpoint: GET /api/watchlists/:id/items
 */
export async function getWatchlistItems(
  watchlistId: string,
  pagination?: PaginationParams,
  token?: string | null
): Promise<WatchlistItemsResponse> {
  const params = new URLSearchParams();
  if (pagination?.page !== undefined) {
    params.set('page', String(pagination.page));
  }
  if (pagination?.limit !== undefined) {
    params.set('limit', String(pagination.limit));
  }
  const queryString = params.toString() ? `?${params.toString()}` : '';

  return await authenticatedRequest<WatchlistItemsResponse>(
    `/api/watchlists/${encodeURIComponent(watchlistId)}/items${queryString}`,
    { method: 'GET' },
    token
  );
}

/**
 * 6. Adds a media title to a watchlist.
 * Endpoint: POST /api/watchlists/:id/items
 */
export async function addWatchlistItem(
  watchlistId: string,
  payload: {
    tmdbId: number;
    mediaType: MediaInputType;
    metadata: MediaMetadataInput;
  },
  token?: string | null
): Promise<AddWatchlistItemResponse> {
  const normalizedMediaType: BackendMediaType = payload.mediaType.toUpperCase() as BackendMediaType;

  return await authenticatedRequest<AddWatchlistItemResponse>(
    `/api/watchlists/${encodeURIComponent(watchlistId)}/items`,
    {
      method: 'POST',
      body: JSON.stringify({
        tmdbId: payload.tmdbId,
        mediaType: normalizedMediaType,
        metadata: payload.metadata,
      }),
    },
    token
  );
}

/**
 * 7. Removes a media title from a watchlist using its UserMedia ID.
 * Endpoint: DELETE /api/watchlists/:id/items/:userMediaId
 */
export async function removeWatchlistItem(
  watchlistId: string,
  userMediaId: string,
  token?: string | null
): Promise<RemoveWatchlistItemResponse> {
  return await authenticatedRequest<RemoveWatchlistItemResponse>(
    `/api/watchlists/${encodeURIComponent(watchlistId)}/items/${encodeURIComponent(userMediaId)}`,
    { method: 'DELETE' },
    token
  );
}

// =============================================================================
// Media Tracking & History API Methods
// =============================================================================

/**
 * 8. Retrieves tracking status and watchlist memberships for a TMDB title.
 * Endpoint: GET /api/media/:mediaType/:tmdbId
 */
export async function getMediaTrackingStatus(
  mediaType: MediaInputType,
  tmdbId: number,
  token?: string | null
): Promise<MediaTrackingResponse> {
  const normalizedMediaType = mediaType.toUpperCase();

  return await authenticatedRequest<MediaTrackingResponse>(
    `/api/media/${encodeURIComponent(normalizedMediaType)}/${encodeURIComponent(tmdbId)}`,
    { method: 'GET' },
    token
  );
}

/**
 * 9. Upserts media status (e.g., mark as WATCHED from details screen).
 * Endpoint: POST /api/media/status
 * Note: If title is untracked and status is WANT_TO_WATCH, response media is null.
 */
export async function upsertMediaStatus(
  payload: {
    tmdbId: number;
    mediaType: MediaInputType;
    status: WatchlistStatus;
    metadata: MediaMetadataInput;
  },
  token?: string | null
): Promise<UpsertMediaStatusResponse> {
  const normalizedMediaType: BackendMediaType = payload.mediaType.toUpperCase() as BackendMediaType;

  return await authenticatedRequest<UpsertMediaStatusResponse>(
    '/api/media/status',
    {
      method: 'POST',
      body: JSON.stringify({
        tmdbId: payload.tmdbId,
        mediaType: normalizedMediaType,
        status: payload.status,
        metadata: payload.metadata,
      }),
    },
    token
  );
}

/**
 * 10. Updates media status by UserMedia ID.
 * Endpoint: PATCH /api/media/:id/status
 */
export async function updateMediaStatusById(
  userMediaId: string,
  status: WatchlistStatus,
  token?: string | null
): Promise<UpdateMediaStatusResponse> {
  return await authenticatedRequest<UpdateMediaStatusResponse>(
    `/api/media/${encodeURIComponent(userMediaId)}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    },
    token
  );
}

/**
 * 11. Retrieves paginated watched viewing history.
 * Endpoint: GET /api/media/history
 */
export async function getWatchedHistory(
  pagination?: PaginationParams,
  token?: string | null
): Promise<WatchedHistoryResponse> {
  const params = new URLSearchParams();
  if (pagination?.page !== undefined) {
    params.set('page', String(pagination.page));
  }
  if (pagination?.limit !== undefined) {
    params.set('limit', String(pagination.limit));
  }
  const queryString = params.toString() ? `?${params.toString()}` : '';

  return await authenticatedRequest<WatchedHistoryResponse>(
    `/api/media/history${queryString}`,
    { method: 'GET' },
    token
  );
}
