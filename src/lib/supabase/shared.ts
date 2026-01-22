import type { PostgrestError } from '@supabase/supabase-js';
import type { SupabaseRTKError } from './types';

function isPostgrestError(e: unknown): e is PostgrestError {
  return (
    typeof e === 'object' &&
    e !== null &&
    'message' in e &&
    typeof (e as any).message === 'string' &&
    ('code' in e || 'details' in e || 'hint' in e)
  );
}

export function toRtkError(e: unknown): SupabaseRTKError {
  if (isPostgrestError(e)) {
    return {
      status: 'SUPABASE_ERROR',
      data: { message: e.message },
      // jeśli masz w typie dodatkowe pola, dopnij je tutaj:
      // code: e.code ?? null,
      // details: e.details ?? null,
      // hint: e.hint ?? null,
    };
  }

  if (e instanceof Error) {
    return { status: 'UNKNOWN_ERROR', data: { message: e.message } };
  }

  return { status: 'UNKNOWN_ERROR', data: { message: 'Unknown error' } };
}