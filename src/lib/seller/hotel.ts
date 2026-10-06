import type { ArrangementContact } from './arrangements';
import type { LocationRoom } from '@/components/crm/locations/LocationRooms';
import type { TechnicalDetails } from '@/components/crm/locations/LocationTechnicalDetails';

export type HotelVenueSnapshot = {
  organization_id: string;
  organization_name: string;
  location_id: string;
  location_name: string;
  room: LocationRoom;
  technical_details: TechnicalDetails;
};
export type SellerHotelContext = {
  available: boolean;
  can_edit: boolean;
  organizations?: { id: string; name: string }[];
  organization: { id: string; name: string } | null;
  location: { id: string; name: string; updated_at: string; rooms: LocationRoom[]; technical_details: TechnicalDetails } | null;
  contacts: (ArrangementContact & { id: string })[];
};
export function hotelContextError(error: { code?: string; message?: string } | null) {
  return ['PGRST202', '42883', '42P01'].includes(error?.code || '')
    ? 'Baza hotelu wymaga migracji 20260928130000_seller_hotel_venue_directory.sql oraz 20260928143000_seller_hotel_contact_organizations.sql.'
    : error?.message || 'Nie udało się wczytać bazy hotelu.';
}
