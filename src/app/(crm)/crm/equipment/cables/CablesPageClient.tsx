'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, Cable, ArrowLeft, Edit, Trash2, List, LayoutGrid, Table2 } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useGetCablesListQuery, useDeleteCableMutation } from '../store/equipmentApi';
import Image from 'next/image';
import Link from 'next/link';
import Popover from '@/components/UI/Tooltip';
import { useUserPreferences } from '@/hooks/useUserPreferences';
import { catalogViewMode, type CatalogViewMode } from '@/lib/CRM/equipment/catalogViewMode';

interface CableItem {
  id: string;
  name: string;
  length_meters: number | null;
  connector_in_type: { id: string; name: string; thumbnail_url: string | null } | null;
  connector_out_type: { id: string; name: string; thumbnail_url: string | null } | null;
  stock_quantity: number;
  stock_unit: 'piece' | 'meter';
  minimum_stock_quantity: number;
  thumbnail_url: string | null;
  warehouse_categories: { id: string; name: string } | null;
  storage_location: { id: string; name: string } | null;
  cable_category: { id: string; parent_id: string | null; name: string; color: string } | null;
}

function CableThumbnail({ cable, large = false }: { cable: CableItem; large?: boolean }) {
  const size = large ? 'h-40 w-full' : 'h-16 w-16';
  if (!cable.thumbnail_url) return <div className={`${size} flex shrink-0 items-center justify-center rounded-lg bg-[#0f1117]`}><Cable className="h-8 w-8 text-[#8a8988]" /></div>;
  return <Popover
    openOn="auto"
    ariaLabel={`Powiększ zdjęcie: ${cable.name}`}
    triggerClassName={large ? 'w-full' : 'shrink-0'}
    trigger={<Image width={large ? 320 : 64} height={large ? 160 : 64} src={cable.thumbnail_url} alt={cable.name} className={`${size} cursor-zoom-in rounded-lg object-contain bg-[#0f1117]`} />}
    content={<Image width={320} height={320} src={cable.thumbnail_url} alt={cable.name} className="max-h-80 w-full rounded-lg object-contain" />}
  />;
}

export default function CablesListPage({ initialViewMode }: { initialViewMode?: unknown }) {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { canCreateInModule, canManageModule } = useCurrentEmployee();

  const [viewMode, setLocalViewMode] = useState<CatalogViewMode>(() => catalogViewMode(initialViewMode));
  const { setViewMode, loading: preferencesLoading } = useUserPreferences();
  const changeView = (mode: CatalogViewMode) => {
    setLocalViewMode(mode);
    void setViewMode('cables', mode);
  };
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryId, setCategoryId] = useState('all');

  const { data: cables = [], isLoading, refetch } = useGetCablesListQuery();
  const [deleteCable] = useDeleteCableMutation();

  const cableCategories = Array.from(
    new Map(
      cables
        .map((cable: CableItem) => cable.cable_category)
        .filter(Boolean)
        .map((category: any) => [category.id, category]),
    ).values(),
  ) as CableItem['cable_category'][];
  const filteredCables = cables.filter((cable: CableItem) => {
    const query = searchTerm.trim().toLowerCase();
    const matchesQuery = !query || [
      cable.name,
      cable.connector_in_type?.name,
      cable.connector_out_type?.name,
      cable.cable_category?.name,
    ].some((value) => value?.toLowerCase().includes(query));
    const matchesCategory = categoryId === 'all' || cable.cable_category?.id === categoryId;
    return matchesQuery && matchesCategory;
  });

  const handleDelete = async (id: string, name: string) => {
    if (!canManageModule('equipment')) return;
    const confirmed = await showConfirm({
      title: 'Usuń przewód',
      message: `Czy na pewno chcesz usunąć przewód "${name}"?`,
    });
    if (!confirmed) return;

    try {
      await deleteCable(id).unwrap();
      showSnackbar('Przewód usunięty', 'success');
      refetch();
    } catch (e) {
      showSnackbar('Błąd podczas usuwania', 'error');
    }
  };

  const actions = (cable: CableItem) => canManageModule('equipment') && (
    <div className="flex items-center gap-2">
      <Link href={`/crm/equipment/cables/${cable.id}`} className="rounded-lg p-2 hover:bg-[#0f1117]" aria-label={`Edytuj: ${cable.name}`} title="Edytuj"><Edit className="h-4 w-4" /></Link>
      <button onClick={() => handleDelete(cable.id, cable.name)} className="rounded-lg p-2 text-red-400 hover:bg-red-500/10" aria-label={`Usuń: ${cable.name}`} title="Usuń"><Trash2 className="h-4 w-4" /></button>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0f1117] text-[#e5e4e2] p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/crm/equipment')}
              className="p-2 hover:bg-[#1c1f33] rounded-lg"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Cable className="w-6 h-6" />
              Przewody
            </h1>
          </div>

          {canCreateInModule('equipment') && (
            <button
              onClick={() => router.push('/crm/equipment/cables/new')}
              className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90"
            >
              <Plus className="w-4 h-4" />
              Dodaj przewód
            </button>
          )}
        </div>

        {/* Search */}
        <div className="mb-6 grid gap-3 md:grid-cols-[minmax(0,1fr)_240px_auto]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8a8988]" />
            <input
              type="text"
              placeholder="Szukaj przewodów..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg pl-10 pr-4 py-2 text-[#e5e4e2] placeholder-[#8a8988] focus:outline-none focus:border-[#d3bb73]"
            />
          </div>
          <select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
          >
            <option value="all">Wszystkie przeznaczenia</option>
            {cableCategories.map((category) => category && (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
          <div className="flex gap-2" role="group" aria-label="Widok przewodów">
            {([{ mode: 'list', label: 'Lista', Icon: List }, { mode: 'grid', label: 'Kafelki', Icon: LayoutGrid }, { mode: 'table', label: 'Tabela', Icon: Table2 }] as const).map(({ mode, label, Icon }) => (
              <button key={mode} onClick={() => changeView(mode)} disabled={preferencesLoading} aria-label={label} title={label} aria-pressed={viewMode === mode} className={`rounded-lg p-3 transition-colors ${viewMode === mode ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#1c1f33] text-[#e5e4e2]'} disabled:opacity-50`}><Icon className="h-5 w-5" /></button>
            ))}
          </div>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="text-center py-12 text-[#8a8988]">Ładowanie...</div>
        )}

        {/* Empty */}
        {!isLoading && filteredCables.length === 0 && (
          <div className="text-center py-12">
            <Cable className="w-16 h-16 mx-auto mb-4 text-[#8a8988]" />
            <p className="text-[#8a8988] mb-4">Brak przewodów</p>
            {canCreateInModule('equipment') && (
              <button
                onClick={() => router.push('/crm/equipment/cables/new')}
                className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90"
              >
                <Plus className="w-4 h-4" />
                Dodaj pierwszy przewód
              </button>
            )}
          </div>
        )}

        {/* List */}
        {!isLoading && filteredCables.length > 0 && viewMode !== 'table' && (
          <div className={viewMode === 'grid' ? "grid gap-4 sm:grid-cols-2 xl:grid-cols-3" : "grid gap-4"}>
            {filteredCables.map((cable: CableItem) => (
              <div
                key={cable.id}
                className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg p-4 hover:border-[#d3bb73]/40 transition-colors"
              >
                <div className={viewMode === 'grid' ? "flex h-full flex-col gap-4" : "flex flex-wrap items-center gap-4"}>
                  {/* Thumbnail */}
                  <CableThumbnail cable={cable} large={viewMode === 'grid'} />

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-lg mb-1"><Link href={`/crm/equipment/cables/${cable.id}`} className="hover:text-[#d3bb73] hover:underline">{cable.name}</Link></h3>
                    {cable.cable_category && (
                      <span
                        className="mb-1 inline-flex rounded-full border px-2 py-0.5 text-[11px]"
                        style={{ borderColor: `${cable.cable_category.color}66`, color: cable.cable_category.color }}
                      >
                        {cable.cable_category.name}
                      </span>
                    )}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-[#8a8988]">
                      {cable.length_meters && (
                        <span>Długość: {cable.length_meters}m</span>
                      )}
                      {cable.connector_in_type && (
                        <span>Wejście: {cable.connector_in_type.name}</span>
                      )}
                      {cable.connector_out_type && (
                        <span>Wyjście: {cable.connector_out_type.name}</span>
                      )}
                      <span className="text-[#d3bb73]">
                        Stan: {cable.stock_quantity || 0} {cable.stock_unit === 'meter' ? 'm' : 'szt.'}
                      </span>
                      {Number(cable.stock_quantity || 0) <= Number(cable.minimum_stock_quantity || 0) && (
                        <span className="text-amber-400">Niski stan</span>
                      )}
                    </div>
                    {cable.warehouse_categories && (
                      <div className="text-xs text-[#8a8988] mt-1">
                        Kategoria: {cable.warehouse_categories.name}
                      </div>
                    )}
                    {cable.storage_location && (
                      <div className="text-xs text-[#8a8988] mt-1">
                        Lokalizacja: {cable.storage_location.name}
                      </div>
                    )}
                  </div>

                  {actions(cable)}
                </div>
              </div>
            ))}
          </div>
        )}

        {!isLoading && filteredCables.length > 0 && viewMode === 'table' && (
          <div className="overflow-x-auto rounded-xl bg-[#1c1f33]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#0f1117] text-[#e5e4e2]/60"><tr>
                {['Przewód', 'Przeznaczenie', 'Długość', 'Wejście', 'Wyjście', 'Stan', 'Lokalizacja'].map(label => <th key={label} scope="col" className="px-4 py-3">{label}</th>)}
                {canManageModule('equipment') && <th scope="col" className="px-4 py-3">Akcje</th>}
              </tr></thead>
              <tbody>{filteredCables.map((cable: CableItem) => <tr key={cable.id} className="border-t border-white/5 hover:bg-white/5">
                <td className="px-4 py-3"><div className="flex min-w-52 items-center gap-3"><CableThumbnail cable={cable} /><div><Link href={`/crm/equipment/cables/${cable.id}`} className="font-medium hover:text-[#d3bb73] hover:underline">{cable.name}</Link><div className="text-xs text-[#8a8988]">{cable.warehouse_categories?.name}</div></div></div></td>
                <td className="px-4 py-3">{cable.cable_category?.name || '—'}</td>
                <td className="whitespace-nowrap px-4 py-3">{cable.length_meters != null ? `${cable.length_meters} m` : '—'}</td>
                <td className="px-4 py-3">{cable.connector_in_type?.name || '—'}</td>
                <td className="px-4 py-3">{cable.connector_out_type?.name || '—'}</td>
                <td className="whitespace-nowrap px-4 py-3 text-[#d3bb73]">{cable.stock_quantity || 0} {cable.stock_unit === 'meter' ? 'm' : 'szt.'}{Number(cable.stock_quantity || 0) <= Number(cable.minimum_stock_quantity || 0) && <div className="text-xs text-amber-400">Niski stan</div>}</td>
                <td className="px-4 py-3">{cable.storage_location?.name || '—'}</td>
                {canManageModule('equipment') && <td className="px-4 py-3">{actions(cable)}</td>}
              </tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
