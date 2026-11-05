'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader2, ShieldAlert, UserRound } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { errorText, sellerFieldClass, sellerPrimaryButton, sellerSecondaryButton } from './sellerUi';

export type SellerManagerOption = { id: string; name: string; eligible: boolean };

type Props = {
  partnerId: string;
  isAdmin: boolean;
  managers: SellerManagerOption[];
  managerId: string | null;
  backupId: string | null;
  managerName?: string | null;
  backupName?: string | null;
  /** false = obecny opiekun nie ma uprawnień do ofert / marek sprzedawcy. null = nieznane. */
  managerOk?: boolean | null;
  onSaved?: (result: { managerId: string | null; backupId: string | null }) => void;
  onCancel?: () => void;
};

export function ManagerRightsBadge() {
  return <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/10 px-2 py-0.5 text-[11px] font-medium text-amber-200" title="Opiekun nie ma uprawnienia do ofert albo dostępu do wszystkich aktywnych marek sprzedawcy">
    <ShieldAlert className="h-3 w-3" aria-hidden="true" />Opiekun bez uprawnień
  </span>;
}

/** Opiekun i zastępca sprzedawcy — zmiana tylko przez administratora (set_seller_manager). */
export default function SellerManagerAssignment({ partnerId, isAdmin, managers, managerId, backupId, managerName, backupName, managerOk = null, onSaved, onCancel }: Props) {
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const [manager, setManager] = useState(managerId || '');
  const [backup, setBackup] = useState(backupId || '');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setManager(managerId || ''); setBackup(backupId || ''); }, [managerId, backupId]);

  const options = useMemo(() => {
    const list = [...managers];
    // Obecny opiekun / zastępca spoza listy (np. bez uprawnień) — pokaż go, by nie zgubić wyboru.
    if (managerId && !list.some(item => item.id === managerId)) list.push({ id: managerId, name: managerName || 'Obecny opiekun', eligible: false });
    if (backupId && !list.some(item => item.id === backupId)) list.push({ id: backupId, name: backupName || 'Obecny zastępca', eligible: false });
    return list.sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.name.localeCompare(b.name, 'pl'));
  }, [managers, managerId, backupId, managerName, backupName]);
  const nameOf = (id: string | null, fallback?: string | null) => (id ? options.find(item => item.id === id)?.name || fallback || 'Pracownik' : null);
  const changed = manager !== (managerId || '') || backup !== (backupId || '');

  const validate = (): string | null => {
    if (!manager && backup) return 'Zastępca wymaga opiekuna. Wybierz najpierw opiekuna albo usuń zastępcę.';
    if (manager && backup && manager === backup) return 'Zastępca musi być inną osobą niż opiekun.';
    const chosen = options.find(item => item.id === manager);
    if (manager && chosen && !chosen.eligible) return `${chosen.name} nie ma uprawnień do ofert — nie może zostać opiekunem.`;
    const chosenBackup = options.find(item => item.id === backup);
    if (backup && chosenBackup && !chosenBackup.eligible) return `${chosenBackup.name} nie ma uprawnień do ofert — nie może zostać zastępcą.`;
    return null;
  };

  const save = async () => {
    if (saving) return;
    const validation = validate();
    if (validation) { setError(validation); return; }
    if (!manager && managerId && !(await showConfirm({
      title: 'Usunąć opiekuna?',
      message: 'Rozmowy, oferty do sprawdzenia i zapytania sprzedawcy trafią wtedy wyłącznie do administratorów.',
      confirmText: 'Usuń opiekuna',
      cancelText: 'Wróć',
    }))) return;
    setSaving(true);
    setError('');
    const { data, error: rpcError } = await supabase.rpc('set_seller_manager', {
      p_partner: partnerId,
      p_manager: manager || null,
      p_backup: backup || null,
      p_reason: reason.trim() || null,
    });
    setSaving(false);
    if (rpcError) {
      const message = errorText(rpcError, 'Nie udało się zmienić opiekuna.');
      setError(message);
      showSnackbar(message, 'error');
      return;
    }
    const result = (data && typeof data === 'object' ? data : {}) as { manager_id?: string | null; backup_manager_id?: string | null };
    setReason('');
    showSnackbar(manager ? `Opiekun: ${nameOf(manager)}${backup ? `, zastępca: ${nameOf(backup)}` : ''}.` : 'Usunięto opiekuna sprzedawcy.', 'success');
    onSaved?.({ managerId: result.manager_id ?? (manager || null), backupId: result.backup_manager_id ?? (backup || null) });
    window.dispatchEvent(new Event('seller-workspace-changed'));
  };

  const summary = <div className="grid gap-3 sm:grid-cols-2">
    {[['Opiekun', managerId, managerName], ['Zastępca', backupId, backupName]].map(([label, id, fallback]) => (
      <div key={label as string} className="flex items-center gap-3 rounded-xl bg-[#0f1119]/70 p-3">
        <span className="rounded-full bg-[#d3bb73]/10 p-2"><UserRound className="h-4 w-4 text-[#d3bb73]" /></span>
        <span className="min-w-0">
          <span className="block text-[11px] uppercase tracking-wide text-white/35">{label as string}</span>
          <span className="block truncate text-sm">{nameOf((id as string) || null, fallback as string | null) || (label === 'Opiekun' ? 'Brak opiekuna' : 'Brak zastępcy')}</span>
        </span>
        {label === 'Opiekun' && id && managerOk === false && <ManagerRightsBadge />}
      </div>
    ))}
  </div>;

  if (!isAdmin) return <div className="space-y-3">
    {summary}
    <p className="text-xs text-white/45">Opiekuna i zastępcę przydziela administrator. Opiekun prowadzi rozmowy, decyzje o ofertach i realizacje sprzedawcy; zastępca przejmuje je podczas nieobecności.</p>
  </div>;

  return <div className="space-y-4">
    {managerId && managerOk === false && <p className="flex items-start gap-2 rounded-xl bg-amber-400/10 p-3 text-xs leading-5 text-amber-100"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Obecny opiekun nie ma uprawnienia do ofert albo dostępu do wszystkich aktywnych marek sprzedawcy. Wybierz uprawnioną osobę lub nadaj jej dostęp.</p>}
    <div className="grid gap-3 md:grid-cols-2">
      <label className="text-xs text-white/55">Opiekun
        <select value={manager} onChange={(event) => { setManager(event.target.value); setError(''); }} disabled={saving} className={`${sellerFieldClass} mt-1.5`}>
          <option value="">Brak opiekuna</option>
          {options.map(item => <option key={item.id} value={item.id} disabled={!item.eligible && item.id !== managerId}>{item.name}{item.eligible ? '' : ' — bez uprawnień'}</option>)}
        </select>
      </label>
      <label className="text-xs text-white/55">Zastępca (opcjonalnie)
        <select value={backup} onChange={(event) => { setBackup(event.target.value); setError(''); }} disabled={saving || !manager} className={`${sellerFieldClass} mt-1.5`}>
          <option value="">Brak zastępcy</option>
          {options.filter(item => item.id !== manager).map(item => <option key={item.id} value={item.id} disabled={!item.eligible && item.id !== backupId}>{item.name}{item.eligible ? '' : ' — bez uprawnień'}</option>)}
        </select>
      </label>
    </div>
    <label className="block text-xs text-white/55">Powód zmiany (opcjonalnie, trafi do historii)
      <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} disabled={saving} className={`${sellerFieldClass} mt-1.5`} placeholder="np. Przejęcie hoteli regionu warmińskiego" />
    </label>
    <p className="text-xs leading-5 text-white/45">Opiekun musi być aktywnym pracownikiem z uprawnieniem do ofert i dostępem do każdej aktywnej marki sprzedawcy. Zmiana ustawia też opiekuna kontaktu w CRM.</p>
    {error && <p role="alert" className="rounded-xl bg-red-400/10 p-3 text-sm text-red-100">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2">
      {onCancel && <button type="button" onClick={onCancel} disabled={saving} className={sellerSecondaryButton}>Anuluj</button>}
      <button type="button" onClick={() => void save()} disabled={saving || !changed} className={sellerPrimaryButton}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Zapisz opiekuna
      </button>
    </div>
  </div>;
}
