import { createBrowserClient } from '@supabase/ssr';

// singleton (żeby nie tworzyć 100 instancji)
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);