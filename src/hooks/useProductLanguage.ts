'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { applyProductEnglish, productTranslationFields, currentEnglishFields, type ProductEnglishContent } from '../../supabase/functions/_shared/productTranslation';
import { requestProductEnglish, type ProductLanguageDocument } from '@/components/crm/offers/ProductLanguagePanel';

export function useProductLanguage(productId: string, product: any, variants: any[], canEdit: boolean) {
  const [language, setLanguage] = useState<'pl' | 'en'>('pl');
  const [document, setDocument] = useState<ProductLanguageDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [operation, setOperation] = useState<'read' | 'generate' | 'save'>('generate');
  const retryAction = useRef<(() => Promise<unknown>) | null>(null);
  const lock = useRef(false);
  const epoch = useRef(0);
  useEffect(() => { epoch.current++; lock.current = false; setBusy(false); setLanguage('pl'); setDocument(null); setError(''); retryAction.current = null; return () => { epoch.current++; }; }, [productId]);
  const source = useMemo(() => product ? { ...product, variants, offer_product_variants: variants } : null, [product, variants]);
  const storedDocument = useMemo(() => source ? {
    fields: currentEnglishFields(source), revision: Number(source.translation_revision || 1), version: Number(source.english_version || 0),
  } : null, [source]);
  const activeDocument = document || storedDocument;
  const englishReady = Boolean(source && activeDocument && (() => {
    const fields = productTranslationFields(source);
    const saved = new Map(activeDocument.fields.map(field => [field.key, field]));
    return fields.length === saved.size && fields.every(field => saved.get(field.key)?.source === field.source && Boolean(saved.get(field.key)?.target));
  })());
  // Old products are prepared ahead of switching; a failed background attempt is not retried in a loop.
  const preparedSource = useRef('');
  const sourceKey = JSON.stringify([productId, source && productTranslationFields(source)]);
  const [preparing, setPreparing] = useState(false);
  useEffect(() => {
    if (!source || productId === 'new' || englishReady || busy || lock.current || preparedSource.current === sourceKey) return;
    preparedSource.current = sourceKey;
    let active = true;
    setPreparing(true);
    void requestProductEnglish(productId, { action: 'read' }).then(result => {
      if (active) setDocument(result);
    }).catch(error => { if (active) setError((error as Error).message); }).finally(() => { if (active) setPreparing(false); });
    return () => { active = false; setPreparing(false); };
  }, [sourceKey, busy]);
  useEffect(() => { if (!englishReady) setLanguage('pl'); }, [englishReady]);
  const translated = useMemo(() => {
    if (!source || language === 'pl' || !activeDocument) return source;
    const entries: ProductEnglishContent = Object.fromEntries(activeDocument.fields.map(field => [field.key, { source: field.source, target: field.target }]));
    const result = applyProductEnglish(source, entries);
    result.offer_product_variants = result.variants;
    return result;
  }, [source, language, activeDocument]);
  const generate = async (id = productId) => {
    if (id === 'new' || lock.current) return;
    retryAction.current = () => generate(id);
    setOperation('generate');
    lock.current = true; setBusy(true); setError('');
    const requestEpoch = epoch.current;
    try {
      const result = await requestProductEnglish(id, { action: 'generate' });
      if (requestEpoch === epoch.current && id === productId) setDocument(result);
      return result;
    } catch (error) { if (requestEpoch === epoch.current) setError((error as Error).message); throw error; }
    finally { if (requestEpoch === epoch.current) { lock.current = false; setBusy(false); } }
  };
  const switchLanguage = (next: 'pl' | 'en') => {
    if (lock.current || next === language) return;
    if (next === 'en' && !englishReady) {
      retryAction.current = () => generate();
      setError('Wersja EN nie jest jeszcze gotowa. Użyj „Przetłumacz PL → EN”, a potem przełącz język.');
      return;
    }
    setError(''); setLanguage(next);
  };
  const savePatch = async (patch: Record<string, unknown>) => {
    if (!canEdit || lock.current || !activeDocument || !translated) throw new Error('Poczekaj na przygotowanie wersji EN.');
    const next = { ...translated, ...patch };
    if ('offer_product_variants' in patch) next.variants = patch.offer_product_variants;
    const before = productTranslationFields(translated);
    const after = productTranslationFields(next);
    if (JSON.stringify(before.map(field => field.key)) !== JSON.stringify(after.map(field => field.key))) throw new Error('W EN poprawiasz treść istniejących pól. Dodawanie, usuwanie i zmianę składu wykonaj w PL. Pola tekstowe nie mogą być puste.');
    // Prohibit structural/price changes while translating. Polish content is never overwritten.
    const withoutText = (value: any) => {
      const entries = Object.fromEntries(productTranslationFields(value).map(field => [field.key, { source: field.source, target: '__translated__' }]));
      const result = applyProductEnglish(value, entries); result.offer_product_variants = result.variants;
      return JSON.stringify(result);
    };
    if (withoutText(next) !== withoutText(translated)) throw new Error('Ceny, zdjęcia, skład i ustawienia są wspólne. Zmień je w polskiej wersji; w EN edytujesz tylko teksty.');
    const targets = Object.fromEntries(activeDocument.fields.map(field => [field.key, field.target]));
    for (const field of after) targets[field.key] = field.source;
    retryAction.current = null;
    setOperation('save');
    lock.current = true; setBusy(true); setError('');
    const requestEpoch = epoch.current;
    try {
      const result = await requestProductEnglish(productId, { action: 'save', revision: activeDocument.revision, version: activeDocument.version, targets });
      if (requestEpoch === epoch.current) setDocument(result);
    } catch (error) {
      if (requestEpoch === epoch.current) setError((error as Error).message);
      throw error;
    } finally {
      if (requestEpoch === epoch.current) { lock.current = false; setBusy(false); }
    }
  };
  const retry = async () => {
    if (lock.current) return;
    try { await retryAction.current?.(); } catch { /* the operation keeps its error visible */ }
  };
  return { language, product: translated, busy, preparing, englishReady, error, operation, generate, switchLanguage, savePatch,
    retry, canRetry: Boolean(retryAction.current), dismissError: () => setError('') };
}
