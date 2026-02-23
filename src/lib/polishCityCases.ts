export type PolishCityCases = {
  nominative: string; // Mianownik
  genitive: string; // Dopełniacz (kogo? czego?)
  locative: string; // Miejscownik (w kim? w czym?)
};

type PartCases = { genitive: string; locative: string };

const VOWELS = /[aeiouyąęó]/i;

function isUppercaseWord(w: string) {
  return w.length > 0 && w[0] === w[0].toUpperCase();
}

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

// Minimalny zestaw wyjątków – tylko te, które faktycznie łamią reguły
// (tu warto trzymać “dziwne” przypadki historyczne / zwyczajowe)
const EXCEPTIONS: Record<string, PolishCityCases> = {
  // klasyczne nieregularne
  'łódź': { nominative: 'Łódź', genitive: 'Łodzi', locative: 'Łodzi' },
  'bydgoszcz': { nominative: 'Bydgoszcz', genitive: 'Bydgoszczy', locative: 'Bydgoszczy' },
  'zamość': { nominative: 'Zamość', genitive: 'Zamościa', locative: 'Zamościu' },

  // -sk (nie wszystkie są regularne w loc)
  'gdańsk': { nominative: 'Gdańsk', genitive: 'Gdańska', locative: 'Gdańsku' },
  'olsztyn': { nominative: 'Olsztyn', genitive: 'Olsztyna', locative: 'Olsztynie' },

  // -ów (loc -owie)
  'kraków': { nominative: 'Kraków', genitive: 'Krakowa', locative: 'Krakowie' },
  'tarnów': { nominative: 'Tarnów', genitive: 'Tarnowa', locative: 'Tarnowie' },

  // -ław / -ławia
  'wrocław': { nominative: 'Wrocław', genitive: 'Wrocławia', locative: 'Wrocławiu' },

  // -nań
  'poznań': { nominative: 'Poznań', genitive: 'Poznania', locative: 'Poznaniu' },

  // -ruń
  'toruń': { nominative: 'Toruń', genitive: 'Torunia', locative: 'Toruniu' },

  // -cin / -lin / -in
  'szczecin': { nominative: 'Szczecin', genitive: 'Szczecina', locative: 'Szczecinie' },
  'lublin': { nominative: 'Lublin', genitive: 'Lublina', locative: 'Lublinie' },
  'koszalin': { nominative: 'Koszalin', genitive: 'Koszalina', locative: 'Koszalinie' },

  // -nica
  'brodnica': { nominative: 'Brodnica', genitive: 'Brodnicy', locative: 'Brodnicy' },

  // -stok (historyczna wymiana tematu)
  'białystok': { nominative: 'Białystok', genitive: 'Białegostoku', locative: 'Białymstoku' },

  // -rz / -mierz
  'sandomierz': { nominative: 'Sandomierz', genitive: 'Sandomierza', locative: 'Sandomierzu' },
  'kazimierz dolny': {
    nominative: 'Kazimierz Dolny',
    genitive: 'Kazimierza Dolnego',
    locative: 'Kazimierzu Dolnym',
  },

  // -ce pluralia (nie zawsze reguła trafia)
  'kielce': { nominative: 'Kielce', genitive: 'Kielc', locative: 'Kielcach' },
  'tychy': { nominative: 'Tychy', genitive: 'Tychów', locative: 'Tychach' },

  // -ia (dla bezpieczeństwa, choć reguła już działa)
  'gdynia': { nominative: 'Gdynia', genitive: 'Gdyni', locative: 'Gdyni' },
  'częstochowa': { nominative: 'Częstochowa', genitive: 'Częstochowy', locative: 'Częstochowie' },

  // śląskie
  'rybnik': { nominative: 'Rybnik', genitive: 'Rybnika', locative: 'Rybniku' },
  'gliwice': { nominative: 'Gliwice', genitive: 'Gliwic', locative: 'Gliwicach' },
  'zabrze': { nominative: 'Zabrze', genitive: 'Zabrza', locative: 'Zabrzu' },

  // podkarpackie
  'rzeszów': { nominative: 'Rzeszów', genitive: 'Rzeszowa', locative: 'Rzeszowie' },
  'przemyśl': { nominative: 'Przemyśl', genitive: 'Przemyśla', locative: 'Przemyślu' },

  // mazowieckie
  'radom': { nominative: 'Radom', genitive: 'Radomia', locative: 'Radomiu' },
  'płock': { nominative: 'Płock', genitive: 'Płocka', locative: 'Płocku' },
  'siedlce': { nominative: 'Siedlce', genitive: 'Siedlec', locative: 'Siedlcach' },

  // kujawsko-pomorskie
  'włocławek': { nominative: 'Włocławek', genitive: 'Włocławka', locative: 'Włocławku' },
  'grudziądz': { nominative: 'Grudziądz', genitive: 'Grudziądza', locative: 'Grudziądzu' },

  // warmińsko-mazurskie
  'elbląg': { nominative: 'Elbląg', genitive: 'Elbląga', locative: 'Elblągu' },

  // lubuskie
  'gorzów wielkopolski': {
    nominative: 'Gorzów Wielkopolski',
    genitive: 'Gorzowa Wielkopolskiego',
    locative: 'Gorzowie Wielkopolskim',
  },
  'zielona góra': {
    nominative: 'Zielona Góra',
    genitive: 'Zielonej Góry',
    locative: 'Zielonej Górze',
  },
};

function endsWithAny(s: string, suffixes: string[]) {
  return suffixes.some((x) => s.endsWith(x));
}

/**
 * Odmienia jeden wyraz (najczęściej ostatni człon nazwy miasta).
 * Zwraca dopełniacz i miejscownik.
 *
 * To jest heurystyka – poprawi 90% popularnych przypadków,
 * ale “dziwne” formy nadal powinny iść do EXCEPTIONS.
 */
function inflectSingle(word: string): PartCases {
  const w = word.trim();
  if (!w) return { genitive: w, locative: w };



  // Słowa z dywizem: odmienia się zwykle tylko ostatni segment
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

  // 0) Szybkie wyjątki na pojedynczy człon (gdy ktoś poda tylko “Białystok” itd.)
  if (EXCEPTIONS[lower]) {
    return { genitive: EXCEPTIONS[lower].genitive, locative: EXCEPTIONS[lower].locative };
  }

  // 1) -ów: Kraków (ale Kraków jest wyjątkiem loc) / Tarnów -> Tarnowa / Tarnowie
  if (lower.endsWith('ów')) {
    return {
      genitive: w + 'a',
      locative: w.slice(0, -2) + 'owie',
    };
  }

  // 2) -sk / -ck (bardzo częste): Gdańsk (wyjątek), Sopot? (nie), Płock? -> “w Płocku”
  // Typowo: gen +a, loc +u
  if (endsWithAny(lower, ['sk', 'ck'])) {
    return {
      genitive: w + 'a',
      locative: w + 'u',
    };
  }

  // 3) -in / -yn / -lin / -cin: Szczecin -> Szczecina / Szczecinie
  if (/(in|yn|lin|cin)$/.test(lower)) {
    return {
      genitive: w + 'a',
      locative: w + 'ie',
    };
  }

  // 4) -ek / -ok: Płock -> wcześniej, ale np. “Turek” -> Turka / Turku, “Sandomierz” nie
  // Uproszczone, ale często trafia: gen +a, loc +u
  if (endsWithAny(lower, ['ek', 'ok'])) {
    return {
      genitive: w + 'a',
      locative: w + 'u',
    };
  }

  // 5) -ice: Katowice -> Katowic / Katowicach
  if (lower.endsWith('ice')) {
    const base = w.slice(0, -1); // Katowic(e) -> Katowic
    return {
      genitive: base,
      locative: base + 'ach',
    };
  }

  // 6) pluralia tantum (np. Tychy, Kielce): końcówka -y / -i,
  // ALE NIE dotyczy form typu “Gdynia” (to -ia)
  if ((lower.endsWith('y') || lower.endsWith('i')) && !lower.endsWith('ia')) {
    const base = w.slice(0, -1);
    return {
      genitive: base + 'ów',
      locative: base + 'ach',
    };
  }

  // 7) końcówka -ia / -ja:
  // Gdynia -> Gdyni / Gdyni (naprawia Twoje “Gdyniie”)
  // Zamościa tu nie ma (bo to -ść), ale np. “Narnia” (gdyby) też zadziała.
  if (endsWithAny(lower, ['ia', 'ja'])) {
    const base = w.slice(0, -1); // Gdyni(a) -> Gdyni
    return {
      genitive: base,
      locative: base,
    };
  }

  if (/(ica|yca|nica)$/.test(lower)) {
    const base = w.slice(0, -1); // Nidzic(a) -> Nidzic
    return {
      genitive: base + 'y',
      locative: base + 'y',
    };
  }

  // 8) końcówka -a: Warszawa -> Warszawy / Warszawie
  // Uwaga: jeśli temat już kończy się na i/y (np. “Gdyni(a)” obsłużone wyżej),
  // to NIE doklejamy “ie” (żeby nie było “ii-e”).
  if (lower.endsWith('a')) {
    const base = w.slice(0, -1);
    const baseLower = base.toLowerCase();
    const last = baseLower[baseLower.length - 1] ?? '';

    // gen: po k/g często “-i”, inaczej “-y” (bardzo uproszczone, ale praktyczne)
    const gen = /[kg]$/.test(last) ? base + 'i' : base + 'y';

    // loc: normalnie “-ie”, ale jeśli temat już kończy się na i/y -> zostaw temat
    const loc = /[iy]$/.test(last) ? base : base + 'ie';

    return { genitive: gen, locative: loc };
  }

  // 9) końcówka -o / -e: “Sokołowo” -> “Sokołowa” / “Sokołowie”
  if (lower.endsWith('o') || lower.endsWith('e')) {
    const base = w.slice(0, -1);
    return {
      genitive: base + 'a',
      locative: base + 'ie',
    };
  }

  // 10) -ść / -dź / -ź / -ż: zwykle -i (Łódź osobno)
  if (/(ść|dź|ź|ż)$/.test(lower)) {
    return {
      genitive: w + 'i',
      locative: w + 'i',
    };
  }

  // 11) domyślnie: spółgłoska na końcu → +a / +u
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

  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length === 0) return { nominative: '', genitive: '', locative: '' };

  const last = words[words.length - 1];
  const lastInf = inflectSingle(last);

  let result: PolishCityCases;

  if (words.length >= 2) {
    const first = words[0].toLowerCase();

    // “Nowy Sącz”, “Nowa Sól”, “Nowe Miasto…”
    if (first === 'nowy' || first === 'nowa' || first === 'nowe') {
      const firstGen = first === 'nowy' ? 'Nowego' : first === 'nowa' ? 'Nowej' : 'Nowego';
      const firstLoc = first === 'nowy' ? 'Nowym' : first === 'nowa' ? 'Nowej' : 'Nowym';
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