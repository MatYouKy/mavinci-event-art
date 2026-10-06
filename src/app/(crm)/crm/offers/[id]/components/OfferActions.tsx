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
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useRouter } from 'next/navigation';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { IUser } from '@/types/auth.types';
import { OfferStatus, offerStatusLabels } from '../../helpers/statusColors';
import ReserveEquipmentModal from '@/components/crm/ReserveEquipmentModal';
import FullScreenLoader from '@/components/UI/Loader/CustomModalLoader';
import { offerSource } from '@/lib/CRM/Offers/offerSource';
import { offerPdfFileName } from '@/lib/CRM/Offers/offerPdfFileName';
import { deleteOfferPdfFiles } from '@/lib/CRM/Offers/deleteOfferPdfFiles';

interface OfferActionsProps {
  offer: any;
  currentUser: IUser;
  showSendEmailModal: boolean;
  setShowSendEmailModal: Dispatch<SetStateAction<boolean>>;
  onOfferUpdated?: () => void;
  onEditOfferItem?: (itemId: string) => void;
}

export default function OfferActions({
  offer,
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
  const { employee } = useCurrentEmployee();
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [canSendEmail, setCanSendEmail] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<OfferStatus>(offer?.status || 'draft');
  const [showReserveModal, setShowReserveModal] = useState(false);
  const [deletingPdf, setDeletingPdf] = useState(false);

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

  const handleGeneratePdf = async () => {
    if (!offer || generationInProgress.current) return;
    if (offer.status !== 'accepted' && offer.logistics_cost_net == null) {
      showSnackbar('Oszacuj logistykę w sekcji „Pakiety oferty”. Wpisz 0, jeśli nie ma dodatkowego kosztu.', 'error');
      document.getElementById('offer-packages-logistics')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    if (!employee?.id) {
      showSnackbar('Musisz być zalogowany', 'error');
      return;
    }

    generationInProgress.current = true;
    try {
      setPdfProgress('Przygotowujemy strony oferty, zdjęcia i kalkulację. Proszę chwilę poczekać.');
      setGeneratingPdf(true);

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        showSnackbar('Brak autoryzacji', 'error');
        return;
      }

      let result: any = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/generate-offer-pdf`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              offerId: offer.id,
              employeeId: employee.id,
              resourceMode: attempt === 0 ? 'standard' : 'compact',
            }),
          },
        );

        result = await response.json().catch(() => ({}));
        if (response.ok && result.success) break;

        const resourceLimit = response.status === 546 || ['WORKER_RESOURCE_LIMIT', 'WORKER_LIMIT'].includes(result.code);
        if (resourceLimit && attempt === 0) {
          setPdfProgress('Przygotowanie dokumentu wymaga więcej czasu. Ponawiamy generowanie z zachowaniem jakości zdjęć i wybranego układu.');
          showSnackbar('Generator przekroczył limit zasobów — ponawiam w trybie zoptymalizowanym...', 'info');
          await new Promise((resolve) => setTimeout(resolve, 1200));
          continue;
        }

        throw new Error(
          resourceLimit
            ? 'Generator PDF chwilowo przekroczył limit zasobów. Spróbuj ponownie za chwilę.'
            : result.error || result.message || 'Błąd generowania PDF',
        );
      }

      if (!result?.success) throw new Error('Błąd generowania PDF');

      showSnackbar(
        `PDF wygenerowany pomyślnie (${result.pageCount} stron)${result.resourceMode === 'compact' ? ' — tryb zoptymalizowany' : ''}`,
        'success',
      );

      if (result.downloadUrl) {
        setPdfProgress('PDF jest gotowy. Przygotowujemy pobranie pliku…');
        const pdfResponse = await fetch(result.downloadUrl);
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
      showSnackbar(err.message || 'Błąd podczas generowania PDF', 'error');
    } finally {
      generationInProgress.current = false;
      setGeneratingPdf(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!offer?.generated_pdf_url) return;

    try {
      setDownloadingPdf(true);
      const { data, error } = await supabase.storage
        .from('generated-offers')
        .createSignedUrl(offer.generated_pdf_url, 3600);

      if (error || !data) {
        throw new Error('Nie udało się pobrać PDF');
      }

      const response = await fetch(data.signedUrl);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = offerPdfFileName(offer.offer_number);
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

          {/* Przycisk Zarezerwuj Sprzęt - tylko dla draft/sent */}
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
              {currentStatus === 'accepted' ? 'Aktualizuj rezerwację' : 'Zarezerwuj sprzęt'}
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

          {!offer.generated_pdf_url || offer.modified_after_generation ? (
            <button
              disabled={generatingPdf}
              onClick={handleGeneratePdf}
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
                  {offer.generated_pdf_url ? 'Regeneruj PDF' : 'Generuj PDF'}
                </>
              )}
            </button>
          ) : (
            <>
              <button
                onClick={async () => {
                  if (!offer.generated_pdf_url) return;
                  try {
                    const { data } = await supabase.storage
                      .from('generated-offers')
                      .createSignedUrl(offer.generated_pdf_url, 3600);
                    if (data?.signedUrl) {
                      window.open(data.signedUrl, '_blank');
                    }
                  } catch (err) {
                    showSnackbar('Błąd podczas otwierania PDF', 'error');
                  }
                }}
                className="flex w-full items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/10 px-4 py-2 text-sm text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20"
                title="Pokaż PDF"
              >
                <Eye className="h-4 w-4" />
                Podgląd PDF
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
                    Pobierz PDF
                  </>
                )}
              </button>
              <button
                disabled={generatingPdf}
                onClick={handleGeneratePdf}
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
                    Regeneruj PDF
                  </>
                )}
              </button>
              {canSendEmail && (
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
          {offer.generated_pdf_url && (
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
        show={generatingPdf}
        title="Generowanie oferty PDF"
        description={pdfProgress}
      />

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
