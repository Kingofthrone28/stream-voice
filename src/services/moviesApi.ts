import { Content } from '@/types/content';
import { Movie } from '@/types/movie';

export const fetchMovies = async (): Promise<Movie[]> => {
  try {
    const response = await fetch('/api/movies', {
      next: { revalidate: 3600 } // Cache for 1 hour
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch movies: ${response.status} ${response.statusText}`);
    }

    const movies = await response.json();
    
    if (!Array.isArray(movies)) {
      throw new Error('Invalid response format: expected an array of movies');
    }

    return movies;
  } catch (error) {
    console.error('Failed to fetch movies:', error);
    return [];
  }
};

export const fetchMovieByVideoUrl = async (videoURL: string): Promise<Movie | null> => {
  try {
    const response = await fetch(`/api/movies?video=${encodeURIComponent(videoURL)}`, {
      next: { revalidate: 3600 } // Cache for 1 hour
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Failed to fetch movie: ${response.status} ${response.statusText}`);
    }

    const movie = await response.json();
    return movie;
  } catch (error) {
    console.error('Failed to fetch movie:', error);
    return null;
  }
};

export const mapMovieToContent = (movie: Movie): Content => ({
  id: movie.title.toLowerCase().replace(/\s+/g, '-'),
  title: movie.title,
  description: movie.description,
  imageUrl: movie.thumbnail,
  videoUrl: movie.videoURL,
  type: 'movie',
  year: movie.year,
  rating: movie.rating,
  genres: [], // Our movie data doesn't include genres yet
}); 