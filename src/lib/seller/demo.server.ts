import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { DEMO_COMPANY_ID } from '../../../supabase/functions/_shared/sellerDemo';
export const demoAdmin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
export const isDemoUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export async function getDemoBrochure(id: string) {
  if (!isDemoUuid(id)) return null;
  const { data, error } = await demoAdmin().from('sales_brochures').select('id,my_company_id,brand_config,status').eq('id', id).maybeSingle();
  if (error) throw new Error('Nie udało się otworzyć demonstracji. Spróbuj ponownie.');
  return data?.my_company_id === DEMO_COMPANY_ID && data.status !== 'archived' && data.brand_config?.seller_demo_enabled === true ? data : null;
}
const sign = (value: string) => createHmac('sha256', process.env.SUPABASE_SERVICE_ROLE_KEY!).update('seller-demo-v1:' + value).digest('hex');
export const demoNetworkHash = (ip: string) => sign('network:' + new Date().toISOString().slice(0, 10) + ':' + ip);
export const demoSessionCookie = (id: string, brochure: string) => { const payload = `${id}.${Date.now()}`; return payload + '.' + sign(brochure + ':' + payload); };
export function readDemoSession(raw: string | undefined, brochure: string): string | null {
  if (!raw) return null;
  const [id, time, mac] = raw.split('.');
  if (!isDemoUuid(id || '') || !/^\d{13}$/.test(time || '') || !/^[a-f0-9]{64}$/.test(mac || '') || Date.now() - Number(time) > 2 * 60 * 60 * 1000 || Number(time) > Date.now()) return null;
  const expected = sign(brochure + ':' + id + '.' + time);
  return timingSafeEqual(Buffer.from(mac), Buffer.from(expected)) ? id : null;
}
export async function demoJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Brak danych formularza.');
  let length = 0; const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    length += value.length;
    if (length > 2_400_000) { await reader.cancel(); throw new Error('Grafiki są za duże. Wybierz mniejsze pliki.'); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}
export async function getDemoDefaultCover() {
  const admin = demoAdmin();
  const { data } = await admin.from('offer_template_categories').select('hero_image_path').eq('is_default', true).limit(1).maybeSingle();
  if (!data?.hero_image_path) return '';
  const { data: image } = await admin.storage.from('offer-template-pages').createSignedUrl(data.hero_image_path, 7200);
  return image?.signedUrl || '';
}
