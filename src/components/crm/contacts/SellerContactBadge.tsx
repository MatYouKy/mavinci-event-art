'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BadgePercent } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';

const emptyIds = new Set<string>();

/** Read only the seller flag for listed people, under the current session's RLS.
 * Never fetch the seller directory, offers or commission data for a badge. */
export function useSellerContactBadges(contacts: { id: string; source: string }[]) {
  const key = JSON.stringify([...new Set(contacts.filter(contact => contact.source === 'contacts').map(contact => contact.id))].sort());
  const [result, setResult] = useState<{ key: string; ids: Set<string> }>({ key: '', ids: emptyIds });
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
      try {
        // Bound URL length and avoid one request per contact or a truncated global list.
        for (let offset = 0; offset < ids.length; offset += 100) {
          const { data, error } = await supabase.from('sales_partner_profiles')
            .select('contact_id').in('contact_id', ids.slice(offset, offset + 100))
            .abortSignal(controller.signal);
          if (request !== generation.current) return;
          if (error) throw error;
          for (const profile of data || []) if (profile.contact_id) sellerIds.add(profile.contact_id);
        }
        if (request === generation.current) setResult({ key, ids: sellerIds });
      } catch {
        if (request !== generation.current || controller.signal.aborted) return;
        setResult({ key, ids: emptyIds });
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
        setResult({ key: '', ids: emptyIds });
        refresh();
      }
    });
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('seller-workspace-changed', refresh);
      data.subscription.unsubscribe();
    };
  }, [refresh]);

  return { ids: result.key === key ? result.ids : emptyIds, error, refresh };
}

export default function SellerContactBadge() {
  return <span title="Kontakt z profilem sprzedawcy" className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#d3bb73]/10 px-2 py-1 text-xs font-medium text-[#d3bb73]">
    <BadgePercent aria-hidden="true" className="h-3.5 w-3.5" />Sprzedawca
  </span>;
}
