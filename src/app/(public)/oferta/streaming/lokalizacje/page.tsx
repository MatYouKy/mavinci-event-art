import ServiceLocationsPage, { serviceLocationsMetadata } from '@/components/Layout/ServiceLocationsPage';

export const dynamic = 'force-dynamic';
export const metadata = serviceLocationsMetadata('streaming');
export default function LocationsPage() {
  return <ServiceLocationsPage service="streaming" />;
}
