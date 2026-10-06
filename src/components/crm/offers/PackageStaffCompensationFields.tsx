"use client";
import { packageCostLineNet, packageCostSettlementLabels, staffCostItem, validPackageCompensationSnapshot, type PackageCostCompensationSnapshot, type PackageCostSettlement, type PackageStaffCompensation, type ProductPackageStaff } from '@/lib/CRM/Offers/productSalesPackages';
const money = (n: number) => n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const field = 'mt-1 w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm text-[#e5e4e2]';
export default function PackageStaffCompensationFields({ row, settings, readOnly, scope = 'package', onChange }: {
  scope?: 'package' | 'product';
  row: ProductPackageStaff; settings: PackageCostCompensationSnapshot | null; readOnly?: boolean;
  onChange: (value: PackageStaffCompensation | null) => void;
}) {
  const payment = row.compensation;
  // Show editable defaults without creating a cost until the user enters it.
  const formPayment: PackageStaffCompensation = payment ?? {
    rate_basis: 'per_service',
    rate: NaN,
    settlement_method: 'invoice',
    compensation_snapshot: null,
  };
  const cost = staffCostItem(row);
  const total = cost ? packageCostLineNet(cost) : null;
  const update = (patch: Partial<PackageStaffCompensation>) => {
    onChange({ ...formPayment, ...patch });
  };
  if (readOnly && !payment) return <p className="text-xs text-[#e5e4e2]/50">Nie określono rozliczenia obsady.</p>;
  return <div className="space-y-3 rounded-lg bg-[#d3bb73]/5 p-3">
    {readOnly ? <p className="text-xs text-[#e5e4e2]/65">{packageCostSettlementLabels[payment!.settlement_method]} · {money(payment!.rate)} zł {payment!.rate_basis === 'hourly' ? '/ godzinę / osobę' : '/ realizację / osobę'}</p> : <>
      <label className="block text-xs text-[#e5e4e2]/60">Sposób rozliczenia<select value={formPayment.settlement_method} onChange={e => {
        const method = e.target.value as PackageCostSettlement;
        onChange({ rate_basis: formPayment.rate_basis, rate: formPayment.rate, settlement_method: method, compensation_snapshot: method === 'cash_non_deductible' ? payment?.compensation_snapshot || settings : null });
      }} className={field}>{Object.entries(packageCostSettlementLabels).map(([method, label]) => <option key={method} value={method}>{label}</option>)}</select></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-[#e5e4e2]/60">Naliczanie<select value={formPayment.rate_basis} onChange={e => update({ rate_basis: e.target.value as 'per_service' | 'hourly' })} className={field}><option value="per_service">Za realizację / osobę</option><option value="hourly">Za godzinę / osobę</option></select></label>
        <label className="text-xs text-[#e5e4e2]/60">{formPayment.settlement_method === 'invoice' ? 'Stawka netto (zł)' : 'Kwota do wypłaty (zł)'}<input type="number" min="0" max="99999999" step="0.01" placeholder="Podaj stawkę" value={Number.isFinite(formPayment.rate) ? formPayment.rate : ''} onChange={e => update({ rate: e.target.valueAsNumber })} className={field}/></label>
      </div>
      {!payment ? <p className="text-xs text-[#e5e4e2]/55">Wpisz stawkę, aby uwzględnić koszt pracy. Domyślnie wybrana jest faktura; przy wypłacie gotówką zmień sposób rozliczenia.</p> : <button type="button" onClick={() => onChange(null)} className="text-xs text-[#e5e4e2]/60 underline">Usuń ustaloną stawkę</button>}
    </>}
    {payment?.settlement_method === 'cash_non_deductible' && <div className="space-y-1 text-xs text-[#e5e4e2]/55">
      {validPackageCompensationSnapshot(payment.compensation_snapshot) ? <p>Zapisane parametry: CIT {payment.compensation_snapshot.cit_rate}% · dywidenda {payment.compensation_snapshot.dividend_rate}%.</p> : <p>Do obliczenia kosztu potrzebne są parametry z ustawień rozliczeń.</p>}
      {!readOnly && settings && (!validPackageCompensationSnapshot(payment.compensation_snapshot) || settings.cit_rate !== payment.compensation_snapshot.cit_rate || settings.dividend_rate !== payment.compensation_snapshot.dividend_rate) && <button type="button" onClick={() => update({ compensation_snapshot: { ...settings } })} className="text-[#d3bb73] underline">Zastosuj aktualne parametry CIT i dywidendy</button>}
      <a href="/crm/settings/compensation" target="_blank" rel="noopener noreferrer" className="inline-block text-[#d3bb73] underline">Ustawienia rozliczeń</a>
    </div>}
    <div className="space-y-1 text-xs" aria-live="polite">
      {payment && cost && cost.quantity > 0 && cost.unit_cost_net >= 0 && Number.isFinite(cost.quantity * cost.unit_cost_net) && <p className="text-[#e5e4e2]/60">{payment.settlement_method === 'invoice' ? 'Łączna wartość netto' : 'Łącznie do wypłaty'}: {money(cost.quantity * cost.unit_cost_net)} zł · {row.quantity} os.{payment.rate_basis === 'hourly' ? ` × ${row.estimated_hours ?? '—'} h` : ''}</p>}
      {payment?.settlement_method === 'cash_non_deductible' && total != null && cost && <p className="text-[#e5e4e2]/60">Dodatkowy koszt finansowania według ustawień: {money(total - cost.quantity * cost.unit_cost_net)} zł</p>}
      <p className="font-medium text-[#d3bb73]">Koszt dla spółki: {total == null ? 'uzupełnij stawkę, czas i parametry rozliczenia' : `${money(total)} zł`}</p>
      <p className="text-[#e5e4e2]/50">{row.is_optional ? 'Obsada opcjonalna — koszt nie jest doliczany.' : scope === 'product' ? 'Koszt obsady doliczany osobno do produktu i nowych pozycji oferty. Nie wpisuj go ponownie w koszcie bazowym.' : 'Koszt doliczany automatycznie do pakietu. Nie wpisuj tej samej obsady ponownie w kosztach realizacji.'}</p>
    </div>
  </div>;
}
