'use client';

import { useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, Link2, Lock, Mail, Users } from 'lucide-react';
import OverlayPortal from '@/components/UI/OverlayPortal';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useGlobalLoader } from '@/contexts/GlobalLoaderContext';
import {
  MATERIAL_SHARE_ACCESS_LABELS, MATERIAL_SHARE_DAYS, MATERIAL_SHARE_DEFAULT_DAYS, MATERIAL_SHARE_LIMITS, materialCountLabel, materialShareDateLabel,
  materialShareDaysLabel, materialShareEmails, materialShareExpiry, materialShareMessage, type MaterialShareAccess,
} from '@/lib/materials/materialsShared';
import {
  createMaterialShare, updateMaterialShare, type MaterialShare, type MaterialShareCreated, type MaterialShareTarget,
} from './materialsApi';
import { errorMessage, inputClass, primaryButton, secondaryButton } from './materialsUi';

/*
 * „Udostępnij link” w Materiałach (CRM; Mac — `MaterialShareSheet`, telefon — `MaterialShareModal`): link do pobrania folderu
 * (z podfolderami, „na żywo”), albumu albo wybranych plików przez osobę spoza firmy — tytuł i wiadomość na stronie, ważność,
 * dostęp dla każdego albo po e-mailu i haśle (puste pole — hasło generuje serwer). Po zapisie: link, hasło (tylko teraz),
 * gotowa wiadomość dla odbiorcy do skopiowania albo wysłania e-mailem. Tryb `edit` — tytuł, wiadomość i dostęp istniejącego linku.
 */

type Props = {
  companyId: string;
  companyName: string;
  onClose: () => void;
  onSaved?: (share: MaterialShare) => void;
  /** Od razu wynik (np. „Nowe hasło” z listy linków): link, hasło i wiadomość do przekazania. */
  created?: MaterialShareCreated;
} & ({ mode: 'create'; items: MaterialShareTarget[]; defaultTitle: string } | { mode: 'edit'; share: MaterialShare });

const KIND_NAMES = { folder: 'Folder', album: 'Album', file: 'Plik' } as const;

/** Opis udostępnianych elementów: „Folder „Fotobudka” z podfolderami” albo „3 pliki · 1 folder · 1 album”. */
function targetsSummary(items: MaterialShareTarget[]) {
  if (items.length === 1) {
    const [item] = items;
    if (item.kind === 'folder') return `Folder „${item.name}” z podfolderami — pliki dodane później też będą do pobrania.`;
    if (item.kind === 'album') return `Album „${item.name}” — zdjęcia dodane później do albumu też będą do pobrania.`;
    return `Plik „${item.name}”.`;
  }
  const files = items.filter((item) => item.kind === 'file').length;
  const folders = items.filter((item) => item.kind === 'folder').length;
  const albums = items.filter((item) => item.kind === 'album').length;
  return [files ? materialCountLabel(files, 'file') : null, folders ? materialCountLabel(folders, 'folder') : null,
    albums ? `${albums} ${albums === 1 ? 'album' : 'albumy'}` : null].filter(Boolean).join(' · ') + (folders ? ' (foldery z podfolderami)' : '');
}

async function copy(text: string, notify: (message: string, type: 'success' | 'error') => void, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    notify(done, 'success');
  } catch {
    notify('Nie udało się skopiować — zaznacz tekst i skopiuj ręcznie.', 'error');
  }
}

export default function MaterialShareDialog(props: Props) {
  const { companyId, companyName, onClose, onSaved } = props;
  const { showSnackbar } = useSnackbar();
  const { showLoader, hideLoader } = useGlobalLoader();
  const editing = props.mode === 'edit' ? props.share : null;
  const [title, setTitle] = useState(editing ? editing.title : props.mode === 'create' ? props.defaultTitle : '');
  const [message, setMessage] = useState(editing?.message || '');
  const [days, setDays] = useState<number>(MATERIAL_SHARE_DEFAULT_DAYS);
  const [access, setAccess] = useState<MaterialShareAccess>(editing?.access || 'public');
  const [emails, setEmails] = useState(editing?.emails.join(', ') || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MaterialShareCreated | null>(props.created || null);
  const [text, setText] = useState(() => (props.created ? materialShareMessage({
    url: props.created.share.url, title: props.created.share.title, expiresAt: props.created.share.expiresAt, access: props.created.share.access,
    emails: props.created.share.emails, password: props.created.password, companyName,
  }) : ''));

  const parsed = useMemo(() => materialShareEmails(emails), [emails]);
  const needsPassword = access === 'password' && (!editing || editing.access !== 'password');

  const save = async () => {
    if (busy) return;
    setError('');
    if (access === 'password') {
      if (parsed.invalid.length) { setError(`Niepoprawny adres e-mail: ${parsed.invalid.slice(0, 3).join(', ')}.`); return; }
      if (!parsed.emails.length) { setError('Podaj adres e-mail osoby, która otworzy link.'); return; }
      if (parsed.emails.length > MATERIAL_SHARE_LIMITS.emails) { setError(`Najwyżej ${MATERIAL_SHARE_LIMITS.emails} adresów e-mail.`); return; }
      const typed = password.trim();
      if (typed && (typed.length < MATERIAL_SHARE_LIMITS.passwordMin || typed.length > MATERIAL_SHARE_LIMITS.passwordMax)) {
        setError(`Hasło: od ${MATERIAL_SHARE_LIMITS.passwordMin} do ${MATERIAL_SHARE_LIMITS.passwordMax} znaków albo puste pole (wygenerujemy hasło).`);
        return;
      }
    }
    setBusy(true);
    showLoader(editing ? 'Zapisuję link' : 'Tworzę link do pobrania', 'Proszę chwilę poczekać...');
    try {
      const saved = props.mode === 'create'
        ? await createMaterialShare({
          companyId, items: props.items.map(({ kind, id }) => ({ kind, id })), title: title.trim(), message, days, access,
          emails: access === 'password' ? parsed.emails : [], password: password.trim(),
        })
        : await updateMaterialShare({
          id: props.share.id, title: title.trim(), message, access,
          ...(access === 'password' ? { emails: parsed.emails } : {}),
          ...(needsPassword || password.trim() ? { newPassword: true, password: password.trim() } : {}),
        });
      onSaved?.(saved.share);
      if (props.mode === 'edit' && !saved.password) {
        showSnackbar('Zapisano zmiany linku', 'success');
        onClose();
        return;
      }
      setResult(saved);
      setText(materialShareMessage({
        url: saved.share.url, title: saved.share.title, expiresAt: saved.share.expiresAt, access: saved.share.access, emails: saved.share.emails,
        password: saved.password, companyName,
      }));
      showSnackbar(props.mode === 'create' ? 'Link do pobrania jest gotowy' : 'Ustawiono nowe hasło', 'success');
    } catch (cause) {
      setError(errorMessage(cause, 'Nie udało się zapisać linku.'));
    } finally {
      hideLoader();
      setBusy(false);
    }
  };

  const notify = (note: string, type: 'success' | 'error') => showSnackbar(note, type);
  const share = result?.share;
  const mailto = share
    ? `mailto:${share.emails.map(encodeURIComponent).join(',')}?subject=${encodeURIComponent(`Pliki do pobrania: ${share.title}`)}&body=${encodeURIComponent(text)}`
    : '';

  return (
    <OverlayPortal>
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true"
        aria-label={editing ? 'Zmień link do pobrania' : 'Udostępnij link do pobrania'}
        onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
        <div className="flex max-h-[92vh] w-full max-w-xl flex-col rounded-xl border border-[#d3bb73]/15 bg-[#1c1f33] text-[#e5e4e2] shadow-2xl">
          <div className="flex items-center gap-2 border-b border-[#d3bb73]/10 px-5 py-4">
            <Link2 className="h-5 w-5 text-[#d3bb73]" />
            <h2 className="text-lg font-light">{share ? 'Link do pobrania jest gotowy' : editing ? 'Zmień link do pobrania' : 'Udostępnij link do pobrania'}</h2>
          </div>

          {share ? (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
              <div className="space-y-1">
                <span className="text-[#e5e4e2]/60">Link (ważny do {materialShareDateLabel(share.expiresAt)})</span>
                <div className="flex gap-2">
                  <input readOnly value={share.url} className={`${inputClass} font-mono text-xs`} onFocus={(event) => event.currentTarget.select()} />
                  <button type="button" className={secondaryButton} onClick={() => void copy(share.url, notify, 'Skopiowano link')}><Copy className="h-4 w-4" />Kopiuj</button>
                  <a className={secondaryButton} href={share.url} target="_blank" rel="noopener noreferrer" title="Otwórz stronę linku"><ExternalLink className="h-4 w-4" /></a>
                </div>
              </div>
              {share.access === 'password' && (
                <div className="space-y-2 rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/5 p-3">
                  <p className="flex items-center gap-2 text-[#e5e4e2]/80"><Lock className="h-4 w-4 text-[#d3bb73]" />Otworzy: {share.emails.join(', ')}</p>
                  {result?.password && (
                    <div className="flex items-center gap-2">
                      <span className="text-[#e5e4e2]/60">Hasło:</span>
                      <code className="rounded bg-[#0f1119] px-2 py-1 font-mono text-base tracking-wide text-[#d3bb73]">{result.password}</code>
                      <button type="button" className={secondaryButton} onClick={() => void copy(result.password!, notify, 'Skopiowano hasło')}><Copy className="h-4 w-4" />Kopiuj hasło</button>
                    </div>
                  )}
                  <p className="text-xs text-[#e5e4e2]/45">Hasła nie da się później odczytać — w „Linki” możesz ustawić nowe.</p>
                </div>
              )}
              <label className="block space-y-1">
                <span className="text-[#e5e4e2]/60">Wiadomość dla odbiorcy</span>
                <textarea className={`${inputClass} min-h-[11rem] text-sm`} value={text} onChange={(event) => setText(event.target.value)} />
              </label>
            </div>
          ) : (
            <form id="material-share-form" className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm" onSubmit={(event) => { event.preventDefault(); void save(); }}>
              {props.mode === 'create' ? (
                <p className="rounded-lg bg-[#0f1119] px-3 py-2 text-[#e5e4e2]/70">{targetsSummary(props.items)}</p>
              ) : (
                <p className="rounded-lg bg-[#0f1119] px-3 py-2 text-[#e5e4e2]/70">
                  {props.share.items.map((item) => `${KIND_NAMES[item.kind]} „${item.name}”`).join(', ')} · ważny do {materialShareDateLabel(props.share.expiresAt)}
                </p>
              )}
              <label className="block space-y-1">
                <span className="text-[#e5e4e2]/60">Tytuł na stronie</span>
                <input className={inputClass} value={title} maxLength={MATERIAL_SHARE_LIMITS.title} onChange={(event) => setTitle(event.target.value)}
                  placeholder="Np. Zdjęcia z fotobudki — wesele Ani i Tomka" />
              </label>
              <label className="block space-y-1">
                <span className="text-[#e5e4e2]/60">Wiadomość na stronie (opcjonalnie)</span>
                <textarea className={`${inputClass} min-h-[4.5rem]`} value={message} maxLength={MATERIAL_SHARE_LIMITS.message} onChange={(event) => setMessage(event.target.value)}
                  placeholder="Np. Dziękujemy za wspólną zabawę! Tutaj pobierzecie wszystkie zdjęcia z fotobudki." />
              </label>
              {!editing && (
                <div className="space-y-2">
                  <span className="text-[#e5e4e2]/60">Ważny przez</span>
                  <div className="flex flex-wrap gap-1.5">
                    {MATERIAL_SHARE_DAYS.map((value) => (
                      <button key={value} type="button" onClick={() => setDays(value)} aria-pressed={days === value}
                        className={`rounded-lg px-3 py-1.5 ${days === value ? 'bg-[#d3bb73] text-[#1c1f33]' : 'border border-[#d3bb73]/20 text-[#e5e4e2]/80 hover:bg-[#d3bb73]/10'}`}>
                        {materialShareDaysLabel(value)}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-[#e5e4e2]/45">Link przestanie działać {materialShareDateLabel(materialShareExpiry(days))}. Przedłużysz go w „Linki”.</p>
                </div>
              )}
              <div className="space-y-2">
                <span className="text-[#e5e4e2]/60">Kto może pobrać</span>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(['public', 'password'] as const).map((value) => (
                    <button key={value} type="button" onClick={() => setAccess(value)} aria-pressed={access === value}
                      className={`flex items-start gap-2 rounded-lg border p-3 text-left ${access === value ? 'border-[#d3bb73] bg-[#d3bb73]/10' : 'border-[#d3bb73]/15 hover:bg-[#d3bb73]/5'}`}>
                      {value === 'public' ? <Users className="mt-0.5 h-4 w-4 shrink-0 text-[#d3bb73]" /> : <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[#d3bb73]" />}
                      <span>
                        <span className="block text-[#e5e4e2]">{MATERIAL_SHARE_ACCESS_LABELS[value]}</span>
                        <span className="block text-xs text-[#e5e4e2]/50">
                          {value === 'public' ? 'Najprościej dla gości — wystarczy otworzyć link.' : 'Tylko osoby z listy, po wpisaniu hasła.'}
                        </span>
                      </span>
                      {access === value && <Check className="ml-auto h-4 w-4 shrink-0 text-[#d3bb73]" />}
                    </button>
                  ))}
                </div>
              </div>
              {access === 'password' && (
                <div className="space-y-3 rounded-lg border border-[#d3bb73]/15 p-3">
                  <label className="block space-y-1">
                    <span className="text-[#e5e4e2]/60">E-mail odbiorcy (kilka — oddziel przecinkami)</span>
                    <input className={inputClass} value={emails} onChange={(event) => setEmails(event.target.value)} placeholder="anna@example.com" inputMode="email" />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[#e5e4e2]/60">{editing && !needsPassword ? 'Nowe hasło (puste — bez zmiany)' : 'Hasło'}</span>
                    <input className={inputClass} value={password} maxLength={MATERIAL_SHARE_LIMITS.passwordMax} onChange={(event) => setPassword(event.target.value)}
                      placeholder={editing && !needsPassword ? 'Zostaw puste, aby zachować obecne hasło' : 'Puste — wygenerujemy bezpieczne hasło'} autoComplete="new-password" />
                  </label>
                </div>
              )}
              {error && <p role="alert" className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-red-200">{error}</p>}
            </form>
          )}

          <div className="flex flex-wrap justify-end gap-2 border-t border-[#d3bb73]/10 px-5 py-4">
            {share ? (
              <>
                <button type="button" className={secondaryButton} onClick={() => void copy(text, notify, 'Skopiowano wiadomość')}><Copy className="h-4 w-4" />Kopiuj wiadomość</button>
                <a className={secondaryButton} href={mailto}><Mail className="h-4 w-4" />Wyślij e-mailem</a>
                <button type="button" className={primaryButton} onClick={onClose}>Gotowe</button>
              </>
            ) : (
              <>
                <button type="button" className={secondaryButton} onClick={onClose} disabled={busy}>Anuluj</button>
                <button type="submit" form="material-share-form" className={primaryButton} disabled={busy || (props.mode === 'create' && !props.items.length)}>
                  {editing ? 'Zapisz' : 'Utwórz link'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </OverlayPortal>
  );
}
