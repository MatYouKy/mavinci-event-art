'use client';

import { useRouter } from 'next/navigation';
import { Calendar, GripVertical, Edit, Trash2, UserPlus, MessageSquare } from 'lucide-react';
import { memo } from 'react';
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
  currently_working_by?: string | null;
  currently_working_employee?: {
    name: string;
    surname: string;
    avatar_url: string | null;
    avatar_metadata?: any;
  } | null;
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

const TaskCard = memo(function TaskCard({
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

  const assignees = task.task_assignees?.map(a => ({
    employee_id: a.employee_id,
    employees: a.employees,
  })) || task.assignees?.map(a => ({
    employee_id: a.employee.id,
    employees: a.employee,
  })) || [];

  const handleTitleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(`/crm/tasks/${task.id}`);
  };

  return (
    <div
      className={`bg-[#0f1119] border rounded-lg p-4 transition-all group ${
        isDragging
          ? 'opacity-50 border-[#d3bb73]/50'
          : 'border-[#d3bb73]/10 hover:border-[#d3bb73]/30'
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          {showDragHandle && canManage && (
            <GripVertical className="w-4 h-4 text-[#e5e4e2]/40 flex-shrink-0 mt-0.5" />
          )}
          <button
            onClick={handleTitleClick}
            className="text-sm font-medium text-[#e5e4e2] hover:text-[#d3bb73] transition-colors text-left flex-1 truncate"
          >
            {task.title}
          </button>
        </div>
        {canManage && (
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-2">
            {onAssign && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAssign(task);
                }}
                className="p-1 text-blue-400 hover:bg-blue-500/10 rounded transition-colors"
                title="Przypisz pracowników"
              >
                <UserPlus className="w-4 h-4" />
              </button>
            )}
            {onEdit && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(task);
                }}
                className="p-1 text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded transition-colors"
                title="Edytuj"
              >
                <Edit className="w-4 h-4" />
              </button>
            )}
            {onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(task.id);
                }}
                className="p-1 text-red-400 hover:bg-red-500/10 rounded transition-colors"
                title="Usuń"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {task.description && (
        <p className="text-xs text-[#e5e4e2]/60 mb-2 line-clamp-2">
          {task.description}
        </p>
      )}

      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span
          className={`text-xs px-2 py-1 rounded border ${
            priorityColors[task.priority]
          }`}
        >
          {priorityLabels[task.priority]}
        </span>

        {task.currently_working_employee && (
          <div className="flex items-center gap-1 text-xs text-green-400 bg-green-500/10 px-2 py-1 rounded border border-green-500/30">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            {task.currently_working_employee.name} {task.currently_working_employee.surname}
          </div>
        )}

        {task.due_date && (
          <div className="flex items-center gap-1 text-xs text-[#e5e4e2]/60">
            <Calendar className="w-3 h-3" />
            {new Date(task.due_date).toLocaleDateString('pl-PL')}
          </div>
        )}

        {task.comments_count !== undefined && task.comments_count > 0 && (
          <div className="flex items-center gap-1 text-xs text-blue-400 bg-blue-500/10 px-2 py-1 rounded border border-blue-500/30">
            <MessageSquare className="w-3 h-3" />
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
        <div className="mt-2 pt-2 border-t border-[#d3bb73]/5">
          {additionalActions}
        </div>
      )}
    </div>
  );
});

export default TaskCard;
