'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Car, ArrowLeft, Save, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useAppDispatch } from '@/store/hooks';
import { fleetApi, useCreateVehicleMutation } from '../api/fleetApi';

const toOptionalNumber = (
  value: string | number | null | undefined,
): number | undefined => {
  if (value === '' || value === null || value === undefined) {
    return undefined;
  }

  const parsedValue = Number(value);

  return Number.isFinite(parsedValue) ? parsedValue : undefined;
};

const toOptionalString = (
  value: string | null | undefined,
): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  const trimmedValue = value.trim();

  return trimmedValue === '' ? undefined : trimmedValue;
};

export default function NewVehiclePage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { employee } = useCurrentEmployee();
  const dispatch = useAppDispatch();
  const [createVehicle] = useCreateVehicleMutation();
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    vehicle_type: 'car',
    name: '',
    brand: '',
    model: '',
    registration_number: '',
    vin: '',
    year: new Date().getFullYear(),
    color: '',
    engine_type: '',
    engine_capacity: '',
    power_hp: '',
    power_kw: '',
    fuel_type: 'diesel',
    transmission: 'manualna',
    drive_type: '',
    number_of_seats: '',
    max_load_kg: '',
    length_cm: '',
    width_cm: '',
    height_cm: '',
    cargo_length_cm: '',
    cargo_width_cm: '',
    cargo_height_cm: '',
    total_length_cm: '',
    total_width_cm: '',
    total_height_cm: '',
    weight_kg: '',
    status: 'active',
    ownership_type: 'owned',
    category: 'van',
    purchase_price: '',
    purchase_date: '',
    current_value: '',
    leasing_company: '',
    leasing_monthly_cost: '',
    leasing_end_date: '',
    initial_mileage: '',
    current_mileage: '',
    current_location: '',
    parking_location: '',
    garage_location: '',
    description: '',
    notes: '',
    has_tow_hitch: false,
  });

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target;

    if (name === 'has_tow_hitch') {
      setFormData((prev) => ({
        ...prev,
        has_tow_hitch: value === 'true',
      }));
      return;
    }

    if (name === 'vehicle_type') {
      setFormData((prev) => ({
        ...prev,
        [name]: value,
        category: value === 'trailer' ? 'plandeka' : 'van',
      }));
      return;
    }

    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const toNullableNumber = (value: string | number | null | undefined) => {
    if (value === '' || value === null || value === undefined) {
      return null;
    }
  
    const parsedValue = Number(value);
  
    return Number.isFinite(parsedValue) ? parsedValue : null;
  };
  
  const toNullableString = (value: string | null | undefined) => {
    if (value === null || value === undefined) {
      return null;
    }
  
    const trimmedValue = value.trim();
  
    return trimmedValue === '' ? null : trimmedValue;
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
  
    if (!formData.name.trim() || !formData.brand.trim() || !formData.model.trim()) {
      showSnackbar('Wypełnij wymagane pola: Nazwa, Marka, Model', 'error');
      return;
    }
  
    if (!employee?.id) {
      showSnackbar('Nie udało się ustalić zalogowanego pracownika', 'error');
      return;
    }
  
    setLoading(true);
  
    const safeVehicleData = {
      vehicle_type: formData.vehicle_type,
      name: formData.name.trim(),
      brand: formData.brand.trim(),
      model: formData.model.trim(),
    
      registration_number: toOptionalString(formData.registration_number),
      vin: toOptionalString(formData.vin),
      year: toOptionalNumber(formData.year),
      color: toOptionalString(formData.color),
    
      engine_type:
        formData.vehicle_type === 'car'
          ? toOptionalString(formData.engine_type)
          : undefined,
    
      engine_capacity:
        formData.vehicle_type === 'car'
          ? toOptionalNumber(formData.engine_capacity)
          : undefined,
    
      power_hp:
        formData.vehicle_type === 'car'
          ? toOptionalNumber(formData.power_hp)
          : undefined,
    
      power_kw:
        formData.vehicle_type === 'car'
          ? toOptionalNumber(formData.power_kw)
          : undefined,
    
      fuel_type:
        formData.vehicle_type === 'car'
          ? formData.fuel_type
          : undefined,
    
      transmission:
        formData.vehicle_type === 'car'
          ? formData.transmission
          : undefined,
    
      drive_type:
        formData.vehicle_type === 'car'
          ? toOptionalString(formData.drive_type)
          : undefined,
    
      number_of_seats:
        formData.vehicle_type === 'car'
          ? toOptionalNumber(formData.number_of_seats)
          : undefined,
    
      max_load_kg: toOptionalNumber(formData.max_load_kg),
    
      length_cm: toOptionalNumber(formData.length_cm),
      width_cm: toOptionalNumber(formData.width_cm),
      height_cm: toOptionalNumber(formData.height_cm),
    
      cargo_length_cm:
        formData.vehicle_type === 'trailer'
          ? toOptionalNumber(formData.cargo_length_cm)
          : undefined,
    
      cargo_width_cm:
        formData.vehicle_type === 'trailer'
          ? toOptionalNumber(formData.cargo_width_cm)
          : undefined,
    
      cargo_height_cm:
        formData.vehicle_type === 'trailer'
          ? toOptionalNumber(formData.cargo_height_cm)
          : undefined,
    
      total_length_cm:
        formData.vehicle_type === 'trailer'
          ? toOptionalNumber(formData.total_length_cm)
          : undefined,
    
      total_width_cm:
        formData.vehicle_type === 'trailer'
          ? toOptionalNumber(formData.total_width_cm)
          : undefined,
    
      total_height_cm:
        formData.vehicle_type === 'trailer'
          ? toOptionalNumber(formData.total_height_cm)
          : undefined,
    
      weight_kg:
        formData.vehicle_type === 'trailer'
          ? toOptionalNumber(formData.weight_kg)
          : undefined,
    
      status: formData.status,
      ownership_type: formData.ownership_type,
      category: formData.category,
    
      purchase_price: toOptionalNumber(formData.purchase_price),
      purchase_date: formData.purchase_date || undefined,
      current_value: toOptionalNumber(formData.current_value),
    
      leasing_company:
        formData.ownership_type === 'leased'
          ? toOptionalString(formData.leasing_company)
          : undefined,
    
      leasing_monthly_cost:
        formData.ownership_type === 'leased'
          ? toOptionalNumber(formData.leasing_monthly_cost)
          : undefined,
    
      leasing_end_date:
        formData.ownership_type === 'leased'
          ? formData.leasing_end_date || undefined
          : undefined,
    
      initial_mileage:
        formData.vehicle_type === 'car'
          ? toOptionalNumber(formData.initial_mileage)
          : undefined,
    
      current_mileage:
        formData.vehicle_type === 'car'
          ? toOptionalNumber(formData.current_mileage)
          : undefined,
    
      current_location: toOptionalString(formData.current_location),
      parking_location: toOptionalString(formData.parking_location),
      garage_location: toOptionalString(formData.garage_location),
    
      description: toOptionalString(formData.description),
      notes: toOptionalString(formData.notes),
    
      has_tow_hitch:
        formData.vehicle_type === 'car'
          ? formData.has_tow_hitch
          : false,
    
      created_by: employee.id,
    };
  
    try {
      const created = await createVehicle(safeVehicleData).unwrap();
  
      showSnackbar('Pojazd został dodany pomyślnie', 'success');
  
      dispatch(
        fleetApi.util.updateQueryData(
          'getFleetVehicles',
          undefined,
          (draft) => {
            draft.push(created);
          },
        ),
      );
  
      router.push(`/crm/fleet/${created.id}`);
    } catch (error: any) {
      console.error('Błąd dodawania pojazdu:', error);
      console.error('Wysyłane dane:', safeVehicleData);
  
      const errorMessage =
        error?.data?.message ||
        error?.error ||
        error?.message ||
        'Błąd podczas dodawania pojazdu';
  
      showSnackbar(errorMessage, 'error');
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6">
        <button
          onClick={() => router.push('/crm/fleet')}
          className="mb-4 flex items-center gap-2 text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
        >
          <ArrowLeft className="h-4 w-4" />
          Powrót
        </button>
        <h1 className="flex items-center gap-3 text-3xl font-bold text-[#e5e4e2]">
          <Car className="h-8 w-8 text-[#d3bb73]" />
          Dodaj nowy {formData.vehicle_type === 'trailer' ? 'przyczepę' : 'pojazd'}
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Dane podstawowe */}
        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <h2 className="mb-4 text-xl font-semibold text-[#e5e4e2]">Dane podstawowe</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Typ <span className="text-red-400">*</span>
              </label>
              <select
                name="vehicle_type"
                value={formData.vehicle_type}
                onChange={handleChange}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              >
                <option value="car">Samochód</option>
                <option value="trailer">Przyczepa</option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Nazwa {formData.vehicle_type === 'trailer' ? 'przyczepy' : 'pojazdu'}{' '}
                <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="np. Bus Eventowy Główny"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Marka <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                name="brand"
                value={formData.brand}
                onChange={handleChange}
                placeholder="np. Mercedes-Benz"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Model <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                name="model"
                value={formData.model}
                onChange={handleChange}
                placeholder="np. Sprinter 519 CDI"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Numer rejestracyjny
              </label>
              <input
                type="text"
                name="registration_number"
                value={formData.registration_number}
                onChange={handleChange}
                placeholder="np. KR 12345"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">VIN</label>
              <input
                type="text"
                name="vin"
                value={formData.vin}
                onChange={handleChange}
                placeholder="17-znakowy numer VIN"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Rok produkcji</label>
              <input
                type="number"
                name="year"
                value={formData.year}
                onChange={handleChange}
                min="1900"
                max={new Date().getFullYear() + 1}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Kolor</label>
              <input
                type="text"
                name="color"
                value={formData.color}
                onChange={handleChange}
                placeholder="np. Biały"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Kategoria</label>
              <select
                name="category"
                value={formData.category}
                onChange={handleChange}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              >
                {formData.vehicle_type === 'trailer' ? (
                  <>
                    <option value="plandeka">Plandeka</option>
                    <option value="mobile_stage">Scena mobilna</option>
                    <option value="semi_trailer">Naczepa</option>
                    <option value="box_trailer">Przyczepa zamknięta</option>
                    <option value="flatbed_trailer">Przyczepa platformowa</option>
                    <option value="other_trailer">Inna przyczepa</option>
                  </>
                ) : (
                  <>
                    <option value="personal_car">Samochód osobowy</option>
                    <option value="van">Bus/Van</option>
                    <option value="truck">Ciężarówka</option>
                    <option value="bus">Autobus</option>
                    <option value="motorcycle">Motocykl</option>
                  </>
                )}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Status</label>
              <select
                name="status"
                value={formData.status}
                onChange={handleChange}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              >
                <option value="active">Aktywny</option>
                <option value="inactive">Nieaktywny</option>
                <option value="in_service">W serwisie</option>
                <option value="sold">Sprzedany</option>
                <option value="scrapped">Złomowany</option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Typ własności</label>
              <select
                name="ownership_type"
                value={formData.ownership_type}
                onChange={handleChange}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              >
                <option value="owned">Własny</option>
                <option value="leased">Leasing</option>
                <option value="rented">Wynajem</option>
              </select>
            </div>
          </div>
          <div className="mt-4">
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Hak samochodu</label>
            <select
              name="has_tow_hitch"
              value={String(formData.has_tow_hitch)}
              onChange={handleChange}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
            >
              <option value="true">Tak</option>
              <option value="false">Nie</option>
            </select>
          </div>
        </div>

        {/* Dane techniczne - tylko dla samochodów */}
        {formData.vehicle_type === 'car' && (
          <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <h2 className="mb-4 text-xl font-semibold text-[#e5e4e2]">Dane techniczne</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Typ silnika</label>
                <input
                  type="text"
                  name="engine_type"
                  value={formData.engine_type}
                  onChange={handleChange}
                  placeholder="np. diesel"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                  Pojemność (cm³)
                </label>
                <input
                  type="number"
                  name="engine_capacity"
                  value={formData.engine_capacity}
                  onChange={handleChange}
                  placeholder="np. 2143"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Moc (KM)</label>
                <input
                  type="number"
                  name="power_hp"
                  value={formData.power_hp}
                  onChange={handleChange}
                  placeholder="np. 190"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Moc (kW)</label>
                <input
                  type="number"
                  name="power_kw"
                  value={formData.power_kw}
                  onChange={handleChange}
                  placeholder="np. 140"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Typ paliwa</label>
                <select
                  name="fuel_type"
                  value={formData.fuel_type}
                  onChange={handleChange}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                >
                  <option value="benzyna95">Benzyna 95</option>
                  <option value="benzyna98">Benzyna 98</option>
                  <option value="diesel">Diesel</option>
                  <option value="LPG">LPG</option>
                  <option value="elektryczny">Elektryczny</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                  Skrzynia biegów
                </label>
                <select
                  name="transmission"
                  value={formData.transmission}
                  onChange={handleChange}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                >
                  <option value="manualna">Manualna</option>
                  <option value="automatyczna">Automatyczna</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Napęd</label>
                <input
                  type="text"
                  name="drive_type"
                  value={formData.drive_type}
                  onChange={handleChange}
                  placeholder="np. przedni, tylny, 4x4"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                  Liczba miejsc
                </label>
                <input
                  type="number"
                  name="number_of_seats"
                  value={formData.number_of_seats}
                  onChange={handleChange}
                  placeholder="np. 9"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                />
              </div>
            </div>
          </div>
        )}

        {/* Wymiary i ładowność */}
        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <h2 className="mb-4 text-xl font-semibold text-[#e5e4e2]">
            {formData.vehicle_type === 'trailer' ? 'Wymiary i ładowność' : 'Ładowność'}
          </h2>
          <div className="space-y-6">
            {formData.vehicle_type === 'trailer' && (
              <>
                <div>
                  <h3 className="text-md mb-3 font-medium text-[#e5e4e2]">
                    Wymiary części załadunkowej
                  </h3>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                        Długość (cm)
                      </label>
                      <input
                        type="number"
                        name="cargo_length_cm"
                        value={formData.cargo_length_cm}
                        onChange={handleChange}
                        placeholder="np. 600"
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                        Szerokość (cm)
                      </label>
                      <input
                        type="number"
                        name="cargo_width_cm"
                        value={formData.cargo_width_cm}
                        onChange={handleChange}
                        placeholder="np. 240"
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                        Wysokość (cm)
                      </label>
                      <input
                        type="number"
                        name="cargo_height_cm"
                        value={formData.cargo_height_cm}
                        onChange={handleChange}
                        placeholder="np. 280"
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-md mb-3 font-medium text-[#e5e4e2]">
                    Wymiary całkowite (bezwzględne)
                  </h3>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                        Długość całkowita (cm)
                      </label>
                      <input
                        type="number"
                        name="total_length_cm"
                        value={formData.total_length_cm}
                        onChange={handleChange}
                        placeholder="np. 720"
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                        Szerokość całkowita (cm)
                      </label>
                      <input
                        type="number"
                        name="total_width_cm"
                        value={formData.total_width_cm}
                        onChange={handleChange}
                        placeholder="np. 255"
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                        Wysokość całkowita (cm)
                      </label>
                      <input
                        type="number"
                        name="total_height_cm"
                        value={formData.total_height_cm}
                        onChange={handleChange}
                        placeholder="np. 300"
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                      Waga własna (kg)
                    </label>
                    <input
                      type="number"
                      name="weight_kg"
                      value={formData.weight_kg}
                      onChange={handleChange}
                      placeholder="np. 750"
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                    />
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Maks. ładowność (kg)
              </label>
              <input
                type="number"
                name="max_load_kg"
                value={formData.max_load_kg}
                onChange={handleChange}
                placeholder="np. 1500"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              />
            </div>
          </div>
        </div>

        {/* Przebieg - tylko dla samochodów */}
        {formData.vehicle_type === 'car' && (
          <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <h2 className="mb-4 text-xl font-semibold text-[#e5e4e2]">Przebieg</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                  Przebieg początkowy (km)
                </label>
                <input
                  type="number"
                  name="initial_mileage"
                  value={formData.initial_mileage}
                  onChange={handleChange}
                  placeholder="0"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                  Przebieg aktualny (km)
                </label>
                <input
                  type="number"
                  name="current_mileage"
                  value={formData.current_mileage}
                  onChange={handleChange}
                  placeholder="0"
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                />
              </div>
            </div>
          </div>
        )}

        {/* Koszty */}
        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <h2 className="mb-4 text-xl font-semibold text-[#e5e4e2]">Koszty i wartość</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Cena zakupu (zł)
              </label>
              <input
                type="number"
                name="purchase_price"
                value={formData.purchase_price}
                onChange={handleChange}
                placeholder="0"
                step="0.01"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Data zakupu</label>
              <input
                type="date"
                name="purchase_date"
                value={formData.purchase_date}
                onChange={handleChange}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Wartość bieżąca (zł)
              </label>
              <input
                type="number"
                name="current_value"
                value={formData.current_value}
                onChange={handleChange}
                placeholder="0"
                step="0.01"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              />
            </div>

            {formData.ownership_type === 'leased' && (
              <>
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Firma leasingowa
                  </label>
                  <input
                    type="text"
                    name="leasing_company"
                    value={formData.leasing_company}
                    onChange={handleChange}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Rata leasingowa (zł/mies.)
                  </label>
                  <input
                    type="number"
                    name="leasing_monthly_cost"
                    value={formData.leasing_monthly_cost}
                    onChange={handleChange}
                    placeholder="0"
                    step="0.01"
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Koniec leasingu
                  </label>
                  <input
                    type="date"
                    name="leasing_end_date"
                    value={formData.leasing_end_date}
                    onChange={handleChange}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                  />
                </div>
              </>
            )}
          </div>
        </div>

        {/* Lokalizacja */}
        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <h2 className="mb-4 text-xl font-semibold text-[#e5e4e2]">Lokalizacja</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Aktualna lokalizacja
              </label>
              <input
                type="text"
                name="current_location"
                value={formData.current_location}
                onChange={handleChange}
                placeholder="np. Magazyn Kraków"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Miejsce parkowania
              </label>
              <input
                type="text"
                name="parking_location"
                value={formData.parking_location}
                onChange={handleChange}
                placeholder="np. Parking A, miejsce 12"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Garaż/Baza</label>
              <input
                type="text"
                name="garage_location"
                value={formData.garage_location}
                onChange={handleChange}
                placeholder="np. Baza główna"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              />
            </div>
          </div>
        </div>

        {/* Opis i notatki */}
        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <h2 className="mb-4 text-xl font-semibold text-[#e5e4e2]">Dodatkowe informacje</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Opis</label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleChange}
                rows={3}
                placeholder="Krótki opis pojazdu..."
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Notatki</label>
              <textarea
                name="notes"
                value={formData.notes}
                onChange={handleChange}
                rows={4}
                placeholder="Dodatkowe notatki, uwagi..."
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              />
            </div>
          </div>
        </div>

        {/* Przyciski */}
        <div className="flex justify-end gap-4">
          <button
            type="button"
            onClick={() => router.push('/crm/fleet')}
            className="rounded-lg bg-[#0f1119] px-6 py-3 text-[#e5e4e2] transition-colors hover:bg-[#0f1119]/80"
            disabled={loading}
          >
            Anuluj
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Dodawanie...
              </>
            ) : (
              <>
                <Save className="h-5 w-5" />
                Dodaj pojazd
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
