'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Edit, Save, X, Plug } from 'lucide-react';

import { uploadImage } from '@/lib/storage';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import Popover from '@/components/UI/Tooltip';
import { ConnectorSelectWithPreview } from '@/components/crm/equipment/connectors/ConnectorSelectWithPreview';

import {
  useGetCableDetailsQuery,
  useGetCableCategoriesQuery,
  useGetCableStockMovementsQuery,
  useGetConnectorTypesQuery,
  useGetStorageLocationsQuery,
  useUpdateCableMutation,
} from '../../store/equipmentApi';

import Image from 'next/image';

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

  const { showSnackbar } = useSnackbar();
  const { canManageModule } = useCurrentEmployee();
  const canEdit = canManageModule('equipment');

  // dictionaries
  const { data: connectorTypes = [] } = useGetConnectorTypesQuery();
  const { data: storageLocations = [] } = useGetStorageLocationsQuery();
  const {
    data: cableCategories = [],
    isError: cableCategoriesError,
  } = useGetCableCategoriesQuery();

  // data
  const {
    data: cable,
    isFetching: loading,
    isError: cableError,
    refetch: refetchCable,
  } = useGetCableDetailsQuery(cableId, { skip: !cableId });
  const { data: stockMovements = [] } = useGetCableStockMovementsQuery(cableId, {
    skip: !cableId,
  });

  const [updateCable] = useUpdateCableMutation();

  // ui state
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // edit form
  const [editForm, setEditForm] = useState<any>({});
  const detailedCableCategories = cableCategories.filter((category: any) => category.parent_id);
  const selectableCableCategories =
    detailedCableCategories.length > 0 ? detailedCableCategories : cableCategories;

  const handleEdit = () => {
    if (!cable) return;
    setEditForm({
      ...cable,
      connector_in: cable?.connector_in ?? '',
      connector_out: cable?.connector_out ?? '',
      storage_location_id: cable?.storage_location_id ?? '',
      cable_category_id: cable?.cable_category_id ?? '',
      stock_unit: cable?.stock_unit ?? 'piece',
      tracking_mode: cable?.tracking_mode ?? 'quantity',
      minimum_stock_quantity: cable?.minimum_stock_quantity ?? 0,
      is_directional: Boolean(cable?.is_directional),
    });
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

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
        cable_category_id: normalizeUuid(editForm.cable_category_id),
        stock_quantity: toInt(editForm.stock_quantity),
        stock_unit: editForm.stock_unit || 'piece',
        tracking_mode: editForm.tracking_mode || 'quantity',
        minimum_stock_quantity: Math.max(0, toInt(editForm.minimum_stock_quantity) ?? 0),
        is_directional: Boolean(editForm.is_directional),
        description: editForm.description || null,
        thumbnail_url: editForm.thumbnail_url || null,
        purchase_date: editForm.purchase_date || null,
        purchase_price: toFloat(editForm.purchase_price),
        current_value: toFloat(editForm.current_value),
        notes: editForm.notes || null,
      });

      await updateCable({ id: cableId, payload }).unwrap();

      setIsEditing(false);
      showSnackbar('Zapisano zmiany', 'success');
    } catch (e: any) {
      showSnackbar('Błąd podczas zapisywania', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
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

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
      </div>
    );
  }

  if (cableError || !cable) {
    return (
      <div className="py-12 text-center">
        <Plug className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
        <p className="text-[#e5e4e2]/60">Nie znaleziono kabla</p>
      </div>
    );
  }

  const stockUnitLabel = (cable.stock_unit ?? 'piece') === 'meter' ? 'm' : 'szt.';
  const editedStockUnitLabel = (editForm.stock_unit ?? cable.stock_unit ?? 'piece') === 'meter'
    ? 'm'
    : 'szt.';
  const isLowStock = Number(cable.stock_quantity ?? 0) <= Number(cable.minimum_stock_quantity ?? 0);

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="rounded-lg p-2 transition-colors hover:bg-[#1c1f33]"
          >
            <ArrowLeft className="h-5 w-5 text-[#e5e4e2]" />
          </button>
          <div>
            <h2 className="flex items-center gap-3 text-2xl font-light text-[#e5e4e2]">
              {cable.name}
              <span className="text-lg font-normal text-[#d3bb73]">
                {cable.stock_quantity || 0} {stockUnitLabel}
              </span>
            </h2>
            {cable.length_meters && (
              <p className="mt-1 text-sm text-[#e5e4e2]/60">Długość: {cable.length_meters}m</p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {cable.cable_category && (
                <span
                  className="rounded-full border px-2 py-0.5 text-xs"
                  style={{
                    borderColor: `${cable.cable_category.color}66`,
                    color: cable.cable_category.color,
                  }}
                >
                  {cable.cable_category.name}
                </span>
              )}
              {isLowStock && (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">
                  Niski stan magazynowy
                </span>
              )}
              {cable.is_directional && (
                <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-xs text-blue-300">
                  Kierunkowy
                </span>
              )}
            </div>
          </div>
        </div>

        {isEditing ? (
          <ResponsiveActionBar
            actions={[
              {
                label: 'Anuluj',
                onClick: handleCancelEdit,
                icon: <X className="h-4 w-4" />,
                variant: 'default',
              },
              {
                label: saving ? 'Zapisywanie…' : 'Zapisz',
                onClick: handleSave,
                icon: <Save className="h-4 w-4" />,
                variant: 'primary',
              },
            ]}
          />
        ) : canEdit ? (
          <ResponsiveActionBar
            actions={[
              {
                label: 'Edytuj',
                onClick: handleEdit,
                icon: <Edit className="h-4 w-4" />,
                variant: 'primary',
              },
            ]}
          />
        ) : null}
      </div>

      {/* DETAILS */}
      <div className="space-y-6 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        {/* Thumbnail with Popover */}
        <div>
          <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Zdjęcie</label>
          {cable.thumbnail_url ? (
            <Popover
              trigger={
                <Image
                  width={128}
                  height={128}
                  src={cable.thumbnail_url}
                  alt={cable.name}
                  className="h-32 w-32 cursor-pointer rounded-lg object-cover transition-all hover:ring-2 hover:ring-[#d3bb73]"
                />
              }
              content={
                <Image
                  width={128}
                  height={128}
                  src={cable.thumbnail_url}
                  alt={cable.name}
                  className="h-96 w-96 rounded-lg object-cover"
                />
              }
              openOn="hover"
            />
          ) : (
            <div className="flex h-32 w-32 items-center justify-center rounded-lg bg-[#0f1119]">
              <Plug className="h-12 w-12 text-[#e5e4e2]/40" />
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

        {/* Technical classification */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
              Przeznaczenie techniczne
            </label>
            {isEditing ? (
              <select
                name="cable_category_id"
                value={editForm.cable_category_id || ''}
                onChange={handleInputChange}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              >
                <option value="">Wybierz kategorię</option>
                {selectableCableCategories.map((category: any) => {
                    const parent = cableCategories.find((item: any) => item.id === category.parent_id);
                    return (
                      <option key={category.id} value={category.id}>
                        {parent ? `${parent.name} / ` : ''}{category.name}
                      </option>
                    );
                  })}
              </select>
            ) : (
              <p className="text-[#e5e4e2]">{cable.cable_category?.name || 'Nie przypisano'}</p>
            )}
            {(cableCategoriesError || cableCategories.length === 0) && (
              <p className="mt-2 text-xs text-amber-300">
                Brak słownika przeznaczeń technicznych. Uruchom migrację kategorii przewodów.
              </p>
            )}
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Sposób ewidencji</label>
            {isEditing ? (
              <select
                name="tracking_mode"
                value={editForm.tracking_mode || 'quantity'}
                onChange={handleInputChange}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              >
                <option value="quantity">Ilościowo</option>
                <option value="individual">Pojedyncze sztuki / bębny</option>
              </select>
            ) : (
              <p className="text-[#e5e4e2]">
                {cable.tracking_mode === 'individual' ? 'Pojedyncze sztuki / bębny' : 'Ilościowo'}
              </p>
            )}
          </div>
        </div>

        {/* Basic Info */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Nazwa</label>
            {isEditing ? (
              <input
                type="text"
                name="name"
                value={editForm.name || ''}
                onChange={handleInputChange}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              />
            ) : (
              <p className="text-[#e5e4e2]">{cable.name}</p>
            )}
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Długość (m)</label>
            {isEditing ? (
              <input
                type="number"
                name="length_meters"
                step="0.1"
                value={editForm.length_meters || ''}
                onChange={handleInputChange}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              />
            ) : (
              <p className="text-[#e5e4e2]">
                {cable.length_meters ? `${cable.length_meters}m` : '-'}
              </p>
            )}
          </div>
        </div>

        {/* Connectors */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            {isEditing ? (
              <ConnectorSelectWithPreview
                label="Złącze IN"
                value={editForm.connector_in || ''}
                onChange={(value) =>
                  setEditForm((previous: any) => ({ ...previous, connector_in: value }))
                }
                connectorTypes={connectorTypes}
                placeholder="Wybierz złącze wejściowe"
              />
            ) : (
              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Złącze IN</label>
                <div className="flex items-center gap-2">
                  {cable.connector_in_type?.thumbnail_url ? (
                    <Popover
                      trigger={
                        <Image
                          width={32}
                          height={32}
                          src={cable.connector_in_type.thumbnail_url}
                          alt={cable.connector_in_type.name}
                          className="h-8 w-8 cursor-pointer rounded object-cover transition-all hover:ring-2 hover:ring-[#d3bb73]"
                        />
                      }
                      content={
                        <Image
                          width={256}
                          height={256}
                          src={cable.connector_in_type.thumbnail_url}
                          alt={cable.connector_in_type.name}
                          className="h-64 w-64 rounded-lg object-contain"
                        />
                      }
                      openOn="hover"
                    />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded bg-[#0f1119]">
                      <Plug className="h-4 w-4 text-[#e5e4e2]/40" />
                    </div>
                  )}
                  <p className="text-[#e5e4e2]">{cable.connector_in_type?.name || '-'}</p>
                </div>
              </div>
            )}
          </div>

          <div>
            {isEditing ? (
              <ConnectorSelectWithPreview
                label="Złącze OUT"
                value={editForm.connector_out || ''}
                onChange={(value) =>
                  setEditForm((previous: any) => ({ ...previous, connector_out: value }))
                }
                connectorTypes={connectorTypes}
                placeholder="Wybierz złącze wyjściowe"
              />
            ) : (
              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Złącze OUT</label>
                <div className="flex items-center gap-2">
                  {cable.connector_out_type?.thumbnail_url ? (
                    <Popover
                      trigger={
                        <Image
                          width={32}
                          height={32}
                          src={cable.connector_out_type.thumbnail_url}
                          alt={cable.connector_out_type.name}
                          className="h-8 w-8 cursor-pointer rounded object-cover transition-all hover:ring-2 hover:ring-[#d3bb73]"
                        />
                      }
                      content={
                        <Image
                          width={256}
                          height={256}
                          src={cable.connector_out_type.thumbnail_url}
                          alt={cable.connector_out_type.name}
                          className="h-64 w-64 rounded-lg object-contain"
                        />
                      }
                      openOn="hover"
                    />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded bg-[#0f1119]">
                      <Plug className="h-4 w-4 text-[#e5e4e2]/40" />
                    </div>
                  )}
                  <p className="text-[#e5e4e2]">{cable.connector_out_type?.name || '-'}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Stock Info */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Ilość w magazynie</label>
            {isEditing ? (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  name="stock_quantity"
                  value={editForm.stock_quantity ?? 0}
                  onChange={handleInputChange}
                  className="min-w-0 flex-1 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                />
                <span className="text-sm text-[#e5e4e2]/60">{editedStockUnitLabel}</span>
              </div>
            ) : (
              <p className="text-[#e5e4e2]">{cable.stock_quantity || 0} {stockUnitLabel}</p>
            )}
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Jednostka</label>
            {isEditing ? (
              <select
                name="stock_unit"
                value={editForm.stock_unit || 'piece'}
                onChange={handleInputChange}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              >
                <option value="piece">Sztuki</option>
                <option value="meter">Metry z rolki</option>
              </select>
            ) : (
              <p className="text-[#e5e4e2]">{cable.stock_unit === 'meter' ? 'Metry' : 'Sztuki'}</p>
            )}
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Minimalny zapas</label>
            {isEditing ? (
              <input
                type="number"
                min="0"
                name="minimum_stock_quantity"
                value={editForm.minimum_stock_quantity ?? 0}
                onChange={handleInputChange}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              />
            ) : (
              <p className="text-[#e5e4e2]">
                {cable.minimum_stock_quantity || 0} {stockUnitLabel}
              </p>
            )}
          </div>
        </div>

        <label className="flex items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-3 text-sm text-[#e5e4e2]">
          <input
            type="checkbox"
            checked={isEditing ? Boolean(editForm.is_directional) : Boolean(cable.is_directional)}
            disabled={!isEditing}
            onChange={(event) =>
              setEditForm((previous: any) => ({ ...previous, is_directional: event.target.checked }))
            }
            className="h-4 w-4 accent-[#d3bb73]"
          />
          Przewód kierunkowy — końcówki IN i OUT nie są zamienne
        </label>

        {/* Description */}
        <div>
          <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Opis</label>
          {isEditing ? (
            <textarea
              name="description"
              value={editForm.description || ''}
              onChange={handleInputChange}
              rows={3}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
            />
          ) : (
            <p className="text-[#e5e4e2]">{cable.description || '-'}</p>
          )}
        </div>

        {/* Storage Location */}
        <div>
          <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
            Lokalizacja magazynowa
          </label>
          {isEditing ? (
            <select
              name="storage_location_id"
              value={editForm.storage_location_id || ''}
              onChange={handleInputChange}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
            >
              <option value="">Wybierz lokalizację</option>
              {storageLocations.map((loc: any) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-[#e5e4e2]">{cable.storage_location?.name || '-'}</p>
          )}
        </div>

        {/* Purchase Info */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Data zakupu</label>
            {isEditing ? (
              <input
                type="date"
                name="purchase_date"
                value={editForm.purchase_date || ''}
                onChange={handleInputChange}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              />
            ) : (
              <p className="text-[#e5e4e2]">{cable.purchase_date || '-'}</p>
            )}
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Cena zakupu</label>
            {isEditing ? (
              <input
                type="number"
                name="purchase_price"
                step="0.01"
                value={editForm.purchase_price || ''}
                onChange={handleInputChange}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              />
            ) : (
              <p className="text-[#e5e4e2]">
                {cable.purchase_price ? `${cable.purchase_price} zł` : '-'}
              </p>
            )}
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Wartość bieżąca</label>
            {isEditing ? (
              <input
                type="number"
                name="current_value"
                step="0.01"
                value={editForm.current_value || ''}
                onChange={handleInputChange}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              />
            ) : (
              <p className="text-[#e5e4e2]">
                {cable.current_value ? `${cable.current_value} zł` : '-'}
              </p>
            )}
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Notatki</label>
          {isEditing ? (
            <textarea
              name="notes"
              value={editForm.notes || ''}
              onChange={handleInputChange}
              rows={3}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
            />
          ) : (
            <p className="text-[#e5e4e2]">{cable.notes || '-'}</p>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        <h3 className="mb-1 text-lg font-medium text-[#e5e4e2]">Historia stanu</h3>
        <p className="mb-4 text-sm text-[#e5e4e2]/50">
          Ostatnie przyjęcia, korekty i rozchody magazynowe tego przewodu.
        </p>
        {stockMovements.length === 0 ? (
          <p className="text-sm text-[#e5e4e2]/50">Brak zarejestrowanych zmian stanu.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead className="border-b border-[#d3bb73]/10 text-xs uppercase text-[#e5e4e2]/45">
                <tr>
                  <th className="px-2 py-2">Data</th>
                  <th className="px-2 py-2">Zmiana</th>
                  <th className="px-2 py-2">Stan po zmianie</th>
                  <th className="px-2 py-2">Powód</th>
                  <th className="px-2 py-2">Osoba</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#d3bb73]/5">
                {stockMovements.map((movement: any) => (
                  <tr key={movement.id}>
                    <td className="px-2 py-2 text-[#e5e4e2]/70">
                      {new Date(movement.created_at).toLocaleString('pl-PL')}
                    </td>
                    <td className={`px-2 py-2 font-medium ${movement.quantity_delta > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {movement.quantity_delta > 0 ? '+' : ''}{movement.quantity_delta} {stockUnitLabel}
                    </td>
                    <td className="px-2 py-2 text-[#e5e4e2]">
                      {movement.balance_after} {stockUnitLabel}
                    </td>
                    <td className="px-2 py-2 text-[#e5e4e2]/70">{movement.reason || '—'}</td>
                    <td className="px-2 py-2 text-[#e5e4e2]/70">
                      {[movement.employee?.name, movement.employee?.surname].filter(Boolean).join(' ') || 'System'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
