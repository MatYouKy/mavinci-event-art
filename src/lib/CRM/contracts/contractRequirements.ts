/*
 * Katalog wymagań umowy z parametrami — zasilanie, internet, miejsce realizacji, dojazd i rozładunek, czas montażu,
 * zaplecze. Zamiast wolnego tekstu w każdym produkcie („sprawne zasilanie”, „gniazdo 230 V w pobliżu stanowiska”…)
 * produkt podaje parametry, a umowa składa z nich JEDEN zapis na typ:
 * - zasilanie: najmocniejsze przyłącze pokrywa słabsze (400 V / 32 A pokrywa 230 V / 16 A); „osobny obwód” liczy się
 *   oddzielnie (np. „2 osobne obwody 230 V / 16 A”);
 * - internet: łącze przewodowe pokrywa Wi-Fi, przepustowość — największa wymagana;
 * - miejsce: cechy podłoża sumują się (równe, suche, zadaszone), wysokość — największa, wymiary stanowisk — dla każdej usługi;
 * - dojazd: największy pojazd, najkrótsza odległość rozładunku, winda — jeśli wymaga jej którakolwiek usługa;
 * - montaż: najwcześniejszy dostęp przed wydarzeniem i najdłuższy demontaż po nim, próba — jeśli wymaga jej którakolwiek;
 * - zaplecze: pomieszczenie, woda i posiłek — jeśli wymaga ich którakolwiek usługa, liczba osób obsługi — suma.
 * Zapisy są w jednym stylu umowy („Zamawiający zapewni…”) i wskazują usługi, których dotyczą.
 * Bez DOM — działa w CRM, na serwerze (Mac) i w aplikacji mobilnej.
 */

export type ContractPowerRequirement = {
  type: 'power';
  /** 1 — 230 V (jednofazowe), 3 — 400 V (trójfazowe). */
  phases: 1 | 3;
  /** Zabezpieczenie w amperach (np. 16, 32, 63); brak — bez wskazania. */
  current?: number;
  /** Osobny obwód — niewspółdzielony z innymi urządzeniami. */
  dedicated?: boolean;
  /** Najmniejsza liczba gniazd przy stanowisku. */
  sockets?: number;
  /** Największa odległość punktu zasilania od stanowiska (m). */
  distance?: number;
};

export type ContractInternetRequirement = {
  type: 'internet';
  connection: 'wifi' | 'cable';
  download?: number;
  upload?: number;
  /** Łącze niewspółdzielone z uczestnikami wydarzenia. */
  dedicated?: boolean;
};

export type ContractSpaceRequirement = {
  type: 'space';
  width?: number;
  depth?: number;
  height?: number;
  level?: boolean;
  dry?: boolean;
  covered?: boolean;
};

export type ContractAccessRequirement = {
  type: 'access';
  vehicle?: 'car' | 'van' | 'truck';
  /** Największa odległość miejsca rozładunku od miejsca realizacji (m). */
  unloadDistance?: number;
  /** Wniesienie bez schodów lub windą towarową. */
  lift?: boolean;
  parking?: number;
};

export type ContractSetupRequirement = {
  type: 'setup';
  /** Dostęp przed rozpoczęciem wydarzenia (godziny). */
  before?: number;
  /** Próba techniczna przed wydarzeniem. */
  test?: boolean;
  /** Demontaż po zakończeniu wydarzenia (godziny). */
  after?: number;
  /** Demontaż po wydarzeniu bez wskazania godzin. */
  teardown?: boolean;
};

export type ContractBackstageRequirement = {
  type: 'backstage';
  room?: boolean;
  people?: number;
  water?: boolean;
  meal?: boolean;
};

export type ContractRequirement =
  | ContractPowerRequirement
  | ContractInternetRequirement
  | ContractSpaceRequirement
  | ContractAccessRequirement
  | ContractSetupRequirement
  | ContractBackstageRequirement;

export type ContractRequirementType = ContractRequirement['type'];

/**
 * Typy w kolejności zapisów w umowie; `category` i `topic` — kategoria i temat klauzuli (`CONTRACT_CLAUSE_TOPICS`),
 * w których zapis się pojawia.
 */
export const CONTRACT_REQUIREMENT_TYPES: Array<{
  type: ContractRequirementType;
  category: 'requirements' | 'additional_requirements';
  topic: string;
  label: string;
}> = [
  { type: 'power', category: 'requirements', topic: 'power', label: 'Zasilanie' },
  { type: 'internet', category: 'requirements', topic: 'internet', label: 'Internet' },
  { type: 'space', category: 'requirements', topic: 'place', label: 'Miejsce realizacji' },
  { type: 'access', category: 'requirements', topic: 'access', label: 'Dojazd i rozładunek' },
  { type: 'setup', category: 'requirements', topic: 'time', label: 'Montaż, próba i demontaż' },
  { type: 'backstage', category: 'additional_requirements', topic: 'backstage', label: 'Zaplecze dla obsługi' },
];

export const contractRequirementLabel = (type: string) =>
  CONTRACT_REQUIREMENT_TYPES.find((definition) => definition.type === type)?.label || 'Wymaganie';

export const contractRequirementTopic = (type: string) =>
  CONTRACT_REQUIREMENT_TYPES.find((definition) => definition.type === type)?.topic || 'technical';

export const contractRequirementCategory = (type: string) =>
  CONTRACT_REQUIREMENT_TYPES.find((definition) => definition.type === type)?.category || 'requirements';

/**
 * Pola parametrów każdego typu — do formularzy budowanych z opisu (aplikacja na Maca). `number` z jednostką,
 * `bool` — pole wyboru, `choice` — lista wartości.
 */
export type ContractRequirementField =
  | { key: string; label: string; kind: 'number'; suffix?: string }
  | { key: string; label: string; kind: 'bool' }
  | { key: string; label: string; kind: 'choice'; options: Array<{ value: string; label: string }>; numeric?: boolean };

export const CONTRACT_REQUIREMENT_FIELDS: Record<ContractRequirementType, ContractRequirementField[]> = {
  power: [
    { key: 'phases', label: 'Przyłącze', kind: 'choice', numeric: true, options: [{ value: '1', label: '230 V — jednofazowe' }, { value: '3', label: '400 V — trójfazowe' }] },
    { key: 'current', label: 'Zabezpieczenie', kind: 'number', suffix: 'A' },
    { key: 'sockets', label: 'Najmniej gniazd przy stanowisku', kind: 'number' },
    { key: 'distance', label: 'Najdalej od stanowiska', kind: 'number', suffix: 'm' },
    { key: 'dedicated', label: 'Osobny obwód — niewspółdzielony z innymi urządzeniami', kind: 'bool' },
  ],
  internet: [
    { key: 'connection', label: 'Łącze', kind: 'choice', options: [{ value: 'wifi', label: 'Bezprzewodowe (Wi-Fi)' }, { value: 'cable', label: 'Przewodowe (Ethernet)' }] },
    { key: 'download', label: 'Pobieranie co najmniej', kind: 'number', suffix: 'Mb/s' },
    { key: 'upload', label: 'Wysyłanie co najmniej', kind: 'number', suffix: 'Mb/s' },
    { key: 'dedicated', label: 'Niewspółdzielone z uczestnikami wydarzenia', kind: 'bool' },
  ],
  space: [
    { key: 'width', label: 'Szerokość stanowiska', kind: 'number', suffix: 'm' },
    { key: 'depth', label: 'Głębokość stanowiska', kind: 'number', suffix: 'm' },
    { key: 'height', label: 'Wysokość w świetle', kind: 'number', suffix: 'm' },
    { key: 'level', label: 'Równe i stabilne podłoże', kind: 'bool' },
    { key: 'dry', label: 'Suche miejsce', kind: 'bool' },
    { key: 'covered', label: 'Zadaszenie / osłona od opadów', kind: 'bool' },
  ],
  access: [
    { key: 'vehicle', label: 'Pojazd', kind: 'choice', options: [{ value: '', label: 'Bez wskazania' }, { value: 'car', label: 'Samochód osobowy' }, { value: 'van', label: 'Samochód dostawczy (do 3,5 t)' }, { value: 'truck', label: 'Samochód ciężarowy' }] },
    { key: 'unloadDistance', label: 'Rozładunek najdalej od miejsca realizacji', kind: 'number', suffix: 'm' },
    { key: 'parking', label: 'Miejsca parkingowe dla ekipy', kind: 'number' },
    { key: 'lift', label: 'Wniesienie bez schodów lub windą towarową', kind: 'bool' },
  ],
  setup: [
    { key: 'before', label: 'Dostęp przed wydarzeniem', kind: 'number', suffix: 'godz.' },
    { key: 'after', label: 'Demontaż po wydarzeniu', kind: 'number', suffix: 'godz.' },
    { key: 'test', label: 'Próba techniczna przed wydarzeniem', kind: 'bool' },
    { key: 'teardown', label: 'Demontaż po wydarzeniu', kind: 'bool' },
  ],
  backstage: [
    { key: 'people', label: 'Osoby obsługi', kind: 'number' },
    { key: 'room', label: 'Zamykane zaplecze (garderoba)', kind: 'bool' },
    { key: 'water', label: 'Woda pitna', kind: 'bool' },
    { key: 'meal', label: 'Posiłek dla obsługi', kind: 'bool' },
  ],
};

/** Parametry startowe nowego wymagania. */
export const CONTRACT_REQUIREMENT_DEFAULTS: Record<ContractRequirementType, ContractRequirement> = {
  power: { type: 'power', phases: 1, current: 16 },
  internet: { type: 'internet', connection: 'wifi' },
  space: { type: 'space', level: true },
  access: { type: 'access', vehicle: 'van' },
  setup: { type: 'setup', before: 2, test: true },
  backstage: { type: 'backstage', room: true },
};

// MARK: Odczyt (z zapisu produktu, z formularza)

const positive = (value: unknown, max: number) => {
  const number = typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value);
  return Number.isFinite(number) && number > 0 && number <= max ? Math.round(number * 10) / 10 : undefined;
};
const flag = (value: unknown) => value === true || value === 'true' ? true : undefined;
const compact = <T extends Record<string, unknown>>(value: T) =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;

/** Sprawdzone wymaganie albo `null` (nieznany typ, brak parametrów). Liczby w rozsądnych granicach, bez dodatkowych pól. */
export function normalizeContractRequirement(input: unknown): ContractRequirement | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  switch (value.type) {
    case 'power': {
      const phases = Number(value.phases) === 3 ? 3 : Number(value.phases) === 1 ? 1 : null;
      if (!phases) return null;
      return compact<ContractPowerRequirement>({
        type: 'power', phases, current: positive(value.current, 1000), dedicated: flag(value.dedicated),
        sockets: positive(value.sockets, 100), distance: positive(value.distance, 1000),
      });
    }
    case 'internet': {
      const connection = value.connection === 'cable' ? 'cable' : value.connection === 'wifi' ? 'wifi' : null;
      if (!connection) return null;
      return compact<ContractInternetRequirement>({
        type: 'internet', connection, download: positive(value.download, 100000), upload: positive(value.upload, 100000),
        dedicated: flag(value.dedicated),
      });
    }
    case 'space': {
      const space = compact<ContractSpaceRequirement>({
        type: 'space', width: positive(value.width, 1000), depth: positive(value.depth, 1000), height: positive(value.height, 100),
        level: flag(value.level), dry: flag(value.dry), covered: flag(value.covered),
      });
      return Object.keys(space).length > 1 ? space : null;
    }
    case 'access': {
      const vehicle = ['car', 'van', 'truck'].includes(String(value.vehicle)) ? value.vehicle as 'car' | 'van' | 'truck' : undefined;
      const access = compact<ContractAccessRequirement>({
        type: 'access', vehicle, unloadDistance: positive(value.unloadDistance, 10000), lift: flag(value.lift),
        parking: positive(value.parking, 100),
      });
      return Object.keys(access).length > 1 ? access : null;
    }
    case 'setup':
      // Sam typ też ma treść: dostęp przed wydarzeniem w czasie umożliwiającym montaż.
      return compact<ContractSetupRequirement>({
        type: 'setup', before: positive(value.before, 96), test: flag(value.test), after: positive(value.after, 96),
        teardown: flag(value.teardown),
      });
    case 'backstage': {
      const backstage = compact<ContractBackstageRequirement>({
        type: 'backstage', room: flag(value.room), people: positive(value.people, 500), water: flag(value.water), meal: flag(value.meal),
      });
      return Object.keys(backstage).length > 1 ? backstage : null;
    }
    default:
      return null;
  }
}

// MARK: Łączenie wymagań z wielu usług

export type ContractRequirementSource = { requirement: ContractRequirement; source: string };

export type MergedContractRequirement = {
  type: ContractRequirementType;
  /** Jedno zdanie do umowy (HTML-bezpieczny tekst). */
  text: string;
  /** Usługi, których dotyczy zapis (w kolejności pojawienia się). */
  sources: string[];
  /** Zapisy pokryte przez mocniejsze — do podglądu „co zostało połączone”. */
  covered: Array<{ source: string; summary: string }>;
};

const unique = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];
const max = (values: Array<number | undefined>) => {
  const list = values.filter((value): value is number => typeof value === 'number');
  return list.length ? Math.max(...list) : undefined;
};
const min = (values: Array<number | undefined>) => {
  const list = values.filter((value): value is number => typeof value === 'number');
  return list.length ? Math.min(...list) : undefined;
};
const any = (values: Array<boolean | undefined>) => values.some(Boolean);
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const number = (value: number) => String(value).replace('.', ',');

const hours = (value: number) => {
  const whole = Number.isInteger(value);
  const form = !whole ? 'godziny' : value === 1 ? 'godzinę' : value % 10 >= 2 && value % 10 <= 4 && (value % 100 < 10 || value % 100 >= 20) ? 'godziny' : 'godzin';
  return `${number(value)} ${form}`;
};
const places = (value: number) =>
  `${number(value)} ${value === 1 ? 'miejsce parkingowe' : value % 10 >= 2 && value % 10 <= 4 && (value % 100 < 10 || value % 100 >= 20) ? 'miejsca parkingowe' : 'miejsc parkingowych'}`;
const circuits = (count: number) =>
  count === 1 ? 'osobny obwód' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20) ? `${count} osobne obwody` : `${count} osobnych obwodów`;
const people = (value: number) => `${number(value)} ${value === 1 ? 'osoby' : 'osób'}`;
const unused = (count: number) =>
  count === 1 ? 'niewykorzystywany' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20) ? 'niewykorzystywane' : 'niewykorzystywanych';

const powerName = (phases: 1 | 3, current?: number) =>
  `${phases === 3 ? '400 V' : '230 V'}${current ? ` / ${number(current)} A` : ''}`;
const powerStrength = (requirement: ContractPowerRequirement) => requirement.phases * 1000 + (requirement.current || 0);

/** Krótki opis parametrów (lista w produkcie, podgląd łączenia). */
export function summarizeContractRequirement(requirement: ContractRequirement): string {
  switch (requirement.type) {
    case 'power':
      return [powerName(requirement.phases, requirement.current), requirement.dedicated ? 'osobny obwód' : '',
        requirement.sockets ? `gniazda: ${requirement.sockets}` : '', requirement.distance ? `do ${number(requirement.distance)} m` : '']
        .filter(Boolean).join(', ');
    case 'internet':
      return [requirement.connection === 'cable' ? 'przewodowe' : 'Wi-Fi',
        requirement.download ? `${number(requirement.download)}${requirement.upload ? `/${number(requirement.upload)}` : ''} Mb/s` : '',
        requirement.dedicated ? 'niewspółdzielone' : ''].filter(Boolean).join(', ');
    case 'space':
      return [requirement.width && requirement.depth ? `${number(requirement.width)} × ${number(requirement.depth)} m` : '',
        requirement.height ? `wys. ${number(requirement.height)} m` : '', requirement.level ? 'równe podłoże' : '',
        requirement.dry ? 'suche' : '', requirement.covered ? 'zadaszone' : ''].filter(Boolean).join(', ');
    case 'access':
      return [requirement.vehicle ? { car: 'osobowy', van: 'dostawczy', truck: 'ciężarowy' }[requirement.vehicle] : '',
        requirement.unloadDistance ? `rozładunek do ${number(requirement.unloadDistance)} m` : '', requirement.lift ? 'winda / bez schodów' : '',
        requirement.parking ? `parking: ${number(requirement.parking)}` : ''].filter(Boolean).join(', ');
    case 'setup':
      return [requirement.before ? `${hours(requirement.before)} przed` : 'montaż przed', requirement.test ? 'próba' : '',
        requirement.after ? `${hours(requirement.after)} po` : requirement.teardown ? 'demontaż po' : ''].filter(Boolean).join(', ');
    case 'backstage':
      return [requirement.room ? 'zaplecze' : '', requirement.people ? `obsługa: ${number(requirement.people)}` : '',
        requirement.water ? 'woda' : '', requirement.meal ? 'posiłek' : ''].filter(Boolean).join(', ');
  }
}

const sourcesSuffix = (sources: string[]) => (sources.length ? ` (dotyczy: ${escape(sources.join(', '))})` : '');

function mergePower(list: Array<{ requirement: ContractPowerRequirement; source: string }>): Omit<MergedContractRequirement, 'type'> {
  const shared = list.filter((item) => !item.requirement.dedicated);
  const dedicated = list.filter((item) => item.requirement.dedicated);
  const parts: string[] = [];
  const covered: MergedContractRequirement['covered'] = [];
  if (shared.length) {
    const strongest = shared.reduce((best, item) => (powerStrength(item.requirement) > powerStrength(best.requirement) ? item : best));
    shared.filter((item) => item !== strongest && powerStrength(item.requirement) < powerStrength(strongest.requirement))
      .forEach((item) => covered.push({ source: item.source, summary: summarizeContractRequirement(item.requirement) }));
    const { phases, current } = strongest.requirement;
    const sockets = max(shared.map((item) => item.requirement.sockets));
    const distance = min(shared.map((item) => item.requirement.distance));
    parts.push(`${phases === 3 ? 'przyłącze trójfazowe' : 'przyłącze jednofazowe'} ${powerName(phases, current)}`
      + (sockets ? ` z co najmniej ${sockets} gniazdami 230 V` : '')
      + (distance ? ` w odległości nie większej niż ${number(distance)} m od stanowiska` : '')
      + sourcesSuffix(unique(shared.map((item) => item.source))));
  }
  const groups = new Map<string, Array<{ requirement: ContractPowerRequirement; source: string }>>();
  dedicated.forEach((item) => {
    const key = powerName(item.requirement.phases, item.requirement.current);
    groups.set(key, [...(groups.get(key) || []), item]);
  });
  [...groups.entries()]
    .sort((left, right) => powerStrength(right[1][0].requirement) - powerStrength(left[1][0].requirement))
    .forEach(([name, items]) => {
      parts.push(`${circuits(items.length)} ${name} ${unused(items.length)} przez inne urządzenia`
        + sourcesSuffix(unique(items.map((item) => item.source))));
    });
  return {
    text: `Zamawiający zapewni sprawne i stabilne zasilanie elektryczne: ${parts.join('; ')}.`,
    sources: unique(list.map((item) => item.source)),
    covered,
  };
}

function mergeInternet(list: Array<{ requirement: ContractInternetRequirement; source: string }>): Omit<MergedContractRequirement, 'type'> {
  const cable = list.some((item) => item.requirement.connection === 'cable');
  const download = max(list.map((item) => item.requirement.download));
  const upload = max(list.map((item) => item.requirement.upload));
  const dedicated = any(list.map((item) => item.requirement.dedicated));
  const covered = cable
    ? list.filter((item) => item.requirement.connection === 'wifi').map((item) => ({ source: item.source, summary: summarizeContractRequirement(item.requirement) }))
    : [];
  const speed = download
    ? ` o przepustowości co najmniej ${number(download)} Mb/s pobierania${upload ? ` i ${number(upload)} Mb/s wysyłania` : ''}`
    : upload ? ` o przepustowości wysyłania co najmniej ${number(upload)} Mb/s` : '';
  return {
    text: `Zamawiający zapewni stabilne łącze internetowe ${cable ? 'przewodowe (gniazdo Ethernet przy stanowisku)' : 'bezprzewodowe (Wi-Fi)'}`
      + `${speed}${dedicated ? ', niewspółdzielone z uczestnikami wydarzenia' : ''}${sourcesSuffix(unique(list.map((item) => item.source)))}.`,
    sources: unique(list.map((item) => item.source)),
    covered,
  };
}

function mergeSpace(list: Array<{ requirement: ContractSpaceRequirement; source: string }>): Omit<MergedContractRequirement, 'type'> {
  const features = [
    any(list.map((item) => item.requirement.level)) ? 'równe i stabilne podłoże' : '',
    any(list.map((item) => item.requirement.dry)) ? 'suche' : '',
    any(list.map((item) => item.requirement.covered)) ? 'zadaszone lub osłonięte od opadów' : '',
  ].filter(Boolean);
  const stations = list.filter((item) => item.requirement.width && item.requirement.depth)
    .map((item) => `${escape(item.source)} — ${number(item.requirement.width!)} × ${number(item.requirement.depth!)} m`);
  const height = max(list.map((item) => item.requirement.height));
  const parts = [
    features.length ? `bezpieczne miejsce realizacji: ${features.join(', ')}` : 'bezpieczne miejsce realizacji',
    stations.length ? `stanowiska o wymiarach co najmniej: ${stations.join('; ')}` : '',
    height ? `wysokość w świetle co najmniej ${number(height)} m` : '',
  ].filter(Boolean);
  const sources = unique(list.map((item) => item.source));
  return {
    text: `Zamawiający zapewni ${parts.join('; ')}${stations.length ? '' : sourcesSuffix(sources)}.`,
    sources,
    covered: [],
  };
}

const VEHICLE_ORDER = { car: 1, van: 2, truck: 3 } as const;
const VEHICLE_TEXT = {
  car: 'samochodem osobowym',
  van: 'samochodem dostawczym (do 3,5 t)',
  truck: 'samochodem ciężarowym',
} as const;

function mergeAccess(list: Array<{ requirement: ContractAccessRequirement; source: string }>): Omit<MergedContractRequirement, 'type'> {
  const vehicles = list.map((item) => item.requirement.vehicle).filter((vehicle): vehicle is 'car' | 'van' | 'truck' => Boolean(vehicle));
  const vehicle = vehicles.sort((left, right) => VEHICLE_ORDER[right] - VEHICLE_ORDER[left])[0];
  const distance = min(list.map((item) => item.requirement.unloadDistance));
  const lift = any(list.map((item) => item.requirement.lift));
  const parking = max(list.map((item) => item.requirement.parking));
  const parts = [
    `możliwość dojazdu${vehicle ? ` ${VEHICLE_TEXT[vehicle]}` : ''} do miejsca rozładunku`
      + (distance ? ` oddalonego nie więcej niż ${number(distance)} m od miejsca realizacji` : ''),
    lift ? 'wniesienie sprzętu bez schodów lub windą towarową' : '',
    parking ? `${places(parking)} dla ekipy Wykonawcy w czasie realizacji` : '',
  ].filter(Boolean);
  return {
    text: `Zamawiający zapewni ${parts.join(', ')}${sourcesSuffix(unique(list.map((item) => item.source)))}.`,
    sources: unique(list.map((item) => item.source)),
    covered: [],
  };
}

function mergeSetup(list: Array<{ requirement: ContractSetupRequirement; source: string }>): Omit<MergedContractRequirement, 'type'> {
  const before = max(list.map((item) => item.requirement.before));
  const after = max(list.map((item) => item.requirement.after));
  const test = any(list.map((item) => item.requirement.test));
  const teardown = any(list.map((item) => item.requirement.teardown));
  const work = `montaż${test ? ' i próbę techniczną' : ''}`;
  const parts = [
    before ? `co najmniej ${hours(before)} przed rozpoczęciem wydarzenia na ${work}` : `przed rozpoczęciem wydarzenia, w czasie umożliwiającym ${work}`,
    after ? `co najmniej ${hours(after)} po jego zakończeniu na demontaż` : teardown ? 'po jego zakończeniu, w czasie umożliwiającym demontaż' : '',
  ].filter(Boolean);
  return {
    text: `Zamawiający zapewni Wykonawcy dostęp do miejsca realizacji ${parts.join(' oraz ')}${sourcesSuffix(unique(list.map((item) => item.source)))}.`,
    sources: unique(list.map((item) => item.source)),
    covered: [],
  };
}

function mergeBackstage(list: Array<{ requirement: ContractBackstageRequirement; source: string }>): Omit<MergedContractRequirement, 'type'> {
  const total = list.reduce((sum, item) => sum + (item.requirement.people || 0), 0);
  const room = any(list.map((item) => item.requirement.room));
  const parts = [
    room ? `zamykane zaplecze (garderobę) dla ${total ? `${people(total)} ` : ''}obsługi` : total ? `miejsce odpoczynku dla ${people(total)} obsługi` : '',
    any(list.map((item) => item.requirement.water)) ? 'dostęp do wody pitnej' : '',
    any(list.map((item) => item.requirement.meal)) ? 'posiłek dla obsługi' : '',
  ].filter(Boolean);
  return {
    text: `Zamawiający zapewni ${parts.join(', ')}${sourcesSuffix(unique(list.map((item) => item.source)))}.`,
    sources: unique(list.map((item) => item.source)),
    covered: [],
  };
}

/** Jeden zapis na typ wymagania, w kolejności `CONTRACT_REQUIREMENT_TYPES`. */
export function mergeContractRequirements(input: ContractRequirementSource[]): MergedContractRequirement[] {
  const valid = input.flatMap((item) => {
    const requirement = normalizeContractRequirement(item.requirement);
    return requirement ? [{ requirement, source: String(item.source || '').trim() }] : [];
  });
  return CONTRACT_REQUIREMENT_TYPES.flatMap(({ type }) => {
    const list = valid.filter((item) => item.requirement.type === type);
    if (!list.length) return [];
    const merged = type === 'power' ? mergePower(list as Array<{ requirement: ContractPowerRequirement; source: string }>)
      : type === 'internet' ? mergeInternet(list as Array<{ requirement: ContractInternetRequirement; source: string }>)
      : type === 'space' ? mergeSpace(list as Array<{ requirement: ContractSpaceRequirement; source: string }>)
      : type === 'access' ? mergeAccess(list as Array<{ requirement: ContractAccessRequirement; source: string }>)
      : type === 'setup' ? mergeSetup(list as Array<{ requirement: ContractSetupRequirement; source: string }>)
      : mergeBackstage(list as Array<{ requirement: ContractBackstageRequirement; source: string }>);
    return [{ type, ...merged }];
  });
}

/**
 * Dwa wymagania tego samego typu jednej usługi w jedno (np. z kilku zdań starszego zapisu): mocniejsze parametry,
 * pola wyboru — jeśli zaznaczone w którymkolwiek.
 */
export function combineContractRequirements(left: ContractRequirement, right: ContractRequirement): ContractRequirement {
  if (left.type !== right.type) return left;
  const pick = (a: number | undefined, b: number | undefined, smaller = false) =>
    a === undefined ? b : b === undefined ? a : smaller ? Math.min(a, b) : Math.max(a, b);
  const either = (a?: boolean, b?: boolean) => (a || b ? true : undefined);
  const merged: Record<string, unknown> = { ...left, ...right };
  Object.keys(merged).forEach((key) => {
    const a = (left as Record<string, unknown>)[key];
    const b = (right as Record<string, unknown>)[key];
    if (typeof a === 'boolean' || typeof b === 'boolean') merged[key] = either(a as boolean, b as boolean);
    else if (typeof a === 'number' || typeof b === 'number') {
      merged[key] = pick(a as number | undefined, b as number | undefined, key === 'distance' || key === 'unloadDistance');
    }
  });
  if (left.type === 'internet' && right.type === 'internet') {
    merged.connection = left.connection === 'cable' || right.connection === 'cable' ? 'cable' : 'wifi';
  }
  if (left.type === 'access' && right.type === 'access') {
    const vehicles = [left.vehicle, right.vehicle].filter((vehicle): vehicle is 'car' | 'van' | 'truck' => Boolean(vehicle));
    merged.vehicle = vehicles.sort((a, b) => VEHICLE_ORDER[b] - VEHICLE_ORDER[a])[0];
  }
  return normalizeContractRequirement(merged) || left;
}

/** Zapis jednej usługi (np. treść wpisu w produkcie — także dla starszych wersji CRM, które nie znają parametrów). */
export const contractRequirementText = (requirement: ContractRequirement) =>
  mergeContractRequirements([{ requirement, source: '' }])[0]?.text || '';

// MARK: Rozpoznanie parametrów w starszych zapisach (propozycje dla „Porządkowania klauzul”)

const plain = (value: string) => value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ').trim();
const fold = (value: string) => plain(value).toLocaleLowerCase('pl-PL').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
const firstNumber = (text: string, pattern: RegExp) => {
  const match = pattern.exec(text);
  return match ? Number(match[1].replace(',', '.')) : undefined;
};

/**
 * Propozycje parametrów rozpoznane w tekście zapisu (bez pewności — do zatwierdzenia przez człowieka). Zwraca tylko
 * wymagania z konkretną treścią; ogólniki („sprawne zasilanie”) dają typ bez liczb.
 */
export function suggestContractRequirements(text: string): ContractRequirement[] {
  const value = fold(text);
  const result: ContractRequirement[] = [];
  if (/zasilan|230\s*v|400\s*v|gniazd|trojfaz|sila|obwod/.test(value)) {
    const three = /400\s*v|trojfaz|3\s*faz|\bsila\b|\bsilow/.test(value);
    const current = firstNumber(value, /(\d{2,3})\s*a\b/);
    const requirement = normalizeContractRequirement({
      type: 'power', phases: three ? 3 : 1, current, dedicated: /osobn\w* obwod|dedykowan\w* obwod|niezalezn\w* obwod/.test(value),
      sockets: firstNumber(value, /(\d{1,2})\s*gniazd/), distance: firstNumber(value, /(\d{1,3})\s*m\b[^.]{0,40}(?:stanowisk|miejsc)/),
    });
    if (requirement) result.push(requirement);
  }
  if (/internet|wi\s*-?\s*fi|ethernet|\blacze\b/.test(value)) {
    const requirement = normalizeContractRequirement({
      type: 'internet', connection: /ethernet|przewod|kablow|rj\s*45/.test(value) ? 'cable' : 'wifi',
      download: firstNumber(value, /(\d{1,5})\s*(?:mb\/s|mbps|mbit)/), dedicated: /niewspoldziel|dedykowan|wylaczn/.test(value),
    });
    if (requirement) result.push(requirement);
  }
  if (/rown\w* podloz|stabiln\w* podloz|sucho|suche|zadaszen|oslonie\w* od opad|\d+\s*[x×]\s*\d+\s*m/.test(value)) {
    const size = /(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*m/.exec(value);
    const requirement = normalizeContractRequirement({
      type: 'space', width: size?.[1], depth: size?.[2], height: firstNumber(value, /wysokos\w*[^;]{0,30}?(\d+(?:[.,]\d+)?)\s*m\b/),
      level: /rown\w* (?:i stabiln\w* )?podloz|stabiln\w* podloz/.test(value), dry: /sucho|suche/.test(value),
      covered: /zadaszen|oslonie\w* od opad/.test(value),
    });
    if (requirement) result.push(requirement);
  }
  if (/dojazd|rozladun|wniesien|winda|parking/.test(value)) {
    const requirement = normalizeContractRequirement({
      type: 'access', vehicle: /ciezar/.test(value) ? 'truck' : /dostawcz|\bbus/.test(value) ? 'van' : undefined,
      unloadDistance: firstNumber(value, /rozladun\w*[^.]{0,40}?(\d{1,4})\s*m\b/), lift: /winda|bez schod/.test(value),
      parking: firstNumber(value, /(\d{1,2})\s*miejsc\w* parking/),
    });
    if (requirement) result.push(requirement);
  }
  if (/montaz|prob\w* techniczn|test\w*|demontaz/.test(value)) {
    const requirement = normalizeContractRequirement({
      type: 'setup', before: firstNumber(value, /(\d{1,2}(?:[.,]\d)?)\s*(?:godz|h\b)\w*[^;]{0,30}?przed/),
      test: /prob\w*|test\w*/.test(value), after: firstNumber(value, /(\d{1,2}(?:[.,]\d)?)\s*(?:godz|h\b)\w*[^;]{0,30}?po (?:zakonczen|wydarzen)/),
    });
    if (requirement) result.push(requirement);
  }
  return result;
}
