'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Database as DatabaseIcon, Search, Trash2, Users, X } from 'lucide-react';
import { useGetDatabasesQuery, useCreateDatabaseMutation, useDeleteDatabaseMutation } from './api/databasesApi';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { Loader } from '@/components/UI/Loader';
import { supabase } from '@/lib/supabase/browser';

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
  const [sharingDatabaseId, setSharingDatabaseId] = useState<string | null>(null);
  const [employees, setEmployees] = useState<any[]>([]);
  const [shares, setShares] = useState<any[]>([]);
  const [loadingShares, setLoadingShares] = useState(false);

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

  const handleOpenSharing = async (databaseId: string) => {
    setSharingDatabaseId(databaseId);
    setLoadingShares(true);

    try {
      const { data: employeesData } = await supabase
        .from('employees')
        .select('id, name, surname, avatar_url')
        .order('name');

      const { data: sharesData } = await supabase
        .from('database_shares')
        .select('id, employee_id, can_edit_records, employees(name, surname, avatar_url)')
        .eq('database_id', databaseId);

      setEmployees(employeesData || []);
      setShares(sharesData || []);
    } catch (error) {
      console.error('Error fetching sharing data:', error);
      showSnackbar('Błąd podczas ładowania danych udostępniania', 'error');
    } finally {
      setLoadingShares(false);
    }
  };

  const handleShareDatabase = async (employeeId: string) => {
    if (!sharingDatabaseId) return;

    try {
      const { error } = await supabase.from('database_shares').insert({
        database_id: sharingDatabaseId,
        employee_id: employeeId,
        can_edit_records: false,
      });

      if (error) throw error;

      showSnackbar('Baza danych udostępniona', 'success');
      handleOpenSharing(sharingDatabaseId);
    } catch (error: any) {
      console.error('Error sharing database:', error);
      if (error?.code === '23505') {
        showSnackbar('Ten pracownik ma już dostęp do tej bazy', 'error');
      } else {
        showSnackbar('Błąd podczas udostępniania bazy danych', 'error');
      }
    }
  };

  const handleRevokeShare = async (shareId: string) => {
    if (!sharingDatabaseId) return;

    try {
      const { error } = await supabase.from('database_shares').delete().eq('id', shareId);

      if (error) throw error;

      showSnackbar('Dostęp odebrany', 'success');
      handleOpenSharing(sharingDatabaseId);
    } catch (error) {
      console.error('Error revoking share:', error);
      showSnackbar('Błąd podczas odbierania dostępu', 'error');
    }
  };

  const handleCloseSharing = () => {
    setSharingDatabaseId(null);
    setEmployees([]);
    setShares([]);
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
                  {(isAdmin || canManage) && (
                    <div className="flex gap-1 opacity-0 transition-all group-hover:opacity-100">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenSharing(database.id);
                        }}
                        className="rounded-lg p-2 text-[#e5e4e2]/40 transition-all hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]"
                        title="Udostępnij bazę danych"
                      >
                        <Users className="h-4 w-4" />
                      </button>
                      {isAdmin && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteDatabase(database.id, database.name);
                          }}
                          className="rounded-lg p-2 text-[#e5e4e2]/40 transition-all hover:bg-red-500/10 hover:text-red-400"
                          title="Usuń bazę danych"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
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

        {sharingDatabaseId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-2xl rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-xl font-semibold text-[#e5e4e2]">Udostępnij bazę danych</h2>
                <button
                  onClick={handleCloseSharing}
                  className="rounded-lg p-2 text-[#e5e4e2]/40 transition-colors hover:bg-[#0f1119] hover:text-[#e5e4e2]"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {loadingShares ? (
                <div className="py-12 text-center">
                  <Loader />
                </div>
              ) : (
                <>
                  <div className="mb-6">
                    <h3 className="mb-3 text-sm font-medium text-[#e5e4e2]">Udostępniono dla:</h3>
                    {shares.length === 0 ? (
                      <p className="text-sm text-[#e5e4e2]/60">
                        Ta baza danych nie jest jeszcze nikomu udostępniona
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {shares.map((share: any) => (
                          <div
                            key={share.id}
                            className="flex items-center justify-between rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3"
                          >
                            <div className="flex items-center gap-3">
                              {share.employees?.avatar_url ? (
                                <img
                                  src={share.employees.avatar_url}
                                  alt=""
                                  className="h-8 w-8 rounded-full object-cover"
                                />
                              ) : (
                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#d3bb73]/20 text-xs font-medium text-[#d3bb73]">
                                  {share.employees?.name?.[0]}
                                  {share.employees?.surname?.[0]}
                                </div>
                              )}
                              <div>
                                <div className="text-sm font-medium text-[#e5e4e2]">
                                  {share.employees?.name} {share.employees?.surname}
                                </div>
                                <div className="text-xs text-[#e5e4e2]/60">
                                  {share.can_edit_records ? 'Może edytować dane' : 'Tylko odczyt'}
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={() => handleRevokeShare(share.id)}
                              className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10"
                            >
                              Odbierz
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="border-t border-[#d3bb73]/10 pt-6">
                    <h3 className="mb-3 text-sm font-medium text-[#e5e4e2]">Udostępnij pracownikowi:</h3>
                    <div className="max-h-64 space-y-2 overflow-y-auto">
                      {employees
                        .filter((emp) => !shares.some((share: any) => share.employee_id === emp.id))
                        .map((employee) => (
                          <button
                            key={employee.id}
                            onClick={() => handleShareDatabase(employee.id)}
                            className="flex w-full items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3 text-left transition-colors hover:border-[#d3bb73]/30 hover:bg-[#0f1119]/80"
                          >
                            {employee.avatar_url ? (
                              <img
                                src={employee.avatar_url}
                                alt=""
                                className="h-8 w-8 rounded-full object-cover"
                              />
                            ) : (
                              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#d3bb73]/20 text-xs font-medium text-[#d3bb73]">
                                {employee.name[0]}
                                {employee.surname[0]}
                              </div>
                            )}
                            <div>
                              <div className="text-sm font-medium text-[#e5e4e2]">
                                {employee.name} {employee.surname}
                              </div>
                            </div>
                          </button>
                        ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
