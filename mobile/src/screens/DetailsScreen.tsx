import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Modal,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, useNavigation, RouteProp, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { MediaDetails, Episode, Season } from '../../types/tmdb';
import { getMediaDetails, getSeasonDetails, getImageUrl } from '../../services/tmdb';
import { useAuth } from '../context/AuthContext';
import {
  getMediaTrackingStatus,
  getWatchlists,
  addWatchlistItem,
  removeWatchlistItem,
  upsertMediaStatus,
  updateMediaStatusById,
  createWatchlist,
  ApiError,
  MediaMetadataInput,
  TrackedMediaDetail,
  WatchlistSummary,
  BackendMediaType,
} from '../services/api';

const BACKDROP_HEIGHT = 280;

type DetailsRouteProp = RouteProp<RootStackParamList, 'Details'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

type MetadataResult =
  | { isValid: true; metadata: MediaMetadataInput }
  | { isValid: false; error: string };

/**
 * Validates and extracts media metadata snapshot from TMDB details.
 * Strict rules:
 * - Title: Mandatory non-empty string, trimmed, 1 <= length <= 255. NEVER use "Untitled" or fabrications.
 * - Release Date: Optional. Must be valid YYYY-MM-DD and real calendar date; otherwise omitted.
 * - Poster Path: Optional. Must match flat TMDB format /^\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/i; otherwise null.
 * - Vote Average: Optional finite number between 0.0 and 10.0; otherwise null.
 * - Overview: Optional trimmed string, max 4000 characters; otherwise null.
 */
function extractMediaMetadata(details: MediaDetails | null): MetadataResult {
  if (!details) {
    return { isValid: false, error: 'Media details are not available.' };
  }

  const rawTitle = (details.title || details.name || '').trim();
  if (!rawTitle) {
    return {
      isValid: false,
      error: 'Cannot track title: TMDB did not return a valid title for this media.',
    };
  }
  if (rawTitle.length > 255) {
    return {
      isValid: false,
      error: 'Media title exceeds maximum allowed length of 255 characters.',
    };
  }

  let validReleaseDate: string | null = null;
  const rawDate = details.release_date || details.first_air_date;
  if (typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDate.trim())) {
    const trimmed = rawDate.trim();
    const [year, month, day] = trimmed.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    ) {
      validReleaseDate = trimmed;
    }
  }

  let validPosterPath: string | null = null;
  if (
    typeof details.poster_path === 'string' &&
    /^\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/i.test(details.poster_path.trim())
  ) {
    validPosterPath = details.poster_path.trim();
  }

  let validVoteAverage: number | null = null;
  if (typeof details.vote_average === 'number' && Number.isFinite(details.vote_average)) {
    if (details.vote_average >= 0 && details.vote_average <= 10) {
      validVoteAverage = details.vote_average;
    }
  }

  let validOverview: string | null = null;
  if (typeof details.overview === 'string' && details.overview.trim().length > 0) {
    validOverview = details.overview.trim().slice(0, 4000);
  }

  return {
    isValid: true,
    metadata: {
      title: rawTitle,
      releaseDate: validReleaseDate,
      posterPath: validPosterPath,
      voteAverage: validVoteAverage,
      overview: validOverview,
    },
  };
}

/**
 * Determines whether a movie is unreleased based on TMDB release date and status.
 *
 * Rules:
 * - Valid release date in past or today (<= today's local calendar date): Released (not unreleased).
 *   A valid past or today's release date takes precedence over TMDB production status.
 * - Valid future release date (> today's local calendar date): Unreleased.
 * - Missing, empty, or invalid release date:
 *   - TMDB status 'Planned', 'In Production', 'Post Production', or 'Rumored' (case-insensitive): Unreleased.
 *   - 'Released', omitted, or unknown status: Not unreleased (allowed).
 */
export function isMovieUnreleased(
  releaseDateRaw?: string | null,
  tmdbStatusRaw?: string | null
): boolean {
  // 1. Validate releaseDateRaw format and real calendar date in UTC
  let validReleaseDate: string | null = null;
  if (typeof releaseDateRaw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(releaseDateRaw.trim())) {
    const trimmed = releaseDateRaw.trim();
    const [year, month, day] = trimmed.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    ) {
      validReleaseDate = trimmed;
    }
  }

  // 2. If a valid calendar release date exists, compare against today's local calendar date.
  // A valid past or today's date takes precedence over TMDB status.
  if (validReleaseDate !== null) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const todayStr = `${y}-${m}-${d}`;

    return validReleaseDate > todayStr;
  }

  // 3. Fallback: When release date is missing, empty, or invalid, consult TMDB production status
  const normalizedStatus = (tmdbStatusRaw || '').trim().toLowerCase();
  const unreleasedStatuses = ['planned', 'in production', 'post production', 'rumored'];
  if (unreleasedStatuses.includes(normalizedStatus)) {
    return true;
  }

  return false;
}

export default function DetailsScreen() {
  const route = useRoute<DetailsRouteProp>();
  const navigation = useNavigation<NavigationProp>();
  const { user, token, signOut } = useAuth();
  const isAuthenticated = Boolean(user && token);

  const { id, type } = route.params;

  // TMDB Identification
  const numericTmdbId = typeof id === 'number' ? id : parseInt(String(id), 10);
  const isValidTmdbId = Number.isSafeInteger(numericTmdbId) && numericTmdbId > 0;
  const mediaType: 'movie' | 'tv' = type === 'tv' ? 'tv' : 'movie';
  const backendMediaType: BackendMediaType = mediaType === 'tv' ? 'TV' : 'MOVIE';

  // TMDB Content States
  const [details, setDetails] = useState<MediaDetails | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Series / Anime Season & Episode states
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loadingEpisodes, setLoadingEpisodes] = useState<boolean>(false);

  // Server-Backed Tracking & Watchlists State
  const [trackingData, setTrackingData] = useState<TrackedMediaDetail | null>(null);
  const [userWatchlists, setUserWatchlists] = useState<WatchlistSummary[]>([]);
  const [isTrackingLoading, setIsTrackingLoading] = useState<boolean>(false);
  const [isTogglingWatched, setIsTogglingWatched] = useState<boolean>(false);

  // Watchlist Picker Modal State
  const [isPickerVisible, setIsPickerVisible] = useState<boolean>(false);
  const [mutatingWatchlistId, setMutatingWatchlistId] = useState<string | null>(null);
  const [showCreateInput, setShowCreateInput] = useState<boolean>(false);
  const [newWatchlistName, setNewWatchlistName] = useState<string>('');
  const [isCreatingWatchlist, setIsCreatingWatchlist] = useState<boolean>(false);
  const [newWatchlistError, setNewWatchlistError] = useState<string | null>(null);

  // Active Request Reference for Stale Request Protection
  const activeTrackingRequestRef = useRef<number>(0);
  const activeDetailsRequestRef = useRef<number>(0);

  // Derived tracking and media properties
  const userMediaId = trackingData?.id || null;
  const isWatched = trackingData?.status === 'WATCHED';
  const memberWatchlists = trackingData?.watchlists || [];
  const isSeries = details
    ? details.media_type === 'tv' || (!details.title && !!details.name)
    : mediaType === 'tv';
  const isUnreleasedMovie = !isSeries && isMovieUnreleased(details?.release_date, details?.status);
  const showWatchedButton = isWatched || !isUnreleasedMovie;

  /**
   * Prompts unauthenticated user to sign in before performing library actions.
   */
  const promptSignIn = useCallback(
    (actionDescription: string) => {
      Alert.alert(
        'Sign In Required',
        `Sign in to ${actionDescription} and sync your library across devices.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Sign In',
            onPress: () => {
              (navigation as any).navigate('MainTabs', { screen: 'ProfileTab' });
            },
          },
        ]
      );
    },
    [navigation]
  );

  /**
   * Loads TMDB details for the title.
   */
  useEffect(() => {
    if (!isValidTmdbId) {
      setError('Invalid media identifier provided.');
      setLoading(false);
      return;
    }

    const requestId = ++activeDetailsRequestRef.current;

    const fetchDetails = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getMediaDetails(numericTmdbId, mediaType);

        if (activeDetailsRequestRef.current !== requestId) return;

        setDetails(data);

        // If series, initialize with the first real season
        if (mediaType === 'tv' && data.seasons && data.seasons.length > 0) {
          const firstRegularSeason =
            data.seasons.find((s) => s.season_number > 0) || data.seasons[0];
          setSelectedSeason(firstRegularSeason.season_number);
        }
      } catch (err: any) {
        if (activeDetailsRequestRef.current !== requestId) return;
        console.error('Failed to load media details:', err);
        setError(err?.message || 'Failed to load details.');
      } finally {
        if (activeDetailsRequestRef.current === requestId) {
          setLoading(false);
        }
      }
    };

    fetchDetails();
  }, [isValidTmdbId, numericTmdbId, mediaType]);

  /**
   * Loads season episodes for TV shows.
   */
  const loadEpisodesForSeason = useCallback(async (tvId: number, seasonNum: number) => {
    try {
      setLoadingEpisodes(true);
      const seasonData = await getSeasonDetails(tvId, seasonNum);
      setEpisodes(seasonData.episodes || []);
    } catch (err) {
      console.error('Failed to load season episodes:', err);
      setEpisodes([]);
    } finally {
      setLoadingEpisodes(false);
    }
  }, []);

  useEffect(() => {
    if (details && (details.media_type === 'tv' || (!details.title && !!details.name))) {
      loadEpisodesForSeason(details.id, selectedSeason);
    }
  }, [details, selectedSeason, loadEpisodesForSeason]);

  /**
   * Loads tracking status and watchlists from the backend.
   * Guarded against race conditions with activeTrackingRequestRef.
   */
  const loadTrackingAndWatchlists = useCallback(
    async (silent = false) => {
      if (!token || !isValidTmdbId) {
        setTrackingData(null);
        setUserWatchlists([]);
        return;
      }

      const requestId = ++activeTrackingRequestRef.current;
      if (!silent) {
        setIsTrackingLoading(true);
      }

      try {
        const [trackingRes, watchlistsRes] = await Promise.all([
          getMediaTrackingStatus(mediaType, numericTmdbId, token),
          getWatchlists(token),
        ]);

        if (activeTrackingRequestRef.current !== requestId) return;

        if (trackingRes.tracked && trackingRes.media) {
          setTrackingData(trackingRes.media);
        } else {
          setTrackingData(null);
        }

        // Sort watchlists: default list first, followed by custom lists
        const sorted = [...(watchlistsRes.watchlists || [])].sort((a, b) => {
          if (a.isDefault) return -1;
          if (b.isDefault) return 1;
          return 0;
        });
        setUserWatchlists(sorted);
      } catch (err: unknown) {
        if (activeTrackingRequestRef.current !== requestId) return;

        if (err instanceof ApiError && err.status === 401) {
          await signOut();
          return;
        }
        console.warn('[DetailsScreen] Failed to load tracking status or watchlists:', err);
      } finally {
        if (activeTrackingRequestRef.current === requestId) {
          setIsTrackingLoading(false);
        }
      }
    },
    [token, isValidTmdbId, mediaType, numericTmdbId, signOut]
  );

  // Sync tracking status when token or title changes
  useEffect(() => {
    if (isAuthenticated) {
      loadTrackingAndWatchlists(false);
    } else {
      setTrackingData(null);
      setUserWatchlists([]);
    }
  }, [isAuthenticated, loadTrackingAndWatchlists]);

  // Synchronize on focus when returning from other tabs or screens
  useFocusEffect(
    useCallback(() => {
      if (isAuthenticated) {
        loadTrackingAndWatchlists(true);
      }
    }, [isAuthenticated, loadTrackingAndWatchlists])
  );

  /**
   * Toggles global watched status directly.
   * Handles both tracked and untracked titles, and respects backend pruning.
   */
  const handleToggleWatched = useCallback(async () => {
    if (!isAuthenticated) {
      promptSignIn('mark titles as watched');
      return;
    }

    if (isTogglingWatched || !isValidTmdbId) return;

    // Defensive guard: Unreleased movies cannot be marked as WATCHED
    if (!isWatched && isUnreleasedMovie) {
      return;
    }

    const metaRes = extractMediaMetadata(details);
    if (!metaRes.isValid) {
      Alert.alert('Cannot Update Status', metaRes.error);
      return;
    }

    setIsTogglingWatched(true);
    try {
      if (!isWatched) {
        // Marking as WATCHED
        if (userMediaId) {
          await updateMediaStatusById(userMediaId, 'WATCHED', token);
        } else {
          await upsertMediaStatus(
            {
              tmdbId: numericTmdbId,
              mediaType: backendMediaType,
              status: 'WATCHED',
              metadata: metaRes.metadata,
            },
            token
          );
        }
      } else {
        // Unmarking WATCHED -> set to WANT_TO_WATCH
        if (userMediaId) {
          await updateMediaStatusById(userMediaId, 'WANT_TO_WATCH', token);
        } else {
          await upsertMediaStatus(
            {
              tmdbId: numericTmdbId,
              mediaType: backendMediaType,
              status: 'WANT_TO_WATCH',
              metadata: metaRes.metadata,
            },
            token
          );
        }
      }

      // Re-fetch clean server state
      await loadTrackingAndWatchlists(true);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 401) {
        await signOut();
        return;
      }
      const msg = err instanceof Error ? err.message : 'Failed to update watched status.';
      Alert.alert('Error', msg);
    } finally {
      setIsTogglingWatched(false);
    }
  }, [
    isAuthenticated,
    isTogglingWatched,
    isValidTmdbId,
    details,
    isWatched,
    isUnreleasedMovie,
    userMediaId,
    token,
    numericTmdbId,
    backendMediaType,
    loadTrackingAndWatchlists,
    promptSignIn,
    signOut,
  ]);

  /**
   * Adds or removes the current media item from a specific watchlist.
   */
  const handleToggleWatchlistRow = useCallback(
    async (watchlist: WatchlistSummary) => {
      if (!isAuthenticated || !token || !isValidTmdbId) return;
      if (mutatingWatchlistId !== null) return;

      const isCurrentMember = memberWatchlists.some((w) => w.id === watchlist.id);

      if (isCurrentMember) {
        // Remove from watchlist
        if (!userMediaId) {
          Alert.alert('Error', 'Unable to resolve media identifier for removal.');
          return;
        }

        setMutatingWatchlistId(watchlist.id);
        try {
          await removeWatchlistItem(watchlist.id, userMediaId, token);
          await loadTrackingAndWatchlists(true);
        } catch (err: unknown) {
          if (err instanceof ApiError && err.status === 401) {
            await signOut();
            return;
          }
          const msg = err instanceof Error ? err.message : 'Failed to remove from watchlist.';
          Alert.alert('Error', msg);
        } finally {
          setMutatingWatchlistId(null);
        }
      } else {
        // Add to watchlist
        const metaRes = extractMediaMetadata(details);
        if (!metaRes.isValid) {
          Alert.alert('Cannot Add to Watchlist', metaRes.error);
          return;
        }

        setMutatingWatchlistId(watchlist.id);
        try {
          await addWatchlistItem(
            watchlist.id,
            {
              tmdbId: numericTmdbId,
              mediaType: backendMediaType,
              metadata: metaRes.metadata,
            },
            token
          );
          await loadTrackingAndWatchlists(true);
        } catch (err: unknown) {
          if (err instanceof ApiError && err.status === 401) {
            await signOut();
            return;
          }
          if (err instanceof ApiError && err.status === 409) {
            // Title already in list; sync fresh state
            await loadTrackingAndWatchlists(true);
            return;
          }
          const msg = err instanceof Error ? err.message : 'Failed to add to watchlist.';
          Alert.alert('Error', msg);
        } finally {
          setMutatingWatchlistId(null);
        }
      }
    },
    [
      isAuthenticated,
      token,
      isValidTmdbId,
      mutatingWatchlistId,
      memberWatchlists,
      userMediaId,
      details,
      numericTmdbId,
      backendMediaType,
      loadTrackingAndWatchlists,
      signOut,
    ]
  );

  /**
   * Creates a new custom watchlist from inside the picker and immediately adds the title.
   */
  const handleQuickCreateWatchlist = useCallback(async () => {
    if (!isAuthenticated || !token || isCreatingWatchlist) return;

    const trimmed = newWatchlistName.trim();
    if (!trimmed) {
      setNewWatchlistError('Watchlist name cannot be empty.');
      return;
    }
    if (trimmed.length > 100) {
      setNewWatchlistError('Watchlist name cannot exceed 100 characters.');
      return;
    }
    if (trimmed.toLowerCase() === 'my watchlist') {
      setNewWatchlistError('"My Watchlist" is a reserved system name.');
      return;
    }

    const duplicate = userWatchlists.some(
      (w) => w.name.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (duplicate) {
      setNewWatchlistError('A watchlist with this name already exists.');
      return;
    }

    setIsCreatingWatchlist(true);
    setNewWatchlistError(null);

    try {
      const created = await createWatchlist(trimmed, token);
      setNewWatchlistName('');
      setShowCreateInput(false);

      // Refresh watchlists collection
      await loadTrackingAndWatchlists(true);

      // Immediately attempt adding current title to newly created list
      const metaRes = extractMediaMetadata(details);
      if (metaRes.isValid) {
        setMutatingWatchlistId(created.id);
        try {
          await addWatchlistItem(
            created.id,
            {
              tmdbId: numericTmdbId,
              mediaType: backendMediaType,
              metadata: metaRes.metadata,
            },
            token
          );
          await loadTrackingAndWatchlists(true);
        } catch (addErr: unknown) {
          console.warn('[DetailsScreen] List created, but failed to add title:', addErr);
          Alert.alert(
            'Watchlist Created',
            `"${created.name}" was created successfully. Adding "${metaRes.metadata.title}" failed; tap the list row to retry.`
          );
        } finally {
          setMutatingWatchlistId(null);
        }
      }
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 401) {
        await signOut();
        return;
      }
      if (err instanceof ApiError && err.status === 409) {
        setNewWatchlistError('A watchlist with this name already exists.');
        return;
      }
      const msg = err instanceof Error ? err.message : 'Failed to create watchlist.';
      setNewWatchlistError(msg);
    } finally {
      setIsCreatingWatchlist(false);
    }
  }, [
    isAuthenticated,
    token,
    isCreatingWatchlist,
    newWatchlistName,
    userWatchlists,
    details,
    numericTmdbId,
    backendMediaType,
    loadTrackingAndWatchlists,
    signOut,
  ]);

  if (loading) {
    return (
      <SafeAreaView style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#F5C518" />
        <Text style={styles.loadingText}>Loading details...</Text>
      </SafeAreaView>
    );
  }

  if (error || !details) {
    return (
      <SafeAreaView style={styles.centerContainer}>
        <Text style={styles.errorIcon}>⚠️</Text>
        <Text style={styles.errorTitle}>Unable to Load Title</Text>
        <Text style={styles.errorText}>{error || 'Media not found.'}</Text>
        <TouchableOpacity style={styles.backButtonCenter} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonCenterText}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const title = details.title || details.name || 'Untitled';
  const releaseYear = (details.release_date || details.first_air_date || '').substring(0, 4);

  let durationText = '';
  if (isSeries) {
    const seasons = details.number_of_seasons || 1;
    durationText = `${seasons} ${seasons === 1 ? 'Season' : 'Seasons'}`;
  } else if (details.runtime) {
    const hours = Math.floor(details.runtime / 60);
    const minutes = details.runtime % 60;
    durationText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }

  const trailer = details.videos?.results?.find(
    (v) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser')
  );

  const openTrailer = () => {
    if (trailer) {
      Linking.openURL(`https://www.youtube.com/watch?v=${trailer.key}`);
    }
  };

  const cast = details.credits?.cast?.slice(0, 15) || [];

  // Sort seasons: Season 1, 2, 3... and specials at the end
  const sortedSeasons: Season[] = [...(details.seasons || [])].sort((a, b) => {
    if (a.season_number === 0) return 1;
    if (b.season_number === 0) return -1;
    return a.season_number - b.season_number;
  });

  // Watchlist action button label
  const watchlistButtonLabel =
    memberWatchlists.length === 0
      ? '+ Watchlist'
      : memberWatchlists.length === 1
      ? '✓ In Watchlist'
      : `✓ In ${memberWatchlists.length} Lists`;

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Backdrop Hero Header */}
        <View style={styles.backdropContainer}>
          <Image
            source={{ uri: getImageUrl(details.backdrop_path || details.poster_path, 'original') }}
            style={styles.backdropImage}
            contentFit="cover"
            transition={200}
          />
          <View style={styles.backdropGradient} />

          {/* Floating Native Back Button */}
          <SafeAreaView style={styles.floatingHeader} edges={['top']}>
            <TouchableOpacity
              style={styles.floatingBackButton}
              onPress={() => navigation.goBack()}
              activeOpacity={0.8}
            >
              <Text style={styles.backArrow}>←</Text>
            </TouchableOpacity>
          </SafeAreaView>
        </View>

        {/* Content Details Block */}
        <View style={styles.detailsBody}>
          <View style={styles.mainInfoRow}>
            <Image
              source={{ uri: getImageUrl(details.poster_path, 'w500') }}
              style={styles.posterThumbnail}
              contentFit="cover"
              transition={200}
            />
            <View style={styles.titleColumn}>
              <View style={styles.metaBadgeRow}>
                <View style={[styles.typeBadge, isSeries ? styles.seriesBadge : styles.movieBadge]}>
                  <Text style={styles.typeBadgeText}>{isSeries ? 'SERIES' : 'MOVIE'}</Text>
                </View>
                {details.status ? <Text style={styles.statusText}>{details.status}</Text> : null}
              </View>

              <Text style={styles.mainTitle}>{title}</Text>

              {details.tagline ? (
                <Text style={styles.tagline}>&ldquo;{details.tagline}&rdquo;</Text>
              ) : null}

              <View style={styles.statsRow}>
                <View style={styles.ratingBox}>
                  <Text style={styles.starIcon}>★</Text>
                  <Text style={styles.ratingNumber}>
                    {details.vote_average ? details.vote_average.toFixed(1) : 'NR'}
                  </Text>
                </View>
                <Text style={styles.statDot}>•</Text>
                {releaseYear ? <Text style={styles.statText}>{releaseYear}</Text> : null}
                {durationText ? (
                  <>
                    <Text style={styles.statDot}>•</Text>
                    <Text style={styles.statText}>{durationText}</Text>
                  </>
                ) : null}
              </View>
            </View>
          </View>

          {/* Genre Badges */}
          {details.genres && details.genres.length > 0 ? (
            <View style={styles.genreRow}>
              {details.genres.map((genre) => (
                <View key={`genre-${genre.id}`} style={styles.genrePill}>
                  <Text style={styles.genrePillText}>{genre.name}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Action Buttons: Watchlist & Watched */}
          <View style={styles.actionsRow}>
            {/* Watchlist Picker Action Button */}
            <TouchableOpacity
              style={[
                styles.actionButton,
                memberWatchlists.length > 0 && styles.actionButtonActive,
              ]}
              onPress={() => {
                if (!isAuthenticated) {
                  promptSignIn('manage your watchlists');
                } else {
                  setShowCreateInput(false);
                  setNewWatchlistName('');
                  setNewWatchlistError(null);
                  setIsPickerVisible(true);
                }
              }}
              activeOpacity={0.8}
              disabled={isTrackingLoading}
            >
              {isTrackingLoading ? (
                <ActivityIndicator size="small" color="#F5C518" />
              ) : (
                <Text
                  style={[
                    styles.actionButtonText,
                    memberWatchlists.length > 0 && styles.actionButtonTextActive,
                  ]}
                >
                  {watchlistButtonLabel}
                </Text>
              )}
            </TouchableOpacity>

            {/* Watched Status Direct Toggle (Hidden when movie is unreleased unless already watched) */}
            {showWatchedButton ? (
              <TouchableOpacity
                style={[
                  styles.actionButton,
                  isWatched && styles.actionButtonActiveGreen,
                ]}
                onPress={handleToggleWatched}
                activeOpacity={0.8}
                disabled={isTogglingWatched || isTrackingLoading}
              >
                {isTogglingWatched ? (
                  <ActivityIndicator size="small" color={isWatched ? '#FFFFFF' : '#10B981'} />
                ) : (
                  <Text
                    style={[
                      styles.actionButtonText,
                      isWatched && styles.actionButtonTextActiveGreen,
                    ]}
                  >
                    {isWatched ? '✓ Watched' : 'Mark Watched'}
                  </Text>
                )}
              </TouchableOpacity>
            ) : null}

            {/* Trailer Action */}
            {trailer ? (
              <TouchableOpacity
                style={styles.trailerButton}
                onPress={openTrailer}
                activeOpacity={0.8}
              >
                <Text style={styles.trailerButtonText}>▶ Trailer</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Member Watchlists Badges Row */}
          {memberWatchlists.length > 0 ? (
            <View style={styles.membershipRow}>
              <Text style={styles.membershipLabel}>IN WATCHLISTS</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.membershipBadgesScroll}
              >
                {memberWatchlists.map((wl) => (
                  <TouchableOpacity
                    key={`membership-badge-${wl.id}`}
                    style={styles.membershipBadge}
                    onPress={() => setIsPickerVisible(true)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={wl.isDefault ? 'star' : 'bookmark'}
                      size={11}
                      color="#F5C518"
                    />
                    <Text style={styles.membershipBadgeText}>{wl.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          ) : null}

          {/* Storyline Section */}
          <View style={styles.section}>
            <Text style={styles.sectionHeading}>Storyline</Text>
            <Text style={styles.overviewText}>
              {details.overview || 'No synopsis provided for this title.'}
            </Text>
          </View>

          {/* Series & Anime Seasons & Episodes Browser */}
          {isSeries && sortedSeasons.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeading}>Seasons & Episodes</Text>
                <Text style={styles.sectionSubCount}>
                  {details.number_of_episodes ? `${details.number_of_episodes} Total Episodes` : ''}
                </Text>
              </View>

              {/* Season Selector Pills */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.seasonsScroll}
              >
                {sortedSeasons.map((season) => {
                  const isSelected = selectedSeason === season.season_number;
                  const label =
                    season.season_number === 0
                      ? 'Specials'
                      : `Season ${season.season_number}`;

                  return (
                    <TouchableOpacity
                      key={`season-tab-${season.id}`}
                      style={[styles.seasonChip, isSelected && styles.seasonChipActive]}
                      onPress={() => setSelectedSeason(season.season_number)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.seasonChipText, isSelected && styles.seasonChipTextActive]}>
                        {label}
                      </Text>
                      {season.episode_count ? (
                        <Text style={[styles.seasonEpCount, isSelected && styles.seasonEpCountActive]}>
                          {season.episode_count} eps
                        </Text>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Episode List */}
              {loadingEpisodes ? (
                <View style={styles.episodesLoading}>
                  <ActivityIndicator size="small" color="#F5C518" />
                  <Text style={styles.episodesLoadingText}>Loading episodes...</Text>
                </View>
              ) : episodes.length === 0 ? (
                <Text style={styles.noEpisodesText}>No episodes found for this season.</Text>
              ) : (
                <View style={styles.episodesList}>
                  {episodes.map((ep) => {
                    const epDuration = ep.runtime ? `${ep.runtime}m` : '';
                    const epRating = ep.vote_average ? `★ ${ep.vote_average.toFixed(1)}` : '';

                    return (
                      <View key={`ep-${ep.id}`} style={styles.episodeCard}>
                        <Image
                          source={{
                            uri: ep.still_path
                              ? getImageUrl(ep.still_path, 'w500')
                              : 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=500&q=80',
                          }}
                          style={styles.episodeThumbnail}
                          contentFit="cover"
                          transition={150}
                        />
                        <View style={styles.episodeInfo}>
                          <Text style={styles.episodeNumber}>
                            EPISODE {ep.episode_number}
                          </Text>
                          <Text style={styles.episodeTitle} numberOfLines={2}>
                            {ep.name || `Episode ${ep.episode_number}`}
                          </Text>
                          <View style={styles.episodeMeta}>
                            {epDuration ? <Text style={styles.episodeMetaText}>{epDuration}</Text> : null}
                            {epDuration && epRating ? (
                              <Text style={styles.episodeMetaDot}>•</Text>
                            ) : null}
                            {epRating ? <Text style={styles.episodeRating}>{epRating}</Text> : null}
                            {ep.air_date ? (
                              <>
                                <Text style={styles.episodeMetaDot}>•</Text>
                                <Text style={styles.episodeMetaText}>{ep.air_date}</Text>
                              </>
                            ) : null}
                          </View>
                          {ep.overview ? (
                            <Text style={styles.episodeOverview} numberOfLines={3}>
                              {ep.overview}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          ) : null}

          {/* Top Cast Section */}
          {cast.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionHeading}>Top Cast</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.castScroll}
              >
                {cast.map((member) => (
                  <View key={`cast-${member.id}`} style={styles.castCard}>
                    <Image
                      source={{
                        uri: member.profile_path
                          ? getImageUrl(member.profile_path, 'w185')
                          : 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&q=80',
                      }}
                      style={styles.castAvatar}
                      contentFit="cover"
                      transition={150}
                    />
                    <Text style={styles.castName} numberOfLines={1}>
                      {member.name}
                    </Text>
                    <Text style={styles.characterName} numberOfLines={1}>
                      {member.character || 'Cast'}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* Watchlist Picker Modal */}
      <Modal
        visible={isPickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setIsPickerVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <SafeAreaView style={styles.modalContent} edges={['bottom']}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderTitles}>
                <Text style={styles.modalTitle}>Add to Watchlists</Text>
                <Text style={styles.modalSubtitle} numberOfLines={1}>
                  {title}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => setIsPickerVisible(false)}
                activeOpacity={0.7}
              >
                <Ionicons name="close" size={20} color="#9CA3AF" />
              </TouchableOpacity>
            </View>

            {/* Watchlists List */}
            <ScrollView
              style={styles.modalList}
              contentContainerStyle={styles.modalListContent}
              keyboardShouldPersistTaps="handled"
            >
              {userWatchlists.length === 0 ? (
                <View style={styles.modalEmptyState}>
                  <Text style={styles.modalEmptyText}>No watchlists found.</Text>
                </View>
              ) : (
                userWatchlists.map((wl) => {
                  const isMember = memberWatchlists.some((w) => w.id === wl.id);
                  const isMutatingThis = mutatingWatchlistId === wl.id;

                  return (
                    <TouchableOpacity
                      key={`modal-wl-${wl.id}`}
                      style={[
                        styles.watchlistPickerRow,
                        isMember && styles.watchlistPickerRowSelected,
                      ]}
                      onPress={() => handleToggleWatchlistRow(wl)}
                      disabled={mutatingWatchlistId !== null}
                      activeOpacity={0.7}
                    >
                      <View style={styles.pickerRowLeft}>
                        <Ionicons
                          name={wl.isDefault ? 'star' : 'bookmark'}
                          size={18}
                          color={wl.isDefault ? '#F5C518' : '#9CA3AF'}
                        />
                        <View style={styles.pickerRowTextCol}>
                          <Text
                            style={[
                              styles.pickerRowName,
                              isMember && styles.pickerRowNameSelected,
                            ]}
                            numberOfLines={1}
                          >
                            {wl.name}
                          </Text>
                          <Text style={styles.pickerRowCount}>
                            {wl.itemCount} {wl.itemCount === 1 ? 'title' : 'titles'}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.pickerRowRight}>
                        {isMutatingThis ? (
                          <ActivityIndicator size="small" color="#F5C518" />
                        ) : (
                          <Ionicons
                            name={isMember ? 'checkbox' : 'square-outline'}
                            size={22}
                            color={isMember ? '#F5C518' : '#6B7280'}
                          />
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}

              {/* Quick Create Watchlist Section */}
              <View style={styles.quickCreateSection}>
                {!showCreateInput ? (
                  <TouchableOpacity
                    style={styles.createToggleRow}
                    onPress={() => {
                      setShowCreateInput(true);
                      setNewWatchlistError(null);
                    }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="add-circle-outline" size={20} color="#F5C518" />
                    <Text style={styles.createToggleText}>Create New Watchlist</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.quickCreateBox}>
                    <Text style={styles.quickCreateTitle}>New Watchlist</Text>
                    <TextInput
                      style={[
                        styles.quickCreateInput,
                        !!newWatchlistError && styles.quickCreateInputError,
                      ]}
                      placeholder="e.g. Weekend Binge"
                      placeholderTextColor="#6B7280"
                      value={newWatchlistName}
                      onChangeText={(val) => {
                        setNewWatchlistName(val);
                        if (newWatchlistError) setNewWatchlistError(null);
                      }}
                      autoFocus
                      maxLength={100}
                    />
                    {newWatchlistError ? (
                      <Text style={styles.quickCreateErrorText}>{newWatchlistError}</Text>
                    ) : null}

                    <View style={styles.quickCreateActions}>
                      <TouchableOpacity
                        style={styles.quickCreateCancelButton}
                        onPress={() => {
                          setShowCreateInput(false);
                          setNewWatchlistName('');
                          setNewWatchlistError(null);
                        }}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.quickCreateCancelText}>Cancel</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.quickCreateSubmitButton,
                          isCreatingWatchlist && styles.quickCreateSubmitButtonDisabled,
                        ]}
                        onPress={handleQuickCreateWatchlist}
                        disabled={isCreatingWatchlist}
                        activeOpacity={0.8}
                      >
                        {isCreatingWatchlist ? (
                          <ActivityIndicator size="small" color="#000000" />
                        ) : (
                          <Text style={styles.quickCreateSubmitText}>Create & Add</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            </ScrollView>

            {/* Modal Done Footer */}
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.modalDoneButton}
                onPress={() => setIsPickerVisible(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.modalDoneButtonText}>Done</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0B0C0E',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  centerContainer: {
    flex: 1,
    backgroundColor: '#0B0C0E',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    color: '#9CA3AF',
    marginTop: 12,
    fontSize: 14,
    fontWeight: '500',
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  errorText: {
    color: '#9CA3AF',
    textAlign: 'center',
    fontSize: 14,
    marginBottom: 20,
    lineHeight: 20,
  },
  backButtonCenter: {
    backgroundColor: '#F5C518',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  backButtonCenterText: {
    color: '#000000',
    fontWeight: '700',
    fontSize: 14,
  },
  backdropContainer: {
    width: '100%',
    height: BACKDROP_HEIGHT,
    position: 'relative',
    backgroundColor: '#14161B',
  },
  backdropImage: {
    width: '100%',
    height: '100%',
    opacity: 0.7,
  },
  backdropGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 120,
    backgroundColor: 'rgba(11, 12, 14, 0.95)',
  },
  floatingHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  floatingBackButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrow: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    marginTop: -2,
  },
  detailsBody: {
    paddingHorizontal: 16,
    marginTop: -50,
  },
  mainInfoRow: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'flex-start',
  },
  posterThumbnail: {
    width: 110,
    height: 165,
    borderRadius: 12,
    backgroundColor: '#14161B',
    borderWidth: 2,
    borderColor: '#23262F',
  },
  titleColumn: {
    flex: 1,
    paddingTop: 8,
  },
  metaBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  typeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  movieBadge: {
    backgroundColor: 'rgba(229, 9, 20, 0.9)',
  },
  seriesBadge: {
    backgroundColor: 'rgba(59, 130, 246, 0.9)',
  },
  typeBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  statusText: {
    color: '#6B7280',
    fontSize: 11,
    fontWeight: '600',
  },
  mainTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 28,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  tagline: {
    color: '#9CA3AF',
    fontSize: 12,
    fontStyle: 'italic',
    marginBottom: 8,
    lineHeight: 16,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  ratingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 197, 24, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 3,
  },
  starIcon: {
    color: '#F5C518',
    fontSize: 12,
  },
  ratingNumber: {
    color: '#F5C518',
    fontSize: 12,
    fontWeight: '800',
  },
  statDot: {
    color: '#4B5563',
    marginHorizontal: 8,
  },
  statText: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
  },
  genreRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 18,
  },
  genrePill: {
    backgroundColor: '#17191E',
    borderWidth: 1,
    borderColor: '#262930',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
  },
  genrePillText: {
    color: '#E5E7EB',
    fontSize: 12,
    fontWeight: '600',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  actionButton: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#17191E',
    borderWidth: 1,
    borderColor: '#2D313A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonActive: {
    backgroundColor: 'rgba(245, 197, 24, 0.15)',
    borderColor: '#F5C518',
  },
  actionButtonActiveGreen: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: '#10B981',
  },
  actionButtonText: {
    color: '#E5E7EB',
    fontWeight: '700',
    fontSize: 13,
  },
  actionButtonTextActive: {
    color: '#F5C518',
    fontWeight: '800',
  },
  actionButtonTextActiveGreen: {
    color: '#10B981',
    fontWeight: '800',
  },
  trailerButton: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trailerButtonText: {
    color: '#EF4444',
    fontWeight: '700',
    fontSize: 13,
  },
  membershipRow: {
    marginTop: 14,
  },
  membershipLabel: {
    color: '#6B7280',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  membershipBadgesScroll: {
    gap: 8,
  },
  membershipBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#161920',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#252933',
  },
  membershipBadgeText: {
    color: '#E5E7EB',
    fontSize: 11,
    fontWeight: '600',
  },
  section: {
    marginTop: 24,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionHeading: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginBottom: 10,
  },
  sectionSubCount: {
    color: '#6B7280',
    fontSize: 12,
    fontWeight: '600',
  },
  overviewText: {
    color: '#9CA3AF',
    fontSize: 14,
    lineHeight: 22,
  },
  seasonsScroll: {
    gap: 8,
    paddingBottom: 4,
    marginBottom: 16,
  },
  seasonChip: {
    backgroundColor: '#14161B',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#262930',
    alignItems: 'center',
  },
  seasonChipActive: {
    backgroundColor: '#F5C518',
    borderColor: '#F5C518',
  },
  seasonChipText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  seasonChipTextActive: {
    color: '#000000',
    fontWeight: '800',
  },
  seasonEpCount: {
    color: '#6B7280',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  seasonEpCountActive: {
    color: 'rgba(0, 0, 0, 0.7)',
  },
  episodesLoading: {
    paddingVertical: 24,
    alignItems: 'center',
    gap: 8,
  },
  episodesLoadingText: {
    color: '#9CA3AF',
    fontSize: 12,
  },
  noEpisodesText: {
    color: '#6B7280',
    fontSize: 13,
    fontStyle: 'italic',
    paddingVertical: 12,
  },
  episodesList: {
    gap: 12,
  },
  episodeCard: {
    flexDirection: 'row',
    backgroundColor: '#14161B',
    borderRadius: 12,
    padding: 10,
    gap: 12,
    borderWidth: 1,
    borderColor: '#1E222A',
  },
  episodeThumbnail: {
    width: 110,
    height: 70,
    borderRadius: 8,
    backgroundColor: '#1C1F26',
  },
  episodeInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  episodeNumber: {
    color: '#F5C518',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  episodeTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
    marginBottom: 4,
  },
  episodeMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  episodeMetaText: {
    color: '#6B7280',
    fontSize: 11,
    fontWeight: '500',
  },
  episodeMetaDot: {
    color: '#4B5563',
    marginHorizontal: 6,
    fontSize: 10,
  },
  episodeRating: {
    color: '#F5C518',
    fontSize: 11,
    fontWeight: '700',
  },
  episodeOverview: {
    color: '#9CA3AF',
    fontSize: 12,
    lineHeight: 16,
  },
  castScroll: {
    gap: 12,
  },
  castCard: {
    width: 80,
    alignItems: 'center',
  },
  castAvatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#17191E',
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#262930',
  },
  castName: {
    color: '#E5E7EB',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    width: '100%',
  },
  characterName: {
    color: '#6B7280',
    fontSize: 10,
    textAlign: 'center',
    width: '100%',
    marginTop: 2,
  },

  // Watchlist Picker Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#16181D',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    borderWidth: 1,
    borderColor: '#23262F',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#23262F',
  },
  modalHeaderTitles: {
    flex: 1,
    marginRight: 12,
  },
  modalTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  modalSubtitle: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  modalCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1E2128',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalList: {
    flexGrow: 0,
    maxHeight: 380,
  },
  modalListContent: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 8,
  },
  modalEmptyState: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  modalEmptyText: {
    color: '#6B7280',
    fontSize: 13,
    fontStyle: 'italic',
  },
  watchlistPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1C1F26',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#262933',
  },
  watchlistPickerRowSelected: {
    borderColor: 'rgba(245, 197, 24, 0.4)',
    backgroundColor: 'rgba(245, 197, 24, 0.05)',
  },
  pickerRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  pickerRowTextCol: {
    flex: 1,
  },
  pickerRowName: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  pickerRowNameSelected: {
    color: '#F5C518',
  },
  pickerRowCount: {
    color: '#6B7280',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  pickerRowRight: {
    width: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickCreateSection: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#23262F',
  },
  createToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  createToggleText: {
    color: '#F5C518',
    fontSize: 14,
    fontWeight: '700',
  },
  quickCreateBox: {
    backgroundColor: '#1A1D24',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#282C36',
  },
  quickCreateTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  quickCreateInput: {
    backgroundColor: '#121418',
    borderWidth: 1,
    borderColor: '#2D323E',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#FFFFFF',
    fontSize: 14,
  },
  quickCreateInputError: {
    borderColor: '#EF4444',
  },
  quickCreateErrorText: {
    color: '#EF4444',
    fontSize: 12,
    marginTop: 6,
  },
  quickCreateActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 12,
  },
  quickCreateCancelButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
  },
  quickCreateCancelText: {
    color: '#9CA3AF',
    fontSize: 13,
    fontWeight: '600',
  },
  quickCreateSubmitButton: {
    backgroundColor: '#F5C518',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    minWidth: 100,
    alignItems: 'center',
  },
  quickCreateSubmitButtonDisabled: {
    opacity: 0.6,
  },
  quickCreateSubmitText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '800',
  },
  modalFooter: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#23262F',
  },
  modalDoneButton: {
    backgroundColor: '#F5C518',
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalDoneButtonText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '800',
  },
});
