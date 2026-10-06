'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Building2, ExternalLink } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';

type LinkedOrganization = {
  id: string;
  name: string;
  alias: string | null;
};

export default function ContactOrganizationLinks({ contactId }: { contactId: string }) {
  const [organizations, setOrganizations] = useState<LinkedOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    setOrganizations([]);

    const load = async () => {
      try {
        const { data, error: failed } = await supabase
          .from('contact_organizations')
          .select('organization:organizations(id, name, alias)')
          .eq('contact_id', contactId)
          .eq('is_current', true);

        if (failed) throw failed;
        if (!active) return;

        const unique = new Map<string, LinkedOrganization>();
        for (const relation of data || []) {
          const organization = (
            Array.isArray(relation.organization) ? relation.organization[0] : relation.organization
          ) as LinkedOrganization | null;
          if (organization) unique.set(organization.id, organization);
        }
        setOrganizations(Array.from(unique.values()).sort((a, b) =>
          (a.alias || a.name).localeCompare(b.alias || b.name, 'pl'),
        ));
      } catch {
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => { active = false; };
  }, [contactId]);

  if (loading) return <p className="mt-3 text-sm text-white/45">Wczytywanie organizacji…</p>;
  if (error) return <p role="alert" className="mt-3 text-sm text-amber-200/80">Nie udało się wczytać powiązanych organizacji.</p>;
  if (!organizations.length) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Powiązane organizacje">
      <span className="text-sm text-white/50">{organizations.length === 1 ? 'Organizacja:' : 'Organizacje:'}</span>
      {organizations.map((organization) => (
        <Link
          key={organization.id}
          href={`/crm/contacts/${organization.id}`}
          title={`Otwórz organizację: ${organization.name}`}
          className="inline-flex max-w-full items-center gap-2 rounded-lg bg-white/5 px-3 py-1.5 text-sm text-[#d3bb73] transition-colors hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-offset-2"
        >
          <Building2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="break-words">{organization.alias || organization.name}</span>
          <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />
        </Link>
      ))}
    </div>
  );
}
