'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, FileText, Download, Send, Trash2, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import SendOfferEmailModal from '@/components/crm/SendOfferEmailModal';
import ResponsiveActionBar, { Action } from '@/components/crm/ResponsiveActionBar';
import OfferBasicInfo from './components/OfferBasicInfo';
import OfferActions from './components/OfferActions';
import OfferItems from './components/OfferItems';
import OfferHistory from './components/OfferHistory';

interface OfferItem {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  discount_percent: number;
  discount_amount: number;
  subtotal: number;
  total: number;
  display_order: number;
  product?: {
    id: string;
    name: string;
    description: string;
    pdf_page_url?: string;
    pdf_thumbnail_url?: string;
  };
}

interface Offer {
  id: string;
  offer_number: string;
  event_id: string;
  organization_id: string;
  created_by: string;
  total_amount: number;
  valid_until: string;
  status: string;
  notes: string;
  created_at: string;
  generated_pdf_url?: string;
  organization?: {
    name?: string;
    email?: string;
  };
  event?: {
    name: string;
    event_date: string;
    contact?: {
      email?: string;
      first_name?: string;
      last_name?: string;
    };
  };
  offer_items?: OfferItem[];
}

const statusColors: Record<string, string> = {
  draft: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  sent: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  accepted: 'bg-green-500/20 text-green-400 border-green-500/30',
  rejected: 'bg-red-500/20 text-red-400 border-red-500/30',
  expired: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

const statusLabels: Record<string, string> = {
  draft: 'Szkic',
  sent: 'Wysłana',
  accepted: 'Zaakceptowana',
  rejected: 'Odrzucona',
  expired: 'Wygasła',
};

export default function OfferDetailPage() {
  const router = useRouter();
  const params = useParams();
  const offerId = params.id as string;
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { employee } = useCurrentEmployee();

  const [offer, setOffer] = useState<Offer | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSendEmailModal, setShowSendEmailModal] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [canSendEmail, setCanSendEmail] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  useEffect(() => {
    if (offerId) {
      fetchOfferDetails();
      fetchCurrentUser();
    }
  }, [offerId]);

  const fetchCurrentUser = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: employee } = await supabase
        .from('employees')
        .select('id, permissions')
        .eq('id', user.id)
        .maybeSingle();

      setCurrentUser(employee);
    } catch (err) {
      console.error('Error fetching user:', err);
    }
  };

  useEffect(() => {
    if (offer && currentUser) {
      const isAdmin = currentUser.permissions?.includes('admin');
      const isCreator = offer.created_by === currentUser.id;
      setCanSendEmail(isAdmin || isCreator);
    }
  }, [offer, currentUser]);

  const fetchOfferDetails = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('offers')
        .select(`
          *,
          organization:organizations!organization_id(name, email),
          event:events!event_id(
            name,
            event_date,
            location,
            contact:contacts(email, first_name, last_name)
          ),
          offer_items(
            id,
            product_id,
            quantity,
            unit_price,
            discount_percent,
            discount_amount,
            subtotal,
            total,
            display_order,
            product:offer_products(
              id,
              name,
              description,
              pdf_page_url,
              pdf_thumbnail_url
            )
          )
        `)
        .eq('id', offerId)
        .maybeSingle();

      if (error) {
        console.error('Error fetching offer:', error);
        showSnackbar('Błąd podczas pobierania oferty', 'error');
        return;
      }

      if (!data) {
        showSnackbar('Nie znaleziono oferty', 'error');
        setOffer(null);
        return;
      }

      setOffer(data);
    } catch (err) {
      console.error('Error:', err);
      showSnackbar('Wystąpił błąd', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteOffer = async () => {
    if (!offer) return;

    const confirmed = await showConfirm(
      'Czy na pewno chcesz usunąć tę ofertę?',
      'Tej operacji nie można cofnąć.'
    );

    if (!confirmed) return;

    try {
      const { error: offerError } = await supabase
        .from('offers')
        .delete()
        .eq('id', offerId);

      if (offerError) {
        console.error('Error deleting offer:', offerError);
        showSnackbar('Błąd podczas usuwania oferty', 'error');
        return;
      }

      showSnackbar('Oferta usunięta', 'success');

      if (offer.event_id) {
        router.push(`/crm/events/${offer.event_id}`);
      } else {
        router.push('/crm/offers');
      }
    } catch (err) {
      console.error('Error:', err);
      showSnackbar('Wystąpił błąd', 'error');
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

      const { data: { session } } = await supabase.auth.getSession();
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
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            offerId: offer.id,
            employeeId: employee.id
          }),
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Błąd generowania PDF');
      }

      showSnackbar(`PDF wygenerowany pomyślnie (${result.pageCount} stron)`, 'success');

      await fetchOfferDetails();

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
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    const confirmed = await showConfirm(
      'Czy na pewno chcesz usunąć tę pozycję?',
      'Tej operacji nie można cofnąć.'
    );

    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('offer_items')
        .delete()
        .eq('id', itemId);

      if (error) {
        console.error('Error deleting item:', error);
        showSnackbar('Błąd podczas usuwania pozycji', 'error');
        return;
      }

      showSnackbar('Pozycja usunięta', 'success');
      fetchOfferDetails();
    } catch (err) {
      console.error('Error:', err);
      showSnackbar('Wystąpił błąd', 'error');
    }
  };

  const actions: Action[] = [
    {
      label: 'Usuń',
      onClick: handleDeleteOffer,
      icon: <Trash2 className="w-4 h-4" />,
      variant: 'danger',
      show: true,
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-[#e5e4e2] text-lg">Ładowanie...</div>
      </div>
    );
  }

  if (!offer) {
    return (
      <div className="flex flex-col items-center justify-center h-screen space-y-4">
        <div className="text-[#e5e4e2] text-lg">Oferta nie została znaleziona</div>
        <button
          onClick={() => router.push('/crm/offers')}
          className="bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90"
        >
          Wróć do listy
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/crm/offers')}
            className="p-2 text-[#e5e4e2] hover:bg-[#1c1f33] rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-light text-[#e5e4e2]">
              Oferta {offer.offer_number}
            </h1>
            <p className="text-sm text-[#e5e4e2]/60 mt-1">Szczegóły oferty</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {!offer.generated_pdf_url ? (
            <button
              onClick={handleGeneratePdf}
              disabled={generatingPdf}
              className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73]/10 border border-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Generuje PDF łącząc wszystkie strony produktów"
            >
              {generatingPdf ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Generowanie...
                </>
              ) : (
                <>
                  <FileText className="w-4 h-4" />
                  Generuj PDF
                </>
              )}
            </button>
          ) : (
            <>
              <button
                onClick={handleDownloadPdf}
                className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73]/10 border border-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/20 transition-colors"
                title="Pobierz wygenerowany PDF"
              >
                <Download className="w-4 h-4" />
                Pobierz PDF
              </button>
              <button
                onClick={handleGeneratePdf}
                disabled={generatingPdf}
                className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73]/10 border border-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Generuj PDF ponownie"
              >
                {generatingPdf ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Generowanie...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    Generuj
                  </>
                )}
              </button>
              {canSendEmail && (
                <button
                  onClick={() => setShowSendEmailModal(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/20 transition-colors"
                >
                  <Send className="w-4 h-4" />
                  Wyślij
                </button>
              )}
            </>
          )}

          <ResponsiveActionBar actions={actions} />

          <span
            className={`px-4 py-2 rounded-lg text-sm border ${
              statusColors[offer.status] || 'bg-gray-500/20 text-gray-400'
            }`}
          >
            {statusLabels[offer.status] || offer.status}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <OfferBasicInfo offer={offer} />
            <OfferActions offer={offer} onUpdate={fetchOfferDetails} />
          </div>

          <OfferItems
            items={offer.offer_items || []}
            offerId={offer.id}
            onItemsReordered={fetchOfferDetails}
            onEditItem={(item) => {
              console.log('Edit item:', item);
            }}
            onDeleteItem={handleDeleteItem}
            onPreviewImage={setPreviewImage}
          />

          <OfferHistory offerId={offer.id} />
        </div>

        <div className="space-y-6">
          {/* Tutaj może być jakiś sidebar */}
        </div>
      </div>

      {showSendEmailModal && offer && (
        <SendOfferEmailModal
          offer={offer}
          onClose={() => setShowSendEmailModal(false)}
          onSuccess={() => {
            setShowSendEmailModal(false);
            fetchOfferDetails();
          }}
        />
      )}

      {previewImage && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={() => setPreviewImage(null)}
        >
          <div className="max-w-4xl max-h-[90vh] relative">
            <img
              src={previewImage}
              alt="Preview"
              className="max-w-full max-h-full object-contain"
            />
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute top-4 right-4 bg-red-500 text-white p-2 rounded-full hover:bg-red-600"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
