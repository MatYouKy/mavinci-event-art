'use client';

import { useEffect, useMemo, useState } from 'react';
import { Building2, Loader2, ReceiptText, Save, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';

type BillingArrangement = 'direct' | 'hotel' | 'agency' | 'other';

type OrganizationOption = {
  id: string;
  name: string;
  alias: string | null;
};

type BillingContact = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  position: string | null;
};

interface Props {
  eventId: string;
  clientOrganizationId: string | null;
  clientOrganizationName?: string | null;
  initialArrangement?: BillingArrangement | null;
  initialBillingOrganizationId?: string | null;
  canEdit: boolean;
  onSaved?: (value: {
    billing_arrangement: BillingArrangement;
    billing_organization_id: string | null;
  }) => void | Promise<void>;
}

const arrangementLabels: Record<BillingArrangement, string> = {
  direct: 'Bezpośrednio przez klienta wydarzenia',
  hotel: 'Przez hotel',
  agency: 'Przez agencję',
  other: 'Przez inną organizację',
};

export default function EventBillingContextCard({
  eventId,
  clientOrganizationId,
  clientOrganizationName,
  initialArrangement = 'direct',
  initialBillingOrganizationId = null,
  canEdit,
  onSaved,
}: Props) {
  const { showSnackbar } = useSnackbar();
  const [arrangement, setArrangement] = useState<BillingArrangement>(
    initialArrangement || 'direct',
  );
  const [billingOrganizationId, setBillingOrganizationId] = useState(
    initialBillingOrganizationId || '',
  );
  const [organizations, setOrganizations] = useState<OrganizationOption[]>([]);
  const [contacts, setContacts] = useState<BillingContact[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const effectiveOrganizationId =
    arrangement === 'direct' ? clientOrganizationId || '' : billingOrganizationId;

  useEffect(() => {
    setArrangement(initialArrangement || 'direct');
    setBillingOrganizationId(initialBillingOrganizationId || '');
  }, [initialArrangement, initialBillingOrganizationId]);

  useEffect(() => {
    let active = true;

    (async () => {
      setLoading(true);
      const [organizationsResult, selectedContactsResult] = await Promise.all([
        supabase.from('organizations').select('id,name,alias').order('name'),
        supabase
          .from('event_billing_contacts')
          .select('contact_id')
          .eq('event_id', eventId),
      ]);

      if (!active) return;
      if (organizationsResult.data) {
        setOrganizations(organizationsResult.data as OrganizationOption[]);
      }
      if (selectedContactsResult.data) {
        setSelectedContactIds(selectedContactsResult.data.map((row) => row.contact_id));
      }
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [eventId]);

  useEffect(() => {
    let active = true;

    (async () => {
      if (!effectiveOrganizationId) {
        setContacts([]);
        return;
      }

      setContactsLoading(true);
      const { data, error } = await supabase
        .from('contact_organizations')
        .select(
          `
            contact_id,
            position,
            is_primary,
            contact:contacts(id,full_name,first_name,last_name,email,phone,mobile)
          `,
        )
        .eq('organization_id', effectiveOrganizationId)
        .eq('is_current', true)
        .order('is_primary', { ascending: false });

      if (!active) return;
      if (error) {
        console.error('Error loading billing contacts:', error);
        setContacts([]);
      } else {
        setContacts(
          (data || [])
            .map((relation: any) => {
              const contact = relation.contact;
              if (!contact) return null;
              return {
                id: contact.id,
                fullName:
                  contact.full_name ||
                  `${contact.first_name || ''} ${contact.last_name || ''}`.trim() ||
                  'Kontakt bez nazwy',
                email: contact.email || null,
                phone: contact.mobile || contact.phone || null,
                position: relation.position || null,
              } satisfies BillingContact;
            })
            .filter(Boolean) as BillingContact[],
        );
      }
      setContactsLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [effectiveOrganizationId]);

  useEffect(() => {
    const availableIds = new Set(contacts.map((contact) => contact.id));
    setSelectedContactIds((current) => current.filter((id) => availableIds.has(id)));
  }, [contacts]);

  const selectedOrganization = useMemo(
    () => organizations.find((organization) => organization.id === effectiveOrganizationId),
    [effectiveOrganizationId, organizations],
  );

  const toggleContact = (contactId: string) => {
    setSelectedContactIds((current) =>
      current.includes(contactId)
        ? current.filter((id) => id !== contactId)
        : [...current, contactId],
    );
  };

  const handleSave = async () => {
    if (arrangement !== 'direct' && !billingOrganizationId) {
      showSnackbar('Wybierz organizację, która będzie rozliczać wydarzenie', 'error');
      return;
    }

    setSaving(true);
    try {
      const storedBillingOrganizationId =
        arrangement === 'direct' ? null : billingOrganizationId;

      const { error: eventError } = await supabase
        .from('events')
        .update({
          billing_arrangement: arrangement,
          billing_organization_id: storedBillingOrganizationId,
        })
        .eq('id', eventId);
      if (eventError) throw eventError;

      const { error: deleteError } = await supabase
        .from('event_billing_contacts')
        .delete()
        .eq('event_id', eventId);
      if (deleteError) throw deleteError;

      if (arrangement !== 'direct' && selectedContactIds.length > 0) {
        const { error: contactsError } = await supabase.from('event_billing_contacts').insert(
          selectedContactIds.map((contactId, index) => ({
            event_id: eventId,
            organization_id: billingOrganizationId,
            contact_id: contactId,
            is_primary: index === 0,
          })),
        );
        if (contactsError) throw contactsError;
      }

      await onSaved?.({
        billing_arrangement: arrangement,
        billing_organization_id: storedBillingOrganizationId,
      });
      showSnackbar('Sposób rozliczenia wydarzenia został zapisany', 'success');
    } catch (error: any) {
      console.error('Error saving event billing context:', error);
      showSnackbar(error?.message || 'Nie udało się zapisać rozliczenia wydarzenia', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-[#d3bb73]/10 p-2">
            <ReceiptText className="h-5 w-5 text-[#d3bb73]" />
          </div>
          <div>
            <h2 className="text-lg font-light text-[#e5e4e2]">Rozliczenie wydarzenia</h2>
            <p className="mt-1 text-sm text-[#e5e4e2]/50">
              Określ nabywcę faktur i osoby odpowiedzialne za rozliczenie.
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-[#d3bb73]" />
        </div>
      ) : (
        <div className="space-y-5">
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Sposób rozliczenia</label>
            <select
              value={arrangement}
              disabled={!canEdit || saving}
              onChange={(event) => {
                const value = event.target.value as BillingArrangement;
                setArrangement(value);
                if (value === 'direct') setBillingOrganizationId('');
              }}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:opacity-60"
            >
              {(Object.keys(arrangementLabels) as BillingArrangement[]).map((value) => (
                <option key={value} value={value}>
                  {arrangementLabels[value]}
                </option>
              ))}
            </select>
          </div>

          {arrangement === 'direct' ? (
            <div className="flex items-center gap-3 rounded-lg border border-emerald-400/15 bg-emerald-400/5 p-4">
              <Building2 className="h-5 w-5 text-emerald-300" />
              <div>
                <p className="text-xs uppercase tracking-wide text-emerald-200/60">Nabywca faktury</p>
                <p className="mt-1 text-sm text-[#e5e4e2]">
                  {clientOrganizationName || 'Klient przypisany do wydarzenia'}
                </p>
              </div>
            </div>
          ) : (
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                Organizacja będąca nabywcą faktur
              </label>
              <select
                value={billingOrganizationId}
                disabled={!canEdit || saving}
                onChange={(event) => {
                  setBillingOrganizationId(event.target.value);
                  setSelectedContactIds([]);
                }}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:opacity-60"
              >
                <option value="">Wybierz hotel lub inną organizację...</option>
                {organizations
                  .filter((organization) => organization.id !== clientOrganizationId)
                  .map((organization) => (
                    <option key={organization.id} value={organization.id}>
                      {organization.alias || organization.name}
                    </option>
                  ))}
              </select>
            </div>
          )}

          {arrangement !== 'direct' && effectiveOrganizationId && (
            <div>
              <div className="mb-3 flex items-center gap-2">
                <Users className="h-4 w-4 text-[#d3bb73]" />
                <p className="text-sm font-medium text-[#e5e4e2]">
                  Opiekunowie rozliczenia po stronie {selectedOrganization?.alias || selectedOrganization?.name || 'organizacji'}
                </p>
              </div>

              {contactsLoading ? (
                <div className="flex items-center gap-2 py-4 text-sm text-[#e5e4e2]/50">
                  <Loader2 className="h-4 w-4 animate-spin" /> Ładowanie kontaktów...
                </div>
              ) : contacts.length > 0 ? (
                <div className="grid gap-2 md:grid-cols-2">
                  {contacts.map((contact) => {
                    const selected = selectedContactIds.includes(contact.id);
                    return (
                      <button
                        key={contact.id}
                        type="button"
                        disabled={!canEdit || saving}
                        onClick={() => toggleContact(contact.id)}
                        className={`rounded-lg border p-3 text-left transition-colors disabled:opacity-60 ${
                          selected
                            ? 'border-[#d3bb73]/60 bg-[#d3bb73]/10'
                            : 'border-[#d3bb73]/10 bg-[#0a0d1a] hover:border-[#d3bb73]/30'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                              selected
                                ? 'border-[#d3bb73] bg-[#d3bb73] text-[#1c1f33]'
                                : 'border-[#e5e4e2]/30'
                            }`}
                          >
                            {selected ? '✓' : ''}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm text-[#e5e4e2]">{contact.fullName}</p>
                            {contact.position && (
                              <p className="truncate text-xs text-[#e5e4e2]/45">{contact.position}</p>
                            )}
                            <p className="mt-1 truncate text-xs text-[#d3bb73]/80">
                              {contact.email || contact.phone || 'Brak danych kontaktowych'}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-amber-400/15 bg-amber-400/5 p-4 text-sm text-amber-100/70">
                  Ta organizacja nie ma jeszcze osób kontaktowych. Dodaj je w kartotece organizacji,
                  aby system mógł podpowiadać odbiorców faktur.
                </div>
              )}
            </div>
          )}

          {canEdit && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Zapisz rozliczenie
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
