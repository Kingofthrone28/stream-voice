# 🎬 Streaming Platform

A modern, voice-controlled streaming platform built with Next.js 14, featuring an intuitive interface for discovering and watching movies with advanced voice control capabilities.

## ✨ Features

### 🎥 Video Streaming
- **High-quality video playback** with custom video player
- **Subtitle support** with voice-controlled on/off toggle  
- **Responsive video player** that adapts to different screen sizes
- **Movie poster thumbnails** and metadata display

### 🎤 Voice Control System
- **Intelligent voice recognition** with browser compatibility detection
- **Multi-browser support** with fallback modes for optimal performance
- **Voice commands** for video playback control:
  - "Play movie" / "Pause movie"
  - "Skip intro" 
  - "Turn on/off subtitles"
- **Real-time status** showing current recognition mode and browser compatibility

### 🎨 Modern UI/UX
- **Content carousels** with smooth horizontal scrolling
- **Hover effects** on content cards with animated overlays
- **Responsive design** optimized for desktop, tablet, and mobile
- **Dark/light theme** support with Tailwind CSS
- **Loading states** with skeleton animations
- **Clean typography** using Geist font family

### 📱 Content Discovery
- **Trending content** carousel on homepage
- **New releases** section with latest movies
- **Genre filtering** and content categorization
- **Movie ratings** and year information display
- **Detailed movie pages** with descriptions and metadata

### ⚡ Performance & Architecture
- **Next.js 14** with Turbo mode for fast development
- **Server-side rendering** for improved SEO and performance
- **Image optimization** with Next.js Image component
- **API routes** for content management
- **TypeScript** for type safety and better developer experience
- **Framer Motion** for smooth animations and transitions

## 🛠️ Tech Stack

- **Framework**: Next.js 14 with TypeScript
- **Styling**: Tailwind CSS
- **Animation**: Framer Motion
- **State Management**: Redux Toolkit
- **Icons**: FontAwesome
- **Development**: Turbo mode for faster builds

## 🚀 Getting Started

### Prerequisites
- Node.js (version 16 or higher)
- npm, yarn, pnpm, or bun

### Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd streaming-platform
```

2. Install dependencies:
```bash
npm install
# or
yarn install
# or
pnpm install
```

3. Set up environment variables:
Create a `.env.local` file in the root directory:
```bash
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

4. Run the development server:
```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser to see the application.

## 📁 Project Structure

```
src/
├── app/                    # Next.js app router
│   ├── api/               # API routes
│   ├── watch/[id]/        # Dynamic video player pages
│   └── layout.tsx         # Root layout
├── components/            # Reusable UI components
│   ├── ContentCard.tsx    # Movie/content card component
│   ├── ContentCarousel.tsx # Horizontal scrolling carousel
│   ├── VideoPlayer.tsx    # Custom video player
│   ├── VoiceControlInfo.tsx # Voice control status
│   └── NavBar.tsx         # Navigation component
├── types/                 # TypeScript type definitions
├── utils/                 # Utility functions
├── hooks/                 # Custom React hooks
└── services/              # External service integrations
```

## 🎤 Voice Control Usage

The platform includes intelligent voice recognition that automatically detects your browser's capabilities:

1. **Chrome/Edge**: Uses native Web Speech API for best performance
2. **Unsupported browsers**: Shows clear guidance for optimal experience

### Available Voice Commands:
- **"Play movie"** - Start video playback
- **"Pause movie"** - Pause current video
- **"Skip intro"** - Skip to main content
- **"Turn on subtitles"** - Enable subtitle display
- **"Turn off subtitles"** - Disable subtitle display

## 🔧 Development

### Available Scripts
- `npm run dev` - Start development server with Turbo mode
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint for code quality

### Key Components
- **ContentCard**: Displays movie information with hover effects
- **VideoPlayer**: Custom video player with voice control integration
- **ContentCarousel**: Horizontal scrolling carousel for content discovery
- **VoiceControlInfo**: Real-time voice recognition status and browser compatibility

## 🌐 Browser Compatibility

| Browser | Voice Control | Video Playback | Recommended |
|---------|---------------|----------------|-------------|
| Chrome  | ✅ Native     | ✅ Full        | ⭐ Best     |
| Edge    | ✅ Native     | ✅ Full        | ⭐ Best     |
| Firefox | ⚠️ Limited    | ✅ Full        | ✅ Good     |
| Safari  | ⚠️ Limited    | ✅ Full        | ✅ Good     |

## 🚀 Deployment

### Vercel (Recommended)
The easiest way to deploy is using the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme):

1. Push your code to GitHub
2. Import your repository in Vercel
3. Deploy with zero configuration

### Other Platforms
This Next.js application can be deployed on any platform that supports Node.js:
- Netlify
- AWS Amplify  
- Railway
- DigitalOcean App Platform

## 📚 Learn More

- [Next.js Documentation](https://nextjs.org/docs) - Learn about Next.js features and API
- [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) - Voice recognition capabilities
- [Tailwind CSS](https://tailwindcss.com/docs) - Utility-first CSS framework
- [Framer Motion](https://www.framer.com/motion/) - Animation library for React

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License.
