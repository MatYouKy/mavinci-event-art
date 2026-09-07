import { legalFormLabels, type LegalForm } from '@/utils/labels/legalFormLabels';

export type OrganizationRegistryProfile =
  | 'ceidg'
  | 'civil_partnership'
  | 'krs'
  | 'institution'
  | 'other';

export type OrganizationBusinessType =
  | 'company'
  | 'hotel'
  | 'restaurant'
  | 'venue'
  | 'freelancer'
  | 'other';

const KRS_LEGAL_FORMS = new Set<LegalForm>([
  'sp_zoo',
  'sp_jawna',
  'sp_partnerska',
  'sp_komandytowa',
  'sp_komandytowo_akcyjna',
  'sp_akcyjna',
  'prosta_sp_akcyjna',
  'spoldzielnia',
  'fundacja',
  'stowarzyszenie',
]);

const INSTITUTION_LEGAL_FORMS = new Set<LegalForm>([
  'public_institution',
  'local_government',
  'state_legal_person',
]);

const normalizeForMatching = (value?: string | null) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // Litery takie jak Ł nie rozkładają się przez NFD, więc bez jawnego
    // mapowania "SPÓŁKA" zmieniała się w "SPO KA" i nie pasowała do wzorca.
    .replace(/[Łł]/g, 'L')
    .replace(/[Đđ]/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const isKnownLegalForm = (value?: string | null): value is LegalForm =>
  Boolean(value && Object.prototype.hasOwnProperty.call(legalFormLabels, value));

export const requiresKrsForLegalForm = (value?: string | null) =>
  isKnownLegalForm(value) && KRS_LEGAL_FORMS.has(value);

export const inferLegalFormFromRegistryData = ({
  name,
  registryEntityType,
  krs,
  registryLegalFormName,
  hasPesel,
  partnersCount,
}: {
  name?: string | null;
  registryEntityType?: string | null;
  krs?: string | null;
  registryLegalFormName?: string | null;
  hasPesel?: boolean;
  partnersCount?: number;
}): LegalForm => {
  if (String(registryEntityType || '').toUpperCase() === 'F' || hasPesel) return 'jdg';

  const normalizedName = normalizeForMatching(`${registryLegalFormName || ''} ${name || ''}`);
  const patterns: Array<[LegalForm, RegExp]> = [
    ['prosta_sp_akcyjna', /\bPROSTA SPOLKA AKCYJNA\b|\bP S A\b/],
    ['sp_komandytowo_akcyjna', /\bSPOLKA KOMANDYTOWO AKCYJNA\b|\bS K A\b/],
    ['sp_zoo', /\bSPOLKA Z OGRANICZONA ODPOWIEDZIALNOSCIA\b|\bSP Z O O\b/],
    ['sp_partnerska', /\bSPOLKA PARTNERSKA\b|\bSP P\b/],
    ['sp_komandytowa', /\bSPOLKA KOMANDYTOWA\b|\bSP K\b/],
    ['sp_jawna', /\bSPOLKA JAWNA\b|\bSP J\b/],
    ['sp_cywilna', /\bSPOLKA CYWILNA\b|\bS C\b/],
    ['sp_akcyjna', /\bSPOLKA AKCYJNA\b|\bS A\b/],
    ['spoldzielnia', /\bSPOLDZIELNIA\b/],
    ['fundacja', /\bFUNDACJA\b/],
    ['stowarzyszenie', /\bSTOWARZYSZENIE\b/],
    ['local_government', /\bGMINA\b|\bPOWIAT\b|\bWOJEWODZTWO\b/],
    [
      'public_institution',
      /\bURZAD\b|\bOSRODEK\b|\bSZKOLA\b|\bPRZEDSZKOLE\b|\bMUZEUM\b|\bBIBLIOTEKA\b|\bNADLESNICTWO\b|\bINSTYTUT\b|\bSZPITAL\b|\bKOMENDA\b|\bSAD\b|\bPROKURATURA\b|\bPARAFIA\b|\bDIECEZJA\b|\bUCZELNIA\b|\bUNIWERSYTET\b|\bAKADEMIA\b|\bDOM KULTURY\b|\bJEDNOSTKA BUDZETOWA\b/,
    ],
  ];

  const matched = patterns.find(([, pattern]) => pattern.test(normalizedName));
  if (matched) return matched[0];
  if ((partnersCount || 0) > 0 && !String(krs || '').trim()) return 'sp_cywilna';
  if (String(krs || '').replace(/\D/g, '')) return 'other_legal_entity';
  // Dla polskiego podmiotu posiadającego NIP, który nie ma KRS ani cech
  // instytucji lub spółki cywilnej, najbardziej prawdopodobnym rejestrem jest CEIDG.
  return 'jdg';
};

export const inferBusinessTypeFromRegistryData = (
  name?: string | null,
): OrganizationBusinessType => {
  const normalizedName = normalizeForMatching(name);
  if (/\bHOTEL\b|\bPENSJONAT\b|\bAPARTHOTEL\b|\bOSRODEK WYPOCZYNKOWY\b/.test(normalizedName)) {
    return 'hotel';
  }
  if (/\bRESTAURACJ|\bCATERING\b|\bBISTRO\b|\bKARCZMA\b/.test(normalizedName)) {
    return 'restaurant';
  }
  if (/\bSALA WESELNA\b|\bDOM WESELNY\b|\bCENTRUM EVENTOWE\b|\bEVENT VENUE\b/.test(normalizedName)) {
    return 'venue';
  }
  return 'company';
};

export const resolveOrganizationLegalForm = ({
  legalForm,
  name,
  krs,
}: {
  legalForm?: string | null;
  name?: string | null;
  krs?: string | null;
}): LegalForm | null => {
  const inferred = inferLegalFormFromRegistryData({ name, krs });

  // Chroni starsze rekordy, w których instytucja bez KRS została błędnie
  // zapisana jako spółka kapitałowa (np. przez dawną wartość domyślną).
  if (
    isKnownLegalForm(legalForm) &&
    requiresKrsForLegalForm(legalForm) &&
    !String(krs || '').trim() &&
    INSTITUTION_LEGAL_FORMS.has(inferred)
  ) {
    return inferred;
  }

  if (isKnownLegalForm(legalForm)) return legalForm;
  return inferred === 'other' ? null : inferred;
};

export const getOrganizationRegistryProfile = ({
  legalForm,
  name,
  krs,
}: {
  legalForm?: string | null;
  name?: string | null;
  krs?: string | null;
}): OrganizationRegistryProfile => {
  const resolved = resolveOrganizationLegalForm({ legalForm, name, krs });
  if (resolved === 'jdg') return 'ceidg';
  if (resolved === 'sp_cywilna') return 'civil_partnership';
  if (resolved && KRS_LEGAL_FORMS.has(resolved)) return 'krs';
  if (resolved && INSTITUTION_LEGAL_FORMS.has(resolved)) return 'institution';
  return 'other';
};

export const getLegalFormDisplayLabel = (value?: string | null) =>
  isKnownLegalForm(value) ? legalFormLabels[value] : String(value || '').trim();

export const inferOrganizationAlias = ({
  name,
  legalForm,
}: {
  name?: string | null;
  legalForm?: string | null;
}) => {
  const rawName = String(name || '').trim();
  if (!rawName) return '';

  const suffixPatterns: Partial<Record<LegalForm, RegExp>> = {
    sp_zoo: /\s+(?:SPÓŁKA\s+Z\s+OGRANICZONĄ\s+ODPOWIEDZIALNOŚCIĄ|SP\.?\s*Z\.?\s*O\.?\s*O\.?)\s*$/iu,
    sp_jawna: /\s+(?:SPÓŁKA\s+JAWNA|SP\.?\s*J\.?)\s*$/iu,
    sp_partnerska: /\s+(?:SPÓŁKA\s+PARTNERSKA|SP\.?\s*P\.?)\s*$/iu,
    sp_cywilna: /\s+(?:SPÓŁKA\s+CYWILNA|S\.?\s*C\.?)\s*$/iu,
    sp_komandytowa: /\s+(?:SPÓŁKA\s+KOMANDYTOWA|SP\.?\s*K\.?)\s*$/iu,
    sp_komandytowo_akcyjna: /\s+(?:SPÓŁKA\s+KOMANDYTOWO[-\s]AKCYJNA|S\.?\s*K\.?\s*A\.?)\s*$/iu,
    sp_akcyjna: /\s+(?:SPÓŁKA\s+AKCYJNA|S\.?\s*A\.?)\s*$/iu,
    prosta_sp_akcyjna: /\s+(?:PROSTA\s+SPÓŁKA\s+AKCYJNA|P\.?\s*S\.?\s*A\.?)\s*$/iu,
  };
  const pattern = isKnownLegalForm(legalForm) ? suffixPatterns[legalForm] : undefined;
  return (pattern ? rawName.replace(pattern, '') : rawName).trim();
};

export const getRepresentationIntro = ({
  profile,
  legalForm,
  name,
}: {
  profile: OrganizationRegistryProfile;
  legalForm?: string | null;
  name?: string | null;
}) => {
  if (profile === 'ceidg') return 'osoba uprawniona do zawarcia umowy:';
  if (profile === 'civil_partnership') return 'reprezentowana przez:';
  if (legalForm === 'stowarzyszenie') return 'reprezentowane przez:';
  if (['sp_zoo', 'sp_jawna', 'sp_partnerska', 'sp_komandytowa', 'sp_komandytowo_akcyjna', 'sp_akcyjna', 'prosta_sp_akcyjna', 'spoldzielnia', 'fundacja'].includes(String(legalForm || ''))) {
    return 'reprezentowana przez:';
  }

  const normalizedName = normalizeForMatching(name);
  if (/\b(OSRODEK|URZAD|INSTYTUT|ZAKLAD|ZWIAZEK)\b/.test(normalizedName)) {
    return 'reprezentowany przez:';
  }
  if (/\b(CENTRUM|MUZEUM|STOWARZYSZENIE|PRZEDSZKOLE|NADLESNICTWO)\b/.test(normalizedName)) {
    return 'reprezentowane przez:';
  }
  if (/\b(GMINA|FUNDACJA|INSTYTUCJA|SZKOLA)\b/.test(normalizedName)) {
    return 'reprezentowana przez:';
  }
  return 'w imieniu podmiotu działa:';
};
