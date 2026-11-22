export type MediaType = 'movie' | 'tv' | 'person';

export interface Genre {
  id: number;
  name: string;
}

export interface CastMember {
  id: number;
  name: string;
  original_name?: string;
  character: string;
  profile_path: string | null;
  order: number;
}

export interface VideoItem {
  id: string;
  key: string;
  name: string;
  site: string;
  type: string;
}

export interface Episode {
  id: number;
  name: string;
  overview: string;
  episode_number: number;
  season_number: number;
  still_path: string | null;
  air_date: string;
  vote_average: number;
  runtime?: number;
}

export interface Season {
  id: number;
  name: string;
  overview?: string;
  season_number: number;
  episode_count: number;
  poster_path: string | null;
  air_date?: string;
}

export interface SeasonDetails {
  id: number;
  name: string;
  overview: string;
  season_number: number;
  episodes: Episode[];
}

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

export interface MediaDetails extends MediaItem {
  tagline?: string;
  genres: Genre[];
  runtime?: number; // Minutes for movies
  episode_run_time?: number[];
  number_of_seasons?: number; // TV
  number_of_episodes?: number; // TV
  seasons?: Season[]; // TV seasons list
  status?: string;
  credits?: {
    cast: CastMember[];
  };
  videos?: {
    results: VideoItem[];
  };
}

// Backward compatibility alias
export type Movie = MediaItem;

export interface TMDBResponse<T> {
  page: number;
  results: T[];
  total_pages: number;
  total_results: number;
}
