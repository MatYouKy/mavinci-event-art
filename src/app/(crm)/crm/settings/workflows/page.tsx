'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  Loader2,
  Plus,
  Save,
  Trash2,
  Workflow,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useSnackbar } from '@/contexts/SnackbarContext';

type Requirement = {
  id: string;
  stage_id: string;
  requirement_key: string;
  label: string;
  description: string | null;
  is_required: boolean;
  order_index: number;
  auto_create_task: boolean;
  task_title: string | null;
  task_priority: 'low' | 'medium' | 'high' | 'urgent';
};

type Stage = {
  id: string;
  template_id: string;
  name: string;
  description: string | null;
  order_index: number;
  due_offset_days: number | null;
  color: string;
  is_blocking: boolean;
  event_workflow_requirements: Requirement[];
};

type WorkflowTemplate = {
  id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  is_active: boolean;
  version: number;
  event_workflow_stages: Stage[];
  event_workflow_template_categories: Array<{ category_id: string }>;
};

type EventCategory = { id: string; name: string; color: string | null };

const requirementOptions = [
  ['event_details_complete', 'Uzupełnione kluczowe dane wydarzenia'],
  ['client_assigned', 'Przypisany klient'],
  ['offer_accepted', 'Zaakceptowana oferta'],
  ['contract_signed', 'Podpisana umowa'],
  ['team_assigned', 'Przypisany i zaakceptowany zespół'],
  ['equipment_assigned', 'Przypisany sprzęt'],
  ['vehicle_assigned', 'Zaplanowany transport'],
  ['agenda_ready', 'Przygotowana agenda'],
  ['tasks_complete', 'Brak otwartych zadań'],
  ['wedding_card_ready', 'Gotowa Karta Weselna'],
  ['invoice_issued', 'Wystawiona faktura'],
  ['invoice_paid', 'Płatność zaksięgowana'],
  ['manual', 'Ręczne potwierdzenie'],
] as const;

const inputClass =
  'w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] outline-none transition-colors focus:border-[#d3bb73]/50';

export default function WorkflowSettingsPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { isAdmin, loading: employeeLoading } = useCurrentEmployee();
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [categories, setCategories] = useState<EventCategory[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [migrationMissing, setMigrationMissing] = useState(false);

  const selected = useMemo(
    () => templates.find((template) => template.id === selectedId) ?? null,
    [templates, selectedId],
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    const [templatesResult, categoriesResult] = await Promise.all([
      supabase
        .from('event_workflow_templates')
        .select(`
          id, name, description, is_default, is_active, version,
          event_workflow_template_categories(category_id),
          event_workflow_stages(
            id, template_id, name, description, order_index, due_offset_days, color, is_blocking,
            event_workflow_requirements(
              id, stage_id, requirement_key, label, description, is_required,
              order_index, auto_create_task, task_title, task_priority
            )
          )
        `)
        .order('created_at'),
      supabase.from('event_categories').select('id, name, color').order('name'),
    ]);

    if (templatesResult.error) {
      setMigrationMissing(templatesResult.error.code === '42P01' || templatesResult.error.code === 'PGRST205');
      showSnackbar(`Nie udało się pobrać procesów: ${templatesResult.error.message}`, 'error');
      setLoading(false);
      return;
    }

    const normalized = ((templatesResult.data ?? []) as unknown as WorkflowTemplate[]).map(
      (template) => ({
        ...template,
        event_workflow_stages: [...(template.event_workflow_stages ?? [])]
          .sort((a, b) => a.order_index - b.order_index)
          .map((stage) => ({
            ...stage,
            event_workflow_requirements: [...(stage.event_workflow_requirements ?? [])].sort(
              (a, b) => a.order_index - b.order_index,
            ),
          })),
      }),
    );

    setTemplates(normalized);
    setCategories((categoriesResult.data ?? []) as EventCategory[]);
    setSelectedId((current) => current && normalized.some((item) => item.id === current)
      ? current
      : normalized[0]?.id ?? null);
    setLoading(false);
  }, [showSnackbar]);

  useEffect(() => {
    if (!employeeLoading && isAdmin) void loadData();
    else if (!employeeLoading) setLoading(false);
  }, [employeeLoading, isAdmin, loadData]);

  const updateSelected = (patch: Partial<WorkflowTemplate>) => {
    if (!selectedId) return;
    setTemplates((current) => current.map((item) => item.id === selectedId ? { ...item, ...patch } : item));
  };

  const updateStage = (stageId: string, patch: Partial<Stage>) => {
    if (!selected) return;
    updateSelected({
      event_workflow_stages: selected.event_workflow_stages.map((stage) =>
        stage.id === stageId ? { ...stage, ...patch } : stage,
      ),
    });
  };

  const updateRequirement = (stageId: string, requirementId: string, patch: Partial<Requirement>) => {
    const stage = selected?.event_workflow_stages.find((item) => item.id === stageId);
    if (!stage) return;
    updateStage(stageId, {
      event_workflow_requirements: stage.event_workflow_requirements.map((requirement) =>
        requirement.id === requirementId ? { ...requirement, ...patch } : requirement,
      ),
    });
  };

  const createTemplate = async () => {
    setSaving(true);
    const { data, error } = await supabase
      .from('event_workflow_templates')
      .insert({ name: 'Nowy proces', description: 'Nowy szablon procesu wydarzenia.' })
      .select('id')
      .single();
    setSaving(false);
    if (error) return showSnackbar(error.message, 'error');
    await loadData();
    setSelectedId(data.id);
    showSnackbar('Utworzono nowy proces', 'success');
  };

  const saveTemplate = async () => {
    if (!selected) return;
    setSaving(true);
    if (selected.is_default) {
      await supabase
        .from('event_workflow_templates')
        .update({ is_default: false })
        .neq('id', selected.id)
        .eq('is_default', true);
    }

    const { error: templateError } = await supabase
      .from('event_workflow_templates')
      .update({
        name: selected.name.trim(),
        description: selected.description,
        is_default: selected.is_default,
        is_active: selected.is_active,
        version: selected.version,
        updated_at: new Date().toISOString(),
      })
      .eq('id', selected.id);

    if (templateError) {
      setSaving(false);
      return showSnackbar(templateError.message, 'error');
    }

    const categoryIds = selected.event_workflow_template_categories.map((item) => item.category_id);
    const { error: deleteCategoriesError } = await supabase
      .from('event_workflow_template_categories')
      .delete()
      .eq('template_id', selected.id);
    if (!deleteCategoriesError && categoryIds.length) {
      await supabase.from('event_workflow_template_categories').insert(
        categoryIds.map((categoryId) => ({ template_id: selected.id, category_id: categoryId })),
      );
    }

    for (const stage of selected.event_workflow_stages) {
      await supabase
        .from('event_workflow_stages')
        .update({
          name: stage.name,
          description: stage.description,
          order_index: stage.order_index,
          due_offset_days: stage.due_offset_days,
          color: stage.color,
          is_blocking: stage.is_blocking,
          updated_at: new Date().toISOString(),
        })
        .eq('id', stage.id);

      for (const requirement of stage.event_workflow_requirements) {
        await supabase
          .from('event_workflow_requirements')
          .update({
            requirement_key: requirement.requirement_key,
            label: requirement.label,
            description: requirement.description,
            is_required: requirement.is_required,
            order_index: requirement.order_index,
            auto_create_task: requirement.auto_create_task,
            task_title: requirement.task_title,
            task_priority: requirement.task_priority,
            updated_at: new Date().toISOString(),
          })
          .eq('id', requirement.id);
      }
    }

    setSaving(false);
    await loadData();
    showSnackbar('Proces został zapisany', 'success');
  };

  const addStage = async () => {
    if (!selected) return;
    const orderIndex = (selected.event_workflow_stages.at(-1)?.order_index ?? 0) + 10;
    const { error } = await supabase.from('event_workflow_stages').insert({
      template_id: selected.id,
      name: 'Nowy etap',
      description: 'Opisz rezultat, który ma zostać osiągnięty.',
      order_index: orderIndex,
      due_offset_days: -7,
    });
    if (error) return showSnackbar(error.message, 'error');
    await loadData();
  };

  const addRequirement = async (stage: Stage) => {
    const orderIndex = (stage.event_workflow_requirements.at(-1)?.order_index ?? 0) + 10;
    const { error } = await supabase.from('event_workflow_requirements').insert({
      stage_id: stage.id,
      requirement_key: 'manual',
      label: 'Nowe potwierdzenie',
      order_index: orderIndex,
    });
    if (error) return showSnackbar(error.message, 'error');
    await loadData();
  };

  const removeStage = async (stageId: string) => {
    if (!window.confirm('Usunąć etap wraz z wymaganiami?')) return;
    const { error } = await supabase.from('event_workflow_stages').delete().eq('id', stageId);
    if (error) return showSnackbar(error.message, 'error');
    await loadData();
  };

  const removeRequirement = async (requirementId: string) => {
    const { error } = await supabase.from('event_workflow_requirements').delete().eq('id', requirementId);
    if (error) return showSnackbar(error.message, 'error');
    await loadData();
  };

  const moveStage = (stageId: string, direction: -1 | 1) => {
    if (!selected) return;
    const stages = [...selected.event_workflow_stages];
    const index = stages.findIndex((stage) => stage.id === stageId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= stages.length) return;
    [stages[index], stages[nextIndex]] = [stages[nextIndex], stages[index]];
    updateSelected({
      event_workflow_stages: stages.map((stage, stageIndex) => ({
        ...stage,
        order_index: (stageIndex + 1) * 10,
      })),
    });
  };

  if (employeeLoading || loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-[#d3bb73]" /></div>;
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-6 text-red-200">
          <AlertTriangle className="mb-3 h-7 w-7" />
          Konfiguracja procesów jest dostępna wyłącznie dla administratora.
        </div>
      </div>
    );
  }

  if (migrationMissing) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <button onClick={() => router.back()} className="mb-6 flex items-center gap-2 text-[#e5e4e2]/60"><ArrowLeft className="h-4 w-4" />Wróć</button>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-6">
          <h2 className="text-lg text-amber-200">Najpierw uruchom migrację procesów</h2>
          <p className="mt-2 text-sm text-amber-100/70">Plik: 20260828110000_create_event_workflow_engine.sql</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1500px] p-4 sm:p-6">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/crm/settings?tab=admin')} className="rounded-lg p-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33] hover:text-[#e5e4e2]"><ArrowLeft className="h-5 w-5" /></button>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-light text-[#e5e4e2]"><Workflow className="h-6 w-6 text-[#d3bb73]" />Procesy wydarzeń</h1>
            <p className="mt-1 text-sm text-[#e5e4e2]/50">Etapy, terminy, bramki jakości i automatyczne zadania.</p>
          </div>
        </div>
        <button onClick={createTemplate} disabled={saving} className="flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 font-medium text-[#11131d] disabled:opacity-50"><Plus className="h-4 w-4" />Nowy proces</button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="h-fit rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-3">
          <div className="mb-2 px-2 text-xs uppercase tracking-wider text-[#e5e4e2]/35">Szablony</div>
          <div className="space-y-1">
            {templates.map((template) => (
              <button key={template.id} onClick={() => setSelectedId(template.id)} className={`w-full rounded-lg px-3 py-3 text-left transition-colors ${template.id === selectedId ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'text-[#e5e4e2]/70 hover:bg-[#0f1119]'}`}>
                <div className="flex items-center justify-between gap-2"><span className="font-medium">{template.name}</span>{template.is_default && <span className="rounded bg-[#d3bb73]/15 px-1.5 py-0.5 text-[10px]">DOMYŚLNY</span>}</div>
                <div className="mt-1 text-xs opacity-60">{template.event_workflow_stages.length} etapów · wersja {template.version}</div>
              </button>
            ))}
          </div>
        </aside>

        {selected ? (
          <main className="min-w-0 space-y-5">
            <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1.5"><span className="text-xs text-[#e5e4e2]/50">Nazwa procesu</span><input className={inputClass} value={selected.name} onChange={(event) => updateSelected({ name: event.target.value })} /></label>
                <label className="space-y-1.5"><span className="text-xs text-[#e5e4e2]/50">Wersja</span><input type="number" min={1} className={inputClass} value={selected.version} onChange={(event) => updateSelected({ version: Number(event.target.value) || 1 })} /></label>
                <label className="space-y-1.5 md:col-span-2"><span className="text-xs text-[#e5e4e2]/50">Opis</span><textarea className={inputClass} rows={2} value={selected.description ?? ''} onChange={(event) => updateSelected({ description: event.target.value })} /></label>
              </div>
              <div className="mt-4 flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/75"><input type="checkbox" checked={selected.is_active} onChange={(event) => updateSelected({ is_active: event.target.checked })} />Proces aktywny</label>
                <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/75"><input type="checkbox" checked={selected.is_default} onChange={(event) => updateSelected({ is_default: event.target.checked })} />Domyślny dla pozostałych kategorii</label>
              </div>
              <div className="mt-5">
                <div className="mb-2 text-xs text-[#e5e4e2]/50">Kategorie wydarzeń (puste = tylko użycie jako domyślny)</div>
                <div className="flex flex-wrap gap-2">
                  {categories.map((category) => {
                    const checked = selected.event_workflow_template_categories.some((item) => item.category_id === category.id);
                    return <label key={category.id} className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs ${checked ? 'border-[#d3bb73]/40 bg-[#d3bb73]/15 text-[#d3bb73]' : 'border-[#e5e4e2]/10 text-[#e5e4e2]/50'}`}><input type="checkbox" className="sr-only" checked={checked} onChange={() => updateSelected({ event_workflow_template_categories: checked ? selected.event_workflow_template_categories.filter((item) => item.category_id !== category.id) : [...selected.event_workflow_template_categories, { category_id: category.id }] })} />{category.name}</label>;
                  })}
                </div>
              </div>
            </section>

            <div className="space-y-4">
              {selected.event_workflow_stages.map((stage, stageIndex) => (
                <section key={stage.id} className="overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
                  <div className="border-b border-[#d3bb73]/10 p-4 sm:p-5">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
                      <div className="grid min-w-0 flex-1 gap-3 md:grid-cols-[minmax(220px,1fr)_150px_90px]">
                        <label className="space-y-1"><span className="text-[11px] text-[#e5e4e2]/40">Etap</span><input className={inputClass} value={stage.name} onChange={(event) => updateStage(stage.id, { name: event.target.value })} /></label>
                        <label className="space-y-1"><span className="text-[11px] text-[#e5e4e2]/40">Termin względem wydarzenia</span><div className="flex items-center gap-2"><input type="number" className={inputClass} value={stage.due_offset_days ?? ''} onChange={(event) => updateStage(stage.id, { due_offset_days: event.target.value === '' ? null : Number(event.target.value) })} /><span className="text-xs text-[#e5e4e2]/40">dni</span></div></label>
                        <label className="space-y-1"><span className="text-[11px] text-[#e5e4e2]/40">Kolor</span><input type="color" className="h-[38px] w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] p-1" value={stage.color} onChange={(event) => updateStage(stage.id, { color: event.target.value })} /></label>
                      </div>
                      <div className="flex items-center gap-1">
                        <button title="Przesuń wyżej" disabled={stageIndex === 0} onClick={() => moveStage(stage.id, -1)} className="rounded-lg p-2 text-[#e5e4e2]/50 hover:bg-[#0f1119] disabled:opacity-20"><ArrowUp className="h-4 w-4" /></button>
                        <button title="Przesuń niżej" disabled={stageIndex === selected.event_workflow_stages.length - 1} onClick={() => moveStage(stage.id, 1)} className="rounded-lg p-2 text-[#e5e4e2]/50 hover:bg-[#0f1119] disabled:opacity-20"><ArrowDown className="h-4 w-4" /></button>
                        <button title="Usuń etap" onClick={() => removeStage(stage.id)} className="rounded-lg p-2 text-red-400/70 hover:bg-red-500/10"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </div>
                    <input className={`${inputClass} mt-3`} placeholder="Opis rezultatu etapu" value={stage.description ?? ''} onChange={(event) => updateStage(stage.id, { description: event.target.value })} />
                    <label className="mt-3 flex items-center gap-2 text-xs text-[#e5e4e2]/55"><input type="checkbox" checked={stage.is_blocking} onChange={(event) => updateStage(stage.id, { is_blocking: event.target.checked })} />Nieukończony etap po terminie wymaga działania</label>
                  </div>

                  <div className="divide-y divide-[#d3bb73]/10">
                    {stage.event_workflow_requirements.map((requirement) => (
                      <div key={requirement.id} className="grid gap-3 p-4 sm:grid-cols-[200px_minmax(180px,1fr)_auto] sm:items-end">
                        <label className="space-y-1"><span className="text-[11px] text-[#e5e4e2]/40">Źródło potwierdzenia</span><select className={inputClass} value={requirement.requirement_key} onChange={(event) => { const option = requirementOptions.find(([key]) => key === event.target.value); updateRequirement(stage.id, requirement.id, { requirement_key: event.target.value, label: option?.[1] ?? requirement.label, auto_create_task: event.target.value === 'manual' ? false : requirement.auto_create_task }); }}>{requirementOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                        <label className="space-y-1"><span className="text-[11px] text-[#e5e4e2]/40">Nazwa widoczna w wydarzeniu</span><input className={inputClass} value={requirement.label} onChange={(event) => updateRequirement(stage.id, requirement.id, { label: event.target.value })} /></label>
                        <button onClick={() => removeRequirement(requirement.id)} className="mb-0.5 rounded-lg p-2 text-red-400/70 hover:bg-red-500/10"><Trash2 className="h-4 w-4" /></button>
                        <div className="flex flex-wrap gap-4 sm:col-span-3">
                          <label className="flex items-center gap-2 text-xs text-[#e5e4e2]/55"><input type="checkbox" checked={requirement.is_required} onChange={(event) => updateRequirement(stage.id, requirement.id, { is_required: event.target.checked })} />Wymagane</label>
                          {requirement.requirement_key !== 'manual' && <label className="flex items-center gap-2 text-xs text-[#e5e4e2]/55"><input type="checkbox" checked={requirement.auto_create_task} onChange={(event) => updateRequirement(stage.id, requirement.id, { auto_create_task: event.target.checked })} />Twórz zadanie automatycznie</label>}
                          {requirement.auto_create_task && <input className="min-w-[260px] flex-1 rounded border border-[#d3bb73]/10 bg-[#0f1119] px-2 py-1 text-xs text-[#e5e4e2]" placeholder="Tytuł automatycznego zadania" value={requirement.task_title ?? ''} onChange={(event) => updateRequirement(stage.id, requirement.id, { task_title: event.target.value })} />}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button data-crm-action="secondary" onClick={() => addRequirement(stage)} className="m-4 flex items-center gap-2 rounded-lg border border-dashed border-[#d3bb73]/25 px-3 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/5"><Plus className="h-4 w-4" />Dodaj warunek</button>
                </section>
              ))}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
              <button data-crm-action="secondary" onClick={addStage} className="flex items-center justify-center gap-2 rounded-lg border border-[#d3bb73]/25 px-4 py-2.5 text-[#d3bb73] hover:bg-[#d3bb73]/5"><Plus className="h-4 w-4" />Dodaj etap</button>
              <button onClick={saveTemplate} disabled={saving || !selected.name.trim()} className="flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2.5 font-medium text-[#11131d] disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Zapisz cały proces</button>
            </div>
          </main>
        ) : (
          <div className="rounded-xl border border-dashed border-[#d3bb73]/20 p-12 text-center text-[#e5e4e2]/45"><CheckCircle2 className="mx-auto mb-3 h-8 w-8" />Utwórz pierwszy proces wydarzenia.</div>
        )}
      </div>
    </div>
  );
}
