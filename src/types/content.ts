export interface Content {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  videoUrl: string;
  type: 'movie' | 'series';
  year: number;
  rating?: number;
  genres?: string[];
}

export interface ContentCarouselProps {
  title: string;
  items: Content[];
} 


export interface CarouselButtonProps {
  direction: 'left' | 'right';
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}