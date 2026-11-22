import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { MediaItem } from '../../types/tmdb';
import { searchMulti, getImageUrl } from '../../services/tmdb';

const { width } = Dimensions.get('window');
const GRID_ITEM_WIDTH = (width - 44) / 2;
const GRID_POSTER_HEIGHT = GRID_ITEM_WIDTH * 1.5;

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

type FilterType = 'all' | 'movie' | 'tv';

export default function SearchScreen() {
  const navigation = useNavigation<NavigationProp>();

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<MediaItem[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await searchMulti(trimmed);
        setSearchResults(results);
      } catch (err) {
        console.error('Search error:', err);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 350);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery]);

  const handleClearSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
    setIsSearching(false);
  };

  const getItemTitle = (item: MediaItem) => item.title || item.name || 'Untitled';
  const getItemYear = (item: MediaItem) => {
    const date = item.release_date || item.first_air_date;
    return date ? date.substring(0, 4) : '';
  };
  const isSeries = (item: MediaItem) => item.media_type === 'tv' || (!item.title && !!item.name);

  const navigateToDetails = (item: MediaItem) => {
    navigation.navigate('Details', {
      id: item.id,
      type: isSeries(item) ? 'tv' : 'movie',
    });
  };

  const filteredResults = searchResults.filter((item) => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'movie') return !isSeries(item);
    if (activeFilter === 'tv') return isSeries(item);
    return true;
  });

  const renderGridCard = ({ item }: { item: MediaItem }) => {
    const title = getItemTitle(item);
    const releaseYear = getItemYear(item);
    const rating = item.vote_average ? item.vote_average.toFixed(1) : 'NR';
    const series = isSeries(item);

    return (
      <TouchableOpacity
        style={styles.gridCard}
        activeOpacity={0.8}
        onPress={() => navigateToDetails(item)}
      >
        <Image
          source={{ uri: getImageUrl(item.poster_path, 'w342') }}
          style={styles.gridPoster}
          contentFit="cover"
          transition={150}
        />
        <View style={styles.badgeRow}>
          <View style={[styles.typeBadge, series ? styles.seriesBadge : styles.movieBadge]}>
            <Text style={styles.typeBadgeText}>{series ? 'SERIES' : 'MOVIE'}</Text>
          </View>
          <View style={styles.ratingBadge}>
            <Text style={styles.ratingStar}>★</Text>
            <Text style={styles.ratingText}>{rating}</Text>
          </View>
        </View>
        <Text style={styles.movieTitle} numberOfLines={1}>
          {title}
        </Text>
        {releaseYear ? <Text style={styles.movieYear}>{releaseYear}</Text> : null}
      </TouchableOpacity>
    );
  };

  const isSearchActive = searchQuery.trim().length > 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {/* Top Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Search</Text>
      </View>

      {/* Search Input Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Movies, TV shows, anime..."
            placeholderTextColor="#6B7280"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {searchQuery.length > 0 ? (
            <TouchableOpacity onPress={handleClearSearch} style={styles.clearButton} hitSlop={8}>
              <Text style={styles.clearButtonText}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Filter Chips */}
      {isSearchActive ? (
        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[styles.filterChip, activeFilter === 'all' && styles.filterChipActive]}
            onPress={() => setActiveFilter('all')}
          >
            <Text style={[styles.filterChipText, activeFilter === 'all' && styles.filterChipTextActive]}>
              All
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterChip, activeFilter === 'tv' && styles.filterChipActive]}
            onPress={() => setActiveFilter('tv')}
          >
            <Text style={[styles.filterChipText, activeFilter === 'tv' && styles.filterChipTextActive]}>
              Series & Anime
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterChip, activeFilter === 'movie' && styles.filterChipActive]}
            onPress={() => setActiveFilter('movie')}
          >
            <Text style={[styles.filterChipText, activeFilter === 'movie' && styles.filterChipTextActive]}>
              Movies
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Content Area */}
      {!isSearchActive ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>🎬</Text>
          <Text style={styles.emptyTitle}>Find Your Next Watch</Text>
          <Text style={styles.emptySubtitle}>
            Search across millions of movies, anime series, and TV shows by title.
          </Text>
        </View>
      ) : isSearching ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#F5C518" />
          <Text style={styles.loadingText}>Searching...</Text>
        </View>
      ) : filteredResults.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>🔍</Text>
          <Text style={styles.emptyTitle}>No Results Found</Text>
          <Text style={styles.emptySubtitle}>
            No titles matched &ldquo;{searchQuery.trim()}&rdquo;. Try another name.
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredResults}
          keyExtractor={(item, index) => `search-${item.id}-${index}`}
          renderItem={renderGridCard}
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.gridContent}
          showsVerticalScrollIndicator={false}
        />
      )}
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
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  searchContainer: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#14161B',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 46,
    borderWidth: 1,
    borderColor: '#23262F',
  },
  searchIcon: {
    fontSize: 15,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
  },
  clearButton: {
    padding: 4,
  },
  clearButtonText: {
    color: '#9CA3AF',
    fontSize: 14,
    fontWeight: '700',
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
    backgroundColor: '#17191E',
    borderWidth: 1,
    borderColor: '#23262F',
  },
  filterChipActive: {
    backgroundColor: '#F5C518',
    borderColor: '#F5C518',
  },
  filterChipText: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: '#000000',
    fontWeight: '800',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  loadingText: {
    color: '#9CA3AF',
    marginTop: 12,
    fontSize: 14,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: 80,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptySubtitle: {
    color: '#9CA3AF',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  gridContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  gridRow: {
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  gridCard: {
    width: GRID_ITEM_WIDTH,
  },
  gridPoster: {
    width: GRID_ITEM_WIDTH,
    height: GRID_POSTER_HEIGHT,
    borderRadius: 10,
    backgroundColor: '#14161B',
    marginBottom: 6,
  },
  badgeRow: {
    position: 'absolute',
    top: 6,
    left: 6,
    right: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  typeBadge: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  movieBadge: {
    backgroundColor: 'rgba(229, 9, 20, 0.85)',
  },
  seriesBadge: {
    backgroundColor: 'rgba(59, 130, 246, 0.85)',
  },
  typeBadgeText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  ratingBadge: {
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
