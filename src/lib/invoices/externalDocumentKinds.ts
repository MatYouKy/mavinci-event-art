export const EXTERNAL_DOCUMENT_KINDS = [
  { value: 'invoice', label: 'Faktura' },
  { value: 'receipt', label: 'Paragon / rachunek' },
  { value: 'credit_note', label: 'Faktura korygująca' },
  { value: 'insurance_policy', label: 'Polisa ubezpieczeniowa' },
  { value: 'contract', label: 'Umowa' },
  { value: 'debit_note', label: 'Nota obciążeniowa' },
  { value: 'other', label: 'Inny dokument' },
] as const;

export type ExternalDocumentKind = (typeof EXTERNAL_DOCUMENT_KINDS)[number]['value'];

export function isExternalDocumentKind(value: unknown): value is ExternalDocumentKind {
  return typeof value === 'string' && EXTERNAL_DOCUMENT_KINDS.some((kind) => kind.value === value);
}

export function externalDocumentKindLabel(value?: string | null): string {
  return EXTERNAL_DOCUMENT_KINDS.find((kind) => kind.value === value)?.label ?? 'Faktura';
}
