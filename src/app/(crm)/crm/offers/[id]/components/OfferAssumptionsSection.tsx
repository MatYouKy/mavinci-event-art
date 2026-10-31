'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { EventAssumptionsEditor } from '@/components/crm/offers/EventAssumptionsEditor';
import { formatEventAssumptionItems, normalizeEventAssumptionItems, syncGuestCountAssumptions } from '@/lib/CRM/Offers/eventAssumptions';

export default function OfferAssumptionsSection({ offer, canEdit, onUpdate, previewGuestCount }: {
  offer: any; canEdit: boolean; onUpdate: () => void; previewGuestCount?: string;
}) {
  const { showSnackbar } = useSnackbar();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const legacyEventAssumptions = offer.event_assumptions || offer.inquiry?.inquiry_details?.event_assumptions || offer.inquiry?.inquiry_details?.scope || '';
  const storedItems = offer.event_assumption_items?.some((item: any) => item?.value?.trim())
    ? offer.event_assumption_items : offer.inquiry?.inquiry_details?.event_assumption_items;
  const draftCount = previewGuestCount === undefined ? offer.guest_count ?? null : previewGuestCount === '' ? null : Number(previewGuestCount);
  const guestCount = draftCount == null || (Number.isInteger(draftCount) && draftCount >= 1 && draftCount <= 100000) ? draftCount : offer.guest_count ?? null;
  const audiencePending = previewGuestCount !== undefined && draftCount !== (offer.guest_count ?? null);
  const storedGoal = offer.event_goal || offer.inquiry?.inquiry_details?.event_goal || '';
  const [items, setItems] = useState(() => normalizeEventAssumptionItems(storedItems, legacyEventAssumptions));
  const [goal, setGoal] = useState(storedGoal);
  useEffect(() => {
    if (editing) return;
    setItems(normalizeEventAssumptionItems(storedItems, legacyEventAssumptions));
    setGoal(storedGoal);
  }, [storedItems, legacyEventAssumptions, storedGoal, editing]);
  const syncedItems = syncGuestCountAssumptions(items, guestCount);
  const assumptionItemsForDisplay = syncGuestCountAssumptions(normalizeEventAssumptionItems(storedItems, legacyEventAssumptions), guestCount)
    .filter(item => item.value.trim() || item.badge_value?.trim());

  const save = async () => {
    if (!canEdit || savingRef.current || audiencePending) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const { error } = await supabase.from('offers').update({
        event_assumption_items: syncedItems,
        event_assumptions: formatEventAssumptionItems(syncedItems) || null,
        event_goal: goal.trim() || null,
      }).eq('id', offer.id).select('id').single();
      if (error) throw error;
      setEditing(false);
      showSnackbar('Założenia wydarzenia zapisane', 'success');
      onUpdate();
    } catch (error: any) {
      showSnackbar(error.message || 'Nie udało się zapisać założeń', 'error');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <section data-offer-editing={editing} className="mt-4 rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-light text-[#e5e4e2]">Założenia wydarzenia</h2>
        {canEdit && (editing ? <div className="flex gap-2">
          <button type="button" disabled={saving || audiencePending} onClick={() => void save()} className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm text-[#250914] disabled:opacity-50">{saving ? 'Zapisywanie…' : 'Zapisz'}</button>
          <button type="button" disabled={saving} onClick={() => setEditing(false)} className="rounded-lg bg-white/5 px-4 py-2 text-sm text-[#e5e4e2] disabled:opacity-50">Anuluj</button>
        </div> : <button type="button" onClick={() => setEditing(true)} className="rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73]">Edytuj</button>)}
      </div>
      {audiencePending && <p className="mb-3 text-xs text-[#d3bb73]">Podgląd liczby gości z informacji podstawowych. Zapisz informacje podstawowe, aby zachować tę liczbę i przeliczyć ofertę.</p>}
      {guestCount != null && !assumptionItemsForDisplay.some(item => item.key === 'guest_count') && <p className="mb-3 text-sm text-[#d3bb73]">Liczba gości: {guestCount}. Możesz wybrać „Liczba gości” w jednej z trzech kart — wartość uzupełni się automatycznie.</p>}
      {editing ? <fieldset disabled={saving} className="space-y-4">
        <EventAssumptionsEditor
          value={syncedItems}
          guestCount={guestCount}
          eventGoal={goal}
          aiContext={{
            inquiryId: offer.inquiry?.id || offer.inquiry_id || undefined,
            eventCategory: String(offer.event?.category?.name || ''),
            productNames: (offer.offer_items || []).map((item: any) => item.name || item.product?.name).filter(Boolean),
          }}
          onChange={(nextItems, generatedGoal) => {
            setItems(syncGuestCountAssumptions(nextItems, guestCount));
            if (generatedGoal !== undefined) setGoal(generatedGoal);
          }}
        />
        <label className="block text-xs text-[#e5e4e2]/60">Cel wydarzenia
          <textarea value={goal} onChange={event => setGoal(event.target.value)} rows={3}
            className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1118] px-3 py-2 text-sm text-[#e5e4e2] focus:outline-none"
            placeholder="Rezultat, który klient chce osiągnąć…" />
        </label>
      </fieldset> : <div className="space-y-4">
            {assumptionItemsForDisplay.length > 0 ? (
              <div className="border-t border-[#d3bb73]/10 pt-4">
                <p className="mb-2 text-xs text-[#e5e4e2]/60">Założenia wydarzenia</p>
                <div className="grid grid-cols-1 gap-2 xl:grid-cols-3">
                  {assumptionItemsForDisplay.map((item, index) => {
                    const explicitBadge = item.badge_value?.trim() || '';
                    const rawValue = item.value.trim();
                    const canUseValueAsBadge = !explicitBadge
                      && rawValue.length > 0
                      && rawValue.length <= 7
                      && !rawValue.includes('\n');
                    const badgeValue = explicitBadge
                      || (canUseValueAsBadge ? rawValue : String(index + 1).padStart(2, '0'));
                    const detail = canUseValueAsBadge ? '' : rawValue;

                    return (
                      <div
                        key={`${item.key}-${index}`}
                        className="flex min-h-24 items-center gap-3 rounded-xl border border-[#d3bb73]/10 bg-[#0f1118] p-3"
                      >
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[#6b0024] px-1 text-center font-medium uppercase text-white shadow-inner shadow-black/20">
                          <span className={badgeValue.length >= 6 ? 'text-xs' : badgeValue.length >= 4 ? 'text-sm' : 'text-base'}>
                            {badgeValue}
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-medium uppercase tracking-wide text-[#d3bb73]">
                            {item.label}
                          </p>
                          {detail && (
                            <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-[#e5e4e2]">
                              {detail}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : legacyEventAssumptions ? (
              <div className="border-t border-[#d3bb73]/10 pt-4">
                <p className="mb-2 text-xs text-[#e5e4e2]/60">Założenia wydarzenia</p>
                <p className="whitespace-pre-wrap text-sm leading-6 text-[#e5e4e2]">{legacyEventAssumptions}</p>
              </div>
            ) : null}

            {(offer.event_goal || offer.inquiry?.inquiry_details?.event_goal) && (
              <div className="border-t border-[#d3bb73]/10 pt-4">
                <p className="mb-2 text-xs text-[#e5e4e2]/60">Cel wydarzenia</p>
                <p className="whitespace-pre-wrap text-sm leading-6 text-[#e5e4e2]">
                  {offer.event_goal || offer.inquiry?.inquiry_details?.event_goal}
                </p>
              </div>
            )}
        {!assumptionItemsForDisplay.length && !legacyEventAssumptions && <p className="text-sm text-[#e5e4e2]/60">Brak zapisanych założeń.</p>}
      </div>}
    </section>
  );
}
