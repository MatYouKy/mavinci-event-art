import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';

export interface QuizShowFormat {
  id: string;
  title: string;
  level: string;
  description: string;
  features: string[];
  image_url: string | null;
  icon_id: string | null;
  layout_direction: 'left' | 'right';
  order_index: number;
  is_visible: boolean;
  link_url: string | null;
  created_at: string;
  updated_at: string;
}

export function useQuizShowFormats() {
  const [formats, setFormats] = useState<QuizShowFormat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFormats = async () => {
    try {
      setLoading(true);
      const { data, error: fetchError } = await supabase
        .from('quiz_show_formats')
        .select('*')
        .order('order_index', { ascending: true });

      if (fetchError) throw fetchError;

      setFormats(data || []);
      setError(null);
    } catch (err) {
      console.error('Error fetching quiz show formats:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch formats');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFormats();

    const channel = supabase
      .channel('quiz_show_formats_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'quiz_show_formats',
        },
        (payload) => {
          // Realtime update bez czekania
          if (payload.eventType === 'INSERT') {
            setFormats((prev) =>
              [...prev, payload.new as QuizShowFormat].sort(
                (a, b) => a.order_index - b.order_index,
              ),
            );
          } else if (payload.eventType === 'UPDATE') {
            setFormats((prev) =>
              prev
                .map((f) => (f.id === payload.new.id ? (payload.new as QuizShowFormat) : f))
                .sort((a, b) => a.order_index - b.order_index),
            );
          } else if (payload.eventType === 'DELETE') {
            setFormats((prev) => prev.filter((f) => f.id !== payload.old.id));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return { formats, loading, error, refetch: fetchFormats };
}
