import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import SharedFilesView from '@/components/materials/share/SharedFilesView';
import { shareCookieName } from '@/lib/materials/materialShareCrypto.server';
import { publicShareView } from '@/lib/materials/materialSharePublic.server';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Pliki do pobrania',
  referrer: 'no-referrer',
  robots: { index: false, follow: false, nocache: true, nosnippet: true, googleBot: { index: false, follow: false, nosnippet: true } },
};

// Token linku: 32 losowe bajty w base64url — inne adresy to zwykłe 404.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;
const ZIP_NOTICES: Record<string, string> = {
  'za-duzy': 'Te pliki zajmują ponad 4 GB — pobierz foldery osobno albo pliki pojedynczo.',
  brak: 'Brak plików do pobrania w tej części.',
  blad: 'Nie udało się przygotować archiwum. Spróbuj ponownie za chwilę albo pobierz pliki pojedynczo.',
};

/**
 * Link do pobrania z Materiałów (`/pobierz/<token>`): pliki marki dla osoby spoza firmy — miniatury, podgląd, pobieranie
 * pojedynczo i w ZIP; link z hasłem — najpierw e-mail i hasło. Dane i dostęp — `publicShareView` (serwer).
 */
export default async function SharedFilesPage({ params, searchParams }: { params: { token: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  if (!TOKEN_PATTERN.test(params.token)) notFound();
  let view;
  try {
    view = await publicShareView(params.token, cookies().get(shareCookieName(params.token))?.value);
  } catch {
    view = null;
  }
  if (view?.status === 'missing') notFound();
  const zip = typeof searchParams?.zip === 'string' ? ZIP_NOTICES[searchParams.zip] || null : null;
  return <SharedFilesView token={params.token} view={view} notice={zip} />;
}
