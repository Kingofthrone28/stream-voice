/**
 * Movie interface representing the structure of movie data
 */
export interface Movie {
  title: string;
  videoURL: string;
  year: number;
  rating: number;
  duration: string;
  cast: string[];
  thumbnail: string;
  subtitleUrl?: string;
  description: string;
}
