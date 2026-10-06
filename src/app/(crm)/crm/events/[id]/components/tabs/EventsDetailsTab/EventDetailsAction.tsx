'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
  Mail,
  X,
  CircleDollarSign,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useRouter } from 'next/navigation';
import { IEvent } from '@/app/(crm)/crm/events/type';
import { EventStatus } from '@/components/crm/Calendar/types';

import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { EventCategoryRow } from '@/lib/CRM/events/eventsData.server';
import { EVENT_STATUS_BADGE_CLASSES } from '@/components/crm/events/eventStatusPalette';
import EventAcceptanceConfirmationPreview, { useEventAcceptanceConfirmationPreview } from '@/components/crm/events/EventAcceptanceConfirmationPreview';
import { sendEventAcceptanceConfirmation } from '@/lib/CRM/events/eventAcceptanceConfirmation';

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
  settled: 'Rozliczony',
};

export const statusBadgeClasses: Record<EventStatus, string> = EVENT_STATUS_BADGE_CLASSES;

const categoryBadgeStyle = {
  background: 'linear-gradient(90deg, rgba(127, 23, 52, 0.58), rgba(94, 51, 68, 0.48))',
  borderColor: 'rgba(226, 205, 141, 0.58)',
  color: '#f0dda0',
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
    case 'settled':
      return <CircleDollarSign className="h-4 w-4" />;
    case 'invoiced':
      return <Receipt className="h-4 w-4" />;
    default:
      return null;
  }
};

export interface ContactInfo {
  id?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
}

export interface OrganizationInfo {
  id?: string;
  name?: string;
  alias?: string;
  email?: string;
}

interface EventDetailsActionProps {
  event: IEvent;
  canEditStatus?: boolean;
  categories: EventCategoryRow[];
  hasOffers?: boolean;
  offersCount?: number;
  contact?: ContactInfo | null;
  organization?: OrganizationInfo | null;
}

export default function EventDetailsAction({
  event,
  categories,
  canEditStatus,
  hasOffers = false,
  offersCount = 0,
  contact,
  organization,
}: EventDetailsActionProps) {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const [currentStatus, setCurrentStatus] = useState<EventStatus>(event?.status as EventStatus);
  const [isEditingCategory, setIsEditingCategory] = useState(false);
  const [statusEditActive, setStatusEditActive] = useState(false);
  const { employee } = useCurrentEmployee();
  const [agenda, setAgenda] = useState<any | null>(null);
  const [equipmentChecklist, setEquipmentChecklist] = useState<any | null>(null);

  const [draftStatus, setDraftStatus] = useState<EventStatus>(event?.status as EventStatus);
  const [savingStatus, setSavingStatus] = useState(false);
  const [showSendConfirmation, setShowSendConfirmation] = useState(false);
  const [sendingConfirmationEmail, setSendingConfirmationEmail] = useState(false);
  const sendingConfirmationRef = useRef(false);
  const [confirmationDelivery, setConfirmationDelivery] = useState<{ recipient: string; sentAt: string } | null>(null);
  const [confirmationHistoryError, setConfirmationHistoryError] = useState(false);
  const [confirmationHistoryLoading, setConfirmationHistoryLoading] = useState(true);
  const [confirmationHistoryVersion, setConfirmationHistoryVersion] = useState(0);
  const confirmationPreview = useEventAcceptanceConfirmationPreview(showSendConfirmation ? event?.id || null : null);

  useEffect(() => {
    if (event?.status) {
      setCurrentStatus(event.status as EventStatus);
      setDraftStatus(event.status as EventStatus);
    }
  }, [event?.status]);
  //Category
  const [category, setCategory] = useState<EventCategoryRow | undefined>(
    categories.find((c) => c.id === event?.category_id) ?? undefined,
  );

  useEffect(() => {
    setCategory(categories.find((c) => c.id === event?.category_id) ?? undefined);
  }, [event?.category_id]);

  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(event?.category_id ?? '');
  const [savingCategory, setSavingCategory] = useState(false);

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
    if (event?.status) setCurrentStatus(event.status as EventStatus);
  }, [event?.status]);

  const handleShowChecklistPdf = async () => {
    try {
      // ✅ weź aktualny rekord: albo z state, albo pobierz świeży
      const checklist = equipmentChecklist?.file_path
        ? equipmentChecklist
        : await fetchEquipmentChecklist();

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
        const next = categories.find((c) => c.id === newCategoryId);
        setCategory(next ?? undefined);
      } else {
        setCategory(undefined);
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

  const handleStatusChange = async () => {
    if (!event?.id) return;
    if (draftStatus !== currentStatus && ['in_preparation', 'ready_for_live'].includes(draftStatus)) {
      showSnackbar('Ten status ustawia magazyn podczas przygotowania realizacji.', 'info');
      return;
    }

    try {
      setSavingStatus(true);

      const { error } = await supabase
        .from('events')
        .update({
          status: draftStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', event.id);

      if (error) throw error;

      // When event becomes 'settled', mark all linked non-proforma invoices as paid
      if (draftStatus === 'settled' && currentStatus !== 'settled') {
        const { error: invoiceError } = await supabase
          .from('invoices')
          .update({
            status: 'paid',
            payment_status: 'paid',
            paid_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('event_id', event.id)
          .not('status', 'in', '("paid","cancelled")')
          .neq('invoice_type', 'proforma')
          .or('is_proforma.is.null,is_proforma.eq.false');

        if (invoiceError) {
          console.warn('Error syncing invoices to paid:', invoiceError);
        }
      }

      setCurrentStatus(draftStatus);
      showSnackbar(`Status eventu: ${eventStatusLabels[draftStatus]}`, 'success');
      setStatusEditActive(false);

      if (draftStatus === 'offer_accepted' && currentStatus !== 'offer_accepted') {
        setShowSendConfirmation(true);
      } else {
        router.refresh();
      }
    } catch (err: any) {
      console.error('Error updating status:', err);
      showSnackbar(err?.message || 'Błąd podczas zmiany statusu', 'error');
    } finally {
      setSavingStatus(false);
    }
  };

  const handleSendAcceptedEmail = async () => {
    if (sendingConfirmationRef.current) return;
    const recipientEmail = confirmationPreview.preview?.recipientEmail;
    if (!event?.id || !recipientEmail) {
      showSnackbar('Brak potwierdzonego odbiorcy wiadomości dla tego wydarzenia.', 'error');
      return;
    }
    sendingConfirmationRef.current = true;
    setSendingConfirmationEmail(true);
    try {
      const result = await sendEventAcceptanceConfirmation({ eventId: event.id, expectedRecipientEmail: recipientEmail });
      setConfirmationDelivery({ recipient: result.recipientEmail, sentAt: result.sentAt });
      setConfirmationHistoryError(false);
      showSnackbar(`Wysłano potwierdzenie do ${result.recipientEmail}`, 'success');
      if (!result.historyRecorded) showSnackbar('Wiadomość wysłana, ale nie zapisano historii potwierdzenia. Nie wysyłaj ponownie bez sprawdzenia wiadomości wysłanych.', 'warning');
    } catch (err: any) {
      console.error('[EventDetailsAction] Error sending confirmation email:', err);
      showSnackbar(err?.message || 'Nie udało się wysłać potwierdzenia', 'error');
    } finally {
      setSendingConfirmationEmail(false);
      sendingConfirmationRef.current = false;
      setShowSendConfirmation(false);
      router.refresh();
    }
  };

  const canManageStatus =
    canEditStatus ??
    (employee?.permissions?.includes('events_manage') || employee?.permissions?.includes('admin'));

  const acceptedForConfirmation = ['offer_accepted', 'in_preparation', 'ready_for_live', 'in_progress', 'completed', 'invoiced', 'settled'].includes(currentStatus);
  useEffect(() => {
    let active = true;
    setConfirmationDelivery(null);
    setConfirmationHistoryError(false);
    if (!event.id || !canManageStatus || !acceptedForConfirmation) {
      setConfirmationHistoryLoading(false);
      return;
    }
    setConfirmationHistoryLoading(true);
    supabase.from('event_audit_log').select('new_value,created_at')
      .eq('event_id', event.id).eq('field_name', 'acceptance_confirmation_email').eq('action', 'email_sent')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        setConfirmationHistoryLoading(false);
        setConfirmationHistoryError(Boolean(error));
        if (data) setConfirmationDelivery({ recipient: data.new_value || '', sentAt: data.created_at });
      });
    return () => { active = false; };
  }, [event.id, canManageStatus, acceptedForConfirmation, confirmationHistoryVersion]);

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

  const canOffers =
    employee?.permissions?.includes('offers_manage') || employee?.permissions?.includes('admin');

  const badgeCls = useMemo(() => {
    const base =
      'inline-flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm transition-colors';
    const color = statusBadgeClasses[currentStatus] ?? 'bg-white/5 text-[#e5e4e2] border-white/10';

    const clickable = canManageStatus
      ? 'cursor-pointer hover:bg-white/5'
      : 'cursor-default opacity-80';
    return `${base} ${color} ${clickable}`;
  }, [currentStatus, canManageStatus]);

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Akcje</h2>

      <div className="space-y-2">
        {/* ✅ POPRAWKA: sekcja kategorii nie znika po kliknięciu.
            Zamiast renderować tylko gdy !isEditingCategory, renderujemy zawsze i przełączamy zawartość. */}
        <div>
          <label className="mb-2 block text-sm text-[#e5e4e2]/60">Kategoria</label>

          {!canOffers ? (
            <div
              className="flex w-full items-center gap-2 rounded-lg border px-3 py-2"
              style={categoryBadgeStyle}
            >
              {category?.icon ? (
                <div
                  className="h-4 w-4"
                  style={{ color: '#f0dda0' }}
                  dangerouslySetInnerHTML={{ __html: category.icon.svg_code }}
                />
              ) : (
                <Tag className="h-4 w-4" />
              )}

              <span className="text-sm font-medium">{category?.name ?? 'Brak kategorii'}</span>
            </div>
          ) : !isEditingCategory ? (
            <button
              type="button"
              onClick={() => setIsEditingCategory(true)}
              className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 transition-[background-color,filter] hover:brightness-125"
              style={categoryBadgeStyle}
              title="Kliknij aby edytować kategorię"
            >
              {category?.icon ? (
                <div
                  className="h-4 w-4"
                  style={{ color: '#f0dda0' }}
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
                  Aktualnie: <span className="text-[#e5e4e2]">{category?.name ?? 'brak'}</span>
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

                  {(categories || []).map((c: EventCategoryRow) => (
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

        {canOffers && (
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Oferty</label>
            <div
              className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                hasOffers
                  ? 'border-green-500/20 bg-green-500/10 text-green-300'
                  : 'border-orange-500/20 bg-orange-500/10 text-orange-300'
              }`}
            >
              <FileText className="h-4 w-4" />
              <span className="font-medium">
                {hasOffers
                  ? `${offersCount} ofert${offersCount === 1 ? 'a' : offersCount < 5 ? 'y' : ''}`
                  : 'Brak oferty'}
              </span>
            </div>
          </div>
        )}

        {canAgenda && (
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Status eventu</label>

            {!statusEditActive ? (
              <button
                type="button"
                className={badgeCls}
                onClick={() => {
                  if (!canManageStatus) return;

                  setDraftStatus(currentStatus);
                  setStatusEditActive(true);
                }}
                disabled={!canManageStatus}
                title={canManageStatus ? 'Kliknij aby zmienić status' : 'Brak uprawnień'}
              >
                <span className="inline-flex items-center gap-2">
                  {statusIcon(currentStatus)}
                  <span className="font-medium">{eventStatusLabels[currentStatus]}</span>
                </span>

                <ChevronDown className="h-4 w-4 opacity-80" />
              </button>
            ) : (
              <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs text-[#e5e4e2]/60">
                    Aktualnie:{' '}
                    <span className="text-[#e5e4e2]">{eventStatusLabels[currentStatus]}</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setDraftStatus(currentStatus);
                      setStatusEditActive(false);
                    }}
                    className="rounded-md px-2 py-1 text-xs text-[#e5e4e2]/60 hover:bg-white/5 hover:text-[#e5e4e2]"
                  >
                    Anuluj
                  </button>
                </div>

                <div className="space-y-3">
                  <select
                    value={draftStatus}
                    onChange={(e) => setDraftStatus(e.target.value as EventStatus)}
                    disabled={savingStatus}
                    autoFocus
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-3 py-2 text-sm text-[#e5e4e2] transition-colors focus:border-[#d3bb73] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {['in_preparation', 'ready_for_live'].includes(currentStatus) && (
                      <option value={currentStatus} disabled>{eventStatusLabels[currentStatus]} · status magazynu</option>
                    )}
                    {Object.entries(eventStatusLabels).filter(([value]) => !['in_preparation', 'ready_for_live'].includes(value)).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>

                  <div className="flex items-center justify-between">
                    <div className="text-xs text-[#e5e4e2]/40">
                      {savingStatus ? 'Zapisuję…' : 'Wybierz status i zapisz zmianę'}
                    </div>

                    <button
                      type="button"
                      onClick={handleStatusChange}
                      disabled={savingStatus || draftStatus === currentStatus}
                      className="inline-flex items-center gap-2 rounded-md border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-3 py-1.5 text-xs font-medium text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {savingStatus && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Zapisz
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {canManageStatus && acceptedForConfirmation && (
          <div className="space-y-2">
            {confirmationHistoryLoading ? (
              <p className="text-xs text-[#e5e4e2]/50">Sprawdzam potwierdzenie e-mail…</p>
            ) : confirmationHistoryError ? (
              <p role="alert" className="text-xs text-amber-300">Nie udało się sprawdzić historii wysyłki. <button type="button" onClick={() => setConfirmationHistoryVersion((value) => value + 1)} className="underline">Ponów</button></p>
            ) : (
              <>
                <button type="button" onClick={() => setShowSendConfirmation(true)} disabled={sendingConfirmationEmail}
                  className="flex w-full items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/20 disabled:opacity-50">
                  <Mail className="h-4 w-4" />
                  {confirmationDelivery ? 'Wyślij potwierdzenie ponownie' : 'Wyślij potwierdzenie do klienta'}
                </button>
                {confirmationDelivery && (
                  <div>
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" />Potwierdzenie wysłane e-mailem</span>
                    <p className="mt-1 break-all text-xs text-[#e5e4e2]/50">{new Date(confirmationDelivery.sentAt).toLocaleString('pl-PL')} · {confirmationDelivery.recipient}</p>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {!isReadyForLive && agenda && (
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

      {showSendConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-light text-[#e5e4e2]">
                <Mail className="h-5 w-5 text-[#d3bb73]" />
                Potwierdzenie email
              </h2>
              <button
                onClick={() => {
                  setShowSendConfirmation(false);
                  router.refresh();
                }}
                disabled={sendingConfirmationEmail}
                className="text-[#e5e4e2]/60 hover:text-[#e5e4e2] disabled:opacity-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="mb-6 text-sm leading-relaxed text-[#e5e4e2]/80">
              {confirmationDelivery ? 'Potwierdzenie zostało już wysłane. Czy wysłać je ponownie do klienta?' : 'Czy wysłać e-mail z potwierdzeniem realizacji do klienta?'}
            </p>

            <div className="mb-4"><EventAcceptanceConfirmationPreview {...confirmationPreview} /></div>

            <div className="flex gap-3">
              <button
                onClick={handleSendAcceptedEmail}
                disabled={sendingConfirmationEmail || confirmationPreview.loading || !confirmationPreview.preview?.recipientEmail}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
              >
                {sendingConfirmationEmail ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Wysyłanie...
                  </>
                ) : (
                  <>
                    <Mail className="h-4 w-4" />
                    Wyślij
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  setShowSendConfirmation(false);
                  router.refresh();
                }}
                disabled={sendingConfirmationEmail}
                className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33] disabled:opacity-50"
              >
                Pomiń
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
