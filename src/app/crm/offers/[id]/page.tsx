'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, FileText, Plus, Trash2, DollarSign, Calendar, Building2, CreditCard as Edit, Save, X, Pencil, AlertTriangle, Send, Download } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import SendOfferEmailModal from '@/components/crm/SendOfferEmailModal';

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

  const [offer, setOffer] = useState<Offer | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [editedNotes, setEditedNotes] = useState('');
  const [isEditingNumber, setIsEditingNumber] = useState(false);
  const [editedNumber, setEditedNumber] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showSendEmailModal, setShowSendEmailModal] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [canSendEmail, setCanSendEmail] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [editFormData, setEditFormData] = useState({
    valid_until: '',
    notes: '',
  });
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItemData, setEditingItemData] = useState<Partial<OfferItem>>({});
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

      if (error || !data) {
        console.error('Error fetching offer:', error);
        setOffer(null);
        setLoading(false);
        return;
      }

      setOffer(data);
      setLoading(false);
    } catch (err) {
      console.error('Error:', err);
      setLoading(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!offer) return;

    try {
      const { error } = await supabase
        .from('offers')
        .update({ status: newStatus })
        .eq('id', offerId);

      if (error) {
        console.error('Error updating status:', error);
        showSnackbar('Błąd podczas aktualizacji statusu', 'error');
        return;
      }

      showSnackbar('Status oferty zaktualizowany', 'success');
      fetchOfferDetails();
    } catch (err) {
      console.error('Error:', err);
      showSnackbar('Wystąpił błąd', 'error');
    }
  };

  const handleSaveNotes = async () => {
    if (!offer) return;

    try {
      const { error } = await supabase
        .from('offers')
        .update({ notes: editedNotes })
        .eq('id', offerId);

      if (error) {
        console.error('Error updating notes:', error);
        showSnackbar('Błąd podczas zapisywania notatek', 'error');
        return;
      }

      setOffer({ ...offer, notes: editedNotes });
      setIsEditingNotes(false);
      showSnackbar('Notatki zaktualizowane', 'success');
    } catch (err) {
      console.error('Error:', err);
      showSnackbar('Wystąpił błąd', 'error');
    }
  };

  const handleSaveNumber = async () => {
    if (!offer) return;

    if (!editedNumber.trim()) {
      showSnackbar('Numer oferty nie może być pusty', 'error');
      return;
    }

    try {
      const { error } = await supabase
        .from('offers')
        .update({ offer_number: editedNumber })
        .eq('id', offerId);

      if (error) {
        console.error('Error updating offer number:', error);
        if (error.message.includes('już istnieje')) {
          showSnackbar('Ten numer oferty już istnieje. Proszę wybrać inny.', 'error');
        } else {
          showSnackbar('Błąd podczas zapisywania numeru oferty', 'error');
        }
        return;
      }

      setOffer({ ...offer, offer_number: editedNumber });
      setIsEditingNumber(false);
      showSnackbar('Numer oferty zaktualizowany', 'success');
    } catch (err) {
      console.error('Error:', err);
      showSnackbar('Wystąpił błąd', 'error');
    }
  };

  const handleDeleteOffer = async () => {
    if (!offer) return;

    const confirmed = await showConfirm({
      title: 'Usunąć ofertę?',
      message: `Czy na pewno chcesz usunąć ofertę ${offer.offer_number}? Ta operacja jest nieodwracalna.`,
      confirmText: 'Usuń ofertę',
      cancelText: 'Anuluj',
    });

    if (!confirmed) return;

    try {
      // Najpierw usuń pozycje oferty
      const { error: itemsError } = await supabase
        .from('offer_items')
        .delete()
        .eq('offer_id', offerId);

      if (itemsError) {
        console.error('Error deleting offer items:', itemsError);
        showSnackbar('Błąd podczas usuwania pozycji oferty', 'error');
        return;
      }

      // Potem usuń ofertę
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

      // Przekieruj do eventu jeśli jest event_id, inaczej do listy ofert
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

  const handleEditOffer = () => {
    if (!offer) return;
    setEditFormData({
      valid_until: offer.valid_until || '',
      notes: offer.notes || '',
    });
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!offer) return;

    try {
      const { error } = await supabase
        .from('offers')
        .update({
          valid_until: editFormData.valid_until || null,
          notes: editFormData.notes || null,
        })
        .eq('id', offerId);

      if (error) {
        console.error('Error updating offer:', error);
        showSnackbar('Błąd podczas zapisywania zmian', 'error');
        return;
      }

      showSnackbar('Oferta zaktualizowana', 'success');
      setShowEditModal(false);
      fetchOfferDetails();
    } catch (err) {
      console.error('Error:', err);
      showSnackbar('Wystąpił błąd', 'error');
    }
  };

  const handleGeneratePdf = async () => {
    if (!offer) return;

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
          body: JSON.stringify({ offerId: offer.id }),
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Błąd generowania PDF');
      }

      showSnackbar(`PDF wygenerowany pomyślnie (${result.pageCount} stron)`, 'success');

      if (result.downloadUrl) {
        window.open(result.downloadUrl, '_blank');
      }

      fetchOfferDetails();
    } catch (err: any) {
      console.error('Error generating PDF:', err);
      showSnackbar(err.message || 'Błąd podczas generowania PDF', 'error');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const getClientName = (offer: Offer) => {
    if (offer.organization?.name) return offer.organization.name;
    return 'Brak klienta';
  };

  const handleStartEditItem = (item: OfferItem) => {
    setEditingItemId(item.id);
    setEditingItemData({
      quantity: item.quantity,
      unit_price: item.unit_price,
      discount_percent: item.discount_percent || 0,
      discount_amount: item.discount_amount || 0,
    });
  };

  const handleCancelEditItem = () => {
    setEditingItemId(null);
    setEditingItemData({});
  };

  const calculateItemTotal = (quantity: number, unitPrice: number, discountPercent: number, discountAmount: number) => {
    const subtotal = quantity * unitPrice;
    const percentDiscount = subtotal * (discountPercent / 100);
    const totalDiscount = percentDiscount + discountAmount;
    const total = subtotal - totalDiscount;
    return { subtotal, total };
  };

  const handleSaveItemEdit = async (itemId: string) => {
    if (!editingItemData.quantity || !editingItemData.unit_price) {
      showSnackbar('Ilość i cena jednostkowa są wymagane', 'error');
      return;
    }

    try {
      const { subtotal, total } = calculateItemTotal(
        editingItemData.quantity!,
        editingItemData.unit_price!,
        editingItemData.discount_percent || 0,
        editingItemData.discount_amount || 0
      );

      const { error } = await supabase
        .from('offer_items')
        .update({
          quantity: editingItemData.quantity,
          unit_price: editingItemData.unit_price,
          discount_percent: editingItemData.discount_percent || 0,
          discount_amount: editingItemData.discount_amount || 0,
          subtotal,
          total,
        })
        .eq('id', itemId);

      if (error) {
        console.error('Error updating item:', error);
        showSnackbar('Błąd podczas zapisywania', 'error');
        return;
      }

      // Pobierz zaktualizowane dane i przelicz total_amount oferty
      await fetchOfferDetails();
      await updateOfferTotalAmount();

      setEditingItemId(null);
      setEditingItemData({});
      showSnackbar('Pozycja zaktualizowana', 'success');
    } catch (err) {
      console.error('Error:', err);
      showSnackbar('Wystąpił błąd', 'error');
    }
  };

  const updateOfferTotalAmount = async () => {
    try {
      const { data: items } = await supabase
        .from('offer_items')
        .select('total')
        .eq('offer_id', offerId);

      if (!items) return;

      const totalAmount = items.reduce((sum, item) => sum + (item.total || 0), 0);

      await supabase
        .from('offers')
        .update({ total_amount: totalAmount })
        .eq('id', offerId);
    } catch (err) {
      console.error('Error updating total amount:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
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
              {offer.offer_number || 'Oferta'}
            </h1>
            <p className="text-sm text-[#e5e4e2]/60 mt-1">Szczegóły oferty</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleGeneratePdf}
            disabled={generatingPdf}
            className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73]/10 border border-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Generuje PDF łącząc wszystkie strony produktów"
          >
            <Download className="w-4 h-4" />
            {generatingPdf ? 'Generowanie...' : 'Generuj PDF'}
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
          <button
            onClick={handleEditOffer}
            className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73]/10 border border-[#d3bb73]/20 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/20 transition-colors"
          >
            <Pencil className="w-4 h-4" />
            Edytuj
          </button>
          <button
            onClick={handleDeleteOffer}
            className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg hover:bg-red-500/20 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Usuń
          </button>
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
          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <h2 className="text-lg font-light text-[#e5e4e2] mb-4">
              Informacje podstawowe
            </h2>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <FileText className="w-5 h-5 text-[#d3bb73] mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm text-[#e5e4e2]/60">Numer oferty</p>
                    {!isEditingNumber && (
                      <button
                        onClick={() => {
                          setEditedNumber(offer.offer_number || '');
                          setIsEditingNumber(true);
                        }}
                        className="text-[#d3bb73] hover:text-[#d3bb73]/80 text-sm"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  {isEditingNumber ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={editedNumber}
                        onChange={(e) => setEditedNumber(e.target.value)}
                        className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-3 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                        placeholder="np. OF/2025/10/001"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={handleSaveNumber}
                          className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90"
                        >
                          <Save className="w-3 h-3" />
                          Zapisz
                        </button>
                        <button
                          onClick={() => setIsEditingNumber(false)}
                          className="px-3 py-1.5 rounded-lg text-sm text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
                        >
                          Anuluj
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[#e5e4e2]">{offer.offer_number || 'Brak numeru'}</p>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Building2 className="w-5 h-5 text-[#d3bb73] mt-0.5" />
                <div>
                  <p className="text-sm text-[#e5e4e2]/60">Klient</p>
                  <p className="text-[#e5e4e2]">{getClientName(offer)}</p>
                </div>
              </div>

              {offer.event && (
                <div className="flex items-start gap-3">
                  <Calendar className="w-5 h-5 text-[#d3bb73] mt-0.5" />
                  <div>
                    <p className="text-sm text-[#e5e4e2]/60">Event</p>
                    <p className="text-[#e5e4e2]">{offer.event.name}</p>
                    <p className="text-sm text-[#e5e4e2]/40 mt-1">
                      {new Date(offer.event.event_date).toLocaleString('pl-PL', {
                        dateStyle: 'full',
                        timeStyle: 'short',
                      })}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex items-start gap-3">
                <DollarSign className="w-5 h-5 text-[#d3bb73] mt-0.5" />
                <div>
                  <p className="text-sm text-[#e5e4e2]/60">Wartość oferty</p>
                  <p className="text-2xl font-light text-[#d3bb73]">
                    {offer.total_amount
                      ? offer.total_amount.toLocaleString('pl-PL')
                      : '0'}{' '}
                    zł
                  </p>
                </div>
              </div>

              {offer.valid_until && (
                <div className="flex items-start gap-3">
                  <Calendar className="w-5 h-5 text-[#d3bb73] mt-0.5" />
                  <div>
                    <p className="text-sm text-[#e5e4e2]/60">Ważna do</p>
                    <p className="text-[#e5e4e2]">
                      {new Date(offer.valid_until).toLocaleDateString('pl-PL')}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-light text-[#e5e4e2]">Notatki</h2>
              {!isEditingNotes && (
                <button
                  onClick={() => {
                    setEditedNotes(offer.notes || '');
                    setIsEditingNotes(true);
                  }}
                  className="text-[#d3bb73] hover:text-[#d3bb73]/80 text-sm"
                >
                  <Edit className="w-4 h-4" />
                </button>
              )}
            </div>
            {isEditingNotes ? (
              <div className="space-y-3">
                <textarea
                  value={editedNotes}
                  onChange={(e) => setEditedNotes(e.target.value)}
                  className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg p-3 text-[#e5e4e2] min-h-[120px] focus:outline-none focus:border-[#d3bb73]"
                  placeholder="Dodaj notatki..."
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveNotes}
                    className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90"
                  >
                    <Save className="w-4 h-4" />
                    Zapisz
                  </button>
                  <button
                    onClick={() => setIsEditingNotes(false)}
                    className="px-4 py-2 rounded-lg text-sm text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
                  >
                    Anuluj
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-[#e5e4e2]/80 leading-relaxed">
                {offer.notes || 'Brak notatek'}
              </p>
            )}
          </div>

          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <h2 className="text-lg font-light text-[#e5e4e2] mb-4">
              Pozycje oferty
            </h2>
            {!offer.offer_items || offer.offer_items.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
                <p className="text-[#e5e4e2]/60 mb-4">
                  Brak pozycji w ofercie
                </p>
                <button className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 mx-auto">
                  <Plus className="w-4 h-4" />
                  Dodaj pozycję
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {offer.offer_items
                  .sort((a, b) => a.display_order - b.display_order)
                  .map((item) => {
                    const isEditing = editingItemId === item.id;
                    return (
                      <div
                        key={item.id}
                        className="bg-[#0a0d1a] border border-[#d3bb73]/10 rounded-lg p-3 hover:border-[#d3bb73]/20 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          {/* Miniaturka - mniejsza */}
                          <div
                            className="relative w-16 h-20 rounded overflow-hidden bg-[#1c1f33] border border-[#d3bb73]/10 flex-shrink-0 cursor-pointer hover:border-[#d3bb73]/30 transition-colors"
                            onClick={async () => {
                              if (item.product?.pdf_page_url) {
                                const { data } = await supabase.storage
                                  .from('offer-product-pages')
                                  .createSignedUrl(item.product.pdf_page_url, 3600);
                                if (data?.signedUrl) setPreviewImage(data.signedUrl);
                              }
                            }}
                          >
                            {item.product?.pdf_thumbnail_url ? (
                              <img
                                src={`${supabase.storage.from('offer-product-pages').getPublicUrl(item.product.pdf_thumbnail_url).data.publicUrl}`}
                                alt={item.product?.name || 'Produkt'}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  (async () => {
                                    const { data } = await supabase.storage
                                      .from('offer-product-pages')
                                      .createSignedUrl(item.product?.pdf_thumbnail_url!, 3600);
                                    if (data?.signedUrl) {
                                      (e.target as HTMLImageElement).src = data.signedUrl;
                                    }
                                  })();
                                }}
                              />
                            ) : (
                              <FileText className="w-6 h-6 text-[#e5e4e2]/20" />
                            )}
                          </div>

                          {/* Nazwa produktu */}
                          <div className="flex-1 min-w-0">
                            <h3 className="text-sm text-[#e5e4e2] font-medium truncate">
                              {item.product?.name || 'Produkt bez nazwy'}
                            </h3>
                          </div>

                          {/* Edytowalne pola lub wartości */}
                          {isEditing ? (
                            <>
                              <div className="flex items-center gap-2">
                                <div className="w-20">
                                  <input
                                    type="number"
                                    value={editingItemData.quantity || ''}
                                    onChange={(e) => setEditingItemData({ ...editingItemData, quantity: Number(e.target.value) })}
                                    className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-2 py-1 text-xs text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                                    placeholder="Ilość"
                                    min="1"
                                  />
                                </div>
                                <span className="text-xs text-[#e5e4e2]/60">×</span>
                                <div className="w-24">
                                  <input
                                    type="number"
                                    value={editingItemData.unit_price || ''}
                                    onChange={(e) => setEditingItemData({ ...editingItemData, unit_price: Number(e.target.value) })}
                                    className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-2 py-1 text-xs text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                                    placeholder="Cena"
                                    min="0"
                                    step="0.01"
                                  />
                                </div>
                                <div className="w-20">
                                  <input
                                    type="number"
                                    value={editingItemData.discount_percent || ''}
                                    onChange={(e) => setEditingItemData({ ...editingItemData, discount_percent: Number(e.target.value) })}
                                    className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-2 py-1 text-xs text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                                    placeholder="Rabat %"
                                    min="0"
                                    max="100"
                                  />
                                </div>
                                <div className="w-24">
                                  <input
                                    type="number"
                                    value={editingItemData.discount_amount || ''}
                                    onChange={(e) => setEditingItemData({ ...editingItemData, discount_amount: Number(e.target.value) })}
                                    className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-2 py-1 text-xs text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                                    placeholder="Rabat zł"
                                    min="0"
                                    step="0.01"
                                  />
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => handleSaveItemEdit(item.id)}
                                  className="p-1.5 bg-[#d3bb73] text-[#1c1f33] rounded hover:bg-[#d3bb73]/90 transition-colors"
                                  title="Zapisz"
                                >
                                  <Save className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={handleCancelEditItem}
                                  className="p-1.5 text-[#e5e4e2]/60 hover:bg-[#1c1f33] rounded transition-colors"
                                  title="Anuluj"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="flex items-center gap-4 text-xs">
                                <div className="text-[#e5e4e2]/80">
                                  <span className="font-medium">{item.quantity}</span>
                                  <span className="text-[#e5e4e2]/60"> szt.</span>
                                </div>
                                <div className="text-[#e5e4e2]/80">
                                  <span className="font-medium">{item.unit_price.toLocaleString('pl-PL')}</span>
                                  <span className="text-[#e5e4e2]/60"> zł/szt.</span>
                                </div>
                                {(item.discount_percent > 0 || item.discount_amount > 0) && (
                                  <div className="text-red-400 text-xs">
                                    {item.discount_percent > 0 && `-${item.discount_percent}%`}
                                    {item.discount_amount > 0 && ` -${item.discount_amount.toLocaleString('pl-PL')} zł`}
                                  </div>
                                )}
                              </div>
                              <div className="text-right min-w-[100px]">
                                <div className="text-base font-medium text-[#d3bb73]">
                                  {item.total.toLocaleString('pl-PL')} zł
                                </div>
                              </div>
                              <button
                                onClick={() => handleStartEditItem(item)}
                                className="p-1.5 text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded transition-colors"
                                title="Edytuj pozycję"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <h2 className="text-lg font-light text-[#e5e4e2] mb-4">
              Zmień status
            </h2>
            <div className="space-y-2">
              {Object.entries(statusLabels).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => handleStatusChange(key)}
                  className={`w-full text-left px-4 py-2 rounded-lg text-sm transition-colors ${
                    offer.status === key
                      ? 'bg-[#d3bb73]/20 text-[#d3bb73] border border-[#d3bb73]/30'
                      : 'text-[#e5e4e2]/60 hover:bg-[#0a0d1a]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <h2 className="text-lg font-light text-[#e5e4e2] mb-4">
              Informacje
            </h2>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-[#e5e4e2]/60">Utworzona</p>
                <p className="text-[#e5e4e2]">
                  {new Date(offer.created_at).toLocaleString('pl-PL')}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <h2 className="text-lg font-light text-[#e5e4e2] mb-4">
              Akcje
            </h2>
            <div className="space-y-2">
              <button
                onClick={() => {
                  if (offer.event_id) {
                    router.push(`/crm/events/${offer.event_id}`);
                  }
                }}
                disabled={!offer.event_id}
                className="w-full flex items-center gap-2 bg-[#d3bb73]/10 text-[#d3bb73] px-4 py-2 rounded-lg text-sm hover:bg-[#d3bb73]/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Calendar className="w-4 h-4" />
                Przejdź do eventu
              </button>
              <button
                onClick={() => alert('Funkcja generowania PDF w przygotowaniu')}
                className="w-full flex items-center gap-2 bg-blue-500/10 text-blue-400 px-4 py-2 rounded-lg text-sm hover:bg-blue-500/20 transition-colors"
              >
                <FileText className="w-4 h-4" />
                Generuj PDF
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Modal edycji oferty */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-[#d3bb73]/20">
              <h2 className="text-xl font-light text-[#e5e4e2]">Edytuj ofertę</h2>
              <button
                onClick={() => setShowEditModal(false)}
                className="p-2 text-[#e5e4e2]/60 hover:text-[#e5e4e2] hover:bg-[#d3bb73]/10 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                  Data ważności oferty
                </label>
                <input
                  type="date"
                  value={editFormData.valid_until}
                  onChange={(e) => setEditFormData({ ...editFormData, valid_until: e.target.value })}
                  className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-3 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                />
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                  Notatki
                </label>
                <textarea
                  value={editFormData.notes}
                  onChange={(e) => setEditFormData({ ...editFormData, notes: e.target.value })}
                  rows={4}
                  className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-3 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73] resize-none"
                  placeholder="Dodaj notatki do oferty..."
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 p-6 border-t border-[#d3bb73]/20">
              <button
                onClick={() => setShowEditModal(false)}
                className="px-6 py-2.5 rounded-lg text-[#e5e4e2]/80 hover:bg-[#d3bb73]/10 transition-colors"
              >
                Anuluj
              </button>
              <button
                onClick={handleSaveEdit}
                className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-6 py-2.5 rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-colors"
              >
                <Save className="w-4 h-4" />
                Zapisz zmiany
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal wysyłania oferty */}
      {showSendEmailModal && offer && (
        <SendOfferEmailModal
          offerId={offer.id}
          offerNumber={offer.offer_number}
          clientEmail={offer.event?.contact?.email || offer.organization?.email || ''}
          clientName={
            offer.event?.contact
              ? `${offer.event.contact.first_name || ''} ${offer.event.contact.last_name || ''}`.trim()
              : offer.organization?.name || ''
          }
          onClose={() => setShowSendEmailModal(false)}
          onSent={() => {
            fetchOfferDetails();
          }}
        />
      )}

      {/* Modal podglądu PDF */}
      {previewImage && (
        <div
          className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4"
          onClick={() => setPreviewImage(null)}
        >
          <button
            onClick={() => setPreviewImage(null)}
            className="absolute top-4 right-4 p-2 text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={previewImage}
            alt="Podgląd PDF"
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
