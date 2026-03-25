import { VideoPlayer } from '@/components/VideoPlayer';
import { VoiceControlInfo } from '@/components/VoiceControlInfo';
import { notFound } from 'next/navigation';
import { Movie } from '@/types/movie';
import { slugify } from '@/services/moviesApi';

async function getMovieById(id: string): Promise<Movie> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/movies`, {
    next: {
      revalidate: 3600
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch movies: ${response.status} ${response.statusText}`);
  }

  const movies: Movie[] = await response.json();
  const movie = movies.find((m) => slugify(m.title) === id);

  if (!movie) {
    notFound();
  }

  return movie;
}

export default async function WatchPage({
  params,
}: {
  params: { id: string };
}) {
  const movie = await getMovieById(params.id);

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-screen-2xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <VideoPlayer
              src={movie.videoURL}
              title={movie.title}
              poster={movie.thumbnail}
              subtitleUrl={movie.subtitleUrl}
            />
            
            <div className="mt-6">
              <h1 className="text-3xl font-bold mb-4">{movie.title}</h1>
              <p className="text-foreground/80 leading-relaxed">
                {movie.description}
              </p>
            </div>
          </div>
          
          <div className="lg:col-span-1">
            <VoiceControlInfo />
            <div className="mt-8 p-4 rounded-lg bg-foreground/5">
              <h2 className="text-xl font-semibold mb-4">Available Voice Commands</h2>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <li className="flex items-center gap-2">
                  <span className="text-foreground/60">🎤</span>
                  "Play movie"
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-foreground/60">🎤</span>
                  "Pause movie"
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-foreground/60">🎤</span>
                  "Skip intro"
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-foreground/60">🎤</span>
                  "Turn on subtitles"
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-foreground/60">🎤</span>
                  "Turn off subtitles"
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
} 