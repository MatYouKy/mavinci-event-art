'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  ArrowLeft,
  Trash2,
  Pencil,
  X,
  Check,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import SendOfferEmailModal from '@/components/crm/SendOfferEmailModal';
import ResponsiveActionBar, { Action } from '@/components/crm/ResponsiveActionBar';

import OfferActions from './components/OfferActions';
import OfferItems from './components/OfferItems';
import OfferHistory from './components/OfferHistory';
import { OfferDetails } from './components/OfferDetails';
import OfferBasicInfo, { OfferBasicInfoHandle } from './components/OfferBasicInfo';
import AddOfferItemModal from './components/AddOfferItemModal';
import EditOfferItemModal from './components/EditOfferItemModal';
import { usePrefetchOffer } from '../hooks/usePrefetchOffer';
import { useOfferById } from '../hooks/useOfferById';
import { IOfferItem } from '../types';


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

  usePrefetchOffer(offerId);
  const { offer, isLoading, refetch } = useOfferById(offerId);


  const [showSendEmailModal, setShowSendEmailModal] = useState(false);
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<IOfferItem | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [canSendManage, setCanSendManage] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const basicInfoRef = useRef<OfferBasicInfoHandle | null>(null);

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
      setCanSendManage(isAdmin || isCreator);
    }
  }, [offer, currentUser]);

  const handleDeleteOffer = useCallback(async () => {
    if (!offer) return;

    const confirmed = await showConfirm(
      'Czy na pewno chcesz usunąć tę ofertę?',
      'Tej operacji nie można cofnąć.',
    );

    if (!confirmed) return;

    try {
      const { error: offerError } = await supabase.from('offers').delete().eq('id', offerId);
      const { error: cleanupError } = await supabase.rpc('delete_offer_with_cleanup', {
        p_offer_id: offerId,
      });

      if (offerError) {
        console.error('Error deleting offer:', offerError);
        showSnackbar('Błąd podczas usuwania oferty', 'error');
        return;
      }

      if (cleanupError) {
        console.error('Error deleting offer:', cleanupError);
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
    setIsEditing(false);
  };

  const actions = useMemo(() => {
    if (!canSendManage) return [] as Action[];

    const result: Action[] = [];

    // Edytuj / Zapisz
    result.push({
      label: isEditing ? 'Zapisz' : 'Edytuj',
      onClick: () => {
        if (isEditing) {
          basicInfoRef.current?.submit();
        } else {
          setIsEditing(true);
        }
      },
      icon: isEditing ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />,
      variant: 'primary',
      show: true,
    });

    // Anuluj w trybie edycji
    if (isEditing) {
      result.push({
        label: 'Anuluj',
        onClick: () => setIsEditing(false),
        icon: <X className="h-4 w-4" />,
        variant: 'danger',
        show: true,
      });
    }

    // Usuń zawsze dostępny dla zarządzających
    result.push({
      label: 'Usuń',
      onClick: handleDeleteOffer,
      icon: <Trash2 className="h-4 w-4" />,
      variant: 'danger',
      show: true,
    });

    return result;
  }, [canSendManage, isEditing, handleDeleteOffer]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-lg text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  if (!offer) {
    return (
      <div className="flex h-screen flex-col items-center justify-center space-y-4">
        <div className="text-lg text-[#e5e4e2]">Oferta nie została znaleziona</div>
        <button
          onClick={() => router.push('/crm/offers')}
          className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
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
            className="rounded-lg p-2 text-[#e5e4e2] transition-colors hover:bg-[#1c1f33]"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-light text-[#e5e4e2]">Oferta {offer.offer_number}</h1>
            <p className="mt-1 text-sm text-[#e5e4e2]/60">Szczegóły oferty</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {canSendManage && <ResponsiveActionBar actions={actions} />}

          <span
            className={`rounded-lg border px-4 py-2 text-sm ${
              statusColors[offer.status] || 'bg-gray-500/20 text-gray-400'
            }`}
          >
            {statusLabels[offer.status] || offer.status}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <OfferBasicInfo
            ref={basicInfoRef}
            offer={offer}
            isEditing={isEditing}
            onUpdate={handleOfferUpdated}
          />

          <OfferItems
            items={offer.offer_items || []}
            offerId={offer.id}
            onItemsReordered={refetch}
            onEditItem={(item) => {
              setEditingItem(item as IOfferItem);
            }}
            onDeleteItem={handleDeleteItem}
            onPreviewImage={setPreviewImage}
            onAddItem={() => setShowAddItemModal(true)}
          />

          <OfferHistory offerId={offer.id} />
        </div>

        <div className="space-y-6">
          <OfferDetails offer={offer} />
          <OfferActions
            offer={offer}
            currentUser={currentUser}
            showSendEmailModal={showSendEmailModal}
            setShowSendEmailModal={setShowSendEmailModal}
          />
        </div>
      </div>

      {showSendEmailModal && offer && (
        <SendOfferEmailModal
          offerId={offer.id}
          offerNumber={offer.offer_number}
          clientEmail={offer.organization?.email}
          clientName={offer.organization?.name}
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
          onClose={() => setEditingItem(null)}
          onSuccess={refetch}
        />
      )}

      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-h-[90vh] max-w-4xl">
            <img
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
