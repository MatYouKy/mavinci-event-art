import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { demoAdmin, isDemoUuid } from './demo.server';
export type DemoAttribution = { sourceId: string; brochureId: string; employeeId: string; recipientEmail: string; campaignId?: string };
const context = 'mavinci:seller-demo-attribution:v1';
const key = () => createHash('sha256').update(context + ':' + process.env.SUPABASE_SERVICE_ROLE_KEY!).digest();
export function sealDemoAttribution(value: DemoAttribution) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
export const demoCookieName = (source: string) => source ? 'seller_demo_' + createHash('sha256').update(source).digest('hex').slice(0,16) : 'seller_demo';
export async function resolveDemoAttribution(token: string, brochureId: string) {
  if (!token || token.length > 2048 || !/^[a-zA-Z0-9_-]+$/.test(token)) throw new Error('Nieprawidłowy link demonstracji.');
  let value: DemoAttribution;
  try {
    const bytes = Buffer.from(token, 'base64url');
    const cipher = createDecipheriv('aes-256-gcm', key(), bytes.subarray(0,12));
    cipher.setAAD(Buffer.from(context)); cipher.setAuthTag(bytes.subarray(12,28));
    value = JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8'));
    if (value.brochureId !== brochureId || !isDemoUuid(value.sourceId) || !isDemoUuid(value.employeeId)) throw new Error();
  } catch { throw new Error('Nieprawidłowy link demonstracji.'); }
  // The immutable PDF generation is the source of truth, not the URL payload.
  const { data, error } = await demoAdmin().from('sales_brochure_generations')
    .select('id,version,created_by,snapshot').eq('brochure_id', brochureId)
    .eq('created_by', value.employeeId).eq('snapshot->demoAttribution->>sourceId', value.sourceId).limit(1).maybeSingle();
  if (error || !data) throw new Error('Nie znaleziono wersji broszury powiązanej z linkiem.');
  const campaignId = data.snapshot?.demoAttribution?.campaignId || null;
  const { data: campaign } = campaignId ? await demoAdmin().from('mailing_campaigns').select('id,name').eq('id',campaignId).maybeSingle() : { data: null };
  return { campaignId: campaign?.id || null, campaignName: campaign?.name || null, sourceId: value.sourceId, generationId: data.id, version: data.version, employeeId: data.created_by,
    recipientEmail: String(data.snapshot?.demoAttribution?.recipientEmail || '') };
}
