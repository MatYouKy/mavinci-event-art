'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Database as DatabaseIcon, Search, Trash2 } from 'lucide-react';
import { useGetDatabasesQuery, useCreateDatabaseMutation, useDeleteDatabaseMutation } from './api/databasesApi';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import Loader from '@/components/UI/Loader';

export default function DatabasesPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { canManageModule, isAdmin } = useCurrentEmployee();
  const canManage = canManageModule('databases');

  const { data: databases = [], isLoading } = useGetDatabasesQuery();
  const [createDatabase] = useCreateDatabaseMutation();
  const [deleteDatabase] = useDeleteDatabaseMutation();

  const [searchTerm, setSearchTerm] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newDatabaseName, setNewDatabaseName] = useState('');
  const [newDatabaseDescription, setNewDatabaseDescription] = useState('');

  const filteredDatabases = databases.filter(
    (db) =>
      db.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      db.description?.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const handleCreateDatabase = async () => {
    if (!newDatabaseName.trim()) {
      showSnackbar('Wprowadź nazwę bazy danych', 'error');
      return;
    }

    try {
      const result = await createDatabase({
        name: newDatabaseName.trim(),
        description: newDatabaseDescription.trim() || undefined,
      }).unwrap();

      showSnackbar('Baza danych utworzona', 'success');
      setIsCreating(false);
      setNewDatabaseName('');
      setNewDatabaseDescription('');
      router.push(`/crm/databases/${result.id}`);
    } catch (error) {
      console.error('Error creating database:', error);
      showSnackbar('Błąd podczas tworzenia bazy danych', 'error');
    }
  };

  const handleDeleteDatabase = async (id: string, name: string) => {
    const confirmed = await showConfirm(
      `Czy na pewno chcesz usunąć bazę danych "${name}"? Ta operacja jest nieodwracalna i usunie wszystkie dane.`,
      'Usuń',
    );
    if (!confirmed) return;

    try {
      await deleteDatabase(id).unwrap();
      showSnackbar('Baza danych usunięta', 'success');
    } catch (error) {
      console.error('Error deleting database:', error);
      showSnackbar('Błąd podczas usuwania bazy danych', 'error');
    }
  };

  if (isLoading) {
    return <Loader />;
  }

  return (
    <div className="h-full overflow-y-auto bg-[#0f1119] p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-[#e5e4e2]">Bazy Danych</h1>
            <p className="mt-1 text-sm text-[#e5e4e2]/60">
              Zarządzaj własnymi bazami danych w formie arkusza
            </p>
          </div>
          {canManage && (
            <button
              onClick={() => setIsCreating(true)}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
            >
              <Plus className="h-5 w-5" />
              Nowa Baza Danych
            </button>
          )}
        </div>

        {isCreating && (
          <div className="mb-6 rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
            <h2 className="mb-4 text-xl font-semibold text-[#e5e4e2]">Utwórz nową bazę danych</h2>
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Nazwa</label>
                <input
                  type="text"
                  value={newDatabaseName}
                  onChange={(e) => setNewDatabaseName(e.target.value)}
                  placeholder="np. Kontakty, Produkty, Inwentarz..."
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Opis (opcjonalny)</label>
                <textarea
                  value={newDatabaseDescription}
                  onChange={(e) => setNewDatabaseDescription(e.target.value)}
                  placeholder="Krótki opis bazy danych..."
                  rows={3}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleCreateDatabase}
                  className="rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                >
                  Utwórz
                </button>
                <button
                  onClick={() => {
                    setIsCreating(false);
                    setNewDatabaseName('');
                    setNewDatabaseDescription('');
                  }}
                  className="rounded-lg border border-[#d3bb73]/20 px-4 py-2 font-medium text-[#e5e4e2] transition-colors hover:bg-[#0f1119]"
                >
                  Anuluj
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#e5e4e2]/40" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Szukaj baz danych..."
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] py-2 pl-10 pr-4 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
            />
          </div>
        </div>

        {filteredDatabases.length === 0 ? (
          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-12 text-center">
            <DatabaseIcon className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/40" />
            <h3 className="mb-2 text-lg font-medium text-[#e5e4e2]">
              {searchTerm ? 'Nie znaleziono baz danych' : 'Brak baz danych'}
            </h3>
            <p className="text-sm text-[#e5e4e2]/60">
              {searchTerm
                ? 'Spróbuj zmienić kryteria wyszukiwania'
                : canManage
                  ? 'Utwórz swoją pierwszą bazę danych'
                  : 'Nie masz dostępu do żadnych baz danych'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredDatabases.map((database) => (
              <div
                key={database.id}
                onClick={() => router.push(`/crm/databases/${database.id}`)}
                className="group relative cursor-pointer rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6 transition-all hover:border-[#d3bb73]/30 hover:bg-[#1c1f33]/80"
              >
                <div className="mb-4 flex items-start justify-between">
                  <div className="rounded-lg bg-[#d3bb73]/10 p-3">
                    <DatabaseIcon className="h-6 w-6 text-[#d3bb73]" />
                  </div>
                  {isAdmin() && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteDatabase(database.id, database.name);
                      }}
                      className="rounded-lg p-2 text-[#e5e4e2]/40 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <h3 className="mb-2 text-lg font-semibold text-[#e5e4e2]">{database.name}</h3>
                {database.description && (
                  <p className="mb-4 line-clamp-2 text-sm text-[#e5e4e2]/60">{database.description}</p>
                )}
                <div className="flex items-center justify-between text-xs text-[#e5e4e2]/40">
                  <span>Utworzono {new Date(database.created_at).toLocaleDateString('pl-PL')}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
