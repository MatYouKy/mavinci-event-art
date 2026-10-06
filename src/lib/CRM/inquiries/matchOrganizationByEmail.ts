import { supabase } from '@/lib/supabase/browser';

export type InquiryOrganization = {
  id: string;
  name: string;
  alias: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
};

// Shared mailbox providers do not identify a company.
const publicDomains = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk',
  'live.com', 'live.co.uk', 'msn.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.pl',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com',
  'pm.me', 'tuta.com', 'tutanota.com', 'gmx.com', 'gmx.de', 'mail.com',
  'wp.pl', 'o2.pl', 'tlen.pl', 'go2.pl', 'onet.pl', 'op.pl', 'vp.pl',
  'poczta.onet.pl', 'onet.eu', 'interia.pl', 'interia.eu', 'poczta.fm',
  'int.pl', 'gazeta.pl', 'buziaczek.pl', 'spoko.pl', 'amorki.pl',
  'autograf.pl', 'opoczta.pl', 'poczta.pl', 'home.pl', 'neostrada.pl',
]);

function normalizeHost(value: string): string | null {
  try {
    const host = new URL(`https://${value.toLowerCase().replace(/\.$/, '')}`).hostname;
    if (!host.includes('.') || !/^[a-z0-9.-]+$/.test(host)) return null;
    return host;
  } catch { return null; }
}

function emailDomain(value: string | null | undefined): string | null {
  const text = (value || '').trim();
  const address = text.match(/<([^<>]+)>$/)?.[1] || text;
  const match = address.match(/^[^\s@<>;,]+@([^\s@<>;,/:?#]+)$/);
  return match ? normalizeHost(match[1]) : null;
}

function websiteDomain(value: string | null): string | null {
  if (!value?.trim()) return null;
  try {
    const text = value.trim();
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text.replace(/^\/\//, '')}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    // Only www is treated as an alias; unrelated subdomains are not collapsed.
    return normalizeHost(url.hostname.replace(/^www\./i, ''));
  } catch { return null; }
}

export async function matchOrganizationByEmail(email: string): Promise<{
  organization: InquiryOrganization | null;
  ambiguous: boolean;
}> {
  const domain = emailDomain(email);
  if (!domain || publicDomains.has(domain)) return { organization: null, ambiguous: false };
  const matches: InquiryOrganization[] = [];
  // Paginate so a second match beyond Supabase's default row limit is not missed.
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('organizations')
      .select('id,name,alias,email,phone,website').order('id').range(offset, offset + 499);
    if (error) throw new Error('Nie udało się sprawdzić organizacji klienta. Spróbuj ponownie.');
    for (const organization of data || []) {
      if (emailDomain(organization.email) === domain || websiteDomain(organization.website) === domain) {
        matches.push(organization);
        if (matches.length > 1) return { organization: null, ambiguous: true };
      }
    }
    if (!data || data.length < 500) break;
  }
  return { organization: matches[0] || null, ambiguous: false };
}
