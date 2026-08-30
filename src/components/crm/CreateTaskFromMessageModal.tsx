'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, ListPlus, Loader2, UserRound, X } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { supabase } from '@/lib/supabase/browser';
import { sendTaskAssignmentPush } from '@/lib/CRM/tasks/sendTaskAssignmentPush';
import type { MessageDetails, MessageListItem } from '@/store/api/messagesApi';

interface EmployeeOption {
  id: string;
  name: string;
  surname: string;
}

interface CreateTaskFromMessageModalProps {
  message: MessageListItem | MessageDetails;
  createdBy: string;
  onClose: () => void;
  onSuccess: (taskId: string) => void;
}

const priorityOptions = [
  { value: 'low', label: 'Niski' },
  { value: 'medium', label: 'Normalny' },
  { value: 'high', label: 'Wysoki' },
  { value: 'urgent', label: 'Pilny' },
] as const;

const buildSourceUrl = (message: MessageListItem | MessageDetails) =>
  `/crm/messages/${message.id}?type=${message.type}`;

const buildInitialDescription = (message: MessageListItem | MessageDetails) => {
  const content = 'body' in message ? message.body : message.preview;
  const formattedDate = new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(message.date));

  return [
    `Wiadomość źródłowa: ${buildSourceUrl(message)}`,
    `Nadawca: ${message.from || 'Nieznany'}`,
    `Data wiadomości: ${formattedDate}`,
    `Temat wiadomości: ${message.subject || '(bez tematu)'}`,
    '',
    'Treść wiadomości:',
    content || 'Brak treści wiadomości',
  ]
    .join('\n')
    .slice(0, 10000);
};

export default function CreateTaskFromMessageModal({
  message,
  createdBy,
  onClose,
  onSuccess,
}: CreateTaskFromMessageModalProps) {
  const { showSnackbar } = useSnackbar();
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(`Obsłuż: ${message.subject || '(bez tematu)'}`);
  const [description, setDescription] = useState(() => buildInitialDescription(message));
  const [assigneeId, setAssigneeId] = useState(createdBy);
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<(typeof priorityOptions)[number]['value']>('high');

  const sourceUrl = useMemo(() => buildSourceUrl(message), [message]);

  useEffect(() => {
    let active = true;

    const loadEmployees = async () => {
      setLoadingEmployees(true);
      const { data, error } = await supabase
        .from('employees')
        .select('id, name, surname')
        .eq('is_active', true)
        .order('name');

      if (!active) return;
      if (error) {
        console.error('Error loading employees for message task:', error);
        showSnackbar('Nie udało się pobrać listy pracowników', 'error');
      } else {
        const options = (data || []) as EmployeeOption[];
        setEmployees(options);
        if (!options.some((employee) => employee.id === createdBy)) {
          setAssigneeId('');
        }
      }
      setLoadingEmployees(false);
    };

    void loadEmployees();
    return () => {
      active = false;
    };
  }, [createdBy, showSnackbar]);

  const handleCreate = async () => {
    if (!title.trim()) {
      showSnackbar('Podaj tytuł zadania', 'warning');
      return;
    }

    setSaving(true);
    try {
      const { data: task, error: taskError } = await supabase
        .from('tasks')
        .insert({
          title: title.trim(),
          description: description.trim() || `Wiadomość źródłowa: ${sourceUrl}`,
          priority,
          status: 'todo',
          board_column: 'todo',
          order_index: 0,
          due_date: dueDate ? new Date(dueDate).toISOString() : null,
          created_by: createdBy,
          assigned_to: assigneeId || null,
          owner_id: createdBy,
          is_private: false,
          is_inquiry: false,
        })
        .select('id')
        .single();

      if (taskError) throw taskError;

      if (assigneeId) {
        const { data: assignment, error: assignmentError } = await supabase
          .from('task_assignees')
          .insert({
            task_id: task.id,
            employee_id: assigneeId,
            assigned_by: createdBy,
          })
          .select('id')
          .single();

        if (assignmentError) throw assignmentError;

        try {
          await sendTaskAssignmentPush(assignment.id);
        } catch (pushError) {
          console.warn('Message task assignment push failed:', pushError);
        }
      }

      showSnackbar('Utworzono zadanie z wiadomości', 'success');
      onSuccess(task.id);
      onClose();
    } catch (error) {
      console.error('Error creating task from message:', error);
      showSnackbar('Nie udało się utworzyć zadania', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-[#d3bb73]/10 p-2 text-[#d3bb73]">
              <ListPlus className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#e5e4e2]">Utwórz zadanie</h2>
              <p className="text-xs text-[#e5e4e2]/45">Zadanie zachowa kontekst tej wiadomości.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg p-2 text-[#e5e4e2]/55 hover:bg-white/5 hover:text-white disabled:opacity-50"
            aria-label="Zamknij"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <label className="block">
            <span className="mb-2 block text-xs text-[#e5e4e2]/55">Tytuł zadania *</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/45"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="mb-2 flex items-center gap-1.5 text-xs text-[#e5e4e2]/55">
                <UserRound className="h-3.5 w-3.5" /> Wykonawca
              </span>
              <select
                value={assigneeId}
                onChange={(event) => setAssigneeId(event.target.value)}
                disabled={loadingEmployees}
                className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/45 disabled:opacity-50"
              >
                <option value="">Nieprzypisane</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name} {employee.surname}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 flex items-center gap-1.5 text-xs text-[#e5e4e2]/55">
                <CalendarClock className="h-3.5 w-3.5" /> Termin
              </span>
              <input
                type="datetime-local"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/45"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-xs text-[#e5e4e2]/55">Priorytet</span>
              <select
                value={priority}
                onChange={(event) =>
                  setPriority(event.target.value as (typeof priorityOptions)[number]['value'])
                }
                className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/45"
              >
                {priorityOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-2 block text-xs text-[#e5e4e2]/55">Opis i kontekst</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={12}
              className="w-full resize-y rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2.5 text-sm leading-6 text-[#e5e4e2] outline-none focus:border-[#d3bb73]/45"
            />
          </label>
        </div>

        <div className="flex shrink-0 justify-end gap-3 border-t border-[#d3bb73]/10 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-sm text-[#e5e4e2]/65 hover:bg-white/5 disabled:opacity-50"
          >
            Anuluj
          </button>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={saving || !title.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#11141f] hover:bg-[#c5ad65] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListPlus className="h-4 w-4" />}
            {saving ? 'Zapisywanie…' : 'Utwórz zadanie'}
          </button>
        </div>
      </div>
    </div>
  );
}
