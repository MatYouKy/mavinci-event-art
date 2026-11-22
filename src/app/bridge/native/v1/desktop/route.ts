import { nativeContext, nativeJson, nativeUnauthorized } from '@/lib/native/auth';
import { desktopDownload, isNewerBuild, latestDesktopRelease, verifyDesktopLink } from '@/lib/native/desktopRelease';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
 * Aplikacja Mavinci na Maca (`src/lib/native/desktopRelease.ts`): GET op=latest[&build] — bieżące wydanie i czy jest nowsze od
 * kompilacji aplikacji; op=download&kind=zip|dmg — paczka aktualizacji (aplikacja na Macu) albo instalator (CRM). Tylko
 * zalogowani pracownicy (token sesji); op=file&kind&build&expires&signature — ten sam plik z podpisanego adresu wydanego
 * zalogowanemu pracownikowi przez Dysk (Programy). Wydania publikuje `yarn dmg`.
 */

export async function GET(request: Request) {
  const url = new URL(request.url);
  const op = url.searchParams.get('op') || 'latest';
  if (op === 'file') {
    const link = verifyDesktopLink(url.searchParams);
    if (!link) return nativeJson({ error: 'Adres pobrania wygasł albo jest nieprawidłowy. Pobierz instalator ponownie z Dysku (Programy).' }, 403);
    const current = await latestDesktopRelease('mac');
    if (!current) return nativeJson({ error: 'Nie ma jeszcze opublikowanej wersji aplikacji na Maca.' }, 404);
    if (current.build !== link.build) return nativeJson({ error: 'Opublikowano nowszą wersję — odśwież Dysk (Programy) i pobierz ją ponownie.' }, 410);
    return (await desktopDownload(current, link.kind)) ?? nativeJson({ error: 'Pliku wersji nie ma na serwerze. Opublikuj wersję ponownie (yarn dmg).' }, 410);
  }
  const ctx = await nativeContext(request);
  if (!ctx) return nativeUnauthorized();
  const release = await latestDesktopRelease('mac');
  if (op === 'latest') {
    if (!release) return nativeJson({ release: null, newer: false });
    const build = url.searchParams.get('build');
    return nativeJson({
      release: {
        version: release.version,
        build: release.build,
        publishedAt: release.publishedAt,
        notes: release.notes,
        minimumSystem: release.minimumSystem,
        notarized: release.notarized,
        size: release.zip.size,
        sha256: release.zip.sha256,
        installerSize: release.dmg.size,
      },
      newer: isNewerBuild(release, build),
    });
  }
  if (op === 'download') {
    const kind = url.searchParams.get('kind') === 'dmg' ? 'dmg' : 'zip';
    if (!release) return nativeJson({ error: 'Nie ma jeszcze opublikowanej wersji aplikacji na Maca.' }, 404);
    const response = await desktopDownload(release, kind);
    return response ?? nativeJson({ error: 'Pliku wersji nie ma na serwerze. Opublikuj wersję ponownie (yarn dmg).' }, 410);
  }
  return nativeJson({ error: 'Nieznana operacja.' }, 400);
}
