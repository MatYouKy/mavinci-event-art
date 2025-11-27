// UWAGA: bez "use client" na górze – to ma być kod tylko dla serwera

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL environment variable');
}

const supabaseKey = supabaseServiceKey || supabaseAnonKey;

if (!supabaseKey) {
  throw new Error('Missing both SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables');
}

if (!supabaseServiceKey) {
  console.warn('SUPABASE_SERVICE_ROLE_KEY not found, falling back to ANON_KEY. Some operations may be restricted.');
}

export const supabaseServer = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
  },
  global: {
    fetch: (url, options = {}) => {
      return fetch(url, {
        ...options,
        cache: 'no-store',
      });
    },
  },
});