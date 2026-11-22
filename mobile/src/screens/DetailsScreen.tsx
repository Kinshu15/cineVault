import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/types';
import { MediaDetails, Episode, Season } from '../../types/tmdb';
import { getMediaDetails, getSeasonDetails, getImageUrl } from '../../services/tmdb';

const BACKDROP_HEIGHT = 280;

type DetailsRouteProp = RouteProp<RootStackParamList, 'Details'>;

export default function DetailsScreen() {
  const route = useRoute<DetailsRouteProp>();
  const navigation = useNavigation();
  const { id, type } = route.params;

  const [details, setDetails] = useState<MediaDetails | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Series / Anime Season & Episode states
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loadingEpisodes, setLoadingEpisodes] = useState<boolean>(false);

  // User list interaction states
  const [inWatchlist, setInWatchlist] = useState<boolean>(false);
  const [isWatched, setIsWatched] = useState<boolean>(false);

  useEffect(() => {
    if (!id) return;

    const fetchDetails = async () => {
      try {
        setLoading(true);
        setError(null);
        const mediaType = type === 'tv' ? 'tv' : 'movie';
        const data = await getMediaDetails(id, mediaType);
        setDetails(data);

        // If series, initialize with the first real season
        if (mediaType === 'tv' && data.seasons && data.seasons.length > 0) {
          const firstRegularSeason = data.seasons.find((s) => s.season_number > 0) || data.seasons[0];
          setSelectedSeason(firstRegularSeason.season_number);
        }
      } catch (err: any) {
        console.error('Failed to load media details:', err);
        setError(err?.message || 'Failed to load details.');
      } finally {
        setLoading(false);
      }
    };

    fetchDetails();
  }, [id, type]);

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
  const isSeries = details.media_type === 'tv' || (!details.title && !!details.name);

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
                {details.status ? (
                  <Text style={styles.statusText}>{details.status}</Text>
                ) : null}
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
            <TouchableOpacity
              style={[styles.actionButton, inWatchlist && styles.actionButtonActive]}
              onPress={() => setInWatchlist(!inWatchlist)}
              activeOpacity={0.8}
            >
              <Text style={[styles.actionButtonText, inWatchlist && styles.actionButtonTextActive]}>
                {inWatchlist ? '✓ In Watchlist' : '+ Watchlist'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, isWatched && styles.actionButtonActiveGreen]}
              onPress={() => setIsWatched(!isWatched)}
              activeOpacity={0.8}
            >
              <Text style={[styles.actionButtonText, isWatched && styles.actionButtonTextActiveGreen]}>
                {isWatched ? '✓ Watched' : 'Mark Watched'}
              </Text>
            </TouchableOpacity>

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
    backgroundColor: '#F5C518',
    borderColor: '#F5C518',
  },
  actionButtonActiveGreen: {
    backgroundColor: '#10B981',
    borderColor: '#10B981',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  actionButtonTextActive: {
    color: '#000000',
    fontWeight: '800',
  },
  actionButtonTextActiveGreen: {
    color: '#FFFFFF',
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
});
