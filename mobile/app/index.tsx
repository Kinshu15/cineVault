import React, { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Image,
  FlatList,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Movie } from '../types/tmdb';
import { getTrendingMovies, getPopularMovies, getTopRatedMovies, getImageUrl } from '../services/tmdb';

const POSTER_WIDTH = 120;
const POSTER_HEIGHT = 180;

export default function HomeScreen() {
  const [trending, setTrending] = useState<Movie[]>([]);
  const [popular, setPopular] = useState<Movie[]>([]);
  const [topRated, setTopRated] = useState<Movie[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [trendingData, popularData, topRatedData] = await Promise.all([
        getTrendingMovies('day'),
        getPopularMovies(1),
        getTopRatedMovies(1),
      ]);
      setTrending(trendingData);
      setPopular(popularData);
      setTopRated(topRatedData);
    } catch (err: any) {
      console.error('Error fetching TMDB data:', err);
      setError(err?.message || 'Failed to load movies. Check your connection or API key.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, [loadData]);

  const featuredMovie = trending[0];

  const renderMovieCard = ({ item }: { item: Movie }) => {
    const releaseYear = item.release_date ? item.release_date.substring(0, 4) : '';
    const rating = item.vote_average ? item.vote_average.toFixed(1) : 'NR';

    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.8}
        onPress={() => {
          // Movie details navigation will be hooked up in next step
        }}
      >
        <Image
          source={{ uri: getImageUrl(item.poster_path, 'w342') }}
          style={styles.poster}
          resizeMode="cover"
        />
        <View style={styles.ratingBadge}>
          <Text style={styles.ratingStar}>★</Text>
          <Text style={styles.ratingText}>{rating}</Text>
        </View>
        <Text style={styles.movieTitle} numberOfLines={1}>
          {item.title}
        </Text>
        {releaseYear ? <Text style={styles.movieYear}>{releaseYear}</Text> : null}
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#F5C518" />
        <Text style={styles.loadingText}>Loading cineVault...</Text>
      </SafeAreaView>
    );
  }

  if (error && trending.length === 0) {
    return (
      <SafeAreaView style={styles.centerContainer}>
        <Text style={styles.errorIcon}>⚠️</Text>
        <Text style={styles.errorTitle}>Unable to Load Movies</Text>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={loadData}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {/* Top Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.brandTitle}>cine<Text style={styles.brandGold}>Vault</Text></Text>
          <Text style={styles.brandSubtitle}>DISCOVER & TRACK</Text>
        </View>
        <TouchableOpacity style={styles.profileButton}>
          <Text style={styles.profileInitials}>CV</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#F5C518"
            colors={['#F5C518']}
          />
        }
      >
        {/* Featured Movie Banner */}
        {featuredMovie ? (
          <View style={styles.featuredContainer}>
            <Image
              source={{ uri: getImageUrl(featuredMovie.backdrop_path || featuredMovie.poster_path, 'original') }}
              style={styles.featuredBanner}
              resizeMode="cover"
            />
            <View style={styles.featuredOverlay}>
              <View style={styles.featuredBadge}>
                <Text style={styles.featuredBadgeText}>#1 TRENDING TODAY</Text>
              </View>
              <Text style={styles.featuredTitle} numberOfLines={2}>
                {featuredMovie.title}
              </Text>
              <View style={styles.featuredMeta}>
                <Text style={styles.featuredRating}>★ {featuredMovie.vote_average.toFixed(1)}</Text>
                <Text style={styles.featuredDot}>•</Text>
                <Text style={styles.featuredYear}>
                  {featuredMovie.release_date?.substring(0, 4)}
                </Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* Section 1: Trending Today */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Trending Today</Text>
          <Text style={styles.sectionCount}>{trending.length} titles</Text>
        </View>
        <FlatList
          data={trending}
          keyExtractor={(item) => `trending-${item.id}`}
          renderItem={renderMovieCard}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.horizontalList}
        />

        {/* Section 2: Popular Movies */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Popular Movies</Text>
          <Text style={styles.sectionCount}>{popular.length} titles</Text>
        </View>
        <FlatList
          data={popular}
          keyExtractor={(item) => `popular-${item.id}`}
          renderItem={renderMovieCard}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.horizontalList}
        />

        {/* Section 3: Top Rated */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Top Rated All Time</Text>
          <Text style={styles.sectionCount}>{topRated.length} titles</Text>
        </View>
        <FlatList
          data={topRated}
          keyExtractor={(item) => `toprated-${item.id}`}
          renderItem={renderMovieCard}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.horizontalList}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0B0C0E',
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
  retryButton: {
    backgroundColor: '#F5C518',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#000000',
    fontWeight: '700',
    fontSize: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#17191E',
  },
  brandTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  brandGold: {
    color: '#F5C518',
  },
  brandSubtitle: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6B7280',
    letterSpacing: 1.5,
    marginTop: 2,
  },
  profileButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#1C1F26',
    borderWidth: 1.5,
    borderColor: '#F5C518',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileInitials: {
    color: '#F5C518',
    fontWeight: '700',
    fontSize: 13,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  featuredContainer: {
    position: 'relative',
    height: 220,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#14161B',
  },
  featuredBanner: {
    width: '100%',
    height: '100%',
    opacity: 0.65,
  },
  featuredOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    backgroundColor: 'rgba(11, 12, 14, 0.75)',
  },
  featuredBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#F5C518',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    marginBottom: 6,
  },
  featuredBadgeText: {
    color: '#000000',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  featuredTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 4,
  },
  featuredMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  featuredRating: {
    color: '#F5C518',
    fontSize: 13,
    fontWeight: '700',
  },
  featuredDot: {
    color: '#6B7280',
    marginHorizontal: 8,
  },
  featuredYear: {
    color: '#9CA3AF',
    fontSize: 13,
    fontWeight: '500',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginTop: 24,
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  sectionCount: {
    color: '#6B7280',
    fontSize: 12,
    fontWeight: '600',
  },
  horizontalList: {
    paddingHorizontal: 16,
    gap: 12,
  },
  card: {
    width: POSTER_WIDTH,
  },
  poster: {
    width: POSTER_WIDTH,
    height: POSTER_HEIGHT,
    borderRadius: 10,
    backgroundColor: '#14161B',
    marginBottom: 6,
  },
  ratingBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 2,
  },
  ratingStar: {
    color: '#F5C518',
    fontSize: 10,
  },
  ratingText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  movieTitle: {
    color: '#E5E7EB',
    fontSize: 13,
    fontWeight: '600',
  },
  movieYear: {
    color: '#6B7280',
    fontSize: 11,
    marginTop: 2,
  },
});
