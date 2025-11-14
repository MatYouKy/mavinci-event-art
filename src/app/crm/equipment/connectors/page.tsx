'use client';

import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';

import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useDeleteConnectorMutation, useGetConnectorsQuery } from '../store/equipmentApi';

import { useAuth } from '@/features/auth/hooks/useAuth';
import { Action } from '@/components/crm/ResponsiveActionBar';
import { ViewModeType } from '@/components/UI/types/view.type';
import { CrmHeader } from '@/components/crm/Header/CrmHeader';
import { ViewMode } from '@/components/crm/ViewMode/ViewMode';
import { ConnectorsTable } from './view/ConnectorsTable';
import { ConnectrosGrid } from './view/ConnectrosGrid';
import { ConnectorsList } from './view/ConnectorsList';
import { ManageConnectorsModal } from './ManageConnectorsModal';
import { IConnectorType } from './connector.type';

export default function ConnectorsView() {
  const [viewMode, setViewMode] = useState<ViewModeType>('table');
  const { canManageModule } = useCurrentEmployee();
  const { isAdmin } = useAuth();
  const canManage = isAdmin || canManageModule('equipment');

  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();

  const { data: connectors = [], isLoading, isFetching } = useGetConnectorsQuery();
  const [deleteConnector, { isLoading: isDeleting }] = useDeleteConnectorMutation();

  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [selected, setSelected] = useState<IConnectorType | null>(null);

  const filteredConnectors = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return connectors;
    return connectors.filter((c) =>
      [c.name, c.description ?? '', c.common_uses ?? ''].some((v) => v.toLowerCase().includes(q)),
    );
  }, [connectors, searchQuery]);

  const openAddModal = () => {
    setSelected(null);
    setShowModal(true);
  };

  const openEditModal = (connector: IConnectorType, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelected(connector);
    setShowModal(true);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmed = await showConfirm('Czy na pewno chcesz usunąć ten wtyk?', 'Usuń wtyk');
    if (!confirmed) return;

    try {
      await deleteConnector(id).unwrap();
      showSnackbar('Wtyk usunięty', 'success');
    } catch (err) {
      console.error(err);
      showSnackbar('Błąd podczas usuwania wtyka', 'error');
    }
  };

  const actions: Action[] = useMemo(() => {
    const baseActions: Action[] = [
      {
        label: 'Dodaj wtyk',
        onClick: openAddModal,
        icon: <Plus className="h-4 w-4" />,
        variant: 'primary',
      },
    ];
    return baseActions;
  }, [openAddModal]);

  /* ------------------- RENDER ------------------- */

  if (isLoading || isFetching || isDeleting) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-[#e5e4e2]/60">Ładowanie wtyków...</div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-130px)] flex-col bg-[#0f1119]">
      {/* HEADER */}
      <CrmHeader title="Wtyki" backButtonPath="/crm/equipment" actions={actions} />
      <div className="space-y-6">
        {/* Toolbar */}

        <div className="w-full flex flex-wrap items-center gap-2 pt-2">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#e5e4e2]/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Szukaj wtyków..."
              className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] py-1 pl-10 pr-4 text-[#e5e4e2] focus:border-[#d3bb73]/30 focus:outline-none"
            />
          </div>
          {/* typ wyświetlania */}
          <ViewMode viewMode={viewMode} setViewMode={setViewMode} />
        </div>

        {/* List/Grid/Compact */}
        {filteredConnectors.length === 0 ? (
          <div className="py-12 text-center text-[#e5e4e2]/40">
            {searchQuery ? 'Nie znaleziono wtyków' : 'Brak wtyków w bazie'}
          </div>
        ) : viewMode === 'list' ? (
          <ConnectorsList
            connectors={filteredConnectors}
            onEdit={openEditModal}
            onDelete={handleDelete}
            canManage={canManage}
          />
        ) : viewMode === 'grid' ? (
          <ConnectrosGrid
            connectors={filteredConnectors}
            onEdit={openEditModal}
            onDelete={handleDelete}
            canManage={canManage}
          />
        ) : (
          <ConnectorsTable
            rows={filteredConnectors}
            onEdit={openEditModal}
            onDelete={handleDelete}
            canManage={canManage}
          />
        )}
        {showModal && canManage && (
          <ManageConnectorsModal
            selected={selected}
            setSelected={setSelected}
            setShowModal={setShowModal}
          />
        )}
      </div>
    </div>
  );
}
