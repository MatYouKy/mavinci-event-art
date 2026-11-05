import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public guest link: /oferta/<token>. Tokens are random hex strings.
const TOKEN_PATTERN = /^[a-f0-9]{24,64}$/i;
const KINDS = new Set(['logo', 'cover']);
const SIGNED_URL_SECONDS = 600;

const notFound = () => new NextResponse(null, { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });

/**
 * Hotel logo / cover from the offer's business card for a guest share link. The files live in the private
 * bucket seller-brand-assets; the service role resolves the path only through get_shared_seller_offer_asset
 * (active link) and answers with a short-lived signed URL — the storage path is never exposed.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  const kind = request.nextUrl.searchParams.get('kind') || '';
  if (!token || !TOKEN_PATTERN.test(token) || !KINDS.has(kind)) return notFound();
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc('get_shared_seller_offer_asset', { p_token: token, p_kind: kind });
    const asset = data as { bucket?: string | null; storage_path?: string | null } | null;
    if (error || !asset?.storage_path || asset.bucket !== 'seller-brand-assets') return notFound();
    const signed = await admin.storage.from('seller-brand-assets').createSignedUrl(asset.storage_path, SIGNED_URL_SECONDS);
    if (signed.error || !signed.data?.signedUrl) return notFound();
    return NextResponse.redirect(signed.data.signedUrl, { status: 307, headers: { 'Cache-Control': 'private, max-age=300', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' } });
  } catch {
    return notFound();
  }
}
