'use client';

import { useCallback, useEffect, useState } from 'react';
import { Clock3, Copy, ExternalLink, KeyRound, Link2, Loader2, Lock, Pencil, Power, RefreshCw, Trash2, Users, X } from 'lucide-react';
import OverlayPortal from '@/components/UI/OverlayPortal';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useGlobalLoader } from '@/contexts/GlobalLoaderContext';
import { useDialog } from '@/contexts/DialogContext';
import {
  MATERIAL_SHARE_ACCESS_LABELS, MATERIAL_SHARE_DAYS, MATERIAL_SHARE_STATUS_LABELS, materialShareDateLabel, materialShareDaysLabel, materialShareMessage,
  materialShareSummary,
} from '@/lib/materials/materialsShared';
import MaterialShareDialog from './MaterialShareDialog';
import {
  deleteMaterialShare, materialShares, updateMaterialShare, type MaterialShare, type MaterialShareChange, type MaterialShareCreated,
} from './materialsApi';
import { cardClass, errorMessage, ghostButton, secondaryButton } from './materialsUi';

/*
 * „Linki” w Materiałach — linki do pobrania marki (CRM; Mac — `MaterialSharesSheet`, telefon — `MaterialSharesModal`): aktywne
 * i nieaktywne (wygasłe, wyłączone), co zawierają, kto może pobrać, ważność, otwarcia i pobrania. Czynności: kopiuj link,
 * otwórz, przedłuż (od teraz o 1–30 dni), wyłącz / włącz, zmień (tytuł, wiadomość, dostęp), nowe hasło, usuń.
 */

const KIND_NAMES = { folder: 'Folder', album: 'Album', file: 'Plik' } as const;

export default function MaterialSharesPanel({ companyId, companyName, onClose }: { companyId: string; companyName: string; onClose: () => void }) {
  const { showSnackbar } = useSnackbar();
  const { showLoader, hideLoader } = useGlobalLoader();
  const { showConfirm } = useDialog();
  const [shares, setShares] = useState<MaterialShare[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [extendFor, setExtendFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<MaterialShare | null>(null);
  /** „Nowe hasło” — wynik do pokazania raz (hasło i wiadomość dla odbiorcy). */
  const [passwordResult, setPasswordResult] = useState<MaterialShareCreated | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await materialShares(companyId);
      setShares(data.shares);
      setLoadError('');
    } catch (error) {
      setLoadError(errorMessage(error, 'Nie udało się pobrać linków.'));
    }
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);

  const replace = (share: MaterialShare) => setShares((current) => current?.map((item) => (item.id === share.id ? share : item)) || current);

  const change = async (pending: string, input: MaterialShareChange, success: string) => {
    showLoader(pending, 'Proszę chwilę poczekać...');
    try {
      const result = await updateMaterialShare(input);
      replace(result.share);
      showSnackbar(success, 'success');
      return result;
    } catch (error) {
      showSnackbar(errorMessage(error, 'Nie udało się zapisać zmian linku.'), 'error');
      return null;
    } finally {
      hideLoader();
    }
  };

  const copy = async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showSnackbar(done, 'success');
    } catch {
      showSnackbar('Nie udało się skopiować — zaznacz tekst i skopiuj ręcznie.', 'error');
    }
  };

  const remove = async (share: MaterialShare) => {
    const confirmed = await showConfirm({
      title: 'Usunąć link?',
      message: `Adres „${share.title}” przestanie działać od razu. Pliki zostaną w Materiałach.`,
      confirmText: 'Usuń link',
      cancelText: 'Anuluj',
    });
    if (!confirmed) return;
    showLoader('Usuwam link', 'Proszę chwilę poczekać...');
    try {
      await deleteMaterialShare(share.id);
      setShares((current) => current?.filter((item) => item.id !== share.id) || current);
      showSnackbar('Usunięto link — pliki zostały w Materiałach', 'success');
    } catch (error) {
      showSnackbar(errorMessage(error, 'Nie udało się usunąć linku.'), 'error');
    } finally {
      hideLoader();
    }
  };

  const active = (shares || []).filter((share) => share.status === 'active');
  const inactive = (shares || []).filter((share) => share.status !== 'active');

  const row = (share: MaterialShare) => (
    <li key={share.id} className={`${cardClass} space-y-2 p-3 text-sm`}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[#e5e4e2]">{share.title}</p>
          <p className="truncate text-xs text-[#e5e4e2]/50">
            {share.items.map((item) => `${KIND_NAMES[item.kind]} „${item.name}”${item.missing ? ' (usunięty)' : ''}`).join(', ')} · {materialShareSummary(share.fileCount, share.totalBytes)}
          </p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[11px] ${share.status === 'active' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-[#e5e4e2]/10 text-[#e5e4e2]/60'}`}>
          {MATERIAL_SHARE_STATUS_LABELS[share.status]}
        </span>
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#e5e4e2]/60">
        <span className="inline-flex items-center gap-1">
          {share.access === 'password' ? <Lock className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
          {MATERIAL_SHARE_ACCESS_LABELS[share.access]}{share.access === 'password' ? `: ${share.emails.join(', ')}` : ''}
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock3 className="h-3.5 w-3.5" />
          {share.status === 'revoked' ? `wyłączony ${materialShareDateLabel(share.revokedAt)}` : `${share.status === 'expired' ? 'wygasł' : 'ważny do'} ${materialShareDateLabel(share.expiresAt)}`}
        </span>
        <span>Otwarcia: {share.viewCount} · pobrania: {share.downloadCount}{share.lastDownloadedAt ? ` (ostatnio ${materialShareDateLabel(share.lastDownloadedAt)})` : ''}</span>
        {share.openedBy.length > 0 && <span>Otworzyli: {share.openedBy.join(', ')}</span>}
        <span>Utworzył(a): {share.createdBy || '—'}, {materialShareDateLabel(share.createdAt)}</span>
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" className={ghostButton} onClick={() => void copy(share.url, 'Skopiowano link')}><Copy className="h-4 w-4" />Kopiuj link</button>
        <button type="button" className={ghostButton} onClick={() => void copy(materialShareMessage({
          url: share.url, title: share.title, expiresAt: share.expiresAt, access: share.access, emails: share.emails, companyName,
        }), 'Skopiowano wiadomość (bez hasła)')}><Copy className="h-4 w-4" />Kopiuj wiadomość</button>
        <a className={ghostButton} href={share.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" />Otwórz</a>
        <span className="relative">
          <button type="button" className={ghostButton} onClick={() => setExtendFor(extendFor === share.id ? null : share.id)} aria-expanded={extendFor === share.id}>
            <Clock3 className="h-4 w-4" />{share.status === 'active' ? 'Przedłuż' : 'Włącz ponownie'}
          </button>
          {extendFor === share.id && (
            <span className="absolute left-0 top-full z-30 mt-1 block w-56 rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] p-1 shadow-2xl">
              <span className="block px-2 py-1 text-[11px] text-[#e5e4e2]/45">Ważny od teraz przez:</span>
              {MATERIAL_SHARE_DAYS.map((days) => (
                <button key={days} type="button" className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-[#d3bb73]/10"
                  onClick={() => {
                    setExtendFor(null);
                    void change('Zapisuję ważność linku', { id: share.id, days, ...(share.revokedAt ? { revoked: false } : {}) },
                      share.status === 'active' ? `Link ważny jeszcze ${materialShareDaysLabel(days)}` : `Link znów działa — ${materialShareDaysLabel(days)}`);
                  }}>
                  {materialShareDaysLabel(days)}
                </button>
              ))}
            </span>
          )}
        </span>
        <button type="button" className={ghostButton} onClick={() => setEditing(share)}><Pencil className="h-4 w-4" />Zmień</button>
        {share.access === 'password' && (
          <button type="button" className={ghostButton} onClick={() => void (async () => {
            const confirmed = await showConfirm({
              title: 'Ustawić nowe hasło?',
              message: 'Wygenerujemy nowe hasło i pokażemy je raz. Dotychczasowe hasło przestanie działać, a osoby, które już otworzyły link, podadzą nowe.',
              confirmText: 'Nowe hasło',
              cancelText: 'Anuluj',
            });
            if (!confirmed) return;
            const result = await change('Ustawiam nowe hasło', { id: share.id, newPassword: true }, 'Ustawiono nowe hasło');
            if (result?.password) setPasswordResult(result);
          })()}><KeyRound className="h-4 w-4" />Nowe hasło</button>
        )}
        {share.status === 'active' && (
          <button type="button" className={ghostButton}
            onClick={() => void change('Wyłączam link', { id: share.id, revoked: true }, 'Link wyłączony — adres przestał działać')}>
            <Power className="h-4 w-4" />Wyłącz
          </button>
        )}
        <button type="button" className={ghostButton} onClick={() => void remove(share)}><Trash2 className="h-4 w-4 text-red-300" />Usuń</button>
      </div>
    </li>
  );

  return (
    <OverlayPortal>
      <div className="fixed inset-0 z-[78] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Linki do pobrania"
        onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-[#d3bb73]/15 bg-[#1c1f33] text-[#e5e4e2] shadow-2xl">
          <div className="flex items-center gap-2 border-b border-[#d3bb73]/10 px-5 py-4">
            <Link2 className="h-5 w-5 text-[#d3bb73]" />
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-light">Linki do pobrania — {companyName}</h2>
              <p className="text-xs text-[#e5e4e2]/50">Udostępnij folder, album albo pliki prawym przyciskiem → „Udostępnij link…”.</p>
            </div>
            <button type="button" className={ghostButton} onClick={() => void load()} title="Odśwież"><RefreshCw className="h-4 w-4" /></button>
            <button type="button" className={ghostButton} onClick={onClose} aria-label="Zamknij"><X className="h-4 w-4" /></button>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {loadError ? (
              <div className="space-y-2 text-sm text-red-200">
                <p>{loadError}</p>
                <button type="button" className={secondaryButton} onClick={() => void load()}>Spróbuj ponownie</button>
              </div>
            ) : !shares ? (
              <p className="flex items-center gap-2 text-sm text-[#e5e4e2]/60"><Loader2 className="h-4 w-4 animate-spin" />Wczytuję linki…</p>
            ) : !shares.length ? (
              <p className="text-sm text-[#e5e4e2]/60">Ta marka nie ma jeszcze linków do pobrania.</p>
            ) : (
              <>
                <section className="space-y-2">
                  <h3 className="text-sm text-[#e5e4e2]/70">Aktywne ({active.length})</h3>
                  {active.length ? <ul className="space-y-2">{active.map(row)}</ul> : <p className="text-xs text-[#e5e4e2]/45">Brak aktywnych linków.</p>}
                </section>
                {inactive.length > 0 && (
                  <section className="space-y-2">
                    <h3 className="text-sm text-[#e5e4e2]/70">Nieaktywne — wygasłe i wyłączone ({inactive.length})</h3>
                    <ul className="space-y-2">{inactive.map(row)}</ul>
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      {editing && (
        <MaterialShareDialog mode="edit" share={editing} companyId={companyId} companyName={companyName}
          onClose={() => setEditing(null)} onSaved={replace} />
      )}
      {passwordResult && (
        <MaterialShareDialog mode="edit" share={passwordResult.share} created={passwordResult} companyId={companyId} companyName={companyName}
          onClose={() => setPasswordResult(null)} onSaved={replace} />
      )}
    </OverlayPortal>
  );
}
