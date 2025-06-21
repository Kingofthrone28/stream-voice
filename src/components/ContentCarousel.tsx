'use client';

import { useRef, useState, useEffect } from 'react';
import { Content } from '@/types/content';
import { CarouselButton } from './CarouselButton';
import { ContentCard } from './ContentCard';
import { fetchMovies, mapMovieToContent } from '@/services/moviesApi';

interface ContentCarouselClientProps {
  title: string;
  query?: string;
}

/**
 * Content carousel component that displays a horizontal scrollable list of items
 */
export const ContentCarousel = ({ title, query = '' }: ContentCarouselClientProps) => {
  const carouselRef = useRef<HTMLDivElement>(null);
  const [scrollPosition, setScrollPosition] = useState(0);
  const [items, setItems] = useState<Content[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const fetchContent = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const movies = await fetchMovies();
        
        if (movies.length === 0) {
          if (retryCount < 3) {
            // If we get no movies and haven't retried too many times, retry after a delay
            setTimeout(() => {
              setRetryCount(prev => prev + 1);
            }, 2000); // Retry after 2 seconds
            return;
          } else {
            setError('No movies available.');
            setItems([]);
            return;
          }
        }
        
        // Map all movies to content first
        const allContent = movies.map(mapMovieToContent);
        
        // Then filter based on query if provided
        let filteredContent = allContent;
        if (query) {
          const searchTerms = query.toLowerCase().split(' ');
          
          // Special handling for specific categories
          if (query === 'trending') {
            // Sort by rating and take top movies
            filteredContent = allContent.sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 10);
          } else if (query === 'popular shows') {
            // Sort by rating and take top movies
            filteredContent = allContent.sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 10);
          } else if (query === 'new releases') {
            // Sort by year (descending) and take recent movies
            filteredContent = allContent.sort((a, b) => b.year - a.year).slice(0, 10);
          } else if (query === 'action movies') {
            // For now, show all movies since we don't have genre information
            filteredContent = allContent;
          } else {
            // Default search behavior
            filteredContent = allContent.filter(content => 
              searchTerms.every(term =>
                content.title.toLowerCase().includes(term) ||
                content.description.toLowerCase().includes(term)
              )
            );
          }
        }
        
        if (filteredContent.length === 0) {
          setError('No results found for this category.');
          setItems([]);
          return;
        }
        
        setItems(filteredContent);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
        console.error('Error loading content:', err);
        setError(`Failed to load content: ${errorMessage}`);
      } finally {
        setIsLoading(false);
      }
    };

    fetchContent();
  }, [query, retryCount]);

  const scroll = (direction: 'left' | 'right') => {
    const container = carouselRef.current;
    if (!container) return;

    const scrollAmount = container.clientWidth * 0.8;
    const newPosition = direction === 'left' 
      ? Math.max(0, scrollPosition - scrollAmount)
      : Math.min(container.scrollWidth - container.clientWidth, scrollPosition + scrollAmount);

    container.scrollTo({
      left: newPosition,
      behavior: 'smooth'
    });
    setScrollPosition(newPosition);
  };

  if (isLoading) {
    return (
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-4">{title}</h2>
        <div className="flex gap-4 overflow-hidden">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex-none w-64 aspect-video bg-gray-800 animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-4">{title}</h2>
        <div className="p-4 bg-red-100 text-red-700 rounded-lg">
          {error}
          {retryCount < 3 && (
            <button
              onClick={() => setRetryCount(prev => prev + 1)}
              className="ml-4 underline hover:no-underline"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!items.length) {
    return null;
  }

  return (
    <div className="mb-8">
      <h2 className="text-2xl font-bold mb-4">{title}</h2>
      <div className="relative group">
        <div
          ref={carouselRef}
          className="flex gap-4 overflow-x-auto snap-x snap-mandatory scrollbar-hide"
        >
          {items.map((item) => (
            <ContentCard key={item.id} {...item} />
          ))}
        </div>
        
        {items.length > 4 && (
          <>
            <CarouselButton
              direction="left"
              onClick={() => scroll('left')}
              className="opacity-0 group-hover:opacity-100"
            />
            <CarouselButton
              direction="right"
              onClick={() => scroll('right')}
              className="opacity-0 group-hover:opacity-100"
            />
          </>
        )}
      </div>
    </div>
  );
}; 