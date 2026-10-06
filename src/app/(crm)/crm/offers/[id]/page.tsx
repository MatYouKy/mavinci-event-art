'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import SystemBadge from '@/components/UI/SystemBadge';
import { offerSource } from '@/lib/CRM/Offers/offerSource';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import SendOfferEmailModal from '@/components/crm/SendOfferEmailModal';
import ResponsiveActionBar, { Action } from '@/components/crm/ResponsiveActionBar';

import OfferActions from './components/OfferActions';
import OfferItems from './components/OfferItems';
import OfferHistory from './components/OfferHistory';
import { OfferDetails } from './components/OfferDetails';
import OfferBasicInfo from './components/OfferBasicInfo';
import AddOfferItemModal from './components/AddOfferItemModal';
import EditOfferItemModal from './components/EditOfferItemModal';
import { usePrefetchOffer } from '../hooks/usePrefetchOffer';
import { useOfferById } from '../hooks/useOfferById';
import { IOfferItem } from '../types';
import { deleteOfferWithFiles } from '@/lib/CRM/Offers/deleteOfferWithFiles';
import Image from 'next/image';
import InquirySourceContextPanel from '@/components/crm/inquiries/InquirySourceContextPanel';
import OfferPackagesEditor from './components/OfferPackagesEditor';
import OfferRecommendationsEditor from './components/OfferRecommendationsEditor';
import OfferRequirementsEditor from './components/OfferRequirementsEditor';
import SellerOfferWorkflow from '@/components/seller/SellerOfferWorkflow';
import { useDispatch } from 'react-redux';
import { eventsApi } from '@/app/(crm)/crm/events/store/api/eventsApi';

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
  const dispatch = useDispatch();
  const router = useRouter();
  const params = useParams();
  const offerId = params.id as string;
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();

  usePrefetchOffer(offerId);
  const { offer, isLoading, error: offerLoadError, refetch } = useOfferById(offerId);

  const [showSendEmailModal, setShowSendEmailModal] = useState(false);
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<IOfferItem | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [canSendManage, setCanSendManage] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isEditingStatus, setIsEditingStatus] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState('draft');


  useEffect(() => {
    if (offerId) {
      fetchCurrentUser();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerId]);

  const fetchCurrentUser = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: employee } = await supabase
        .from('employees')
        .select('id, permissions')
        .or(`id.eq.${user.id},auth_user_id.eq.${user.id}`)
        .maybeSingle();

      setCurrentUser(employee);
    } catch (err) {
      console.error('Error fetching user:', err);
    }
  };

  useEffect(() => {
    let active = true;
    if (offer?.id) void supabase.rpc('sales_can_manage_offer', { p_offer: offer.id }).then(({ data, error }) => { if (active) setCanSendManage(!error && data === true && offer.status !== 'accepted'); });
    return () => { active = false; };
  }, [offer, currentUser]);

  useEffect(() => {
    if (offer) {
      setSelectedStatus(offer.status);
    }
  }, [offer]);

  const handleDeleteOffer = useCallback(async () => {
    if (!offer) return;

    const confirmMessage = offer.event_id
      ? 'Czy na pewno chcesz usunąć tę ofertę?\n\nSprzęt automatycznie dodany z tej oferty zostanie usunięty z eventu.\nWszystkie pliki PDF zostaną usunięte.'
      : 'Czy na pewno chcesz usunąć tę ofertę?\nWszystkie pliki PDF zostaną usunięte.';

    const confirmed = await showConfirm(confirmMessage, 'Tej operacji nie można cofnąć.');

    if (!confirmed) return;

    try {
      const result = await deleteOfferWithFiles(offerId);

      if (!result.success) {
        showSnackbar(result.error || 'Błąd podczas usuwania oferty', 'error');
        return;
      }

      showSnackbar('Oferta i wszystkie pliki zostały usunięte', 'success');

      // Przekieruj do listy ofert (nie do eventu)
      router.push('/crm/offers');
    } catch (err) {
      console.error('Error:', err);
      showSnackbar('Wystąpił błąd', 'error');
    }
  }, [offer, offerId, router, showConfirm, showSnackbar]);

  const handleDeleteItem = async (itemId: string) => {
    const confirmed = await showConfirm(
      'Czy na pewno chcesz usunąć tę pozycję?',
      'Tej operacji nie można cofnąć.',
    );

    if (!confirmed) return;

    try {
      const { error } = await supabase.from('offer_items').delete().eq('id', itemId);

      if (error) {
        console.error('Error deleting item:', error);
        showSnackbar('Błąd podczas usuwania pozycji', 'error');
        return;
      }

      showSnackbar('Pozycja usunięta', 'success');
      refetch();
    } catch (err) {
      console.error('Error:', err);
      showSnackbar('Wystąpił błąd', 'error');
    }
  };

  const handleOfferUpdated = () => {
    refetch();
  };

  const handleUpdateStatus = async () => {
    if (!offer || selectedStatus === offer.status) {
      setIsEditingStatus(false);
      return;
    }

    if (selectedStatus === 'accepted') {
      showSnackbar('Użyj akceptacji wariantu w zapytaniu lub przycisku rezerwacji sprzętu.', 'warning');
      if (offer.inquiry_id && !offer.event_id) router.push(`/crm/inquiries/${offer.inquiry_id}?tab=offers`);
      return;
    }

    try {
      const { error } = await supabase
        .from('offers')
        .update({ status: selectedStatus })
        .eq('id', offerId);

      if (error) throw error;

      showSnackbar('Status oferty zaktualizowany', 'success');
      refetch();
      setIsEditingStatus(false);
    } catch (err) {
      console.error('Error updating status:', err);
      showSnackbar('Błąd podczas aktualizacji statusu', 'error');
    }
  };

  const handleOfferItemUpdated = async () => {
    await refetch();
    setEditingItem(null);
  };

  const actions = useMemo(() => {
    if (!canSendManage) return [] as Action[];

    const result: Action[] = [];

    // Usuń zawsze dostępny dla zarządzających
    result.push({
      label: 'Usuń',
      onClick: handleDeleteOffer,
      icon: <Trash2 className="h-4 w-4" />,
      variant: 'danger',
      show: true,
    });

    return result;
  }, [canSendManage, handleDeleteOffer]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-lg text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  if (!offer) {
    const errorData = (offerLoadError as any)?.data;
    const errorMessage = errorData?.message || errorData?.data?.message || '';
    const isMissing = errorMessage.toLocaleLowerCase('pl-PL').includes('nie znaleziono');
    return (
      <div className="flex h-screen flex-col items-center justify-center space-y-4">
        <div className="text-lg text-[#e5e4e2]">
          {isMissing ? 'Oferta nie została znaleziona' : 'Nie udało się pobrać oferty'}
        </div>
        {!isMissing && errorMessage && (
          <div className="max-w-xl text-center text-sm text-red-300/80">{errorMessage}</div>
        )}
        {!isMissing && (
          <button data-crm-action="secondary"
            onClick={() => refetch()}
            className="rounded-lg border border-[#d3bb73]/30 px-4 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/10"
          >
            Spróbuj ponownie
          </button>
        )}
        <button
          onClick={() => router.push('/crm/offers')}
          className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
        >
          Wróć do listy
        </button>
      </div>
    );
  }

  const inquiryDetails = offer.inquiry?.inquiry_details || {};
  const inquirySourceHref = inquiryDetails.received_email_id
    ? `/crm/messages/${inquiryDetails.received_email_id}?type=received`
    : inquiryDetails.source_message_id
      ? `/crm/messages/${inquiryDetails.source_message_id}?type=contact`
      : null;
  const offerContact = offer.client_type === 'business'
    ? offer.contact_person || offer.contact || offer.event?.contact
    : offer.contact || offer.event?.contact;
  const offerClientName = offerContact?.full_name
    || [offerContact?.first_name, offerContact?.last_name].filter(Boolean).join(' ')
    || offer.organization?.alias
    || offer.organization?.name
    || [offer.event?.contact?.first_name, offer.event?.contact?.last_name].filter(Boolean).join(' ')
    || inquiryDetails.client_text;
  const offerClientEmail = offerContact?.email || offer.organization?.email || inquiryDetails.client_email;
  const offerClientPhone = offerContact?.mobile || offerContact?.phone || inquiryDetails.client_phone;
  const offerTitle = String(
    offer.title
      || offer.event?.name
      || offer.inquiry?.title?.replace(/^Zapytanie:\s*/i, '')
      || 'Bez tytułu',
  ).trim();

  const source = offerSource(offer);

  const offerContent = <>
    <OfferBasicInfo offer={offer} canEdit={canSendManage && (offer as any).sales_channel !== 'seller_portal'} onUpdate={handleOfferUpdated} />
    <OfferItems
      items={offer.offer_items || []}
      offerId={offer.id}
      vatRate={offer.tax_percent ?? 23}
      onItemsReordered={refetch}
      onEditItem={(item) => { setEditingItem(item as IOfferItem); }}
      onDeleteItem={handleDeleteItem}
      onPreviewImage={setPreviewImage}
      onAddItem={() => setShowAddItemModal(true)}
    />
    <OfferRequirementsEditor offer={offer} canEdit={canSendManage} onSaved={refetch} />
    <OfferPackagesEditor offer={offer} canEdit={canSendManage} onSaved={refetch} />
    <OfferRecommendationsEditor key={offer.id} offer={offer} canEdit={canSendManage} onSaved={refetch} />
    <OfferHistory offerId={offer.id} />
  </>;

  const offerInformation = <>
    {(offer as any).sales_channel !== 'seller_portal' && <OfferActions
      offer={offer}
      currentUser={currentUser}
      showSendEmailModal={showSendEmailModal}
      setShowSendEmailModal={setShowSendEmailModal}
      onOfferUpdated={refetch}
      onEditOfferItem={itemId => {
        const item = offer.offer_items?.find((entry: IOfferItem) => entry.id === itemId);
        if (item) setEditingItem(item);
      }}
    />}
    {offer.inquiry && <InquirySourceContextPanel
      inquiryTitle={offer.inquiry.title?.replace(/^Zapytanie:\s*/i, '') || offer.title || 'Zapytanie'}
      message={inquiryDetails.source_message_content || offer.inquiry.description}
      sourceLabel={inquiryDetails.source || inquiryDetails.source_name || 'Zapytanie'}
      clientName={offerClientName}
      clientEmail={offerClientEmail}
      clientPhone={offerClientPhone}
      sourceHref={inquirySourceHref}
      items={[
        { label: 'Termin', value: inquiryDetails.termin || offer.inquiry.due_date || offer.event?.event_date, kind: 'date' },
        { label: 'Miejsce', value: inquiryDetails.location_text || offer.event?.location, kind: 'location' },
        { label: 'Zakres', value: inquiryDetails.scope || inquiryDetails.event_type, kind: 'scope' },
      ]}
    />}
    <OfferDetails offer={offer} canEdit={canSendManage} onSaved={refetch} />
  </>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="mt-4 flex items-center gap-4">
          <button
            onClick={() => router.push('/crm/offers')}
            className="rounded-lg p-2 text-[#e5e4e2] transition-colors hover:bg-[#1c1f33]"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-light text-[#e5e4e2]">Oferta {offer.offer_number}</h1>
              {source && <SystemBadge value={source.kind} domain="source" />}
            </div>
            <p className="mt-1 max-w-3xl text-sm text-[#e5e4e2]/60">{offerTitle}</p>
          </div>
        </div>

        {canSendManage && (offer as any).sales_channel !== 'seller_portal' && <ResponsiveActionBar actions={actions} alwaysDropdown />}
      </div>

      {(offer as any).sales_channel === 'seller_portal' ? (
        <SellerOfferWorkflow key={offerId} offerId={offerId} crm sidebarContent={offerInformation} onChanged={() => {
          void refetch();
          dispatch(eventsApi.util.invalidateTags(['Events', 'EventDetails', 'EventOffers']));
        }}>
          {offerContent}
        </SellerOfferWorkflow>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">{offerContent}</div>
          <div className="min-w-0 space-y-6 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain">{offerInformation}</div>
        </div>
      )}

      {showSendEmailModal && offer && (
        <SendOfferEmailModal
          offerId={offer.id}
          offerNumber={offer.offer_number}
          clientEmail={offerClientEmail}
          clientName={offerClientName}
          eventId={offer.event_id || undefined}
          onClose={() => setShowSendEmailModal(false)}
          onSent={handleOfferUpdated}
        />
      )}

      {showAddItemModal && offer && (
        <AddOfferItemModal
          offerId={offer.id}
          onClose={() => setShowAddItemModal(false)}
          onSuccess={refetch}
        />
      )}

      {editingItem && (
        <EditOfferItemModal
          item={editingItem}
          offerId={offer.id}
          vatRate={offer.tax_percent ?? 23}
          onClose={() => setEditingItem(null)}
          onSuccess={handleOfferItemUpdated}
        />
      )}

      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-h-[90vh] max-w-4xl">
            <Image
              width={1000}
              height={1000}
              src={previewImage}
              alt="Preview"
              className="max-h-full max-w-full object-contain"
            />
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute right-4 top-4 rounded-full bg-red-500 p-2 text-white hover:bg-red-600"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
