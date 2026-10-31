import * as yup from 'yup';
import { orderedBrochureKeys, requiresPageImage, type BrochureComposer, type BrochureDecorativePage } from './decorativePages';

export type BrochurePageReference = { key: string; number: number; title: string };
export type BrochureValidationIssue = {
  id: string;
  pageKey: string;
  pageNumber: number | null;
  pageTitle: string;
  field: string;
  element: string;
  fileName?: string;
  companyId?: string;
  reason: 'content' | 'missing' | 'access' | 'temporary' | 'invalid_image' | 'layout' | 'font';
  message: string;
  remedy: string;
};

const fields: Record<string, string> = {
  slogan: 'Tytuł strony', imagePath: 'Zdjęcie strony', points: 'Kafelki / punkty', linkUrl: 'Adres przycisku',
};
const pageSchema = yup.object({
  slogan: yup.string().test('title', 'Uzupełnij tytuł strony.', function (value) {
    return this.parent.layout === 'artwork' || Boolean(value?.trim());
  }),
  imagePath: yup.string().test('image', 'Nie wybrano zdjęcia wymaganego w tym układzie.', function (value) {
    return !requiresPageImage(this.parent.layout) || Boolean(value?.trim());
  }),
  points: yup.array().of(yup.string()).test('points', 'Dodaj przynajmniej jeden punkt.', function (value) {
    return !['features', 'features-photo', 'process', 'timeline', 'showcase'].includes(this.parent.layout)
      || Boolean(value?.some((point) => point?.trim()));
  }),
  linkUrl: yup.string().test('link', 'Wpisz pełny adres przycisku, zaczynający się od https:// lub http://.', (value) => {
    if (!value) return true;
    try {
      const url = new URL(value.replace(/\{\{broszura\}\}/g, 'brochure'));
      return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) && !/\s/.test(value);
    } catch { return false; }
  }),
});

export function brochurePageReferences(items: Array<{ id: string; title: string }>, pages: BrochureDecorativePage[], composer: BrochureComposer): BrochurePageReference[] {
  const titles = new Map<string, string>([
    ...items.map((item) => [`product:${item.id}`, item.title] as const),
    ...pages.map((page) => [`decorative:${page.id}`, page.slogan || 'Gotowa grafika'] as const),
    ['cover', 'Okładka'], ['intro', 'Wprowadzenie'], ['closing', 'Kontakt i następny krok'],
  ]);
  return orderedBrochureKeys(items, pages, composer.pageOrder)
    .filter((key) => !composer.hiddenPages.includes(key))
    .map((key, index) => ({ key, number: index + 1, title: titles.get(key) || 'Strona broszury' }));
}

export function validateBrochureContent(pages: BrochureDecorativePage[], references: BrochurePageReference[]): BrochureValidationIssue[] {
  const issues: BrochureValidationIssue[] = [];
  for (const page of pages) {
    const reference = references.find((entry) => entry.key === `decorative:${page.id}`);
    if (!page.isVisible || !reference) continue;
    try { pageSchema.validateSync(page, { abortEarly: false }); }
    catch (error) {
      if (!(error instanceof yup.ValidationError)) throw error;
      for (const issue of error.inner) {
        const field = issue.path || 'slogan';
        issues.push({
          id: `${reference.key}:${field}`, pageKey: reference.key, pageNumber: reference.number,
          pageTitle: reference.title, field, element: fields[field] || 'Treść strony',
          reason: 'content', message: issue.message,
          remedy: field === 'imagePath' ? 'Wybierz zdjęcie z biblioteki lub wgraj własny plik. Możesz też zmienić układ strony na układ bez zdjęcia.'
            : 'Popraw wskazane pole w Studio stron, zapisz broszurę i sprawdź ją ponownie.',
        });
      }
    }
  }
  return issues;
}

export function brochureFileName(source: string): string | undefined {
  if (!source || source.startsWith('data:')) return undefined;
  try {
    const path = /^https?:\/\//i.test(source) ? new URL(source).pathname : source.split('?')[0];
    return decodeURIComponent(path.split('/').pop() || '').slice(0, 160) || undefined;
  } catch { return undefined; }
}

export function brochureIssueLabel(issue: BrochureValidationIssue): string {
  return `${issue.pageNumber ? `Strona ${issue.pageNumber} „${issue.pageTitle}”` : issue.pageTitle} — ${issue.element}`;
}

export class BrochureValidationError extends Error {
  constructor(message: string, readonly issues: BrochureValidationIssue[]) {
    super(message);
    this.name = 'BrochureValidationError';
  }
}

export function readBrochureIssues(value: unknown): BrochureValidationIssue[] {
  if (!Array.isArray(value)) return [];
  return value.filter((issue): issue is BrochureValidationIssue => Boolean(issue && typeof issue === 'object'
    && typeof issue.id === 'string' && typeof issue.pageKey === 'string'
    && typeof issue.pageTitle === 'string' && typeof issue.element === 'string'
    && typeof issue.field === 'string' && typeof issue.message === 'string' && typeof issue.remedy === 'string'));
}

export function brochureIssueEditorUrl(brochureId: string, issue: BrochureValidationIssue): string {
  if (issue.companyId && ['logo', 'font'].includes(issue.field) && /^[0-9a-f-]{36}$/i.test(issue.companyId)) {
    return `/crm/settings/my-companies/${issue.companyId}/brandbook`;
  }
  return `/crm/brochures/${encodeURIComponent(brochureId)}?page=${encodeURIComponent(issue.pageKey)}&field=${encodeURIComponent(issue.field)}#brochure-page-studio`;
}
