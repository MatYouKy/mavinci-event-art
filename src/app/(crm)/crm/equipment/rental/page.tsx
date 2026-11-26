import { redirect } from 'next/navigation';

/** Dawniej Magazyn → Rental — teraz Rental → Wynajem od podwykonawców (`/crm/rental/subcontractors`). */
export default function EquipmentRentalRedirect() {
  redirect('/crm/rental/subcontractors');
}
