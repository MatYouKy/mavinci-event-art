export function PurchaseTab({ equipment, editForm, isEditing, onInputChange }: any) {
  return (
    <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
      <h3 className="text-lg font-medium text-[#e5e4e2] mb-6">Informacje zakupowe</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {[
          { name: 'purchase_date', label: 'Data zakupu' },
          { name: 'warranty_until', label: 'Gwarancja do' },
        ].map(({ name, label }) => (
          <div key={name}>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">{label}</label>
            {isEditing ? (
              <input
                type="date"
                name={name}
                value={editForm[name] || ''}
                onChange={onInputChange}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2]"
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

        {[
          { name: 'purchase_price', label: 'Cena zakupu (zł)', step: '0.01' },
          { name: 'current_value', label: 'Obecna wartość (zł)', step: '0.01' },
        ].map(({ name, label, step }) => (
          <div key={name}>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">{label}</label>
            {isEditing ? (
              <input
                type="number"
                step={step}
                name={name}
                value={editForm[name] || ''}
                onChange={onInputChange}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            ) : (
              <div className="text-[#e5e4e2]">
                {equipment[name]
                  ? `${Number(equipment[name]).toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł`
                  : '-'}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}