import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Base URL of the public API bucket that hosts movies.json (optional).
 * If not provided, we fall back to a local copy of movies.json in the repo root.
 */
const MOVIES_API_URL = process.env.NEXT_PUBLIC_API_HOST;

/**
 * Fetch the movies data, trying the remote bucket first (if configured) and
 * falling back to the local `movies.json` file bundled with the repo.
 */
async function fetchMoviesData() {
  // 1. Try remote bucket if URL is supplied
  if (MOVIES_API_URL) {
    try {
      const response = await fetch(`${MOVIES_API_URL}/movies.json`, {
        headers: { 'Accept': 'application/json' },
        next: { revalidate: 3600 },
      });

      if (response.ok) {
        return response.json();
      }

      console.warn(`Remote movies.json returned ${response.status}. Falling back to local file.`);
    } catch (err) {
      console.warn('Failed to fetch remote movies.json. Falling back to local file.', err);
    }
  }

  // 2. Fallback: read local movies.json from project root
  const filePath = path.join(process.cwd(), 'movies.json');
  const fileContent = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(fileContent);
}

export async function GET(request: Request) {
  try {
    const movies = await fetchMoviesData();
    return NextResponse.json(movies);
  } catch (error) {
    console.error('Error in GET handler:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}

// Handle OPTIONS requests for CORS
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
} 