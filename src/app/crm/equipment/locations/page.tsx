'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  MapPin,
  Plus,
  Edit,
  Trash2,
  ArrowLeft,
  Save,
  X,
  Building2,
  CheckCircle,
  XCircle,
  Loader2,
  Table as TableIcon,
  LayoutGrid,
  Search,
} from 'lucide-react';

import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { ResponsiveActionBar, Action } from '@/components/crm/ResponsiveActionBar';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { checkGoogleMapsUrl } from '@/lib/gus'; // upewnij się, że ścieżka poprawna
import { IStorageLocation } from '../types/equipment.types';
import { LocationsTable } from './LocationsTable';
import {
  useCreateStorageLocationMutation,
  useDeleteStorageLocationMutation,
  useGetStorageLocationsQuery,
  useUpdateStorageLocationMutation,
} from '../store/equipmentApi';
import { StorageLocationModal } from './StorageLocationModal';
import { CrmHeader } from '@/components/crm/Header/CrmHeader';

/* ---------------------------------- helpers ---------------------------------- */

type ViewMode = 'grid' | 'table';
type SearchScope = 'all' | 'name' | 'address';

const norm = (s: string) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

/* ---------------------------------- component ---------------------------------- */

export default function StorageLocationsPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { canCreateInModule } = useCurrentEmployee();
  const { isAdmin } = useAuth();

  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchScope, setSearchScope] = useState<SearchScope>('all');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<IStorageLocation | null>(null);

  const { data, isLoading, isError, refetch } = useGetStorageLocationsQuery();
  const [createLocation, { isLoading: creating }] = useCreateStorageLocationMutation();
  const [updateLocation, { isLoading: updating }] = useUpdateStorageLocationMutation();
  const [deleteLocation, { isLoading: deleting }] = useDeleteStorageLocationMutation();

  const canManage = isAdmin || canCreateInModule('equipment');

  // Ujednolicenie kształtu odpowiedzi
  const items: IStorageLocation[] = useMemo(() => {
    if (!data) return [];
    if (Array.isArray((data as any)?.items)) return (data as any).items as IStorageLocation[];
    return data as IStorageLocation[];
  }, [data]);

  // Search (Wszystko / Nazwa / Adres)
  const displayed = useMemo(() => {
    const q = norm(searchTerm.trim());
    if (!q) return items;

    return items.filter((loc) => {
      const n = norm(loc.name || '');
      const a = norm(loc.address || '');
      switch (searchScope) {
        case 'name':
          return n.includes(q);
        case 'address':
          return a.includes(q);
        default:
          return n.includes(q) || a.includes(q);
      }
    });
  }, [items, searchTerm, searchScope]);

  /* ----------------------------- modal form state ---------------------------- */

  const initialForm: IStorageLocation = {
    name: '',
    address: '',
    access_info: '',
    google_maps_url: '',
    notes: '',
    is_active: true,
  };
  const [form, setForm] = useState(initialForm);

  const openForCreate = () => {
    setEditing(null);
    setForm(initialForm);
    setShowModal(true);
  };

  const openForEdit = (loc: IStorageLocation) => {
    setEditing(loc);
    setForm({
      name: loc.name ?? '',
      address: loc.address ?? '',
      access_info: loc.access_info ?? '',
      google_maps_url: loc.google_maps_url ?? '',
      notes: loc.notes ?? '',
      is_active: !!loc.is_active,
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditing(null);
    setForm(initialForm);
  };

  const handleSubmitModal = async (values: IStorageLocation) => {
    try {
      if (editing) {
        await updateLocation({ id: editing._id, patch: values }).unwrap();
        showSnackbar('Lokalizacja zaktualizowana', 'success');
      } else {
        await createLocation(values).unwrap();
        showSnackbar('Lokalizacja dodana', 'success');
      }
      closeModal();
      refetch();
    } catch (err: any) {
      showSnackbar(err?.data?.message || err?.message || 'Błąd zapisu', 'error');
    }
  };

  const onDelete = async (row: IStorageLocation, e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await showConfirm(`Usunąć lokalizację "${row.name}"?`, 'Usuń');
    if (!ok) return;
    try {
      await deleteLocation(row._id).unwrap();
      showSnackbar('Lokalizacja usunięta', 'success');
      refetch();
    } catch (err: any) {
      showSnackbar(err?.data?.message || err?.message || 'Błąd usuwania', 'error');
    }
  };

  // ✅ Poprawiony handler testu linku (używa stanu `form`, nie `formData`)
  const onParseMaps = () => {
    const raw = form.google_maps_url?.trim();
    if (!raw) {
      showSnackbar('Wprowadź URL Google Maps', 'error');
      return;
    }
    try {
      const res = checkGoogleMapsUrl(raw);
      if (!res) {
        showSnackbar('To nie wygląda na prawidłowy link Google Maps.', 'error');
        return;
      }
      if (res.kind === 'full') {
        showSnackbar(`OK — współrzędne: ${res.lat}, ${res.lng}`, 'success');
      } else {
        showSnackbar('OK — skrócony link wygląda poprawnie ✅', 'success');
      }
    } catch (error: any) {
      showSnackbar(error?.message || 'Błąd weryfikacji linku', 'error');
    }
  };

  /* ---------------------------------- actions --------------------------------- */

  const actions = useMemo<Action[]>(
    () => [
      {
        label: 'Powrót',
        onClick: () => router.push('/crm/equipment'),
        icon: <ArrowLeft className="h-4 w-4" />,
        variant: "default" as const,
      },
      ...(canManage
        ? [
            {
              label: 'Dodaj',
              onClick: openForCreate,
              icon: <Plus className="h-4 w-4" />,
              variant: "primary" as const,
            },
          ]
        : []),
    ],
    [router, canManage],
  );

  /* ------------------------------------ UI ------------------------------------ */

  return (
    <div className="flex h-[calc(100vh-130px)] flex-col bg-[#0f1119]">
      {/* HEADER */}
      <CrmHeader title="Lokalizacje magazynowe" backButtonPath="/crm/equipment" actions={actions} />

      {/* FILTRY */}
      <div className="space-y-2 border-b border-[#d3bb73]/10 bg-[#0f1119] px-3 py-2">
        <div className="flex items-center gap-2">
          {/* search */}
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/40" />
            <input
              type="text"
              placeholder={
                searchScope === 'name'
                  ? 'Szukaj po nazwie…'
                  : searchScope === 'address'
                  ? 'Szukaj po adresie…'
                  : 'Szukaj (nazwa, adres)…'
              }
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] py-2 pl-9 pr-3 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
            />
          </div>

          {/* zakres wyszukiwania */}
          <div className="inline-flex shrink-0 overflow-hidden rounded-lg border border-[#d3bb73]/20">
            {(['all', 'name', 'address'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSearchScope(s)}
                className={`px-2.5 py-2 text-xs ${
                  searchScope === s ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#0f1119] text-[#e5e4e2]'
                }`}
              >
                {s === 'all' ? 'Wszystko' : s === 'name' ? 'Nazwa' : 'Adres'}
              </button>
            ))}
          </div>

          {/* tryb widoku */}
          <div className="inline-flex overflow-hidden rounded-lg border border-[#d3bb73]/20">
            <button
              onClick={() => setViewMode('table')}
              className={`px-2.5 py-1.5 text-sm ${
                viewMode === 'table' ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#0f1119] text-[#e5e4e2]'
              }`}
              title="Widok tabeli"
            >
              <TableIcon className="h-4 w-4 rotate-90" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`px-2.5 py-1.5 text-sm ${
                viewMode === 'grid' ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#0f1119] text-[#e5e4e2]'
              }`}
              title="Widok kafelków"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* TREŚĆ */}
      <div className="flex-1 overflow-y-auto p-3">
        {isError ? (
          <div className="text-center text-[#e5e4e2]/70">
            Błąd pobierania.{' '}
            <button className="underline" onClick={() => refetch()}>
              Spróbuj ponownie
            </button>
          </div>
        ) : isLoading ? (
          <div className="flex h-64 items-center justify-center text-[#e5e4e2]/60">
            <Loader2 className="h-6 w-6 animate-spin text-[#d3bb73]" />
          </div>
        ) : items.length === 0 ? (
          <div className="py-12 text-center">
            <Building2 className="mx-auto mb-4 h-16 w-16 text-gray-600" />
            <p className="mb-4 text-gray-400">Brak lokalizacji magazynowych</p>
            {canManage && (
              <button
                onClick={openForCreate}
                className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#0f1119] transition-colors hover:bg-[#c4a859]"
              >
                <Plus className="h-5 w-5" />
                <span>Dodaj pierwszą lokalizację</span>
              </button>
            )}
          </div>
        ) : viewMode === 'table' ? (
          <LocationsTable rows={displayed} onEdit={openForEdit} onDelete={onDelete} />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {displayed.map((loc) => (
              <div
                key={loc._id}
                className={`rounded-lg border bg-[#1a1d2e] p-4 ${
                  loc.is_active ? 'border-[#d3bb73]/15' : 'border-red-900/50 opacity-90'
                }`}
              >
                <div className="mb-3 flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-[#d3bb73]" />
                    <h3 className="text-lg font-semibold text-white">{loc.name}</h3>
                  </div>
                  <div className="flex items-center gap-1">
                    {loc.is_active ? (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-500" />
                    )}
                  </div>
                </div>

                {loc.address && (
                  <p className="mb-2 text-sm text-gray-400">
                    <MapPin className="mr-1 inline h-4 w-4" />
                    {loc.address}
                  </p>
                )}

                {loc.access_info && (
                  <p className="mb-2 text-sm text-gray-300">
                    <span className="font-medium">Dostęp:</span> {loc.access_info}
                  </p>
                )}

                {loc.google_maps_url && (
                  <a
                    href={loc.google_maps_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mb-2 block text-sm text-[#d3bb73] hover:underline"
                  >
                    🗺️ Otwórz w Google Maps
                  </a>
                )}

                {loc.notes && <p className="mb-3 text-xs text-gray-500">{loc.notes}</p>}

                {canManage && (
                  <div className="flex items-center gap-2 border-t border-gray-700 pt-3">
                    <button
                      onClick={() => openForEdit(loc)}
                      className="flex flex-1 items-center justify-center gap-1 rounded bg-[#d3bb73]/20 px-3 py-2 text-sm text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/30"
                    >
                      <Edit className="h-4 w-4" />
                      <span>Edytuj</span>
                    </button>
                    <button
                      onClick={(e) => onDelete(loc, e as any)}
                      className="rounded bg-red-900/20 px-3 py-2 text-red-400 transition-colors hover:bg-red-900/30"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <StorageLocationModal
          open={showModal}
          title={editing ? 'Edytuj lokalizację' : 'Dodaj lokalizację'}
          initialValues={form}
          submitting={creating || updating}
          onClose={closeModal}
          onSubmit={handleSubmitModal}
        />
      </div>
    </div>
  );
}