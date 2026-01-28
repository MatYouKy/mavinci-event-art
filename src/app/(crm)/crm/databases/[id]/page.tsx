'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Download,
  FileText,
  Edit2,
  Save,
  X,
  GripVertical,
} from 'lucide-react';
import {
  useGetDatabaseByIdQuery,
  useGetDatabaseColumnsQuery,
  useGetDatabaseRecordsQuery,
  useUpdateDatabaseMutation,
  useDeleteDatabaseMutation,
  useCreateColumnMutation,
  useUpdateColumnMutation,
  useDeleteColumnMutation,
  useCreateRecordMutation,
  useUpdateRecordMutation,
  useDeleteRecordMutation,
  DatabaseColumn,
  DatabaseRecord,
} from '../api/databasesApi';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import Loader from '@/components/UI/Loader';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';

export default function DatabaseDetailPage() {
  const router = useRouter();
  const params = useParams();
  const databaseId = params.id as string;
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { canManageModule, isAdmin } = useCurrentEmployee();
  const canManage = canManageModule('databases');

  const { data: database, isLoading: isLoadingDatabase } = useGetDatabaseByIdQuery(databaseId);
  const { data: columns = [], isLoading: isLoadingColumns } = useGetDatabaseColumnsQuery(databaseId);
  const { data: records = [], isLoading: isLoadingRecords } = useGetDatabaseRecordsQuery(databaseId);

  const [updateDatabase] = useUpdateDatabaseMutation();
  const [deleteDatabase] = useDeleteDatabaseMutation();
  const [createColumn] = useCreateColumnMutation();
  const [updateColumn] = useUpdateColumnMutation();
  const [deleteColumn] = useDeleteColumnMutation();
  const [createRecord] = useCreateRecordMutation();
  const [updateRecord] = useUpdateRecordMutation();
  const [deleteRecord] = useDeleteRecordMutation();

  const [editingDatabaseName, setEditingDatabaseName] = useState(false);
  const [databaseName, setDatabaseName] = useState('');
  const [editingCell, setEditingCell] = useState<{ recordId: string; columnId: string } | null>(null);
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null);
  const [columnName, setColumnName] = useState('');
  const [newColumnName, setNewColumnName] = useState('');
  const [newColumnType, setNewColumnType] = useState<'text' | 'number' | 'date' | 'boolean'>('text');
  const [isAddingColumn, setIsAddingColumn] = useState(false);

  useEffect(() => {
    if (database) {
      setDatabaseName(database.name);
    }
  }, [database]);

  const handleUpdateDatabaseName = async () => {
    if (!databaseName.trim()) {
      showSnackbar('Wprowadź nazwę bazy danych', 'error');
      return;
    }

    try {
      await updateDatabase({
        id: databaseId,
        data: { name: databaseName.trim() },
      }).unwrap();
      showSnackbar('Nazwa zaktualizowana', 'success');
      setEditingDatabaseName(false);
    } catch (error) {
      console.error('Error updating database:', error);
      showSnackbar('Błąd podczas aktualizacji nazwy', 'error');
    }
  };

  const handleAddColumn = async () => {
    if (!newColumnName.trim()) {
      showSnackbar('Wprowadź nazwę kolumny', 'error');
      return;
    }

    try {
      await createColumn({
        database_id: databaseId,
        name: newColumnName.trim(),
        column_type: newColumnType,
        order_index: columns.length,
      }).unwrap();
      showSnackbar('Kolumna dodana', 'success');
      setNewColumnName('');
      setNewColumnType('text');
      setIsAddingColumn(false);
    } catch (error) {
      console.error('Error adding column:', error);
      showSnackbar('Błąd podczas dodawania kolumny', 'error');
    }
  };

  const handleUpdateColumn = async (columnId: string) => {
    if (!columnName.trim()) {
      showSnackbar('Wprowadź nazwę kolumny', 'error');
      return;
    }

    try {
      await updateColumn({
        id: columnId,
        data: { name: columnName.trim() },
      }).unwrap();
      showSnackbar('Kolumna zaktualizowana', 'success');
      setEditingColumnId(null);
    } catch (error) {
      console.error('Error updating column:', error);
      showSnackbar('Błąd podczas aktualizacji kolumny', 'error');
    }
  };

  const handleDeleteColumn = async (columnId: string, columnName: string) => {
    const confirmed = await showConfirm(
      `Czy na pewno chcesz usunąć kolumnę "${columnName}"? Wszystkie dane w tej kolumnie zostaną utracone.`,
      'Usuń',
    );
    if (!confirmed) return;

    try {
      await deleteColumn({ id: columnId, database_id: databaseId }).unwrap();
      showSnackbar('Kolumna usunięta', 'success');
    } catch (error) {
      console.error('Error deleting column:', error);
      showSnackbar('Błąd podczas usuwania kolumny', 'error');
    }
  };

  const handleAddRecord = async () => {
    const emptyData: Record<string, any> = {};
    columns.forEach((col) => {
      emptyData[col.id] = '';
    });

    try {
      await createRecord({
        database_id: databaseId,
        data: emptyData,
        order_index: records.length,
      }).unwrap();
      showSnackbar('Rekord dodany', 'success');
    } catch (error) {
      console.error('Error adding record:', error);
      showSnackbar('Błąd podczas dodawania rekordu', 'error');
    }
  };

  const handleUpdateCell = async (recordId: string, columnId: string, value: any) => {
    const record = records.find((r) => r.id === recordId);
    if (!record) return;

    const newData = { ...record.data, [columnId]: value };

    try {
      await updateRecord({
        id: recordId,
        database_id: databaseId,
        data: newData,
      }).unwrap();
      setEditingCell(null);
    } catch (error) {
      console.error('Error updating cell:', error);
      showSnackbar('Błąd podczas aktualizacji komórki', 'error');
    }
  };

  const handleDeleteRecord = async (recordId: string) => {
    const confirmed = await showConfirm('Czy na pewno chcesz usunąć ten rekord?', 'Usuń');
    if (!confirmed) return;

    try {
      await deleteRecord({ id: recordId, database_id: databaseId }).unwrap();
      showSnackbar('Rekord usunięty', 'success');
    } catch (error) {
      console.error('Error deleting record:', error);
      showSnackbar('Błąd podczas usuwania rekordu', 'error');
    }
  };

  const exportToCSV = () => {
    if (columns.length === 0) {
      showSnackbar('Brak kolumn do eksportu', 'error');
      return;
    }

    const headers = columns.map((col) => col.name).join(',');
    const rows = records
      .map((record) => {
        return columns.map((col) => {
          const value = record.data[col.id] || '';
          return `"${String(value).replace(/"/g, '""')}"`;
        }).join(',');
      })
      .join('\n');

    const csv = `${headers}\n${rows}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${database?.name || 'database'}.csv`;
    link.click();
    showSnackbar('Eksportowano do CSV', 'success');
  };

  const exportToPDF = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      showSnackbar('Zablokowano okno eksportu. Sprawdź ustawienia przeglądarki.', 'error');
      return;
    }

    const tableHTML = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>${database?.name || 'Baza danych'}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; }
            h1 { color: #333; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f2f2f2; font-weight: bold; }
            tr:nth-child(even) { background-color: #f9f9f9; }
            @media print {
              button { display: none; }
            }
          </style>
        </head>
        <body>
          <h1>${database?.name || 'Baza danych'}</h1>
          ${database?.description ? `<p>${database.description}</p>` : ''}
          <table>
            <thead>
              <tr>
                <th>#</th>
                ${columns.map((col) => `<th>${col.name} (${col.column_type})</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${records
                .map(
                  (record, index) => `
                <tr>
                  <td>${index + 1}</td>
                  ${columns
                    .map((col) => {
                      const value = record.data[col.id] || '';
                      return `<td>${String(value)}</td>`;
                    })
                    .join('')}
                </tr>
              `,
                )
                .join('')}
            </tbody>
          </table>
          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(tableHTML);
    printWindow.document.close();
  };

  if (isLoadingDatabase || isLoadingColumns || isLoadingRecords) {
    return <Loader />;
  }

  if (!database) {
    return (
      <div className="flex h-full items-center justify-center bg-[#0f1119]">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-[#e5e4e2]">Nie znaleziono bazy danych</h2>
          <button
            onClick={() => router.push('/crm/databases')}
            className="mt-4 text-[#d3bb73] hover:underline"
          >
            Powrót do listy
          </button>
        </div>
      </div>
    );
  }

  const actions = [
    {
      label: 'Zmień nazwę',
      onClick: () => setEditingDatabaseName(true),
      icon: <Edit2 className="h-4 w-4" />,
      variant: 'default' as const,
      show: canManage,
    },
    {
      label: 'Eksportuj CSV',
      onClick: exportToCSV,
      icon: <FileText className="h-4 w-4" />,
      variant: 'default' as const,
      show: true,
    },
    {
      label: 'Eksportuj PDF',
      onClick: exportToPDF,
      icon: <Download className="h-4 w-4" />,
      variant: 'default' as const,
      show: true,
    },
    {
      label: 'Usuń bazę',
      onClick: async () => {
        const confirmed = await showConfirm(
          `Czy na pewno chcesz usunąć całą bazę danych "${database.name}"? Ta operacja jest nieodwracalna.`,
          'Usuń',
        );
        if (confirmed) {
          try {
            await deleteDatabase(databaseId).unwrap();
            showSnackbar('Baza danych usunięta', 'success');
            router.push('/crm/databases');
          } catch (error) {
            console.error('Error deleting database:', error);
            showSnackbar('Błąd podczas usuwania bazy', 'error');
          }
        }
      },
      icon: <Trash2 className="h-4 w-4" />,
      variant: 'danger' as const,
      show: isAdmin(),
    },
  ].filter((action) => action.show);

  return (
    <div className="flex h-full flex-col bg-[#0f1119]">
      <div className="border-b border-[#d3bb73]/10 bg-[#1c1f33] p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/crm/databases')}
              className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#0f1119] hover:text-[#e5e4e2]"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            {editingDatabaseName ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={databaseName}
                  onChange={(e) => setDatabaseName(e.target.value)}
                  className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-1 text-xl font-bold text-[#e5e4e2]"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleUpdateDatabaseName();
                    if (e.key === 'Escape') setEditingDatabaseName(false);
                  }}
                />
                <button
                  onClick={handleUpdateDatabaseName}
                  className="rounded-lg bg-[#d3bb73] p-2 text-[#1c1f33] hover:bg-[#d3bb73]/90"
                >
                  <Save className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    setEditingDatabaseName(false);
                    setDatabaseName(database.name);
                  }}
                  className="rounded-lg p-2 text-[#e5e4e2]/60 hover:bg-[#0f1119]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <h1 className="text-2xl font-bold text-[#e5e4e2]">{database.name}</h1>
            )}
          </div>
          <ResponsiveActionBar actions={actions} />
        </div>
        {database.description && (
          <p className="mt-2 text-sm text-[#e5e4e2]/60">{database.description}</p>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="min-w-full overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 w-12 border border-[#d3bb73]/20 bg-[#1c1f33] p-2">
                  <span className="text-xs font-medium text-[#e5e4e2]/60">#</span>
                </th>
                {columns.map((column) => (
                  <th
                    key={column.id}
                    className="min-w-[200px] border border-[#d3bb73]/20 bg-[#1c1f33] p-2"
                  >
                    {editingColumnId === column.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={columnName}
                          onChange={(e) => setColumnName(e.target.value)}
                          className="flex-1 rounded border border-[#d3bb73]/20 bg-[#0f1119] px-2 py-1 text-sm text-[#e5e4e2]"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleUpdateColumn(column.id);
                            if (e.key === 'Escape') setEditingColumnId(null);
                          }}
                        />
                        <button
                          onClick={() => handleUpdateColumn(column.id)}
                          className="rounded bg-[#d3bb73] p-1 text-[#1c1f33]"
                        >
                          <Save className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => setEditingColumnId(null)}
                          className="rounded p-1 text-[#e5e4e2]/60"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <GripVertical className="h-4 w-4 text-[#e5e4e2]/40" />
                          <span className="font-medium text-[#e5e4e2]">{column.name}</span>
                          <span className="text-xs text-[#e5e4e2]/40">({column.column_type})</span>
                        </div>
                        {canManage && (
                          <div className="flex gap-1">
                            <button
                              onClick={() => {
                                setEditingColumnId(column.id);
                                setColumnName(column.name);
                              }}
                              className="rounded p-1 text-[#e5e4e2]/60 hover:bg-[#0f1119] hover:text-[#e5e4e2]"
                            >
                              <Edit2 className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => handleDeleteColumn(column.id, column.name)}
                              className="rounded p-1 text-[#e5e4e2]/60 hover:bg-red-500/10 hover:text-red-400"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </th>
                ))}
                {canManage && (
                  <th className="border border-[#d3bb73]/20 bg-[#1c1f33] p-2">
                    {isAddingColumn ? (
                      <div className="flex flex-col gap-2">
                        <input
                          type="text"
                          value={newColumnName}
                          onChange={(e) => setNewColumnName(e.target.value)}
                          placeholder="Nazwa kolumny"
                          className="rounded border border-[#d3bb73]/20 bg-[#0f1119] px-2 py-1 text-sm text-[#e5e4e2]"
                          autoFocus
                        />
                        <select
                          value={newColumnType}
                          onChange={(e) => setNewColumnType(e.target.value as any)}
                          className="rounded border border-[#d3bb73]/20 bg-[#0f1119] px-2 py-1 text-sm text-[#e5e4e2]"
                        >
                          <option value="text">Tekst</option>
                          <option value="number">Liczba</option>
                          <option value="date">Data</option>
                          <option value="boolean">Tak/Nie</option>
                        </select>
                        <div className="flex gap-1">
                          <button
                            onClick={handleAddColumn}
                            className="flex-1 rounded bg-[#d3bb73] px-2 py-1 text-xs text-[#1c1f33]"
                          >
                            Dodaj
                          </button>
                          <button
                            onClick={() => {
                              setIsAddingColumn(false);
                              setNewColumnName('');
                              setNewColumnType('text');
                            }}
                            className="rounded px-2 py-1 text-xs text-[#e5e4e2]/60"
                          >
                            Anuluj
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setIsAddingColumn(true)}
                        className="flex w-full items-center justify-center gap-1 rounded p-1 text-[#e5e4e2]/60 hover:bg-[#0f1119] hover:text-[#e5e4e2]"
                      >
                        <Plus className="h-4 w-4" />
                        <span className="text-xs">Kolumna</span>
                      </button>
                    )}
                  </th>
                )}
                {canManage && (
                  <th className="sticky right-0 z-10 w-12 border border-[#d3bb73]/20 bg-[#1c1f33] p-2">
                    <span className="text-xs font-medium text-[#e5e4e2]/60">Akcje</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {records.map((record, index) => (
                <tr key={record.id} className="hover:bg-[#1c1f33]/50">
                  <td className="sticky left-0 z-10 border border-[#d3bb73]/20 bg-[#0f1119] p-2 text-center text-sm text-[#e5e4e2]/60">
                    {index + 1}
                  </td>
                  {columns.map((column) => {
                    const isEditing =
                      editingCell?.recordId === record.id && editingCell?.columnId === column.id;
                    const value = record.data[column.id] || '';

                    return (
                      <td
                        key={column.id}
                        className="border border-[#d3bb73]/20 bg-[#0f1119] p-0"
                        onClick={() => {
                          if (canManage && !isEditing) {
                            setEditingCell({ recordId: record.id, columnId: column.id });
                          }
                        }}
                      >
                        {isEditing ? (
                          <input
                            type={
                              column.column_type === 'number'
                                ? 'number'
                                : column.column_type === 'date'
                                  ? 'date'
                                  : 'text'
                            }
                            defaultValue={value}
                            className="w-full border-none bg-[#1c1f33] px-2 py-2 text-sm text-[#e5e4e2] focus:outline-none focus:ring-2 focus:ring-[#d3bb73]"
                            autoFocus
                            onBlur={(e) => handleUpdateCell(record.id, column.id, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleUpdateCell(record.id, column.id, e.currentTarget.value);
                              }
                              if (e.key === 'Escape') {
                                setEditingCell(null);
                              }
                            }}
                          />
                        ) : (
                          <div className="min-h-[40px] cursor-pointer px-2 py-2 text-sm text-[#e5e4e2]">
                            {column.column_type === 'boolean'
                              ? value
                                ? 'Tak'
                                : 'Nie'
                              : String(value || '')}
                          </div>
                        )}
                      </td>
                    );
                  })}
                  {canManage && <td className="border border-[#d3bb73]/20 bg-[#0f1119]"></td>}
                  {canManage && (
                    <td className="sticky right-0 z-10 border border-[#d3bb73]/20 bg-[#0f1119] p-2 text-center">
                      <button
                        onClick={() => handleDeleteRecord(record.id)}
                        className="rounded p-1 text-[#e5e4e2]/60 hover:bg-red-500/10 hover:text-red-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {canManage && (
          <button
            onClick={handleAddRecord}
            className="mt-4 flex items-center gap-2 rounded-lg border border-dashed border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]/60 transition-colors hover:border-[#d3bb73]/40 hover:text-[#e5e4e2]"
          >
            <Plus className="h-4 w-4" />
            Dodaj rekord
          </button>
        )}

        {columns.length === 0 && (
          <div className="mt-8 text-center">
            <p className="mb-4 text-[#e5e4e2]/60">
              Brak kolumn. Dodaj pierwszą kolumnę aby rozpocząć.
            </p>
          </div>
        )}

        {columns.length > 0 && records.length === 0 && (
          <div className="mt-8 text-center">
            <p className="mb-4 text-[#e5e4e2]/60">
              Brak rekordów. Dodaj pierwszy rekord aby rozpocząć.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
