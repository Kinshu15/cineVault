import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';

export default function ProfileScreen() {
  const { user, isLoading, isAuthenticating, error, signIn, signOut, retrySessionRestore, clearError } =
    useAuth();

  const getInitials = (name: string | null, email: string): string => {
    if (name && name.trim()) {
      const parts = name.trim().split(/\s+/);
      if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
      }
      return parts[0].slice(0, 2).toUpperCase();
    }
    return email.slice(0, 2).toUpperCase();
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Profile</Text>
        </View>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#F5C518" />
          <Text style={styles.loadingText}>Loading profile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Error Notification Banner */}
        {error && (
          <View style={styles.errorBanner}>
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={20} color="#F87171" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
            <View style={styles.errorActions}>
              <TouchableOpacity onPress={retrySessionRestore} style={styles.errorActionButton}>
                <Text style={styles.errorActionText}>Retry</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={clearError} style={styles.errorActionButton}>
                <Text style={styles.errorActionTextMuted}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* User Card */}
        {user ? (
          <View style={styles.userCard}>
            {user.avatarUrl ? (
              <Image
                source={{ uri: user.avatarUrl }}
                style={styles.avatarImage}
                contentFit="cover"
                transition={200}
              />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarText}>{getInitials(user.displayName, user.email)}</Text>
              </View>
            )}
            <View style={styles.userInfo}>
              <Text style={styles.userName} numberOfLines={1}>
                {user.displayName || 'cineVault Explorer'}
              </Text>
              <Text style={styles.userEmail} numberOfLines={1}>
                {user.email}
              </Text>
              <View style={styles.badgeRow}>
                <View style={styles.googleBadge}>
                  <Ionicons name="logo-google" size={11} color="#60A5FA" />
                  <Text style={styles.googleBadgeText}>Google Account</Text>
                </View>
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.userCard}>
            <View style={styles.avatarFallbackGuest}>
              <Ionicons name="person" size={26} color="#6B7280" />
            </View>
            <View style={styles.userInfo}>
              <Text style={styles.userName}>Guest User</Text>
              <Text style={styles.userHandle}>Sign in to sync your library</Text>
            </View>
          </View>
        )}

        {/* Statistics Row (Watched, Watchlist, Reviews) */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>0</Text>
            <Text style={styles.statLabel}>Watched</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>0</Text>
            <Text style={styles.statLabel}>Watchlist</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>0</Text>
            <Text style={styles.statLabel}>Reviews</Text>
          </View>
        </View>

        {/* Authentication Action Area */}
        {!user ? (
          <View style={styles.authSection}>
            <View style={styles.noticeBox}>
              <Text style={styles.noticeTitle}>Cloud Sync & Library Backup</Text>
              <Text style={styles.noticeText}>
                Connect your Google account to back up your watchlist, sync tracked progress across devices,
                and leave reviews.
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.googleSignInButton, isAuthenticating && styles.buttonDisabled]}
              onPress={signIn}
              disabled={isAuthenticating}
              activeOpacity={0.85}
            >
              {isAuthenticating ? (
                <View style={styles.buttonInner}>
                  <ActivityIndicator size="small" color="#0B0C0E" />
                  <Text style={styles.googleButtonText}>Connecting to Google...</Text>
                </View>
              ) : (
                <View style={styles.buttonInner}>
                  <Ionicons name="logo-google" size={20} color="#0B0C0E" />
                  <Text style={styles.googleButtonText}>Continue with Google</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.authSection}>
            <View style={styles.syncStatusCard}>
              <Ionicons name="cloud-done-outline" size={22} color="#10B981" />
              <View style={styles.syncStatusInfo}>
                <Text style={styles.syncStatusTitle}>Cloud Sync Active</Text>
                <Text style={styles.syncStatusSubtitle}>
                  Your personal library is securely connected to your cineVault account.
                </Text>
              </View>
            </View>

            <TouchableOpacity style={styles.signOutButton} onPress={signOut} activeOpacity={0.8}>
              <Ionicons name="log-out-outline" size={18} color="#EF4444" />
              <Text style={styles.signOutText}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0B0C0E',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#17191E',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  loadingText: {
    color: '#9CA3AF',
    marginTop: 12,
    fontSize: 14,
    fontWeight: '500',
  },
  errorBanner: {
    backgroundColor: '#1E1416',
    borderWidth: 1,
    borderColor: '#7F1D1D',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
    lineHeight: 18,
  },
  errorActions: {
    flexDirection: 'row',
    gap: 16,
    paddingLeft: 28,
  },
  errorActionButton: {
    paddingVertical: 4,
  },
  errorActionText: {
    color: '#F5C518',
    fontSize: 12,
    fontWeight: '700',
  },
  errorActionTextMuted: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '500',
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: '#14161B',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#23262F',
    marginBottom: 20,
  },
  avatarImage: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: '#F5C518',
    backgroundColor: '#1E222B',
  },
  avatarFallback: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#1E222B',
    borderWidth: 2,
    borderColor: '#F5C518',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackGuest: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#1E222B',
    borderWidth: 1,
    borderColor: '#374151',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#F5C518',
    fontSize: 22,
    fontWeight: '900',
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 2,
  },
  userEmail: {
    color: '#9CA3AF',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 6,
  },
  userHandle: {
    color: '#6B7280',
    fontSize: 13,
    fontWeight: '500',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  googleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#172033',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1E3A8A',
  },
  googleBadgeText: {
    color: '#93C5FD',
    fontSize: 11,
    fontWeight: '700',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#14161B',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#23262F',
  },
  statValue: {
    color: '#F5C518',
    fontSize: 20,
    fontWeight: '900',
    marginBottom: 4,
  },
  statLabel: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
  },
  authSection: {
    gap: 16,
  },
  noticeBox: {
    backgroundColor: '#131822',
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 16,
    borderRadius: 12,
  },
  noticeTitle: {
    color: '#60A5FA',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },
  noticeText: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 18,
  },
  googleSignInButton: {
    backgroundColor: '#F5C518',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F5C518',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  googleButtonText: {
    color: '#0B0C0E',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  syncStatusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#101C18',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#064E3B',
  },
  syncStatusInfo: {
    flex: 1,
  },
  syncStatusTitle: {
    color: '#34D399',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  syncStatusSubtitle: {
    color: '#6EE7B7',
    fontSize: 12,
    lineHeight: 16,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#161314',
    borderWidth: 1,
    borderColor: '#37181A',
    paddingVertical: 14,
    borderRadius: 12,
  },
  signOutText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '700',
  },
});
