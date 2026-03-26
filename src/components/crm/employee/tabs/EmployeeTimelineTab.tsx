'use client';

import React, { useState, useEffect } from 'react';
import { Plus, Calendar, CheckCircle, XCircle, Clock, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { AddAbsenceModal } from '../modal/AddAbsenceModal';

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

interface EmployeeTimelineTabProps {
  employeeId: string;
  canEdit: boolean;
}

const EmployeeTimelineTab: React.FC<EmployeeTimelineTabProps> = ({ employeeId, canEdit }) => {
  const [absences, setAbsences] = useState<Absence[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const { showSnackbar } = useSnackbar();
  const { employee: currentEmployee } = useCurrentEmployee();

  const isAdmin = currentEmployee?.permissions?.includes('admin') ||
                  currentEmployee?.permissions?.includes('employees_manage');
  const isOwnProfile = currentEmployee?.id === employeeId;

  useEffect(() => {
    fetchAbsences();
  }, [employeeId]);

  const fetchAbsences = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('employee_absences')
        .select('*')
        .eq('employee_id', employeeId)
        .order('start_date', { ascending: false });

      if (error) throw error;
      setAbsences(data || []);
    } catch (error) {
      console.error('Error fetching absences:', error);
      showSnackbar('Błąd podczas ładowania nieobecności', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (absenceId: string) => {
    const notes = prompt('Dodaj notatkę do zatwierdzenia (opcjonalnie):');
    if (notes === null) return; // User cancelled

    try {
      const { data, error } = await supabase.rpc('approve_absence', {
        p_absence_id: absenceId,
        p_approver_id: currentEmployee?.id,
        p_notes: notes || null,
      });

      if (error) throw error;

      const result = data as { success: boolean; message?: string; error?: string };
      if (result.success) {
        showSnackbar('Nieobecność zatwierdzona', 'success');
        fetchAbsences();
      } else {
        showSnackbar(result.error || 'Błąd podczas zatwierdzania', 'error');
      }
    } catch (error) {
      console.error('Error approving absence:', error);
      showSnackbar('Błąd podczas zatwierdzania', 'error');
    }
  };

  const handleReject = async (absenceId: string) => {
    const reason = prompt('Podaj powód odrzucenia:');
    if (!reason) {
      showSnackbar('Powód odrzucenia jest wymagany', 'warning');
      return;
    }

    try {
      const { data, error } = await supabase.rpc('reject_absence', {
        p_absence_id: absenceId,
        p_rejector_id: currentEmployee?.id,
        p_reason: reason,
      });

      if (error) throw error;

      const result = data as { success: boolean; message?: string; error?: string };
      if (result.success) {
        showSnackbar('Nieobecność odrzucona', 'success');
        fetchAbsences();
      } else {
        showSnackbar(result.error || 'Błąd podczas odrzucania', 'error');
      }
    } catch (error) {
      console.error('Error rejecting absence:', error);
      showSnackbar('Błąd podczas odrzucania', 'error');
    }
  };

  const handleDelete = async (absenceId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tę nieobecność?')) return;

    try {
      const { error } = await supabase
        .from('employee_absences')
        .delete()
        .eq('id', absenceId);

      if (error) throw error;
      showSnackbar('Nieobecność usunięta', 'success');
      fetchAbsences();
    } catch (error) {
      console.error('Error deleting absence:', error);
      showSnackbar('Błąd podczas usuwania', 'error');
    }
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      pending: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      approved: 'bg-green-500/20 text-green-400 border-green-500/30',
      rejected: 'bg-red-500/20 text-red-400 border-red-500/30',
      cancelled: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    };

    const labels = {
      pending: 'Oczekuje',
      approved: 'Zatwierdzona',
      rejected: 'Odrzucona',
      cancelled: 'Anulowana',
    };

    return (
      <span className={`rounded-full border px-3 py-1 text-xs font-medium ${styles[status as keyof typeof styles]}`}>
        {labels[status as keyof typeof labels]}
      </span>
    );
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

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('pl-PL', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDateShort = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('pl-PL', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const calculateDuration = (start: string, end: string) => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const diff = endDate.getTime() - startDate.getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return days;
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-[#d3bb73] border-t-transparent" />
          <p className="text-[#e5e4e2]/60">Ładowanie...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        <div>
          <h3 className="text-lg font-light text-[#e5e4e2]">Nieobecności</h3>
          <p className="mt-1 text-sm text-[#e5e4e2]/60">
            Zarządzaj urlopami i nieobecnościami pracownika
          </p>
        </div>
        {(isOwnProfile || canEdit) && (
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            <Plus className="h-4 w-4" />
            Dodaj nieobecność
          </button>
        )}
      </div>

      {absences.length === 0 ? (
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-12 text-center">
          <Calendar className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
          <p className="text-[#e5e4e2]/60">Brak zaplanowanych nieobecności</p>
        </div>
      ) : (
        <div className="space-y-4">
          {absences.map((absence) => {
            const duration = calculateDuration(absence.start_date, absence.end_date);
            const canApprove = isAdmin && absence.approval_status === 'pending';
            const canDelete = (isOwnProfile && absence.approval_status === 'pending') || isAdmin;

            return (
              <div
                key={absence.id}
                className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6 transition-colors hover:border-[#d3bb73]/20"
              >
                <div className="flex items-start justify-between">
                  <div className="flex gap-4">
                    <div
                      className="mt-1 h-12 w-1 rounded"
                      style={{ backgroundColor: getAbsenceTypeColor(absence.absence_type) }}
                    />
                    <div className="flex-1">
                      <div className="mb-2 flex items-center gap-3">
                        <h4 className="text-lg font-medium text-[#e5e4e2]">
                          {getAbsenceTypeLabel(absence.absence_type)}
                        </h4>
                        {getStatusBadge(absence.approval_status)}
                      </div>
                      <div className="space-y-2 text-sm text-[#e5e4e2]/70">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4" />
                          <span>
                            {formatDateShort(absence.start_date)} - {formatDateShort(absence.end_date)}
                          </span>
                          <span className="text-[#e5e4e2]/50">({duration} {duration === 1 ? 'dzień' : 'dni'})</span>
                        </div>
                        {absence.all_day && (
                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4" />
                            <span>Cały dzień</span>
                          </div>
                        )}
                        {absence.notes && (
                          <div className="mt-2 rounded-lg bg-[#0f1119] p-3">
                            <p className="text-sm text-[#e5e4e2]/80">{absence.notes}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {canApprove && (
                      <>
                        <button
                          onClick={() => handleApprove(absence.id)}
                          className="rounded-lg bg-green-500/20 p-2 text-green-400 transition-colors hover:bg-green-500/30"
                          title="Zatwierdź"
                        >
                          <CheckCircle className="h-5 w-5" />
                        </button>
                        <button
                          onClick={() => handleReject(absence.id)}
                          className="rounded-lg bg-red-500/20 p-2 text-red-400 transition-colors hover:bg-red-500/30"
                          title="Odrzuć"
                        >
                          <XCircle className="h-5 w-5" />
                        </button>
                      </>
                    )}
                    {canDelete && (
                      <button
                        onClick={() => handleDelete(absence.id)}
                        className="rounded-lg bg-red-500/20 p-2 text-red-400 transition-colors hover:bg-red-500/30"
                        title="Usuń"
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAddModal && (
        <AddAbsenceModal
          employeeId={employeeId}
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
            fetchAbsences();
          }}
        />
      )}
    </div>
  );
};

export default EmployeeTimelineTab;
