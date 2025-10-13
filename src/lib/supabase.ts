import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fuuljhhuhfojtmmfmskq.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1dWxqaGh1aGZvanRtbWZtc2txIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk5NDI5NjEsImV4cCI6MjA3NTUxODk2MX0.xe8_YUgENMeXwuLSZVatAfDBZLi5lcfyV3sHjaD8dmE';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables!');
  console.error('URL:', supabaseUrl ? 'OK' : 'MISSING');
  console.error('Key:', supabaseAnonKey ? 'OK' : 'MISSING');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  global: {
    headers: {
      apikey: supabaseAnonKey,
    }
  }
});

// For API routes - create admin client with service role key
// This is lazy-loaded to avoid issues with env vars in browser
export const getSupabaseAdmin = () => {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not defined');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
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
