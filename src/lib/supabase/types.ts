export type SupabaseRTKError = {
  status: 'SUPABASE_ERROR' | 'UNKNOWN_ERROR';
  data: {
    message: string;
    code?: string;
    details?: string | null;
    hint?: string | null;
  };
};

export interface ImagePosition {
  posX: number;
  posY: number;
  scale: number;
}

export interface ScreenMetadata {
  src: string;
  position?: ImagePosition;
  objectFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
}

export interface ImageMetadata {
  desktop?: ScreenMetadata;
  mobile?: ScreenMetadata;
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  position?: string;
  image: string;
  alt?: string;
  image_metadata?: ImageMetadata;
  bio?: string;
  email?: string;
  linkedin?: string;
  instagram?: string;
  facebook?: string;
  order_index: number;
  is_visible?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface GalleryImage {
  src: string;
  alt?: string;
  image_metadata?: ImageMetadata;
}

export interface AvailableIcon {
  id: string;
  name: string;
  label: string;
  category: string;
  description?: string;
}

export interface PortfolioProjectFeature {
  id?: string;
  project_id?: string;
  icon_name: string;
  title: string;
  description?: string;
  order_index: number;
}

export interface PortfolioProject {
  slug: string;
  tags: any[];
  _id?: string;
  id?: string;
  title: string;
  category: string;
  image: string;
  alt?: string;
  image_metadata?: ImageMetadata;
  description: string;
  detailed_description?: string;
  order_index: number;
  gallery?: GalleryImage[];
  features?: PortfolioProjectFeature[];
  hero_image_section?: string;
  location?: string;
  event_date?: string;
  created_at?: string;
  updated_at?: string;
}

