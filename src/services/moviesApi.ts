import { Content } from '@/types/content';
import { Movie } from '@/types/movie';

const CACHE = { next: { revalidate: 3600 } } as const;

export const slugify = (title: string): string =>
  title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/[\s-]+/g, '-');

export const fetchMovies = async (): Promise<Movie[]> => {
  try {
    const res = await fetch('/api/movies', CACHE);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
};

export const fetchMovieByVideoUrl = async (videoURL: string): Promise<Movie | null> => {
  try {
    const res = await fetch(`/api/movies?video=${encodeURIComponent(videoURL)}`, CACHE);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
};

export const mapMovieToContent = (movie: Movie): Content => ({
  id: slugify(movie.title),
  title: movie.title,
  description: movie.description,
  imageUrl: movie.thumbnail,
  videoUrl: movie.videoURL,
  type: 'movie',
  year: movie.year,
  rating: movie.rating,
  genres: [],
});
