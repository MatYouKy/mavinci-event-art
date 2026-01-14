import { createClient } from '@supabase/supabase-js';

export interface PortfolioProject {
  id: string;
  title: string;
  description?: string;
  image_url?: string | null;
  order_index: number;
  [key: string]: any;
}

function getServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Pobiera projekty portfolio posortowane po order_index
 */
export async function getPortfolioProjects(): Promise<PortfolioProject[]> {
  const supabase = getServerSupabase();

  const { data, error } = await supabase
    .from('portfolio_projects')
    .select('*')
    .order('order_index', { ascending: true });

  if (error) {
    console.error('[getPortfolioProjects] Supabase error:', error);
    throw error;
  }

  return data ?? [];
}