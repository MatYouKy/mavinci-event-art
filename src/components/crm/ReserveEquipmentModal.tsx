'use client';

import { useState, useEffect, useRef } from 'react';
import { Lock, AlertTriangle, CheckCircle, Package, X, Loader2 } from 'lucide-react';
import Image from 'next/image';
import Popover from '@/components/UI/Tooltip';
import OverlayPortal from '@/components/UI/OverlayPortal';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDispatch } from 'react-redux';
import { eventsApi } from '@/app/(crm)/crm/events/store/api/eventsApi';
import EventAcceptanceConfirmationPreview, { useEventAcceptanceConfirmationPreview } from '@/components/crm/events/EventAcceptanceConfirmationPreview';
import { sendEventAcceptanceConfirmation } from '@/lib/CRM/events/eventAcceptanceConfirmation';

interface EquipmentItem {
  warehouse_category_id: any;
  item_type: 'item' | 'kit';
  item_id: string;
  item_name: string;
  required_qty: number;
  total_qty: number;
  reserved_qty: number;
  available_qty: number;
  has_conflict: boolean;
  shortage_qty: number;
  category_id?: string;
}

interface ReserveEquipmentModalProps {
  offerId: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  onEditOfferItem?: (itemId: string) => void;
}

interface AcceptancePackage {
  id: string;
  name: string;
  price_net: number;
  is_recommended: boolean;
  variants: string[];
}

interface SubstitutionItem {
  thumbnail_url?: string | null;
  id: string;
  name: string;
  available_qty: number;
  brand?: string;
  model?: string;
  required_components?: RequiredComponent[];
}

interface RequiredComponent {
  id: string;
  compatible_equipment_id: string | null;
  compatible_kit_id: string | null;
  compatible_cable_id: string | null;
  compatibility_type: 'required' | 'recommended' | 'optional';
  quantity: number;
  quantity_mode: 'per_item' | 'fixed';
  compatible_equipment?: {
    id: string;
    name: string;
    model?: string;
    brand?: string;
  };
  compatible_kit?: {
    id: string;
    name: string;
    description?: string;
  };
  compatible_cable?: {
    id: string;
    name: string;
    description?: string;
    stock_unit?: 'piece' | 'meter';
  };
}

const buildItemKey = (itemType: 'item' | 'kit', itemId: string) => `${itemType}-${itemId}`;

const parseItemKey = (key: string) => {
  const separatorIndex = key.indexOf('-');
  return {
    item_type: key.slice(0, separatorIndex) as 'item' | 'kit',
    item_id: key.slice(separatorIndex + 1),
  };
};

export default function ReserveEquipmentModal({
  offerId,
  open,
  onClose,
  onSuccess,
  onEditOfferItem,
}: ReserveEquipmentModalProps) {
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [acceptedShortages, setAcceptedShortages] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [equipmentError, setEquipmentError] = useState('');
  const [resourceIssues, setResourceIssues] = useState<{ id: string; name: string; packageName: string; missing: string }[]>([]);
  const [confirming, setConfirming] = useState(false);
  const confirmingRef = useRef(false);
  const [acceptanceEventId, setAcceptanceEventId] = useState<string | null>(null);
  const [isNewAcceptance, setIsNewAcceptance] = useState(false);
  const [sendConfirmationEmail, setSendConfirmationEmail] = useState(false);
  const confirmationPreview = useEventAcceptanceConfirmationPreview(
    open && isNewAcceptance ? acceptanceEventId : null,
  );
  const [packageMode, setPackageMode] = useState(false);
  const [packages, setPackages] = useState<AcceptancePackage[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [selectedOfferVariants, setSelectedOfferVariants] = useState<string[]>([]);
  const [showSubstitutionModal, setShowSubstitutionModal] = useState(false);
  const [currentConflictItem, setCurrentConflictItem] = useState<EquipmentItem | null>(null);
  const [substitutions, setSubstitutions] = useState<SubstitutionItem[]>([]);
  const [substitutionError, setSubstitutionError] = useState('');
  const [substitutionQuantities, setSubstitutionQuantities] = useState<Record<string, string>>({});
  const [selectedSubstitutionQty, setSelectedSubstitutionQty] = useState(1);
  const [savingSubstitution, setSavingSubstitution] = useState(false);
  const substitutionBusyRef = useRef(false);
  const [loadingSubstitutions, setLoadingSubstitutions] = useState(false);
  const [showRequiredComponentsModal, setShowRequiredComponentsModal] = useState(false);
  const [requiredComponents, setRequiredComponents] = useState<RequiredComponent[]>([]);
  const [selectedSubstitutionId, setSelectedSubstitutionId] = useState<string | null>(null);
  const { showSnackbar } = useSnackbar();
  const dispatch = useDispatch();

  useEffect(() => {
    setShowSubstitutionModal(false);
    setShowRequiredComponentsModal(false);
    setCurrentConflictItem(null);
    setSubstitutions([]);
    setSubstitutionError('');
    if (open && offerId) {
      setEquipmentError('');
      setResourceIssues([]);
      setEquipment([]);
      setSelectedItems(new Set());
      setAcceptedShortages(new Set());
      setSendConfirmationEmail(false);
      setAcceptanceEventId(null);
      setIsNewAcceptance(false);
      void loadAcceptanceContext();
    }
  }, [open, offerId]);

  const loadAcceptanceContext = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('offers')
        .select(`
          event_id,
          status,
          package_mode,
          accepted_package_id,
          offer_items(product_variant:offer_product_variants!product_variant_id(name)),
          packages:offer_packages!offer_id(
            id,
            name,
            price_net,
            is_recommended,
            display_order,
            items:offer_package_items(product_variant:offer_product_variants!product_variant_id(name))
          )
        `)
        .eq('id', offerId)
        .single();
      if (error) throw error;

      setAcceptanceEventId((data as any)?.event_id || null);
      setIsNewAcceptance(Boolean((data as any)?.event_id && (data as any)?.status !== 'accepted'));

      const packageRows = [...((data as any)?.packages || [])]
        .sort((a: any, b: any) => Number(a.display_order || 0) - Number(b.display_order || 0))
        .map((pkg: any) => ({
          id: pkg.id,
          name: pkg.name,
          price_net: Number(pkg.price_net || 0),
          is_recommended: Boolean(pkg.is_recommended),
          variants: (pkg.items || [])
            .map((item: any) => item.product_variant?.name)
            .filter(Boolean),
        }));
      const usesPackages = Boolean((data as any)?.package_mode && packageRows.length > 0);
      const initialPackageId = usesPackages
        ? ((data as any)?.accepted_package_id
          || packageRows.find((pkg) => pkg.is_recommended)?.id
          || packageRows[0]?.id)
        : null;

      setPackageMode(usesPackages);
      setPackages(packageRows);
      setSelectedPackageId(initialPackageId || null);
      setSelectedOfferVariants(
        usesPackages
          ? (packageRows.find((pkg) => pkg.id === initialPackageId)?.variants || [])
          : (((data as any)?.offer_items || [])
            .map((item: any) => item.product_variant?.name)
            .filter(Boolean)),
      );
      await loadEquipment(initialPackageId || null);
    } catch (err: any) {
      setEquipmentError(err.message || 'Nie udało się odczytać danych oferty.');
      console.error('Error loading acceptance context:', err);
      showSnackbar(err.message || 'Błąd podczas ładowania wariantów oferty', 'error');
      setLoading(false);
    }
  };

  const loadEquipment = async (packageId: string | null = selectedPackageId) => {
    try {
      setLoading(true);
      setEquipmentError('');
      setResourceIssues([]);
      setEquipment([]);
      setSelectedItems(new Set());
      setAcceptedShortages(new Set());
      // Inspect the saved offer scope: catalog changes do not update its snapshot.
      let itemsQuery = supabase.from('offer_items').select('id,name,pricing_configuration').eq('offer_id', offerId);
      if (packageId) {
        const { data: packageItems, error: packageError } = await supabase.from('offer_package_items').select('offer_item_id').eq('package_id', packageId);
        if (packageError) throw packageError;
        itemsQuery = itemsQuery.in('id', (packageItems || []).map(item => item.offer_item_id));
      }
      const { data: offerItems, error: itemsError } = await itemsQuery;
      if (itemsError) throw itemsError;
      const issues = (offerItems || []).flatMap(item => {
        const selection = (item.pricing_configuration as any)?.product_package;
        if (!selection) return [];
        const selected = Array.isArray(selection.options) ? selection.options.find((option: any) => option.id === selection.selected_id) : null;
        const resources = selected?.resources;
        const missing = [!Array.isArray(resources?.equipment) && 'sprzęt', !Array.isArray(resources?.staff) && 'obsadę'].filter(Boolean).join(' i ');
        return !selected || missing ? [{ id: item.id, name: item.name, packageName: selected?.name || 'Nie wybrano pakietu', missing: selected ? missing : 'wybór pakietu' }] : [];
      });
      if (issues.length) {
        setResourceIssues(issues);
        throw new Error('Przed akceptacją uzupełnij konfigurację wskazanych pozycji oferty.');
      }
      const { data, error } = await supabase.rpc('get_offer_equipment_for_reservation', {
        p_offer_id: offerId,
        p_package_id: packageId,
      });

      if (error) throw error;
      const items = data || [];
      setEquipment(items);

      // Domyślnie zaznacz wszystkie dostępne
      const availableIds = items
        .filter((item: EquipmentItem) => !item.has_conflict)
        .map((item: EquipmentItem) => `${item.item_type}-${item.item_id}`);
      setSelectedItems(new Set(availableIds));
    } catch (err: any) {
      setEquipmentError(err.message || 'Nie udało się sprawdzić sprzętu oferty.');
      console.error('Error loading equipment:', err);
      showSnackbar(err.message || 'Błąd podczas ładowania sprzętu', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadSubstitutions = async (item: EquipmentItem) => {
    try {
      setLoadingSubstitutions(true);
      setSubstitutions([]);
      setSubstitutionError('');
  
      let warehouseCategoryId = item.warehouse_category_id;
  
      if (!warehouseCategoryId && item.item_type === 'item') {
        const { data: itemData, error: itemError } = await supabase
          .from('equipment_items')
          .select('warehouse_category_id')
          .eq('id', item.item_id)
          .single();
  
        if (itemError) throw itemError;
        warehouseCategoryId = itemData?.warehouse_category_id;
      }
  
      if (!warehouseCategoryId) {
        setSubstitutions([]);
        return;
      }
  
      const { data, error } = await supabase
        .from('equipment_items')
        .select('id, name, brand, model, thumbnail_url, warehouse_category_id')
        .eq('warehouse_category_id', warehouseCategoryId)
        .neq('id', item.item_id)
        .order('name');
  
      if (error) throw error;
  
      const itemsWithAvailability = await Promise.all(
        (data || []).map(async (substitute) => {
          const { count, error: countError } = await supabase
            .from('equipment_units')
            .select('*', { count: 'exact', head: true })
            .eq('equipment_id', substitute.id)
            .eq('status', 'available');

          if (countError) throw countError;

          const requiredComponents = await checkRequiredComponents(substitute.id);

          return {
            ...substitute,
            available_qty: count || 0,
            required_components: requiredComponents,
          };
        })
      );

      const available = itemsWithAvailability.filter(
        (sub) => sub.available_qty > 0
      );

      setSubstitutions(available);
      setSubstitutionQuantities(Object.fromEntries(available.map((sub) => [
        sub.id, String(Math.min(sub.available_qty, Math.max(1, item.required_qty))),
      ])));
    } catch (err: any) {
      console.error('Error loading substitutions:', err);
      setSubstitutionError('Nie udało się pobrać zamienników. Spróbuj ponownie.');
      showSnackbar(err.message || 'Błąd podczas ładowania alternatyw', 'error');
    } finally {
      setLoadingSubstitutions(false);
    }
  };
  const handleToggleItem = (itemKey: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(itemKey)) {
      newSelected.delete(itemKey);
    } else {
      newSelected.add(itemKey);
    }
    setSelectedItems(newSelected);
  };

  const handleAcceptShortage = (itemKey: string) => {
    const newAccepted = new Set(acceptedShortages);
    newAccepted.add(itemKey);
    setAcceptedShortages(newAccepted);
    showSnackbar('Brak sprzętu został zaakceptowany. Zostanie oznaczony w zakładce Sprzęt.', 'info');
  };

  const handleResolveConflict = async (item: EquipmentItem) => {
    setCurrentConflictItem(item);
    setShowSubstitutionModal(true);
    await loadSubstitutions(item);
  };

  const checkRequiredComponents = async (equipmentId: string) => {
    try {
      const { data, error } = await supabase
        .from('equipment_compatible_items')
        .select(`
          id,
          compatible_equipment_id,
          compatible_kit_id,
          compatible_cable_id,
          compatibility_type,
          quantity,
          quantity_mode,
          compatible_equipment:equipment_items!compatible_equipment_id(id, name, model, brand),
          compatible_kit:equipment_kits!compatible_kit_id(id, name, description),
          compatible_cable:cables!compatible_cable_id(id, name, description, stock_unit)
        `)
        .eq('equipment_id', equipmentId)
        .eq('compatibility_type', 'required');

      if (error) throw error;

      return (data || []).map((item: any) => ({
        ...item,
        compatible_equipment: Array.isArray(item.compatible_equipment)
          ? item.compatible_equipment[0]
          : item.compatible_equipment,
        compatible_kit: Array.isArray(item.compatible_kit)
          ? item.compatible_kit[0]
          : item.compatible_kit,
        compatible_cable: Array.isArray(item.compatible_cable)
          ? item.compatible_cable[0]
          : item.compatible_cable,
      })) as RequiredComponent[];
    } catch (err: any) {
      console.error('Error checking required components:', err);
      return [];
    }
  };

  const handleSelectSubstitution = async (substitutionId: string) => {
    if (!currentConflictItem || substitutionBusyRef.current) return;
    const quantity = Number(substitutionQuantities[substitutionId]);
    const substitute = substitutions.find((sub) => sub.id === substitutionId);
    if (!substitute || !Number.isInteger(quantity) || quantity < 1 || quantity > substitute.available_qty) {
      showSnackbar('Podaj pełną liczbę sztuk od 1 do dostępnej ilości.', 'error');
      return;
    }
    substitutionBusyRef.current = true;
    setSavingSubstitution(true);
    try {
      const required = await checkRequiredComponents(substitutionId);
      setSelectedSubstitutionQty(quantity);
      if (required.length > 0) {
        setSelectedSubstitutionId(substitutionId);
        setRequiredComponents(required);
        setShowRequiredComponentsModal(true);
        return;
      }
      await saveSubstitution(substitutionId, quantity);
    } finally {
      substitutionBusyRef.current = false;
      setSavingSubstitution(false);
    }
  };

  const saveSubstitution = async (substitutionId: string, quantity: number = selectedSubstitutionQty) => {
    if (!currentConflictItem) return;

    try {
      const { error: deleteError } = await supabase
        .from('offer_equipment_substitutions')
        .delete()
        .eq('offer_id', offerId)
        .eq('from_item_id', currentConflictItem.item_id);

      if (deleteError) throw deleteError;

      const { error } = await supabase
        .from('offer_equipment_substitutions')
        .insert({
          offer_id: offerId,
          from_item_id: currentConflictItem.item_id,
          to_item_id: substitutionId,
          qty: quantity,
        });

      if (error) throw error;

      showSnackbar(`Zapisano zamiennik: ${quantity} szt.`, 'success');
      setShowSubstitutionModal(false);
      setShowRequiredComponentsModal(false);
      setCurrentConflictItem(null);
      setSelectedSubstitutionId(null);
      setRequiredComponents([]);
      await loadEquipment();
    } catch (err: any) {
      console.error('Error saving substitution:', err);
      showSnackbar(err.message || 'Błąd podczas zapisywania substytucji', 'error');
    }
  };

  const handleAddRequiredComponents = async () => {
    if (!selectedSubstitutionId || !offerId || substitutionBusyRef.current) return;
    substitutionBusyRef.current = true;
    setSavingSubstitution(true);

    try {
      const { data: offer } = await supabase
        .from('offers')
        .select('event_id')
        .eq('id', offerId)
        .single();

      if (!offer?.event_id) {
        throw new Error('Nie znaleziono eventu dla tej oferty');
      }

      for (const component of requiredComponents) {
        const quantity = component.quantity_mode === 'fixed'
          ? Math.max(1, Number(component.quantity || 1))
          : Math.max(1, Number(component.quantity || 1)) * selectedSubstitutionQty;
        if (component.compatible_equipment_id) {
          await supabase.from('event_equipment').insert({
            event_id: offer.event_id,
            equipment_id: component.compatible_equipment_id,
            quantity,
            status: 'reserved',
            offer_id: offerId,
          });
        } else if (component.compatible_kit_id) {
          await supabase.from('event_equipment').insert({
            event_id: offer.event_id,
            kit_id: component.compatible_kit_id,
            quantity,
            status: 'reserved',
            offer_id: offerId,
          });
        } else if (component.compatible_cable_id) {
          await supabase.from('event_equipment').insert({
            event_id: offer.event_id,
            cable_id: component.compatible_cable_id,
            quantity,
            status: 'reserved',
            offer_id: offerId,
          });
        }
      }

      await saveSubstitution(selectedSubstitutionId);
      showSnackbar('Dodano wymagane komponenty', 'success');
    } catch (err: any) {
      console.error('Error adding required components:', err);
      showSnackbar(err.message || 'Błąd podczas dodawania komponentów', 'error');
    } finally {
      substitutionBusyRef.current = false;
      setSavingSubstitution(false);
    }
  };

  const handleConfirm = async () => {
    if (confirmingRef.current || loading || equipmentError) return;
    confirmingRef.current = true;
    try {
      setConfirming(true);

      // Pobierz event_id z oferty
      const { data: offer, error: offerError } = await supabase
        .from('offers')
        .select('event_id, status')
        .eq('id', offerId)
        .single();

      if (offerError) throw offerError;
      if (!offer?.event_id) {
        throw new Error('Nie znaleziono eventu dla tej oferty');
      }

      const eventId = offer.event_id;
      const shouldSendConfirmation = sendConfirmationEmail && isNewAcceptance;
      const expectedRecipientEmail = confirmationPreview.preview?.recipientEmail;
      if (shouldSendConfirmation && (
        offer.status === 'accepted' || !expectedRecipientEmail
        || confirmationPreview.preview?.eventId !== eventId
      )) {
        throw new Error('Dane akceptacji lub odbiorcy zmieniły się. Otwórz okno ponownie przed wysłaniem potwierdzenia.');
      }

      // Rezerwuj tylko zaznaczone
      const itemsToReserve = equipment
        .filter((item) => {
          const itemKey = `${item.item_type}-${item.item_id}`;
          return selectedItems.has(itemKey) && !item.has_conflict;
        })
        .map((item) => ({
          item_type: item.item_type,
          item_id: item.item_id,
          qty: item.required_qty,
        }));

      // Zapisz zaakceptowane braki
      const acceptedShortageItems = Array.from(acceptedShortages).map((key) => {
        const { item_type, item_id } = parseItemKey(key);
        const item = equipment.find((e) => buildItemKey(e.item_type, e.item_id) === key);
      
        return {
          item_type,
          item_id,
          shortage_qty: item?.shortage_qty || 0,
        };
      });

      // Wywołaj funkcję rezerwacji (automatycznie odrzuci inne oferty i ustawi flagę braków)
      const { data, error } = await supabase.rpc('reserve_selected_equipment', {
        p_offer_id: offerId,
        p_items: itemsToReserve,
        p_accepted_shortages: acceptedShortageItems,
        p_package_id: packageMode ? selectedPackageId : null,
      });

      if (error) throw error;

      if (!data?.success) throw new Error(data?.error || 'Nie potwierdzono zapisania akceptacji i rezerwacji.');

      // Invaliduj cache RTK Query
      dispatch(eventsApi.util.invalidateTags([
        { type: 'EventEquipment', id: eventId },
        { type: 'EventOffers', id: `${eventId}_LIST` },
        { type: 'EventDetails', id: eventId },
        { type: 'Events', id: eventId },
      ]));

      const result = data as { success: boolean; reserved_count: number; shortage_count: number; rejected_offers_count: number };

      if (result.rejected_offers_count > 0) {
        showSnackbar(
          `Sprzęt zarezerwowany pomyślnie. Odrzucono ${result.rejected_offers_count} pozostałych ofert.`,
          'success'
        );
      } else {
        showSnackbar('Sprzęt został zarezerwowany pomyślnie', 'success');
      }

      if (shouldSendConfirmation && expectedRecipientEmail) {
        try {
          const sent = await sendEventAcceptanceConfirmation({
            eventId, acceptedOfferId: offerId, expectedRecipientEmail,
          });
          showSnackbar(`Oferta zaakceptowana. Potwierdzenie wysłano do ${sent.recipientEmail}`, 'success');
        } catch (mailError) {
          showSnackbar(`Oferta i rezerwacja zostały zapisane. ${mailError instanceof Error ? mailError.message : 'Nie potwierdzono wysłania wiadomości.'}`, 'warning');
        }
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Error confirming reservation:', err);
      showSnackbar(err.message || 'Błąd podczas rezerwacji sprzętu', 'error');
    } finally {
      setConfirming(false);
      confirmingRef.current = false;
    }
  };

  const hasUnresolvedConflicts =
    equipment.some((e) => e.has_conflict) && acceptedShortages.size === 0;
  const noEquipmentNeeded = equipment.length === 0;
  const canConfirm = !equipmentError && (noEquipmentNeeded || selectedItems.size > 0 || acceptedShortages.size > 0);

  if (!open) return null;

  return (
    <OverlayPortal>
      {/* Main Modal */}
      <div role="dialog" aria-modal="true" aria-label="Zarezerwuj sprzęt" data-app-overlay="true" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className="relative w-full max-w-4xl rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-6">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-green-500/10 p-2">
                <Lock className="h-5 w-5 text-green-400" />
              </div>
              <h2 className="text-xl font-light text-[#e5e4e2]">Zarezerwuj Sprzęt</h2>
            </div>
            <button
              onClick={onClose}
              disabled={confirming}
              className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#e5e4e2]/10 hover:text-[#e5e4e2] disabled:opacity-50"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Content */}
          <div className="max-h-[70vh] overflow-y-auto p-6">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="mb-4 h-12 w-12 animate-spin text-[#d3bb73]" />
                <p className="text-sm text-[#e5e4e2]/60">Ładowanie sprzętu...</p>
              </div>
            ) : equipmentError ? (
              <div role="alert" className="space-y-4 rounded-xl bg-[#d3bb73]/10 p-4 text-sm text-[#e5e4e2]">
                <h3 className="font-medium text-[#d3bb73]">Nie można jeszcze zaakceptować oferty</h3>
                <p>{equipmentError}</p>
                {resourceIssues.map(issue => <div key={issue.id} className="rounded-lg bg-black/15 p-3">
                  <p className="font-medium">{issue.name}</p>
                  <p className="mt-1 text-xs text-[#e5e4e2]/70">Pakiet: {issue.packageName}. Uzupełnij: {issue.missing}.</p>
                  <p className="mt-1 text-xs text-[#e5e4e2]/70">Otwórz edycję pozycji oferty → „Sprzęt i obsada”. Zastosuj zasoby i zapisz pozycję. Zmiana samego produktu nie aktualizuje już dodanej oferty.</p>
                  {onEditOfferItem && <button type="button" onClick={() => { onClose(); onEditOfferItem(issue.id); }} className="mt-3 rounded-lg bg-[#d3bb73] px-3 py-2 text-[#1c1f33]">Uzupełnij pozycję</button>}
                </div>)}
                {packageMode && <label className="block">Sprawdź inny pakiet<select value={selectedPackageId || ''} onChange={e => { const id = e.target.value; setSelectedPackageId(id); setSelectedOfferVariants(packages.find(p => p.id === id)?.variants || []); void loadEquipment(id); }} className="mt-1 w-full rounded-lg border border-white/10 bg-[#1c1f33] p-2">{packages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
                <button type="button" onClick={() => void loadAcceptanceContext()} className="text-[#d3bb73] underline">Sprawdź ponownie</button>
              </div>
            ) : (
              <>
                {packageMode && (
                  <div className="mb-5 rounded-xl border border-[#d3bb73]/20 bg-[#0f1117] p-4">
                    <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-[#d3bb73]">
                      Akceptowany pakiet i warianty
                    </label>
                    <select
                      value={selectedPackageId || ''}
                      onChange={async (event) => {
                        const packageId = event.target.value || null;
                        const selectedPackage = packages.find((pkg) => pkg.id === packageId);
                        setSelectedPackageId(packageId);
                        setSelectedOfferVariants(selectedPackage?.variants || []);
                        await loadEquipment(packageId);
                      }}
                      disabled={confirming}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                    >
                      {packages.map((pkg) => (
                        <option key={pkg.id} value={pkg.id}>
                          {pkg.name}{pkg.is_recommended ? ' — rekomendowany' : ''} · {pkg.price_net.toLocaleString('pl-PL')} zł netto
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {selectedOfferVariants.length > 0 && (
                  <div className="mb-5 rounded-lg border border-green-500/20 bg-green-500/10 px-4 py-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-green-400">
                      Warianty zapisane przy akceptacji
                    </p>
                    <p className="mt-1 text-sm text-[#e5e4e2]">
                      {selectedOfferVariants.join('  •  ')}
                    </p>
                  </div>
                )}

                {isNewAcceptance && acceptanceEventId && (
                  <div className="mb-5 space-y-3 rounded-xl bg-[#e5e4e2]/5 p-4">
                    <label className="flex cursor-pointer items-start gap-3 text-sm text-[#e5e4e2]">
                      <input
                        type="checkbox"
                        checked={sendConfirmationEmail}
                        onChange={(event) => setSendConfirmationEmail(event.target.checked)}
                        disabled={confirming || confirmationPreview.loading || !confirmationPreview.preview?.recipientEmail}
                        className="mt-0.5 h-4 w-4 rounded border-white/10 accent-[#d3bb73] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[#d3bb73]/50 disabled:opacity-50"
                      />
                      <span>Wyślij klientowi potwierdzenie realizacji po zaakceptowaniu oferty
                        <span className="mt-1 block text-xs text-[#e5e4e2]/60">Opcjonalnie. Wiadomość zostanie wysłana dopiero po zapisaniu akceptacji; bez zaznaczenia zapisujemy tylko ofertę i rezerwację.</span>
                      </span>
                    </label>
                    <EventAcceptanceConfirmationPreview {...confirmationPreview} />
                  </div>
                )}

                <p className="mb-6 text-sm text-[#e5e4e2]/60">
                  {equipment.length === 0
                    ? 'Ta oferta nie zawiera pozycji sprzętowych. Po potwierdzeniu status oferty zmieni się na '
                    : 'Poniższy sprzęt zostanie wstępnie zarezerwowany dla tego eventu. Status oferty zmieni się na '}
                  <span className="font-medium text-green-400">Zaakceptowana</span>.
                </p>

                {equipment.length === 0 ? (
                  <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-4 text-sm text-blue-400">
                    Ta oferta nie wymaga rezerwacji sprzętu. Możesz ją potwierdzić bez przypisanego sprzętu.
                  </div>
                ) : (
                  <>
                    {/* Tabela sprzętu */}
                    <div className="overflow-hidden rounded-lg border border-[#d3bb73]/10">
                      <table className="w-full">
                        <thead className="bg-[#0f1117]">
                          <tr>
                            <th className="w-10 px-4 py-3"></th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-[#e5e4e2]/60">
                              Sprzęt
                            </th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-[#e5e4e2]/60">
                              Wymagane
                            </th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-[#e5e4e2]/60">
                              Dostępne
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-[#e5e4e2]/60">
                              Status
                            </th>
                            <th className="w-10 px-4 py-3"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#d3bb73]/10">
                          {equipment.map((item, index) => {
                            const itemKey = `${item.item_type}-${item.item_id}`;
                            const isSelected = selectedItems.has(itemKey);
                            const isAcceptedShortage = acceptedShortages.has(itemKey);

                            return (
                              <tr
                                key={`${item.item_type}-${item.item_id}-${index}`}
                                className={`transition-colors hover:bg-[#0f1117]/50 ${
                                  isAcceptedShortage ? 'opacity-60' : ''
                                }`}
                              >
                                {/* Checkbox */}
                                <td className="px-4 py-3">
                                  {!item.has_conflict && !isAcceptedShortage && (
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => handleToggleItem(itemKey)}
                                      className="h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1117] text-green-500 focus:ring-2 focus:ring-green-500/50"
                                    />
                                  )}
                                </td>

                                {/* Nazwa */}
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2">
                                    {item.item_type === 'kit' && (
                                      <Package className="h-4 w-4 text-[#d3bb73]" />
                                    )}
                                    <span className="text-sm text-[#e5e4e2]">{item.item_name}</span>
                                  </div>
                                </td>

                                {/* Wymagane */}
                                <td className="px-4 py-3 text-right">
                                  <span className="text-sm font-medium text-[#e5e4e2]">
                                    {item.required_qty}
                                  </span>
                                </td>

                                {/* Dostępne */}
                                <td className="px-4 py-3 text-right">
                                  <span className="text-sm text-[#e5e4e2]/60">
                                    {item.available_qty} / {item.total_qty}
                                  </span>
                                </td>

                                {/* Status */}
                                <td className="px-4 py-3">
                                  {isAcceptedShortage ? (
                                    <div className="inline-flex items-center gap-1.5 rounded border border-yellow-500/30 bg-yellow-500/20 px-2 py-1 text-xs text-yellow-400">
                                      <AlertTriangle className="h-3 w-3" />
                                      Zaakceptowany brak
                                    </div>
                                  ) : item.has_conflict ? (
                                    <div className="inline-flex items-center gap-1.5 rounded border border-red-500/30 bg-red-500/20 px-2 py-1 text-xs text-red-400">
                                      <AlertTriangle className="h-3 w-3" />
                                      Brak {item.shortage_qty}
                                    </div>
                                  ) : (
                                    <div className="inline-flex items-center gap-1.5 rounded border border-green-500/30 bg-green-500/20 px-2 py-1 text-xs text-green-400">
                                      <CheckCircle className="h-3 w-3" />
                                      Dostępne
                                    </div>
                                  )}
                                </td>

                                {/* Actions */}
                                <td className="px-4 py-3">
                                  {item.has_conflict && !isAcceptedShortage && (
                                    <ResponsiveActionBar alwaysDropdown compact menuZIndex={105} actions={[
                                      { label: 'Zaakceptuj brak', icon: <AlertTriangle className="h-4 w-4" />, onClick: () => handleAcceptShortage(itemKey) },
                                      { label: 'Rozwiąż konflikt', icon: <Package className="h-4 w-4" />, onClick: () => void handleResolveConflict(item) },
                                    ]} />
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Komunikaty */}
                    {acceptedShortages.size > 0 && (
                      <div className="mt-4 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-4">
                        <div className="mb-2 flex items-center gap-2">
                          <AlertTriangle className="h-5 w-5 text-yellow-400" />
                          <strong className="text-sm text-yellow-400">Zaakceptowane braki</strong>
                        </div>
                        <p className="text-sm text-yellow-400/90">
                          Zaakceptowano {acceptedShortages.size} pozycji z brakami. Pozostaną one
                          oznaczone w zakładce Sprzęt do dalszego rozwiązania.
                        </p>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 border-t border-[#d3bb73]/10 p-6">
            <button
              onClick={onClose}
              disabled={confirming}
              className="rounded-lg px-4 py-2 text-sm text-[#e5e4e2]/60 transition-colors hover:bg-[#e5e4e2]/10 hover:text-[#e5e4e2] disabled:opacity-50"
            >
              Anuluj
            </button>
            <button
              onClick={handleConfirm}
              disabled={loading || confirming || !canConfirm}
              className="flex items-center gap-2 rounded-lg bg-green-500/20 px-4 py-2 text-sm text-green-400 transition-colors hover:bg-green-500/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {confirming ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {sendConfirmationEmail ? 'Zapisuję i wysyłam…' : 'Rezerwuję...'}
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4" />
                  {sendConfirmationEmail ? 'Potwierdź i wyślij wiadomość' : noEquipmentNeeded ? 'Potwierdź Ofertę' : 'Potwierdź Rezerwację'}
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Substitution Modal */}
      {showSubstitutionModal && currentConflictItem && (
        <div role="dialog" aria-modal="true" aria-label="Rozwiąż konflikt" data-app-overlay="true" className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="relative w-full max-w-3xl rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-6">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-blue-500/10 p-2">
                  <Package className="h-5 w-5 text-blue-400" />
                </div>
                <div>
                  <h2 className="text-xl font-light text-[#e5e4e2]">Rozwiąż konflikt</h2>
                  <p className="text-sm text-[#e5e4e2]/60">{currentConflictItem.item_name}</p>
                </div>
              </div>
              <button
                disabled={savingSubstitution}
                onClick={() => {
                  setShowSubstitutionModal(false);
                  setCurrentConflictItem(null);
                }}
                className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#e5e4e2]/10 hover:text-[#e5e4e2]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Content */}
            <div className="max-h-[60vh] overflow-y-auto p-6">
              {loadingSubstitutions ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="mb-4 h-12 w-12 animate-spin text-[#d3bb73]" />
                  <p className="text-sm text-[#e5e4e2]/60">Szukam alternatyw...</p>
                </div>
              ) : substitutionError ? (
                <div role="alert" className="text-sm text-red-300">{substitutionError} <button type="button" onClick={() => void loadSubstitutions(currentConflictItem)} className="underline">Ponów</button></div>
              ) : substitutions.length === 0 ? (
                <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-4">
                  <p className="text-sm text-yellow-400">
                    Nie znaleziono dostępnych zamienników w tej kategorii.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="mb-4 text-sm text-[#e5e4e2]/60">
                    Zastępujesz {currentConflictItem.required_qty} szt. Wybierz zamiennik i podaj jego ilość — nie musi być taka sama.
                  </p>
                  {substitutions.map((sub) => {
                    const hasRequiredComponents =
                      sub.required_components && sub.required_components.length > 0;

                    return (
                      <div
                        key={sub.id}
                        className={`rounded-lg border ${
                          hasRequiredComponents
                            ? 'border-yellow-500/20 bg-yellow-500/5'
                            : 'border-[#d3bb73]/10 bg-[#0f1117]'
                        }`}
                      >
                        <div className="flex h-16 items-center gap-2 pr-2 sm:gap-3 sm:pr-3">
                          {sub.thumbnail_url ? (
                            <Popover
                              openOn="auto"
                              triggerClassName="shrink-0"
                              ariaLabel={`Powiększ zdjęcie: ${sub.name}`}
                              trigger={<Image src={sub.thumbnail_url} alt={sub.name} width={64} height={64} className="h-16 w-16 cursor-zoom-in rounded-lg bg-black/10 object-contain" />}
                              content={<Image src={sub.thumbnail_url} alt={sub.name} width={300} height={300} className="max-h-[min(300px,60vh)] w-[min(300px,75vw)] rounded-lg object-contain" />}
                            />
                          ) : (
                            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-white/5" aria-label="Brak zdjęcia">
                              <Package className="h-6 w-6 text-[#e5e4e2]/30" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <div title={sub.name} className="truncate text-sm font-medium text-[#e5e4e2]">{sub.name}</div>
                              {hasRequiredComponents && (
                                <Popover
                                  openOn="auto"
                                  triggerClassName="shrink-0"
                                  ariaLabel="Wymagane komponenty"
                                  trigger={<AlertTriangle className="h-4 w-4 text-yellow-400" />}
                                  content={<div className="space-y-1 text-xs"><p className="font-medium text-yellow-400">Wymagane komponenty</p>{sub.required_components!.map((comp) => <p key={comp.id}>{(comp.compatible_equipment || comp.compatible_kit || comp.compatible_cable)?.name}</p>)}</div>}
                                />
                              )}
                            </div>
                            {(sub.brand || sub.model) && <div title={`${sub.brand || ''} ${sub.model || ''}`} className="truncate text-xs text-[#e5e4e2]/50">{sub.brand} {sub.model}</div>}
                            <div className="text-xs text-green-400 sm:hidden">Dostępne: {sub.available_qty} szt.</div>
                          </div>
                          <div className="hidden shrink-0 whitespace-nowrap text-xs text-green-400 sm:block">Dostępne: {sub.available_qty} szt.</div>
                          <label className="shrink-0 text-xs text-[#e5e4e2]/70">
                            <span className="sr-only">Ilość zamiennika</span>
                            <input
                              type="number" min={1} max={sub.available_qty} step={1}
                              aria-label={`Ilość zamiennika: ${sub.name}`}
                              title="Ilość zamiennika"
                              value={substitutionQuantities[sub.id] ?? ''}
                              disabled={savingSubstitution}
                              onChange={(event) => setSubstitutionQuantities((previous) => ({ ...previous, [sub.id]: event.target.value }))}
                              className="h-9 w-14 rounded-lg border border-white/10 bg-black/20 px-2 text-sm text-[#e5e4e2] focus:outline-none focus:bg-white/10 sm:w-16"
                            />
                          </label>
                          <button
                            type="button"
                            disabled={savingSubstitution || !Number.isInteger(Number(substitutionQuantities[sub.id])) || Number(substitutionQuantities[sub.id]) < 1 || Number(substitutionQuantities[sub.id]) > sub.available_qty}
                            onClick={() => void handleSelectSubstitution(sub.id)}
                            className="h-9 shrink-0 rounded-lg bg-[#d3bb73] px-2 text-xs font-medium text-[#0f1119] hover:bg-[#c4ac64] disabled:cursor-not-allowed disabled:opacity-50 sm:px-3 sm:text-sm"
                          >{savingSubstitution ? 'Zapisuję…' : 'Wybierz'}</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end border-t border-[#d3bb73]/10 p-6">
              <button
                disabled={savingSubstitution}
                onClick={() => {
                  setShowSubstitutionModal(false);
                  setCurrentConflictItem(null);
                }}
                className="rounded-lg px-4 py-2 text-sm text-[#e5e4e2]/60 transition-colors hover:bg-[#e5e4e2]/10 hover:text-[#e5e4e2]"
              >
                Powrót
              </button>
            </div>
          </div>
        </div>
      )}

      {showRequiredComponentsModal && (
        <div role="dialog" aria-modal="true" aria-label="Wymagane komponenty" data-app-overlay="true" className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4">
          <div className="relative w-full max-w-2xl rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-xl">
            <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-6">
              <div>
                <h2 className="text-xl font-semibold text-[#e5e4e2]">Wymagane komponenty</h2>
                <p className="mt-1 text-sm text-[#e5e4e2]/60">
                  Ten sprzęt wymaga następujących komponentów do prawidłowego działania
                </p>
              </div>
              <button
                disabled={savingSubstitution}
                onClick={() => {
                  setShowRequiredComponentsModal(false);
                  setRequiredComponents([]);
                  setSelectedSubstitutionId(null);
                }}
                className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#e5e4e2]/10 hover:text-[#e5e4e2]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-6">
              <div className="mb-6 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-4">
                <div className="flex gap-3">
                  <AlertTriangle className="h-5 w-5 flex-shrink-0 text-yellow-400" />
                  <div className="text-sm text-yellow-400">
                    Wybrany sprzęt nie będzie działać bez poniższych komponentów. Zalecamy ich dodanie.
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {requiredComponents.map((component) => {
                  const item = component.compatible_equipment || component.compatible_kit || component.compatible_cable;
                  const isKit = !!component.compatible_kit;
                  const isCable = !!component.compatible_cable;

                  if (!item) return null;

                  return (
                    <div
                      key={component.id}
                      className="rounded-lg border border-red-500/20 bg-red-500/5 p-4"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 rounded-full bg-red-500/20 p-2">
                          <Package className="h-5 w-5 text-red-400" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <div className="font-medium text-[#e5e4e2]">{item.name}</div>
                            {isKit && (
                              <span className="rounded bg-[#d3bb73]/20 px-2 py-0.5 text-xs text-[#d3bb73]">
                                ZESTAW
                              </span>
                            )}
                            {isCable && (
                              <span className="rounded bg-purple-500/20 px-2 py-0.5 text-xs text-purple-300">
                                PRZEWÓD
                              </span>
                            )}
                            <span className="rounded bg-[#e5e4e2]/10 px-2 py-0.5 text-xs text-[#e5e4e2]/70">
                              {(component.quantity || 1) * (component.quantity_mode === 'fixed' ? 1 : selectedSubstitutionQty)}{' '}
                              {isCable && component.compatible_cable?.stock_unit === 'meter' ? 'm' : 'szt.'}{' '}
                              łącznie dla {selectedSubstitutionQty} szt. zamiennika
                            </span>
                            <span className="rounded bg-red-500/20 px-2 py-0.5 text-xs text-red-400">
                              WYMAGANY
                            </span>
                          </div>
                          {!isKit && component.compatible_equipment && (
                            <div className="mt-1 text-xs text-[#e5e4e2]/50">
                              {component.compatible_equipment.brand} {component.compatible_equipment.model}
                            </div>
                          )}
                          {isKit && component.compatible_kit?.description && (
                            <div className="mt-1 text-xs text-[#e5e4e2]/50">
                              {component.compatible_kit.description}
                            </div>
                          )}
                          {isCable && component.compatible_cable?.description && (
                            <div className="mt-1 text-xs text-[#e5e4e2]/50">
                              {component.compatible_cable.description}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-[#d3bb73]/10 p-6">
              <button
                disabled={savingSubstitution}
                onClick={() => {
                  setShowRequiredComponentsModal(false);
                  setRequiredComponents([]);
                  setSelectedSubstitutionId(null);
                }}
                className="rounded-lg px-4 py-2 text-sm text-[#e5e4e2]/60 transition-colors hover:bg-[#e5e4e2]/10 hover:text-[#e5e4e2]"
              >
                Anuluj
              </button>
              <div className="flex gap-2">
                <button
                  disabled={savingSubstitution}
                  onClick={async () => {
                    if (!selectedSubstitutionId || substitutionBusyRef.current) return;
                    substitutionBusyRef.current = true;
                    setSavingSubstitution(true);
                    try {
                      await saveSubstitution(selectedSubstitutionId);
                    } finally {
                      substitutionBusyRef.current = false;
                      setSavingSubstitution(false);
                    }
                  }}
                  className="rounded-lg border border-[#e5e4e2]/20 px-4 py-2 text-sm text-[#e5e4e2] transition-colors hover:bg-[#e5e4e2]/10"
                >
                  Kontynuuj bez komponentów
                </button>
                <button
                  disabled={savingSubstitution}
                  onClick={handleAddRequiredComponents}
                  className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#0f1119] transition-colors hover:bg-[#c4ac64]"
                >
                  <CheckCircle className="h-4 w-4" />
                  Dodaj komponenty i zapisz
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </OverlayPortal>
  );
}
