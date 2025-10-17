'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Car, ArrowLeft, Save, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

export default function NewVehiclePage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { employee } = useCurrentEmployee();
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
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
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.brand || !formData.model) {
      showSnackbar('Wypełnij wymagane pola: Nazwa, Marka, Model', 'error');
      return;
    }

    setLoading(true);

    try {
      const vehicleData = {
        ...formData,
        year: formData.year ? parseInt(formData.year.toString()) : null,
        engine_capacity: formData.engine_capacity ? parseInt(formData.engine_capacity.toString()) : null,
        power_hp: formData.power_hp ? parseInt(formData.power_hp.toString()) : null,
        power_kw: formData.power_kw ? parseInt(formData.power_kw.toString()) : null,
        number_of_seats: formData.number_of_seats ? parseInt(formData.number_of_seats.toString()) : null,
        max_load_kg: formData.max_load_kg ? parseInt(formData.max_load_kg.toString()) : null,
        purchase_price: formData.purchase_price ? parseFloat(formData.purchase_price.toString()) : null,
        current_value: formData.current_value ? parseFloat(formData.current_value.toString()) : null,
        leasing_monthly_cost: formData.leasing_monthly_cost ? parseFloat(formData.leasing_monthly_cost.toString()) : null,
        initial_mileage: formData.initial_mileage ? parseInt(formData.initial_mileage.toString()) : 0,
        current_mileage: formData.current_mileage ? parseInt(formData.current_mileage.toString()) : 0,
        created_by: employee?.id || null,
        purchase_date: formData.purchase_date || null,
        leasing_end_date: formData.leasing_end_date || null,
      };

      const { data, error } = await supabase
        .from('vehicles')
        .insert([vehicleData])
        .select()
        .single();

      if (error) throw error;

      showSnackbar('Pojazd został dodany pomyślnie', 'success');
      router.push(`/crm/fleet/${data.id}`);
    } catch (error: any) {
      console.error('Error creating vehicle:', error);
      showSnackbar(error.message || 'Błąd podczas dodawania pojazdu', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-[#e5e4e2]/60 hover:text-[#e5e4e2] mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Powrót
        </button>
        <h1 className="text-3xl font-bold text-[#e5e4e2] flex items-center gap-3">
          <Car className="w-8 h-8 text-[#d3bb73]" />
          Dodaj nowy pojazd
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Dane podstawowe */}
        <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-6">
          <h2 className="text-xl font-semibold text-[#e5e4e2] mb-4">Dane podstawowe</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Nazwa pojazdu <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="np. Bus Eventowy Główny"
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Marka <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                name="brand"
                value={formData.brand}
                onChange={handleChange}
                placeholder="np. Mercedes-Benz"
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Model <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                name="model"
                value={formData.model}
                onChange={handleChange}
                placeholder="np. Sprinter 519 CDI"
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Numer rejestracyjny
              </label>
              <input
                type="text"
                name="registration_number"
                value={formData.registration_number}
                onChange={handleChange}
                placeholder="np. KR 12345"
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">VIN</label>
              <input
                type="text"
                name="vin"
                value={formData.vin}
                onChange={handleChange}
                placeholder="17-znakowy numer VIN"
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Rok produkcji
              </label>
              <input
                type="number"
                name="year"
                value={formData.year}
                onChange={handleChange}
                min="1900"
                max={new Date().getFullYear() + 1}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Kolor</label>
              <input
                type="text"
                name="color"
                value={formData.color}
                onChange={handleChange}
                placeholder="np. Biały"
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Kategoria</label>
              <select
                name="category"
                value={formData.category}
                onChange={handleChange}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              >
                <option value="personal_car">Samochód osobowy</option>
                <option value="van">Bus/Van</option>
                <option value="truck">Ciężarówka</option>
                <option value="bus">Autobus</option>
                <option value="motorcycle">Motocykl</option>
                <option value="trailer">Przyczepa</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Status</label>
              <select
                name="status"
                value={formData.status}
                onChange={handleChange}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              >
                <option value="active">Aktywny</option>
                <option value="inactive">Nieaktywny</option>
                <option value="in_service">W serwisie</option>
                <option value="sold">Sprzedany</option>
                <option value="scrapped">Złomowany</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Typ własności
              </label>
              <select
                name="ownership_type"
                value={formData.ownership_type}
                onChange={handleChange}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              >
                <option value="owned">Własny</option>
                <option value="leased">Leasing</option>
                <option value="rented">Wynajem</option>
              </select>
            </div>
          </div>
        </div>

        {/* Dane techniczne */}
        <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-6">
          <h2 className="text-xl font-semibold text-[#e5e4e2] mb-4">Dane techniczne</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Typ silnika
              </label>
              <input
                type="text"
                name="engine_type"
                value={formData.engine_type}
                onChange={handleChange}
                placeholder="np. diesel"
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Pojemność (cm³)
              </label>
              <input
                type="number"
                name="engine_capacity"
                value={formData.engine_capacity}
                onChange={handleChange}
                placeholder="np. 2143"
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Moc (KM)</label>
              <input
                type="number"
                name="power_hp"
                value={formData.power_hp}
                onChange={handleChange}
                placeholder="np. 190"
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Moc (kW)</label>
              <input
                type="number"
                name="power_kw"
                value={formData.power_kw}
                onChange={handleChange}
                placeholder="np. 140"
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Typ paliwa
              </label>
              <select
                name="fuel_type"
                value={formData.fuel_type}
                onChange={handleChange}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              >
                <option value="benzyna95">Benzyna 95</option>
                <option value="benzyna98">Benzyna 98</option>
                <option value="diesel">Diesel</option>
                <option value="LPG">LPG</option>
                <option value="elektryczny">Elektryczny</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Skrzynia biegów
              </label>
              <select
                name="transmission"
                value={formData.transmission}
                onChange={handleChange}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              >
                <option value="manualna">Manualna</option>
                <option value="automatyczna">Automatyczna</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Napęd</label>
              <input
                type="text"
                name="drive_type"
                value={formData.drive_type}
                onChange={handleChange}
                placeholder="np. przedni, tylny, 4x4"
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Liczba miejsc
              </label>
              <input
                type="number"
                name="number_of_seats"
                value={formData.number_of_seats}
                onChange={handleChange}
                placeholder="np. 9"
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Maks. ładowność (kg)
              </label>
              <input
                type="number"
                name="max_load_kg"
                value={formData.max_load_kg}
                onChange={handleChange}
                placeholder="np. 1500"
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            </div>
          </div>
        </div>

        {/* Przebieg */}
        <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-6">
          <h2 className="text-xl font-semibold text-[#e5e4e2] mb-4">Przebieg</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Przebieg początkowy (km)
              </label>
              <input
                type="number"
                name="initial_mileage"
                value={formData.initial_mileage}
                onChange={handleChange}
                placeholder="0"
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Przebieg aktualny (km)
              </label>
              <input
                type="number"
                name="current_mileage"
                value={formData.current_mileage}
                onChange={handleChange}
                placeholder="0"
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            </div>
          </div>
        </div>

        {/* Koszty */}
        <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-6">
          <h2 className="text-xl font-semibold text-[#e5e4e2] mb-4">Koszty i wartość</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Cena zakupu (zł)
              </label>
              <input
                type="number"
                name="purchase_price"
                value={formData.purchase_price}
                onChange={handleChange}
                placeholder="0"
                step="0.01"
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Data zakupu
              </label>
              <input
                type="date"
                name="purchase_date"
                value={formData.purchase_date}
                onChange={handleChange}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Wartość bieżąca (zł)
              </label>
              <input
                type="number"
                name="current_value"
                value={formData.current_value}
                onChange={handleChange}
                placeholder="0"
                step="0.01"
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            </div>

            {formData.ownership_type === 'leased' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                    Firma leasingowa
                  </label>
                  <input
                    type="text"
                    name="leasing_company"
                    value={formData.leasing_company}
                    onChange={handleChange}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                    Rata leasingowa (zł/mies.)
                  </label>
                  <input
                    type="number"
                    name="leasing_monthly_cost"
                    value={formData.leasing_monthly_cost}
                    onChange={handleChange}
                    placeholder="0"
                    step="0.01"
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                    Koniec leasingu
                  </label>
                  <input
                    type="date"
                    name="leasing_end_date"
                    value={formData.leasing_end_date}
                    onChange={handleChange}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                  />
                </div>
              </>
            )}
          </div>
        </div>

        {/* Lokalizacja */}
        <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-6">
          <h2 className="text-xl font-semibold text-[#e5e4e2] mb-4">Lokalizacja</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Aktualna lokalizacja
              </label>
              <input
                type="text"
                name="current_location"
                value={formData.current_location}
                onChange={handleChange}
                placeholder="np. Magazyn Kraków"
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Miejsce parkowania
              </label>
              <input
                type="text"
                name="parking_location"
                value={formData.parking_location}
                onChange={handleChange}
                placeholder="np. Parking A, miejsce 12"
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                Garaż/Baza
              </label>
              <input
                type="text"
                name="garage_location"
                value={formData.garage_location}
                onChange={handleChange}
                placeholder="np. Baza główna"
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            </div>
          </div>
        </div>

        {/* Opis i notatki */}
        <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-6">
          <h2 className="text-xl font-semibold text-[#e5e4e2] mb-4">Dodatkowe informacje</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Opis</label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleChange}
                rows={3}
                placeholder="Krótki opis pojazdu..."
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Notatki</label>
              <textarea
                name="notes"
                value={formData.notes}
                onChange={handleChange}
                rows={4}
                placeholder="Dodatkowe notatki, uwagi..."
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              />
            </div>
          </div>
        </div>

        {/* Przyciski */}
        <div className="flex gap-4 justify-end">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-6 py-3 bg-[#0f1119] text-[#e5e4e2] rounded-lg hover:bg-[#0f1119]/80 transition-colors"
            disabled={loading}
          >
            Anuluj
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-6 py-3 rounded-lg hover:bg-[#d3bb73]/90 transition-colors font-medium disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Dodawanie...
              </>
            ) : (
              <>
                <Save className="w-5 h-5" />
                Dodaj pojazd
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
