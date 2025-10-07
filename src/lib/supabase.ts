import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://0ec90b57d6e95fcbda19832f.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJib2x0IiwicmVmIjoiMGVjOTBiNTdkNmU5NWZjYmRhMTk4MzJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg4ODE1NzQsImV4cCI6MTc1ODg4MTU3NH0.9I8-U0x86Ak8t2DGaIk0HfvTSLsAyzdnz-Nw00mMkKw';

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
