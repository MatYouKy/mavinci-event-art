'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import {
  Archive, ChevronLeft, ChevronRight, Clock3, Download, File, FileText, Film, Globe, Image as ImageIcon, Loader2, Lock, Mail, Music, Phone, X,
} from 'lucide-react';
import {
  MATERIAL_KIND_LABELS, formatMaterialBytes, formatMaterialDuration, materialPreviewable, materialShareDateLabel, materialShareSummary,
  type MaterialKind,
} from '@/lib/materials/materialsShared';
import type { PublicShareFile, PublicShareView, ShareBrand } from '@/lib/materials/materialSharePublic.server';

/*
 * Strona linku do pobrania (`/pobierz/<token>`) w barwach marki z księgi znaku: logo, tytuł i wiadomość, ważność, „Pobierz
 * wszystkie” (ZIP), części (foldery, albumy, pliki) z podfolderami, miniatury z podglądem na całym ekranie (strzałki, Esc)
 * i pobieraniem pojedynczo. Link z hasłem — formularz e-mail i hasło; wygasły i wyłączony — informacja z kontaktem do firmy.
 */

type OpenView = Extract<PublicShareView, { status: 'open' }>;

const KIND_ICONS: Partial<Record<MaterialKind, typeof File>> = { image: ImageIcon, video: Film, audio: Music, pdf: FileText, document: FileText };
const fileHref = (token: string, id: string, mode: 'preview' | 'download') =>
  `/bridge/public/material-share/file?token=${encodeURIComponent(token)}&id=${encodeURIComponent(id)}&mode=${mode}`;
const zipHref = (token: string, section?: string) =>
  `/bridge/public/material-share/zip?token=${encodeURIComponent(token)}${section ? `&section=${encodeURIComponent(section)}` : ''}`;

/** Kolor akcentu marki z przezroczystością (tło, ramki) — `#rrggbb` → `rgba(…)`. */
function tint(hex: string, alpha: number) {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#d3bb73';
  const [r, g, b] = [1, 3, 5].map((start) => Number.parseInt(value.slice(start, start + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function themeStyle(brand: ShareBrand | null): CSSProperties {
  const accent = brand?.accent || '#d3bb73';
  const family = brand?.headingFontFamily ? `'${brand.headingFontFamily}', ` : '';
  return {
    '--share-accent': accent,
    '--share-accent-soft': tint(accent, 0.1),
    '--share-accent-line': tint(accent, 0.35),
    '--font-brand-heading': `${family}'Atom', 'Montserrat', sans-serif`,
  } as CSSProperties;
}

function BrandFont({ brand }: { brand: ShareBrand | null }) {
  if (!brand?.headingFontFamily || !brand.headingFontUrl) return null;
  const url = brand.headingFontUrl.replace(/['"\\)]/g, '');
  return <style>{`@font-face{font-family:'${brand.headingFontFamily}';src:url('${url}');font-weight:400;font-style:normal;font-display:swap;}`}</style>;
}

function BrandHeader({ brand, expiresAt }: { brand: ShareBrand | null; expiresAt?: string }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      {brand?.logoUrl
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={brand.logoUrl} alt={brand.name} className="h-12 w-auto max-w-[220px] object-contain md:h-14" />
        : <span className="brand-heading text-lg text-[color:var(--share-accent)]">{brand?.name || 'Pliki do pobrania'}</span>}
      {expiresAt && (
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-xs text-white/60">
          <Clock3 className="h-3.5 w-3.5" />Link ważny do {materialShareDateLabel(expiresAt, 'Europe/Warsaw')}
        </span>
      )}
    </header>
  );
}

function Contact({ brand }: { brand: ShareBrand | null }) {
  if (!brand) return null;
  const site = brand.website ? brand.website.replace(/^https?:\/\//i, '').replace(/\/$/, '') : null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-white/60">
      {brand.email && <a href={`mailto:${brand.email}`} className="inline-flex items-center gap-1.5 hover:text-white"><Mail className="h-4 w-4" />{brand.email}</a>}
      {brand.phone && <a href={`tel:${brand.phone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1.5 hover:text-white"><Phone className="h-4 w-4" />{brand.phone}</a>}
      {site && <a href={/^https?:\/\//i.test(brand.website || '') ? brand.website! : `https://${site}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:text-white"><Globe className="h-4 w-4" />{site}</a>}
    </div>
  );
}

function Card({ brand, title, children }: { brand: ShareBrand | null; title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col px-4 py-8" style={themeStyle(brand)}>
      <BrandFont brand={brand} />
      <BrandHeader brand={brand} />
      <div className="my-auto rounded-2xl border border-[color:var(--share-accent-line)] bg-white/[0.03] p-6 md:p-8">
        <h1 className="text-xl text-[#e5e4e2] md:text-2xl">{title}</h1>
        {children}
      </div>
      <footer className="pt-8"><Contact brand={brand} /></footer>
    </main>
  );
}

function Unlock({ token, brand, title, expiresAt }: { token: string; brand: ShareBrand; title: string; expiresAt: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending) return;
    if (!email.trim() || !password) { setError('Podaj adres e-mail i hasło.'); return; }
    setSending(true);
    setError('');
    try {
      const response = await fetch('/bridge/public/material-share/unlock', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, email: email.trim(), password }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setError(body?.error || 'Nie udało się otworzyć linku.'); setSending(false); return; }
      window.location.reload();
    } catch {
      setError('Brak połączenia. Sprawdź internet i spróbuj ponownie.');
      setSending(false);
    }
  };
  return (
    <Card brand={brand} title={title}>
      <p className="mt-3 flex items-start gap-2 text-sm leading-6 text-white/65">
        <Lock className="mt-1 h-4 w-4 shrink-0 text-[color:var(--share-accent)]" />
        Pliki są chronione hasłem. Podaj adres e-mail, na który przyszedł link, i hasło od {brand.name}.
      </p>
      <form onSubmit={submit} className="mt-5 space-y-3">
        <label className="block text-sm text-white/70">Adres e-mail
          <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required
            className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2.5 text-[#e5e4e2] outline-none focus:border-[color:var(--share-accent)]" />
        </label>
        <label className="block text-sm text-white/70">Hasło
          <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required
            className="mt-1 w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2.5 text-[#e5e4e2] outline-none focus:border-[color:var(--share-accent)]" />
        </label>
        {error && <p role="alert" className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}
        <button type="submit" disabled={sending}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[color:var(--share-accent)] px-4 py-2.5 font-medium text-[#1c1f33] disabled:opacity-60">
          {sending && <Loader2 className="h-4 w-4 animate-spin" />}Otwórz pliki
        </button>
      </form>
      <p className="mt-4 text-xs text-white/40">Link ważny do {materialShareDateLabel(expiresAt, 'Europe/Warsaw')}.</p>
    </Card>
  );
}

function Thumb({ file, className }: { file: PublicShareFile; className: string }) {
  const Icon = KIND_ICONS[file.kind] || File;
  if (file.thumbnailUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={file.thumbnailUrl} alt={file.name} loading="lazy" decoding="async" className={`${className} object-cover`} />;
  }
  return <span className={`${className} flex items-center justify-center bg-white/[0.04]`}><Icon className="h-8 w-8 text-white/35" /></span>;
}

function Viewer({ token, files, index, onIndex, onClose }: {
  token: string; files: PublicShareFile[]; index: number; onIndex: (index: number) => void; onClose: () => void;
}) {
  const file = files[index];
  const move = useCallback((step: number) => onIndex((index + step + files.length) % files.length), [files.length, index, onIndex]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') move(1);
      if (event.key === 'ArrowLeft') move(-1);
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [move, onClose]);
  if (!file) return null;
  const previewable = materialPreviewable(file.kind, file.mime, file.name);
  const src = fileHref(token, file.id, 'preview');
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95" role="dialog" aria-modal="true" aria-label={file.name}>
      <div className="flex items-center gap-3 px-4 py-3 text-sm text-white/80">
        <span className="min-w-0 flex-1 truncate">{file.name}</span>
        <span className="hidden text-white/45 sm:inline">{index + 1} / {files.length} · {formatMaterialBytes(file.size)}</span>
        <a href={fileHref(token, file.id, 'download')} className="inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--share-accent)] px-3 py-1.5 font-medium text-[#1c1f33]">
          <Download className="h-4 w-4" />Pobierz
        </a>
        <button type="button" onClick={onClose} aria-label="Zamknij (Esc)" className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white"><X className="h-5 w-5" /></button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 md:px-16">
        {!previewable ? (
          <div className="flex flex-col items-center gap-3 text-center text-white/60">
            <Thumb file={file} className="h-48 w-48 rounded-xl" />
            <p>{MATERIAL_KIND_LABELS[file.kind]} — podgląd niedostępny w przeglądarce. Pobierz plik.</p>
          </div>
        ) : file.kind === 'video' ? (
          <video key={file.id} src={src} controls playsInline className="max-h-full max-w-full rounded-lg" />
        ) : file.kind === 'audio' ? (
          <audio key={file.id} src={src} controls className="w-full max-w-lg" />
        ) : file.kind === 'pdf' ? (
          <iframe key={file.id} src={src} title={file.name} className="h-full w-full max-w-5xl rounded-lg bg-white" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={file.id} src={src} alt={file.name} className="max-h-full max-w-full select-none rounded-lg object-contain" />
        )}
        {files.length > 1 && (
          <>
            <button type="button" onClick={() => move(-1)} aria-label="Poprzedni (←)"
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white/80 hover:bg-black/70 md:left-4"><ChevronLeft className="h-7 w-7" /></button>
            <button type="button" onClick={() => move(1)} aria-label="Następny (→)"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white/80 hover:bg-black/70 md:right-4"><ChevronRight className="h-7 w-7" /></button>
          </>
        )}
      </div>
    </div>
  );
}

function OpenShare({ token, view, notice }: { token: string; view: OpenView; notice: string | null }) {
  const all = useMemo(() => view.sections.flatMap((section) => section.files), [view.sections]);
  const [viewer, setViewer] = useState<number | null>(null);
  const indexOf = useMemo(() => new Map(all.map((file, index) => [file.id, index])), [all]);
  const zipAll = view.totalBytes <= view.zipMaxBytes;
  const multiple = view.sections.length > 1;
  return (
    <main className="mx-auto max-w-6xl px-4 pb-16 pt-8" style={themeStyle(view.brand)}>
      <BrandFont brand={view.brand} />
      <BrandHeader brand={view.brand} expiresAt={view.expiresAt} />
      <section className="mt-8">
        <h1 className="text-2xl text-[#e5e4e2] md:text-3xl">{view.title}</h1>
        {view.message && <p className="mt-3 max-w-3xl whitespace-pre-line text-sm leading-6 text-white/70 md:text-base">{view.message}</p>}
        <p className="mt-3 text-sm text-white/50">
          {materialShareSummary(view.fileCount, view.totalBytes)}{view.email ? ` · otwarto jako ${view.email}` : ''}
        </p>
        {notice && <p role="status" className="mt-4 rounded-lg border border-[color:var(--share-accent-line)] bg-[color:var(--share-accent-soft)] px-3 py-2 text-sm text-white/80">{notice}</p>}
        {view.fileCount > 0 && (
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {zipAll ? (
              <a href={zipHref(token)} className="inline-flex items-center gap-2 rounded-lg bg-[color:var(--share-accent)] px-4 py-2.5 font-medium text-[#1c1f33] hover:opacity-90">
                <Archive className="h-4 w-4" />Pobierz wszystkie (ZIP · {formatMaterialBytes(view.totalBytes)})
              </a>
            ) : (
              <p className="text-sm text-white/60">Wszystkie pliki zajmują ponad 4 GB — pobierz foldery osobno albo pliki pojedynczo.</p>
            )}
            <span className="text-xs text-white/40">Archiwum ZIP otworzysz na komputerze dwuklikiem; na telefonie wygodniej pobierać zdjęcia pojedynczo.</span>
          </div>
        )}
        {view.truncated && <p className="mt-3 text-sm text-white/50">Pokazujemy pierwsze {view.fileCount} plików z tego linku.</p>}
      </section>

      {view.fileCount === 0 && (
        <p className="mt-10 rounded-xl border border-white/10 bg-white/[0.03] p-6 text-center text-white/60">Na razie nie ma tu plików — zajrzyj później.</p>
      )}

      {view.sections.map((section) => {
        const groups = new Map<string, PublicShareFile[]>();
        for (const file of section.files) groups.set(file.dir, [...(groups.get(file.dir) || []), file]);
        return (
          <section key={section.key} className="mt-10">
            {(multiple || groups.size > 1) && (
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-3">
                <div>
                  <h2 className="text-lg text-[#e5e4e2]">{section.title}</h2>
                  <p className="text-xs text-white/45">{materialShareSummary(section.files.length, section.bytes)}</p>
                </div>
                {multiple && section.files.length > 0 && section.bytes <= view.zipMaxBytes && (
                  <a href={zipHref(token, section.key)} className="inline-flex items-center gap-2 rounded-lg border border-[color:var(--share-accent-line)] px-3 py-1.5 text-sm text-[color:var(--share-accent)] hover:bg-[color:var(--share-accent-soft)]">
                    <Archive className="h-4 w-4" />Pobierz {section.kind === 'album' ? 'album' : section.kind === 'files' ? 'pliki' : 'folder'} (ZIP)
                  </a>
                )}
              </div>
            )}
            {Array.from(groups.entries()).map(([dir, files]) => (
              <div key={dir || 'root'} className="mb-6">
                {dir && <h3 className="mb-3 text-sm text-white/60">{dir.split('/').join(' / ')}</h3>}
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {files.map((file) => (
                    <li key={file.id} className="group overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
                      <button type="button" onClick={() => setViewer(indexOf.get(file.id) ?? 0)} className="relative block w-full" aria-label={`Podgląd: ${file.name}`}>
                        <Thumb file={file} className="aspect-square w-full" />
                        {file.kind === 'video' && file.duration != null && (
                          <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-white">{formatMaterialDuration(file.duration)}</span>
                        )}
                      </button>
                      <div className="flex items-center gap-2 px-2.5 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs text-white/80" title={file.name}>{file.name}</p>
                          <p className="text-[11px] text-white/40">{formatMaterialBytes(file.size)}</p>
                        </div>
                        <a href={fileHref(token, file.id, 'download')} aria-label={`Pobierz: ${file.name}`} title="Pobierz"
                          className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-[color:var(--share-accent)]"><Download className="h-4 w-4" /></a>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        );
      })}

      <footer className="mt-16 space-y-3 border-t border-white/10 pt-6 text-center">
        <p className="text-sm text-white/50">Pliki udostępnia {view.brand.name}. Link wygasa {materialShareDateLabel(view.expiresAt, 'Europe/Warsaw')}.</p>
        <Contact brand={view.brand} />
      </footer>
      {viewer !== null && <Viewer token={token} files={all} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />}
    </main>
  );
}

export default function SharedFilesView({ token, view, notice }: { token: string; view: PublicShareView | null; notice: string | null }) {
  if (!view || view.status === 'missing') {
    return (
      <Card brand={null} title="Nie udało się otworzyć linku">
        <p className="mt-3 text-sm leading-6 text-white/65">Spróbuj ponownie za chwilę. Jeśli problem się powtarza, poproś o nowy link osobę, która go przesłała.</p>
      </Card>
    );
  }
  if (view.status === 'locked') return <Unlock token={token} brand={view.brand} title={view.title} expiresAt={view.expiresAt} />;
  if (view.status !== 'open') {
    return (
      <Card brand={view.brand} title={view.status === 'expired' ? 'Ten link wygasł' : 'Ten link został wyłączony'}>
        <p className="mt-3 text-sm leading-6 text-white/65">
          {view.status === 'expired'
            ? `Pliki „${view.title}” nie są już dostępne pod tym adresem. Jeśli nadal ich potrzebujesz, skontaktuj się z ${view.brand.name} — przedłużymy link albo prześlemy nowy.`
            : `Pliki „${view.title}” nie są już udostępniane. Skontaktuj się z ${view.brand.name}, jeśli potrzebujesz ich ponownie.`}
        </p>
      </Card>
    );
  }
  return <OpenShare token={token} view={view} notice={notice} />;
}
