import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

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
 * Fetches authenticated user profile using cineVault JWT.
 * Endpoint: GET /api/auth/me
 */
export async function fetchCurrentUser(token: string): Promise<UserProfile> {
  const baseUrl = getApiBaseUrl();
  const res = await fetch(`${baseUrl}/api/auth/me`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const message = (data && data.error) || `Failed to fetch profile (HTTP ${res.status})`;
    throw new ApiError(message, res.status, data);
  }

  return data.user as UserProfile;
}
