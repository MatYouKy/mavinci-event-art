'use client';

import { useEffect } from 'react';
import { offerWizardApi } from '@/app/crm/offers/api/OfferWizzardApi';

export function usePrefetchOffer(offerId?: string) {
  const prefetch = offerWizardApi.usePrefetch('getOfferById');

  useEffect(() => {
    if (!offerId) return;
    // force=false -> jeśli jest w cache i świeże, nie dociągnie drugi raz
    prefetch({ offerId }, { force: false });
  }, [offerId, prefetch]);
}