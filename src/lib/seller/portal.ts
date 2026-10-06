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
  default_commission_rate: number;
  default_payment_method: string | null;
  branding?: SellerBranding | null;
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
};

export function useSellerPortalContext() {
  const [context, setContext] = useState<SellerPortalContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const { data, error: contextError } = await supabase.rpc('get_seller_portal_context');
    if (contextError) {
      setContext(null);
      setError(contextError.message);
    } else {
      setContext((data as SellerPortalContext | null) || null);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { context, loading, error, reload };
}

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
