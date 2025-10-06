'use client';

import { Plus, CheckSquare, User, Calendar } from 'lucide-react';

export default function TasksPage() {
  const tasks = [
    {
      id: '1',
      title: 'Przygotowanie scenografii',
      description: 'Zaprojektować i przygotować scenografię dla eventu Tech Summit',
      event_name: 'Konferencja Tech Summit',
      assigned_to: 'Piotr Zieliński',
      priority: 'high' as const,
      status: 'in_progress' as const,
      due_date: '2025-10-12',
    },
    {
      id: '2',
      title: 'Wysłanie oferty klientowi',
      description: 'Przygotować i wysłać ofertę dla ABC Corporation',
      event_name: 'Integracja firmowa ABC',
      assigned_to: 'Anna Nowak',
      priority: 'urgent' as const,
      status: 'todo' as const,
      due_date: '2025-10-05',
    },
  ];

  const priorityColors = {
    low: 'bg-gray-500/20 text-gray-400',
    medium: 'bg-blue-500/20 text-blue-400',
    high: 'bg-orange-500/20 text-orange-400',
    urgent: 'bg-red-500/20 text-red-400',
  };

  const priorityLabels = {
    low: 'Niski',
    medium: 'Średni',
    high: 'Wysoki',
    urgent: 'Pilne',
  };

  const statusColors = {
    todo: 'bg-yellow-500/20 text-yellow-400',
    in_progress: 'bg-blue-500/20 text-blue-400',
    completed: 'bg-green-500/20 text-green-400',
    cancelled: 'bg-gray-500/20 text-gray-400',
  };

  const statusLabels = {
    todo: 'Do zrobienia',
    in_progress: 'W trakcie',
    completed: 'Zakończone',
    cancelled: 'Anulowane',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-light text-[#e5e4e2]">Zadania</h2>
        <button className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors">
          <Plus className="w-4 h-4" />
          Nowe zadanie
        </button>
      </div>

      <div className="grid gap-4">
        {tasks.map((task) => (
          <div
            key={task.id}
            className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6 hover:border-[#d3bb73]/30 transition-all cursor-pointer"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-4 flex-1">
                <div className="w-12 h-12 bg-[#d3bb73]/20 rounded-lg flex items-center justify-center">
                  <CheckSquare className="w-6 h-6 text-[#d3bb73]" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-lg font-medium text-[#e5e4e2]">
                      {task.title}
                    </h3>
                    <span
                      className={`px-2 py-1 rounded text-xs ${
                        priorityColors[task.priority]
                      }`}
                    >
                      {priorityLabels[task.priority]}
                    </span>
                    <span
                      className={`px-2 py-1 rounded text-xs ${
                        statusColors[task.status]
                      }`}
                    >
                      {statusLabels[task.status]}
                    </span>
                  </div>
                  <p className="text-sm text-[#e5e4e2]/70 mb-2">
                    {task.description}
                  </p>
                  <div className="flex items-center gap-4 text-xs text-[#e5e4e2]/60">
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(task.due_date).toLocaleDateString('pl-PL')}
                    </div>
                    {task.assigned_to && (
                      <div className="flex items-center gap-1">
                        <User className="w-3 h-3" />
                        {task.assigned_to}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {task.event_name && (
              <div className="pt-3 border-t border-[#d3bb73]/10 text-xs text-[#e5e4e2]/60">
                Event: {task.event_name}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
