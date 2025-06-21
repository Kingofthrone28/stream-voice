import './globals.css';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { NavBar } from '@/components/NavBar';

export const metadata = {
  title: 'StreamVoice - Voice-Controlled Streaming Platform',
  description: 'A modern streaming platform with voice control capabilities',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <NavBar />
        <div className="pt-16">
          {children}
        </div>

        <footer className="bg-background border-t border-foreground/10 mt-16">
          <div className="max-w-screen-2xl mx-auto px-4 py-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div>
                <h3 className="text-lg font-semibold mb-4">About StreamVoice</h3>
                <p className="text-foreground/60">
                  A modern streaming platform with voice control capabilities,
                  built with Next.js and TypeScript.
                </p>
              </div>
              
              <div>
                <h3 className="text-lg font-semibold mb-4">Voice Commands</h3>
                <ul className="space-y-2 text-foreground/60">
                  <li>Play/Pause</li>
                  <li>Skip Intro</li>
                  <li>Enable/Disable Subtitles (CC for Avengers Infinity War Only)</li>
                  <li>Search Content</li>
                </ul>
              </div>
              
              <div>
                <h3 className="text-lg font-semibold mb-4">Technologies</h3>
                <ul className="space-y-2 text-foreground/60">
                  <li>Next.js</li>
                  <li>TypeScript</li>
                  <li>Tailwind CSS</li>
                  <li>Web Speech API</li>
                </ul>
              </div>
            </div>
            
            <div className="mt-8 pt-8 border-t border-foreground/10 text-center text-foreground/60">
              <p>© 2025 StreamVoice Beta</p>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
