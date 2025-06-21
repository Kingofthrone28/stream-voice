import { Suspense } from 'react';
import { ContentCarousel } from '@/components/ContentCarousel';

export default function Home() {
  return (
    <main className="p-4">
      <Suspense fallback={<div className="h-48 bg-gray-100 animate-pulse rounded-lg" />}>
        <ContentCarousel title="Trending Now" query="trending" />
      </Suspense>
      
      <Suspense fallback={<div className="h-48 bg-gray-100 animate-pulse rounded-lg" />}>
        <ContentCarousel title="New Releases" query="new releases" />
      </Suspense>

    </main>
  );
}
