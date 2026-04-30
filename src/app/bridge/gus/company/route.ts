import { NextResponse } from 'next/server';

const GUS_URL = 'https://wyszukiwarkaregon.stat.gov.pl/wsBIR/UslugaBIRzewnPubl.svc';

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

  return NextResponse.json({
    source: 'mf_whitelist',
    fallback: true,
    nip: subject.nip || clean,
    name: subject.name || '',
    regon: subject.regon || '',
    krs: subject.krs || '',
    ...parsedAddress,
  });
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

  return NextResponse.json({
    source: 'gus',
    fallback: false,
    nip: clean,
    name: extractValue(resultRaw, 'Nazwa'),
    regon: extractValue(resultRaw, 'Regon'),
    krs: extractValue(resultRaw, 'Krs'),
    postalCode: extractValue(resultRaw, 'KodPocztowy'),
    city: extractValue(resultRaw, 'Miejscowosc'),
    address,
    voivodeship: extractValue(resultRaw, 'Wojewodztwo'),
  });
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
      return fetchFromWhiteList(clean);
    }

    try {
      return await fetchFromGus(clean, apiKey);
    } catch (gusError: any) {
      console.warn('[GUS_FALLBACK]', gusError?.message || gusError);
      return fetchFromWhiteList(clean);
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