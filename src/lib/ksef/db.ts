import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL is required.');
}

if (!serviceRoleKey) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required.');
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

export async function getCredentials(companyId: string) {
  const { data, error } = await supabase
    .from('ksef_credentials')
    .select('*')
    .eq('my_company_id', companyId)
    .eq('is_active', true)
    .single();

  if (error || !data) {
    throw new Error('Nie znaleziono danych KSeF dla firmy');
  }

  return data;
}

export { supabase };