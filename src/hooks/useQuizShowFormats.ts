'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import type { QuizShowFormat } from '@/lib/quiz-shows/types';
export type { QuizShowFormat } from '@/lib/quiz-shows/types';

export function useQuizShowFormats(initialFormats: QuizShowFormat[] = [], includeHidden = false) {
  const [formats, setFormats] = useState(initialFormats);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase.from('quiz_show_formats').select('*').order('order_index');
      if (!includeHidden) query = query.eq('is_visible', true);
      const { data, error } = await query;
      if (error) throw error;
      setFormats((data || []) as QuizShowFormat[]);
      setError(null);
    } catch {
      setError('Nie udało się odświeżyć formatów. Spróbuj ponownie.');
    } finally { setLoading(false); }
  }, [includeHidden]);

  useEffect(() => {
    void refetch();
    const channel = supabase.channel('quiz_show_formats_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_show_formats' }, () => { void refetch(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refetch]);
  return { formats, loading, error, refetch };
}
