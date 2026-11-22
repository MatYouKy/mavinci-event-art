'use client';

import { useEffect, useState } from 'react';
import { Download, Laptop, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';

/*
 * Ustawienia → Ogólne → „Aplikacja Mavinci na Maca”: bieżąca wersja i instalator DMG do pierwszej instalacji. Wersje
 * publikuje `yarn dmg`; kolejne aktualizacje aplikacja na Macu pobiera i instaluje sama. To samo API co aplikacja
 * (`/bridge/native/v1/desktop`, token sesji pracownika).
 */

type Release = {
  version: string;
  build: string;
  publishedAt: string | null;
  notes: string;
  notarized: boolean;
  installerSize: number;
};

const ENDPOINT = '/bridge/native/v1/desktop';

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sesja wygasła. Zaloguj się ponownie.');
  return { Authorization: `Bearer ${token}`, 'x-mavinci-client': 'web' };
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} MB`;
const published = (value: string | null) => (value
  ? new Intl.DateTimeFormat('pl-PL', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Warsaw' }).format(new Date(value))
  : '');

export default function DesktopAppDownload() {
  const { showSnackbar } = useSnackbar();
  const [release, setRelease] = useState<Release | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${ENDPOINT}?op=latest`, { headers: await authHeaders(), cache: 'no-store' });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body?.error || 'Nie udało się sprawdzić wersji.');
        if (!cancelled) setRelease(body.release ?? null);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /** Instalator z postępem (strumień z serwera), zapis przez przeglądarkę. */
  const download = async () => {
    if (!release || progress !== null) return;
    setProgress(0);
    try {
      const response = await fetch(`${ENDPOINT}?op=download&kind=dmg`, { headers: await authHeaders(), cache: 'no-store' });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || 'Nie udało się pobrać instalatora.');
      }
      const total = Number(response.headers.get('Content-Length')) || release.installerSize;
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (total) setProgress(Math.min(99, Math.round((received / total) * 100)));
      }
      const url = URL.createObjectURL(new Blob(chunks as BlobPart[], { type: 'application/x-apple-diskimage' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `Mavinci-${release.version}.dmg`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      showSnackbar('Pobrano instalator Mavinci. Otwórz plik i przeciągnij aplikację do folderu Aplikacje.', 'success');
    } catch (error) {
      showSnackbar(error instanceof Error ? error.message : 'Nie udało się pobrać instalatora.', 'error');
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <div className="mb-1 flex items-center gap-2">
        <Laptop className="h-5 w-5 text-[#d3bb73]" />
        <h3 className="text-lg font-light text-[#e5e4e2]">Aplikacja Mavinci na Maca</h3>
      </div>
      <p className="mb-5 text-sm text-[#e5e4e2]/60">
        Instalator do pierwszej instalacji (ten sam plik jest zawsze w Dysku → Programy). Kolejne wersje aplikacja sprawdza sama
        i po potwierdzeniu pobiera oraz instaluje.
      </p>
      {!loaded ? (
        <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/60">
          <Loader2 className="h-4 w-4 animate-spin" /> Sprawdzanie wersji…
        </div>
      ) : failed ? (
        <p className="text-sm text-[#e5e4e2]/60">Nie udało się sprawdzić wersji aplikacji. Odśwież stronę, aby spróbować ponownie.</p>
      ) : !release ? (
        <p className="text-sm text-[#e5e4e2]/60">Nie ma jeszcze opublikowanej wersji aplikacji na Maca.</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-[#0f1119] p-4">
            <div>
              <div className="text-sm font-medium text-[#e5e4e2]">
                Wersja {release.version} <span className="text-[#e5e4e2]/50">({release.build})</span>
              </div>
              <div className="mt-1 text-xs text-[#e5e4e2]/50">
                {[published(release.publishedAt), megabytes(release.installerSize), 'macOS 14 lub nowszy'].filter(Boolean).join(' · ')}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void download()}
              disabled={progress !== null}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-5 py-2.5 text-sm text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-60"
            >
              {progress !== null ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {progress !== null ? `Pobieranie… ${progress}%` : 'Pobierz instalator (DMG)'}
            </button>
          </div>
          {!!release.notes && (
            <div>
              <div className="mb-1 text-xs text-[#e5e4e2]/50">Co nowego</div>
              <p className="whitespace-pre-line text-sm text-[#e5e4e2]/80">{release.notes}</p>
            </div>
          )}
          <ol className="list-decimal space-y-1 pl-5 text-sm text-[#e5e4e2]/60">
            <li>Otwórz pobrany plik i przeciągnij Mavinci do folderu Aplikacje.</li>
            <li>Uruchom Mavinci z folderu Aplikacje i zaloguj się kontem CRM.</li>
            {!release.notarized && (
              <li>Jeśli macOS nie pozwoli otworzyć aplikacji: kliknij ją prawym przyciskiem → Otwórz (albo Ustawienia systemowe → Prywatność i ochrona → Otwórz mimo to).</li>
            )}
            <li>Nowe wersje: aplikacja pokaże „Dostępna nowa wersja” — wystarczy „Pobierz i zainstaluj”.</li>
          </ol>
        </div>
      )}
    </div>
  );
}
