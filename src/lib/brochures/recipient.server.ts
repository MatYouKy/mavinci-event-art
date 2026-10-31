import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BrochureRequestError } from './access.server';
import type { BrochureClient } from './recipient';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Use the caller's RLS client, never the service-role client, for client selection.
export async function resolveBrochureClient(client: SupabaseClient, input: unknown): Promise<BrochureClient | null> {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new BrochureRequestError('Wybierz kontakt lub organizację z bazy CRM.', 400);
  }
  const value = input as Record<string, unknown>;
  for (const key of ['contactId', 'organizationId'] as const) {
    if (value[key] != null && (typeof value[key] !== 'string' || !uuid.test(value[key] as string))) {
      throw new BrochureRequestError('Nieprawidłowy klient. Wybierz go ponownie z bazy CRM.', 400);
    }
  }
  const contactId = value.contactId as string | undefined;
  const organizationId = value.organizationId as string | undefined;
  if (!contactId && !organizationId) return null;

  const [contact, organization] = await Promise.all([
    contactId
      ? client.from('contacts').select('id,full_name').eq('id', contactId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    organizationId
      ? client.from('organizations').select('id,name').eq('id', organizationId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (contact.error || organization.error) {
    throw new BrochureRequestError('Nie udało się sprawdzić klienta. Spróbuj ponownie; PDF nie został utworzony.', 503);
  }
  if ((contactId && !contact.data) || (organizationId && !organization.data)) {
    throw new BrochureRequestError('Wybrany kontakt lub organizacja nie istnieje albo nie masz do niego dostępu.', 403);
  }
  if (contactId && organizationId) {
    const relation = await client.from('contact_organizations').select('contact_id')
      .eq('contact_id', contactId).eq('organization_id', organizationId).eq('is_current', true).limit(1);
    if (relation.error) throw new BrochureRequestError('Nie udało się sprawdzić powiązania kontaktu z organizacją.', 503);
    if (!relation.data?.length) {
      throw new BrochureRequestError('Kontakt nie jest obecnie przypisany do tej organizacji. Wybierz klienta ponownie.', 400);
    }
  }
  return {
    ...(contactId ? { contactId } : {}),
    ...(organizationId ? { organizationId, organizationName: organization.data!.name } : {}),
    name: contact.data?.full_name || organization.data?.name || 'Klient',
  };
}
