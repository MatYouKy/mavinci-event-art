// Older forms stored driving licences as generic certificates. Keep their
// history readable, but only employee_driving_licenses is an operational source.
export const isDrivingLicenseCertification = (name: string | null | undefined) =>
  /^prawo\s+jazdy(?:\s|$)/i.test((name || '').trim());

export const drivingLicenseCodeFromCertification = (name: string) => {
  const match = /^prawo\s+jazdy\s+(?:kat(?:egoria)?\.?\s*)?([a-z0-9]+(?:\s*\+\s*[a-z0-9]+)?)$/i.exec(name.trim());
  return match?.[1].replace(/\s/g, '').toUpperCase() || null;
};

export interface LegacyDrivingLicenseCertificate {
  id: string;
  issued_date: string;
  expiry_date: string | null;
  certification_number: string | null;
  issuing_authority: string | null;
  notes: string | null;
  document_url?: string | null;
  is_active: boolean;
  certification_type: { name: string };
}
