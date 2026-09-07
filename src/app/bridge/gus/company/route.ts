import { createCipheriv, randomInt } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  getLegalFormDisplayLabel,
  inferBusinessTypeFromRegistryData,
  inferLegalFormFromRegistryData,
  inferOrganizationAlias,
} from '@/lib/organizations/organizationLegalForm';

const GUS_URL = 'https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc';
const KRS_SEARCH_API_URL = 'https://wyszukiwarka-krs-api.ms.gov.pl/api/wyszukiwarka';
const KRS_SEARCH_API_HEADER = 'TopSecretApiKey';
const KRS_SEARCH_SECRET = 'TopSecretApiKey1';

const KRS_API_KEY_KRS_POSITIONS = [193, 8, 327, 501, 112, 74, 409, 226, 16, 306];
const KRS_API_KEY_TIMESTAMP_POSITIONS = [492, 141, 364, 78, 259, 12, 430, 384, 97, 503, 67, 35, 471, 218];
const KRS_API_KEY_CHECKSUM_POSITIONS = [24, 46, 174, 345];
const KRS_API_KEY_SHIFT_MARKER_POSITION = 11;

function cleanNip(value: string) {
  return value.replace(/\D/g, '');
}

function extractValue(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`, 's'));
  return match?.[1]?.trim() || '';
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#xD;/g, '')
    .replace(/&#xA;/g, '');
}

const firstXmlValue = (xml: string, tags: string[]) => {
  for (const tag of tags) {
    const value = extractValue(xml, tag);
    if (value) return value;
  }
  return '';
};

const cleanKrs = (value?: string | null) => String(value || '').replace(/\D/g, '').padStart(10, '0');

const encryptKrsForSearchApi = (krs: string) => {
  const cipher = createCipheriv(
    'aes-128-cbc',
    Buffer.from(KRS_SEARCH_SECRET, 'utf8'),
    Buffer.from(KRS_SEARCH_SECRET, 'utf8'),
  );
  return cipher.update(krs, 'utf8', 'base64') + cipher.final('base64');
};

const getWarsawTimestamp = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}${values.hour}${values.minute}${values.second}`;
};

const generateKrsSearchApiKey = () => {
  const digits = Array.from({ length: 512 }, () => String(randomInt(10)));
  const timestamp = getWarsawTimestamp();

  for (let index = 508; index < 512; index += 1) digits[index] = '0';
  KRS_API_KEY_KRS_POSITIONS.forEach((position) => {
    digits[position] = '0';
  });
  KRS_API_KEY_TIMESTAMP_POSITIONS.forEach((position, index) => {
    digits[position] = timestamp[index];
  });

  const shift = randomInt(1, 10);
  digits[KRS_API_KEY_SHIFT_MARKER_POSITION] = String(shift);
  KRS_API_KEY_CHECKSUM_POSITIONS.forEach((position) => {
    for (let index = digits.length - 1; index > position; index -= 1) {
      digits[index] = digits[index - 1];
    }
    digits[position] = '0';
  });

  const checksum = String(digits.reduce((sum, value) => sum + Number(value), 0) % 10000).padStart(4, '0');
  KRS_API_KEY_CHECKSUM_POSITIONS.forEach((position, index) => {
    digits[position] = checksum[index];
  });

  const source = [...digits];
  for (let index = 0; index < digits.length; index += 1) {
    digits[(index + shift) % digits.length] = source[index];
  }
  return digits.join('');
};

async function fetchFromKrsSearchApi(path: string, body: Record<string, unknown>) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`${KRS_SEARCH_API_URL}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apiKey: generateKrsSearchApiKey(),
        'x-api-key': KRS_SEARCH_API_HEADER,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 401 && attempt === 0) continue;
    if (!response.ok) throw new Error(`KRS_SEARCH_API_${response.status}`);
    return response;
  }
  throw new Error('KRS_SEARCH_API_UNAUTHORIZED');
}

const inferRepresentationType = (rule?: string | null) => {
  const normalized = String(rule || '').toLocaleLowerCase('pl-PL');
  if (!normalized) return undefined;
  if (/prokurent/.test(normalized) && /(łącznie|współdział|dwóch|dwu |2 )/.test(normalized)) {
    return 'joint_with_proxy' as const;
  }
  if (/(łącznie|współdział|dwóch|dwu |2 )/.test(normalized)) return 'joint' as const;
  if (/(samodzielnie|jednoosobowo|każdy członek)/.test(normalized)) return 'sole' as const;
  if (/(pełnomocnik|prokurent)/.test(normalized)) return 'proxy' as const;
  return 'other' as const;
};

const asArray = <T,>(value: T | T[] | null | undefined): T[] =>
  value == null ? [] : Array.isArray(value) ? value : [value];

type RegistryPerson = {
  firstName: string;
  lastName: string;
  fullName: string;
  title: string;
  kind?: 'board_member' | 'proxy' | 'representative' | 'partner';
  authorization?: string;
};

const mapRegistryPerson = (
  person: any,
  title = '',
  kind: RegistryPerson['kind'] = 'representative',
): RegistryPerson | null => {
  const firstName = String(person?.firstName || person?.imie || '').trim();
  const lastName = String(person?.lastName || person?.nazwisko || person?.companyName || '').trim();
  const fullName = [firstName, lastName].filter(Boolean).join(' ');
  if (!fullName || fullName.includes('*')) return null;
  return { firstName, lastName, fullName, title, kind };
};

const uniqueRegistryPeople = (people: Array<RegistryPerson | null | undefined>) => {
  const seen = new Set<string>();
  return people.filter((person): person is RegistryPerson => {
    if (!person || person.fullName.includes('*')) return false;
    const key = person.fullName.toLocaleLowerCase('pl-PL');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

async function fetchDataFromCeidg(nip: string) {
  const token = process.env.CEIDG_API_TOKEN;
  if (!token) return null;

  try {
    const headers = { Authorization: `Bearer ${token}` };
    const listResponse = await fetch(
      `https://dane.biznes.gov.pl/api/ceidg/v3/firmy?nip=${encodeURIComponent(nip)}`,
      { headers, cache: 'no-store' },
    );
    if (!listResponse.ok) return null;

    const listPayload = await listResponse.json();
    const listedCompany = asArray(listPayload?.firmy)[0];
    if (!listedCompany) return null;

    let company = listedCompany;
    const companyId = String(listedCompany?.id || '').trim();
    if (companyId) {
      const detailsResponse = await fetch(
        `https://dane.biznes.gov.pl/api/ceidg/v3/firma/${encodeURIComponent(companyId)}`,
        { headers, cache: 'no-store' },
      );
      if (detailsResponse.ok) {
        const detailsPayload = await detailsResponse.json();
        company = detailsPayload?.firma || detailsPayload || listedCompany;
      }
    }

    const owner = company?.wlasciciel || listedCompany?.wlasciciel || {};
    const businessAddress = company?.adresDzialalnosci || listedCompany?.adresDzialalnosci || {};
    const ownerPerson = mapRegistryPerson(
      {
        firstName: owner?.imie,
        lastName: owner?.nazwisko,
      },
      'Właściciel',
      'representative',
    );
    const proxies = asArray(company?.pelnomocnicy).map((person: any) =>
      mapRegistryPerson(person, 'Pełnomocnik ujawniony w CEIDG', 'proxy'),
    );
    const address = [
      businessAddress?.ulica,
      businessAddress?.budynek,
      businessAddress?.lokal ? `/ ${businessAddress.lokal}` : '',
    ]
      .filter(Boolean)
      .join(' ')
      .trim();

    return {
      name: String(company?.nazwa || listedCompany?.nazwa || '').trim() || undefined,
      regon: String(owner?.regon || '').trim() || undefined,
      address: address || undefined,
      city: String(businessAddress?.miasto || '').trim() || undefined,
      postalCode: String(businessAddress?.kod || '').trim() || undefined,
      country: String(businessAddress?.kraj || '').trim() || undefined,
      voivodeship: String(businessAddress?.wojewodztwo || '').trim() || undefined,
      email: String(company?.email || '').trim() || undefined,
      phone: String(company?.telefon || '').trim() || undefined,
      website: String(company?.www || '').trim() || undefined,
      registrationDate: String(company?.dataRozpoczecia || '').trim() || undefined,
      representatives: uniqueRegistryPeople([ownerPerson, ...proxies]),
      representationType: ownerPerson ? ('sole' as const) : undefined,
      representationRule: ownerPerson
        ? 'Przedsiębiorca wpisany do CEIDG działa osobiście lub przez prawidłowo umocowanego pełnomocnika.'
        : undefined,
      representationBasis: 'CEIDG',
      representationVerifiedAt: new Date().toISOString().split('T')[0],
    };
  } catch (error) {
    console.warn('[CEIDG_ENRICHMENT_FALLBACK]', error);
    return null;
  }
}

const parseKrsPerson = (person: any) => {
  const firstName = String(
    person?.imiona?.imie || person?.imiePierwsze || person?.imie || '',
  ).trim();
  const secondName = String(person?.imiona?.imieDrugie || '').trim();
  const surnameValue = person?.nazwisko;
  const lastName = (
    typeof surnameValue === 'string'
      ? surnameValue
      : [surnameValue?.nazwiskoICzlon, surnameValue?.drugiCzlonNazwiska]
          .filter(Boolean)
          .join('-')
  ).trim();
  const fullName = [firstName, secondName, lastName].filter(Boolean).join(' ');
  return {
    firstName: [firstName, secondName].filter(Boolean).join(' '),
    lastName,
    fullName,
    nameAvailable: Boolean(fullName) && !fullName.includes('*'),
  };
};

const parseKrsSearchBoardMember = (person: any, organName = '') => {
  const firstName = [person?.imiePierwsze, person?.imieDrugie]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
  const lastName = [person?.nazwisko, person?.nazwiskoDrugiCzlon]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('-');
  const fullName = [firstName, lastName].filter(Boolean).join(' ');
  return {
    firstName,
    lastName,
    fullName,
    nameAvailable: Boolean(fullName) && !fullName.includes('*'),
    title: String(person?.funkcja || organName || 'Członek organu').trim(),
    kind: 'board_member' as const,
    authorization: organName || undefined,
  };
};

async function fetchKrsSearchDetails(krs: string) {
  const response = await fetchFromKrsSearchApi('danepodmiotu', {
    krs: encryptKrsForSearchApi(krs),
  });
  return response.json();
}

async function findKrsEntityByNip(nip: string) {
  try {
    const response = await fetchFromKrsSearchApi('krs', {
      rejestr: ['P', 'S'],
      podmiot: {
        krs: null,
        nip,
        regon: null,
        nazwa: null,
        wojewodztwo: null,
        powiat: null,
        gmina: null,
        miejscowosc: null,
        dokladnaNazwa: false,
      },
      status: {
        czyOpp: null,
        czyWpisDotyczacyPostepowaniaUpadlosciowego: null,
        dataPrzyznaniaStatutuOppOd: null,
        dataPrzyznaniaStatutuOppDo: null,
      },
      paginacja: {
        liczbaElementowNaStronie: 10,
        maksymalnaLiczbaWynikow: 100,
        numerStrony: 1,
      },
    });
    const payload = await response.json();
    const result = asArray(payload?.listaPodmiotow).find((entity: any) =>
      /^\d{1,10}$/.test(String(entity?.numer || '').trim()),
    );
    if (!result) return null;

    return {
      krs: cleanKrs(result.numer),
      name: String(result.nazwa || '').trim(),
      city: String(result.miejscowosc || '').trim(),
      registryEntityType: String(result.typRejestru || '').trim(),
    };
  } catch (error) {
    console.warn('[KRS_NIP_FALLBACK]', error);
    return null;
  }
}

function parseKrsPdfProxies(text: string): RegistryPerson[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const start = lines.findIndex((line) => /^Rubryka 3 Prokurenci\b/i.test(line));
  if (start < 0) return [];

  const endCandidate = lines.findIndex(
    (line, index) => index > start && (/^Dział 3\b/i.test(line) || /^Rubryka 4\b/i.test(line)),
  );
  const section = lines.slice(start + 1, endCandidate > start ? endCandidate : undefined);
  const result: RegistryPerson[] = [];
  let current: { firstName?: string; lastName?: string; authorization?: string } | null = null;
  let pendingField: 'firstName' | 'lastName' | 'authorization' | null = null;

  const finish = () => {
    if (!current?.firstName || !current.lastName) return;
    const fullName = `${current.firstName} ${current.lastName}`.trim();
    if (!fullName.includes('*')) {
      result.push({
        firstName: current.firstName,
        lastName: current.lastName,
        fullName,
        title: 'Prokurent',
        kind: 'proxy',
        authorization: current.authorization,
      });
    }
  };

  for (const line of section) {
    if (!line || /^Strona \d+/i.test(line) || /^-- \d+ of \d+ --$/i.test(line)) continue;

    const surname = line.match(/^(?:\d+\s+)?1\.Nazwisko(?:\s*\/[^\n]*)?\s+(.+)$/i);
    if (surname) {
      finish();
      current = { lastName: surname[1].trim() };
      pendingField = null;
      continue;
    }

    const firstNames = line.match(/^2\.Imiona\s*(.*)$/i);
    if (firstNames && current) {
      current.firstName = firstNames[1].trim();
      pendingField = current.firstName ? null : 'firstName';
      continue;
    }

    const authorization = line.match(/^4\.Rodzaj prokury\s*(.*)$/i);
    if (authorization && current) {
      current.authorization = authorization[1].trim();
      pendingField = current.authorization ? null : 'authorization';
      continue;
    }

    if (pendingField && current && !/^\d+\./.test(line)) {
      current[pendingField] = [current[pendingField], line].filter(Boolean).join(' ').trim();
      pendingField = null;
    }
  }
  finish();

  return uniqueRegistryPeople(result);
}

async function fetchKrsPdfProxies(krs: string, registry: 'P' | 'S') {
  const response = await fetchFromKrsSearchApi('OdpisAktualny/pdf', {
    krs: encryptKrsForSearchApi(krs),
    register: registry,
    format: 'PDF',
  });
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(await response.arrayBuffer()) });
  try {
    const parsed = await parser.getText();
    return parseKrsPdfProxies(parsed.text);
  } finally {
    await parser.destroy();
  }
}

async function fetchDataFromKrs(krs?: string | null) {
  const normalizedKrs = cleanKrs(krs);
  if (!/^\d{10}$/.test(normalizedKrs)) return null;

  try {
    let response: Response | null = null;
    let selectedRegistry: 'P' | 'S' = 'P';
    for (const registry of ['P', 'S']) {
      const candidate = await fetch(
        `https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/${normalizedKrs}?rejestr=${registry}&format=json`,
        { cache: 'no-store' },
      );
      if (candidate.ok) {
        response = candidate;
        selectedRegistry = registry as 'P' | 'S';
        break;
      }
    }
    if (!response) return null;

    const payload = await response.json();
    const sectionOne = payload?.odpis?.dane?.dzial1 || {};
    const sectionTwo = payload?.odpis?.dane?.dzial2 || {};
    const subject = sectionOne?.danePodmiotu || {};
    const registeredOffice = sectionOne?.siedzibaIAdres?.siedziba || {};
    const registeredAddress = sectionOne?.siedzibaIAdres?.adres || {};
    const representationEntries = asArray(sectionTwo?.reprezentacja);
    const proxyEntries = asArray(sectionTwo?.prokurenci);
    const rule = representationEntries
      .map((entry: any) => String(entry?.sposobReprezentacji || '').trim())
      .find(Boolean) || '';
    const publicBoardMembers = representationEntries.flatMap((entry: any) =>
      asArray(entry?.sklad).map((person: any) => ({
        ...parseKrsPerson(person),
        title: String(person?.funkcjaWOrganie || entry?.nazwaOrganu || 'Członek organu').trim(),
        kind: 'board_member' as const,
        authorization: String(entry?.nazwaOrganu || '').trim() || undefined,
      })),
    );
    const publicProxies = proxyEntries.map((person: any) => ({
      ...parseKrsPerson(person),
      title: 'Prokurent',
      kind: 'proxy' as const,
      authorization: String(person?.rodzajProkury || '').trim() || undefined,
    }));
    const [searchDetails, pdfProxies] = await Promise.all([
      fetchKrsSearchDetails(normalizedKrs).catch((error) => {
        console.warn('[KRS_DETAILS_FALLBACK]', error);
        return null;
      }),
      proxyEntries.length
        ? fetchKrsPdfProxies(normalizedKrs, selectedRegistry).catch((error) => {
            console.warn('[KRS_PDF_FALLBACK]', error);
            return [];
          })
        : Promise.resolve([]),
    ]);
    const detailedBoardMembers = asArray(searchDetails?.listaCzlonkowReprezentacji).map(
      (person: any) => parseKrsSearchBoardMember(person, String(searchDetails?.nazwaOrganuRep || '').trim()),
    );
    const boardMembers = detailedBoardMembers.some((person) => person.nameAvailable)
      ? detailedBoardMembers
      : publicBoardMembers;
    const proxies = pdfProxies.length
      ? pdfProxies.map((person) => ({ ...person, nameAvailable: true }))
      : publicProxies;
    const representatives = [...boardMembers, ...proxies]
      .filter((person) => person.nameAvailable)
      .map(({ nameAvailable: _nameAvailable, ...person }) => person);
    const address = [
      registeredAddress?.ulica,
      registeredAddress?.nrDomu,
      registeredAddress?.nrLokalu ? `/ ${registeredAddress.nrLokalu}` : '',
    ]
      .filter(Boolean)
      .join(' ')
      .trim();

    return {
      registryLegalFormName: String(subject?.formaPrawna || '').trim() || undefined,
      registryName: 'KRS',
      country: String(registeredAddress?.kraj || registeredOffice?.kraj || '').trim() || undefined,
      voivodeship: String(registeredOffice?.wojewodztwo || '').trim() || undefined,
      city: String(registeredAddress?.miejscowosc || registeredOffice?.miejscowosc || '').trim() || undefined,
      postalCode: String(registeredAddress?.kodPocztowy || '').trim() || undefined,
      address: address || undefined,
      representationType: inferRepresentationType(rule),
      representationRule: rule || undefined,
      representationBasis: 'KRS, Dział 2',
      representationVerifiedAt: new Date().toISOString().split('T')[0],
      representatives,
      registryRoles: [...boardMembers, ...proxies].map((person) => ({
        kind: person.kind,
        title: person.title,
        authorization: person.authorization,
        fullName: person.nameAvailable ? person.fullName : undefined,
        nameAvailable: person.nameAvailable,
      })),
    };
  } catch (error) {
    console.warn('[KRS_ENRICHMENT_FALLBACK]', error);
    return null;
  }
}

async function enrichRegistryData<T extends { name?: string; krs?: string; registryEntityType?: string }>(
  data: T,
) {
  const krsData = data.krs ? await fetchDataFromKrs(data.krs) : null;
  const legalForm = inferLegalFormFromRegistryData({
    name: data.name,
    registryEntityType: data.registryEntityType,
    krs: data.krs,
    registryLegalFormName:
      krsData?.registryLegalFormName || (data as any).registryLegalFormName,
    hasPesel: Boolean((data as any).hasPesel),
    partnersCount: Number((data as any).partners?.length || 0),
  });
  const ceidgData = legalForm === 'jdg'
    ? await fetchDataFromCeidg(String((data as any).nip || ''))
    : null;
  const registryName = legalForm === 'jdg' ? 'CEIDG' : data.krs ? 'KRS' : 'REGON';
  const representatives = uniqueRegistryPeople([
    ...asArray(krsData?.representatives),
    ...asArray(ceidgData?.representatives),
    ...asArray((data as any).representatives),
  ]);
  const dataSources = Array.from(
    new Set([
      ...asArray((data as any).source),
      ...(krsData ? ['krs'] : []),
      ...(ceidgData ? ['ceidg'] : []),
    ]),
  );

  return {
    ...data,
    name: (data as any).name || ceidgData?.name || '',
    alias:
      (data as any).alias ||
      inferOrganizationAlias({ name: ceidgData?.name || data.name, legalForm }),
    regon: (data as any).regon || ceidgData?.regon || '',
    address: (data as any).address || ceidgData?.address || krsData?.address || '',
    city: (data as any).city || ceidgData?.city || krsData?.city || '',
    postalCode: (data as any).postalCode || ceidgData?.postalCode || krsData?.postalCode || '',
    country: (data as any).country || ceidgData?.country || krsData?.country || '',
    voivodeship:
      (data as any).voivodeship || ceidgData?.voivodeship || krsData?.voivodeship || '',
    email: (data as any).email || ceidgData?.email || '',
    phone: (data as any).phone || ceidgData?.phone || '',
    website: (data as any).website || ceidgData?.website || '',
    registrationDate: (data as any).registrationDate || ceidgData?.registrationDate || '',
    legalForm,
    legalFormName: getLegalFormDisplayLabel(legalForm),
    legalFormSource:
      (data as any).source === 'krs'
        ? 'krs'
        : data.registryEntityType
          ? 'gus'
          : krsData?.registryLegalFormName
            ? 'krs'
            : 'inference',
    businessType: inferBusinessTypeFromRegistryData(data.name),
    registryName,
    registryNumber: legalForm === 'jdg' ? '' : data.krs || '',
    representationType: krsData?.representationType || ceidgData?.representationType,
    representationRule: krsData?.representationRule || ceidgData?.representationRule,
    representationBasis: krsData?.representationBasis || ceidgData?.representationBasis,
    representationVerifiedAt:
      krsData?.representationVerifiedAt || ceidgData?.representationVerifiedAt,
    registryRoles: krsData?.registryRoles || [],
    representatives,
    dataSources,
  };
}

async function fetchFromCeidgRegistry(clean: string) {
  const ceidgData = await fetchDataFromCeidg(clean);
  if (!ceidgData?.name) return null;

  const legalForm = 'jdg' as const;
  return NextResponse.json({
    source: 'ceidg',
    fallback: true,
    nip: clean,
    ...ceidgData,
    alias: inferOrganizationAlias({ name: ceidgData.name, legalForm }),
    legalForm,
    legalFormName: getLegalFormDisplayLabel(legalForm),
    legalFormSource: 'ceidg',
    businessType: inferBusinessTypeFromRegistryData(ceidgData.name),
    registryEntityType: 'F',
    registryName: 'CEIDG',
    registryNumber: '',
    dataSources: ['ceidg'],
  });
}

async function fetchFromKrsByNip(clean: string) {
  const entity = await findKrsEntityByNip(clean);
  if (!entity?.krs) return null;

  const data = await enrichRegistryData({
    source: 'krs',
    fallback: true,
    nip: clean,
    name: entity.name,
    krs: entity.krs,
    city: entity.city,
    registryEntityType: entity.registryEntityType,
  });
  return NextResponse.json(data);
}

function parseAddress(rawAddress: string) {
  let street = rawAddress || '';
  let city = '';
  let postalCode = '';

  const postalMatch = rawAddress.match(/(\d{2}-\d{3})\s+(.+)$/);

  if (postalMatch) {
    postalCode = postalMatch[1];
    city = postalMatch[2].trim();
    street = rawAddress.substring(0, postalMatch.index).trim().replace(/,\s*$/, '');
  }

  return {
    address: street || '',
    city,
    postalCode,
  };
}

async function fetchFullGusReport({
  regon,
  registryEntityType,
  sid,
}: {
  regon: string;
  registryEntityType: string;
  sid: string;
}) {
  const reportNames: Record<string, string[]> = {
    P: ['BIR11OsPrawna'],
    F: ['BIR11OsFizycznaDaneOgolne'],
    LP: ['BIR11JednLokalnaOsPrawnej'],
    LF: ['BIR11JednLokalnaOsFizycznej'],
  };
  const candidates = reportNames[registryEntityType] || [];

  for (const reportName of candidates) {
    const reportSoap = `<?xml version="1.0" encoding="utf-8"?>
      <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:ns="http://CIS/BIR/PUBL/2014/07">
        <soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing">
          <wsa:Action>http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/DanePobierzPelnyRaport</wsa:Action>
          <wsa:To>${GUS_URL}</wsa:To>
        </soap:Header>
        <soap:Body>
          <ns:DanePobierzPelnyRaport>
            <ns:pRegon>${regon}</ns:pRegon>
            <ns:pNazwaRaportu>${reportName}</ns:pNazwaRaportu>
          </ns:DanePobierzPelnyRaport>
        </soap:Body>
      </soap:Envelope>`;
    const response = await fetch(GUS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8',
        sid,
      },
      body: reportSoap,
      cache: 'no-store',
    });
    if (!response.ok) continue;

    const responseXml = await response.text();
    const reportXml = decodeXml(extractValue(responseXml, 'DanePobierzPelnyRaportResult'));
    if (!reportXml || !reportXml.includes('<dane>')) continue;

    return {
      alias: firstXmlValue(reportXml, [
        'praw_nazwaSkrocona',
        'fiz_nazwaSkrocona',
        'lokpraw_nazwaSkrocona',
        'lokfiz_nazwaSkrocona',
      ]),
      email: firstXmlValue(reportXml, [
        'praw_adresEmail',
        'fiz_adresEmail',
        'lokpraw_adresEmail',
        'lokfiz_adresEmail',
      ]),
      phone: firstXmlValue(reportXml, [
        'praw_numerTelefonu',
        'fiz_numerTelefonu',
        'lokpraw_numerTelefonu',
        'lokfiz_numerTelefonu',
      ]),
      website: firstXmlValue(reportXml, [
        'praw_adresStronyinternetowej',
        'fiz_adresStronyinternetowej',
        'lokpraw_adresStronyinternetowej',
        'lokfiz_adresStronyinternetowej',
      ]),
      country: firstXmlValue(reportXml, [
        'praw_adSiedzKraj_Nazwa',
        'fiz_adSiedzKraj_Nazwa',
        'lokpraw_adSiedzKraj_Nazwa',
        'lokfiz_adSiedzKraj_Nazwa',
      ]),
      registryLegalFormName: firstXmlValue(reportXml, [
        'praw_nazwaSzczegolnejFormyPrawnej',
        'fiz_nazwaSzczegolnejFormyPrawnej',
      ]),
      registryNameFromGus: firstXmlValue(reportXml, [
        'praw_nazwaRejestruEwidencji',
        'fiz_nazwaRejestruEwidencji',
      ]),
      registryNumberFromGus: firstXmlValue(reportXml, [
        'praw_numerWRejestrzeEwidencji',
        'fiz_numerWRejestrzeEwidencji',
      ]),
      registrationDate: firstXmlValue(reportXml, [
        'praw_dataRozpoczeciaDzialalnosci',
        'fiz_dataRozpoczeciaDzialalnosci',
        'lokpraw_dataRozpoczeciaDzialalnosci',
        'lokfiz_dataRozpoczeciaDzialalnosci',
      ]),
    };
  }

  return null;
}

async function fetchFromWhiteList(clean: string) {
  const today = new Date().toISOString().split('T')[0];

  const response = await fetch(
    `https://wl-api.mf.gov.pl/api/search/nip/${clean}?date=${today}`,
    { cache: 'no-store' },
  );

  if (response.status === 404) {
    return NextResponse.json(
      {
        source: 'mf_whitelist',
        fallback: true,
        error: 'Nie znaleziono firmy na białej liście VAT',
        reason: 'MF_WHITELIST_NOT_FOUND',
      },
      { status: 404 },
    );
  }

  if (!response.ok) {
    return NextResponse.json(
      {
        source: 'mf_whitelist',
        fallback: true,
        error: 'Błąd podczas pobierania danych z białej listy VAT',
        reason: 'MF_WHITELIST_ERROR',
      },
      { status: 502 },
    );
  }

  const json = await response.json();
  const subject = json?.result?.subject;

  if (!subject) {
    return NextResponse.json(
      {
        source: 'mf_whitelist',
        fallback: true,
        error: 'Brak danych firmy w odpowiedzi białej listy VAT',
        reason: 'MF_WHITELIST_EMPTY',
      },
      { status: 404 },
    );
  }

  const rawAddress = subject.workingAddress || subject.residenceAddress || '';
  const parsedAddress = parseAddress(rawAddress);
  const representatives = uniqueRegistryPeople([
    ...asArray(subject.representatives).map((person) =>
      mapRegistryPerson(person, 'Osoba reprezentująca', 'representative'),
    ),
    ...asArray(subject.authorizedClerks).map((person) =>
      mapRegistryPerson(person, 'Prokurent / osoba upoważniona', 'proxy'),
    ),
  ]);
  const partners = uniqueRegistryPeople(
    asArray(subject.partners).map((person) => mapRegistryPerson(person, 'Wspólnik', 'partner')),
  );

  const data = await enrichRegistryData({
    source: 'mf_whitelist',
    fallback: true,
    nip: subject.nip || clean,
    name: subject.name || '',
    regon: subject.regon || '',
    krs: subject.krs || '',
    vatStatus: subject.statusVat || '',
    registrationDate: subject.registrationLegalDate || '',
    workingAddress: subject.workingAddress || '',
    residenceAddress: subject.residenceAddress || '',
    country: 'POLSKA',
    bankAccountCount: asArray(subject.accountNumbers).length,
    hasVirtualAccounts: Boolean(subject.hasVirtualAccounts),
    hasPesel: Boolean(subject.pesel),
    representatives,
    partners,
    ...parsedAddress,
  });
  return NextResponse.json(data);
}

async function fetchFromAvailableRegistries(clean: string, gusKeyAvailable: boolean) {
  let whiteListResponse: NextResponse | null = null;
  try {
    whiteListResponse = await fetchFromWhiteList(clean);
    if (whiteListResponse.ok) return whiteListResponse;
  } catch (error) {
    console.warn('[MF_WHITELIST_FALLBACK]', error);
  }

  const ceidgResponse = await fetchFromCeidgRegistry(clean);
  if (ceidgResponse) return ceidgResponse;

  const krsResponse = await fetchFromKrsByNip(clean);
  if (krsResponse) return krsResponse;

  if (!gusKeyAvailable) {
    return NextResponse.json(
      {
        source: 'gus',
        fallback: true,
        error:
          'Podmiot nie występuje w CEIDG, KRS ani na białej liście VAT. Do wyszukania instytucji z rejestru REGON wymagany jest GUS_API_KEY.',
        reason: 'GUS_API_KEY_REQUIRED',
      },
      { status: 503 },
    );
  }

  return whiteListResponse || NextResponse.json(
    {
      source: 'gus',
      fallback: true,
      error: 'Nie znaleziono podmiotu w dostępnych rejestrach.',
      reason: 'REGISTRY_NOT_FOUND',
    },
    { status: 404 },
  );
}

async function fetchFromGus(clean: string, apiKey: string) {
  const loginSoap = `<?xml version="1.0" encoding="utf-8"?>
    <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:ns="http://CIS/BIR/PUBL/2014/07">
      <soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing">
        <wsa:Action>http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/Zaloguj</wsa:Action>
        <wsa:To>${GUS_URL}</wsa:To>
      </soap:Header>
      <soap:Body>
        <ns:Zaloguj>
          <ns:pKluczUzytkownika>${apiKey}</ns:pKluczUzytkownika>
        </ns:Zaloguj>
      </soap:Body>
    </soap:Envelope>`;

  const loginRes = await fetch(GUS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/soap+xml; charset=utf-8',
    },
    body: loginSoap,
    cache: 'no-store',
  });

  const loginXml = await loginRes.text();
  const sid = extractValue(loginXml, 'ZalogujResult');

  if (!sid) {
    throw new Error('GUS_LOGIN_FAILED');
  }

  const searchSoap = `<?xml version="1.0" encoding="utf-8"?>
    <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:ns="http://CIS/BIR/PUBL/2014/07" xmlns:dat="http://CIS/BIR/PUBL/2014/07/DataContract">
      <soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing">
        <wsa:Action>http://CIS/BIR/PUBL/2014/07/IUslugaBIRzewnPubl/DaneSzukajPodmioty</wsa:Action>
        <wsa:To>${GUS_URL}</wsa:To>
      </soap:Header>
      <soap:Body>
        <ns:DaneSzukajPodmioty>
          <ns:pParametryWyszukiwania>
            <dat:Nip>${clean}</dat:Nip>
          </ns:pParametryWyszukiwania>
        </ns:DaneSzukajPodmioty>
      </soap:Body>
    </soap:Envelope>`;

  const searchRes = await fetch(GUS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/soap+xml; charset=utf-8',
      sid,
    },
    body: searchSoap,
    cache: 'no-store',
  });

  const searchXml = await searchRes.text();

  const resultRaw = decodeXml(extractValue(searchXml, 'DaneSzukajPodmiotyResult'));

  if (!resultRaw || !resultRaw.includes('<dane>')) {
    throw new Error('GUS_NOT_FOUND');
  }

  const address = [
    extractValue(resultRaw, 'Ulica'),
    extractValue(resultRaw, 'NrNieruchomosci'),
    extractValue(resultRaw, 'NrLokalu') ? `/ ${extractValue(resultRaw, 'NrLokalu')}` : '',
  ]
    .filter(Boolean)
    .join(' ')
    .trim();

  const registryEntityType = extractValue(resultRaw, 'Typ');
  const regon = extractValue(resultRaw, 'Regon');
  const fullReport = regon
    ? await fetchFullGusReport({ regon, registryEntityType, sid })
    : null;
  const data = await enrichRegistryData({
    source: 'gus',
    fallback: false,
    nip: clean,
    name: extractValue(resultRaw, 'Nazwa'),
    regon,
    krs: extractValue(resultRaw, 'Krs'),
    postalCode: extractValue(resultRaw, 'KodPocztowy'),
    city: extractValue(resultRaw, 'Miejscowosc'),
    address,
    voivodeship: extractValue(resultRaw, 'Wojewodztwo'),
    registryEntityType,
    ...(fullReport || {}),
  });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  try {
    const { nip } = await req.json();
    const clean = cleanNip(nip || '');

    if (clean.length !== 10) {
      return NextResponse.json({ error: 'Nieprawidłowy NIP' }, { status: 400 });
    }

    const apiKey = process.env.GUS_API_KEY;

    if (!apiKey) {
      return fetchFromAvailableRegistries(clean, false);
    }

    try {
      return await fetchFromGus(clean, apiKey);
    } catch (gusError: any) {
      console.warn('[GUS_FALLBACK]', gusError?.message || gusError);
      return fetchFromAvailableRegistries(clean, true);
    }
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error.message || 'Błąd pobierania danych firmy',
        reason: 'UNKNOWN_ERROR',
      },
      { status: 500 },
    );
  }
}
