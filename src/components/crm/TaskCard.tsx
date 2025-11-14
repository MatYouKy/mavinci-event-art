'use client';

import { useRouter } from 'next/navigation';
import { Calendar, GripVertical, Edit, Trash2, UserPlus, MessageSquare } from 'lucide-react';
import TaskAssigneeAvatars from './TaskAssigneeAvatars';

interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: string;
  board_column?: string;
  due_date: string | null;
  comments_count?: number;
  task_assignees?: {
    employee_id: string;
    employees: {
      name: string;
      surname: string;
      avatar_url: string | null;
      avatar_metadata?: any;
    };
  }[];
  assignees?: {
    employee: {
      id: string;
      name: string;
      surname: string;
      avatar_url: string | null;
      avatar_metadata?: any;
      email?: string;
      phone_number?: string;
    };
  }[];
}

interface TaskCardProps {
  task: Task;
  isDragging?: boolean;
  canManage?: boolean;
  showDragHandle?: boolean;
  onEdit?: (task: Task) => void;
  onDelete?: (taskId: string) => void;
  onAssign?: (task: Task) => void;
  additionalActions?: React.ReactNode;
}

const priorityColors = {
  low: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  medium: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  urgent: 'bg-red-500/20 text-red-400 border-red-500/30',
};

const priorityLabels = {
  low: 'Niski',
  medium: 'Średni',
  high: 'Wysoki',
  urgent: 'Pilne',
};

export default function TaskCard({
  task,
  isDragging = false,
  canManage = false,
  showDragHandle = false,
  onEdit,
  onDelete,
  onAssign,
  additionalActions,
}: TaskCardProps) {
  const router = useRouter();

  const assignees =
    task.task_assignees?.map((a) => ({
      employee_id: a.employee_id,
      employees: a.employees,
    })) ||
    task.assignees?.map((a) => ({
      employee_id: a.employee.id,
      employees: a.employee,
    })) ||
    [];

  const handleTitleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(`/crm/tasks/${task.id}`);
  };

  return (
    <div
      className={`group rounded-lg border bg-[#0f1119] p-4 transition-all ${
        isDragging
          ? 'border-[#d3bb73]/50 opacity-50'
          : 'border-[#d3bb73]/10 hover:border-[#d3bb73]/30'
      }`}
    >
      <div className="mb-2 flex items-start justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          {showDragHandle && canManage && (
            <GripVertical className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#e5e4e2]/40" />
          )}
          <button
            onClick={handleTitleClick}
            className="flex-1 truncate text-left text-sm font-medium text-[#e5e4e2] transition-colors hover:text-[#d3bb73]"
          >
            {task.title}
          </button>
        </div>
        {canManage && (
          <div className="ml-2 flex flex-shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            {onAssign && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAssign(task);
                }}
                className="rounded p-1 text-blue-400 transition-colors hover:bg-blue-500/10"
                title="Przypisz pracowników"
              >
                <UserPlus className="h-4 w-4" />
              </button>
            )}
            {onEdit && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(task);
                }}
                className="rounded p-1 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10"
                title="Edytuj"
              >
                <Edit className="h-4 w-4" />
              </button>
            )}
            {onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(task.id);
                }}
                className="rounded p-1 text-red-400 transition-colors hover:bg-red-500/10"
                title="Usuń"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {task.description && (
        <p className="mb-2 line-clamp-2 text-xs text-[#e5e4e2]/60">{task.description}</p>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className={`rounded border px-2 py-1 text-xs ${priorityColors[task.priority]}`}>
          {priorityLabels[task.priority]}
        </span>

        {task.due_date && (
          <div className="flex items-center gap-1 text-xs text-[#e5e4e2]/60">
            <Calendar className="h-3 w-3" />
            {new Date(task.due_date).toLocaleDateString('pl-PL')}
          </div>
        )}

        {task.comments_count !== undefined && task.comments_count > 0 && (
          <div className="flex items-center gap-1 rounded border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-xs text-blue-400">
            <MessageSquare className="h-3 w-3" />
            {task.comments_count}
          </div>
        )}
      </div>

      {assignees.length > 0 && (
        <div className="mb-2">
          <TaskAssigneeAvatars assignees={assignees} />
        </div>
      )}

      {additionalActions && (
        <div className="mt-2 border-t border-[#d3bb73]/5 pt-2">{additionalActions}</div>
      )}
    </div>
  );
}
