/*
 * Porządkowanie klauzul produktów (jednorazowo, z zatwierdzeniem w CRM: /crm/contract-templates/porzadkowanie-klauzul).
 * Zapisy produktów powtarzały te same treści innymi słowami („sprawne zasilanie”, „stabilne zasilanie 230 V”, „bezpieczne,
 * suche stanowisko”, „w terminie dostarczenia materiałów określonym w umowie”…). Porządkowanie działa na zdaniach:
 * - zdanie ogólne → wymaganie z parametrami (zasilanie, montaż…) albo wspólna zasada z biblioteki (drukowana w umowie raz);
 * - zdanie z ogólną częścią i szczegółem usługi → przeredagowane tak, by zostało tylko to, co szczególne;
 * - pozostałe zdania bez zmian (wpis z formatowaniem, listą lub kilkoma akapitami nie jest ruszany).
 * Reguły pochodzą z analizy zapisów w produkcji (listopad 2026); nowe zapisy wybierają parametry i wspólne zasady w edytorze.
 */

import { getSharedContractClause } from './sharedContractClauses';
import type { ContractClauseEntry } from './contractClauseContent';
import {
  combineContractRequirements,
  contractRequirementCategory,
  contractRequirementLabel,
  contractRequirementText,
  contractRequirementTopic,
  normalizeContractRequirement,
  summarizeContractRequirement,
  type ContractRequirement,
} from './contractRequirements';

type SentenceRule = {
  /** Wszystkie fragmenty muszą wystąpić w zdaniu (małe litery, pojedyncze spacje). */
  has: string[];
  requirements?: ContractRequirement[];
  shared?: string[];
  /** Nowe brzmienie zdania (tylko szczegół usługi); brak — zdanie znika. */
  replace?: string;
};

const POWER: ContractRequirement = { type: 'power', phases: 1 };
const SETUP: ContractRequirement = { type: 'setup' };
const SETUP_TEST: ContractRequirement = { type: 'setup', test: true };

const SENTENCE_RULES: SentenceRule[] = [
  // Wymagania techniczne
  { has: ['bezpieczne, suche stanowisko pracy, sprawne zasilanie oraz dostęp do miejsca realizacji'], requirements: [POWER, SETUP_TEST], shared: ['safe_placement'] },
  { has: ['stabilne zasilanie, bezpieczną przestrzeń montażową oraz dostęp techniczny'], requirements: [POWER, SETUP_TEST], shared: ['safe_placement'] },
  { has: ['sprawną instalację elektryczną, dostęp techniczny oraz bezpieczne miejsca ustawienia urządzeń'], requirements: [POWER], shared: ['safe_placement'] },
  {
    has: ['montaż, konfigurację i próbę dźwięku przed rozpoczęciem wydarzenia oraz przekazuje ograniczenia dotyczące poziomu głośności'],
    requirements: [SETUP_TEST],
    replace: 'Zamawiający przekaże Wykonawcy ograniczenia dotyczące poziomu głośności obowiązujące w miejscu realizacji.',
  },
  {
    has: ['w czasie umożliwiającym montaż i demontaż oraz uzyskuje zgodę obiektu na uzgodnione sposoby mocowania dekoracji'],
    requirements: [{ type: 'setup', teardown: true }],
    replace: 'Zamawiający uzyska zgodę obiektu na uzgodnione sposoby mocowania dekoracji.',
  },
  { has: ['bezpieczne, suche miejsce realizacji, swobodny dostęp techniczny i możliwość przygotowania stanowiska'], requirements: [SETUP], shared: ['safe_placement'] },
  { has: ['jeżeli usługa wymaga zasilania, zamawiający zapewnia sprawne gniazdo 230 v'], requirements: [POWER] },
  { has: ['sprawne zasilanie, dostęp techniczny oraz czas niezbędny do montażu, ustawienia, programowania i testu oświetlenia'], requirements: [POWER, SETUP_TEST] },
  {
    has: ['dostęp do sprawnego stanowiska, urządzeń objętych zakresem oraz czas na konfigurację i próbę'],
    requirements: [SETUP_TEST],
    replace: 'Zamawiający zapewni realizatorowi dostęp do sprawnego stanowiska i urządzeń objętych zakresem.',
  },
  {
    has: ['równe, stabilne i nośne podłoże, odpowiednią przestrzeń oraz dostęp techniczny umożliwiający transport, montaż i demontaż'],
    requirements: [{ type: 'setup', teardown: true }],
    shared: ['safe_placement'],
    replace: 'Podłoże w miejscu ustawienia konstrukcji musi mieć nośność odpowiednią do jej obciążenia.',
  },
  {
    has: ['równe, stabilne i uprzątnięte podłoże, sprawne zasilanie oraz przestrzeń umożliwiającą prawidłowe zakotwienie'],
    requirements: [POWER],
    shared: ['safe_placement'],
    replace: 'Zamawiający zapewni przestrzeń umożliwiającą prawidłowe zakotwienie urządzenia i wyznaczenie strefy bezpieczeństwa.',
  },
  { has: ['stanowisko artystów i urządzeń wymaga stabilnego zadaszenia'], requirements: [{ type: 'space', covered: true }] },
  { has: ['bezpieczne, stabilne i suche miejsce występu'], requirements: [SETUP_TEST], shared: ['safe_placement'] },
  {
    has: ['możliwość zamknięcia drzwi i okien, równą i suchą powierzchnię oraz bezpieczne źródło zasilania 230 v / 16 a'],
    requirements: [{ type: 'power', phases: 1, current: 16 }],
    shared: ['safe_placement'],
    replace: 'Zamawiający zapewni możliwość zamknięcia drzwi i okien w strefie realizacji.',
  },
  {
    has: ['równą, stabilną i suchą powierzchnię o wymiarach umożliwiających bezpieczne ustawienie fotoboxu magazine'],
    shared: ['safe_placement'],
    replace: 'Miejsce ustawienia musi umożliwiać bezpieczne ustawienie Fotoboxu Magazine, swobodne wejście uczestników oraz wykonywanie zdjęć.',
  },
  // Zasilanie
  {
    has: ['stanowisko realizatora powinno zapewniać widoczność sceny i ekranów, dostęp do zasilania'],
    requirements: [POWER],
    replace: 'Stanowisko realizatora powinno zapewniać widoczność sceny i ekranów oraz możliwość komunikacji z osobą prowadzącą i obsługą wydarzenia.',
  },
  {
    has: ['stabilne zasilanie 230 v, odpowiednią powierzchnię projekcyjną oraz bezpieczne miejsce montażu urządzenia'],
    requirements: [POWER],
    replace: 'Zamawiający zapewni odpowiednią powierzchnię projekcyjną oraz bezpieczne miejsce montażu urządzenia.',
  },
  { has: ['stabilne zasilanie 230 v w pobliżu miejsca ustawienia, równe i suche podłoże wewnątrz obiektu'], requirements: [POWER, { type: 'setup', teardown: true }], shared: ['safe_placement'] },
  { has: ['miejsca poboru energii powinny być dostępne, zabezpieczone i wolne od urządzeń mogących powodować przeciążenia'], requirements: [{ type: 'power', phases: 1, dedicated: true }] },
  {
    has: ['sprawne gniazdo 230 v, równą i suchą powierzchnię wewnątrz obiektu oraz bezpieczną drogę transportową'],
    requirements: [POWER],
    shared: ['safe_placement'],
    replace: 'Zamawiający zapewni bezpieczną drogę transportową umożliwiającą wniesienie telewizora 85″ wraz ze skrzynią i statywem.',
  },
  // Dostęp i montaż
  { has: ['dostęp do sali, stanowiska realizacyjnego i wykorzystywanych systemów minimum 60 minut przed rozpoczęciem'], requirements: [{ type: 'setup', before: 1, test: true }] },
  {
    has: ['w czasie umożliwiającym wniesienie, montaż, konfigurację, próbę dźwięku i demontaż oraz wskaże bezpieczne miejsca ustawienia'],
    requirements: [{ type: 'setup', test: true, teardown: true }],
    replace: 'Zamawiający wskaże bezpieczne miejsca ustawienia kolumn, statywów, urządzeń sterujących i okablowania.',
  },
  // Ryzyka zawarte we wspólnych zasadach
  { has: ['nie odpowiada za błędy materiałów dostarczonych przez zamawiającego, awarie zasilania lub sieci obiektu'], shared: ['external_failures', 'materials_invalid'] },
  { has: ['nie odpowiada za przerwy w emisji spowodowane awarią zasilania lub sieci obiektu'], shared: ['external_failures', 'materials_invalid'] },
  { has: ['nie odpowiada za przerwy lub pogorszenie jakości prezentacji wynikające z awarii instalacji elektrycznej obiektu'], shared: ['external_failures', 'materials_invalid'] },
  { has: ['w miarę możliwości wejścia mogą zostać przesunięte w ramach ustalonego czasu realizacji'], shared: ['program_delay'] },
  { has: ['zmiany po akceptacji zakresu wymagają odrębnego uzgodnienia'], shared: ['scope_changes'] },
  { has: ['zmiany po akceptacji projektu mogą wpłynąć na cenę i termin realizacji'], shared: ['scope_changes'] },
  // Obowiązki zawarte we wspólnych zasadach
  { has: ['przekazuje kompletne materiały w uzgodnionych formatach, proporcjach i rozdzielczości oraz posiada prawa do ich wykorzystania'], shared: ['material_formats', 'material_rights', 'materials_deadline'] },
  { has: ['przekazuje kompletne materiały do emisji w uzgodnionej rozdzielczości, proporcjach i formacie'], shared: ['material_formats', 'materials_deadline'] },
  {
    has: ['przekazuje liczbę uczestników, harmonogram, informacje o ograniczeniach zdrowotnych lub organizacyjnych oraz wskazuje jedną osobę decyzyjną'],
    shared: ['decision_maker', 'materials_deadline'],
    replace: 'Zamawiający przekaże liczbę uczestników, harmonogram oraz informacje o ograniczeniach zdrowotnych lub organizacyjnych uczestników.',
  },
  {
    has: ['przekazuje aktualny harmonogram, kluczowe punkty programu, preferencje muzyczne', 'osoby decyzyjnej'],
    shared: ['decision_maker', 'materials_deadline'],
    replace: 'Zamawiający przekaże aktualny harmonogram, kluczowe punkty programu i preferencje muzyczne.',
  },
  {
    has: ['przekazuje harmonogram, kluczowe momenty i wymagane materiały w uzgodnionym terminie oraz zapewnia wymagane prawem zgody uczestników'],
    shared: ['materials_deadline'],
    replace: 'Zamawiający przekaże harmonogram i kluczowe momenty wydarzenia oraz zapewni wymagane prawem zgody uczestników.',
  },
];

/** Zakres usługi „wynika z zaakceptowanej oferty” — jedna wspólna zasada zamiast zdania przy każdej usłudze. */
const OFFER_SCOPE = /(?:wynikają|wynika) z zaakceptowanej oferty(?: lub zamówienia)?\.?$|(?:określa|określają) zaakceptowana oferta(?: (?:oraz|i) potwierdzony harmonogram(?: wydarzenia)?)?\.?$/u;

/** Fragmenty zdań, które powtarzają wspólną zasadę — usuwane ze zdania (zasada trafia do produktu). */
const PHRASE_RULES: Array<{ pattern: RegExp; shared: string }> = [
  { pattern: /,?\s+w terminie dostarczenia materiałów określonym w umowie/giu, shared: 'materials_deadline' },
  { pattern: /^najpóźniej w terminie uzgodnionym przez strony\s+/iu, shared: 'materials_deadline' },
];

export type ClauseCleanupChange = { kind: 'requirement' | 'shared' | 'removed' | 'rewritten' | 'duplicate'; text: string };
export type ClauseCleanupResult = {
  entries: ContractClauseEntry[];
  changes: ClauseCleanupChange[];
  /** Wpisy pominięte (formatowanie, listy) — do ręcznego przejrzenia. */
  skipped: string[];
};

const decode = (value: string) => value
  .replace(/&nbsp;|&#160;/gi, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const plainText = (html: string) => decode(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const key = (sentence: string) => sentence.toLocaleLowerCase('pl-PL').replace(/\s+/g, ' ').trim();
const sentences = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-ZĄĆĘŁŃÓŚŹŻ„"])/u).map((part) => part.trim()).filter(Boolean);
/** Tylko proste akapity — wpisy z listami, pogrubieniem albo kilkoma akapitami zostają bez zmian. */
const simpleParagraph = (html: string) => {
  const tags = html.match(/<\/?([a-z0-9]+)[^>]*>/gi) || [];
  const names = tags.map((tag) => tag.replace(/^<\/?([a-z0-9]+).*$/is, '$1').toLowerCase());
  return names.every((name) => ['p', 'br', 'span'].includes(name)) && names.filter((name) => name === 'p').length <= 2;
};
const capitalize = (value: string) => value.charAt(0).toLocaleUpperCase('pl-PL') + value.slice(1);
const short = (value: string) => (value.length > 140 ? `${value.slice(0, 137)}…` : value);

/** Propozycja uporządkowanych wpisów jednego produktu (bez zapisu). */
export function proposeContractClauseCleanup(input: ContractClauseEntry[]): ClauseCleanupResult {
  const changes: ClauseCleanupChange[] = [];
  const skipped: string[] = [];
  const requirements = new Map<string, ContractRequirement>();
  const sharedWanted: string[] = [];
  const presentShared = new Set(input.map((entry) => entry.sharedKey).filter((value): value is string => Boolean(value)));
  input.forEach((entry) => {
    if (!entry.requirement) return;
    const current = requirements.get(entry.requirement.type);
    requirements.set(entry.requirement.type, current ? combineContractRequirements(current, entry.requirement) : entry.requirement);
  });
  const hadRequirement = new Set(requirements.keys());
  const addRequirement = (requirement: ContractRequirement) => {
    const normalized = normalizeContractRequirement(requirement);
    if (!normalized) return;
    const current = requirements.get(normalized.type);
    requirements.set(normalized.type, current ? combineContractRequirements(current, normalized) : normalized);
  };
  const addShared = (keys: string[] = []) => keys.forEach((sharedKey) => {
    if (getSharedContractClause(sharedKey) && !presentShared.has(sharedKey) && !sharedWanted.includes(sharedKey)) sharedWanted.push(sharedKey);
  });
  const seenSentences = new Set<string>();

  const output: ContractClauseEntry[] = input.flatMap((entry) => {
    if (entry.sharedKey || entry.requirement) return [entry];
    if (!simpleParagraph(entry.content)) {
      skipped.push(entry.title || 'wpis');
      return [entry];
    }
    let changed = false;
    const kept: string[] = [];
    sentences(plainText(entry.content)).forEach((original) => {
      let sentence = original;
      PHRASE_RULES.forEach((rule) => {
        if (!rule.pattern.test(sentence)) return;
        rule.pattern.lastIndex = 0;
        sentence = capitalize(sentence.replace(rule.pattern, '').replace(/\s+([,.])/g, '$1').trim());
        addShared([rule.shared]);
      });
      const normalized = key(sentence);
      if (seenSentences.has(normalized)) {
        changes.push({ kind: 'duplicate', text: `Usunięto powtórzone zdanie: „${short(original)}”` });
        changed = true;
        return;
      }
      seenSentences.add(normalized);
      const rule = SENTENCE_RULES.find((candidate) => candidate.has.every((fragment) => normalized.includes(fragment)));
      if (rule) {
        rule.requirements?.forEach(addRequirement);
        addShared(rule.shared);
        if (rule.replace) {
          kept.push(rule.replace);
          changes.push({ kind: 'rewritten', text: `„${short(original)}” → „${short(rule.replace)}”` });
        } else {
          changes.push({ kind: 'removed', text: `Zastąpione wymaganiem lub wspólną zasadą: „${short(original)}”` });
        }
        changed = true;
        return;
      }
      if (OFFER_SCOPE.test(normalized)) {
        addShared(['offer_scope']);
        changes.push({ kind: 'removed', text: `Zastąpione zasadą „Zakres usług z oferty”: „${short(original)}”` });
        changed = true;
        return;
      }
      if (sentence !== original) {
        changes.push({ kind: 'rewritten', text: `„${short(original)}” → „${short(sentence)}”` });
        changed = true;
      }
      kept.push(sentence);
    });
    if (!changed) return [entry];
    if (!kept.length) return [];
    return [{ ...entry, content: `<p>${escape(kept.join(' '))}</p>` }];
  });

  // Wymagania z parametrami: jeden wpis na typ (istniejące uzupełnione o nowe parametry).
  const withRequirements = output.filter((entry) => !entry.requirement);
  const requirementEntries: ContractClauseEntry[] = [...requirements.values()].map((requirement) => {
    const existing = output.find((entry) => entry.requirement?.type === requirement.type);
    if (!hadRequirement.has(requirement.type)) {
      changes.push({ kind: 'requirement', text: `Wymaganie z parametrami: ${contractRequirementLabel(requirement.type)} — ${summarizeContractRequirement(requirement)}` });
    }
    return {
      id: existing?.id || `req-${requirement.type}`,
      category: contractRequirementCategory(requirement.type),
      topic: contractRequirementTopic(requirement.type),
      title: existing?.title || contractRequirementLabel(requirement.type),
      content: contractRequirementText(requirement),
      requirement,
    };
  });
  const sharedEntries: ContractClauseEntry[] = sharedWanted.map((sharedKey) => {
    const shared = getSharedContractClause(sharedKey)!;
    changes.push({ kind: 'shared', text: `Wspólna zasada: ${shared.title}` });
    return { id: `shared-${shared.key}`, category: shared.category, topic: shared.topic, title: shared.title, content: shared.content, sharedKey: shared.key };
  });
  const usedIds = new Set<string>();
  const entries = [...requirementEntries, ...withRequirements, ...sharedEntries].map((entry) => {
    let id = entry.id;
    for (let index = 2; usedIds.has(id); index += 1) id = `${entry.id}-${index}`;
    usedIds.add(id);
    return id === entry.id ? entry : { ...entry, id };
  });
  return { entries, changes, skipped };
}
