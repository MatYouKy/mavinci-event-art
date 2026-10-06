'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import type { InquiryOrganization } from './matchOrganizationByEmail';

export async function getContactOrganizations(contactId: string): Promise<InquiryOrganization[]> {
  const { data, error } = await supabase.from('contact_organizations')
    .select('organization:organizations(id,name,alias,email,phone,website)')
    .eq('contact_id', contactId).eq('is_current', true);
  if (error) throw new Error('Nie udało się odczytać organizacji z Karty Klienta 360°. Spróbuj ponownie.');
  const organizations = new Map<string, InquiryOrganization>();
  for (const relation of data || []) {
    const organization = (Array.isArray(relation.organization) ? relation.organization[0] : relation.organization) as InquiryOrganization | null;
    // An inaccessible relation must not be replaced with a guessed domain match.
    if (!organization) throw new Error('Nie można odczytać powiązanej organizacji. Sprawdź dostęp w Karcie Klienta 360°.');
    organizations.set(organization.id, organization);
  }
  return [...organizations.values()];
}

export function useInquiryContactOrganizations(contactId: string | null) {
  const [state, setState] = useState<{ contactId: string | null; organizations: InquiryOrganization[]; loading: boolean; error: string }>({
    contactId, organizations: [], loading: Boolean(contactId), error: '',
  });
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    if (!contactId) {
      setState({ contactId, organizations: [], loading: false, error: '' });
      return;
    }
    setState(previous => ({ contactId, organizations: previous.contactId === contactId ? previous.organizations : [], loading: true, error: '' }));
    try {
      const organizations = await getContactOrganizations(contactId);
      if (generation.current === current) setState({ contactId, organizations, loading: false, error: '' });
    } catch (error) {
      if (generation.current === current) setState({ contactId, organizations: [], loading: false, error: (error as Error).message });
    }
  }, [contactId]);
  useEffect(() => {
    void refresh();
    const onReturn = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      generation.current++;
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [refresh]);
  return state.contactId === contactId ? { ...state, refresh }
    : { contactId, organizations: [] as InquiryOrganization[], loading: Boolean(contactId), error: '', refresh };
}
