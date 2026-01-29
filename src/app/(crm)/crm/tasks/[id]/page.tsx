'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';
import { ArrowLeft, Calendar, User, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { EmployeeAvatar } from '@/components/EmployeeAvatar';
import { ImageMetadata } from '@/lib/supabase/types';
import { IEmployee } from '../../employees/type';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  board_column: string;
  due_date: string | null;
  created_at: string;
  task_assignees: Array<{
    employee_id: string;
    employees: {
      name: string;
      surname: string;
      avatar_url: string | null;
      avatar_metadata?: ImageMetadata | null;
    };
  }>;
  events?: {
    id: string;
    name: string;
  } | null;
}

const priorityColors = {
  low: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  urgent: 'bg-red-500/20 text-red-400 border-red-500/30',
};

const priorityLabels = {
  low: 'Niski',
  medium: 'Średni',
  high: 'Wysoki',
  urgent: 'Pilny',
};

const statusLabels = {
  todo: 'Do zrobienia',
  in_progress: 'W trakcie',
  review: 'W przeglądzie',
  completed: 'Zakończone',
};

const statusColors = {
  todo: 'bg-gray-500/20 text-gray-400',
  in_progress: 'bg-blue-500/20 text-blue-400',
  review: 'bg-yellow-500/20 text-yellow-400',
  completed: 'bg-green-500/20 text-green-400',
};

export default function TaskDetailPage() {
  const params = useParams();
  const taskId = params.id as string;
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);

  console.log('task', task);

  useEffect(() => {
    if (!taskId) return;

    const fetchTask = async () => {
      try {
        const { data, error } = await supabase
          .from('tasks')
          .select(`
            *,
            task_assignees (
              employee_id,
              employees (
                name,
                surname,
                avatar_url,
                avatar_metadata
              )
            ),
            events (
              id,
              name
            )
          `)
          .eq('id', taskId)
          .maybeSingle();

        if (error) throw error;
        setTask(data);
      } catch (error) {
        console.error('Error fetching task:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchTask();
  }, [taskId]);

  if (loading) {
    return (
      <div className='flex min-h-screen items-center justify-center bg-[#0f1119]'>
        <div className='text-[#e5e4e2]/60'>Ładowanie...</div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className='flex min-h-screen flex-col items-center justify-center bg-[#0f1119] p-6'>
        <AlertCircle className='mb-4 h-16 w-16 text-red-400' />
        <h1 className='mb-2 text-2xl font-bold text-[#e5e4e2]'>Task nie został znaleziony</h1>
        <p className='mb-6 text-[#e5e4e2]/60'>Podany task nie istnieje lub został usunięty.</p>
        <Link
          href='/crm/tasks'
          className='flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/80'
        >
          <ArrowLeft className='h-4 w-4' />
          Wróć do tasków
        </Link>
      </div>
    );
  }

  return (
    <div className='min-h-screen bg-[#0f1119] p-6'>
      <div className='mx-auto max-w-4xl space-y-6'>
        <div className='flex items-center justify-between'>
          <Link
            href='/crm/tasks'
            className='flex items-center gap-2 text-[#d3bb73] transition-colors hover:text-[#d3bb73]/80'
          >
            <ArrowLeft className='h-4 w-4' />
            Wróć do tasków
          </Link>
        </div>

        <div className='rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6'>
          <div className='mb-6 flex items-start justify-between gap-4'>
            <h1 className='text-2xl font-bold text-[#e5e4e2]'>{task.title}</h1>
            <span className={`rounded-full px-3 py-1 text-sm font-medium ${statusColors[task.board_column as keyof typeof statusColors] || 'bg-gray-500/20 text-gray-400'}`}>
              {statusLabels[task.board_column as keyof typeof statusLabels] || task.board_column}
            </span>
          </div>

          <div className='mb-6 flex items-center gap-2'>
            <span className='text-sm text-[#e5e4e2]/60'>Priorytet:</span>
            <span className={`rounded border px-2 py-1 text-xs font-medium ${priorityColors[task.priority]}`}>
              {priorityLabels[task.priority]}
            </span>
          </div>

          {task.description && (
            <div className='mb-6'>
              <h3 className='mb-2 text-sm font-medium text-[#e5e4e2]/60'>Opis</h3>
              <p className='whitespace-pre-wrap text-[#e5e4e2]'>{task.description}</p>
            </div>
          )}

          <div className='grid gap-4 border-t border-[#d3bb73]/10 pt-6 md:grid-cols-2'>
            {task.due_date && (
              <div className='flex items-center gap-3'>
                <Calendar className='h-5 w-5 text-[#d3bb73]' />
                <div>
                  <div className='text-xs text-[#e5e4e2]/60'>Termin</div>
                  <div className='text-sm font-medium text-[#e5e4e2]'>
                    {new Date(task.due_date).toLocaleDateString('pl-PL')}
                  </div>
                </div>
              </div>
            )}

            <div className='flex items-center gap-3'>
              <Clock className='h-5 w-5 text-[#d3bb73]' />
              <div>
                <div className='text-xs text-[#e5e4e2]/60'>Utworzono</div>
                <div className='text-sm font-medium text-[#e5e4e2]'>
                  {new Date(task.created_at).toLocaleDateString('pl-PL')}
                </div>
              </div>
            </div>

            {task.events && (
              <div className='flex items-center gap-3'>
                <CheckCircle className='h-5 w-5 text-[#d3bb73]' />
                <div>
                  <div className='text-xs text-[#e5e4e2]/60'>Wydarzenie</div>
                  <Link
                    href={`/crm/events/${task.events.id}`}
                    className='text-sm font-medium text-[#d3bb73] hover:underline'
                  >
                    {task.events.name}
                  </Link>
                </div>
              </div>
            )}
          </div>

          {task.task_assignees && task.task_assignees.length > 0 && (
            <div className='mt-6 border-t border-[#d3bb73]/10 pt-6'>
              <h3 className='mb-3 flex items-center gap-2 text-sm font-medium text-[#e5e4e2]/60'>
                <User className='h-4 w-4' />
                Przypisani pracownicy
              </h3>
              <div className='flex flex-wrap gap-2'>
                {task.task_assignees.map((assignee) => (
                  <div
                    key={assignee.employee_id}
                    className='flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2'
                  >
                    {assignee.employees.avatar_url ? (
                      <EmployeeAvatar
                        avatarUrl={assignee.employees.avatar_url}
                        avatarMetadata={assignee.employees.avatar_metadata}
                        employeeName={`${assignee.employees.name} ${assignee.employees.surname}`}
                        size={24}
                        employee={assignee.employees as IEmployee}
                        showActivityStatus
                      />
                    ) : (
                      <div className='flex h-6 w-6 items-center justify-center rounded-full bg-[#d3bb73]/20 text-xs font-medium text-[#d3bb73]'>
                        {assignee.employees.name[0]}
                        {assignee.employees.surname[0]}
                      </div>
                    )}
                    <span className='text-sm text-[#e5e4e2]'>
                      {assignee.employees.name} {assignee.employees.surname}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
