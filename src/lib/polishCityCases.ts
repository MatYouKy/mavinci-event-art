export type PolishCityCases = {
  nominative: string; // Mianownik
  genitive: string;   // Dopełniacz (kogo? czego?)
  locative: string;   // Miejscownik (w kim? w czym?)
};

type PartCases = { genitive: string; locative: string };

const VOWELS = /[aeiouyąęó]/i;

// Minimalny zestaw wyjątków – tylko te, które często psują reguły
const EXCEPTIONS: Record<string, PolishCityCases> = {
  'Łódź': { nominative: 'Łódź', genitive: 'Łodzi', locative: 'Łodzi' },
  'Gdańsk': { nominative: 'Gdańsk', genitive: 'Gdańska', locative: 'Gdańsku' },
  'Kraków': { nominative: 'Kraków', genitive: 'Krakowa', locative: 'Krakowie' },
  'Wrocław': { nominative: 'Wrocław', genitive: 'Wrocławia', locative: 'Wrocławiu' },
  'Poznań': { nominative: 'Poznań', genitive: 'Poznania', locative: 'Poznaniu' },
  'Toruń': { nominative: 'Toruń', genitive: 'Torunia', locative: 'Toruniu' },
  'Szczecin': { nominative: 'Szczecin', genitive: 'Szczecina', locative: 'Szczecinie' }, // -in ma zwykle -ie
  'Lublin': { nominative: 'Lublin', genitive: 'Lublina', locative: 'Lublinie' },         // -in ma zwykle -ie
};

function isUppercaseWord(w: string) {
  return w.length > 0 && w[0] === w[0].toUpperCase();
}

/**
 * Odmienia jeden wyraz (najczęściej ostatni człon nazwy miasta).
 * Zwraca dopełniacz i miejscownik.
 */
function inflectSingle(word: string): PartCases {
  const w = word.trim();
  if (!w) return { genitive: w, locative: w };

  // słowa z dywizem odmieniają zwykle tylko ostatni segment
  if (w.includes('-')) {
    const parts = w.split('-');
    const last = parts.pop()!;
    const inf = inflectSingle(last);
    return {
      genitive: [...parts, inf.genitive].join('-'),
      locative: [...parts, inf.locative].join('-'),
    };
  }

  const lower = w.toLowerCase();

  // końcówki -ów: Kraków -> Krakowa / Krakowie
  if (lower.endsWith('ów')) {
    return {
      genitive: w + 'a',
      locative: w.slice(0, -2) + 'owie',
    };
  }

  // -in / -yn / -lin / -cin: często miejscownik na -ie
  // Szczecin -> Szczecinie, Lublin -> Lublinie, Koszalin -> Koszalinie
  if (/(in|yn|lin|cin)$/.test(lower)) {
    return {
      genitive: w + 'a',
      locative: w + 'ie',
    };
  }

  // -ice: Katowice -> Katowic / Katowicach (tu bywa liczba mnoga)
  // uprość: genitive bez "e", locative "ach"
  if (lower.endsWith('ice')) {
    const base = w.slice(0, -1); // Katowic(e) -> Katowic
    return {
      genitive: base,
      locative: base + 'ach',
    };
  }

  // -y / -i (często liczba mnoga): Tychy -> Tychów / Tychach
  if (lower.endsWith('y') || lower.endsWith('i')) {
    const base = w.slice(0, -1);
    return {
      genitive: base + 'ów',
      locative: base + 'ach',
    };
  }

  // końcówka -a: Warszawa -> Warszawy / Warszawie
  // uwaga: po spółgłosce twardej zwykle "-y", po miękkiej "-i"
  if (lower.endsWith('a')) {
    const base = w.slice(0, -1);
    const last = base[base.length - 1]?.toLowerCase() ?? '';
    const gen = /[kg]$/.test(last) ? base + 'i' : base + 'y'; // Krakowa to wyjątek, ale mamy w EXCEPTIONS
    return {
      genitive: gen,
      locative: base + 'ie',
    };
  }

  // końcówka -o / -e: Zamość nie, ale np. "Sokołowo" -> "Sokołowa" / "Sokołowie"
  if (lower.endsWith('o') || lower.endsWith('e')) {
    const base = w.slice(0, -1);
    return {
      genitive: base + 'a',
      locative: base + 'ie',
    };
  }

  // końcówka -ść / -dź / -ź / -ż: często gen/loc na -i (Łódź wyjątek już jest)
  if (/(ść|dź|ź|ż)$/.test(lower)) {
    return {
      genitive: w + 'i',
      locative: w + 'i',
    };
  }

  // domyślnie: spółgłoska na końcu → +a / +u (Toruń wyjątek, ale i tak +a/+u pasuje)
  // ale dla wielu miast lepsze locative -ie (Szczecin) już obsłużone wyżej
  if (!VOWELS.test(w[w.length - 1])) {
    return {
      genitive: w + 'a',
      locative: w + 'u',
    };
  }

  // fallback
  return { genitive: w, locative: w };
}

/**
 * Obsługuje miasta wielowyrazowe:
 * - Odmienia ostatni człon
 * - Jeśli zaczyna się od "Nowy/Nowa/Nowe" to odmienia też przymiotnik
 */
export function getPolishCityCasesSmart(cityName: string): PolishCityCases {
  const name = cityName.trim();

  // 1) wyjątki pełne
  if (EXCEPTIONS[name]) return EXCEPTIONS[name];

  // 2) rozbij na słowa (zostawiając wielkie litery)
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return { nominative: '', genitive: '', locative: '' };
  }

  // 3) odmiana ostatniego członu
  const last = words[words.length - 1];
  const lastInf = inflectSingle(last);

  // 4) specjalny wzorzec: "Nowy/Nowa/Nowe X"
  if (words.length >= 2) {
    const first = words[0];
    const firstLower = first.toLowerCase();

    if (firstLower === 'nowy' || firstLower === 'nowa' || firstLower === 'nowe') {
      // dopełniacz: Nowego/Nowej/Nowego
      const firstGen =
        firstLower === 'nowy' ? 'Nowego' :
        firstLower === 'nowa' ? 'Nowej' :
        'Nowego';

      // miejscownik: Nowym/Nowej/Nowym
      const firstLoc =
        firstLower === 'nowy' ? 'Nowym' :
        firstLower === 'nowa' ? 'Nowej' :
        'Nowym';

      const rest = words.slice(1, -1); // środkowe człony bez ostatniego
      const gen = [firstGen, ...rest, lastInf.genitive].join(' ');
      const loc = [firstLoc, ...rest, lastInf.locative].join(' ');

      return { nominative: name, genitive: gen, locative: loc };
    }
  }

  // 5) standard: tylko ostatni wyraz odmieniony
  const base = words.slice(0, -1);
  const genitive = [...base, lastInf.genitive].join(' ');
  const locative = [...base, lastInf.locative].join(' ');

  return { nominative: name, genitive, locative };
}