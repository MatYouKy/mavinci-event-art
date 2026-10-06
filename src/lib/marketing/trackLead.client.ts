'use client';

/** Report only a successfully saved inquiry, without contact details or message content. */
export function trackMarketingLead(formName: string, submissionId: string | null) {
  if (typeof window === 'undefined' || !submissionId) return;
  try {
    const analytics = window as unknown as {
      gtag?: (...args: unknown[]) => void;
    };
    analytics.gtag?.('event', 'generate_lead', {
      send_to: 'G-BHPZ5NSLQM',
      form_name: formName,
      event_id: submissionId,
    });
  } catch {
    // Analytics must never turn a saved inquiry into an apparent form failure.
  }
}
