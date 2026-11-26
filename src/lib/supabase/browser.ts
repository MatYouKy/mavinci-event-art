import { createBrowserClient } from '@supabase/ssr';
import { browserClientConfig } from './browserConfig';

// W trybie testowym „widok jako” — przez serwer CRM (`browserClientConfig`, docs/test-mode.md).
const config = browserClientConfig();

export const supabase = createBrowserClient(
  config.url,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  config.options,
);