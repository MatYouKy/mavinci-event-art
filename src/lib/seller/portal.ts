'use client';

import { systemLabel } from '@/lib/ui/systemLabels';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';

export type SellerBranding = {
  identity_version?: number;
  branding_source?: 'organization' | 'seller';
  organization_id?: string | null;
  organization_name?: string | null;
  organization_branding_configured?: boolean;
  portrait_source?: 'contact' | 'seller';
  default_commercial_model?: 'markup' | 'commission';
  id?: string | null;
  display_name?: string | null;
  position_title?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  portrait_url?: string | null;
  hotel_logo_url?: string | null;
  hotel_cover_image_url?: string | null;
  brandbook_url?: string | null;
  venue_image_urls?: string[] | null;
  brand_primary_color?: string | null;
  brand_secondary_color?: string | null;
  brand_surface_color?: string | null;
  heading_font_family?: string | null;
  heading_font_path?: string | null;
  heading_font_catalog_id?: string | null;
  heading_font_uploads?: { family: string; path: string }[] | null;
  brandbook_notes?: string | null;
  footer_text?: string | null;
  disclosure_text?: string | null;
};

export type SellerPortalBrand = {
  my_company_id: string;
  name: string;
  legal_name: string;
  logo_url?: string | null;
  commission_enabled: boolean;
  /** Null when commissions are hidden for this brand (see commissions_visible). */
  default_commission_rate: number | null;
  default_payment_method: string | null;
  /** Per seller × brand. When false the portal hides every commission figure for the brand. */
  commissions_visible?: boolean;
  branding?: SellerBranding | null;
};

export type SellerPortalManager = {
  name: string;
  email?: string | null;
  phone?: string | null;
  photo_url?: string | null;
  position?: string | null;
};

export type SellerPortalContext = {
  organizations: { id: string; name: string; business_type: string }[];
  default_offer_organization_id: string | null;
  profile: {
    id: string;
    partner_type: string;
    organization_id: string | null;
    person: {
      name: string;
      email?: string | null;
      phone?: string | null;
      photo_url?: string | null;
      position?: string | null;
    };
    organization: {
      id: string;
      name: string;
      alias?: string | null;
      email?: string | null;
      phone?: string | null;
      website?: string | null;
      address?: string | null;
      city?: string | null;
    };
  };
  brands: SellerPortalBrand[];
  /** Opiekun sprzedawcy; null until a manager is assigned in CRM. */
  manager?: SellerPortalManager | null;
};

type ContextResult = { data: SellerPortalContext | null; error: string | null };
// The layout, the page and nested panels mount together. Share one request
// that is in flight instead of calling the RPC several times per navigation.
let inflightContext: Promise<ContextResult> | null = null;
const fetchSellerPortalContext = () => {
  if (!inflightContext) {
    inflightContext = (async (): Promise<ContextResult> => {
      try {
        const { data, error } = await supabase.rpc('get_seller_portal_context');
        if (error) return { data: null, error: error.message || 'Nie udało się wczytać danych portalu.' };
        return { data: (data as SellerPortalContext | null) || null, error: null };
      } catch {
        return { data: null, error: 'Nie udało się połączyć z portalem. Sprawdź połączenie i spróbuj ponownie.' };
      }
    })().finally(() => { window.setTimeout(() => { inflightContext = null; }, 0); });
  }
  return inflightContext;
};

/** @param enabled false in shared components rendered inside the CRM (no seller session). */
export function useSellerPortalContext(enabled = true) {
  const [context, setContext] = useState<SellerPortalContext | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const result = await fetchSellerPortalContext();
    setContext(result.data);
    setError(result.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void reload();
  }, [enabled, reload]);

  return { context, loading, error, reload };
}

/** Commission figures for a brand are shown only after MAVINCI reveals them. */
export const sellerCommissionsVisible = (context: SellerPortalContext | null | undefined, brandId: string | null | undefined) =>
  Boolean(brandId && context?.brands.some((brand) => brand.my_company_id === brandId
    && brand.commission_enabled === true && brand.commissions_visible === true));

/** Navigation and summaries: true when at least one active brand shows commissions. */
export const sellerAnyCommissionsVisible = (context: SellerPortalContext | null | undefined) =>
  Boolean(context?.brands.some((brand) => brand.commissions_visible === true));

export const sellerPhoneHref = (phone: string | null | undefined) => {
  const digits = (phone || '').replace(/[^+\d]/g, '');
  return digits.length >= 6 ? `tel:${digits}` : null;
};

/** wa.me requires the international number without "+" (Polish numbers get 48). */
export const sellerWhatsAppHref = (phone: string | null | undefined) => {
  let digits = (phone || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 9) digits = `48${digits}`;
  return digits.length >= 10 && digits.length <= 15 ? `https://wa.me/${digits}` : null;
};

export const sellerMoney = (amount: number | null | undefined) =>
  new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: 'PLN',
    minimumFractionDigits: 2,
  }).format(Number(amount || 0));

export const sellerStatusLabel = (status: string) => ({
  draft: 'Szkic',
  sent: 'Wysłana',
  viewed: 'Wyświetlona',
  accepted: 'Zaakceptowana',
  rejected: 'Odrzucona',
  expired: 'Wygasła',
}[status] || systemLabel(status));
