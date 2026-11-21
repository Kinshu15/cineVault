import { Movie, TMDBResponse } from '../types/tmdb';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p';

const API_KEY = process.env.EXPO_PUBLIC_TMDB_API_KEY || '';
const READ_ACCESS_TOKEN = process.env.EXPO_PUBLIC_TMDB_READ_ACCESS_TOKEN || '';

const getHeaders = () => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (READ_ACCESS_TOKEN) {
    headers['Authorization'] = `Bearer ${READ_ACCESS_TOKEN}`;
  }
  return headers;
};

export const getImageUrl = (
  path: string | null,
  size: 'w185' | 'w342' | 'w500' | 'w780' | 'original' = 'w500'
): string => {
  if (!path) {
    return 'https://via.placeholder.com/500x750/14161B/9CA3AF?text=No+Poster';
  }
  return `${TMDB_IMAGE_BASE_URL}/${size}${path}`;
};

export const getTrendingMovies = async (timeWindow: 'day' | 'week' = 'day'): Promise<Movie[]> => {
  const url = READ_ACCESS_TOKEN
    ? `${TMDB_BASE_URL}/trending/movie/${timeWindow}`
    : `${TMDB_BASE_URL}/trending/movie/${timeWindow}?api_key=${API_KEY}`;

  const response = await fetch(url, { headers: getHeaders() });
  if (!response.ok) {
    throw new Error(`Failed to fetch trending movies: ${response.status}`);
  }
  const data: TMDBResponse<Movie> = await response.json();
  return data.results;
};

export const getPopularMovies = async (page = 1): Promise<Movie[]> => {
  const url = READ_ACCESS_TOKEN
    ? `${TMDB_BASE_URL}/movie/popular?page=${page}`
    : `${TMDB_BASE_URL}/movie/popular?api_key=${API_KEY}&page=${page}`;

  const response = await fetch(url, { headers: getHeaders() });
  if (!response.ok) {
    throw new Error(`Failed to fetch popular movies: ${response.status}`);
  }
  const data: TMDBResponse<Movie> = await response.json();
  return data.results;
};

export const getTopRatedMovies = async (page = 1): Promise<Movie[]> => {
  const url = READ_ACCESS_TOKEN
    ? `${TMDB_BASE_URL}/movie/top_rated?page=${page}`
    : `${TMDB_BASE_URL}/movie/top_rated?api_key=${API_KEY}&page=${page}`;

  const response = await fetch(url, { headers: getHeaders() });
  if (!response.ok) {
    throw new Error(`Failed to fetch top rated movies: ${response.status}`);
  }
  const data: TMDBResponse<Movie> = await response.json();
  return data.results;
};

export const searchMovies = async (query: string, page = 1): Promise<Movie[]> => {
  if (!query.trim()) {
    return [];
  }
  const encodedQuery = encodeURIComponent(query.trim());
  const url = READ_ACCESS_TOKEN
    ? `${TMDB_BASE_URL}/search/movie?query=${encodedQuery}&page=${page}&include_adult=false`
    : `${TMDB_BASE_URL}/search/movie?api_key=${API_KEY}&query=${encodedQuery}&page=${page}&include_adult=false`;

  const response = await fetch(url, { headers: getHeaders() });
  if (!response.ok) {
    throw new Error(`Failed to search movies: ${response.status}`);
  }
  const data: TMDBResponse<Movie> = await response.json();
  return data.results;
};
