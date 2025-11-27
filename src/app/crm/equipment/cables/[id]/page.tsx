'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Edit, Save, X, Trash2, Plug, Plus } from 'lucide-react';

import { uploadImage } from '@/lib/storage';
import { useDialog } from '@/contexts/DialogContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import Popover from '@/components/UI/Tooltip';

import {
  useGetCableDetailsQuery,
  useGetCableUnitsQuery,
  useGetConnectorTypesQuery,
  useGetStorageLocationsQuery,
  useUpdateCableMutation,
  useAddCableUnitMutation,
  useDeleteCableUnitMutation,
} from '../../store/equipmentApi';

const normalizeUuid = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() && v !== 'undefined' ? v : null;

const toFloat = (v: any): number | null => (v === '' || v == null ? null : parseFloat(v));
const toInt = (v: any): number | null => (v === '' || v == null ? null : parseInt(v, 10));

const removeUndefined = <T extends Record<string, any>>(obj: T): T =>
  Object.fromEntries(Object.entries(obj).filter(([, val]) => val !== undefined)) as T;

export default function CableDetailPage() {
  const router = useRouter();
  const params = useParams();
  const cableId = Array.isArray(params.id) ? params.id[0] : (params.id as string);

  const { showConfirm } = useDialog();
  const { showSnackbar } = useSnackbar();
  const { canManageModule } = useCurrentEmployee();
  const canEdit = canManageModule('equipment');

  // dictionaries
  const { data: connectorTypes = [] } = useGetConnectorTypesQuery();
  const { data: storageLocations = [] } = useGetStorageLocationsQuery();

  // data
  const {
    data: cable,
    isFetching: cableLoading,
    isError: cableError,
    refetch: refetchCable,
  } = useGetCableDetailsQuery(cableId, { skip: !cableId });

  const {
    data: units = [],
    isFetching: unitsLoading,
    refetch: refetchUnits,
  } = useGetCableUnitsQuery(cableId, { skip: !cableId });

  const [updateCable] = useUpdateCableMutation();
  const [addCableUnit] = useAddCableUnitMutation();
  const [deleteCableUnit] = useDeleteCableUnitMutation();

  const loading = cableLoading || unitsLoading;

  const availableUnits = units.filter((u) => u.status === 'available').length;
  const totalUnits = units.length;

  // ui state
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'details' | 'units'>('details');
  const [showAddUnit, setShowAddUnit] = useState(false);
  const [newUnitSerial, setNewUnitSerial] = useState('');

  // edit form
  const [editForm, setEditForm] = useState<any>({});

  const handleEdit = () => {
    if (!cable) return;
    setEditForm({
      ...cable,
      connector_in: cable?.connector_in ?? '',
      connector_out: cable?.connector_out ?? '',
      storage_location_id: cable?.storage_location_id ?? '',
    });
    setIsEditing(true);
  };

  const handleCancelEdit = () => setIsEditing(false);

  const handleSave = async () => {
    if (!cable) return;
    setSaving(true);
    try {
      const payload = removeUndefined({
        name: editForm.name,
        length_meters: toFloat(editForm.length_meters),
        connector_in: normalizeUuid(editForm.connector_in),
        connector_out: normalizeUuid(editForm.connector_out),
        storage_location_id: normalizeUuid(editForm.storage_location_id),
        stock_quantity: toInt(editForm.stock_quantity),
        description: editForm.description || null,
        thumbnail_url: editForm.thumbnail_url || null,
        purchase_date: editForm.purchase_date || null,
        purchase_price: toFloat(editForm.purchase_price),
        current_value: toFloat(editForm.current_value),
        notes: editForm.notes || null,
      });

      await updateCable({ id: cableId, payload }).unwrap();
      setIsEditing(false);
      refetchCable();
      showSnackbar('Zapisano zmiany', 'success');
    } catch (e: any) {
      console.error(e);
      showSnackbar('Błąd podczas zapisywania', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setEditForm((prev: any) => ({ ...prev, [name]: value }));
  };

  const handleThumbnailUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    showSnackbar('Przesyłanie zdjęcia...', 'info');
    try {
      const url = await uploadImage(file, 'equipment-thumbnails');
      setEditForm((prev: any) => ({ ...prev, thumbnail_url: url }));
      showSnackbar('Zdjęcie zostało przesłane', 'success');
    } catch (err: any) {
      showSnackbar(err?.message || 'Błąd podczas przesyłania zdjęcia', 'error');
    }
  };

  const handleAddUnit = async () => {
    if (!newUnitSerial.trim()) {
      showSnackbar('Podaj numer seryjny', 'error');
      return;
    }

    try {
      await addCableUnit({ cable_id: cableId, serial_number: newUnitSerial }).unwrap();
      setNewUnitSerial('');
      setShowAddUnit(false);
      refetchUnits();
      showSnackbar('Dodano jednostkę', 'success');
    } catch (e) {
      showSnackbar('Błąd podczas dodawania jednostki', 'error');
    }
  };

  const handleDeleteUnit = async (unitId: string) => {
    const confirmed = await showConfirm('Czy na pewno chcesz usunąć tę jednostkę?', 'Usuń');
    if (!confirmed) return;

    try {
      await deleteCableUnit({ id: unitId, cable_id: cableId }).unwrap();
      refetchUnits();
      showSnackbar('Usunięto jednostkę', 'success');
    } catch (e) {
      showSnackbar('Błąd podczas usuwania jednostki', 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[#e5e4e2]/60">Ładowanie…</div>
      </div>
    );
  }

  if (cableError || !cable) {
    return (
      <div className="text-center py-12">
        <Plug className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
        <p className="text-[#e5e4e2]/60">Nie znaleziono kabla</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()} className="p-2 hover:bg-[#1c1f33] rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-[#e5e4e2]" />
          </button>
          <div>
            <h2 className="text-2xl font-light text-[#e5e4e2] flex items-center gap-3">
              {cable.name}
              <span className="text-lg font-normal text-[#d3bb73]">
                {cable.stock_quantity || 0} szt.
              </span>
            </h2>
            {cable.length_meters && (
              <p className="text-sm text-[#e5e4e2]/60 mt-1">
                Długość: {cable.length_meters}m
              </p>
            )}
          </div>
        </div>

        {isEditing ? (
          <ResponsiveActionBar
            actions={[
              { label: 'Anuluj', onClick: handleCancelEdit, icon: <X className="w-4 h-4" />, variant: 'default' },
              { label: saving ? 'Zapisywanie…' : 'Zapisz', onClick: handleSave, icon: <Save className="w-4 h-4" />, variant: 'primary' },
            ]}
          />
        ) : canEdit ? (
          <ResponsiveActionBar
            actions={[{ label: 'Edytuj', onClick: handleEdit, icon: <Edit className="w-4 h-4" />, variant: 'primary' }]}
          />
        ) : null}
      </div>

      {/* TABS */}
      <div className="flex gap-2 border-b border-[#d3bb73]/10">
        <button
          onClick={() => setActiveTab('details')}
          className={`px-4 py-2 text-sm relative ${activeTab === 'details' ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/60'}`}
        >
          Szczegóły
          {activeTab === 'details' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#d3bb73]" />}
        </button>
        <button
          onClick={() => setActiveTab('units')}
          className={`px-4 py-2 text-sm relative ${activeTab === 'units' ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/60'}`}
        >
          Jednostki ({totalUnits})
          {activeTab === 'units' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#d3bb73]" />}
        </button>
      </div>

      {/* DETAILS TAB */}
      {activeTab === 'details' && (
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 space-y-6">
          {/* Thumbnail with Popover */}
          <div>
            <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Zdjęcie</label>
            {cable.thumbnail_url ? (
              <Popover
                trigger={
                  <img
                    src={cable.thumbnail_url}
                    alt={cable.name}
                    className="w-32 h-32 rounded-lg object-cover cursor-pointer hover:ring-2 hover:ring-[#d3bb73] transition-all"
                  />
                }
                content={
                  <img
                    src={cable.thumbnail_url}
                    alt={cable.name}
                    className="w-96 h-96 rounded-lg object-cover"
                  />
                }
                openOn="hover"
              />
            ) : (
              <div className="w-32 h-32 bg-[#0f1119] rounded-lg flex items-center justify-center">
                <Plug className="w-12 h-12 text-[#e5e4e2]/40" />
              </div>
            )}
            {isEditing && (
              <input
                type="file"
                accept="image/*"
                onChange={handleThumbnailUpload}
                className="mt-2 text-sm text-[#e5e4e2]/60"
              />
            )}
          </div>

          {/* Basic Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Nazwa</label>
              {isEditing ? (
                <input
                  type="text"
                  name="name"
                  value={editForm.name || ''}
                  onChange={handleInputChange}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              ) : (
                <p className="text-[#e5e4e2]">{cable.name}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Długość (m)</label>
              {isEditing ? (
                <input
                  type="number"
                  name="length_meters"
                  step="0.1"
                  value={editForm.length_meters || ''}
                  onChange={handleInputChange}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              ) : (
                <p className="text-[#e5e4e2]">{cable.length_meters ? `${cable.length_meters}m` : '-'}</p>
              )}
            </div>
          </div>

          {/* Connectors */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Złącze IN</label>
              {isEditing ? (
                <select
                  name="connector_in"
                  value={editForm.connector_in || ''}
                  onChange={handleInputChange}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                >
                  <option value="">Wybierz złącze</option>
                  {connectorTypes.map((ct: any) => (
                    <option key={ct.id} value={ct.id}>
                      {ct.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="flex items-center gap-2">
                  {cable.connector_in_type?.thumbnail_url && (
                    <img
                      src={cable.connector_in_type.thumbnail_url}
                      alt={cable.connector_in_type.name}
                      className="w-8 h-8 rounded object-cover"
                    />
                  )}
                  <p className="text-[#e5e4e2]">{cable.connector_in_type?.name || '-'}</p>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Złącze OUT</label>
              {isEditing ? (
                <select
                  name="connector_out"
                  value={editForm.connector_out || ''}
                  onChange={handleInputChange}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                >
                  <option value="">Wybierz złącze</option>
                  {connectorTypes.map((ct: any) => (
                    <option key={ct.id} value={ct.id}>
                      {ct.name}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="flex items-center gap-2">
                  {cable.connector_out_type?.thumbnail_url && (
                    <img
                      src={cable.connector_out_type.thumbnail_url}
                      alt={cable.connector_out_type.name}
                      className="w-8 h-8 rounded object-cover"
                    />
                  )}
                  <p className="text-[#e5e4e2]">{cable.connector_out_type?.name || '-'}</p>
                </div>
              )}
            </div>
          </div>

          {/* Stock Info */}
          <div>
            <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Ilość w magazynie</label>
            {isEditing ? (
              <input
                type="number"
                name="stock_quantity"
                value={editForm.stock_quantity || 0}
                onChange={handleInputChange}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            ) : (
              <p className="text-[#e5e4e2]">{cable.stock_quantity || 0} szt.</p>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Opis</label>
            {isEditing ? (
              <textarea
                name="description"
                value={editForm.description || ''}
                onChange={handleInputChange}
                rows={3}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            ) : (
              <p className="text-[#e5e4e2]">{cable.description || '-'}</p>
            )}
          </div>
        </div>
      )}

      {/* UNITS TAB */}
      {activeTab === 'units' && (
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-medium text-[#e5e4e2]">Jednostki kabla</h3>
            {canEdit && (
              <button
                className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90"
                onClick={() => setShowAddUnit(!showAddUnit)}
              >
                <Plus className="w-4 h-4" />
                Dodaj jednostkę
              </button>
            )}
          </div>

          {showAddUnit && (
            <div className="mb-4 p-4 bg-[#0f1119] rounded-lg border border-[#d3bb73]/20">
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Numer seryjny</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newUnitSerial}
                  onChange={(e) => setNewUnitSerial(e.target.value)}
                  placeholder="np. CABLE-001"
                  className="flex-1 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
                <button
                  onClick={handleAddUnit}
                  className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90"
                >
                  Dodaj
                </button>
                <button
                  onClick={() => { setShowAddUnit(false); setNewUnitSerial(''); }}
                  className="px-4 py-2 bg-[#1c1f33] text-[#e5e4e2] rounded-lg hover:bg-[#1c1f33]/80"
                >
                  Anuluj
                </button>
              </div>
            </div>
          )}

          {units.length === 0 ? (
            <p className="text-center text-[#e5e4e2]/60 py-8">Brak jednostek</p>
          ) : (
            <div className="space-y-2">
              {units.map((unit: any) => (
                <div
                  key={unit.id}
                  className="flex items-center justify-between p-4 bg-[#0f1119] rounded-lg border border-[#d3bb73]/10"
                >
                  <div>
                    <p className="text-[#e5e4e2] font-medium">{unit.serial_number || 'Bez numeru'}</p>
                    <p className="text-sm text-[#e5e4e2]/60">
                      Status: <span className={unit.status === 'available' ? 'text-green-400' : 'text-orange-400'}>{unit.status}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    {unit.storage_locations?.name && (
                      <p className="text-sm text-[#e5e4e2]/60">{unit.storage_locations.name}</p>
                    )}
                    {canEdit && (
                      <button
                        onClick={() => handleDeleteUnit(unit.id)}
                        className="p-2 hover:bg-[#1c1f33] rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
