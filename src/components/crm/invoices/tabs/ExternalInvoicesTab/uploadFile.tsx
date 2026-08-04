import { supabase } from '@/lib/supabase/browser';
import { BUCKET } from './ExternalInvoicesTab';

export async function uploadFile(file: File): Promise<string | null> {
  const ext = file.name.split('.').pop() || 'bin';
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) return null;
  return path;
}