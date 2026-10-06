'use client';

import { LocationRooms } from '@/components/crm/locations/LocationRooms';
import { LocationTechnicalDetails } from '@/components/crm/locations/LocationTechnicalDetails';
import OrganizationLocationPicker from './OrganizationLocationPicker';

export default function OrganizationHotelSpaces({
  organizationId,
  locationId,
  canEditLocation,
  canChangeLink,
  editingOrganization,
  onChangeLink,
}: {
  organizationId: string;
  locationId: string | null;
  canEditLocation: boolean;
  canChangeLink: boolean;
  editingOrganization: boolean;
  onChangeLink: () => void;
}) {
  return <div className="space-y-5 text-[#e5e4e2]">
    <section className="space-y-3 rounded-xl bg-white/[0.035] p-5">
      <h2 className="text-lg uppercase">Sale i przestrzenie hotelu</h2>
      <p className="text-sm leading-6 text-white/60">
        Jedna wspólna baza: sale, wymiary, zasilanie, rzuty i zdjęcia zapisujemy w lokalizacji.
        Edycja tutaj zmienia te same dane co karta lokalizacji. Sprzedawcy korzystają z podglądu
        i wybierają przestrzeń do oferty. Zapisane wcześniej ustalenia ofert zachowują swoją wersję danych.
      </p>
      <OrganizationLocationPicker organizationId={organizationId} currentLocationId={locationId}
        editMode={false} onLocationChange={() => {}} required />
      {!locationId && <p role="alert" className="rounded-lg bg-amber-300/10 p-3 text-sm text-amber-200">
        Ten hotel wymaga powiązania z lokalizacją. Wybierz istniejący obiekt albo utwórz nowy — nie dodajemy drugiej listy sal w organizacji.
      </p>}
      {canChangeLink && <button type="button" onClick={onChangeLink} className="rounded-lg bg-white/5 px-4 py-2 text-sm text-[#d3bb73] hover:bg-white/10">
        {locationId ? 'Zmień powiązaną lokalizację' : 'Powiąż lokalizację hotelu'}
      </button>}
    </section>
    {editingOrganization ? <p role="status" className="rounded-lg bg-amber-300/10 p-4 text-sm text-amber-200">
      Najpierw zapisz lub anuluj zmiany organizacji. Edycja sal będzie dostępna dla zapisanej lokalizacji.
    </p> : locationId && <>
      {!canEditLocation && <p className="text-sm text-white/55">Podgląd danych. Do edycji sal i materiałów wymagane są uprawnienia do zarządzania lokalizacjami.</p>}
      <LocationRooms key={`rooms:${locationId}`} locationId={locationId} readOnly={!canEditLocation}/>
      <LocationTechnicalDetails key={`technical:${locationId}`} locationId={locationId} readOnly={!canEditLocation}/>
    </>}
  </div>;
}
