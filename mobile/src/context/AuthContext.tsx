import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import {
  GoogleSignin,
  isCancelledResponse,
  isSuccessResponse,
  isErrorWithCode,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import {
  UserProfile,
  ApiError,
  getStoredToken,
  storeToken,
  clearStoredToken,
  postGoogleLogin,
  fetchCurrentUser,
} from '../services/api';

export interface AuthContextType {
  user: UserProfile | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticating: boolean;
  error: string | null;
  signIn: () => Promise<boolean>;
  signOut: () => Promise<void>;
  retrySessionRestore: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function getGoogleWebClientId(): string | undefined {
  const id = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  return id && id.trim().length > 0 ? id.trim() : undefined;
}

let isGoogleConfigured = false;

function ensureGoogleSignInConfigured(): boolean {
  const webClientId = getGoogleWebClientId();
  if (!webClientId) {
    return false;
  }
  if (!isGoogleConfigured) {
    GoogleSignin.configure({
      webClientId,
      offlineAccess: false,
    });
    isGoogleConfigured = true;
  }
  return true;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isAuthenticating, setIsAuthenticating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Attempt to configure GoogleSignin on mount if Web OAuth Client ID is present
  useEffect(() => {
    const configured = ensureGoogleSignInConfigured();
    if (!configured) {
      console.warn(
        '[Auth] EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not configured. Google Sign-In will be unavailable until configured.'
      );
    }
  }, []);

  // Restore existing session from SecureStore
  const restoreSession = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const stored = await getStoredToken();
      if (!stored) {
        setUser(null);
        setToken(null);
        return;
      }

      setToken(stored);
      try {
        const profile = await fetchCurrentUser(stored);
        setUser(profile);
      } catch (err: unknown) {
        if (err instanceof ApiError && err.status === 401) {
          // Token is explicitly confirmed invalid or expired by backend -> clear it
          console.log('[Auth] Stored JWT is invalid or expired. Clearing local session.');
          await clearStoredToken();
          setToken(null);
          setUser(null);
        } else {
          // Network errors / server 5xx: preserve stored JWT and allow user retry
          console.warn('[Auth] Network error while restoring session. Retaining token for retry:', err);
          setError('Unable to reach server. Your session is preserved.');
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  // Initiate Native Google Sign-In
  const signIn = useCallback(async (): Promise<boolean> => {
    setIsAuthenticating(true);
    setError(null);

    try {
      // Defensively ensure Google Sign-In is configured before calling native module
      const isConfigured = ensureGoogleSignInConfigured();
      if (!isConfigured) {
        const errorMsg = 'Google Sign-In is not configured: EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is missing';
        console.error(`[Auth] ${errorMsg}`);
        setError(errorMsg);
        return false;
      }

      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

      const response = await GoogleSignin.signIn();

      // Handle user cancellation
      if (isCancelledResponse(response)) {
        console.log('[Auth] User cancelled Google Sign-In');
        return false;
      }

      // Validate successful response shape
      if (!isSuccessResponse(response)) {
        throw new Error('Google Sign-In did not complete successfully');
      }

      // Extract Google ID Token
      const idToken = response.data.idToken;
      if (!idToken) {
        throw new Error('Google did not return an identity token');
      }

      // Authenticate with Express backend
      const authData = await postGoogleLogin(idToken);

      // Persist only the cineVault session JWT in SecureStore
      await storeToken(authData.token);
      setToken(authData.token);
      setUser(authData.user);

      return true;
    } catch (err: unknown) {
      if (isErrorWithCode(err)) {
        if (err.code === statusCodes.SIGN_IN_CANCELLED) {
          console.log('[Auth] User cancelled Google Sign-In modal');
          return false;
        }
        if (err.code === statusCodes.IN_PROGRESS) {
          console.log('[Auth] Google Sign-In already in progress');
          return false;
        }
        if (err.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
          setError('Google Play Services are not available on this device');
          return false;
        }
      }

      const message = err instanceof Error ? err.message : 'Google Sign-In failed';
      console.error('[Auth] Sign-in error:', message);
      setError(message);
      return false;
    } finally {
      setIsAuthenticating(false);
    }
  }, []);

  // Sign out: always clear local session even if Google native sign out fails
  const signOut = useCallback(async (): Promise<void> => {
    try {
      if (ensureGoogleSignInConfigured()) {
        await GoogleSignin.signOut();
      }
    } catch (err) {
      console.warn('[Auth] Google native signOut failed (ignoring to finish local signout):', err);
    } finally {
      await clearStoredToken();
      setUser(null);
      setToken(null);
      setError(null);
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      token,
      isLoading,
      isAuthenticating,
      error,
      signIn,
      signOut,
      retrySessionRestore: restoreSession,
      clearError,
    }),
    [user, token, isLoading, isAuthenticating, error, signIn, signOut, restoreSession, clearError]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
