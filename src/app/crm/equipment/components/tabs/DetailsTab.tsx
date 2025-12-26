import EquipmentSkillRequirementsPanel from '@/components/crm/EquipmentSkillRequirementsPanel';
import { Upload, Package } from 'lucide-react';

export function DetailsTab({
  equipment,
  editForm,
  isEditing,
  onInputChange,
  onThumbnailUpload,
  canEdit,
  warehouseCategories,
  storageLocations,
}: any) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1">
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          {isEditing ? (
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Miniaturka</label>
              {editForm.thumbnail_url ? (
                <div className="space-y-2">
                  <img
                    src={editForm.thumbnail_url}
                    alt={equipment.name}
                    className="w-full aspect-square object-cover rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => onInputChange({ target: { name: 'thumbnail_url', value: '' } } as any)}
                    className="w-full text-red-400 hover:text-red-300 text-sm"
                  >
                    Usuń zdjęcie
                  </button>
                </div>
              ) : (
                <div>
                  <input type="file" accept="image/*" onChange={onThumbnailUpload} className="hidden" id="thumbnail-upload-edit" />
                  <label
                    htmlFor="thumbnail-upload-edit"
                    className="flex items-center justify-center gap-2 w-full aspect-square bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg text-[#e5e4e2]/60 hover:border-[#d3bb73]/30 cursor-pointer transition-colors"
                  >
                    <Upload className="w-8 h-8" />
                  </label>
                </div>
              )}
            </div>
          ) : equipment.thumbnail_url ? (
            <img src={equipment.thumbnail_url} alt={equipment.name} className="w-full aspect-square object-cover rounded-lg" />
          ) : (
            <div className="w-full aspect-square bg-[#d3bb73]/20 rounded-lg flex items-center justify-center">
              <Package className="w-16 h-16 text-[#d3bb73]" />
            </div>
          )}

          <div className="mt-6 space-y-4">
            <div>
              <div className="text-sm text-[#e5e4e2]/60 mb-1">Kategoria</div>
              {isEditing ? (
                <select
                  name="warehouse_category_id"
                  value={editForm.warehouse_category_id || ''}
                  onChange={onInputChange}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-3 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                >
                  <option value="">Brak</option>
                  {warehouseCategories?.filter((c: any) => c.level === 1).map((cat: any) => (
                    <optgroup key={cat.id} label={cat.name}>
                      <option value={cat.id}>{cat.name}</option>
                      {warehouseCategories?.filter((sub: any) => sub.parent_id === cat.id).map((sub: any) => (
                        <option key={sub.id} value={sub.id}>
                          &nbsp;&nbsp;└─ {sub.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              ) : equipment.warehouse_categories ? (
                <div className="inline-block px-3 py-1 rounded bg-blue-500/20 text-blue-400">
                  {(() => {
                    const cat = equipment.warehouse_categories;
                    if (cat.level === 2 && cat.parent_id) {
                      const parent = warehouseCategories?.find((c: any) => c.id === cat.parent_id);
                      return parent ? `${parent.name} / ${cat.name}` : cat.name;
                    }
                    return cat.name;
                  })()}
                </div>
              ) : (
                <div className="text-[#e5e4e2]/60">-</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="lg:col-span-2 space-y-6">
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <h3 className="text-lg font-medium text-[#e5e4e2] mb-4">Podstawowe informacje</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Nazwa</label>
              {isEditing ? (
                <input
                  type="text"
                  name="name"
                  value={editForm.name || ''}
                  onChange={onInputChange}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                />
              ) : (
                <div className="text-[#e5e4e2]">{equipment.name}</div>
              )}
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Marka</label>
              {isEditing ? (
                <input
                  type="text"
                  name="brand"
                  value={editForm.brand || ''}
                  onChange={onInputChange}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                />
              ) : (
                <div className="text-[#e5e4e2]">{equipment.brand || '-'}</div>
              )}
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Model</label>
              {isEditing ? (
                <input
                  type="text"
                  name="model"
                  value={editForm.model || ''}
                  onChange={onInputChange}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                />
              ) : (
                <div className="text-[#e5e4e2]">{equipment.model || '-'}</div>
              )}
            </div>

            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Lokalizacja magazynowa</label>
              {isEditing ? (
                <select
                  name="storage_location_id"
                  value={editForm.storage_location_id || ''}
                  onChange={onInputChange}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                >
                  <option value="">Nieokreślona</option>
                  {storageLocations.map((loc: any) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="text-[#e5e4e2]">
                  {equipment?.storage_location_id
                    ? storageLocations.find((l: any) => l.id === equipment.storage_location_id)?.name || 'Nieokreślona'
                    : 'Nieokreślona'}
                </div>
              )}
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Opis</label>
              {isEditing ? (
                <textarea
                  name="description"
                  value={editForm.description || ''}
                  onChange={onInputChange}
                  rows={4}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                />
              ) : (
                <pre className="text-[#e5e4e2] whitespace-pre-wrap font-sans">{equipment.description || '-'}</pre>
              )}
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Notatki</label>
              {isEditing ? (
                <textarea
                  name="notes"
                  value={editForm.notes || ''}
                  onChange={onInputChange}
                  rows={3}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                />
              ) : (
                <div className="text-[#e5e4e2]">{equipment.notes || '-'}</div>
              )}
            </div>
          </div>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <EquipmentSkillRequirementsPanel equipmentId={equipment.id} canEdit={true} />
        </div>
      </div>
    </div>
  );
}