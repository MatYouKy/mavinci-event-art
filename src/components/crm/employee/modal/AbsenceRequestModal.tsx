'use client';

import React, { useState, useEffect } from 'react';
import { X, CheckCircle, XCircle, Calendar, Clock, User, FileText } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

interface AbsenceRequestModalProps {
  absenceId: string;
  onClose: () => void;
  onSuccess?: () => void;
}

interface Absence {
  id: string;
  employee_id: string;
  absence_type: string;
  start_date: string;
  end_date: string;
  all_day: boolean;
  approval_status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  notes: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

interface Employee {
  id: string;
  name: string;
  surname: string;
  position: string | null;
}

export const AbsenceRequestModal: React.FC<AbsenceRequestModalProps> = ({
  absenceId,
  onClose,
  onSuccess,
}) => {
  const [absence, setAbsence] = useState<Absence | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const { showSnackbar } = useSnackbar();
  const { employee: currentEmployee } = useCurrentEmployee();

  const isAdmin =
    currentEmployee?.permissions?.includes('admin') ||
    currentEmployee?.permissions?.includes('employees_manage');

  useEffect(() => {
    fetchAbsenceDetails();
  }, [absenceId]);

  const fetchAbsenceDetails = async () => {
    setLoading(true);
    try {
      const { data: absenceData, error: absenceError } = await supabase
        .from('employee_absences')
        .select('*')
        .eq('id', absenceId)
        .single();

      if (absenceError) throw absenceError;

      const { data: employeeData, error: employeeError } = await supabase
        .from('employees')
        .select('id, name, surname, position')
        .eq('id', absenceData.employee_id)
        .single();

      if (employeeError) throw employeeError;

      setAbsence(absenceData);
      setEmployee(employeeData);
    } catch (error) {
      console.error('Error fetching absence details:', error);
      showSnackbar('Błąd podczas ładowania danych', 'error');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!currentEmployee?.id) return;

    setProcessing(true);
    try {
      const { data, error } = await supabase.rpc('approve_absence', {
        p_absence_id: absenceId,
        p_approver_id: currentEmployee.id,
        p_notes: notes || null,
      });

      if (error) throw error;

      const result = data as { success: boolean; message?: string; error?: string };
      if (result.success) {
        showSnackbar('Nieobecność zatwierdzona', 'success');
        onSuccess?.();
        onClose();
      } else {
        showSnackbar(result.error || 'Błąd podczas zatwierdzania', 'error');
      }
    } catch (error) {
      console.error('Error approving absence:', error);
      showSnackbar('Błąd podczas zatwierdzania', 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!currentEmployee?.id) return;

    setProcessing(true);
    try {
      const { data, error } = await supabase.rpc('reject_absence', {
        p_absence_id: absenceId,
        p_rejector_id: currentEmployee.id,
        p_reason: reason,
      });

      if (error) throw error;

      const result = data as { success: boolean; message?: string; error?: string };
      if (result.success) {
        showSnackbar('Nieobecność odrzucona', 'success');
        onSuccess?.();
        onClose();
      } else {
        showSnackbar(result.error || 'Błąd podczas odrzucania', 'error');
      }
    } catch (error) {
      console.error('Error rejecting absence:', error);
      showSnackbar('Błąd podczas odrzucania', 'error');
    } finally {
      setProcessing(false);
    }
  };

  const getAbsenceTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      vacation: 'Urlop wypoczynkowy',
      sick_leave: 'Zwolnienie lekarskie',
      unpaid_leave: 'Urlop bezpłatny',
      training: 'Szkolenie',
      remote_work: 'Praca zdalna',
      other: 'Inne',
    };
    return labels[type] || type;
  };

  const getAbsenceTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      vacation: '#10b981',
      sick_leave: '#ef4444',
      unpaid_leave: '#6b7280',
      training: '#06b6d4',
      remote_work: '#14b8a6',
      other: '#8b5cf6',
    };
    return colors[type] || '#3b82f6';
  };

  const formatDate = (dateString: string, includeTime: boolean = true) => {
    const date = new Date(dateString);
    if (includeTime) {
      return date.toLocaleDateString('pl-PL', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
    return date.toLocaleDateString('pl-PL', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  const calculateDuration = (start: string, end: string) => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const diff = endDate.getTime() - startDate.getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24)) + 1;
    return days;
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className="w-full max-w-2xl rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-[#d3bb73] border-t-transparent" />
              <p className="text-[#e5e4e2]/60">Ładowanie...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!absence || !employee) {
    return null;
  }

  const canApprove = isAdmin && absence.approval_status === 'pending';
  const duration = calculateDuration(absence.start_date, absence.end_date);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6 shadow-xl">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-light text-[#e5e4e2]">Wniosek o nieobecność</h2>
            <p className="mt-1 text-sm text-[#e5e4e2]/60">
              {absence.approval_status === 'pending' ? 'Oczekuje na zatwierdzenie' : 'Szczegóły nieobecności'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-2 text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Employee Info */}
        <div className="mb-6 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#d3bb73]/20 text-[#d3bb73]">
              <User className="h-6 w-6" />
            </div>
            <div>
              <p className="font-medium text-[#e5e4e2]">
                {employee.name} {employee.surname}
              </p>
              {employee.position && <p className="text-sm text-[#e5e4e2]/60">{employee.position}</p>}
            </div>
          </div>
        </div>

        {/* Absence Details */}
        <div className="mb-6 space-y-4">
          {/* Type */}
          <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-4">
            <div className="flex items-center gap-3">
              <div
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: getAbsenceTypeColor(absence.absence_type) }}
              />
              <div className="flex-1">
                <p className="text-sm text-[#e5e4e2]/60">Typ nieobecności</p>
                <p className="font-medium text-[#e5e4e2]">{getAbsenceTypeLabel(absence.absence_type)}</p>
              </div>
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-4">
              <div className="flex items-start gap-3">
                <Calendar className="h-5 w-5 text-[#d3bb73]" />
                <div>
                  <p className="text-sm text-[#e5e4e2]/60">Od</p>
                  <p className="font-medium text-[#e5e4e2]">
                    {formatDate(absence.start_date, !absence.all_day)}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-4">
              <div className="flex items-start gap-3">
                <Calendar className="h-5 w-5 text-[#d3bb73]" />
                <div>
                  <p className="text-sm text-[#e5e4e2]/60">Do</p>
                  <p className="font-medium text-[#e5e4e2]">{formatDate(absence.end_date, !absence.all_day)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Duration */}
          <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-4">
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-[#d3bb73]" />
              <div>
                <p className="text-sm text-[#e5e4e2]/60">Czas trwania</p>
                <p className="font-medium text-[#e5e4e2]">
                  {duration} {duration === 1 ? 'dzień' : duration < 5 ? 'dni' : 'dni'}
                  {absence.all_day && ' (cały dzień)'}
                </p>
              </div>
            </div>
          </div>

          {/* Existing Notes */}
          {absence.notes && (
            <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-4">
              <div className="flex items-start gap-3">
                <FileText className="h-5 w-5 text-[#d3bb73]" />
                <div className="flex-1">
                  <p className="text-sm text-[#e5e4e2]/60">Notatki</p>
                  <p className="mt-1 text-[#e5e4e2]">{absence.notes}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Actions for Admin */}
        {canApprove && (
          <div className="space-y-4">
            <div className="h-px bg-[#d3bb73]/10" />

            {/* Approval Notes */}
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                Notatka do zatwierdzenia (opcjonalnie)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Dodaj notatkę..."
                rows={3}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-3 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none focus:ring-1 focus:ring-[#d3bb73]"
              />
            </div>

            {/* Rejection Reason */}
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                Powód odrzucenia (opcjonalnie)
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Opcjonalnie podaj powód odrzucenia..."
                rows={3}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-3 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none focus:ring-1 focus:ring-[#d3bb73]"
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={handleApprove}
                disabled={processing}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-3 text-white transition-colors hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CheckCircle className="h-5 w-5" />
                {processing ? 'Zatwierdzanie...' : 'Zatwierdź'}
              </button>

              <button
                onClick={handleReject}
                disabled={processing}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-3 text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <XCircle className="h-5 w-5" />
                {processing ? 'Odrzucanie...' : 'Odrzuć'}
              </button>
            </div>
          </div>
        )}

        {/* Close button for non-admins or already processed */}
        {!canApprove && (
          <div className="mt-6 flex justify-end">
            <button
              onClick={onClose}
              className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-6 py-2 text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10"
            >
              Zamknij
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
