import { CarouselButtonProps } from '@/types/content';

/**
 * Navigation button component for the carousel
 * Provides directional navigation with hover effects and accessibility
 * 
 * @component
 * @example
 * ```tsx
 * <CarouselButton
 *   direction="left"
 *   onClick={() => scroll('left')}
 *   disabled={isAtStart}
 * />
 * ```
 */
export const CarouselButton = ({
  direction,
  onClick,
  disabled = false,
  className = '',
}: CarouselButtonProps) => {
  const baseClasses = 'absolute top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/75 text-white p-2 rounded-full transition-all duration-200';
  const positionClasses = direction === 'left' ? 'left-2' : 'right-2';
  const combinedClasses = `${baseClasses} ${positionClasses} ${className}`.trim();

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={combinedClasses}
      aria-label={`Scroll ${direction}`}
    >
      {direction === 'left' ? (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      )}
    </button>
  );
}; 