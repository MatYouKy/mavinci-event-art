'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  ListTodo,
  Loader2,
  RefreshCw,
  Settings2,
  Workflow,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';

type WorkflowRequirement = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  required: boolean;
  completed: boolean;
  manual: boolean;
  auto_create_task: boolean;
  note: string | null;
};

type WorkflowStage = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  is_blocking: boolean;
  due_at: string | null;
  status: 'completed' | 'overdue' | 'pending';
  completed: number;
  total: number;
  progress: number;
  requirements: WorkflowRequirement[];
};

type WorkflowReadiness = {
  instance_id: string;
  template_id: string;
  template_name: string;
  event_name: string;
  event_date: string;
  status: string;
  completed: number;
  total: number;
  progress: number;
  stages: WorkflowStage[];
};

function formatDueDate(value: string | null) {
  if (!value) return 'Bez terminu';
  return new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}

function statusLabel(stage: WorkflowStage) {
  if (stage.status === 'completed') return 'Gotowe';
  if (stage.status === 'overdue') return 'Po terminie';
  return 'W przygotowaniu';
}

export default function EventWorkflowReadinessPanel({
  eventId,
  canManage,
  canConfigure = false,
}: {
  eventId: string;
  canManage: boolean;
  canConfigure?: boolean;
}) {
  const { showSnackbar } = useSnackbar();
  const [data, setData] = useState<WorkflowReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [updatingRequirement, setUpdatingRequirement] = useState<string | null>(null);
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());
  const [available, setAvailable] = useState(true);

  const loadReadiness = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const { data: readiness, error } = await supabase.rpc('get_event_workflow_readiness', {
      p_event_id: eventId,
    });

    if (error) {
      if (error.code === 'PGRST202' || error.code === '42883' || error.code === '42P01') {
        setAvailable(false);
      } else if (!silent) {
        showSnackbar(`Nie udało się pobrać gotowości: ${error.message}`, 'error');
      }
      setLoading(false);
      return;
    }

    const normalized = readiness as WorkflowReadiness | null;
    setData(normalized);
    setAvailable(true);
    if (normalized) {
      setExpandedStages((current) => {
        if (current.size) return current;
        const firstIncomplete = normalized.stages.find((stage) => stage.status !== 'completed');
        return new Set(firstIncomplete ? [firstIncomplete.id] : []);
      });
    }
    setLoading(false);
  }, [eventId, showSnackbar]);

  useEffect(() => {
    void loadReadiness();
  }, [loadReadiness]);

  useEffect(() => {
    if (!available) return;
    const channel = supabase.channel(`event-workflow-readiness-${eventId}`);
    const refresh = () => void loadReadiness(true);

    ['offers', 'contracts', 'employee_assignments', 'event_equipment', 'event_vehicles', 'event_agendas', 'tasks', 'invoices', 'wedding_cards'].forEach((table) => {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `event_id=eq.${eventId}` },
        refresh,
      );
    });

    if (data?.instance_id) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'event_workflow_requirement_overrides', filter: `instance_id=eq.${data.instance_id}` },
        refresh,
      );
    }

    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [available, data?.instance_id, eventId, loadReadiness]);

  const overdueStages = useMemo(
    () => data?.stages.filter((stage) => stage.status === 'overdue').length ?? 0,
    [data],
  );

  const toggleStage = (stageId: string) => {
    setExpandedStages((current) => {
      const next = new Set(current);
      if (next.has(stageId)) next.delete(stageId);
      else next.add(stageId);
      return next;
    });
  };

  const toggleManualRequirement = async (requirement: WorkflowRequirement) => {
    if (!canManage || !requirement.manual) return;
    setUpdatingRequirement(requirement.id);
    const { data: updated, error } = await supabase.rpc('set_event_workflow_requirement_override', {
      p_event_id: eventId,
      p_requirement_id: requirement.id,
      p_completed: !requirement.completed,
      p_note: null,
    });
    setUpdatingRequirement(null);
    if (error) return showSnackbar(error.message, 'error');
    setData(updated as WorkflowReadiness);
    showSnackbar(requirement.completed ? 'Ponownie otwarto warunek' : 'Potwierdzono wykonanie', 'success');
  };

  const syncTasks = async () => {
    setSyncing(true);
    const { data: created, error } = await supabase.rpc('sync_event_workflow_tasks', {
      p_event_id: eventId,
    });
    setSyncing(false);
    if (error) return showSnackbar(error.message, 'error');
    showSnackbar(Number(created) > 0 ? `Utworzono ${created} brakujących zadań` : 'Zadania procesu są zsynchronizowane', 'success');
    await loadReadiness(true);
  };

  if (!available) return null;

  if (loading) {
    return (
      <section className="flex min-h-28 items-center justify-center rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
        <Loader2 className="h-6 w-6 animate-spin text-[#d3bb73]" />
      </section>
    );
  }

  if (!data) return null;

  return (
    <section className="overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
      <div className="border-b border-[#d3bb73]/10 p-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[#d3bb73]"><Workflow className="h-5 w-5" /><h3 className="font-medium">Gotowość realizacji</h3></div>
            <p className="mt-1 truncate text-xs text-[#e5e4e2]/45">{data.template_name}</p>
          </div>
          <div className="flex items-center gap-2">
            {canManage && (
              <button onClick={syncTasks} disabled={syncing} className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/15 px-3 py-2 text-xs text-[#e5e4e2]/65 hover:bg-[#0f1119] disabled:opacity-50">
                {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListTodo className="h-3.5 w-3.5" />}Synchronizuj zadania
              </button>
            )}
            <button onClick={() => loadReadiness()} className="rounded-lg border border-[#d3bb73]/15 p-2 text-[#e5e4e2]/55 hover:bg-[#0f1119]" title="Odśwież"><RefreshCw className="h-4 w-4" /></button>
            {canConfigure && <Link href="/crm/settings/workflows" className="rounded-lg border border-[#d3bb73]/15 p-2 text-[#e5e4e2]/55 hover:bg-[#0f1119]" title="Konfiguruj proces"><Settings2 className="h-4 w-4" /></Link>}
          </div>
        </div>

        <div className="mt-5 flex items-end justify-between gap-4">
          <div className="flex-1">
            <div className="mb-2 flex items-center justify-between text-xs"><span className="text-[#e5e4e2]/55">{data.completed} z {data.total} wymaganych warunków</span><span className="font-medium text-[#e5e4e2]">{data.progress}%</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-[#0f1119]"><div className="h-full rounded-full bg-[#d3bb73] transition-all duration-500" style={{ width: `${data.progress}%` }} /></div>
          </div>
          {overdueStages > 0 && <div className="flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300"><AlertTriangle className="h-4 w-4" />{overdueStages} po terminie</div>}
        </div>
      </div>

      <div className="divide-y divide-[#d3bb73]/10">
        {data.stages.map((stage) => {
          const expanded = expandedStages.has(stage.id);
          return (
            <div key={stage.id}>
              <button onClick={() => toggleStage(stage.id)} className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-[#0f1119]/50">
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full" style={{ backgroundColor: `${stage.color}20`, color: stage.color }}>
                  {stage.status === 'completed' ? <Check className="h-4 w-4" /> : stage.status === 'overdue' ? <AlertTriangle className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-medium text-[#e5e4e2]">{stage.name}</span><span className={`rounded px-2 py-0.5 text-[10px] ${stage.status === 'completed' ? 'bg-green-500/10 text-green-300' : stage.status === 'overdue' ? 'bg-red-500/10 text-red-300' : 'bg-[#d3bb73]/10 text-[#d3bb73]'}`}>{statusLabel(stage)}</span></div><div className="mt-1 flex flex-wrap gap-x-3 text-xs text-[#e5e4e2]/40"><span>{stage.completed}/{stage.total} warunków</span><span>{formatDueDate(stage.due_at)}</span></div></div>
                {expanded ? <ChevronDown className="h-4 w-4 text-[#e5e4e2]/35" /> : <ChevronRight className="h-4 w-4 text-[#e5e4e2]/35" />}
              </button>

              {expanded && (
                <div className="space-y-2 bg-[#0f1119]/35 px-4 pb-4 pt-1 sm:pl-[4.75rem]">
                  {stage.description && <p className="pb-1 text-xs text-[#e5e4e2]/40">{stage.description}</p>}
                  {stage.requirements.map((requirement) => {
                    const isUpdating = updatingRequirement === requirement.id;
                    const interactive = requirement.manual && canManage;
                    return (
                      <button key={requirement.id} type="button" disabled={!interactive || isUpdating} onClick={() => toggleManualRequirement(requirement)} className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left ${requirement.completed ? 'border-green-500/10 bg-green-500/5' : requirement.required ? 'border-[#e5e4e2]/10 bg-[#1c1f33]' : 'border-[#e5e4e2]/5 bg-[#1c1f33]/50'} ${interactive ? 'cursor-pointer hover:border-[#d3bb73]/30' : 'cursor-default'}`}>
                        <span className="mt-0.5 flex-none">{isUpdating ? <Loader2 className="h-4 w-4 animate-spin text-[#d3bb73]" /> : requirement.completed ? <CheckCircle2 className="h-4 w-4 text-green-400" /> : <Circle className="h-4 w-4 text-[#e5e4e2]/30" />}</span>
                        <span className="min-w-0 flex-1"><span className={requirement.completed ? 'text-sm text-[#e5e4e2]/60 line-through' : 'text-sm text-[#e5e4e2]/85'}>{requirement.label}</span>{requirement.description && <span className="mt-0.5 block text-xs text-[#e5e4e2]/35">{requirement.description}</span>}</span>
                        <span className="flex-none text-[10px] uppercase tracking-wide text-[#e5e4e2]/30">{requirement.manual ? 'ręcznie' : 'automatycznie'}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
