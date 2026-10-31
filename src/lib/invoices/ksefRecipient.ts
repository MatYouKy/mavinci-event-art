import type { FA3Recipient } from '@/lib/ksef/generateFA3XML';

export interface InvoiceKsefRecipientSnapshot {
  version: 1;
  recipient: (FA3Recipient & { organizationId: string | null }) | null;
}

const invalidSnapshot = () => new Error(
  'Zapisane dane odbiorcy faktury są niekompletne lub mają nieobsługiwaną wersję. Sprawdź odbiorcę przed wysłaniem do KSeF.',
);

/** Read the invoice snapshot only. Historical documents must not follow contact edits. */
export function readInvoiceKsefRecipientSnapshot(value: unknown): InvoiceKsefRecipientSnapshot | null {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw invalidSnapshot();
  const snapshot = value as Record<string, unknown>;
  if (snapshot.version !== 1 || !Object.prototype.hasOwnProperty.call(snapshot, 'recipient')) {
    throw invalidSnapshot();
  }
  if (snapshot.recipient === null) return { version: 1, recipient: null };
  if (typeof snapshot.recipient !== 'object' || !snapshot.recipient || Array.isArray(snapshot.recipient)) {
    throw invalidSnapshot();
  }
  const recipient = snapshot.recipient as Record<string, unknown>;
  if (recipient.role !== 2 || (recipient.organizationId !== null &&
      (typeof recipient.organizationId !== 'string' ||
       !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recipient.organizationId)))) {
    throw invalidSnapshot();
  }
  for (const key of ['name', 'street', 'postalCode', 'city', 'countryCode']) {
    if (typeof recipient[key] !== 'string') throw invalidSnapshot();
  }
  for (const key of ['nip', 'internalId']) {
    if (recipient[key] != null && typeof recipient[key] !== 'string') throw invalidSnapshot();
  }
  return {
    version: 1,
    recipient: {
      organizationId: recipient.organizationId as string | null,
      name: recipient.name as string,
      street: recipient.street as string,
      postalCode: recipient.postalCode as string,
      city: recipient.city as string,
      countryCode: recipient.countryCode as string,
      nip: typeof recipient.nip === 'string' ? recipient.nip : undefined,
      internalId: typeof recipient.internalId === 'string' ? recipient.internalId : undefined,
      role: 2,
    },
  };
}

export function getInvoiceKsefRecipient(invoice: { ksef_recipient_snapshot?: unknown }): FA3Recipient | undefined {
  return readInvoiceKsefRecipientSnapshot(invoice.ksef_recipient_snapshot)?.recipient ?? undefined;
}

export type InvoiceRecipientMode = 'same_as_buyer' | 'organization' | 'manual';
export type InvoiceRecipientFields = {
  name: string;
  nip: string;
  internalId: string;
  street: string;
  postalCode: string;
  city: string;
  countryCode: string;
  role: 2;
};
export type InvoiceRecipientDraft = {
  mode: InvoiceRecipientMode;
  organizationId: string;
  data: InvoiceRecipientFields;
};

export function createEmptyInvoiceRecipientDraft(): InvoiceRecipientDraft {
  return {
    mode: 'same_as_buyer', organizationId: '',
    data: { name: '', nip: '', internalId: '', street: '', postalCode: '', city: '', countryCode: 'PL', role: 2 },
  };
}

function recipientFields(value: unknown): InvoiceRecipientFields {
  const data = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const text = (key: string) => typeof data[key] === 'string' ? (data[key] as string).trim() : '';
  const country = text('countryCode').toUpperCase();
  return {
    name: text('name'), nip: text('nip'), internalId: text('internalId'), street: text('street'),
    postalCode: text('postalCode'), city: text('city'),
    countryCode: ['POLSKA', 'POLAND'].includes(country) ? 'PL' : country,
    role: 2,
  };
}

/** Carry forward the saved document, never silently refresh its parties from the event/contact. */
export function recipientDraftFromInvoice(invoice: {
  invoice_recipient_mode?: string | null;
  invoice_recipient_data?: unknown;
  ksef_recipient_snapshot?: unknown;
  service_recipient_organization_id?: string | null;
  organization_id?: string | null;
}): InvoiceRecipientDraft {
  const snapshot = readInvoiceKsefRecipientSnapshot(invoice.ksef_recipient_snapshot);
  const mode = invoice.invoice_recipient_mode;
  if (mode === 'same_as_buyer') return createEmptyInvoiceRecipientDraft();
  if (mode != null && mode !== 'organization' && mode !== 'manual') throw invalidSnapshot();
  if (mode === 'organization' || mode === 'manual') {
    return {
      mode,
      organizationId: mode === 'organization'
        ? snapshot?.recipient?.organizationId || invoice.service_recipient_organization_id || '' : '',
      data: recipientFields(snapshot?.recipient ?? invoice.invoice_recipient_data),
    };
  }
  if (snapshot) {
    if (!snapshot.recipient) return createEmptyInvoiceRecipientDraft();
    return {
      mode: snapshot.recipient.organizationId ? 'organization' : 'manual',
      organizationId: snapshot.recipient.organizationId || '',
      data: recipientFields(snapshot.recipient),
    };
  }
  if (invoice.service_recipient_organization_id) {
    // A legacy document without a snapshot needs an explicit review, not a guessed live recipient.
    return {
      ...createEmptyInvoiceRecipientDraft(), mode: 'organization',
      organizationId: invoice.service_recipient_organization_id,
    };
  }
  return createEmptyInvoiceRecipientDraft();
}

export function validateInvoiceRecipientDraft(draft: InvoiceRecipientDraft): string[] {
  if (draft.mode === 'same_as_buyer') return [];
  if (!['organization', 'manual'].includes(draft.mode)) return ['Wybierz sposób określenia odbiorcy faktury.'];
  const errors: string[] = [];
  if (draft.mode === 'organization' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(draft.organizationId)) {
    errors.push('Wybierz organizację odbiorcy lub wpisz jego dane ręcznie.');
  }
  const data = recipientFields(draft.data);
  for (const [key, label] of [
    ['name', 'nazwę'], ['street', 'adres'], ['postalCode', 'kod pocztowy'], ['city', 'miejscowość'],
  ] as const) {
    if (!data[key]) errors.push(`Uzupełnij ${label} odbiorcy.`);
    else if (Array.from(data[key]).length > 512) errors.push(`Pole odbiorcy „${label}” może mieć najwyżej 512 znaków.`);
  }
  if (!/^[A-Z]{2}$/.test(data.countryCode)) errors.push('Podaj dwuliterowy kod kraju odbiorcy, np. PL.');
  const nip = data.nip.replace(/^PL/i, '').replace(/[\s-]/g, '');
  const validNip = (value: string) => /^[0-9]{10}$/.test(value) &&
    [6, 5, 7, 2, 3, 4, 5, 6, 7].reduce((sum, weight, index) => sum + Number(value[index]) * weight, 0) % 11 === Number(value[9]);
  if (nip && !validNip(nip)) errors.push('Sprawdź NIP odbiorcy — wymagany jest poprawny polski NIP albo puste pole.');
  if (data.internalId) {
    if (!/^\d{10}-\d{5}$/.test(data.internalId) || !validNip(data.internalId.split('-')[0])) {
      errors.push('Numer wewnętrzny odbiorcy musi mieć postać poprawny NIP–5 cyfr, np. 5252228219-00145.');
    } else if (nip && data.internalId.split('-')[0] !== nip) {
      errors.push('NIP odbiorcy musi być zgodny z NIP-em w jego numerze wewnętrznym.');
    }
  }
  return errors;
}

export function invoiceRecipientPayload(draft: InvoiceRecipientDraft) {
  const errors = validateInvoiceRecipientDraft(draft);
  if (errors.length) throw new Error(errors.join(' '));
  return {
    invoice_recipient_mode: draft.mode,
    invoice_recipient_data: draft.mode === 'same_as_buyer' ? null : recipientFields(draft.data),
    service_recipient_organization_id: draft.mode === 'organization' ? draft.organizationId : null,
  };
}
