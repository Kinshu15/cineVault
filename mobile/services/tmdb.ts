import { MediaItem, TMDBResponse } from '../types/tmdb';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p';

const API_KEY = process.env.EXPO_PUBLIC_TMDB_API_KEY || 'd7d82b9db458a436009ba3ed24f5eb43';

export const getImageUrl = (
  path: string | null,
  size: 'w185' | 'w342' | 'w500' | 'w780' | 'original' = 'w500'
): string => {
  if (!path) {
    return 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=500&q=80';
  }
  return `${TMDB_IMAGE_BASE_URL}/${size}${path}`;
};

export const getTrendingAll = async (timeWindow: 'day' | 'week' = 'day'): Promise<MediaItem[]> => {
  const url = `${TMDB_BASE_URL}/trending/all/${timeWindow}?api_key=${API_KEY}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch trending titles: HTTP ${response.status}`);
  }
  const data: TMDBResponse<MediaItem> = await response.json();
  return (data.results || []).filter((item) => item.media_type !== 'person');
};

// Aliases for compatibility
export const getTrendingMovies = getTrendingAll;

export const getPopularMovies = async (page = 1): Promise<MediaItem[]> => {
  const url = `${TMDB_BASE_URL}/movie/popular?api_key=${API_KEY}&page=${page}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch popular movies: HTTP ${response.status}`);
  }
  const data: TMDBResponse<MediaItem> = await response.json();
  return (data.results || []).map((m) => ({ ...m, media_type: 'movie' as const }));
};

export const getPopularTVShows = async (page = 1): Promise<MediaItem[]> => {
  const url = `${TMDB_BASE_URL}/tv/popular?api_key=${API_KEY}&page=${page}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch popular TV series: HTTP ${response.status}`);
  }
  const data: TMDBResponse<MediaItem> = await response.json();
  return (data.results || []).map((t) => ({ ...t, media_type: 'tv' as const }));
};

export const getTopRatedMovies = async (page = 1): Promise<MediaItem[]> => {
  const url = `${TMDB_BASE_URL}/movie/top_rated?api_key=${API_KEY}&page=${page}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch top rated titles: HTTP ${response.status}`);
  }
  const data: TMDBResponse<MediaItem> = await response.json();
  return (data.results || []).map((m) => ({ ...m, media_type: 'movie' as const }));
};

const calculateRelevanceScore = (title: string, query: string, popularity: number): number => {
  const t = (title || '').toLowerCase().trim();
  const q = (query || '').toLowerCase().trim();

  if (!t || !q) return popularity;

  // Tier 1: Exact match (e.g. "Naruto" === "naruto")
  if (t === q) {
    return 1_000_000 + popularity;
  }

  // Tier 2: Starts with the search term (e.g. "Naruto Shippuden...", "Naruto: ...")
  if (t.startsWith(q + ' ') || t.startsWith(q + ':') || t.startsWith(q + ' -') || t.startsWith(q + '–')) {
    return 500_000 + popularity;
  }

  if (t.startsWith(q)) {
    return 250_000 + popularity;
  }

  // Tier 3: Contains the query as a standalone word (e.g. "The Last: Naruto the Movie")
  const words = t.split(/[\s:,\-_!?()[\]{}'"]+/).filter(Boolean);
  if (words.includes(q)) {
    return 100_000 + popularity;
  }

  // Tier 4: Substring match anywhere
  if (t.includes(q)) {
    return 10_000 + popularity;
  }

  return popularity;
};

export const searchMulti = async (query: string, page = 1): Promise<MediaItem[]> => {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return [];
  }
  const encodedQuery = encodeURIComponent(trimmedQuery);
  const url = `${TMDB_BASE_URL}/search/multi?api_key=${API_KEY}&query=${encodedQuery}&page=${page}&include_adult=false`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to search titles: HTTP ${response.status}`);
  }
  const data: TMDBResponse<MediaItem> = await response.json();
  
  // Filter out people (actors/crew) so we only display movies, TV shows, and anime series
  const results = (data.results || []).filter(
    (item) => item.media_type === 'movie' || item.media_type === 'tv'
  );

  return [...results].sort((a, b) => {
    const titleA = a.title || a.name || a.original_title || a.original_name || '';
    const titleB = b.title || b.name || b.original_title || b.original_name || '';

    const scoreA = calculateRelevanceScore(titleA, trimmedQuery, a.popularity || 0);
    const scoreB = calculateRelevanceScore(titleB, trimmedQuery, b.popularity || 0);
    return scoreB - scoreA;
  });
};

// Backward compatibility alias
export const searchMovies = searchMulti;
