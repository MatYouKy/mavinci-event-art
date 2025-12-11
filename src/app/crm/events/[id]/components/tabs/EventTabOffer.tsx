import { useDialog } from '@/contexts/DialogContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { supabase } from '@/lib/supabase';
import { DollarSign, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, { Dispatch, SetStateAction, useState } from 'react';

interface EventTabOfferProps {
  offers: any[];
  setShowCreateOfferModal: Dispatch<SetStateAction<boolean>>;
}

export default function EventTabOffer({ offers, setShowCreateOfferModal }: EventTabOfferProps) {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();

  const handleDeleteOffer = async (offerId: string) => {
    const confirmed = await showConfirm(
      'Czy na pewno chcesz usunąć tę ofertę?',
      'Tej operacji nie można cofnąć.',
    );

    if (!confirmed) return;

    try {
      const { error } = await supabase.from('offers').delete().eq('id', offerId);

      if (error) throw error;

      showSnackbar('Oferta została usunięta', 'success');
    } catch (err: any) {
      showSnackbar(err.message || 'Błąd podczas usuwania oferty', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-light text-[#e5e4e2]">Oferty</h2>
            <p className="mt-1 text-sm text-[#e5e4e2]/60">Zarządzaj ofertami dla tego eventu</p>
          </div>
          <button
            onClick={() => setShowCreateOfferModal(true)}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            <Plus className="h-4 w-4" />
            Nowa oferta
          </button>
        </div>

        {offers.length === 0 ? (
          <div className="py-12 text-center">
            <DollarSign className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
            <p className="text-[#e5e4e2]/60">Brak ofert dla tego eventu</p>
            <button
              onClick={() => setShowCreateOfferModal(true)}
              className="mt-4 text-sm text-[#d3bb73] hover:text-[#d3bb73]/80"
            >
              Utwórz pierwszą ofertę
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {offers.map((offer) => (
              <div
                key={offer.id}
                className="cursor-pointer rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-6 transition-colors hover:border-[#d3bb73]/30"
                onClick={() => router.push(`/crm/offers/${offer.id}`)}
              >
                <div className="mb-4 flex items-start justify-between">
                  <div className="flex-1">
                    <div className="mb-2 flex items-center gap-3">
                      <h3 className="text-lg font-medium text-[#e5e4e2]">
                        {offer.offer_number || 'Brak numeru'}
                      </h3>
                      <span
                        className={`rounded border px-2 py-1 text-xs ${
                          offer.status === 'draft'
                            ? 'border-gray-500/30 bg-gray-500/20 text-gray-400'
                            : offer.status === 'sent'
                              ? 'border-blue-500/30 bg-blue-500/20 text-blue-400'
                              : offer.status === 'accepted'
                                ? 'border-green-500/30 bg-green-500/20 text-green-400'
                                : offer.status === 'rejected'
                                  ? 'border-red-500/30 bg-red-500/20 text-red-400'
                                  : 'border-yellow-500/30 bg-yellow-500/20 text-yellow-400'
                        }`}
                      >
                        {offer.status === 'draft'
                          ? 'Szkic'
                          : offer.status === 'sent'
                            ? 'Wysłana'
                            : offer.status === 'accepted'
                              ? 'Zaakceptowana'
                              : offer.status === 'rejected'
                                ? 'Odrzucona'
                                : offer.status}
                      </span>
                    </div>
                    <p className="text-sm text-[#e5e4e2]/60">
                      Klient: {offer.organization?.name || 'Brak klienta'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-light text-[#d3bb73]">
                      {offer.total_amount ? offer.total_amount.toLocaleString('pl-PL') : '0'} zł
                    </p>
                    {offer.valid_until && (
                      <p className="mt-1 text-xs text-[#e5e4e2]/40">
                        Ważna do: {new Date(offer.valid_until).toLocaleDateString('pl-PL')}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4 border-t border-[#d3bb73]/10 pt-4 text-xs text-[#e5e4e2]/40">
                  <span>Utworzona: {new Date(offer.created_at).toLocaleDateString('pl-PL')}</span>
                  {offer.updated_at && offer.updated_at !== offer.created_at && (
                    <>
                      <span>•</span>
                      <span>
                        Zaktualizowana: {new Date(offer.updated_at).toLocaleDateString('pl-PL')}
                      </span>
                    </>
                  )}

                  <div className="ml-auto flex flex-col gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteOffer(offer.id);
                      }}
                      className="rounded-lg bg-red-500/20 p-2 text-red-400 transition-colors hover:bg-red-500/30"
                      title="Usuń ofertę"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {offer.notes && (
                  <div className="mt-3 border-t border-[#d3bb73]/10 pt-3">
                    <p className="text-sm text-[#e5e4e2]/60">{offer.notes}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
