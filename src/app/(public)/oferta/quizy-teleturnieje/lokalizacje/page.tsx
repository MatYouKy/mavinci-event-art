import ServiceLocationsPage, { serviceLocationsMetadata } from '@/components/Layout/ServiceLocationsPage';

export const dynamic = 'force-dynamic';
export const metadata = serviceLocationsMetadata('quizy-teleturnieje');
export default function LocationsPage() {
  return <ServiceLocationsPage service="quizy-teleturnieje" />;
}
