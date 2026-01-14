export type PolishCityCases = {
  nominative: string; // Mianownik
  genitive: string; // Dopełniacz (kogo? czego?)
  locative: string; // Miejscownik (w kim? w czym?)
};

function capitalizeWord(word: string): string {
  if (!word) return word;
  return word[0].toUpperCase() + word.slice(1);
}

function capitalizePhrase(phrase: string): string {
  return phrase
    .split(' ')
    .map((w) => (isUppercaseWord(w) ? w : capitalizeWord(w)))
    .join(' ');
}

type PartCases = { genitive: string; locative: string };

const VOWELS = /[aeiouyąęó]/i;

// Minimalny zestaw wyjątków – tylko te, które często psują reguły
const EXCEPTIONS: Record<string, PolishCityCases> = {
  łódź: { nominative: 'Łódź', genitive: 'Łodzi', locative: 'Łodzi' },
  gdańsk: { nominative: 'Gdańsk', genitive: 'Gdańska', locative: 'Gdańsku' },
  kraków: { nominative: 'Kraków', genitive: 'Krakowa', locative: 'Krakowie' },
  wrocław: { nominative: 'Wrocław', genitive: 'Wrocławia', locative: 'Wrocławiu' },
  poznań: { nominative: 'Poznań', genitive: 'Poznania', locative: 'Poznaniu' },
  toruń: { nominative: 'Toruń', genitive: 'Torunia', locative: 'Toruniu' },
  szczecin: { nominative: 'Szczecin', genitive: 'Szczecina', locative: 'Szczecinie' },
  lublin: { nominative: 'Lublin', genitive: 'Lublina', locative: 'Lublinie' },
  bydgoszcz: { nominative: 'Bydgoszcz', genitive: 'Bydgoszczy', locative: 'Bydgoszczy' },
  brodnica: { nominative: 'Brodnica', genitive: 'Brodnicy', locative: 'Brodnicy' },
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
  const raw = cityName.trim();
  const key = raw.toLowerCase();

  // 1) wyjątki pełne (case-insensitive)
  if (EXCEPTIONS[key]) return EXCEPTIONS[key];

  // dalej bez zmian...
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length === 0) return { nominative: '', genitive: '', locative: '' };

  const last = words[words.length - 1];
  const lastInf = inflectSingle(last);

  let result: PolishCityCases;
  if (words.length >= 2) {
    const first = words[0].toLowerCase();
    if (first === 'nowy' || first === 'nowa' || first === 'nowe') {
      const firstGen = first === 'nowy' ? 'Nowego' : first === 'nowa' ? 'Nowej' : 'Nowego';
      const firstLoc = first === 'nowy' ? 'Nowym'  : first === 'nowa' ? 'Nowej' : 'Nowym';
      const rest = words.slice(1, -1);
      result = {
        nominative: raw,
        genitive: [firstGen, ...rest, lastInf.genitive].join(' '),
        locative: [firstLoc, ...rest, lastInf.locative].join(' '),
      };
    } else {
      result = {
        nominative: raw,
        genitive: [...words.slice(0, -1), lastInf.genitive].join(' '),
        locative: [...words.slice(0, -1), lastInf.locative].join(' '),
      };
    }
  } else {
    result = { nominative: raw, genitive: lastInf.genitive, locative: lastInf.locative };
  }

  return {
    nominative: capitalizePhrase(result.nominative),
    genitive: capitalizePhrase(result.genitive),
    locative: capitalizePhrase(result.locative),
  };
}
