'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { ClientType } from '../types';

export function useOfferWizardClient(opts: {
  isOpen: boolean;
  step: number;
  defaults?: { clientType?: 'individual' | 'business'; organizationId?: string; contactId?: string };
}) {
  const initialClientType: ClientType = opts.defaults?.clientType ?? '';
  const [clientType, setClientType] = useState<ClientType>(initialClientType);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState(opts.defaults?.organizationId ?? '');
  const [selectedContactId, setSelectedContactId] = useState(opts.defaults?.contactId ?? '');

  const [organizations, setOrganizations] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [clientSearchQuery, setClientSearchQuery] = useState('');
  const [showAddClientModal, setShowAddClientModal] = useState(false);

  useEffect(() => {
    if (!opts.isOpen || opts.step !== 1) return;

    (async () => {
      const orgRes = await supabase
        .from('organizations')
        .select('id, name, nip, email, phone')
        .order('name');

      if (!orgRes.error && orgRes.data) setOrganizations(orgRes.data);

      const cRes = await supabase
        .from('contacts')
        .select('id, first_name, last_name, full_name, email, phone, company_name')
        .eq('contact_type', 'individual')
        .order('last_name');

      if (!cRes.error && cRes.data) setContacts(cRes.data);
    })();
  }, [opts.isOpen, opts.step]);

  const canProceedFromStep1 = useMemo(() => {
    if (!clientType) return false;
    if (clientType === 'business') return !!selectedOrganizationId;
    if (clientType === 'individual') return !!selectedContactId;
    return false;
  }, [clientType, selectedOrganizationId, selectedContactId]);

  return {
    // state
    clientType,
    selectedOrganizationId,
    selectedContactId,
    organizations,
    contacts,
    clientSearchQuery,
    showAddClientModal,

    // setters
    setClientType,
    setSelectedOrganizationId,
    setSelectedContactId,
    setClientSearchQuery,
    setShowAddClientModal,

    // helpers
    canProceedFromStep1,
    setContacts, // potrzebne w AddClientModal
  };
}