import { useMemo } from 'react';

function calculateCurrentValue(
  purchasePrice: number | null | undefined,
  purchaseDate: string | null | undefined,
  depreciationRate: number | null | undefined,
): number | null {
  if (!purchasePrice || !purchaseDate) return null;

  const rate = depreciationRate ?? 10;
  const purchaseDateObj = new Date(purchaseDate);
  const now = new Date();

  const yearsElapsed =
    (now.getTime() - purchaseDateObj.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

  if (yearsElapsed <= 0) return purchasePrice;

  const currentValue = purchasePrice * Math.pow(1 - rate / 100, yearsElapsed);
  return Math.max(0, currentValue);
}

export function PurchaseTab({ equipment, editForm, isEditing, onInputChange }: any) {
  const computedCurrentValue = useMemo(() => {
    const price = isEditing ? editForm.purchase_price : equipment?.purchase_price;
    const date = isEditing ? editForm.purchase_date : equipment?.purchase_date;
    const rate = isEditing ? editForm.depreciation_rate : equipment?.depreciation_rate;
    return calculateCurrentValue(
      price ? Number(price) : null,
      date || null,
      rate != null ? Number(rate) : null,
    );
  }, [
    isEditing,
    editForm?.purchase_price,
    editForm?.purchase_date,
    editForm?.depreciation_rate,
    equipment?.purchase_price,
    equipment?.purchase_date,
    equipment?.depreciation_rate,
  ]);

  const purchasePrice = isEditing
    ? Number(editForm.purchase_price) || 0
    : Number(equipment?.purchase_price) || 0;

  const depreciationAmount =
    purchasePrice && computedCurrentValue != null
      ? purchasePrice - computedCurrentValue
      : null;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        <h3 className="mb-6 text-lg font-medium text-[#e5e4e2]">Informacje zakupowe</h3>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {[
            { name: 'purchase_date', label: 'Data zakupu' },
            { name: 'warranty_until', label: 'Gwarancja do' },
          ].map(({ name, label }) => (
            <div key={name}>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">{label}</label>
              {isEditing ? (
                <input
                  type="date"
                  name={name}
                  value={editForm[name] || ''}
                  onChange={onInputChange}
                  className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                />
              ) : (
                <div className="text-[#e5e4e2]">
                  {equipment[name]
                    ? new Date(equipment[name]).toLocaleDateString('pl-PL')
                    : '-'}
                </div>
              )}
            </div>
          ))}

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Cena zakupu (zl)</label>
            {isEditing ? (
              <input
                type="number"
                step="0.01"
                name="purchase_price"
                value={editForm.purchase_price || ''}
                onChange={onInputChange}
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              />
            ) : (
              <div className="text-[#e5e4e2]">
                {equipment.purchase_price
                  ? `${Number(equipment.purchase_price).toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zl`
                  : '-'}
              </div>
            )}
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">
              Amortyzacja roczna (%)
            </label>
            {isEditing ? (
              <input
                type="number"
                step="1"
                min="0"
                max="100"
                name="depreciation_rate"
                value={editForm.depreciation_rate ?? 10}
                onChange={onInputChange}
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              />
            ) : (
              <div className="text-[#e5e4e2]">
                {equipment.depreciation_rate != null
                  ? `${Number(equipment.depreciation_rate)}%`
                  : '10%'}
              </div>
            )}
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Cena wynajmu za dzien (zl)</label>
            {isEditing ? (
              <input
                type="number"
                step="0.01"
                name="rental_price_per_day"
                value={editForm.rental_price_per_day || ''}
                onChange={onInputChange}
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              />
            ) : (
              <div className="text-[#e5e4e2]">
                {equipment.rental_price_per_day
                  ? `${Number(equipment.rental_price_per_day).toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zl`
                  : '-'}
              </div>
            )}
          </div>
        </div>
      </div>

      {(computedCurrentValue != null || equipment?.purchase_price) && (
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <h3 className="mb-4 text-lg font-medium text-[#e5e4e2]">Amortyzacja</h3>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div>
              <div className="text-sm text-[#e5e4e2]/60">Cena zakupu</div>
              <div className="mt-1 text-xl font-medium text-[#e5e4e2]">
                {purchasePrice
                  ? `${purchasePrice.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zl`
                  : '-'}
              </div>
            </div>
            <div>
              <div className="text-sm text-[#e5e4e2]/60">Wartosc biezaca</div>
              <div className="mt-1 text-xl font-medium text-[#d3bb73]">
                {computedCurrentValue != null
                  ? `${computedCurrentValue.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zl`
                  : '-'}
              </div>
            </div>
            <div>
              <div className="text-sm text-[#e5e4e2]/60">Laczna amortyzacja</div>
              <div className="mt-1 text-xl font-medium text-red-400">
                {depreciationAmount != null
                  ? `-${depreciationAmount.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zl`
                  : '-'}
              </div>
            </div>
          </div>

          {purchasePrice > 0 && computedCurrentValue != null && (
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-xs text-[#e5e4e2]/50">
                <span>0%</span>
                <span>
                  {((depreciationAmount! / purchasePrice) * 100).toFixed(1)}% zamortyzowane
                </span>
                <span>100%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-[#0f1119]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#d3bb73] to-[#d3bb73]/60 transition-all"
                  style={{
                    width: `${Math.min(100, (depreciationAmount! / purchasePrice) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
