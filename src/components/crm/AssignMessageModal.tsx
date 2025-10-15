'use client';

import { useState, useEffect } from 'react';
import { X, User, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

interface Employee {
  id: string;
  name: string;
  surname: string;
  email: string;
  avatar_url: string | null;
}

interface AssignMessageModalProps {
  messageId: string;
  messageType: 'contact_form' | 'received';
  currentAssignee?: string | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AssignMessageModal({
  messageId,
  messageType,
  currentAssignee,
  onClose,
  onSuccess,
}: AssignMessageModalProps) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(currentAssignee || null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { showSnackbar } = useSnackbar();
  const { employee: currentEmployee } = useCurrentEmployee();

  useEffect(() => {
    fetchEmployees();
  }, []);

  const fetchEmployees = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('id, name, surname, email, avatar_url, permissions, role')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;

      const filteredEmployees = (data || []).filter((emp) => {
        return (
          emp.role === 'admin' ||
          (emp.permissions && (
            emp.permissions.includes('messages_view') ||
            emp.permissions.includes('messages_manage')
          ))
        );
      });

      setEmployees(filteredEmployees);
    } catch (err) {
      console.error('Error fetching employees:', err);
      showSnackbar('Błąd podczas ładowania pracowników', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAssign = async () => {
    if (!selectedEmployee) {
      showSnackbar('Wybierz pracownika', 'warning');
      return;
    }

    setSaving(true);
    try {
      const tableName = messageType === 'contact_form' ? 'contact_messages' : 'received_emails';

      const { error } = await supabase
        .from(tableName)
        .update({
          assigned_to: selectedEmployee,
          assigned_at: new Date().toISOString(),
          assigned_by: currentEmployee?.id || null,
        })
        .eq('id', messageId);

      if (error) throw error;

      showSnackbar('Wiadomość została przypisana', 'success');
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Error assigning message:', err);
      showSnackbar('Błąd podczas przypisywania wiadomości', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleUnassign = async () => {
    setSaving(true);
    try {
      const tableName = messageType === 'contact_form' ? 'contact_messages' : 'received_emails';

      const { error } = await supabase
        .from(tableName)
        .update({
          assigned_to: null,
          assigned_at: null,
          assigned_by: null,
        })
        .eq('id', messageId);

      if (error) throw error;

      showSnackbar('Przypisanie zostało usunięte', 'success');
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Error unassigning message:', err);
      showSnackbar('Błąd podczas usuwania przypisania', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#1c1f33] rounded-xl shadow-2xl max-w-md w-full border border-[#d3bb73]/20">
        <div className="p-6 border-b border-[#d3bb73]/10">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-[#e5e4e2]">Przypisz wiadomość</h2>
            <button
              onClick={onClose}
              className="text-[#e5e4e2]/60 hover:text-[#e5e4e2] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="text-center py-8 text-[#e5e4e2]/60">Ładowanie...</div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {employees.map((employee) => (
                <button
                  key={employee.id}
                  onClick={() => setSelectedEmployee(employee.id)}
                  className={`w-full p-3 rounded-lg border transition-all flex items-center gap-3 ${
                    selectedEmployee === employee.id
                      ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                      : 'border-[#d3bb73]/20 hover:border-[#d3bb73]/40 hover:bg-[#0f1119]'
                  }`}
                >
                  <div className="w-10 h-10 rounded-full bg-[#d3bb73]/20 flex items-center justify-center flex-shrink-0">
                    {employee.avatar_url ? (
                      <img
                        src={employee.avatar_url}
                        alt={employee.name}
                        className="w-full h-full rounded-full object-cover"
                      />
                    ) : (
                      <User className="w-5 h-5 text-[#d3bb73]" />
                    )}
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-[#e5e4e2] font-medium">
                      {employee.name} {employee.surname}
                    </div>
                    <div className="text-sm text-[#e5e4e2]/60">{employee.email}</div>
                  </div>
                  {selectedEmployee === employee.id && (
                    <Check className="w-5 h-5 text-[#d3bb73]" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-[#d3bb73]/10 flex gap-3">
          {currentAssignee && (
            <button
              onClick={handleUnassign}
              disabled={saving}
              className="flex-1 px-4 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Usuń przypisanie
            </button>
          )}
          <button
            onClick={handleAssign}
            disabled={!selectedEmployee || saving}
            className="flex-1 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#c5ad65] transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {saving ? 'Przypisywanie...' : 'Przypisz'}
          </button>
        </div>
      </div>
    </div>
  );
}
