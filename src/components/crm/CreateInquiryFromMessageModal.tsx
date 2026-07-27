'use client';

import { useState, useEffect } from 'react';
import { X, User, ClipboardList } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { supabase } from '@/lib/supabase/browser';
import type { MessageListItem } from '@/lib/CRM/messages/types';

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
  onSuccess: () => void;
}

export default function CreateInquiryFromMessageModal({
  message,
  userId,
  onClose,
  onSuccess,
}: CreateInquiryFromMessageModalProps) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { showSnackbar } = useSnackbar();

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
    setSaving(true);
    try {
      const title = `Zapytanie: ${message.subject || 'Brak tematu'}`;

      let body = '';
      let messageDate: string | null = null;
      let senderName: string | null = null;
      let senderEmail: string | null = message.from || null;
      let senderPhone: string | null = null;

      if (message.type === 'received') {
        const { data: fullMsg, error: fullMsgError } = await supabase
          .from('received_emails')
          .select(
            `
            body_text,
            body_html,
            from_address,
            received_date
          `,
          )
          .eq('id', message.id)
          .maybeSingle();

        if (fullMsgError) {
          throw fullMsgError;
        }

        body = fullMsg?.body_text || fullMsg?.body_html || message.preview || '';

        messageDate = fullMsg?.received_date || null;
        senderEmail = fullMsg?.from_address || message.from || null;
        senderName = null;
      }

      if (message.type === 'contact_form') {
        const { data: fullMsg, error: fullMsgError } = await supabase
          .from('contact_messages')
          .select(
            `
            message,
            email,
            name,
            phone,
            created_at
          `,
          )
          .eq('id', message.id)
          .maybeSingle();

        if (fullMsgError) {
          throw fullMsgError;
        }

        body = fullMsg?.message || message.preview || '';

        messageDate = fullMsg?.created_at || null;
        senderName = fullMsg?.name || null;
        senderEmail = fullMsg?.email || message.from || null;
        senderPhone = fullMsg?.phone || null;
      }

      if (message.type === 'contact_form') {
        const { data: fullMsg, error: fullMsgError } = await supabase
          .from('contact_messages')
          .select(
            `
            message,
            email,
            name,
            phone,
            created_at
          `,
          )
          .eq('id', message.id)
          .maybeSingle();

        if (fullMsgError) {
          throw fullMsgError;
        }

        body = fullMsg?.message || message.preview || '';

        messageDate = fullMsg?.created_at || null;
        senderName = fullMsg?.name || null;
        senderEmail = fullMsg?.email || message.from || null;
        senderPhone = fullMsg?.phone || null;
      }

      const inquiryDetails = {
        client_email: senderEmail,
        client_text: senderName || senderEmail,
        client_phone: senderPhone,
        source_message_id: message.id,
        source_message_type: message.type,
        source_message_date: messageDate,
        source_message_content: body || null,
      };
      const formattedMessageDate = messageDate
        ? new Intl.DateTimeFormat('pl-PL', {
            dateStyle: 'long',
            timeStyle: 'short',
          }).format(new Date(messageDate))
        : 'Brak daty';

      const taskDescription = [
        `Data wiadomości: ${formattedMessageDate}`,
        senderName ? `Nadawca: ${senderName}` : null,
        senderEmail ? `E-mail: ${senderEmail}` : null,
        senderPhone ? `Telefon: ${senderPhone}` : null,
        '',
        'Treść wiadomości:',
        body || 'Brak treści wiadomości',
      ]
        .filter((line): line is string => line !== null)
        .join('\n');

      const { data: taskData, error: taskError } = await supabase
        .from('tasks')
        .insert({
          title,
          description: taskDescription.slice(0, 10000),
          priority: 'urgent',
          status: 'todo',
          board_column: 'todo',
          order_index: 0,
          created_by: userId,
          is_inquiry: true,
          inquiry_details: inquiryDetails,
        })
        .select('id')
        .single();

      if (taskError) throw taskError;

      if (selectedEmployee && taskData) {
        const { error: assignError } = await supabase.from('task_assignees').insert({
          task_id: taskData.id,
          employee_id: selectedEmployee,
        });

        if (assignError) {
          console.error('Error assigning employee:', assignError);
        }

        const emp = employees.find((e) => e.id === selectedEmployee);
        const empUserId = emp?.auth_user_id;

        if (empUserId) {
          const { data: notif, error: notifError } = await supabase
            .from('notifications')
            .insert({
              title: 'Nowe zapytanie',
              message: `Przypisano Cię do zapytania: "${message.subject || 'Brak tematu'}"`,
              type: 'info',
              category: 'tasks',
              related_entity_type: 'task',
              related_entity_id: taskData.id,
              action_url: `/crm/tasks/${taskData.id}`,
              metadata: { is_inquiry: true },
            })
            .select('id')
            .single();

          if (!notifError && notif) {
            await supabase.from('notification_recipients').insert({
              notification_id: notif.id,
              user_id: empUserId,
              is_read: false,
            });
          }
        }
      }

      showSnackbar('Utworzono zapytanie z wiadomości', 'success');
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Error creating inquiry from message:', err);
      showSnackbar('Nie udało się utworzyć zapytania', 'error');
    } finally {
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
            <h2 className="text-lg font-semibold text-[#e5e4e2]">Dodaj zapytanie</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-white/5 hover:text-[#e5e4e2]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="rounded-lg bg-[#1c1f33] p-3">
            <p className="mb-1 text-xs text-[#e5e4e2]/50">Tytuł zapytania</p>
            <p className="text-sm text-[#e5e4e2]">Zapytanie: {message.subject || 'Brak tematu'}</p>
          </div>

          <div className="rounded-lg bg-[#1c1f33] p-3">
            <p className="mb-1 text-xs text-[#e5e4e2]/50">Nadawca</p>
            <p className="text-sm text-[#e5e4e2]">{message.from || '—'}</p>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-[#e5e4e2]/70">
              Przypisz pracownika (opcjonalnie)
            </p>
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#d3bb73]/30 border-t-[#d3bb73]" />
              </div>
            ) : (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-[#d3bb73]/10 p-2">
                <button
                  onClick={() => setSelectedEmployee(null)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                    selectedEmployee === null
                      ? 'bg-[#d3bb73]/10 text-[#d3bb73]'
                      : 'text-[#e5e4e2]/70 hover:bg-white/5'
                  }`}
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1c1f33]">
                    <X className="h-4 w-4" />
                  </div>
                  <span className="text-sm">Bez przypisania</span>
                </button>
                {employees.map((emp) => (
                  <button
                    key={emp.id}
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
            disabled={saving}
            className="rounded-lg bg-[#d3bb73] px-5 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#c5ad65] disabled:opacity-50"
          >
            {saving ? 'Tworzenie...' : 'Utwórz zapytanie'}
          </button>
        </div>
      </div>
    </div>
  );
}
