export type MediaType = 'movie' | 'tv' | 'person';

export interface MediaItem {
  id: number;
  title?: string; // Movies
  name?: string; // TV shows, Anime, Web Series
  original_title?: string;
  original_name?: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date?: string; // Movies
  first_air_date?: string; // TV/Anime/Series
  vote_average: number;
  vote_count: number;
  genre_ids: number[];
  popularity: number;
  media_type?: MediaType;
}

// Backward compatibility alias
export type Movie = MediaItem;

export interface TMDBResponse<T> {
  page: number;
  results: T[];
  total_pages: number;
  total_results: number;
}
