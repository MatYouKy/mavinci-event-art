'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  CheckCircle2,
  CircleDot,
  FileText,
  Handshake,
  Loader2,
  Receipt,
  XCircle,
  Tag,
  Play,
  Printer,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useSearchParams, useRouter } from 'next/navigation';
import { IEvent } from '@/app/(crm)/crm/events/type';
import { EventStatus } from '@/components/crm/Calendar/types';
import { useEventCategories } from '@/app/(crm)/crm/event-categories/hook/useEventCategories';
import { IEventCategory } from '@/app/(crm)/crm/event-categories/types';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

export const eventStatusLabels: Record<EventStatus, string> = {
  inquiry: 'Zapytanie',
  offer_to_send: 'Oferta do wysłania',
  offer_sent: 'Oferta wysłana',
  offer_accepted: 'Oferta zaakceptowana',
  in_preparation: 'W przygotowaniu',
  ready_for_live: 'Gotowy do realizacji',
  in_progress: 'W trakcie',
  completed: 'Zrealizowany',
  cancelled: 'Anulowany',
  invoiced: 'Zafakturowany',
};

export const statusBadgeClasses: Record<EventStatus, string> = {
  inquiry: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
  offer_to_send: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20',
  offer_sent: 'bg-purple-500/10 text-purple-300 border-purple-500/20',
  offer_accepted: 'bg-green-500/10 text-green-300 border-green-500/20',
  in_preparation: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/20',
  ready_for_live: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
  in_progress: 'bg-purple-500/10 text-purple-300 border-purple-500/20',
  completed: 'bg-green-500/10 text-green-300 border-green-500/20',
  cancelled: 'bg-red-500/10 text-red-300 border-red-500/20',
  invoiced: 'bg-[#d3bb73]/10 text-[#d3bb73] border-[#d3bb73]/20',
};

const statusIcon = (s: EventStatus) => {
  switch (s) {
    case 'inquiry':
      return <CircleDot className="h-4 w-4" />;
    case 'offer_to_send':
      return <FileText className="h-4 w-4" />;
    case 'offer_sent':
      return <FileText className="h-4 w-4" />;
    case 'offer_accepted':
      return <Handshake className="h-4 w-4" />;
    case 'in_preparation':
      return <Loader2 className="h-4 w-4" />;
    case 'in_progress':
    case 'ready_for_live':
      return <Play className="h-4 w-4" />;
    case 'completed':
      return <CheckCircle2 className="h-4 w-4" />;
    case 'cancelled':
      return <XCircle className="h-4 w-4" />;
    case 'invoiced':
      return <Receipt className="h-4 w-4" />;
    default:
      return null;
  }
};

interface EventDetailsActionProps {
  event: IEvent;
  canEditStatus?: boolean;
}

export default function EventDetailsAction({
  event,
  canEditStatus = true,
}: EventDetailsActionProps) {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { getCategoryById, categories } = useEventCategories(); 
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<EventStatus>(event?.status as EventStatus);
  const [category, setCategory] = useState<IEventCategory | null>(null);
  const [isEditingCategory, setIsEditingCategory] = useState(false);
  const [statusEditActive, setStatusEditActive] = useState(false);
  const { employee } = useCurrentEmployee();
  const [agenda, setAgenda] = useState<any | null>(null);
  const [equipmentChecklist, setEquipmentChecklist] = useState<any | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(event?.category_id ?? '');
const [savingCategory, setSavingCategory] = useState(false);
  const searchParams = useSearchParams();

  useEffect(() => {
    setSelectedCategoryId(event?.category_id ?? '');
  }, [event?.category_id]);

  

  const [generatedPdfPath, setGeneratedPdfPath] = useState<string | null>(null);
  

  

  useEffect(() => {
    if (event.status === 'ready_for_live' && event.id) {
      fetchAgenda();
      fetchEquipmentChecklist();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id, event.status]);

  const fetchAgenda = async () => {
    const { data: agenda, error: agendaError } = await supabase
      .from('event_agendas')
      .select('*')
      .eq('event_id', event.id)
      .maybeSingle();
    if (agendaError && agendaError.code !== 'PGRST116') throw agendaError;
    setAgenda(agenda);
  };

  const fetchEquipmentChecklist = async () => {
    const { data, error } = await supabase
      .from('event_files')
      .select('id, name, file_path, created_at')
      .eq('event_id', event.id)
      .eq('document_type', 'equipment_checklist')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
  
    if (error && error.code !== 'PGRST116') throw error;
  
    setEquipmentChecklist(data ?? null);
    return data ?? null; // ✅ KLUCZOWE
  };

  useEffect(() => {
    if (event?.category_id) {
      fetchCategory();
    } else {
      setCategory(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.category_id]);

  useEffect(() => {
    if (event?.status) setCurrentStatus(event.status as EventStatus);
  }, [event?.status]);

  const fetchCategory = async () => {
    const category = await getCategoryById(event?.category_id ?? '');
    setCategory(category);
  };

  const handleShowChecklistPdf = async () => {
    try {
      // ✅ weź aktualny rekord: albo z state, albo pobierz świeży
      const checklist =
        equipmentChecklist?.file_path ? equipmentChecklist : await fetchEquipmentChecklist();

        console.log('checklist file_path:', checklist?.file_path);
  
      if (!checklist?.file_path) {
        showSnackbar('Brak checklisty sprzętu do wydruku', 'info');
        return;
      }
  
      const { data, error } = await supabase.storage
        .from('event-files')
        .createSignedUrl(checklist.file_path, 3600);
  
      if (error) throw error;
  
      if (data?.signedUrl) {
        window.open(data.signedUrl, '_blank');
        return;
      }
  
      showSnackbar('Nie udało się wygenerować linku do checklisty', 'error');
    } catch (err: any) {
      console.error('Checklist PDF error:', err);
      showSnackbar(err?.message || 'Błąd podczas otwierania checklisty', 'error');
    }
  };

  const handleCategoryChange = async (newCategoryId: string) => {
    if (!event?.id) return;
  
    try {
      setSavingCategory(true);
  
      const payload = {
        category_id: newCategoryId && newCategoryId !== '' ? newCategoryId : null,
        updated_at: new Date().toISOString(),
      };
  
      const { error } = await supabase.from('events').update(payload).eq('id', event.id);
  
      if (error) throw error;
  
      setSelectedCategoryId(newCategoryId);
  
      // odśwież lokalny "category" (żeby od razu pokazało label/kolor)
      if (newCategoryId) {
        const next = await getCategoryById(newCategoryId);
        setCategory(next);
      } else {
        setCategory(null);
      }
  
      showSnackbar('Zaktualizowano kategorię wydarzenia', 'success');
      setIsEditingCategory(false);
      router.refresh();
    } catch (err: any) {
      console.error('Error updating category:', err);
      showSnackbar(err?.message || 'Błąd podczas zmiany kategorii', 'error');
    } finally {
      setSavingCategory(false);
    }
  };

  const handleStatusChange = async (newStatus: EventStatus) => {
    if (!event?.id) return;

    try {
      setUpdatingStatus(true);

      const { error } = await supabase
        .from('events')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', event.id);

      if (error) throw error;

      setCurrentStatus(newStatus);
      showSnackbar(`Status eventu: ${eventStatusLabels[newStatus]}`, 'success');
      router.refresh();
      setStatusEditActive(false);
    } catch (err: any) {
      console.error('Error updating status:', err);
      showSnackbar(err?.message || 'Błąd podczas zmiany statusu', 'error');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleShowPdf = async () => {
    const { data: agenda, error: agendaError } = await supabase
      .from('event_agendas')
      .select('*')
      .eq('event_id', event.id)
      .maybeSingle();

    if (agendaError && agendaError.code !== 'PGRST116') throw agendaError;

    if (agenda) {
      setGeneratedPdfPath(agenda.generated_pdf_path);
    }

    if (!agenda?.generated_pdf_path) return;

    const { data } = await supabase.storage
      .from('event-files')
      .createSignedUrl(agenda.generated_pdf_path, 3600);

    if (data?.signedUrl) {
      window.open(data.signedUrl, '_blank');
    }
  };

  const isReadyForLive = currentStatus === 'ready_for_live';

  const canAgenda =
    employee?.permissions?.includes('events_manage') || employee?.permissions?.includes('admin');

  const canEquipment =
    employee?.permissions?.includes('equipment_manage') || employee?.permissions?.includes('admin');

  const badgeCls = useMemo(() => {
    const base =
      'inline-flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm transition-colors';
    const color = statusBadgeClasses[currentStatus] ?? 'bg-white/5 text-[#e5e4e2] border-white/10';
    const clickable = canEditStatus ? 'cursor-pointer hover:bg-white/5' : 'cursor-default opacity-80';
    return `${base} ${color} ${clickable}`;
  }, [currentStatus, canEditStatus]);

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Akcje</h2>

      <div className="space-y-2">
        {/* ✅ POPRAWKA: sekcja kategorii nie znika po kliknięciu.
            Zamiast renderować tylko gdy !isEditingCategory, renderujemy zawsze i przełączamy zawartość. */}
<div>
  <label className="mb-2 block text-sm text-[#e5e4e2]/60">Kategoria</label>

  {!isEditingCategory ? (
    <button
      type="button"
      onClick={() => setIsEditingCategory(true)}
      className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 transition-opacity hover:opacity-80"
      style={{
        backgroundColor: category?.color ? `${category.color}20` : 'rgba(255,255,255,0.04)',
        borderColor: category?.color ? `${category.color}50` : 'rgba(255,255,255,0.10)',
        color: category?.color ?? '#e5e4e2',
      }}
      title="Kliknij aby edytować kategorię"
    >
      {category?.icon ? (
        <div
          className="h-4 w-4"
          style={{ color: category.color }}
          dangerouslySetInnerHTML={{ __html: category.icon.svg_code }}
        />
      ) : (
        <Tag className="h-4 w-4" />
      )}

      <span className="text-sm font-medium">{category?.name ?? 'Brak kategorii'}</span>

      <span className="ml-auto text-xs opacity-70">Zmień</span>
    </button>
  ) : (
    <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs text-[#e5e4e2]/60">
          Aktualnie:{' '}
          <span className="text-[#e5e4e2]">{category?.name ?? 'brak'}</span>
        </div>

        <button
          type="button"
          onClick={() => {
            setIsEditingCategory(false);
            setSelectedCategoryId(event?.category_id ?? '');
          }}
          className="rounded-md px-2 py-1 text-xs text-[#e5e4e2]/60 hover:bg-white/5 hover:text-[#e5e4e2]"
        >
          Anuluj
        </button>
      </div>

      <div className="space-y-2">
        <select
          value={selectedCategoryId}
          onChange={(e) => handleCategoryChange(e.target.value)}
          disabled={savingCategory}
          autoFocus
          className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-3 py-2 text-sm text-[#e5e4e2] transition-colors focus:border-[#d3bb73] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">Brak kategorii</option>

          {(categories || []).map((c: IEventCategory) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <div className="flex items-center justify-between">
          <div className="text-xs text-[#e5e4e2]/40">
            {savingCategory ? 'Zapisuję…' : 'Wybierz kategorię z listy'}
          </div>

          {savingCategory && <Loader2 className="h-4 w-4 animate-spin text-[#d3bb73]" />}
        </div>
      </div>
    </div>
  )}
</div>

        <div>
          <label className="mb-2 block text-sm text-[#e5e4e2]/60">Status eventu</label>

          {!statusEditActive ? (
            <button
              type="button"
              className={badgeCls}
              onClick={() => canEditStatus && setStatusEditActive(true)}
              disabled={!canEditStatus}
              title={canEditStatus ? 'Kliknij aby zmienić status' : 'Brak uprawnień'}
            >
              <span className="inline-flex items-center gap-2">
                {statusIcon(currentStatus)}
                <span className="font-medium">{eventStatusLabels[currentStatus]}</span>
              </span>

              <span className="inline-flex items-center gap-2">
                {updatingStatus ? (
                  <Loader2 className="h-4 w-4 animate-spin opacity-80" />
                ) : (
                  <ChevronDown className="h-4 w-4 opacity-80" />
                )}
              </span>
            </button>
          ) : (
            <select
              value={currentStatus}
              onChange={(e) => handleStatusChange(e.target.value as EventStatus)}
              onBlur={() => setStatusEditActive(false)}
              disabled={updatingStatus}
              autoFocus
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-3 py-2 text-sm text-[#e5e4e2] transition-colors focus:border-[#d3bb73] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              {Object.entries(eventStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          )}

          {canEditStatus && statusEditActive && (
            <p className="mt-2 text-xs text-[#e5e4e2]/40">
              Wybierz status. Klik poza polem anuluje edycję.
            </p>
          )}
        </div>

        {isReadyForLive && canAgenda && agenda && (
          <button
            onClick={handleShowPdf}
            className="flex w-full items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/10 px-4 py-2 text-sm text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20"
            title="Generuj / pokaż PDF agendy"
          >
            {agenda.generated_pdf_path ? (
              <FileText className="h-4 w-4" />
            ) : (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Drukuj agendę (PDF)
          </button>
        )}

        {isReadyForLive && canEquipment && (
          <button
            onClick={handleShowChecklistPdf}
            className="flex w-full items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-2 text-sm text-rose-200 transition-colors hover:bg-rose-500/20"
            title="Generuj checklistę sprzętu"
          >
            <Printer className="h-4 w-4" />
            Drukuj checklistę sprzętu
          </button>
        )}
      </div>
    </div>
  );
}