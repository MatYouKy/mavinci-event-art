'use client';

import { LinkEmailToInquiry } from '@/components/crm/inquiries/InquiryCorrespondencePanel';
import { formatSystemSubject } from '@/lib/ui/systemLabels';

import { useState, useEffect, useRef } from 'react';
import { X, User, ClipboardList } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { supabase } from '@/lib/supabase/browser';
import type { MessageListItem } from '@/store/api/messagesApi';
import { canClaimMessageInquiry, messageInquirySaveFeedback } from '@/lib/CRM/messages/salesContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

interface Employee {
  id: string;
  auth_user_id: string | null;
  name: string;
  surname: string;
  avatar_url: string | null;
}

interface CreateInquiryFromMessageModalProps {
  message: MessageListItem;
  userId: string;
  onClose: () => void;
  onSuccess: (inquiryId: string) => void;
}

export default function CreateInquiryFromMessageModal({
  message,
  userId,
  onClose,
  onSuccess,
}: CreateInquiryFromMessageModalProps) {
  const { employee } = useCurrentEmployee();
  const saveLock = useRef(false);
  const [mode, setMode] = useState<'create' | 'link'>('create');
  const canLinkEmail = message.type === 'received' || message.type === 'sent';
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [guestCount, setGuestCount] = useState('');
  const [saving, setSaving] = useState(false);
  const { showSnackbar } = useSnackbar();

  useEffect(() => { if (employee?.id) setSelectedEmployee(employee.id); }, [employee?.id]);

  useEffect(() => {
    fetchEmployees();
  }, []);

  const fetchEmployees = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('id, auth_user_id, name, surname, avatar_url')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setEmployees(data || []);
    } catch (err) {
      console.error('Error fetching employees:', err);
      showSnackbar('Błąd podczas ładowania pracowników', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (guestCount !== '' && (!Number.isInteger(Number(guestCount)) || Number(guestCount) < 1 || Number(guestCount) > 100000)) { showSnackbar('Podaj całkowitą liczbę osób od 1 do 100 000 lub zostaw pole puste.', 'error'); return; }
    if (saveLock.current || !selectedEmployee) return;
    saveLock.current = true;
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('crm_create_inquiry_from_message', {
        p_type: message.type, p_id: message.id, p_owner: selectedEmployee,
        p_guest_count: guestCount === '' ? null : Number(guestCount),
      });
      if (error) throw error;
      if (!data?.id) throw new Error('Serwer nie potwierdził zapisu zapytania.');
      const taskData = { id: data.id };
      showSnackbar(messageInquirySaveFeedback(data, selectedEmployee), data.ownerId === selectedEmployee ? 'success' : 'warning');
      onSuccess(taskData.id);
      onClose();
    } catch (err) {
      console.error('Error creating inquiry from message:', err);
      showSnackbar((err as { message?: string })?.message || 'Nie udało się utworzyć zapytania', 'error');
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-[#0f1119] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-[#d3bb73]/10 p-2">
              <ClipboardList className="h-5 w-5 text-[#d3bb73]" />
            </div>
            <h2 className="text-lg font-semibold text-[#e5e4e2]">{canClaimMessageInquiry(message.sales) ? 'Przypisz zapytanie' : 'Dodaj zapytanie'}</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-white/5 hover:text-[#e5e4e2]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {canLinkEmail && <div className="flex gap-2 px-5 pt-4">
          <button type="button" disabled={saving} onClick={() => setMode('create')} className={`rounded-lg px-3 py-2 text-sm ${mode === 'create' ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'text-white/60'}`}>Nowe zapytanie</button>
          <button type="button" disabled={saving} onClick={() => setMode('link')} className={`rounded-lg px-3 py-2 text-sm ${mode === 'link' ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'text-white/60'}`}>Dołącz do istniejącego zapytania</button>
        </div>}
        {mode === 'link' && canLinkEmail ? <LinkEmailToInquiry message={message} onSuccess={id => {
          showSnackbar('Konwersacja została powiązana z zapytaniem.', 'success'); onSuccess(id); onClose();
        }} /> : <>
        <div className="space-y-4 p-5">
          <label className="block text-sm text-white/65">Liczba osób — opcjonalnie<input type="number" min={1} max={100000} step={1} disabled={saving} value={guestCount} onChange={e => setGuestCount(e.target.value)} placeholder="Nie ustalono" className="mt-1 w-full rounded-lg border border-white/10 bg-black/15 p-2" /></label>
          <div className="rounded-lg bg-[#1c1f33] p-3">
            <p className="mb-1 text-xs text-[#e5e4e2]/50">Tytuł zapytania</p>
            <p className="text-sm text-[#e5e4e2]">Zapytanie: {formatSystemSubject(message.subject)}</p>
          </div>

          <div className="rounded-lg bg-[#1c1f33] p-3">
            <p className="mb-1 text-xs text-[#e5e4e2]/50">Nadawca</p>
            <p className="text-sm text-[#e5e4e2]">{message.from || '—'}</p>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-[#e5e4e2]/70">
              Opiekun zapytania
            </p>
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#d3bb73]/30 border-t-[#d3bb73]" />
              </div>
            ) : (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-[#d3bb73]/10 p-2">
                {employees.map((emp) => (
                  <button
                    key={emp.id}
                    disabled={saving}
                    onClick={() => setSelectedEmployee(emp.id)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                      selectedEmployee === emp.id
                        ? 'bg-[#d3bb73]/10 text-[#d3bb73]'
                        : 'text-[#e5e4e2]/70 hover:bg-white/5'
                    }`}
                  >
                    {emp.avatar_url ? (
                      <img
                        src={emp.avatar_url}
                        alt=""
                        className="h-8 w-8 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1c1f33]">
                        <User className="h-4 w-4 text-[#e5e4e2]/50" />
                      </div>
                    )}
                    <span className="text-sm">
                      {emp.name} {emp.surname}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-[#d3bb73]/10 p-5">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-[#e5e4e2]/70 transition-colors hover:bg-white/5"
          >
            Anuluj
          </button>
          <button
            onClick={handleCreate}
            disabled={saving || !selectedEmployee}
            className="rounded-lg bg-[#d3bb73] px-5 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#c5ad65] disabled:opacity-50"
          >
            {saving ? 'Zapisywanie…' : canClaimMessageInquiry(message.sales) ? (selectedEmployee === employee?.id ? 'Przypisz mnie' : 'Przypisz pracownika') : selectedEmployee === employee?.id ? 'Dodaj i przypisz mnie' : 'Dodaj i przypisz pracownika'}
          </button>
        </div>
        </>}
      </div>
    </div>
  );
}
