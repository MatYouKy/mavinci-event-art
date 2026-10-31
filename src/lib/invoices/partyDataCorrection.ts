import { readInvoiceKsefRecipientSnapshot, type InvoiceKsefRecipientSnapshot } from './ksefRecipient';

export interface InvoiceCorrectionBuyer {
  name: string;
  nip: string;
  street: string;
  postalCode: string;
  city: string;
  countryCode: string;
}

export interface InvoicePartyDataBefore {
  version: 1;
  buyer: InvoiceCorrectionBuyer;
  recipient: InvoiceKsefRecipientSnapshot['recipient'];
}

const invalidCorrection = () => new Error(
  'Brak kompletnych, zapisanych danych stron sprzed korekty. Nie można przygotować wizualizacji ani wysyłki tej korekty.',
);

/** Only the immutable snapshot on the correction is authoritative, never a live CRM contact. */
export function getInvoicePartyDataCorrection(invoice: {
  invoice_type?: string | null;
  correction_kind?: string | null;
  correction_party_data_before?: unknown;
}): InvoicePartyDataBefore | null {
  if (invoice.correction_kind !== 'party_data') return null;
  if (invoice.invoice_type !== 'corrective') throw invalidCorrection();
  const value = invoice.correction_party_data_before;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidCorrection();
  const snapshot = value as Record<string, unknown>;
  if (snapshot.version !== 1 || !snapshot.buyer || typeof snapshot.buyer !== 'object' || Array.isArray(snapshot.buyer)
    || !Object.prototype.hasOwnProperty.call(snapshot, 'recipient')) throw invalidCorrection();
  const buyer = snapshot.buyer as Record<string, unknown>;
  for (const key of ['name', 'nip', 'street', 'postalCode', 'city', 'countryCode']) {
    if (typeof buyer[key] !== 'string' || !(buyer[key] as string).trim()) throw invalidCorrection();
  }
  if (!/^\d{10}$/.test(buyer.nip as string) || !/^[A-Z]{2}$/.test(buyer.countryCode as string)) throw invalidCorrection();
  const recipient = readInvoiceKsefRecipientSnapshot({ version: 1, recipient: snapshot.recipient });
  return {
    version: 1,
    buyer: {
      name: buyer.name as string, nip: buyer.nip as string, street: buyer.street as string,
      postalCode: buyer.postalCode as string, city: buyer.city as string, countryCode: buyer.countryCode as string,
    },
    recipient: recipient!.recipient,
  };
}
