import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// For API routes - same as regular client for now
export const supabaseAdmin = supabase;

export interface ImagePosition {
  posX: number;
  posY: number;
  scale: number;
}

export interface ScreenMetadata {
  src: string;
  position?: ImagePosition;
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

export interface PortfolioProject {
  _id?: string;
  id?: string;
  title: string;
  category: string;
  image: string;
  alt?: string;
  image_metadata?: ImageMetadata;
  description: string;
  order_index: number;
  created_at?: string;
  updated_at?: string;
}
