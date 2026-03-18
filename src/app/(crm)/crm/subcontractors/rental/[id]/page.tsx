'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Package, CreditCard as Edit, Save, X, Trash2 } from 'lucide-react';

import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

import RentalEquipmentGallery from '@/components/crm/RentalEquipmentGallery';

import {
  useGetRentalEquipmentDetailsQuery,
  useUpdateRentalEquipmentMutation,
  useDeleteRentalEquipmentMutation,
} from '../../api/rentalApi';
import { useGetEquipmentCategoriesQuery } from '@/app/(crm)/crm/equipment/store/equipmentApi';

export default function RentalEquipmentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const equipmentId = params?.id as string;
  const { showSnackbar } = useSnackbar();
  const { employee, loading: employeeLoading } = useCurrentEmployee();

  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>(null);

  const {
    data: equipment,
    isFetching: eqLoading,
    isError: eqError,
    refetch: refetchEquipment,
  } = useGetRentalEquipmentDetailsQuery(equipmentId, {
    skip: !equipmentId,
    refetchOnMountOrArgChange: true,
  });

  const { data: warehouseCategories = [] } = useGetEquipmentCategoriesQuery();

  const [updateEquipmentMutation] = useUpdateRentalEquipmentMutation();
  const [deleteEquipmentMutation] = useDeleteRentalEquipmentMutation();

  const canEdit = employee?.permissions?.includes('equipment_manage');

  const handleEdit = () => {
    setEditForm({ ...equipment });
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setEditForm(null);
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (!editForm) return;

    try {
      await updateEquipmentMutation({
        id: equipmentId,
        updates: {
          name: editForm.name,
          description: editForm.description,
          category: editForm.category,
          warehouse_category_id: editForm.warehouse_category_id || null,
          vat_rate: editForm.vat_rate,
          daily_price_net: editForm.daily_price_net,
          daily_price_gross: editForm.daily_price_gross,
          weekly_price_net: editForm.weekly_price_net,
          weekly_price_gross: editForm.weekly_price_gross,
          monthly_price_net: editForm.monthly_price_net,
          monthly_price_gross: editForm.monthly_price_gross,
          quantity_available: editForm.quantity_available,
          required_skills: editForm.required_skills,
          specifications: editForm.specifications,
          notes: editForm.notes,
          is_active: editForm.is_active,
          images: editForm.images || [],
          thumbnail_url: editForm.images?.[0]?.url || editForm.thumbnail_url,
        },
      }).unwrap();

      showSnackbar('Zapisano zmiany', 'success');
      setIsEditing(false);
      setEditForm(null);
      refetchEquipment();
    } catch (err: any) {
      showSnackbar(err?.message || 'Błąd podczas zapisywania', 'error');
    }
  };

  const handleImagesChange = (newImages: any[]) => {
    if (isEditing) {
      setEditForm((prev: any) => ({
        ...prev,
        images: newImages,
        thumbnail_url: newImages.find((img) => img.isPrimary)?.url || newImages[0]?.url || null,
      }));
    }
  };

  const handleChange = (field: string, value: any) => {
    setEditForm((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleDelete = async () => {
    if (
      !confirm(`Czy na pewno chcesz usunąć "${equipment.name}"? Ta operacja jest nieodwracalna.`)
    ) {
      return;
    }

    try {
      await deleteEquipmentMutation(equipmentId).unwrap();
      showSnackbar('Sprzęt został usunięty', 'success');
      router.push('/crm/equipment/rental');
    } catch (err: any) {
      showSnackbar(err?.message || 'Błąd podczas usuwania', 'error');
    }
  };

  if (employeeLoading || eqLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  if (eqError || !equipment) {
    return (
      <div className="py-12 text-center">
        <Package className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
        <p className="text-[#e5e4e2]/60">Nie znaleziono sprzętu wynajmu</p>
        <button onClick={() => router.back()} className="mt-4 text-[#d3bb73] hover:underline">
          Powrót
        </button>
      </div>
    );
  }

  const displayData = isEditing ? editForm : equipment;

  return (
    <div className="min-h-screen bg-[#0a0d1a] p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="rounded-lg p-2 transition-colors hover:bg-[#d3bb73]/10"
            >
              <ArrowLeft className="h-5 w-5 text-[#e5e4e2]" />
            </button>
            <Package className="h-6 w-6 text-[#d3bb73]" />
            <div>
              <div className="text-sm text-[#e5e4e2]/60">Sprzęt wynajmu od podwykonawcy</div>
              <h1 className="text-xl font-semibold text-[#e5e4e2]">{displayData.name}</h1>
            </div>
          </div>
          {canEdit && (
            <div className="flex gap-2">
              {isEditing ? (
                <>
                  <button
                    onClick={handleCancelEdit}
                    className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] hover:bg-[#d3bb73]/10"
                  >
                    <X className="h-4 w-4" />
                    Anuluj
                  </button>
                  <button
                    onClick={handleSave}
                    className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#0f1119] hover:bg-[#c4a859]"
                  >
                    <Save className="h-4 w-4" />
                    Zapisz
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={handleDelete}
                    className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-900/20 px-4 py-2 text-red-400 hover:bg-red-900/30"
                  >
                    <Trash2 className="h-4 w-4" />
                    Usuń
                  </button>
                  <button
                    onClick={handleEdit}
                    className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#0f1119] hover:bg-[#c4a859]"
                  >
                    <Edit className="h-4 w-4" />
                    Edytuj
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 space-y-6">
          {/* Podwykonawca */}
          <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-6">
            <h2 className="mb-4 text-lg font-semibold text-[#e5e4e2]">Podwykonawca</h2>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[#e5e4e2]/60">Firma:</span>
                <span className="text-[#e5e4e2]">
                  {equipment.subcontractor?.company_name || '-'}
                </span>
              </div>
              {equipment.subcontractor?.organization && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-[#e5e4e2]/60">Organizacja:</span>
                    <span className="text-[#e5e4e2]">
                      {equipment.subcontractor.organization.name}
                    </span>
                  </div>
                  {equipment.subcontractor.organization.email && (
                    <div className="flex items-center justify-between">
                      <span className="text-[#e5e4e2]/60">Email:</span>
                      <span className="text-[#e5e4e2]">
                        {equipment.subcontractor.organization.email}
                      </span>
                    </div>
                  )}
                  {equipment.subcontractor.organization.phone && (
                    <div className="flex items-center justify-between">
                      <span className="text-[#e5e4e2]/60">Telefon:</span>
                      <span className="text-[#e5e4e2]">
                        {equipment.subcontractor.organization.phone}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Podstawowe informacje */}
          <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-6">
            <h2 className="mb-4 text-lg font-semibold text-[#e5e4e2]">Podstawowe informacje</h2>
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nazwa</label>
                {isEditing ? (
                  <input
                    type="text"
                    value={editForm.name || ''}
                    onChange={(e) => handleChange('name', e.target.value)}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
                  />
                ) : (
                  <div className="text-[#e5e4e2]">{displayData.name}</div>
                )}
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Opis</label>
                {isEditing ? (
                  <textarea
                    value={editForm.description || ''}
                    onChange={(e) => handleChange('description', e.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
                  />
                ) : (
                  <div className="text-[#e5e4e2]">{displayData.description || '-'}</div>
                )}
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Kategoria</label>
                {isEditing ? (
                  <select
                    value={editForm.warehouse_category_id || ''}
                    onChange={(e) => handleChange('warehouse_category_id', e.target.value)}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
                  >
                    <option value="">Brak</option>
                    {warehouseCategories
                      ?.filter((c: any) => c.level === 1)
                      .map((cat: any) => (
                        <optgroup key={cat.id} label={cat.name}>
                          <option value={cat.id}>{cat.name}</option>
                          {warehouseCategories
                            ?.filter((sub: any) => sub.parent_id === cat.id)
                            .map((sub: any) => (
                              <option key={sub.id} value={sub.id}>
                                &nbsp;&nbsp;└─ {sub.name}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                  </select>
                ) : displayData.warehouse_categories ? (
                  <div className="inline-block rounded bg-blue-500/20 px-3 py-1 text-blue-400">
                    {(() => {
                      const cat = displayData.warehouse_categories;
                      if (cat.level === 2 && cat.parent_id) {
                        const parent = warehouseCategories?.find(
                          (c: any) => c.id === cat.parent_id,
                        );
                        return parent ? `${parent.name} / ${cat.name}` : cat.name;
                      }
                      return cat.name;
                    })()}
                  </div>
                ) : (
                  <div className="text-[#e5e4e2]">{displayData.category || '-'}</div>
                )}
              </div>
            </div>
          </div>

          {/* Ceny */}
          <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-6">
            <h2 className="mb-4 text-lg font-semibold text-[#e5e4e2]">Cennik wynajmu</h2>

            {/* Stawka VAT */}
            <div className="mb-6">
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Stawka VAT</label>
              {isEditing ? (
                <select
                  value={editForm.vat_rate || 23}
                  onChange={(e) => handleChange('vat_rate', parseFloat(e.target.value))}
                  className="w-full max-w-xs rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
                >
                  <option value={0}>0% (zwolniony z VAT)</option>
                  <option value={5}>5%</option>
                  <option value={8}>8%</option>
                  <option value={23}>23%</option>
                </select>
              ) : (
                <div className="text-[#e5e4e2]">
                  {displayData.vat_rate === 0 ? (
                    <span>0% (zwolniony z VAT)</span>
                  ) : (
                    <span>{displayData.vat_rate || 23}%</span>
                  )}
                </div>
              )}
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              {/* Cena dzienna */}
              <div className="space-y-3">
                <div className="text-sm font-medium text-[#d3bb73]">Cena dzienna</div>
                <div>
                  <label className="mb-1 block text-xs text-[#e5e4e2]/60">Netto</label>
                  {isEditing ? (
                    <input
                      type="number"
                      step="0.01"
                      value={editForm.daily_price_net || ''}
                      onChange={(e) =>
                        handleChange('daily_price_net', parseFloat(e.target.value) || null)
                      }
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
                      placeholder="0.00"
                    />
                  ) : (
                    <div className="text-[#e5e4e2]">
                      {displayData.daily_price_net
                        ? `${displayData.daily_price_net.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`
                        : '-'}
                    </div>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[#e5e4e2]/60">Brutto</label>
                  {isEditing ? (
                    <input
                      type="number"
                      step="0.01"
                      value={editForm.daily_price_gross || ''}
                      onChange={(e) =>
                        handleChange('daily_price_gross', parseFloat(e.target.value) || null)
                      }
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 font-semibold text-[#e5e4e2]"
                      placeholder="0.00"
                    />
                  ) : (
                    <div className="font-semibold text-[#e5e4e2]">
                      {displayData.daily_price_gross
                        ? `${displayData.daily_price_gross.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`
                        : '-'}
                    </div>
                  )}
                </div>
              </div>

              {/* Cena tygodniowa */}
              <div className="space-y-3">
                <div className="text-sm font-medium text-[#d3bb73]">Cena tygodniowa</div>
                <div>
                  <label className="mb-1 block text-xs text-[#e5e4e2]/60">Netto</label>
                  {isEditing ? (
                    <input
                      type="number"
                      step="0.01"
                      value={editForm.weekly_price_net || ''}
                      onChange={(e) =>
                        handleChange('weekly_price_net', parseFloat(e.target.value) || null)
                      }
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
                      placeholder="0.00"
                    />
                  ) : (
                    <div className="text-[#e5e4e2]">
                      {displayData.weekly_price_net
                        ? `${displayData.weekly_price_net.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`
                        : '-'}
                    </div>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[#e5e4e2]/60">Brutto</label>
                  {isEditing ? (
                    <input
                      type="number"
                      step="0.01"
                      value={editForm.weekly_price_gross || ''}
                      onChange={(e) =>
                        handleChange('weekly_price_gross', parseFloat(e.target.value) || null)
                      }
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 font-semibold text-[#e5e4e2]"
                      placeholder="0.00"
                    />
                  ) : (
                    <div className="font-semibold text-[#e5e4e2]">
                      {displayData.weekly_price_gross
                        ? `${displayData.weekly_price_gross.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`
                        : '-'}
                    </div>
                  )}
                </div>
              </div>

              {/* Cena miesięczna */}
              <div className="space-y-3">
                <div className="text-sm font-medium text-[#d3bb73]">Cena miesięczna</div>
                <div>
                  <label className="mb-1 block text-xs text-[#e5e4e2]/60">Netto</label>
                  {isEditing ? (
                    <input
                      type="number"
                      step="0.01"
                      value={editForm.monthly_price_net || ''}
                      onChange={(e) =>
                        handleChange('monthly_price_net', parseFloat(e.target.value) || null)
                      }
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
                      placeholder="0.00"
                    />
                  ) : (
                    <div className="text-[#e5e4e2]">
                      {displayData.monthly_price_net
                        ? `${displayData.monthly_price_net.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`
                        : '-'}
                    </div>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[#e5e4e2]/60">Brutto</label>
                  {isEditing ? (
                    <input
                      type="number"
                      step="0.01"
                      value={editForm.monthly_price_gross || ''}
                      onChange={(e) =>
                        handleChange('monthly_price_gross', parseFloat(e.target.value) || null)
                      }
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 font-semibold text-[#e5e4e2]"
                      placeholder="0.00"
                    />
                  ) : (
                    <div className="font-semibold text-[#e5e4e2]">
                      {displayData.monthly_price_gross
                        ? `${displayData.monthly_price_gross.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`
                        : '-'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Dostępność */}
          <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-6">
            <h2 className="mb-4 text-lg font-semibold text-[#e5e4e2]">Dostępność</h2>
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Ilość dostępna</label>
                {isEditing ? (
                  <input
                    type="number"
                    value={editForm.quantity_available || ''}
                    onChange={(e) => handleChange('quantity_available', parseInt(e.target.value))}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
                  />
                ) : (
                  <div className="text-[#e5e4e2]">{displayData.quantity_available || 0}</div>
                )}
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Status</label>
                {isEditing ? (
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={editForm.is_active || false}
                      onChange={(e) => handleChange('is_active', e.target.checked)}
                      className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73]"
                    />
                    <span className="text-sm text-[#e5e4e2]">Aktywny</span>
                  </label>
                ) : (
                  <div className="text-[#e5e4e2]">
                    {displayData.is_active ? (
                      <span className="text-green-400">Aktywny</span>
                    ) : (
                      <span className="text-red-400">Nieaktywny</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Wymagane umiejętności */}
          {displayData.required_skills && displayData.required_skills.length > 0 && (
            <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-6">
              <h2 className="mb-4 text-lg font-semibold text-[#e5e4e2]">Wymagane umiejętności</h2>
              <div className="flex flex-wrap gap-2">
                {displayData.required_skills.map((skill: string, idx: number) => (
                  <span
                    key={idx}
                    className="rounded-full bg-[#d3bb73]/10 px-3 py-1 text-sm text-[#d3bb73]"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Galeria zdjęć */}
          <RentalEquipmentGallery
            equipmentId={equipmentId}
            images={displayData.images || []}
            canManage={canEdit && isEditing}
            onImagesChange={handleImagesChange}
          />

          {/* Notatki */}
          {(displayData.notes || isEditing) && (
            <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-6">
              <h2 className="mb-4 text-lg font-semibold text-[#e5e4e2]">Notatki</h2>
              {isEditing ? (
                <textarea
                  value={editForm.notes || ''}
                  onChange={(e) => handleChange('notes', e.target.value)}
                  rows={4}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
                />
              ) : (
                <div className="whitespace-pre-wrap text-[#e5e4e2]">{displayData.notes || '-'}</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
