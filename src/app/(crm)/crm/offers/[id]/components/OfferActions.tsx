'use client';

import { Dispatch, SetStateAction, useEffect, useState } from 'react';
import { Pencil, X, Check, Calendar, FileText, Download, RefreshCw, Send, Eye } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useRouter } from 'next/navigation';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { IUser } from '@/types/auth.types';
import { OfferStatus, offerStatusLabels } from '../../helpers/statusColors';

interface OfferActionsProps {
  offer: any;
  currentUser: IUser;
  showSendEmailModal: boolean;
  setShowSendEmailModal: Dispatch<SetStateAction<boolean>>;
}

export default function OfferActions({
  offer,
  currentUser,
  setShowSendEmailModal,
  showSendEmailModal,
}: OfferActionsProps) {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const { employee } = useCurrentEmployee();
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [canSendEmail, setCanSendEmail] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<OfferStatus>(offer?.status || 'draft');

  useEffect(() => {
    if (offer?.status) {
      setCurrentStatus(offer.status as OfferStatus);
    }
  }, [offer?.status]);

  useEffect(() => {
    if (offer && currentUser) {
      const isAdmin = currentUser.permissions?.includes('admin');
      const isCreator = offer.created_by === currentUser.id;
      setCanSendEmail(isAdmin || isCreator);
    }
  }, [offer, currentUser]);

  const handleStatusChange = async (newStatus: OfferStatus) => {
    if (!offer?.id) return;

    const isAdmin = currentUser.permissions?.includes('admin');
    const isCreator = offer.created_by === currentUser.id;
    const canChange = isAdmin || (isCreator && currentUser.permissions?.includes('offers_manage'));

    if (!canChange) {
      showSnackbar('Nie masz uprawnień do zmiany statusu', 'error');
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
      router.refresh();
    } catch (err: any) {
      console.error('Error updating status:', err);
      showSnackbar(err.message || 'Błąd podczas zmiany statusu', 'error');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleGeneratePdf = async () => {
    if (!offer) return;

    if (!employee?.id) {
      showSnackbar('Musisz być zalogowany', 'error');
      return;
    }

    try {
      setGeneratingPdf(true);

      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        showSnackbar('Brak autoryzacji', 'error');
        return;
      }

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
          }),
        },
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Błąd generowania PDF');
      }

      showSnackbar(`PDF wygenerowany pomyślnie (${result.pageCount} stron)`, 'success');

      if (result.downloadUrl) {
        const pdfResponse = await fetch(result.downloadUrl);
        const blob = await pdfResponse.blob();
        const blobUrl = window.URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = result.fileName || 'oferta.pdf';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();

        setTimeout(() => {
          document.body.removeChild(link);
          window.URL.revokeObjectURL(blobUrl);
        }, 100);
      }
    } catch (err: any) {
      console.error('Error generating PDF:', err);
      showSnackbar(err.message || 'Błąd podczas generowania PDF', 'error');
    } finally {
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
      link.download = offer.generated_pdf_url;
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
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Akcje</h2>
      <div className="space-y-2">
        <div className="mb-4">
          <label className="mb-2 block text-sm text-[#e5e4e2]/60">Status oferty</label>
          <select
            value={currentStatus}
            onChange={(e) => handleStatusChange(e.target.value as OfferStatus)}
            disabled={updatingStatus}
            className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-3 py-2 text-sm text-[#e5e4e2] transition-colors focus:border-[#d3bb73] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {Object.entries(offerStatusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={() => {
            if (offer.event_id) {
              router.push(`/crm/events/${offer.event_id}`);
            }
          }}
          disabled={!offer.event_id}
          className="flex w-full items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-4 py-2 text-sm text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Calendar className="h-4 w-4" />
          Przejdź do eventu
        </button>

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
                {offer.modified_after_generation ? 'Regeneruj PDF' : 'Generuj PDF'}
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
              Pokaż PDF
            </button>
            <button
              onClick={handleDownloadPdf}
              className="flex w-full items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/10 px-4 py-2 text-sm text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20"
              title="Pobierz wygenerowany PDF"
            >
              {downloadingPdf ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Pobieranie PDF...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Pobierz PDF
                </>
              )}
            </button>
            {canSendEmail && (
              <button
                onClick={() => setShowSendEmailModal(true)}
                className="flex w-full items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/10 px-4 py-2 text-sm text-[#d3bb73] transition-colors hover:bg-blue-500/20"
                title="Prześlij ofertę e-mailem"
              >
                <Send className="h-4 w-4" />
                Prześlij ofertę e-mailem
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
