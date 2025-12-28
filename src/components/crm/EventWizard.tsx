'use client';

import { useState, useEffect } from 'react';
import {
  X,
  ChevronRight,
  ChevronLeft,
  Check,
  Calendar,
  FileText,
  Package,
  Users,
  Truck,
  Wrench,
  Building2,
  MapPin,
  DollarSign,
  AlertCircle,
  Plus,
  Search,
  Trash2,
  User,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import LocationSelector from './LocationSelector';
import OfferWizard from '../../app/crm/offers/[id]/components/OfferWizzard/OfferWizard';
import { EquipmentStep, TeamStep } from './EventWizardSteps';
import ParticipantsAutocomplete from './ParticipantsAutocomplete';
import { ClientType } from '@/app/crm/clients/type';
import { useEventEquipment } from '@/app/crm/events/hooks/useEventEquipment';
import { useEmployees } from '@/app/crm/employees/hooks/useEmployees';
import { useEventTeam } from '@/app/crm/events/hooks/useEventTeam';

const buildEventEquipmentRows = (selectedEquipment: any[], eventId: string) => {
  const mapped = (selectedEquipment ?? [])
    .map((eq: any) => {
      const type = eq.type || (eq.kit_id ? 'kit' : eq.cable_id ? 'cable' : 'item');

      const base = {
        event_id: eventId,
        quantity: Number(eq.quantity ?? 1) || 1,
        status: eq.status ?? 'reserved',
        notes: eq.notes ?? null,
        auto_added: !!eq.auto_added,
        offer_id: eq.offer_id ?? null,
      };

      if (type === 'kit') {
        return {
          ...base,
          equipment_id: null,
          cable_id: null,
          kit_id: eq.kit_id ?? eq.id ?? null,
        };
      }

      if (type === 'cable') {
        return {
          ...base,
          equipment_id: null,
          kit_id: null,
          cable_id: eq.cable_id ?? eq.id ?? null,
        };
      }

      // default: item
      return {
        ...base,
        kit_id: null,
        cable_id: null,
        equipment_id: eq.equipment_id ?? eq.id ?? null,
      };
    })
    // usuń ew. rekordy, które nie mają żadnego id (żeby nie waliło constraintem / nullami)
    .filter((r) => !!(r.equipment_id || r.kit_id || r.cable_id));

  // 2) deduplikacja w tej samej paczce (to też potrafi powodować błąd 21000)
  const seen = new Set<string>();
  const unique: any[] = [];

  for (const r of mapped) {
    const key = r.equipment_id
      ? `item:${r.equipment_id}`
      : r.kit_id
        ? `kit:${r.kit_id}`
        : `cable:${r.cable_id}`;

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(r);
    }
  }

  return unique;
};

interface EventWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialDate?: Date;
  initialClientType?: ClientType | null;
}

interface Organization {
  id: string;
  name: string;
  alias?: string | null;
}

interface Contact {
  contact_type: string;
  id: string;
  full_name: string;
  organization_id?: string | null;
}

interface EventCategory {
  id: string;
  name: string;
  color: string;
  icon_name?: string;
}

export default function EventWizard({
  isOpen,
  onClose,
  onSuccess,
  initialDate,
  initialClientType,
}: EventWizardProps) {
  const { showSnackbar } = useSnackbar();
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [createdEventId, setCreatedEventId] = useState<string | null>(null);
  const { addEmployee } = useEventTeam(createdEventId);

  const { list: employeesList } = useEmployees({ activeOnly: true });

  // Krok 1: Szczegóły eventu
  const [eventData, setEventData] = useState({
    name: '',
    organization_id: '',
    contact_person_id: '',
    category_id: '',
    event_date: initialDate?.toISOString().slice(0, 16) || '',
    event_end_date: '',
    location: '',
    budget: '',
    description: '',
    status: 'offer_sent',
  });

  const [clientType, setClientType] = useState<'business' | 'individual'>(
    initialClientType || 'business',
  );
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [filteredContacts, setFilteredContacts] = useState<Contact[]>([]);
  const [categories, setCategories] = useState<EventCategory[]>([]);
  const [showNewContactForm, setShowNewContactForm] = useState(false);
  const [newContact, setNewContact] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
  });
  const [participants, setParticipants] = useState<any[]>([]);

  // Krok 2: Oferta (opcjonalnie)
  const [createOffer, setCreateOffer] = useState(false);
  const [showOfferWizard, setShowOfferWizard] = useState(false);
  const [offerData, setOfferData] = useState({
    offer_number: '',
    valid_until: '',
    notes: '',
  });

  // Krok 3: Sprzęt (opcjonalnie)
  const [assignEquipment, setAssignEquipment] = useState(false);
  const [selectedEquipment, setSelectedEquipment] = useState<any[]>([]);
  const [equipmentList, setEquipmentList] = useState<any[]>([]);
  const [relatedEventIds, setRelatedEventIds] = useState<string[]>([]);

  // Krok 4: Zespół (opcjonalnie)
  const [assignTeam, setAssignTeam] = useState(false);
  const [selectedEmployees, setSelectedEmployees] = useState<any[]>([]);

  // Krok 5: Logistyka (opcjonalnie)
  const [assignVehicles, setAssignVehicles] = useState(false);
  const [selectedVehicles, setSelectedVehicles] = useState<any[]>([]);
  const [vehiclesList, setVehiclesList] = useState<any[]>([]);

  // Krok 6: Podwykonawcy (opcjonalnie)
  const [assignSubcontractors, setAssignSubcontractors] = useState(false);
  const [selectedSubcontractors, setSelectedSubcontractors] = useState<any[]>([]);
  const [subcontractorsList, setSubcontractorsList] = useState<any[]>([]);

  const { equipment } = useEventEquipment(createdEventId as string);

  const steps = [
    { id: 1, name: 'Szczegóły', icon: Calendar, required: true },
    { id: 2, name: 'Oferta', icon: FileText, required: false },
    { id: 3, name: 'Sprzęt', icon: Package, required: false },
    { id: 4, name: 'Zespół', icon: Users, required: false },
    { id: 5, name: 'Logistyka', icon: Truck, required: false },
    { id: 6, name: 'Podwykonawcy', icon: Wrench, required: false },
  ];

  useEffect(() => {
    if (isOpen) {
      fetchOrganizations();
      fetchContacts();
      fetchCategories();
    }
  }, [isOpen]);

  useEffect(() => {
    if (initialDate) {
      setEventData((prev) => ({
        ...prev,
        event_date: initialDate.toISOString().slice(0, 16),
      }));
    }
  }, [initialDate]);

  useEffect(() => {
    if (clientType === 'business' && eventData.organization_id) {
      const filtered = contacts.filter((c) => c.organization_id === eventData.organization_id);
      setFilteredContacts(filtered);

      // Auto-select jeśli tylko jedna osoba kontaktowa
      if (filtered.length === 1 && !eventData.contact_person_id) {
        setEventData((prev) => ({ ...prev, contact_person_id: filtered[0].id }));
      }
    } else if (clientType === 'individual') {
      // Dla klienta indywidualnego - kontakty bez organizacji
      const filtered = contacts.filter(
        (c) => !c.organization_id || c.contact_type === 'individual',
      );
      setFilteredContacts(filtered);
    } else {
      setFilteredContacts(contacts);
    }
  }, [eventData.organization_id, contacts, clientType]);

  const fetchOrganizations = async () => {
    const { data } = await supabase.from('organizations').select('id, name, alias').order('name');
    if (data) setOrganizations(data);
  };

  const fetchContacts = async () => {
    const { data } = await supabase
      .from('contacts')
      .select(
        `
        id,
        full_name,
        contact_type,
        contact_organizations(
          organization_id,
          is_primary,
          is_current
        )
      `,
      )
      .order('full_name');

    if (data) {
      const mappedContacts = data.map((contact) => ({
        ...contact,
        organization_id:
          contact.contact_organizations?.find((co: any) => co.is_current)?.organization_id ||
          contact.contact_organizations?.[0]?.organization_id ||
          null,
      }));
      setContacts(mappedContacts as any);
    }
  };

  const fetchCategories = async () => {
    const { data } = await supabase.from('event_categories').select('*').order('name');
    if (data) setCategories(data);
  };

  const fetchEquipment = async () => {
    const { data } = await supabase
      .from('equipment_items')
      .select('id, name, brand, model, thumbnail_url, warehouse_category_id')
      .order('name');
    if (data) setEquipmentList(data);
  };

  const loadEquipmentFromOffer = async () => {
    if (!createdEventId) return;

    try {
      // Pobierz ofertę dla tego eventu
      const { data: offer } = await supabase
        .from('offers')
        .select('id, total_amount')
        .eq('event_id', createdEventId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!offer) return;

      // Zaktualizuj budżet eventu z oferty
      if (offer.total_amount) {
        await supabase
          .from('events')
          .update({ budget: offer.total_amount })
          .eq('id', createdEventId);

        setEventData((prev) => ({ ...prev, budget: offer.total_amount.toString() }));
      }

      // Pobierz pozycje z oferty (offer_items)
      const { data: offerItems } = await supabase
        .from('offer_items')
        .select('id, name, quantity, product_id')
        .eq('offer_id', offer.id);

      if (!offerItems || offerItems.length === 0) {
        showSnackbar('Budżet zaktualizowany z oferty', 'success');
        return;
      }

      // Pobierz sprzęt przypisany do produktów z oferty
      const productIds = offerItems
        .map((item) => item.product_id)
        .filter((id): id is string => !!id);

      if (productIds.length === 0) {
        showSnackbar('Budżet zaktualizowany z oferty', 'success');
        return;
      }

      // Pobierz sprzęt z offer_product_equipment dla wszystkich produktów
      const { data: productEquipment, error: eqError } = await supabase
        .from('offer_product_equipment')
        .select('equipment_item_id, equipment_kit_id, quantity, notes')
        .in('product_id', productIds);

      if (eqError) throw eqError;

      if (productEquipment && productEquipment.length > 0) {
        // Wstaw sprzęt do event_equipment
        const equipmentToInsert = buildEventEquipmentRows(
          productEquipment.map((eq) => ({
            id: eq.equipment_item_id ?? eq.equipment_kit_id,
            type: eq.equipment_item_id ? 'item' : 'kit',
            quantity: eq.quantity || 1,
            notes: eq.notes || null,
            auto_added: true,
            offer_id: offer.id,
          })),
          createdEventId as unknown as string,
        );

        const { error: insertError } = await supabase
          .from('event_equipment')
          .insert(equipmentToInsert);

        if (insertError) throw insertError;

        // Pobierz szczegóły sprzętu do wyświetlenia
        const equipmentIds = productEquipment
          .map((eq) => eq.equipment_item_id)
          .filter((id): id is string => !!id);
        const kitIds = productEquipment
          .map((eq) => eq.equipment_kit_id)
          .filter((id): id is string => !!id);

        let equipmentDetails: any[] = [];
        let kitDetails: any[] = [];

        if (equipmentIds.length > 0) {
          const { data: eqData } = await supabase
            .from('equipment_items')
            .select('id, name, thumbnail_url')
            .in('id', equipmentIds);
          equipmentDetails = eqData || [];
        }

        if (kitIds.length > 0) {
          const { data: kitData } = await supabase
            .from('equipment_kits')
            .select('id, name, thumbnail_url')
            .in('id', kitIds);
          kitDetails = kitData || [];
        }

        // Zaktualizuj state selectedEquipment
        const mappedEquipment = productEquipment
          .map((eq) => {
            if (eq.equipment_item_id) {
              const detail = equipmentDetails.find((d) => d.id === eq.equipment_item_id);
              return {
                id: eq.equipment_item_id,
                name: detail?.name || 'Sprzęt',
                thumbnail_url: detail?.thumbnail_url,
                quantity: eq.quantity,
                type: 'item',
              };
            } else if (eq.equipment_kit_id) {
              const detail = kitDetails.find((d) => d.id === eq.equipment_kit_id);
              return {
                id: eq.equipment_kit_id,
                name: detail?.name || 'Zestaw',
                thumbnail_url: detail?.thumbnail_url,
                quantity: eq.quantity,
                type: 'kit',
              };
            }
            return null;
          })
          .filter(Boolean);

        setSelectedEquipment(mappedEquipment);
        setAssignEquipment(true);

        showSnackbar(
          `Zaimportowano ${productEquipment.length} pozycji sprzętu z oferty`,
          'success',
        );
      } else {
        showSnackbar('Budżet zaktualizowany z oferty', 'success');
      }
    } catch (err: any) {
      showSnackbar('Błąd podczas ładowania sprzętu z oferty: ' + err.message, 'error');
    }
  };

  const fetchVehicles = async () => {
    const { data } = await supabase
      .from('vehicles')
      .select('*')
      .eq('status', 'available')
      .order('name');
    if (data) setVehiclesList(data);
  };

  const fetchSubcontractors = async () => {
    const { data } = await supabase
      .from('subcontractors')
      .select('*')
      .eq('is_active', true)
      .order('name');
    if (data) setSubcontractorsList(data);
  };

  const handleCreateContact = async () => {
    if (!newContact.first_name || !newContact.last_name) {
      showSnackbar('Wypełnij imię i nazwisko', 'error');
      return;
    }

    try {
      const contactData: any = {
        first_name: newContact.first_name,
        last_name: newContact.last_name,
        email: newContact.email || null,
        phone: newContact.phone || null,
        contact_type: clientType === 'individual' ? 'individual' : 'organization_contact',
      };

      const { data: newContactData, error } = await supabase
        .from('contacts')
        .insert([contactData])
        .select()
        .single();

      if (error) throw error;

      if (clientType === 'business' && eventData.organization_id) {
        const { error: orgError } = await supabase.from('contact_organizations').insert([
          {
            contact_id: newContactData.id,
            organization_id: eventData.organization_id,
            is_current: true,
            is_primary: true,
          },
        ]);

        if (orgError) throw orgError;
      }

      await fetchContacts();
      setEventData({ ...eventData, contact_person_id: newContactData.id });
      setShowNewContactForm(false);
      setNewContact({ first_name: '', last_name: '', email: '', phone: '' });
      showSnackbar('Osoba kontaktowa dodana!', 'success');
    } catch (err: any) {
      showSnackbar('Błąd: ' + err.message, 'error');
    }
  };

  const canProceed = () => {
    if (currentStep === 1) {
      return eventData.name && eventData.event_date && eventData.location;
    }
    return true;
  };

  const handleNext = async () => {
    if (currentStep === 1) {
      if (createdEventId) {
        // Event już istnieje - edytuj
        await updateEvent();
      } else {
        // Utwórz nowy event
        await createEvent();
      }
    } else if (currentStep === steps.length) {
      await finishWizard();
    } else {
      setCurrentStep(currentStep + 1);
      loadStepData(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSkip = () => {
    if (currentStep < steps.length) {
      setCurrentStep(currentStep + 1);
      loadStepData(currentStep + 1);
    } else {
      finishWizard();
    }
  };

  const loadStepData = (step: number) => {
    switch (step) {
      case 3:
        if (!equipmentList.length) fetchEquipment();
        break;
      case 4:
        if (!employeesList.length) {
          console.log('employeesList', employeesList);
        }
        break;
      case 5:
        if (!vehiclesList.length) fetchVehicles();
        break;
      case 6:
        if (!subcontractorsList.length) fetchSubcontractors();
        break;
    }
  };

  const createEvent = async () => {
    setLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const { data, error } = await supabase
        .from('events')
        .insert([
          {
            name: eventData.name,
            organization_id:
              eventData.organization_id && eventData.organization_id.trim() !== ''
                ? eventData.organization_id
                : null,
            contact_person_id:
              eventData.contact_person_id && eventData.contact_person_id.trim() !== ''
                ? eventData.contact_person_id
                : null,
            category_id:
              eventData.category_id && eventData.category_id.trim() !== ''
                ? eventData.category_id
                : null,
            event_date: eventData.event_date,
            event_end_date: eventData.event_end_date || null,
            location: eventData.location,
            budget: eventData.budget ? parseFloat(eventData.budget) : null,
            description: eventData.description || null,
            status: eventData.status,
            created_by: session?.user?.id || null,
            participants: participants.length > 0 ? participants : [],
          },
        ])
        .select()
        .single();

      if (error) throw error;

      setCreatedEventId(data.id);

      // Automatycznie dodaj autora do zespołu z pełnym dostępem (status: accepted)
      if (session?.user?.id) {
        const { error: assignmentError } = await supabase.from('employee_assignments').insert([
          {
            event_id: data.id,
            employee_id: session.user.id,
            role: 'Koordynator',
            status: 'accepted',
            can_edit_event: true,
            can_edit_agenda: true,
            can_edit_tasks: true,
            can_edit_files: true,
            can_edit_equipment: true,
            can_invite_members: true,
            can_view_budget: true,
            granted_by: session.user.id,
            permissions_updated_at: new Date().toISOString(),
          },
        ]);

        if (assignmentError) {
          console.error('Error adding creator to team:', assignmentError);
          showSnackbar(
            'Uwaga: Nie udało się automatycznie dodać Cię do zespołu wydarzenia',
            'error',
          );
        }
      }

      showSnackbar('Event utworzony pomyślnie!', 'success');
      setCurrentStep(2);
    } catch (err: any) {
      console.error('Error creating event:', err);
      showSnackbar('Błąd podczas tworzenia eventu: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const updateEvent = async () => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('events')
        .update({
          name: eventData.name,
          organization_id:
            eventData.organization_id && eventData.organization_id.trim() !== ''
              ? eventData.organization_id
              : null,
          contact_person_id:
            eventData.contact_person_id && eventData.contact_person_id.trim() !== ''
              ? eventData.contact_person_id
              : null,
          category_id:
            eventData.category_id && eventData.category_id.trim() !== ''
              ? eventData.category_id
              : null,
          event_date: eventData.event_date,
          event_end_date: eventData.event_end_date || null,
          location: eventData.location,
          budget: eventData.budget ? parseFloat(eventData.budget) : null,
          description: eventData.description || null,
          status: eventData.status,
          participants: participants.length > 0 ? participants : [],
        })
        .eq('id', createdEventId);

      if (error) throw error;

      showSnackbar('Event zaktualizowany!', 'success');
      setCurrentStep(2);
    } catch (err: any) {
      console.error('Error updating event:', err);
      showSnackbar('Błąd podczas aktualizacji: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const finishWizard = async () => {
    setLoading(true);
    try {
      if (!createdEventId) throw new Error('Brak ID eventu');

      // Krok 2: Utwórz ofertę jeśli wybrano
      if (createOffer && currentStep >= 2) {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        await supabase.from('offers').insert([
          {
            event_id: createdEventId,
            offer_number: offerData.offer_number || null,
            valid_until: offerData.valid_until || null,
            notes: offerData.notes || null,
            status: 'draft',
            created_by: session?.user?.id || null,
          },
        ]);
      }

      // Krok 3: Przypisz sprzęt
      if (assignEquipment && selectedEquipment.length > 0) {
        // 1) pobierz istniejące wpisy dla eventu
        const { data: existing, error: existingErr } = await supabase
          .from('event_equipment')
          .select('equipment_id, kit_id, cable_id')
          .eq('event_id', createdEventId);

        if (existingErr) throw existingErr;

        const existingKeys = new Set(
          (existing ?? []).map((r: any) =>
            r.equipment_id
              ? `item:${r.equipment_id}`
              : r.kit_id
                ? `kit:${r.kit_id}`
                : `cable:${r.cable_id}`,
          ),
        );

        // 2) zbuduj poprawne wiersze
        const rows = buildEventEquipmentRows(selectedEquipment, createdEventId);

        // 2a) DEDUPLIKACJA w obrębie tej samej paczki (żeby nie było powtórek w jednym insercie)
        const grouped = new Map<string, any>();

        for (const r of rows) {
          const key = r.equipment_id
            ? `item:${r.equipment_id}`
            : r.kit_id
              ? `kit:${r.kit_id}`
              : `cable:${r.cable_id}`;

          const prev = grouped.get(key);

          if (!prev) {
            grouped.set(key, { ...r });
          } else {
            // sumujemy ilości (bezpiecznie)
            prev.quantity = (prev.quantity || 0) + (r.quantity || 0);

            // notatki sklejamy bez dublowania
            const a = (prev.notes || '').trim();
            const b = (r.notes || '').trim();
            if (b && !a.includes(b)) {
              prev.notes = a ? `${a}\n${b}` : b;
            }
          }
        }

        const dedupedRows = Array.from(grouped.values());

        // 3) zostaw tylko brakujące
        const toInsert = dedupedRows.filter((r: any) => {
          const key = r.equipment_id
            ? `item:${r.equipment_id}`
            : r.kit_id
              ? `kit:${r.kit_id}`
              : `cable:${r.cable_id}`;

          return !existingKeys.has(key);
        });

        // 4) INSERT PO 1 REKORDZIE (omija błąd 21000 w razie triggera/upserta po stronie DB)
        for (const row of toInsert) {
          const { error: insertErr } = await supabase.from('event_equipment').insert([row]);
          if (insertErr) throw insertErr;
        }
      }

      // Krok 4: Przypisz / zaproś zespół (TAK JAK MODAL)
      if (assignTeam && selectedEmployees.length > 0) {
        for (const emp of selectedEmployees) {
          await addEmployee({
            employeeId: emp.id,
            role: emp.role || '',
            responsibilities: emp.responsibilities || '',
            access_level_id: emp.access_level_id || null,
            permissions: emp.permissions || {
              can_edit_event: false,
              can_edit_agenda: false,
              can_edit_tasks: false,
              can_edit_files: false,
              can_edit_equipment: false,
              can_invite_members: false,
              can_view_budget: false,
            },
          });
        }
      }

      // Krok 5: Przypisz pojazdy
      if (assignVehicles && selectedVehicles.length > 0) {
        const vehicleItems = selectedVehicles.map((veh) => ({
          event_id: createdEventId,
          vehicle_id: veh.id,
          assigned_at: new Date().toISOString(),
        }));
        await supabase.from('event_vehicles').insert(vehicleItems);
      }

      // Krok 6: Przypisz podwykonawców
      if (assignSubcontractors && selectedSubcontractors.length > 0) {
        const subcontractorItems = selectedSubcontractors.map((sub) => ({
          event_id: createdEventId,
          subcontractor_id: sub.id,
          description: sub.description || '',
        }));
        await supabase.from('event_subcontractors').insert(subcontractorItems);
      }

      showSnackbar('Event utworzony pomyślnie ze wszystkimi szczegółami!', 'success');
      onSuccess();
      onClose();
      resetWizard();
    } catch (err: any) {
      console.error('Error finishing wizard:', err);
      showSnackbar('Błąd: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const resetWizard = () => {
    setCurrentStep(1);
    setCreatedEventId(null);
    setClientType('business');
    setEventData({
      name: '',
      organization_id: '',
      contact_person_id: '',
      category_id: '',
      event_date: '',
      event_end_date: '',
      location: '',
      budget: '',
      description: '',
      status: 'offer_sent',
    });
    setShowNewContactForm(false);
    setNewContact({ first_name: '', last_name: '', email: '', phone: '' });
    setParticipants([]);
    setRelatedEventIds([]);
    setCreateOffer(false);
    setAssignEquipment(false);
    setAssignTeam(false);
    setAssignVehicles(false);
    setAssignSubcontractors(false);
    setSelectedEquipment([]);
    setSelectedEmployees([]);
    setSelectedVehicles([]);
    setSelectedSubcontractors([]);
  };

  if (!isOpen) return null;

  const currentStepInfo = steps[currentStep - 1];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-[#d3bb73]/20 bg-[#0f1117]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-6">
          <div className="flex items-center gap-3">
            <currentStepInfo.icon className="h-6 w-6 text-[#d3bb73]" />
            <div>
              <h2 className="text-xl font-light text-[#e5e4e2]">Nowy event</h2>
              <p className="text-sm text-[#e5e4e2]/60">
                Krok {currentStep} z {steps.length}: {currentStepInfo.name}
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              onClose();
              resetWizard();
            }}
            className="rounded-lg p-2 transition-colors hover:bg-[#d3bb73]/10"
          >
            <X className="h-5 w-5 text-[#e5e4e2]" />
          </button>
        </div>

        {/* Progress indicator */}
        <div className="border-b border-[#d3bb73]/10 px-6 py-4">
          <div className="flex items-center justify-between">
            {steps.map((step, index) => (
              <div key={step.id} className="flex flex-1 items-center">
                <div className="flex flex-1 flex-col items-center">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors ${
                      step.id < currentStep
                        ? 'border-[#d3bb73] bg-[#d3bb73] text-[#1c1f33]'
                        : step.id === currentStep
                          ? 'border-[#d3bb73] bg-[#d3bb73]/20 text-[#d3bb73]'
                          : 'border-[#d3bb73]/30 bg-[#1c1f33] text-[#e5e4e2]/50'
                    }`}
                  >
                    {step.id < currentStep ? (
                      <Check className="h-5 w-5" />
                    ) : (
                      <step.icon className="h-5 w-5" />
                    )}
                  </div>
                  <span
                    className={`mt-2 text-xs ${
                      step.id === currentStep ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/50'
                    }`}
                  >
                    {step.name}
                  </span>
                  {!step.required && <span className="text-[10px] text-[#e5e4e2]/40">(opcja)</span>}
                </div>
                {index < steps.length - 1 && (
                  <div
                    className={`mx-2 h-0.5 flex-1 ${
                      step.id < currentStep ? 'bg-[#d3bb73]' : 'bg-[#d3bb73]/20'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Content - będzie w następnej części */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Step 1: Szczegóły eventu */}
          {currentStep === 1 && (
            <div className="mx-auto max-w-2xl space-y-4">
              <div className="mb-6 rounded-lg border border-blue-500/20 bg-blue-500/10 p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-400" />
                  <div className="text-sm text-blue-300">
                    <p className="mb-1 font-medium">Podstawowe informacje o evencie</p>
                    <p className="text-blue-300/80">
                      Wypełnij wymagane pola. Po utworzeniu eventu będziesz mógł dodać szczegóły
                      takie jak oferta, sprzęt, zespół i logistyka.
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                  Nazwa eventu *
                </label>
                <input
                  type="text"
                  value={eventData.name}
                  onChange={(e) => setEventData({ ...eventData, name: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                  placeholder="np. Konferencja Tech Summit 2025"
                />
              </div>

              {/* Typ klienta */}
              <div>
                <label className="mb-3 block text-sm font-medium text-[#e5e4e2]">
                  Typ klienta *
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setClientType('business');
                      setEventData({ ...eventData, organization_id: '', contact_person_id: '' });
                    }}
                    className={`rounded-lg border-2 p-4 text-left transition-all ${
                      clientType === 'business'
                        ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                        : 'border-[#d3bb73]/20 hover:border-[#d3bb73]/40'
                    }`}
                  >
                    <Building2
                      className={`mb-2 h-5 w-5 ${clientType === 'business' ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/50'}`}
                    />
                    <div className="font-medium text-[#e5e4e2]">Businessowy</div>
                    <div className="mt-1 text-xs text-[#e5e4e2]/60">
                      Firmy, agencje, organizacje
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setClientType('individual');
                      setEventData({ ...eventData, organization_id: '', contact_person_id: '' });
                    }}
                    className={`rounded-lg border-2 p-4 text-left transition-all ${
                      clientType === 'individual'
                        ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                        : 'border-[#d3bb73]/20 hover:border-[#d3bb73]/40'
                    }`}
                  >
                    <User
                      className={`mb-2 h-5 w-5 ${clientType === 'individual' ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/50'}`}
                    />
                    <div className="font-medium text-[#e5e4e2]">Indywidualny</div>
                    <div className="mt-1 text-xs text-[#e5e4e2]/60">Prywatny, wesela</div>
                  </button>
                </div>
              </div>

              {/* Klient businessowy */}
              {clientType === 'business' && (
                <>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                      Organizacja
                    </label>
                    <select
                      value={eventData.organization_id}
                      onChange={(e) => {
                        setEventData({
                          ...eventData,
                          organization_id: e.target.value,
                          contact_person_id: '',
                        });
                      }}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                    >
                      <option value="">Wybierz organizację</option>
                      {organizations.map((org) => (
                        <option key={org.id} value={org.id}>
                          {org.alias || org.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {eventData.organization_id && (
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <label className="block text-sm font-medium text-[#e5e4e2]">
                          Osoba kontaktowa
                        </label>
                        <button
                          type="button"
                          onClick={() => setShowNewContactForm(true)}
                          className="flex items-center gap-1 text-xs text-[#d3bb73] hover:text-[#d3bb73]/80"
                        >
                          <Plus className="h-3 w-3" />
                          Dodaj nową
                        </button>
                      </div>
                      <select
                        value={eventData.contact_person_id}
                        onChange={(e) =>
                          setEventData({ ...eventData, contact_person_id: e.target.value })
                        }
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                      >
                        <option value="">Wybierz kontakt</option>
                        {filteredContacts.map((contact) => (
                          <option key={contact.id} value={contact.id}>
                            {contact.full_name}
                          </option>
                        ))}
                      </select>
                      {filteredContacts.length === 1 && eventData.contact_person_id && (
                        <p className="mt-1 text-xs text-green-400">
                          ✓ Automatycznie wybrano jedyną osobę kontaktową
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Klient indywidualny */}
              {clientType === 'individual' && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="block text-sm font-medium text-[#e5e4e2]">
                      Osoba kontaktowa
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowNewContactForm(true)}
                      className="flex items-center gap-1 text-xs text-[#d3bb73] hover:text-[#d3bb73]/80"
                    >
                      <Plus className="h-3 w-3" />
                      Dodaj nową
                    </button>
                  </div>
                  <select
                    value={eventData.contact_person_id}
                    onChange={(e) =>
                      setEventData({ ...eventData, contact_person_id: e.target.value })
                    }
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                  >
                    <option value="">Wybierz lub dodaj nową osobę</option>
                    {filteredContacts.map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contact.full_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Formularz nowej osoby kontaktowej */}
              {showNewContactForm && (
                <div className="space-y-3 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-sm font-medium text-[#e5e4e2]">Nowa osoba kontaktowa</h4>
                    <button
                      type="button"
                      onClick={() => setShowNewContactForm(false)}
                      className="text-[#e5e4e2]/50 hover:text-[#e5e4e2]"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder="Imię *"
                      value={newContact.first_name}
                      onChange={(e) => setNewContact({ ...newContact, first_name: e.target.value })}
                      className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                    />
                    <input
                      type="text"
                      placeholder="Nazwisko *"
                      value={newContact.last_name}
                      onChange={(e) => setNewContact({ ...newContact, last_name: e.target.value })}
                      className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                    />
                  </div>
                  <input
                    type="email"
                    placeholder="Email"
                    value={newContact.email}
                    onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                  />
                  <input
                    type="tel"
                    placeholder="Telefon"
                    value={newContact.phone}
                    onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1117] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleCreateContact}
                    className="w-full rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                  >
                    Dodaj osobę kontaktową
                  </button>
                </div>
              )}

              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Kategoria</label>
                <select
                  value={eventData.category_id}
                  onChange={(e) => setEventData({ ...eventData, category_id: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                >
                  <option value="">Wybierz kategorię</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Data rozpoczęcia *
                  </label>
                  <input
                    type="datetime-local"
                    value={eventData.event_date}
                    onChange={(e) => setEventData({ ...eventData, event_date: e.target.value })}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Data zakończenia
                  </label>
                  <input
                    type="datetime-local"
                    min={eventData.event_date}
                    value={eventData.event_end_date}
                    onChange={(e) => setEventData({ ...eventData, event_end_date: e.target.value })}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                  Lokalizacja *
                </label>
                <LocationSelector
                  value={eventData.location}
                  onChange={(value) => setEventData({ ...eventData, location: value })}
                  placeholder="Wybierz z listy lub wyszukaj nową lokalizację..."
                />
                <p className="mt-1 text-xs text-[#e5e4e2]/50">
                  Wybierz z zapisanych lokalizacji lub wyszukaj nową w Google Maps
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Budżet (PLN)
                  </label>
                  <input
                    type="number"
                    value={eventData.budget}
                    onChange={(e) => setEventData({ ...eventData, budget: e.target.value })}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                    placeholder="0"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Status</label>
                  <select
                    value={eventData.status}
                    onChange={(e) => setEventData({ ...eventData, status: e.target.value })}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                  >
                    <option value="offer_sent">Oferta wysłana</option>
                    <option value="offer_accepted">Zaakceptowana</option>
                    <option value="in_preparation">Przygotowanie</option>
                    <option value="in_progress">W trakcie</option>
                    <option value="completed">Zakończony</option>
                    <option value="invoiced">Rozliczony</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Opis</label>
                <textarea
                  value={eventData.description}
                  onChange={(e) => setEventData({ ...eventData, description: e.target.value })}
                  rows={4}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                  placeholder="Dodatkowe informacje o evencie..."
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Uczestnicy</label>
                <ParticipantsAutocomplete
                  value={participants}
                  onChange={setParticipants}
                  placeholder="Dodaj uczestników (pracownicy, kontakty lub wpisz nazwę)..."
                  eventId={createdEventId}
                />
                <p className="mt-1 text-xs text-[#e5e4e2]/50">
                  Wybierz pracowników, kontakty lub wpisz imię i nazwisko ręcznie
                </p>
              </div>
            </div>
          )}

          {/* Step 2: Oferta */}
          {currentStep === 2 && (
            <div className="mx-auto max-w-2xl space-y-6">
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-4">
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={createOffer}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setCreateOffer(checked);
                      if (checked && createdEventId) {
                        // Otwórz OfferWizard
                        setShowOfferWizard(true);
                      }
                    }}
                    className="h-5 w-5 rounded border-[#d3bb73]/30 text-[#d3bb73] focus:ring-[#d3bb73]"
                  />
                  <span className="text-sm text-blue-300">
                    Utwórz ofertę dla tego eventu (otwiera kreator oferty)
                  </span>
                </label>
              </div>

              {createOffer && !createdEventId && (
                <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-4">
                  <p className="text-sm text-yellow-300">
                    Najpierw utwórz event w kroku 1, aby móc dodać ofertę.
                  </p>
                </div>
              )}

              {createOffer && createdEventId ? (
                <div className="space-y-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                      Numer oferty
                    </label>
                    <input
                      type="text"
                      value={offerData.offer_number}
                      onChange={(e) => setOfferData({ ...offerData, offer_number: e.target.value })}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                      placeholder="Zostaw puste aby wygenerować automatycznie"
                    />
                    <p className="mt-1 text-xs text-[#e5e4e2]/50">
                      Pozostaw puste - numer zostanie wygenerowany automatycznie (OF/YYYY/MM/XXX)
                    </p>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                      Ważna do
                    </label>
                    <input
                      type="date"
                      value={offerData.valid_until}
                      onChange={(e) => setOfferData({ ...offerData, valid_until: e.target.value })}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Notatki</label>
                    <textarea
                      value={offerData.notes}
                      onChange={(e) => setOfferData({ ...offerData, notes: e.target.value })}
                      rows={4}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                      placeholder="Dodatkowe informacje do oferty..."
                    />
                  </div>

                  <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-4">
                    <p className="text-sm text-yellow-300">
                      Oferta zostanie utworzona jako szkic. Możesz dodać pozycje i szczegóły później
                      w zakładce Oferty eventu.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="py-12 text-center text-[#e5e4e2]/50">
                  <p>Ofertę możesz utworzyć później ze strony szczegółów eventu</p>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Sprzęt */}
          {currentStep === 3 && (
            <EquipmentStep
              assignEquipment={assignEquipment}
              setAssignEquipment={setAssignEquipment}
              selectedEquipment={selectedEquipment}
              setSelectedEquipment={setSelectedEquipment}
              equipmentList={equipmentList}
            />
          )}

          {/* Step 4: Zespół */}
          {currentStep === 4 && (
            <div>
              <TeamStep
                assignTeam={assignTeam}
                setAssignTeam={setAssignTeam}
                selectedEmployees={selectedEmployees}
                setSelectedEmployees={setSelectedEmployees}
                employeesList={employeesList}
                eventId={createdEventId}
              />
            </div>
          )}

          {/* Steps 5-6 - proste wersje */}
          {currentStep > 4 && (
            <div className="py-12 text-center text-[#e5e4e2]/50">
              <p className="mb-4">
                Krok {currentStep}: {currentStepInfo.name}
              </p>
              <p className="text-sm">Te szczegóły możesz dodać później ze strony eventu</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[#d3bb73]/10 p-6">
          <button
            onClick={handleBack}
            disabled={currentStep === 1 || loading}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ChevronLeft className="h-4 w-4" />
            Wstecz
          </button>

          <div className="flex items-center gap-3">
            {currentStep > 1 && (
              <button
                onClick={handleSkip}
                disabled={loading}
                className="rounded-lg px-4 py-2 text-[#e5e4e2]/70 transition-colors hover:bg-[#d3bb73]/10"
              >
                Pomiń
              </button>
            )}

            <button
              onClick={handleNext}
              disabled={!canProceed() || loading}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                'Przetwarzanie...'
              ) : currentStep === 1 ? (
                createdEventId ? (
                  <>
                    Zapisz zmiany
                    <ChevronRight className="h-4 w-4" />
                  </>
                ) : (
                  <>
                    Utwórz event
                    <ChevronRight className="h-4 w-4" />
                  </>
                )
              ) : currentStep === steps.length ? (
                <>
                  <Check className="h-4 w-4" />
                  Zakończ
                </>
              ) : (
                <>
                  Dalej
                  <ChevronRight className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* OfferWizard - otwiera się gdy user zaznaczy checkbox */}
      {showOfferWizard && createdEventId && (
        <OfferWizard
          isOpen={showOfferWizard}
          onClose={() => {
            setShowOfferWizard(false);
            setCreateOffer(false);
          }}
          eventId={createdEventId}
          organizationId={eventData.organization_id}
          contactId={eventData.contact_person_id}
          clientType={clientType}
          onSuccess={async () => {
            setShowOfferWizard(false);
            showSnackbar('Oferta utworzona pomyślnie!', 'success');
            // Automatycznie przejdź do kroku 3 (Sprzęt)
            setCurrentStep(3);
            // Załaduj sprzęt z oferty
            await loadEquipmentFromOffer();
            // Załaduj listę dostępnego sprzętu
            if (!equipmentList.length) await fetchEquipment();
          }}
        />
      )}
    </div>
  );
}
