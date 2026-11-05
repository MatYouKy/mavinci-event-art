'use client';

import { useCallback, useEffect, useState } from 'react';
import { Eye, FileClock, KeyRound, RefreshCw, Settings2, UserCog, WalletCards } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { commissionPaymentLabels, type CommissionPaymentMethod } from '@/lib/CRM/events/eventCommission';
import { SELLER_PROFILE_STATUS_LABELS, SellerError, SellerLoading, errorText, formatSellerDateTime, isMissingRpc } from './sellerUi';

type AuditRow = {
  id: string;
  action: string;
  my_company_id: string | null;
  brand_name: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  actor_name: string | null;
  created_at: string;
};

const ACTION_LABELS: Record<string, string> = {
  profile_created: 'Utworzono profil sprzedawcy',
  profile_updated: 'Zmieniono profil sprzedawcy',
  manager_changed: 'Zmiana opiekuna',
  terms_created: 'Dodano warunki marki',
  terms_updated: 'Zmieniono warunki marki',
  terms_deleted: 'Usunięto warunki marki',
  visibility_changed: 'Zmiana widoczności wynagrodzenia',
  portal_account_linked: 'Połączono konto portalu',
  portal_account_unlinked: 'Odłączono konto portalu',
};
const ACTION_ICONS: Record<string, typeof Settings2> = {
  manager_changed: UserCog,
  terms_created: WalletCards,
  terms_updated: WalletCards,
  terms_deleted: WalletCards,
  visibility_changed: Eye,
  portal_account_linked: KeyRound,
  portal_account_unlinked: KeyRound,
};
const PARTNER_TYPE_LABELS: Record<string, string> = {
  internal_employee: 'Sprzedawca Mavinci',
  hotel_employee: 'Pracownik hotelu',
  agency_employee: 'Pracownik agencji',
  independent_referrer: 'Niezależny polecający',
};

const yesNo = (value: unknown) => (value === true ? 'Tak' : value === false ? 'Nie' : '—');
const percent = (value: unknown) => (value == null || value === '' ? '—' : `${Number(value).toLocaleString('pl-PL', { maximumFractionDigits: 2 })}%`);
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : value == null || value === '' ? '—' : String(value));

/** Znane pola historii z polskimi etykietami; pozostałe (identyfikatory, kody techniczne) pomijamy. */
const FIELDS: { key: string; label: string; format: (value: unknown) => string }[] = [
  { key: 'status', label: 'Status', format: value => SELLER_PROFILE_STATUS_LABELS[String(value)] || '—' },
  { key: 'partner_type', label: 'Rodzaj współpracy', format: value => PARTNER_TYPE_LABELS[String(value)] || '—' },
  { key: 'organization_name', label: 'Organizacja', format: text },
  { key: 'portal_enabled', label: 'Dostęp do portalu', format: yesNo },
  { key: 'manager_name', label: 'Opiekun', format: text },
  { key: 'backup_manager_name', label: 'Zastępca', format: text },
  { key: 'is_active', label: 'Marka aktywna', format: yesNo },
  { key: 'commission_enabled', label: 'Rozliczenie prowizyjne', format: yesNo },
  { key: 'default_commission_rate', label: 'Stawka prowizji', format: percent },
  { key: 'default_payment_method', label: 'Sposób wypłaty', format: value => commissionPaymentLabels[value as CommissionPaymentMethod] || '—' },
  { key: 'dividend_tax_rate', label: 'Podatek', format: percent },
  { key: 'commissions_visible', label: 'Wynagrodzenie widoczne w portalu', format: yesNo },
  { key: 'notes', label: 'Notatka', format: text },
];

function describeChanges(row: AuditRow) {
  const before = row.before && typeof row.before === 'object' ? row.before : {};
  const after = row.after && typeof row.after === 'object' ? row.after : {};
  const changes = FIELDS.filter(field => field.key in before || field.key in after)
    .filter(field => JSON.stringify(before[field.key] ?? null) !== JSON.stringify(after[field.key] ?? null))
    .map(field => ({ label: field.label, from: field.key in before ? field.format(before[field.key]) : null, to: field.format(after[field.key]) }));
  // Zmiana opiekuna bez nazw w zapisie — pokaż sam fakt zmiany.
  if (row.action === 'manager_changed' && !changes.some(change => change.label === 'Opiekun')
    && JSON.stringify(before.manager_id ?? null) !== JSON.stringify(after.manager_id ?? null)) {
    changes.unshift({ label: 'Opiekun', from: null, to: after.manager_id ? 'przypisano innego pracownika' : 'usunięto' });
  }
  if (row.action === 'manager_changed' && !changes.some(change => change.label === 'Zastępca')
    && JSON.stringify(before.backup_manager_id ?? null) !== JSON.stringify(after.backup_manager_id ?? null)) {
    changes.push({ label: 'Zastępca', from: null, to: after.backup_manager_id ? 'przypisano innego pracownika' : 'usunięto' });
  }
  return changes;
}

/** Historia zmian sprzedawcy (get_seller_audit) — opiekun, warunki marek, widoczność wynagrodzenia, konto portalu. */
export default function SellerAuditHistory({ partnerId }: { partnerId: string }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(50);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc('get_seller_audit', { p_partner: partnerId, p_limit: limit });
    if (rpcError) {
      setRows(null);
      setError(isMissingRpc(rpcError) ? 'Historia zmian wymaga migracji 20261105150000_seller_manager_cockpit.sql.' : errorText(rpcError, 'Nie udało się wczytać historii zmian.'));
    } else {
      setRows(Array.isArray(data) ? (data as AuditRow[]) : []);
      setError('');
    }
    setLoading(false);
  }, [partnerId, limit]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener('seller-workspace-changed', refresh);
    return () => window.removeEventListener('seller-workspace-changed', refresh);
  }, [load]);

  if (loading && !rows) return <SellerLoading label="Wczytywanie historii zmian…" />;
  if (error) return <SellerError message={error} onRetry={() => void load()} />;

  return <section className="space-y-4" aria-label="Historia zmian sprzedawcy">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="text-base font-medium">Historia zmian</h3>
        <p className="mt-1 text-xs text-white/45">Kto i kiedy zmienił opiekuna, warunki marek, widoczność wynagrodzenia lub konto portalu. Wpisów nie można edytować ani usuwać.</p>
      </div>
      <button type="button" onClick={() => void load()} className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-[#d3bb73] hover:bg-white/10"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Odśwież</button>
    </header>
    {!rows?.length ? <div className="rounded-2xl bg-[#1c1f33] p-8 text-center text-sm text-white/45"><FileClock className="mx-auto mb-3 h-8 w-8 text-white/20" />Brak zapisanych zmian dla tego sprzedawcy.</div> : (
      <ol className="space-y-2">
        {rows.map((row) => {
          const Icon = ACTION_ICONS[row.action] || Settings2;
          const changes = describeChanges(row);
          return <li key={row.id} className="flex gap-3 rounded-2xl bg-[#1c1f33] p-4">
            <span className="mt-0.5 h-fit rounded-full bg-[#d3bb73]/10 p-2"><Icon className="h-4 w-4 text-[#d3bb73]" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-sm font-medium">{ACTION_LABELS[row.action] || 'Zmiana ustawień sprzedawcy'}{row.brand_name ? <span className="font-normal text-white/50"> · {row.brand_name}</span> : null}</p>
                <p className="text-xs text-white/40">{formatSellerDateTime(row.created_at)}</p>
              </div>
              <p className="mt-0.5 text-xs text-white/45">{row.actor_name || 'System'}</p>
              {changes.length > 0 && <ul className="mt-2 space-y-1 text-xs text-white/65">
                {changes.map(change => <li key={change.label}><span className="text-white/40">{change.label}:</span> {change.from !== null && <><span className="text-white/40 line-through decoration-white/20">{change.from}</span> → </>}<span>{change.to}</span></li>)}
              </ul>}
              {row.reason && <p className="mt-2 rounded-lg bg-white/[0.03] px-3 py-2 text-xs text-white/60">Powód: {row.reason}</p>}
            </div>
          </li>;
        })}
      </ol>
    )}
    {rows && rows.length >= limit && <button type="button" onClick={() => setLimit(value => value + 50)} className="w-full rounded-xl bg-white/[0.03] py-3 text-sm text-[#d3bb73] hover:bg-white/[0.06]">Pokaż starsze wpisy</button>}
  </section>;
}
