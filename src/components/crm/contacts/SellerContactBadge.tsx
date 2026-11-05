'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BadgePercent, Building2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';

const emptyIds = new Set<string>();
const emptyStatuses = new Map<string, string>();

type BadgeResult = { key: string; ids: Set<string>; statuses: Map<string, string>; organizationIds: Set<string> };
const emptyResult: BadgeResult = { key: '', ids: emptyIds, statuses: emptyStatuses, organizationIds: emptyIds };

/** Read only the seller flag/status for listed people (and hotels employing them), under the current session's RLS.
 * Never fetch the seller directory, offers or commission data for a badge. */
export function useSellerContactBadges(contacts: { id: string; source: string }[]) {
  const key = JSON.stringify([...new Set(contacts.filter(contact => contact.source === 'contacts').map(contact => contact.id))].sort());
  const [result, setResult] = useState<BadgeResult>(emptyResult);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const refresh = useCallback(() => { generation.current++; setRevision(value => value + 1); }, []);

  useEffect(() => {
    const request = ++generation.current;
    const controller = new AbortController();
    setError('');
    const load = async () => {
      const ids = JSON.parse(key) as string[];
      const sellerIds = new Set<string>();
      const statuses = new Map<string, string>();
      const organizationIds = new Set<string>();
      try {
        // Bound URL length and avoid one request per contact or a truncated global list.
        for (let offset = 0; offset < ids.length; offset += 100) {
          const { data, error } = await supabase.from('sales_partner_profiles')
            .select('contact_id,status,organization_id').in('contact_id', ids.slice(offset, offset + 100))
            .abortSignal(controller.signal);
          if (request !== generation.current) return;
          if (error) throw error;
          for (const profile of data || []) {
            if (!profile.contact_id) continue;
            sellerIds.add(profile.contact_id);
            statuses.set(profile.contact_id, profile.status || 'active');
            if (profile.organization_id) organizationIds.add(profile.organization_id);
          }
        }
        // Hotele / agencje, w których sprzedawca jest obecnie zatrudniony (contact_organizations.is_current).
        const sellerList = [...sellerIds];
        for (let offset = 0; offset < sellerList.length; offset += 100) {
          const { data, error } = await supabase.from('contact_organizations')
            .select('organization_id').in('contact_id', sellerList.slice(offset, offset + 100)).eq('is_current', true)
            .abortSignal(controller.signal);
          if (request !== generation.current) return;
          if (error) throw error;
          for (const link of data || []) if (link.organization_id) organizationIds.add(link.organization_id);
        }
        if (request === generation.current) setResult({ key, ids: sellerIds, statuses, organizationIds });
      } catch {
        if (request !== generation.current || controller.signal.aborted) return;
        setResult({ ...emptyResult, key });
        setError('Nie udało się odczytać oznaczeń sprzedawców. Lista kontaktów pozostaje dostępna.');
      }
    };
    void load();
    return () => { generation.current++; controller.abort(); };
  }, [key, revision]);

  useEffect(() => {
    window.addEventListener('focus', refresh);
    window.addEventListener('seller-workspace-changed', refresh);
    const { data } = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        setResult(emptyResult);
        refresh();
      }
    });
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('seller-workspace-changed', refresh);
      data.subscription.unsubscribe();
    };
  }, [refresh]);

  const current = result.key === key;
  return {
    ids: current ? result.ids : emptyIds,
    statuses: current ? result.statuses : emptyStatuses,
    organizationIds: current ? result.organizationIds : emptyIds,
    error,
    refresh,
  };
}

const badgeTones: Record<string, { className: string; label: string; title: string }> = {
  active: { className: 'bg-[#d3bb73]/10 text-[#d3bb73]', label: 'Sprzedawca', title: 'Aktywny sprzedawca zewnętrzny' },
  onboarding: { className: 'bg-amber-400/10 text-amber-200', label: 'Sprzedawca — do uzgodnienia', title: 'Profil sprzedawcy w trakcie uzgadniania warunków' },
  inactive: { className: 'bg-white/[0.06] text-white/45', label: 'Sprzedawca nieaktywny', title: 'Profil sprzedawcy jest nieaktywny' },
};

export default function SellerContactBadge({ status = 'active' }: { status?: string | null }) {
  const tone = badgeTones[status || 'active'] || badgeTones.active;
  return <span title={tone.title} className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${tone.className}`}>
    <BadgePercent aria-hidden="true" className="h-3.5 w-3.5" />{tone.label}
  </span>;
}

/** Organizacja (hotel / agencja) zatrudniająca sprzedawców. */
export function SellerOrganizationBadge() {
  return <span title="W tej organizacji pracują sprzedawcy z dostępem do portalu" className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#d3bb73]/10 px-2 py-1 text-xs font-medium text-[#d3bb73]">
    <Building2 aria-hidden="true" className="h-3.5 w-3.5" />Sprzedawcy
  </span>;
}
