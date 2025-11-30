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
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface EventWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialDate?: Date;
}

interface Organization {
  id: string;
  name: string;
  alias?: string | null;
}

interface Contact {
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
}: EventWizardProps) {
  const { showSnackbar } = useSnackbar();
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [createdEventId, setCreatedEventId] = useState<string | null>(null);

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

  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [filteredContacts, setFilteredContacts] = useState<Contact[]>([]);
  const [categories, setCategories] = useState<EventCategory[]>([]);

  // Krok 2: Oferta (opcjonalnie)
  const [createOffer, setCreateOffer] = useState(false);
  const [offerData, setOfferData] = useState({
    offer_number: '',
    valid_until: '',
    notes: '',
  });

  // Krok 3: Sprzęt (opcjonalnie)
  const [assignEquipment, setAssignEquipment] = useState(false);
  const [selectedEquipment, setSelectedEquipment] = useState<any[]>([]);
  const [equipmentList, setEquipmentList] = useState<any[]>([]);

  // Krok 4: Zespół (opcjonalnie)
  const [assignTeam, setAssignTeam] = useState(false);
  const [selectedEmployees, setSelectedEmployees] = useState<any[]>([]);
  const [employeesList, setEmployeesList] = useState<any[]>([]);

  // Krok 5: Logistyka (opcjonalnie)
  const [assignVehicles, setAssignVehicles] = useState(false);
  const [selectedVehicles, setSelectedVehicles] = useState<any[]>([]);
  const [vehiclesList, setVehiclesList] = useState<any[]>([]);

  // Krok 6: Podwykonawcy (opcjonalnie)
  const [assignSubcontractors, setAssignSubcontractors] = useState(false);
  const [selectedSubcontractors, setSelectedSubcontractors] = useState<any[]>([]);
  const [subcontractorsList, setSubcontractorsList] = useState<any[]>([]);

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
      setEventData(prev => ({
        ...prev,
        event_date: initialDate.toISOString().slice(0, 16),
      }));
    }
  }, [initialDate]);

  useEffect(() => {
    if (eventData.organization_id) {
      const filtered = contacts.filter(c => c.organization_id === eventData.organization_id);
      setFilteredContacts(filtered);
    } else {
      setFilteredContacts(contacts);
    }
  }, [eventData.organization_id, contacts]);

  const fetchOrganizations = async () => {
    const { data } = await supabase
      .from('organizations')
      .select('id, name, alias')
      .order('name');
    if (data) setOrganizations(data);
  };

  const fetchContacts = async () => {
    const { data } = await supabase
      .from('contacts')
      .select('id, full_name, organization_id')
      .order('full_name');
    if (data) setContacts(data);
  };

  const fetchCategories = async () => {
    const { data } = await supabase
      .from('event_categories')
      .select('*')
      .order('name');
    if (data) setCategories(data);
  };

  const fetchEquipment = async () => {
    const { data } = await supabase
      .from('equipment_items')
      .select('*, equipment_categories(name)')
      .order('name');
    if (data) setEquipmentList(data);
  };

  const fetchEmployees = async () => {
    const { data } = await supabase
      .from('employees')
      .select('id, full_name, email, avatar_url')
      .eq('is_active', true)
      .order('full_name');
    if (data) setEmployeesList(data);
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

  const canProceed = () => {
    if (currentStep === 1) {
      return eventData.name && eventData.event_date && eventData.location;
    }
    return true;
  };

  const handleNext = async () => {
    if (currentStep === 1) {
      await createEvent();
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
        if (!employeesList.length) fetchEmployees();
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
      const { data: { session } } = await supabase.auth.getSession();

      const { data, error } = await supabase
        .from('events')
        .insert([
          {
            name: eventData.name,
            organization_id: eventData.organization_id || null,
            contact_person_id: eventData.contact_person_id || null,
            category_id: eventData.category_id || null,
            event_date: eventData.event_date,
            event_end_date: eventData.event_end_date || null,
            location: eventData.location,
            budget: eventData.budget ? parseFloat(eventData.budget) : null,
            description: eventData.description || null,
            status: eventData.status,
            created_by: session?.user?.id || null,
          },
        ])
        .select()
        .single();

      if (error) throw error;

      setCreatedEventId(data.id);

      // Automatycznie dodaj autora do zespołu
      if (session?.user?.id) {
        await supabase
          .from('employee_assignments')
          .insert([{
            event_id: data.id,
            employee_id: session.user.id,
            role: 'Koordynator'
          }]);
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

  const finishWizard = async () => {
    setLoading(true);
    try {
      if (!createdEventId) throw new Error('Brak ID eventu');

      // Krok 2: Utwórz ofertę jeśli wybrano
      if (createOffer && currentStep >= 2) {
        await supabase.from('offers').insert([{
          event_id: createdEventId,
          offer_number: offerData.offer_number || null,
          valid_until: offerData.valid_until || null,
          notes: offerData.notes || null,
          status: 'draft',
        }]);
      }

      // Krok 3: Przypisz sprzęt
      if (assignEquipment && selectedEquipment.length > 0) {
        const equipmentItems = selectedEquipment.map(eq => ({
          event_id: createdEventId,
          equipment_id: eq.id,
          quantity: eq.quantity || 1,
          status: 'reserved',
        }));
        await supabase.from('event_equipment').insert(equipmentItems);
      }

      // Krok 4: Przypisz zespół
      if (assignTeam && selectedEmployees.length > 0) {
        const teamItems = selectedEmployees.map(emp => ({
          event_id: createdEventId,
          employee_id: emp.id,
          role: emp.role || 'Członek zespołu',
        }));
        await supabase.from('employee_assignments').insert(teamItems);
      }

      // Krok 5: Przypisz pojazdy
      if (assignVehicles && selectedVehicles.length > 0) {
        const vehicleItems = selectedVehicles.map(veh => ({
          event_id: createdEventId,
          vehicle_id: veh.id,
          assigned_at: new Date().toISOString(),
        }));
        await supabase.from('event_vehicles').insert(vehicleItems);
      }

      // Krok 6: Przypisz podwykonawców
      if (assignSubcontractors && selectedSubcontractors.length > 0) {
        const subcontractorItems = selectedSubcontractors.map(sub => ({
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#0f1117] rounded-xl border border-[#d3bb73]/20 w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[#d3bb73]/10">
          <div className="flex items-center gap-3">
            <currentStepInfo.icon className="w-6 h-6 text-[#d3bb73]" />
            <div>
              <h2 className="text-xl font-light text-[#e5e4e2]">Nowy event</h2>
              <p className="text-sm text-[#e5e4e2]/60">
                Krok {currentStep} z {steps.length}: {currentStepInfo.name}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[#d3bb73]/10 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[#e5e4e2]" />
          </button>
        </div>

        {/* Progress indicator */}
        <div className="px-6 py-4 border-b border-[#d3bb73]/10">
          <div className="flex items-center justify-between">
            {steps.map((step, index) => (
              <div key={step.id} className="flex items-center flex-1">
                <div className="flex flex-col items-center flex-1">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors ${
                      step.id < currentStep
                        ? 'bg-[#d3bb73] border-[#d3bb73] text-[#1c1f33]'
                        : step.id === currentStep
                        ? 'bg-[#d3bb73]/20 border-[#d3bb73] text-[#d3bb73]'
                        : 'bg-[#1c1f33] border-[#d3bb73]/30 text-[#e5e4e2]/50'
                    }`}
                  >
                    {step.id < currentStep ? (
                      <Check className="w-5 h-5" />
                    ) : (
                      <step.icon className="w-5 h-5" />
                    )}
                  </div>
                  <span
                    className={`text-xs mt-2 ${
                      step.id === currentStep ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/50'
                    }`}
                  >
                    {step.name}
                  </span>
                  {!step.required && (
                    <span className="text-[10px] text-[#e5e4e2]/40">(opcja)</span>
                  )}
                </div>
                {index < steps.length - 1 && (
                  <div
                    className={`h-0.5 flex-1 mx-2 ${
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
            <div className="max-w-2xl mx-auto space-y-4">
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 mb-6">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-blue-300">
                    <p className="font-medium mb-1">Podstawowe informacje o evencie</p>
                    <p className="text-blue-300/80">
                      Wypełnij wymagane pola. Po utworzeniu eventu będziesz mógł dodać szczegóły takie jak oferta, sprzęt, zespół i logistyka.
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                  Nazwa eventu *
                </label>
                <input
                  type="text"
                  value={eventData.name}
                  onChange={(e) => setEventData({ ...eventData, name: e.target.value })}
                  className="w-full px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
                  placeholder="np. Konferencja Tech Summit 2025"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                    Organizacja
                  </label>
                  <select
                    value={eventData.organization_id}
                    onChange={(e) => setEventData({ ...eventData, organization_id: e.target.value })}
                    className="w-full px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
                  >
                    <option value="">Wybierz organizację</option>
                    {organizations.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name} {org.alias && `(${org.alias})`}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                    Osoba kontaktowa
                  </label>
                  <select
                    value={eventData.contact_person_id}
                    onChange={(e) => setEventData({ ...eventData, contact_person_id: e.target.value })}
                    className="w-full px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
                  >
                    <option value="">Wybierz kontakt</option>
                    {filteredContacts.map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contact.full_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                  Kategoria
                </label>
                <select
                  value={eventData.category_id}
                  onChange={(e) => setEventData({ ...eventData, category_id: e.target.value })}
                  className="w-full px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
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
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                    Data rozpoczęcia *
                  </label>
                  <input
                    type="datetime-local"
                    value={eventData.event_date}
                    onChange={(e) => setEventData({ ...eventData, event_date: e.target.value })}
                    className="w-full px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                    Data zakończenia
                  </label>
                  <input
                    type="datetime-local"
                    value={eventData.event_end_date}
                    onChange={(e) => setEventData({ ...eventData, event_end_date: e.target.value })}
                    className="w-full px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                  Lokalizacja *
                </label>
                <input
                  type="text"
                  value={eventData.location}
                  onChange={(e) => setEventData({ ...eventData, location: e.target.value })}
                  className="w-full px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
                  placeholder="np. Warszawa, Hotel Marriott"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                    Budżet (PLN)
                  </label>
                  <input
                    type="number"
                    value={eventData.budget}
                    onChange={(e) => setEventData({ ...eventData, budget: e.target.value })}
                    className="w-full px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
                    placeholder="0"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                    Status
                  </label>
                  <select
                    value={eventData.status}
                    onChange={(e) => setEventData({ ...eventData, status: e.target.value })}
                    className="w-full px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
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
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                  Opis
                </label>
                <textarea
                  value={eventData.description}
                  onChange={(e) => setEventData({ ...eventData, description: e.target.value })}
                  rows={4}
                  className="w-full px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
                  placeholder="Dodatkowe informacje o evencie..."
                />
              </div>
            </div>
          )}

          {/* Step 2: Oferta */}
          {currentStep === 2 && (
            <div className="max-w-2xl mx-auto space-y-6">
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createOffer}
                    onChange={(e) => setCreateOffer(e.target.checked)}
                    className="w-5 h-5 rounded border-[#d3bb73]/30 text-[#d3bb73] focus:ring-[#d3bb73]"
                  />
                  <span className="text-sm text-blue-300">
                    Utwórz ofertę dla tego eventu
                  </span>
                </label>
              </div>

              {createOffer ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                      Numer oferty
                    </label>
                    <input
                      type="text"
                      value={offerData.offer_number}
                      onChange={(e) => setOfferData({ ...offerData, offer_number: e.target.value })}
                      className="w-full px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
                      placeholder="Zostaw puste aby wygenerować automatycznie"
                    />
                    <p className="text-xs text-[#e5e4e2]/50 mt-1">
                      Pozostaw puste - numer zostanie wygenerowany automatycznie (OF/YYYY/MM/XXX)
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                      Ważna do
                    </label>
                    <input
                      type="date"
                      value={offerData.valid_until}
                      onChange={(e) => setOfferData({ ...offerData, valid_until: e.target.value })}
                      className="w-full px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                      Notatki
                    </label>
                    <textarea
                      value={offerData.notes}
                      onChange={(e) => setOfferData({ ...offerData, notes: e.target.value })}
                      rows={4}
                      className="w-full px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/50"
                      placeholder="Dodatkowe informacje do oferty..."
                    />
                  </div>

                  <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
                    <p className="text-sm text-yellow-300">
                      Oferta zostanie utworzona jako szkic. Możesz dodać pozycje i szczegóły później w zakładce Oferty eventu.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 text-[#e5e4e2]/50">
                  <p>Ofertę możesz utworzyć później ze strony szczegółów eventu</p>
                </div>
              )}
            </div>
          )}

          {/* Steps 3-6 - proste wersje */}
          {currentStep > 2 && (
            <div className="text-center py-12 text-[#e5e4e2]/50">
              <p className="mb-4">Krok {currentStep}: {currentStepInfo.name}</p>
              <p className="text-sm">Te szczegóły możesz dodać później ze strony eventu</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-[#d3bb73]/10">
          <button
            onClick={handleBack}
            disabled={currentStep === 1 || loading}
            className="flex items-center gap-2 px-4 py-2 text-[#e5e4e2] hover:bg-[#d3bb73]/10 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
            Wstecz
          </button>

          <div className="flex items-center gap-3">
            {currentStep > 1 && (
              <button
                onClick={handleSkip}
                disabled={loading}
                className="px-4 py-2 text-[#e5e4e2]/70 hover:bg-[#d3bb73]/10 rounded-lg transition-colors"
              >
                Pomiń
              </button>
            )}

            <button
              onClick={handleNext}
              disabled={!canProceed() || loading}
              className="flex items-center gap-2 px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                'Przetwarzanie...'
              ) : currentStep === 1 ? (
                <>
                  Utwórz event
                  <ChevronRight className="w-4 h-4" />
                </>
              ) : currentStep === steps.length ? (
                <>
                  <Check className="w-4 h-4" />
                  Zakończ
                </>
              ) : (
                <>
                  Dalej
                  <ChevronRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
