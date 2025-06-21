import Link from 'next/link';
import Image from 'next/image';
import { Content } from '@/types/content';

/**
 * Content item card component that displays media information with hover effects
 * 
 * @component
 * @example
 * ```tsx
 * <ContentCard
 *   id="123"
 *   title="Movie Title"
 *   imageUrl="https://streavoice.s3.us-east-2.amazonaws.com/image.jpg"
 *   // ... other props
 * />
 * ```
 */
export const ContentCard = ({
  id,
  title,
  imageUrl,
  year,
  rating,
  genres,
}: Content) => {
  return (
    <Link
      href={`/watch/${id}`}
      className="flex-none w-64 snap-start group/item"
    >
      <div className="relative aspect-video rounded-lg overflow-hidden bg-gray-800">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={title}
            fill
            className="object-cover transform group-hover/item:scale-105 transition duration-300"
            unoptimized
          />
        ) : (
          <div className="w-full h-full bg-gray-700 flex items-center justify-center">
            <span className="text-gray-400 text-sm">No Image</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover/item:opacity-100 transition-opacity" />
        <div className="absolute bottom-2 left-3 right-3 text-white opacity-0 group-hover/item:opacity-100 transition-opacity duration-300">
          <h3 className="font-bold truncate text-md">{title}</h3>
          <div className="flex items-center text-xs gap-2 mt-1 text-gray-300">
            {year && <span>{year}</span>}
            {rating && (
              <>
                <span>•</span>
                <span>⭐ {rating.toFixed(1)}</span>
              </>
            )}
            {genres && genres.length > 0 && (
              <>
                <span>•</span>
                <span className="truncate">{genres.join(', ')}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}; 