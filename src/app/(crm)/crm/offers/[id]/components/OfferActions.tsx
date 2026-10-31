'use client';

import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react';
import {
  Pencil,
  X,
  Check,
  Calendar,
  FileText,
  Download,
  RefreshCw,
  Send,
  Eye,
  Lock,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { requestOfferEnglish } from '@/hooks/useOfferLanguage';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useRouter } from 'next/navigation';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { IUser } from '@/types/auth.types';
import { OfferStatus, offerStatusLabels } from '../../helpers/statusColors';
import ConvertInquiryModal from '@/components/crm/inquiries/ConvertInquiryModal';
import OfferDraftRevisionActions from './OfferDraftRevisionActions';
import OfferLinkModal from './OfferLinkModal';
import ReserveEquipmentModal from '@/components/crm/ReserveEquipmentModal';
import FullScreenLoader from '@/components/UI/Loader/CustomModalLoader';
import OfferPdfProgressSteps from '@/components/crm/offers/OfferPdfProgressSteps';
import { OFFER_PDF_STEPS, type OfferPdfStep, type OfferPdfFailure } from '@/lib/offer-pdf/progress';
import { readOfferPdfResult } from '@/lib/offer-pdf/readProgress';
import { offerSource } from '@/lib/CRM/Offers/offerSource';
import { offerPdfFileName } from '@/lib/CRM/Offers/offerPdfFileName';
import { deleteOfferPdfFiles } from '@/lib/CRM/Offers/deleteOfferPdfFiles';

interface OfferActionsProps {
  language?: 'pl' | 'en';
  englishReady?: boolean;
  englishSignature?: string;
  onEnglishStale?: () => void;
  offer: any;
  currentUser: IUser;
  showSendEmailModal: boolean;
  setShowSendEmailModal: Dispatch<SetStateAction<boolean>>;
  onOfferUpdated?: () => void;
  onEditOfferItem?: (itemId: string) => void;
}

export default function OfferActions({
  offer,
  language = 'pl',
  englishReady = false,
  englishSignature,
  onEnglishStale,
  currentUser,
  setShowSendEmailModal,
  showSendEmailModal,
  onOfferUpdated,
  onEditOfferItem,
}: OfferActionsProps) {
  const router = useRouter();
  const source = offerSource(offer || {});
  const { showSnackbar } = useSnackbar();
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const generationInProgress = useRef(false);
  const [pdfProgress, setPdfProgress] = useState('');
  const [pdfStep, setPdfStep] = useState<OfferPdfStep>('queued');
  const [pdfFailure, setPdfFailure] = useState<OfferPdfFailure | null>(null);
  const [copiedPdfFailure, setCopiedPdfFailure] = useState(false);
  const [englishPdf, setEnglishPdf] = useState<{ file_path: string; file_name: string; source_revision: number } | null>(null);
  useEffect(() => {
    let active = true;
    if (offer?.id && !generatingPdf) void supabase.from('offer_language_documents').select('file_path,file_name,source_revision').eq('offer_id', offer.id).eq('language', 'en').order('created_at', { ascending: false }).limit(1).maybeSingle().then(({ data }) => { if (active) setEnglishPdf(data); });
    return () => { active = false; };
  }, [offer?.id, generatingPdf]);
  const selectedPdfPath = language === 'en' ? englishPdf?.file_path : offer?.generated_pdf_url;
  const selectedFileName = language === 'en' ? englishPdf?.file_name || offerPdfFileName(offer.offer_number).replace(/\.pdf$/i, '-EN.pdf') : offerPdfFileName(offer.offer_number);
  const selectedPdfStale = language === 'en' ? englishPdf?.source_revision !== offer.content_revision : offer.modified_after_generation;
  const canGenerate = language === 'pl' || englishReady;
  const { employee } = useCurrentEmployee();
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [canSendEmail, setCanSendEmail] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<OfferStatus>(offer?.status || 'draft');
  const [showReserveModal, setShowReserveModal] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [conversionData, setConversionData] = useState<{ inquiry: any; categories: any[]; companies: any[] } | null>(null);
  const [loadingConversion, setLoadingConversion] = useState(false);
  const conversionLock = useRef(false);
  const openEventCreation = async () => {
    if (conversionLock.current || !canSendEmail || !offer.inquiry_id) return;
    conversionLock.current = true; setLoadingConversion(true);
    try {
      const [inquiryResult, categoriesResult, companiesResult] = await Promise.all([
        supabase.from('tasks').select('id,title,inquiry_details,due_date,accepted_offer_id,event_id,contact_id,organization_id')
          .eq('id', offer.inquiry_id).eq('is_inquiry', true).is('archived_at', null).single(),
        supabase.from('event_categories').select('id,name').eq('is_active', true).order('order_index'),
        supabase.from('my_companies').select('id,name,legal_name,is_default').eq('is_active', true).order('is_default', { ascending: false }),
      ]);
      if (inquiryResult.error) throw inquiryResult.error;
      if (categoriesResult.error) throw categoriesResult.error;
      if (companiesResult.error) throw companiesResult.error;
      const inquiry = inquiryResult.data;
      if (inquiry.event_id) { router.push(`/crm/events/${inquiry.event_id}`); return; }
      if (inquiry.accepted_offer_id !== offer.id) throw new Error('W zapytaniu wybierz tę ofertę jako zaakceptowaną przed utworzeniem wydarzenia.');
      setConversionData({ inquiry: { ...inquiry, title: offer.title || inquiry.title }, categories: categoriesResult.data || [], companies: companiesResult.data || [] });
    } catch (error: any) { showSnackbar(error.message || 'Nie udało się otworzyć formularza wydarzenia', 'error'); }
    finally { conversionLock.current = false; setLoadingConversion(false); }
  };
  const [deletingPdf, setDeletingPdf] = useState(false);
  const [amendmentSource, setAmendmentSource] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setAmendmentSource(null);
    if (offer?.id) void supabase.from('offer_amendments').select('source_offer_id')
      .eq('offer_id', offer.id).maybeSingle().then(({ data }) => {
        if (active) setAmendmentSource(data?.source_offer_id ?? null);
      });
    return () => { active = false; };
  }, [offer?.id]);


  useEffect(() => {
    if (offer?.status) {
      setCurrentStatus(offer.status as OfferStatus);
    }
  }, [offer?.status]);

  useEffect(() => {
    let active = true;
    if (offer?.id) void supabase.rpc('sales_can_manage_offer', { p_offer: offer.id }).then(({ data, error }) => { if (active) setCanSendEmail(!error && data === true); });
    return () => { active = false; };
  }, [offer, currentUser]);

  const handleStatusChange = async (newStatus: OfferStatus) => {
    if (!offer?.id) return;

    const canChange = canSendEmail;

    if (!canChange) {
      showSnackbar('Nie masz uprawnień do zmiany statusu', 'error');
      return;
    }

    if (newStatus === 'accepted' && offer.inquiry_id && !offer.event_id) { router.push(`/crm/inquiries/${offer.inquiry_id}?tab=offers`); return; }

    // Event-linked acceptance always uses the existing reservation/acceptance workflow.
    if (
      newStatus === 'accepted' &&
      currentStatus !== 'accepted' &&
      offer.event_id
    ) {
      setShowReserveModal(true);
      return;
    }

    try {
      setUpdatingStatus(true);

      const { error } = await supabase
        .from('offers')
        .update({ status: newStatus })
        .eq('id', offer.id);

      if (error) throw error;

      setCurrentStatus(newStatus);
      showSnackbar(`Status oferty zmieniony na: ${offerStatusLabels[newStatus]}`, 'success');

      if (onOfferUpdated) {
        onOfferUpdated();
      } else {
        router.refresh();
      }
    } catch (err: any) {
      console.error('Error updating status:', err);
      showSnackbar(err.message || 'Błąd podczas zmiany statusu', 'error');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleDeletePdf = async () => {
    if (!offer?.id) return;

    if (
      !confirm(
        'Czy na pewno chcesz usunąć pliki PDF tej oferty?\n\nOferta zostanie zachowana, zostaną usunięte tylko wygenerowane pliki PDF.',
      )
    ) {
      return;
    }

    try {
      setDeletingPdf(true);

      const result = await deleteOfferPdfFiles(offer.id);

      if (!result.success) {
        throw new Error(result.error || 'Błąd podczas usuwania plików PDF');
      }

      showSnackbar('Pliki PDF zostały usunięte', 'success');

      // Odśwież dane oferty aby zaktualizować przyciski
      onOfferUpdated?.();
    } catch (err: any) {
      console.error('Error deleting PDF files:', err);
      showSnackbar(err.message || 'Błąd podczas usuwania plików PDF', 'error');
    } finally {
      setDeletingPdf(false);
    }
  };

  const handleGeneratePdf = async (selectedLanguage: 'pl' | 'en' = language) => {
    if (!offer || generationInProgress.current || (selectedLanguage === 'en' && !englishReady)) return;
    const language = selectedLanguage;


    if (!employee?.id) {
      showSnackbar('Musisz być zalogowany', 'error');
      return;
    }

    generationInProgress.current = true;
    let lastStep: OfferPdfStep = 'queued';
    let lastDetail = 'Przygotowanie zlecenia generowania.';
    let failureMeta: { code?: string; requestId?: string; status?: number } = {};
    try {
      setPdfFailure(null);
      setCopiedPdfFailure(false);
      setPdfStep('queued');
      setPdfProgress(language === 'en' ? 'Sprawdzamy zapisaną wersję EN i przygotowujemy zlecenie.' : 'Przygotowujemy zlecenie generowania.');
      setGeneratingPdf(true);

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error('Brak autoryzacji. Zaloguj się ponownie.');

      if (language === 'en') {
        lastDetail = 'Sprawdzanie zapisanej wersji angielskiej.';
        const saved = await requestOfferEnglish(offer.id, 'read');
        if (!saved.ready || saved.signature !== englishSignature) {
          onEnglishStale?.();
          throw new Error('Angielska treść wymaga aktualizacji. Poczekaj na przygotowanie EN i ponów generowanie.');
        }
      }
      let result: any = null;
      for (let attempt = 0; attempt < 1; attempt += 1) {
        const response = await fetch(
          '/bridge/offers/generate-pdf',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/x-ndjson',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              offerId: offer.id,
              language,
              expectedEnglishSignature: language === 'en' ? englishSignature : undefined,
              employeeId: employee.id,
              resourceMode: attempt === 0 ? 'standard' : 'compact',
            }),
            signal: AbortSignal.timeout(300000),
          },
        );

        result = await readOfferPdfResult(response, progress => {
          lastStep = progress.step;
          lastDetail = progress.detail || '';
          setPdfStep(progress.step);
          setPdfProgress(progress.detail || OFFER_PDF_STEPS.find(step => step.id === progress.step)?.label || 'Generujemy PDF…');
        });
        if (response.ok && result.success) break;

        if (OFFER_PDF_STEPS.some(step => step.id === result.failedStep)) {
          lastStep = result.failedStep;
          setPdfStep(lastStep);
        }
        failureMeta = { code: result.code, requestId: result.requestId, status: result.httpStatus || response.status };
        const resourceLimit = response.status === 546 || ['WORKER_RESOURCE_LIMIT', 'WORKER_LIMIT'].includes(result.code);

        throw new Error(
          resourceLimit
            ? 'Generator PDF chwilowo przekroczył limit zasobów. Spróbuj ponownie za chwilę.'
            : result.error || result.message || 'Błąd generowania PDF',
        );
      }

      if (!result?.success) throw new Error('Błąd generowania PDF');

      // Refresh the saved document before attempting its separate download.
      onOfferUpdated?.();

      showSnackbar(
        `PDF wygenerowany pomyślnie (${result.pageCount} stron)${result.resourceMode === 'compact' ? ' — tryb zoptymalizowany' : ''}`,
        'success',
      );

      if (result.downloadUrl) {
        lastStep = 'download';
        lastDetail = 'PDF został wygenerowany i zapisany. Pobieranie pliku.';
        failureMeta = { requestId: result.requestId };
        setPdfStep('download');
        setPdfProgress('PDF jest gotowy. Pobieramy zapisany plik…');
        const pdfResponse = await fetch(result.downloadUrl, { signal: AbortSignal.timeout(30000) });
        if (!pdfResponse.ok) {
          failureMeta.status = pdfResponse.status;
          throw new Error('PDF został wygenerowany, ale pobranie nie powiodło się. Użyj przycisku pobierania oferty.');
        }
        const blob = await pdfResponse.blob();
        const blobUrl = window.URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = result.downloadFileName || offerPdfFileName(offer.offer_number);
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();

        setTimeout(() => {
          document.body.removeChild(link);
          window.URL.revokeObjectURL(blobUrl);
        }, 100);
      }

      onOfferUpdated?.();
    } catch (err: any) {
      console.error('Error generating PDF:', err);
      const timeout = ['TimeoutError', 'AbortError'].includes(err?.name);
      const connectionLost = timeout || err instanceof TypeError || /Utracono połączenie/.test(err?.message || '');
      const message = lastStep === 'download' && connectionLost
        ? 'PDF został zapisany, ale pobieranie zostało przerwane. Zamknij okno i użyj przycisku pobierania oferty.'
        : timeout ? 'Przekroczono czas oczekiwania. Serwer może nadal zapisać PDF — odśwież ofertę i sprawdź plik przed ponowieniem.'
        : err.message || 'Błąd podczas generowania PDF';
      setPdfFailure({ step: lastStep, message, context: `${connectionLost ? 'Ostatni potwierdzony etap. ' : ''}${lastDetail}`, ...failureMeta, occurredAt: new Date().toISOString() });
      setPdfProgress('Szczegóły są widoczne pod odpowiednim krokiem.');
    } finally {
      generationInProgress.current = false;
      setGeneratingPdf(false);
      onOfferUpdated?.();
    }
  };

  const handleDownloadPdf = async () => {
    if (!selectedPdfPath) return;

    try {
      setDownloadingPdf(true);
      const { data, error } = await supabase.storage
        .from('generated-offers')
        .createSignedUrl(selectedPdfPath, 3600);

      if (error || !data) {
        throw new Error('Nie udało się pobrać PDF');
      }

      const response = await fetch(data.signedUrl);
      if (!response.ok) throw new Error('Nie udało się pobrać pliku PDF. Spróbuj ponownie.');
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = selectedFileName;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();

      setTimeout(() => {
        document.body.removeChild(link);
        window.URL.revokeObjectURL(blobUrl);
      }, 100);

      showSnackbar('Pobieranie PDF...', 'success');
    } catch (err: any) {
      console.error('Error downloading PDF:', err);
      showSnackbar(err.message || 'Błąd podczas pobierania PDF', 'error');
    } finally {
      setDownloadingPdf(false);
    }
  };

  return (
    <>
      {conversionData && <ConvertInquiryModal {...conversionData} initialEventLocation={offer.event_location || null} initialEventDate={offer.event_date || offer.event?.event_date || null}
        onClose={() => setConversionData(null)}
        onBeforeConvert={async () => {
          const { data, error } = await supabase.from('tasks').select('accepted_offer_id,contact_id,organization_id')
            .eq('id', conversionData.inquiry.id).eq('is_inquiry', true).is('archived_at', null).single();
          if (error) throw error;
          if (data.accepted_offer_id !== offer.id) throw new Error('Zaakceptowana oferta w zapytaniu zmieniła się. Otwórz formularz ponownie.');
          if (!data.contact_id && !data.organization_id) throw new Error('Uzupełnij klienta w powiązanym zapytaniu przed utworzeniem wydarzenia.');
        }}
        onConverted={(eventId) => { setConversionData(null); onOfferUpdated?.(); router.push(`/crm/events/${eventId}`); }} />}
      {showLinkModal && <OfferLinkModal offer={offer} onClose={() => setShowLinkModal(false)}
        onSaved={() => { onOfferUpdated?.(); router.refresh(); }} />}
      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Akcje</h2>
        <div className="space-y-2">
          <div className="mb-4">
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Status oferty</label>
            <select
              value={currentStatus}
              onChange={(e) => handleStatusChange(e.target.value as OfferStatus)}
              disabled={updatingStatus || !canSendEmail || (offer.inquiry_id && currentStatus === 'accepted')}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-3 py-2 text-sm text-[#e5e4e2] transition-colors focus:border-[#d3bb73] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              {Object.entries(offerStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {canSendEmail && offer.sales_channel !== 'seller_portal' && <OfferDraftRevisionActions offer={offer} onSaved={() => { onOfferUpdated?.(); router.refresh(); }} />}
          {amendmentSource && currentStatus !== 'accepted' && (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              Edytujesz zmianę oferty. Poprzednia rezerwacja pozostaje aktywna do zatwierdzenia tej wersji.
              {' '}<a className="underline" href={`/crm/offers/${amendmentSource}`}>Poprzednia oferta</a>
            </p>
          )}
          {/* Akceptacja zmiany zastępuje poprzednią rezerwację w jednej transakcji. */}
          {canSendEmail && offer.event_id && (currentStatus === 'draft' ||
            currentStatus === 'sent' ||
            currentStatus === 'accepted') && (
            <button
              onClick={() => setShowReserveModal(true)}
              className="flex w-full items-center gap-2 rounded-lg bg-green-500/10 px-4 py-2 text-sm text-green-400 transition-colors hover:bg-green-500/20"
            >
              {currentStatus === 'accepted' ? (
                <RefreshCw className="h-4 w-4" />
              ) : (
                <Lock className="h-4 w-4" />
              )}
              {currentStatus === 'accepted' ? 'Aktualizuj rezerwację' : amendmentSource ? 'Zatwierdź zmianę i rezerwację' : 'Zarezerwuj sprzęt'}
            </button>
          )}

          {canSendEmail && currentStatus === 'accepted' && !offer.event_id && offer.inquiry_id && offer.sales_channel !== 'seller_portal' && (
            <button type="button" disabled={loadingConversion} onClick={() => void openEventCreation()}
              className="flex w-full items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm text-black disabled:opacity-50">
              <Calendar className="h-4 w-4" />
              {loadingConversion ? 'Wczytywanie…' : 'Utwórz wydarzenie'}
            </button>
          )}
          {canSendEmail && offer.sales_channel !== 'seller_portal' && (!offer.event_id || !offer.inquiry_id) && (
            <button type="button" onClick={() => setShowLinkModal(true)}
              className="flex w-full items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-4 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/20">
              <Calendar className="h-4 w-4" />
              {!offer.event_id ? 'Powiąż z wydarzeniem lub zapytaniem' : 'Powiąż z zapytaniem'}
            </button>
          )}
          {source && <button
            type="button"
            onClick={() => router.push(source.href)}
            className="flex w-full items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-4 py-2 text-sm text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20"
          >
            {source.kind === 'event' ? <Calendar className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
            {source.actionLabel}
          </button>}

          {source?.kind === 'event' && offer.inquiry_id && (
            <button
              type="button"
              onClick={() => router.push(`/crm/inquiries/${offer.inquiry_id}`)}
              className="flex w-full items-center gap-2 rounded-lg bg-[#d3bb73]/5 px-4 py-2 text-sm text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10"
            >
              <FileText className="h-4 w-4" />
              Przejdź do zapytania
            </button>
          )}

          <p className="text-xs text-white/60">Język dokumentu: <strong>{language.toUpperCase()}</strong> · kwoty w PLN</p>
          {!selectedPdfPath ? (
            <button
              disabled={generatingPdf || !canGenerate}
              onClick={() => void handleGeneratePdf(language)}
              className="flex w-full items-center gap-2 rounded-lg bg-blue-500/10 px-4 py-2 text-sm text-blue-400 transition-colors hover:bg-blue-500/20"
            >
              {generatingPdf ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Generowanie...
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4" />
                  Generuj PDF ({language.toUpperCase()})
                </>
              )}
            </button>
          ) : (
            <>
              {selectedPdfStale && (
                <p role="status" className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  Zapisany PDF nie zawiera ostatnich zmian oferty. Możesz go obejrzeć lub pobrać. Przed wysłaniem wygeneruj aktualną wersję.
                </p>
              )}
              <button
                onClick={async () => {
                  if (!selectedPdfPath) return;
                  try {
                    const { data, error } = await supabase.storage
                      .from('generated-offers')
                      .createSignedUrl(selectedPdfPath, 3600);
                    if (error || !data?.signedUrl) throw error || new Error('Brak adresu PDF');
                    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
                  } catch (err) {
                    showSnackbar('Błąd podczas otwierania PDF', 'error');
                  }
                }}
                className="flex w-full items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/10 px-4 py-2 text-sm text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20"
                title="Pokaż PDF"
              >
                <Eye className="h-4 w-4" />
                Pokaż PDF ({language.toUpperCase()})
              </button>
              <button
                onClick={handleDownloadPdf}
                disabled={downloadingPdf}
                className="flex w-full items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/10 px-4 py-2 text-sm text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20 disabled:opacity-50"
                title="Pobierz wygenerowany PDF"
              >
                {downloadingPdf ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Pobieranie...
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    Pobierz PDF ({language.toUpperCase()})
                  </>
                )}
              </button>
              <button
                disabled={generatingPdf || !canGenerate}
                onClick={() => void handleGeneratePdf(language)}
                className="flex w-full items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/10 px-4 py-2 text-sm text-blue-400 transition-colors hover:bg-blue-500/20 disabled:opacity-50"
                title="Wygeneruj ponownie PDF"
              >
                {generatingPdf ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Generowanie...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    Regeneruj PDF ({language.toUpperCase()})
                  </>
                )}
              </button>
              {language === 'pl' && canSendEmail && !offer.modified_after_generation && (
                <button
                  onClick={() => setShowSendEmailModal(true)}
                  className="flex w-full items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/10 px-4 py-2 text-sm text-green-400 transition-colors hover:bg-green-500/20"
                  title="Wyślij ofertę e-mailem"
                >
                  <Send className="h-4 w-4" />
                  Wyślij ofertę
                </button>
              )}
            </>
          )}

          {/* Przycisk usuwania PDF - tylko gdy PDF istnieje */}
          {language === 'pl' && offer.generated_pdf_url && (
            <button
              onClick={handleDeletePdf}
              disabled={deletingPdf}
              className="flex w-full items-center gap-2 rounded-lg border border-orange-500/20 bg-orange-500/10 px-4 py-2 text-sm text-orange-400 transition-colors hover:bg-orange-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deletingPdf ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Usuwanie PDF...
                </>
              ) : (
                <>
                  <X className="h-4 w-4" />
                  Usuń PDF
                </>
              )}
            </button>
          )}


        </div>
      </div>

      <FullScreenLoader
        show={generatingPdf || !!pdfFailure}
        failed={!!pdfFailure}
        onClose={() => setPdfFailure(null)}
        title={pdfFailure ? (pdfFailure.step === 'download' ? 'PDF zapisany — błąd pobierania' : 'Nie udało się ukończyć generowania PDF') : 'Generowanie oferty PDF'}
        description={pdfProgress}
      >
        <OfferPdfProgressSteps current={pdfStep} failure={pdfFailure} />
        {pdfFailure && <div className="flex w-full flex-wrap justify-end gap-2">
          <button type="button" className="rounded-lg bg-white/5 px-3 py-2 text-sm text-[#d3bb73] hover:bg-white/10" onClick={async () => {
            const step = OFFER_PDF_STEPS.find(item => item.id === pdfFailure.step)?.label;
            const details = [
              `Oferta: ${offer.id}`, `Czas: ${pdfFailure.occurredAt}`, `Etap: ${step}`,
              pdfFailure.context, `Błąd: ${pdfFailure.message}`,
              pdfFailure.code && `Kod: ${pdfFailure.code}`,
              pdfFailure.status && `HTTP: ${pdfFailure.status}`,
              pdfFailure.requestId && `Identyfikator zgłoszenia: ${pdfFailure.requestId}`,
            ].filter(Boolean).join('\n');
            try { await navigator.clipboard.writeText(details); setCopiedPdfFailure(true); }
            catch { showSnackbar('Nie udało się skopiować. Możesz zaznaczyć i skopiować komunikat ręcznie.', 'error'); }
          }}>{copiedPdfFailure ? 'Skopiowano' : 'Kopiuj szczegóły'}</button>
          <button type="button" onClick={() => setPdfFailure(null)} className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#210914] hover:brightness-110">Zamknij</button>
        </div>}
      </FullScreenLoader>

      {/* Modal rezerwacji sprzętu */}
      <ReserveEquipmentModal
        offerId={offer?.id}
        open={showReserveModal}
        onEditOfferItem={onEditOfferItem}
        onClose={() => setShowReserveModal(false)}
        onSuccess={() => {
          setCurrentStatus('accepted');
          if (onOfferUpdated) {
            onOfferUpdated();
          } else {
            router.refresh();
          }
        }}
      />
    </>
  );
}
