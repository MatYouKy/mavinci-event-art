'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BadgePercent, UserCog } from 'lucide-react';
import { SELLER_WARNING_LABELS, type SellerWarningCode } from '@/lib/seller/sellerCockpit';
import CommissionVisibilityToggle from './CommissionVisibilityToggle';
import SellerManagerAssignment from './SellerManagerAssignment';
import { loadSellerManagement, type SellerManagementState } from './sellerManagerData';
import { SellerError, SellerLoading, errorText, isMissingRpc } from './sellerUi';

/** Karta sprzedawcy → Ustawienia: opiekun / zastępca oraz widoczność wynagrodzenia per marka. */
export default function SellerManagementPanel({ partnerId }: { partnerId: string }) {
  const [state, setState] = useState<SellerManagementState | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setState(await loadSellerManagement(partnerId));
      setError('');
    } catch (failure) {
      setState(null);
      setError(isMissingRpc(failure as { code?: string })
        ? 'Zarządzanie opiekunem wymaga migracji 20261105150000_seller_manager_cockpit.sql.'
        : errorText(failure, 'Nie udało się wczytać opiekuna i warunków sprzedawcy.'));
    } finally { setLoading(false); }
  }, [partnerId]);
  useEffect(() => { void load(); }, [load]);

  if (loading && !state) return <SellerLoading label="Wczytywanie opiekuna i widoczności wynagrodzenia…" />;
  if (error || !state) return <SellerError message={error || 'Brak danych opiekuna.'} onRetry={() => void load()} />;

  const commissionBrands = state.brands.filter(brand => brand.is_active);
  const warnings = (state.seller?.warnings || []).filter((code): code is SellerWarningCode => code in SELLER_WARNING_LABELS);

  return <div className="space-y-5">
    {warnings.length > 0 && <div className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-400/[0.07] p-3 text-xs text-amber-100">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      {warnings.map(code => <span key={code} className="rounded-full bg-amber-400/10 px-2 py-0.5">{SELLER_WARNING_LABELS[code]}</span>)}
    </div>}
    <section className="space-y-4 rounded-xl bg-white/[0.035] p-5" aria-labelledby="seller-manager-heading">
      <h3 id="seller-manager-heading" className="flex items-center gap-2 text-sm font-medium"><UserCog className="h-4 w-4 text-[#d3bb73]" />Opiekun i zastępca</h3>
      <SellerManagerAssignment
        partnerId={partnerId}
        isAdmin={state.isAdmin}
        managers={state.managers}
        managerId={state.managerId}
        managerName={state.managerName}
        backupId={state.backupId}
        backupName={state.backupName}
        managerOk={state.managerOk}
        onSaved={() => void load()}
      />
    </section>
    <section className="space-y-4 rounded-xl bg-white/[0.035] p-5" aria-labelledby="seller-visibility-heading">
      <div>
        <h3 id="seller-visibility-heading" className="flex items-center gap-2 text-sm font-medium"><BadgePercent className="h-4 w-4 text-[#d3bb73]" />Wynagrodzenie w portalu</h3>
        <p className="mt-1 text-xs leading-5 text-white/45">Decydujesz, kiedy sprzedawca zobaczy swoje prowizje dla danej marki. Prowizje naliczają się niezależnie od widoczności, a narzut jest zawsze widoczny.</p>
      </div>
      {commissionBrands.length === 0 ? <p className="rounded-xl bg-[#0f1119]/70 p-4 text-sm text-white/45">Sprzedawca nie ma aktywnych marek. Włącz markę w sekcji „Cennik i zasady prowizji” poniżej.</p> : (
        <ul className="space-y-2">
          {commissionBrands.map(brand => <li key={brand.my_company_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#0f1119]/70 p-3">
            <div>
              <p className="text-sm">{brand.name}</p>
              <p className="mt-0.5 text-xs text-white/45">{brand.commission_enabled ? `Prowizja ${brand.rate == null ? '—' : `${brand.rate.toLocaleString('pl-PL', { maximumFractionDigits: 2 })}%`}` : 'Rozliczenie narzutem — bez prowizji'}</p>
            </div>
            {brand.commission_enabled
              ? <CommissionVisibilityToggle partnerId={partnerId} companyId={brand.my_company_id} brandName={brand.name} visible={brand.commissions_visible} onChanged={() => void load()} />
              : <span className="text-xs text-white/35">Nie dotyczy</span>}
          </li>)}
        </ul>
      )}
    </section>
  </div>;
}
