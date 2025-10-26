import { FileText } from 'lucide-react';

export function TechnicalTab({ equipment, editForm, isEditing, onInputChange, connectorTypes, warehouseCategories }: any) {
  const currentCategoryId =
    isEditing && editForm.warehouse_category_id ? editForm.warehouse_category_id : equipment.warehouse_categories?.id;

  const currentCategory = warehouseCategories?.find((c: any) => c.id === currentCategoryId);
  const usesSimpleQuantity = currentCategory?.uses_simple_quantity || false;

  return (
    <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
      <h3 className="text-lg font-medium text-[#e5e4e2] mb-6">Parametry techniczne</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {usesSimpleQuantity ? (
          <>
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Długość (m)</label>
              {isEditing ? (
                <input
                  type="number"
                  step="0.5"
                  name="cable_length_meters"
                  value={editForm.cable_length_meters || ''}
                  onChange={onInputChange}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              ) : (
                <div className="text-[#e5e4e2]">
                  {equipment.cable_specs?.length_meters ? `${equipment.cable_specs.length_meters} m` : '-'}
                </div>
              )}
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Wtyki</label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {['in', 'out'].map((side) => (
                  <div key={side}>
                    <label className="block text-xs text-[#e5e4e2]/40 mb-2">
                      {side === 'in' ? 'Wtyk wejściowy' : 'Wtyk wyjściowy'}
                    </label>
                    {isEditing ? (
                      <select
                        name={side === 'in' ? 'cable_connector_in' : 'cable_connector_out'}
                        value={editForm[side === 'in' ? 'cable_connector_in' : 'cable_connector_out'] || ''}
                        onChange={onInputChange}
                        className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2]"
                      >
                        <option value="">Wybierz wtyk</option>
                        {connectorTypes.map((c: any) => (
                          <option key={c.id} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="text-[#e5e4e2]">
                        {side === 'in'
                          ? equipment.cable_specs?.connector_in || '-'
                          : equipment.cable_specs?.connector_out || '-'}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Waga (kg)</label>
              {isEditing ? (
                <input
                  type="number"
                  step="0.01"
                  name="weight_kg"
                  value={editForm.weight_kg || ''}
                  onChange={onInputChange}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              ) : (
                <div className="text-[#e5e4e2]">{equipment.weight_kg ? `${equipment.weight_kg} kg` : '-'}</div>
              )}
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Wymiary (cm)</label>
              {isEditing ? (
                <div className="grid grid-cols-3 gap-2">
                  {['dimensions_length', 'dimensions_width', 'dimensions_height'].map((n) => (
                    <input
                      key={n}
                      type="number"
                      step="0.1"
                      name={n}
                      value={editForm[n] || ''}
                      onChange={onInputChange}
                      placeholder={
                        n === 'dimensions_length' ? 'Długość' : n === 'dimensions_width' ? 'Szerokość' : 'Wysokość'
                      }
                      className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-3 py-2 text-[#e5e4e2] text-sm"
                    />
                  ))}
                </div>
              ) : (
                <div className="text-[#e5e4e2]">
                  {equipment.dimensions_cm
                    ? `${equipment.dimensions_cm.length || '-'} × ${equipment.dimensions_cm.width || '-'} × ${equipment.dimensions_cm.height || '-'} cm`
                    : '-'}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Numer seryjny</label>
              {isEditing ? (
                <input
                  type="text"
                  name="serial_number"
                  value={editForm.serial_number || ''}
                  onChange={onInputChange}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              ) : (
                <div className="text-[#e5e4e2]">{equipment.serial_number || '-'}</div>
              )}
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Kod kreskowy</label>
              {isEditing ? (
                <input
                  type="text"
                  name="barcode"
                  value={editForm.barcode || ''}
                  onChange={onInputChange}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              ) : (
                <div className="text-[#e5e4e2] font-mono">{equipment.barcode || '-'}</div>
              )}
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Instrukcja obsługi (URL)</label>
              {isEditing ? (
                <input
                  type="url"
                  name="user_manual_url"
                  value={editForm.user_manual_url || ''}
                  onChange={onInputChange}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              ) : equipment.user_manual_url ? (
                <a
                  href={equipment.user_manual_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#d3bb73] hover:underline flex items-center gap-2"
                >
                  <FileText className="w-4 h-4" />
                  Otwórz instrukcję
                </a>
              ) : (
                <div className="text-[#e5e4e2]/60">-</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}