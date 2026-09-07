import MarketingIntegrationSettings from '@/components/crm/marketing/MarketingIntegrationSettings';

export default function CompanyMarketingSettingsPage({ params }: { params: { id: string } }) {
  return <MarketingIntegrationSettings companyId={params.id} />;
}
