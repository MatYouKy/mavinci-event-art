'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BadgePercent, Loader2, Presentation, UserPlus, UserRound } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { SellerStatusPill, errorText } from './sellerUi';

type SellerRow = { profileId: string; contactId: string; name: string; email: string | null; status: string; portalEnabled: boolean; position: string | null };
type PersonRow = { contactId: string; name: string; email: string | null; position: string | null };

type Props = {
  organizationId: string;
  organizationName: string;
  /** Hotel: panel widoczny także bez sprzedawców (zachęta do pokazu portalu). */
  isHotel: boolean;
  canManage: boolean;
};

/** Sprzedawcy hotelu / agencji: kontakty z profilem sprzedawcy obecnie zatrudnione w organizacji (contact_organizations.is_current). */
export default function OrganizationSellersPanel({ organizationId, organizationName, isHotel, canManage }: Props) {
  const [sellers, setSellers] = useState<SellerRow[]>([]);
  const [others, setOthers] = useState<PersonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const links = await supabase.from('contact_organizations').select('contact_id,position').eq('organization_id', organizationId).eq('is_current', true);
      if (links.error) throw links.error;
      const positions = new Map((links.data || []).filter(link => link.contact_id).map(link => [link.contact_id as string, (link as { position?: string | null }).position || null]));
      const ids = [...positions.keys()];
      if (!ids.length) { setSellers([]); setOthers([]); return; }
      const [profiles, people] = await Promise.all([
        supabase.from('sales_partner_profiles').select('id,contact_id,status,portal_enabled').in('contact_id', ids),
        supabase.from('contacts').select('id,full_name,first_name,last_name,email,position').in('id', ids),
      ]);
      if (profiles.error) throw profiles.error;
      if (people.error) throw people.error;
      const byContact = new Map((profiles.data || []).filter(profile => profile.contact_id).map(profile => [profile.contact_id as string, profile]));
      const nameOf = (person: { full_name?: string | null; first_name?: string | null; last_name?: string | null }) =>
        person.full_name || `${person.first_name || ''} ${person.last_name || ''}`.trim() || 'Bez nazwy';
      const nextSellers: SellerRow[] = [];
      const nextOthers: PersonRow[] = [];
      for (const person of people.data || []) {
        const profile = byContact.get(person.id);
        const position = positions.get(person.id) || person.position || null;
        if (profile) nextSellers.push({ profileId: profile.id, contactId: person.id, name: nameOf(person), email: person.email || null, status: profile.status || 'active', portalEnabled: profile.portal_enabled === true, position });
        else nextOthers.push({ contactId: person.id, name: nameOf(person), email: person.email || null, position });
      }
      const order = { active: 0, onboarding: 1, inactive: 2 } as Record<string, number>;
      setSellers(nextSellers.sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || a.name.localeCompare(b.name, 'pl')));
      setOthers(nextOthers.sort((a, b) => a.name.localeCompare(b.name, 'pl')));
    } catch (failure) {
      setError(errorText(failure, 'Nie udało się wczytać sprzedawców organizacji.'));
    } finally { setLoading(false); }
  }, [organizationId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener('seller-workspace-changed', refresh);
    return () => window.removeEventListener('seller-workspace-changed', refresh);
  }, [load]);

  if (!loading && !error && sellers.length === 0 && !isHotel) return null;
  const demoHref = `/crm/salespeople/demo?organization=${organizationId}&hotel=${encodeURIComponent(organizationName)}`;

  return <section aria-labelledby="organization-sellers-heading" className="rounded-2xl bg-[#1c1f33] p-5 text-[#e5e4e2]">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="organization-sellers-heading" className="flex items-center gap-2 text-lg font-medium"><BadgePercent className="h-5 w-5 text-[#d3bb73]" />Sprzedawcy w tej organizacji</h2>
        <p className="mt-1 text-xs text-white/45">Osoby obecnie zatrudnione w {organizationName}, które sprzedają usługi przez portal.</p>
      </div>
      <Link href={demoHref} className="inline-flex items-center gap-2 rounded-lg bg-white/[0.05] px-3 py-2 text-sm text-[#e5e4e2]/80 hover:bg-white/[0.09]"><Presentation className="h-4 w-4 text-[#d3bb73]" />Pokaż portal hotelowi</Link>
    </div>
    {loading ? <p className="mt-4 flex items-center gap-2 text-sm text-white/45"><Loader2 className="h-4 w-4 animate-spin" />Wczytywanie…</p>
      : error ? <div role="alert" className="mt-4 rounded-xl bg-amber-300/[0.07] p-4 text-sm text-amber-100/85">{error}<button type="button" onClick={() => void load()} className="ml-3 text-[#d3bb73]">Spróbuj ponownie</button></div>
      : <>
        {sellers.length === 0 ? <p className="mt-4 rounded-xl bg-[#0f1119]/60 p-4 text-sm text-white/50">W tej organizacji nie pracuje jeszcze żaden sprzedawca. Pokaż portal osobie decyzyjnej i mianuj ją sprzedawcą z listy poniżej.</p> : (
          <ul className="mt-4 grid gap-2 md:grid-cols-2">
            {sellers.map(seller => <li key={seller.profileId}><Link href={`/crm/contacts/${seller.contactId}?tab=seller`} className="group flex items-center gap-3 rounded-xl bg-[#0f1119]/60 p-3 hover:bg-[#0f1119]">
              <span className="rounded-full bg-[#d3bb73]/10 p-2"><UserRound className="h-4 w-4 text-[#d3bb73]" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm group-hover:text-[#d3bb73]">{seller.name}</span>
                <span className="block truncate text-xs text-white/45">{[seller.position, seller.email].filter(Boolean).join(' · ') || 'Karta sprzedawcy'}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <SellerStatusPill status={seller.status} />
                <span className="text-[10px] text-white/35">{seller.portalEnabled ? 'Portal włączony' : 'Portal wyłączony'}</span>
              </span>
            </Link></li>)}
          </ul>
        )}
        {canManage && others.length > 0 && <div className="mt-5">
          <h3 className="text-xs uppercase tracking-wide text-white/35">Pozostałe osoby z organizacji</h3>
          <ul className="mt-2 space-y-1.5">
            {others.slice(0, 8).map(person => <li key={person.contactId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#0f1119]/40 px-3 py-2">
              <Link href={`/crm/contacts/${person.contactId}`} className="min-w-0 text-sm hover:text-[#d3bb73]">{person.name}<span className="ml-2 text-xs text-white/40">{person.position || ''}</span></Link>
              <Link href={`/crm/salespeople?new=1&contactId=${person.contactId}`} className="inline-flex items-center gap-1.5 rounded-lg bg-[#d3bb73]/10 px-2.5 py-1 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/15"><UserPlus className="h-3.5 w-3.5" />Mianuj sprzedawcą</Link>
            </li>)}
          </ul>
          {others.length > 8 && <p className="mt-2 text-xs text-white/35">…oraz {others.length - 8} innych osób w zakładce Kontakty.</p>}
        </div>}
      </>}
  </section>;
}
