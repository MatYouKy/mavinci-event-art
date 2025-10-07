import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please check your .env file.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
  _id?: string;
  id?: string;
  name: string;
  role: string;
  image: string;
  alt?: string;
  image_metadata?: ImageMetadata;
  bio?: string;
  linkedin?: string;
  instagram?: string;
  facebook?: string;
  order_index: number;
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
