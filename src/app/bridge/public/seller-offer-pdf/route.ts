import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public guest link: /oferta/<token>. Tokens are random hex strings.
const TOKEN_PATTERN = /^[a-f0-9]{24,64}$/i;
const SIGNED_URL_SECONDS = 120;

const back = (request: NextRequest, token: string | null) => {
  const target = token && TOKEN_PATTERN.test(token) ? `/oferta/${token}?pdf=niedostepny` : '/';
  return NextResponse.redirect(new URL(target, request.url), { status: 303, headers: { 'Cache-Control': 'no-store' } });
};

/**
 * Latest offer PDF for a guest share link. The service role resolves the file
 * only through get_shared_seller_offer_document (active link, active offer) and
 * answers with a short-lived signed URL; the storage path is never exposed.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token || !TOKEN_PATTERN.test(token)) return back(request, null);
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc('get_shared_seller_offer_document', { p_token: token });
    const document = data as { storage_path?: string | null; filename?: string | null } | null;
    if (error || !document?.storage_path) return back(request, token);
    const filename = (document.filename || 'oferta.pdf').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 150) || 'oferta.pdf';
    const signed = await admin.storage.from('seller-offer-documents').createSignedUrl(document.storage_path, SIGNED_URL_SECONDS, { download: filename });
    if (signed.error || !signed.data?.signedUrl) return back(request, token);
    return NextResponse.redirect(signed.data.signedUrl, { status: 303, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' } });
  } catch {
    return back(request, token);
  }
}
