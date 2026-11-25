import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';
import { useAuth } from '../context/AuthContext';
import {
  getWatchlists,
  getWatchlistItems,
  createWatchlist,
  renameWatchlist,
  deleteWatchlist,
  removeWatchlistItem,
  ApiError,
  WatchlistSummary,
  WatchlistItemDetail,
  PaginationMetadata,
} from '../services/api';
import { getImageUrl } from '../../services/tmdb';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

interface ModalState {
  visible: boolean;
  mode: 'create' | 'rename';
  targetId: string;
  name: string;
  isSubmitting: boolean;
  error: string | null;
}

const DEFAULT_MODAL_STATE: ModalState = {
  visible: false,
  mode: 'create',
  targetId: '',
  name: '',
  isSubmitting: false,
  error: null,
};

export default function WatchlistScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { user, token, signOut } = useAuth();

  // Watchlists & Active Selection
  const [watchlists, setWatchlists] = useState<WatchlistSummary[]>([]);
  const [selectedWatchlistId, setSelectedWatchlistId] = useState<string | null>(null);

  // Items & Pagination for active selection
  const [items, setItems] = useState<WatchlistItemDetail[]>([]);
  const [pagination, setPagination] = useState<PaginationMetadata | null>(null);

  // Loading & Error states
  const [isLoadingWatchlists, setIsLoadingWatchlists] = useState<boolean>(true);
  const [isLoadingItems, setIsLoadingItems] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Manage Modal State (Create / Rename)
  const [modalState, setModalState] = useState<ModalState>(DEFAULT_MODAL_STATE);

  // Ref tracking currently active watchlist ID to eliminate race conditions
  const activeWatchlistIdRef = useRef<string | null>(null);

  // Helper to resolve the active Watchlist object
  const activeWatchlist = watchlists.find((w) => w.id === selectedWatchlistId) || null;

  /**
   * Loads items for a specific watchlist.
   * Protects against stale responses via activeWatchlistIdRef.
   */
  const loadItems = useCallback(
    async (watchlistId: string, page = 1, isInitial = false) => {
      if (!token) return;

      activeWatchlistIdRef.current = watchlistId;

      if (isInitial) {
        setIsLoadingItems(true);
      }
      setError(null);

      try {
        const response = await getWatchlistItems(watchlistId, { page, limit: 20 }, token);

        // Ignore response if user switched watchlists while request was in-flight
        if (activeWatchlistIdRef.current !== watchlistId) {
          return;
        }

        if (page === 1) {
          setItems(response.items);
        } else {
          setItems((prev) => [...prev, ...response.items]);
        }
        setPagination(response.pagination);
      } catch (err: unknown) {
        if (activeWatchlistIdRef.current !== watchlistId) {
          return;
        }

        if (err instanceof ApiError && err.status === 401) {
          await signOut();
          return;
        }

        const msg = err instanceof Error ? err.message : 'Failed to load watchlist items';
        setError(msg);
      } finally {
        if (activeWatchlistIdRef.current === watchlistId) {
          setIsLoadingItems(false);
          setIsRefreshing(false);
          setIsLoadingMore(false);
        }
      }
    },
    [token, signOut]
  );

  /**
   * Refreshes all watchlists and the active selection items.
   */
  const refreshAll = useCallback(
    async (isBackground = false) => {
      if (!token || !user) return;

      if (!isBackground) {
        setIsLoadingWatchlists(true);
      }
      setError(null);

      try {
        const response = await getWatchlists(token);
        const lists = response.watchlists;

        // Sort: default list first, followed by custom lists by creation order
        const sortedLists = [...lists].sort((a, b) => {
          if (a.isDefault) return -1;
          if (b.isDefault) return 1;
          return 0;
        });

        setWatchlists(sortedLists);

        // Determine which list should be selected
        let targetId = selectedWatchlistId;
        const exists = sortedLists.some((w) => w.id === targetId);
        if (!targetId || !exists) {
          const defaultList = sortedLists.find((w) => w.isDefault) || sortedLists[0];
          targetId = defaultList ? defaultList.id : null;
          setSelectedWatchlistId(targetId);
        }

        if (targetId) {
          await loadItems(targetId, 1, !isBackground);
        }
      } catch (err: unknown) {
        if (err instanceof ApiError && err.status === 401) {
          await signOut();
          return;
        }
        const msg = err instanceof Error ? err.message : 'Failed to load watchlists';
        setError(msg);
      } finally {
        setIsLoadingWatchlists(false);
        setIsRefreshing(false);
      }
    },
    [token, user, selectedWatchlistId, loadItems, signOut]
  );

  // Refresh data whenever screen gains focus
  useFocusEffect(
    useCallback(() => {
      if (token && user) {
        refreshAll(true);
      }
    }, [token, user, refreshAll])
  );

  // Handle explicit tab switching
  const handleSelectWatchlist = (watchlistId: string) => {
    if (watchlistId === selectedWatchlistId) return;
    setSelectedWatchlistId(watchlistId);
    setItems([]);
    setPagination(null);
    loadItems(watchlistId, 1, true);
  };

  // Pull-to-refresh
  const handlePullToRefresh = () => {
    setIsRefreshing(true);
    refreshAll(true);
  };

  // Infinite scroll load more
  const handleLoadMore = () => {
    if (
      isLoadingMore ||
      isLoadingItems ||
      isRefreshing ||
      !pagination ||
      !selectedWatchlistId ||
      pagination.page >= pagination.totalPages
    ) {
      return;
    }

    setIsLoadingMore(true);
    loadItems(selectedWatchlistId, pagination.page + 1, false);
  };

  // Remove item from selected watchlist
  const handleRemoveItem = (item: WatchlistItemDetail) => {
    if (!selectedWatchlistId || !token) return;

    const title = item.userMedia.title?.trim() || 'Title unavailable';
    const isWatched = item.userMedia.status === 'WATCHED';

    Alert.alert(
      'Remove from Watchlist',
      `Remove "${title}" from this watchlist?${
        isWatched ? '\n\n(Note: This title will remain in your viewing history.)' : ''
      }`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeWatchlistItem(selectedWatchlistId, item.userMediaId, token);

              // Update local items state
              setItems((prev) => prev.filter((i) => i.id !== item.id));

              // Decrement count in watchlists state
              setWatchlists((prev) =>
                prev.map((w) =>
                  w.id === selectedWatchlistId
                    ? { ...w, itemCount: Math.max(0, w.itemCount - 1) }
                    : w
                )
              );
            } catch (err: unknown) {
              if (err instanceof ApiError && err.status === 401) {
                await signOut();
                return;
              }
              const msg = err instanceof Error ? err.message : 'Failed to remove item';
              Alert.alert('Error', msg);
            }
          },
        },
      ]
    );
  };

  // Navigate to item details
  const handlePressItem = (item: WatchlistItemDetail) => {
    const type = item.userMedia.mediaType.toLowerCase() as 'movie' | 'tv';
    navigation.navigate('Details', {
      id: item.userMedia.tmdbId,
      type,
    });
  };

  // Modal open helpers
  const openCreateModal = () => {
    setModalState({
      visible: true,
      mode: 'create',
      targetId: '',
      name: '',
      isSubmitting: false,
      error: null,
    });
  };

  const openRenameModal = () => {
    if (!activeWatchlist || activeWatchlist.isDefault) return;
    setModalState({
      visible: true,
      mode: 'rename',
      targetId: activeWatchlist.id,
      name: activeWatchlist.name,
      isSubmitting: false,
      error: null,
    });
  };

  const closeModal = () => {
    if (modalState.isSubmitting) return;
    setModalState(DEFAULT_MODAL_STATE);
  };

  // Modal submit (Create / Rename)
  const handleModalSubmit = async () => {
    if (!token) return;

    const trimmed = modalState.name.trim();
    if (!trimmed) {
      setModalState((prev) => ({ ...prev, error: 'Watchlist name is required' }));
      return;
    }
    if (trimmed.length > 100) {
      setModalState((prev) => ({ ...prev, error: 'Name cannot exceed 100 characters' }));
      return;
    }

    setModalState((prev) => ({ ...prev, isSubmitting: true, error: null }));

    try {
      if (modalState.mode === 'create') {
        const created = await createWatchlist(trimmed, token);
        setWatchlists((prev) => [...prev, created]);
        setSelectedWatchlistId(created.id);
        setModalState(DEFAULT_MODAL_STATE);
        loadItems(created.id, 1, true);
      } else {
        const updated = await renameWatchlist(modalState.targetId, trimmed, token);
        setWatchlists((prev) =>
          prev.map((w) => (w.id === modalState.targetId ? { ...w, name: updated.name } : w))
        );
        setModalState(DEFAULT_MODAL_STATE);
      }
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 401) {
        closeModal();
        await signOut();
        return;
      }
      const msg = err instanceof Error ? err.message : 'Operation failed';
      setModalState((prev) => ({ ...prev, isSubmitting: false, error: msg }));
    }
  };

  // Delete watchlist confirmation
  const handleDeleteWatchlist = () => {
    if (!activeWatchlist || activeWatchlist.isDefault || !token) return;

    Alert.alert(
      'Delete Watchlist',
      `Are you sure you want to delete "${activeWatchlist.name}"?\n\nTitles in this list will remain in your viewing history and any other watchlists.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteWatchlist(activeWatchlist.id, token);

              // Remove from list and switch to default list
              const remaining = watchlists.filter((w) => w.id !== activeWatchlist.id);
              setWatchlists(remaining);

              const defaultList = remaining.find((w) => w.isDefault) || remaining[0] || null;
              const nextId = defaultList ? defaultList.id : null;
              setSelectedWatchlistId(nextId);

              if (nextId) {
                loadItems(nextId, 1, true);
              } else {
                setItems([]);
                setPagination(null);
              }
            } catch (err: unknown) {
              if (err instanceof ApiError && err.status === 401) {
                await signOut();
                return;
              }
              const msg = err instanceof Error ? err.message : 'Failed to delete watchlist';
              Alert.alert('Error', msg);
            }
          },
        },
      ]
    );
  };

  // ---------------------------------------------------------------------------
  // Render: Unauthenticated State
  // ---------------------------------------------------------------------------
  if (!token || !user) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Watchlist</Text>
        </View>

        <View style={styles.emptyContainer}>
          <Ionicons name="bookmark-outline" size={64} color="#F5C518" style={styles.emptyIcon} />
          <Text style={styles.emptyTitle}>Sign in to View Watchlist</Text>
          <Text style={styles.emptySubtitle}>
            Save movies, anime, and series to personal watchlists, track watched status, and sync
            across devices.
          </Text>
          <TouchableOpacity
            style={styles.browseButton}
            onPress={() => navigation.navigate('MainTabs', { screen: 'ProfileTab' })}
            activeOpacity={0.8}
          >
            <Text style={styles.browseButtonText}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: Initial Loading State
  // ---------------------------------------------------------------------------
  if (isLoadingWatchlists) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Watchlist</Text>
        </View>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#F5C518" />
          <Text style={styles.loadingText}>Loading your watchlists...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ---------------------------------------------------------------------------
  // Render Item Card in FlatList
  // ---------------------------------------------------------------------------
  const renderItem = ({ item }: { item: WatchlistItemDetail }) => {
    const title = item.userMedia.title?.trim() || 'Title unavailable';
    const releaseYear = item.userMedia.releaseDate
      ? item.userMedia.releaseDate.substring(0, 4)
      : '';
    const rating = item.userMedia.voteAverage
      ? item.userMedia.voteAverage.toFixed(1)
      : 'NR';
    const isWatched = item.userMedia.status === 'WATCHED';
    const mediaType = item.userMedia.mediaType;

    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.7}
        onPress={() => handlePressItem(item)}
      >
        <Image
          source={{ uri: getImageUrl(item.userMedia.posterPath, 'w185') }}
          style={styles.cardPoster}
          contentFit="cover"
          transition={200}
        />

        <View style={styles.cardInfo}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle} numberOfLines={2}>
              {title}
            </Text>
            <TouchableOpacity
              style={styles.removeButton}
              onPress={() => handleRemoveItem(item)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.7}
            >
              <Ionicons name="trash-outline" size={18} color="#9CA3AF" />
            </TouchableOpacity>
          </View>

          <View style={styles.cardMetaRow}>
            {releaseYear ? <Text style={styles.cardYear}>{releaseYear}</Text> : null}
            <View style={styles.typeBadge}>
              <Text style={styles.typeBadgeText}>{mediaType}</Text>
            </View>
            <View style={styles.ratingBadge}>
              <Ionicons name="star" size={11} color="#F5C518" />
              <Text style={styles.ratingText}>{rating}</Text>
            </View>
          </View>

          <View style={styles.cardBottomRow}>
            {isWatched ? (
              <View style={styles.statusBadgeWatched}>
                <Ionicons name="checkmark-circle" size={13} color="#22C55E" />
                <Text style={styles.statusTextWatched}>Watched</Text>
              </View>
            ) : (
              <View style={styles.statusBadgeWant}>
                <Ionicons name="bookmark" size={13} color="#F5C518" />
                <Text style={styles.statusTextWant}>In Watchlist</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  // ---------------------------------------------------------------------------
  // Render Main Screen
  // ---------------------------------------------------------------------------
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {/* Screen Header */}
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Text style={styles.headerTitle}>Watchlist</Text>
          <TouchableOpacity
            style={styles.headerAddButton}
            onPress={openCreateModal}
            activeOpacity={0.8}
          >
            <Ionicons name="add" size={18} color="#000000" />
            <Text style={styles.headerAddButtonText}>New List</Text>
          </TouchableOpacity>
        </View>

        {/* Watchlist Tabs Bar */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsContainer}
        >
          {watchlists.map((wl) => {
            const isSelected = wl.id === selectedWatchlistId;
            return (
              <TouchableOpacity
                key={wl.id}
                style={[styles.tabChip, isSelected && styles.tabChipActive]}
                onPress={() => handleSelectWatchlist(wl.id)}
                activeOpacity={0.8}
              >
                {wl.isDefault ? (
                  <Ionicons
                    name="star"
                    size={13}
                    color={isSelected ? '#F5C518' : '#9CA3AF'}
                    style={styles.tabDefaultIcon}
                  />
                ) : null}
                <Text style={[styles.tabChipText, isSelected && styles.tabChipTextActive]}>
                  {wl.name}
                </Text>
                <View style={[styles.countBadge, isSelected && styles.countBadgeActive]}>
                  <Text style={[styles.countBadgeText, isSelected && styles.countBadgeTextActive]}>
                    {wl.itemCount}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Inline Error Notification Banner */}
      {error ? (
        <View style={styles.errorBanner}>
          <Ionicons name="alert-circle" size={18} color="#F87171" />
          <Text style={styles.errorText} numberOfLines={2}>
            {error}
          </Text>
          <TouchableOpacity
            onPress={() => refreshAll()}
            style={styles.errorRetryButton}
            activeOpacity={0.8}
          >
            <Text style={styles.errorRetryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Selected Watchlist Controls (Rename/Delete for custom lists) */}
      {activeWatchlist && !activeWatchlist.isDefault ? (
        <View style={styles.listSubHeader}>
          <Text style={styles.listSubHeaderTitle} numberOfLines={1}>
            {activeWatchlist.name}
          </Text>
          <View style={styles.listActionsRow}>
            <TouchableOpacity
              style={styles.listActionButton}
              onPress={openRenameModal}
              activeOpacity={0.8}
            >
              <Ionicons name="create-outline" size={15} color="#9CA3AF" />
              <Text style={styles.listActionText}>Rename</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.listActionButton, styles.listDeleteButton]}
              onPress={handleDeleteWatchlist}
              activeOpacity={0.8}
            >
              <Ionicons name="trash-outline" size={15} color="#F87171" />
              <Text style={[styles.listActionText, styles.listDeleteText]}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {/* Items Feed */}
      {isLoadingItems ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#F5C518" />
          <Text style={styles.loadingText}>Loading titles...</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.listContent,
            items.length === 0 && styles.listContentEmpty,
          ]}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handlePullToRefresh}
              tintColor="#F5C518"
              colors={['#F5C518']}
            />
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            isLoadingMore ? (
              <View style={styles.loadMoreIndicator}>
                <ActivityIndicator size="small" color="#F5C518" />
              </View>
            ) : undefined
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons
                name={activeWatchlist?.isDefault ? 'bookmark-outline' : 'folder-open-outline'}
                size={56}
                color="#6B7280"
                style={styles.emptyIcon}
              />
              <Text style={styles.emptyTitle}>
                {activeWatchlist?.isDefault
                  ? 'Your Watchlist is Empty'
                  : `"${activeWatchlist?.name || 'List'}" is Empty`}
              </Text>
              <Text style={styles.emptySubtitle}>
                {activeWatchlist?.isDefault
                  ? 'Save movies, anime, and series you want to watch later.'
                  : 'Add titles to this list from any movie or series details screen.'}
              </Text>
              <TouchableOpacity
                style={styles.browseButton}
                onPress={() => navigation.navigate('MainTabs', { screen: 'HomeTab' })}
                activeOpacity={0.8}
              >
                <Text style={styles.browseButtonText}>Explore Titles</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}

      {/* Create / Rename Modal */}
      <Modal
        visible={modalState.visible}
        transparent
        animationType="fade"
        onRequestClose={closeModal}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {modalState.mode === 'create' ? 'Create Custom Watchlist' : 'Rename Watchlist'}
            </Text>

            <TextInput
              style={styles.modalInput}
              placeholder="e.g., Sci-Fi Favorites, Anime 2026"
              placeholderTextColor="#6B7280"
              value={modalState.name}
              onChangeText={(text) =>
                setModalState((prev) => ({ ...prev, name: text, error: null }))
              }
              maxLength={100}
              autoFocus
              editable={!modalState.isSubmitting}
            />

            {modalState.error ? (
              <Text style={styles.modalErrorText}>{modalState.error}</Text>
            ) : null}

            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={closeModal}
                disabled={modalState.isSubmitting}
                activeOpacity={0.8}
              >
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.modalSubmitButton,
                  modalState.isSubmitting && styles.modalSubmitButtonDisabled,
                ]}
                onPress={handleModalSubmit}
                disabled={modalState.isSubmitting}
                activeOpacity={0.8}
              >
                {modalState.isSubmitting ? (
                  <ActivityIndicator size="small" color="#000000" />
                ) : (
                  <Text style={styles.modalSubmitButtonText}>
                    {modalState.mode === 'create' ? 'Create' : 'Save'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// -----------------------------------------------------------------------------
// Styles
// -----------------------------------------------------------------------------
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0B0C0E',
  },
  header: {
    backgroundColor: '#0B0C0E',
    borderBottomWidth: 1,
    borderBottomColor: '#17191E',
  },
  headerTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  headerAddButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5C518',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    gap: 4,
  },
  headerAddButtonText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#000000',
  },
  tabsContainer: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  tabChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#17191E',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#262B34',
    gap: 6,
  },
  tabChipActive: {
    backgroundColor: '#1E232B',
    borderColor: '#F5C518',
  },
  tabDefaultIcon: {
    marginRight: -2,
  },
  tabChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  tabChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  countBadge: {
    backgroundColor: '#262B34',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countBadgeActive: {
    backgroundColor: '#F5C518',
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
  },
  countBadgeTextActive: {
    color: '#000000',
  },
  listSubHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#17191E',
  },
  listSubHeaderTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#D1D5DB',
    flex: 1,
    marginRight: 12,
  },
  listActionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  listActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#17191E',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#262B34',
    gap: 4,
  },
  listActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  listDeleteButton: {
    borderColor: '#7F1D1D',
    backgroundColor: '#1A1215',
  },
  listDeleteText: {
    color: '#F87171',
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  listContentEmpty: {
    flexGrow: 1,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: '#12151B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1F242D',
    overflow: 'hidden',
  },
  cardPoster: {
    width: 90,
    height: 135,
    backgroundColor: '#17191E',
  },
  cardInfo: {
    flex: 1,
    padding: 12,
    justifyContent: 'space-between',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 20,
  },
  removeButton: {
    padding: 2,
  },
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  cardYear: {
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '600',
  },
  typeBadge: {
    backgroundColor: '#1F242D',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#9CA3AF',
    letterSpacing: 0.5,
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F5C518',
  },
  cardBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  statusBadgeWatched: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  statusTextWatched: {
    fontSize: 11,
    fontWeight: '700',
    color: '#22C55E',
  },
  statusBadgeWant: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 197, 24, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    gap: 4,
  },
  statusTextWant: {
    fontSize: 11,
    fontWeight: '700',
    color: '#F5C518',
  },
  loadMoreIndicator: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#9CA3AF',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
  },
  emptyIcon: {
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  browseButton: {
    backgroundColor: '#F5C518',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 10,
  },
  browseButtonText: {
    color: '#000000',
    fontWeight: '800',
    fontSize: 14,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(248, 113, 113, 0.12)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(248, 113, 113, 0.25)',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: '#F87171',
    lineHeight: 18,
  },
  errorRetryButton: {
    backgroundColor: '#F87171',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
  },
  errorRetryText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#000000',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#17191E',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#262B34',
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 16,
  },
  modalInput: {
    backgroundColor: '#0E1015',
    borderWidth: 1,
    borderColor: '#262B34',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#FFFFFF',
    fontSize: 15,
  },
  modalErrorText: {
    marginTop: 8,
    fontSize: 13,
    color: '#F87171',
  },
  modalButtonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: 20,
    gap: 10,
  },
  modalCancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  modalCancelButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  modalSubmitButton: {
    backgroundColor: '#F5C518',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  modalSubmitButtonDisabled: {
    opacity: 0.6,
  },
  modalSubmitButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#000000',
  },
});
