'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Package, CreditCard as Edit, Save, X } from 'lucide-react';

import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';

import {
  useGetRentalEquipmentDetailsQuery,
  useUpdateRentalEquipmentMutation,
} from '../../api/rentalApi';

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

  const [updateEquipmentMutation] = useUpdateRentalEquipmentMutation();

  const canEdit = employee?.permissions?.includes('equipment_manage') || employee?.is_admin;

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
          daily_rental_price: editForm.daily_rental_price,
          weekly_rental_price: editForm.weekly_rental_price,
          monthly_rental_price: editForm.monthly_rental_price,
          quantity_available: editForm.quantity_available,
          required_skills: editForm.required_skills,
          specifications: editForm.specifications,
          notes: editForm.notes,
          is_active: editForm.is_active,
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

  const handleChange = (field: string, value: any) => {
    setEditForm((prev: any) => ({ ...prev, [field]: value }));
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
        <button
          onClick={() => router.back()}
          className="mt-4 text-[#d3bb73] hover:underline"
        >
          Powrót
        </button>
      </div>
    );
  }

  const displayData = isEditing ? editForm : equipment;

  return (
    <div className="min-h-screen bg-[#0a0d1a] p-6">
      <div className="mx-auto max-w-7xl">
        <ResponsiveActionBar
          title={
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
          }
          actions={[
            {
              label: isEditing ? 'Anuluj' : 'Edytuj',
              onClick: isEditing ? handleCancelEdit : handleEdit,
              icon: isEditing ? <X className="h-4 w-4" /> : <Edit className="h-4 w-4" />,
              variant: isEditing ? 'secondary' : 'primary',
              show: canEdit,
            },
            {
              label: 'Zapisz',
              onClick: handleSave,
              icon: <Save className="h-4 w-4" />,
              variant: 'primary',
              show: isEditing,
            },
          ]}
        />

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
                  <input
                    type="text"
                    value={editForm.category || ''}
                    onChange={(e) => handleChange('category', e.target.value)}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
                  />
                ) : (
                  <div className="text-[#e5e4e2]">{displayData.category || '-'}</div>
                )}
              </div>
            </div>
          </div>

          {/* Ceny */}
          <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-6">
            <h2 className="mb-4 text-lg font-semibold text-[#e5e4e2]">Cennik wynajmu</h2>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Cena dzienna</label>
                {isEditing ? (
                  <input
                    type="number"
                    value={editForm.daily_rental_price || ''}
                    onChange={(e) => handleChange('daily_rental_price', parseFloat(e.target.value))}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
                  />
                ) : (
                  <div className="text-[#e5e4e2]">
                    {displayData.daily_rental_price
                      ? `${displayData.daily_rental_price.toLocaleString('pl-PL')} zł`
                      : '-'}
                  </div>
                )}
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Cena tygodniowa</label>
                {isEditing ? (
                  <input
                    type="number"
                    value={editForm.weekly_rental_price || ''}
                    onChange={(e) => handleChange('weekly_rental_price', parseFloat(e.target.value))}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
                  />
                ) : (
                  <div className="text-[#e5e4e2]">
                    {displayData.weekly_rental_price
                      ? `${displayData.weekly_rental_price.toLocaleString('pl-PL')} zł`
                      : '-'}
                  </div>
                )}
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Cena miesięczna</label>
                {isEditing ? (
                  <input
                    type="number"
                    value={editForm.monthly_rental_price || ''}
                    onChange={(e) => handleChange('monthly_rental_price', parseFloat(e.target.value))}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
                  />
                ) : (
                  <div className="text-[#e5e4e2]">
                    {displayData.monthly_rental_price
                      ? `${displayData.monthly_rental_price.toLocaleString('pl-PL')} zł`
                      : '-'}
                  </div>
                )}
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
                <div className="text-[#e5e4e2] whitespace-pre-wrap">
                  {displayData.notes || '-'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
