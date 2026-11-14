/**
 * Pomoc pod znakiem „?” — jedno źródło treści dla portalu sprzedawcy, CRM, aplikacji na Maca i aplikacji mobilnej.
 * Treść opisuje działanie, nie nazwy z kodu. Zdania krótsze niż 25 słów. Każda zmiana procesu zmienia też instrukcję
 * (jak wpis w docs/mobile-parity.md).
 */

export type HelpAudience = 'seller' | 'manager';

export type HelpChapter = {
  id: string;
  title: string;
  /** Jedno–dwa zdania na górze panelu. */
  summary: string;
  /** Kroki „jak to zrobić” w kolejności. */
  steps?: string[];
  /** Dobrze wiedzieć — zasady i wyjątki. */
  notes?: string[];
  faq?: { q: string; a: string }[];
};

/** Krótka podpowiedź przy polu: 1–2 zdania i rozdział „Więcej”. */
export type HelpTipContent = { text: string; chapter: string };

export type HelpManual = {
  audience: HelpAudience;
  title: string;
  chapters: HelpChapter[];
  tips: Record<string, HelpTipContent>;
  /** Rozdział dla bieżącego ekranu. */
  chapterFor: (pathname: string) => string;
};

export function helpChapter(manual: HelpManual, id: string): HelpChapter {
  return manual.chapters.find((chapter) => chapter.id === id) || manual.chapters[0];
}

/** Wyszukiwanie bez polskich znaków i wielkości liter. */
export function searchHelp(manual: HelpManual, query: string): HelpChapter[] {
  const normalize = (value: string) => value.toLocaleLowerCase('pl-PL').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return manual.chapters;
  return manual.chapters.filter((chapter) => {
    const text = normalize([chapter.title, chapter.summary, ...(chapter.steps || []), ...(chapter.notes || []),
      ...(chapter.faq || []).flatMap((item) => [item.q, item.a])].join(' '));
    return words.every((word) => text.includes(word));
  });
}
