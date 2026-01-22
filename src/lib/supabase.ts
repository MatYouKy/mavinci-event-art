import { PostgrestError } from '@supabase/supabase-js';
import { SupabaseRTKError } from './supabase/types';

export const toRtkError = (error: PostgrestError | any): SupabaseRTKError => {
  if (!error) return { status: 'UNKNOWN_ERROR', data: { message: 'Unknown error' } };

  if (typeof error === 'object' && 'message' in error) {
    return {
      status: 'SUPABASE_ERROR',
      data: {
        message: error.message ?? 'Supabase error',
        code: error.code,
        details: error.details ?? null,
        hint: error.hint ?? null,
      },
    };
  }

  return { status: 'UNKNOWN_ERROR', data: { message: String(error) } };
};

// Re-export supabase client for browser usage
export { supabase } from './supabase/browser';

// Re-export types
export type { TeamMember, PortfolioProject, GalleryImage } from './supabase/types';
