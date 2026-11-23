'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type DragEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Eye, EyeOff, FolderOpen, Images, Package, Pencil, Plus, Presentation, RefreshCw, RotateCcw, Search, Tablet, Trash2, Upload, X } from 'lucide-react';
import { Modal } from '@/components/UI/Modal';
import { HelpButton, HelpDrawerHost } from '@/components/help/HelpDrawer';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useGlobalLoader } from '@/contexts/GlobalLoaderContext';
import { useDialog } from '@/contexts/DialogContext';
import {
  SHOWCASE_ICONS, SHOWCASE_LIMITS, showcaseLayoutHide, showcaseLayoutOf, showcaseLayoutReorder, showcaseMediaKey, showcaseVisibleForMe,
  type ShowcaseHome, type ShowcaseIcon, type ShowcaseItemDetail, type ShowcaseItemSummary, type ShowcaseMedia, type ShowcaseSectionView, type ShowcaseUrls,
} from '@/lib/showcase/showcaseShared';
import { cardClass, dangerButton, inputClass, primaryButton, secondaryButton } from '../social/socialUi';
import { errorMessage, showcaseGet, showcasePost, showcaseUploadPhoto, showcaseUploadSummary } from './showcaseApi';
import ShowcaseItemEditor from './ShowcaseItemEditor';
import ShowcaseListPicker from './ShowcaseListPicker';
import ShowcasePhotoPicker from './ShowcasePhotoPicker';
import ShowcasePresenter from './ShowcasePresenter';
import { SectionIcon, Toggle, hasFiles, imageFiles, useDragList } from './showcaseUi';

/*
 * Strefa sprzedawcy → „Prezentacje” w CRM (pełna szerokość): działy (edycja, okładka), karty działu (karta upuszczona na inny dział
 * przechodzi do niego), edytor karty obok i podgląd jak na iPadzie. Kolejność działów i kart (przeciąganiem) i ukrywanie u siebie to
 * własny układ każdego pracownika (`saveLayout`, ten sam w CRM, na Macu, telefonie i iPadzie) — inni widzą swój układ.
 * Osoby z samym podglądem widzą działy i karty i otwierają je w podglądzie (tak, jak na spotkaniu). Odnośnik
 * `/crm/presentations?section=<dział>&id=<karta>`. To samo API co Mac i iPad (`/bridge/native/v1/showcase`).
 */

/** `companyId` — marka działu; `undefined` — serwer bez marki działu (pole nie trafia do zapisu). */
type SectionDraft = { id: string | null; version: number; title: string; subtitle: string; icon: ShowcaseIcon; isActive: boolean; cover: ShowcaseMedia | null; companyId?: string | null };
type PresenterState = { start: { sectionId?: string | null; itemId?: string | null }; draft: ShowcaseItemDetail | null };
const ITEM_DRAG = 'application/x-mavinci-showcase-item';
/** Liczby w pasku działów (font marki w nawigacji): cyfry fontem systemowym — w foncie nagłówków „0” wygląda jak „O”. */
const DIGITS: CSSProperties = { fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif' };

export default function ShowcaseWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showSnackbar } = useSnackbar();
  const { showLoader, hideLoader } = useGlobalLoader();
  const { showConfirm } = useDialog();
  const [home, setHome] = useState<ShowcaseHome | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [sectionId, setSectionId] = useState<string | null>(searchParams?.get('section') || null);
  const [openId, setOpenId] = useState<string | null>(searchParams?.get('id') || null);
  const [dirty, setDirty] = useState(false);
  const [sectionDraft, setSectionDraft] = useState<SectionDraft | null>(null);
  const [coverPicker, setCoverPicker] = useState(false);
  /** Okładka nowego działu z dysku — wgrywa się po utworzeniu działu (podgląd z pliku). */
  const [pendingCover, setPendingCover] = useState<{ file: File; preview: string } | null>(null);
  const [coverOver, setCoverOver] = useState(false);
  const [extraUrls, setExtraUrls] = useState<ShowcaseUrls>({});
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [productPicker, setProductPicker] = useState(false);
  const [presenter, setPresenter] = useState<PresenterState | null>(null);
  const [dropSection, setDropSection] = useState<string | null>(null);
  const [draggedItem, setDraggedItem] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) showLoader('Wczytuję prezentacje', 'Działy, karty i katalog produktów…');
    try {
      const data = await showcaseGet<ShowcaseHome>('home');
      setHome(data);
      setError('');
    } catch (cause) {
      setError(errorMessage(cause, 'Nie udało się pobrać prezentacji.'));
    } finally {
      if (!silent) hideLoader();
    }
  }, [showLoader, hideLoader]);

  useEffect(() => { void load(); }, [load]);

  const manage = home?.access.manage === true;
  const sections = useMemo(() => [...(home?.sections || [])].sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'pl')), [home]);
  const selected = sections.find((section) => section.id === sectionId) || sections[0] || null;

  useEffect(() => {
    if (!home || !openId) return;
    const item = home.items.find((entry) => entry.id === openId);
    if (item && item.sectionId !== selected?.id) setSectionId(item.sectionId);
  }, [home, openId, selected?.id]);

  const sectionItems = useCallback((id: string) => (home?.items || []).filter((item) => item.sectionId === id)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'pl')), [home]);
  const needle = query.trim().toLocaleLowerCase('pl');
  const items = useMemo(() => {
    if (needle) {
      return (home?.items || []).filter((item) => [item.title, item.tagline, ...item.productNames].some((value) => value.toLocaleLowerCase('pl').includes(needle)));
    }
    return selected ? sectionItems(selected.id) : [];
  }, [home, needle, selected, sectionItems]);

  const replaceUrl = (section: string | null, item: string | null) => {
    const params = new URLSearchParams();
    if (section) params.set('section', section);
    if (item) params.set('id', item);
    router.replace(`/crm/presentations${params.toString() ? `?${params.toString()}` : ''}`, { scroll: false });
  };

  const confirmLeave = async () => !dirty || Boolean(await showConfirm({ title: 'Niezapisane zmiany', message: 'Karta ma niezapisane zmiany. Przejść bez zapisu?', confirmText: 'Przejdź bez zapisu' }));

  const openItem = async (item: ShowcaseItemSummary) => {
    if (!manage) { setPresenter({ start: { sectionId: item.sectionId, itemId: item.id }, draft: null }); return; }
    if (item.id === openId || !(await confirmLeave())) return;
    setDirty(false);
    setOpenId(item.id);
    replaceUrl(item.sectionId, item.id);
  };

  const selectSection = async (section: ShowcaseSectionView) => {
    setQuery('');
    setSectionId(section.id);
    if (openId && home?.items.find((item) => item.id === openId)?.sectionId !== section.id) {
      if (!(await confirmLeave())) return;
      setDirty(false);
      setOpenId(null);
    }
    replaceUrl(section.id, null);
  };

  const run = async <T,>(title: string, action: () => Promise<T>, success?: string): Promise<T | null> => {
    showLoader(title, 'Proszę chwilę poczekać...');
    try {
      const result = await action();
      if (success) showSnackbar(success, 'success');
      return result;
    } catch (cause) {
      showSnackbar(errorMessage(cause, 'Operacja nie powiodła się.'), 'error');
      return null;
    } finally {
      hideLoader();
    }
  };

  // Własny układ pracownika ----------------------------------------------------------------------------------------------------

  /** Zapis własnego układu (kolejność, ukryte) od razu na liście; błąd — lista z serwera. */
  const saveLayout = (next: ShowcaseHome, message: string) => {
    setHome(next);
    void showcasePost('saveLayout', { layout: showcaseLayoutOf(next) })
      .then(() => showSnackbar(message, 'success'))
      .catch((cause) => { showSnackbar(errorMessage(cause, 'Nie udało się zapisać układu.'), 'error'); void load(true); });
  };

  const toggleHidden = (kind: 'section' | 'item', id: string, hidden: boolean) => {
    if (!home) return;
    saveLayout(showcaseLayoutHide(home, kind, id, hidden), hidden
      ? `${kind === 'section' ? 'Dział' : 'Karta'} ukryty${kind === 'section' ? '' : 'a'} w Twoim układzie (inni widzą swój układ).`
      : `${kind === 'section' ? 'Dział' : 'Karta'} znów widoczn${kind === 'section' ? 'y' : 'a'} w Twoim układzie.`);
  };

  const resetLayout = async () => {
    const done = await run('Przywracam układ domyślny', () => showcasePost('resetLayout', {}), 'Przywrócono układ domyślny');
    if (done) void load(true);
  };

  // Działy -------------------------------------------------------------------------------------------------------------------

  const sectionDrag = useDragList<ShowcaseSectionView>({
    items: sections, keyOf: (section) => section.id, group: 'showcase-sections',
    onMove: (next) => { if (home) saveLayout(showcaseLayoutReorder(home, null, next.map((section) => section.id)), 'Zmieniono kolejność działów w Twoim układzie'); },
  });

  const editSection = (section: ShowcaseSectionView | null) => setSectionDraft(section
    ? { id: section.id, version: section.version, title: section.title, subtitle: section.subtitle, icon: section.icon, isActive: section.isActive, cover: section.cover,
      ...(home?.companies && section.companyId !== undefined ? { companyId: section.companyId } : {}) }
    : { id: null, version: 1, title: '', subtitle: '', icon: 'sparkles', isActive: true, cover: null, ...(home?.companies ? { companyId: null } : {}) });

  const saveSection = async () => {
    if (!sectionDraft) return;
    const result = await run(sectionDraft.id ? 'Zapisuję dział' : 'Tworzę dział', () => showcasePost<{ section: ShowcaseSectionView }>('saveSection', {
      id: sectionDraft.id, version: sectionDraft.version, title: sectionDraft.title, subtitle: sectionDraft.subtitle, icon: sectionDraft.icon,
      isActive: sectionDraft.isActive, cover: sectionDraft.cover,
      ...(sectionDraft.companyId !== undefined ? { companyId: sectionDraft.companyId } : {}),
    }), sectionDraft.id ? 'Zapisano dział' : 'Utworzono dział — dodaj okładkę i karty');
    if (!result) return;
    if (!sectionDraft.id) {
      let created = result.section;
      const pending = pendingCover;
      if (pending) {
        // Okładka wybrana z dysku przed utworzeniem działu — teraz do bazy zdjęć i na kafelek działu.
        const saved = await run('Wgrywam okładkę', async () => {
          const upload = await showcaseUploadPhoto({ sectionId: created.id }, pending.file);
          const reply = await showcasePost<{ section: ShowcaseSectionView }>('saveSection', {
            id: created.id, version: created.version, title: created.title, subtitle: created.subtitle, icon: created.icon,
            isActive: created.isActive, cover: upload.photo,
          });
          return { upload, section: reply.section };
        });
        if (saved) {
          created = saved.section;
          setExtraUrls((current) => ({ ...current, ...saved.upload.urls }));
          showSnackbar(showcaseUploadSummary([saved.upload], 'okładka zapisana'), 'success');
        }
        URL.revokeObjectURL(pending.preview);
        setPendingCover(null);
      }
      await load(true);
      setSectionId(created.id);
      replaceUrl(created.id, null);
      setSectionDraft({ ...sectionDraft, id: created.id, version: created.version, cover: created.cover });
    } else {
      await load(true);
      setSectionDraft(null);
    }
  };

  const closeSectionDraft = () => {
    if (pendingCover) URL.revokeObjectURL(pendingCover.preview);
    setPendingCover(null);
    setSectionDraft(null);
  };

  const deleteSection = async () => {
    if (!sectionDraft?.id) return;
    const count = sectionItems(sectionDraft.id).length;
    if (!(await showConfirm({
      title: `Usunąć dział „${sectionDraft.title}”?`,
      message: count ? `Razem z działem zostaną usunięte karty (${count}) i ich zdjęcia wgrane do prezentacji. Tej operacji nie można cofnąć.` : 'Dział jest pusty. Tej operacji nie można cofnąć.',
      confirmText: 'Usuń dział',
    }))) return;
    const result = await run('Usuwam dział', () => showcasePost('deleteSection', { id: sectionDraft.id, withItems: true }), 'Usunięto dział');
    if (!result) return;
    if (openId && home?.items.find((item) => item.id === openId)?.sectionId === sectionDraft.id) { setOpenId(null); setDirty(false); }
    setSectionDraft(null);
    setSectionId(null);
    replaceUrl(null, null);
    await load(true);
  };

  /** Okładka z dysku albo przeciągnięta z Findera: istniejący dział — od razu do bazy zdjęć; nowy — po utworzeniu działu. */
  const uploadCover = async (files: FileList | File[] | null) => {
    if (!sectionDraft) return;
    const { images, heic } = imageFiles(files);
    if (!images[0]) { showSnackbar(heic ? 'Zdjęcia HEIC: zapisz je jako JPEG albo dodaj z aplikacji na Maca.' : 'Wybierz zdjęcie JPEG, PNG albo WebP.', 'warning'); return; }
    if (images[0].size > SHOWCASE_LIMITS.uploadBytes) { showSnackbar('Zdjęcie może mieć najwyżej 40 MB.', 'warning'); return; }
    if (!sectionDraft.id) {
      if (pendingCover) URL.revokeObjectURL(pendingCover.preview);
      setPendingCover({ file: images[0], preview: URL.createObjectURL(images[0]) });
      setSectionDraft({ ...sectionDraft, cover: null });
      return;
    }
    const result = await run('Wgrywam okładkę', () => showcaseUploadPhoto({ sectionId: sectionDraft.id! }, images[0]));
    if (result) {
      setExtraUrls((current) => ({ ...current, ...result.urls }));
      setSectionDraft({ ...sectionDraft, cover: result.photo });
      showSnackbar(showcaseUploadSummary([result], 'zapisz dział'), 'success');
    }
  };

  const coverDrop = {
    onDragOver: (event: DragEvent<HTMLElement>) => { if (hasFiles(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setCoverOver(true); } },
    onDragLeave: () => setCoverOver(false),
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setCoverOver(false);
      void uploadCover(event.dataTransfer.files);
    },
  };

  // Karty ---------------------------------------------------------------------------------------------------------------------

  const reorderItems = async (targetSection: string, ids: string[], message: string) => {
    setHome((current) => (current ? {
      ...current,
      items: current.items.map((item) => (ids.includes(item.id) ? { ...item, sectionId: targetSection, sortOrder: ids.indexOf(item.id) } : item)),
    } : current));
    try {
      await showcasePost('reorderItems', { sectionId: targetSection, ids });
      showSnackbar(message, 'success');
    } catch (cause) {
      showSnackbar(errorMessage(cause, 'Nie udało się zmienić kolejności kart.'), 'error');
    }
    void load(true);
  };

  const itemDrag = useDragList<ShowcaseItemSummary>({
    items, keyOf: (item) => item.id, group: 'showcase-items',
    onMove: (next) => {
      if (selected && !needle && home) saveLayout(showcaseLayoutReorder(home, selected.id, next.map((item) => item.id)), 'Zmieniono kolejność kart w Twoim układzie');
    },
  });

  /** Karta przeciągnięta na dział w lewej kolumnie — na koniec tego działu. */
  const sectionDropProps = (section: ShowcaseSectionView) => ({
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!draggedItem || !event.dataTransfer.types.includes(ITEM_DRAG)) return;
      event.preventDefault();
      setDropSection(section.id);
    },
    onDragLeave: () => setDropSection((current) => (current === section.id ? null : current)),
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!draggedItem || !event.dataTransfer.types.includes(ITEM_DRAG)) return;
      event.preventDefault();
      const id = draggedItem;
      setDropSection(null);
      setDraggedItem(null);
      const item = home?.items.find((entry) => entry.id === id);
      if (!item || item.sectionId === section.id) return;
      void reorderItems(section.id, [...sectionItems(section.id).map((entry) => entry.id), id], `Przeniesiono kartę do działu „${section.title}”`);
    },
  });

  /** Wiersz działu: przeciąganie działów (kolejność) i upuszczanie kart (przeniesienie) — jedne obsługi zdarzeń. */
  const sectionRowProps = (section: ShowcaseSectionView) => {
    const reorder = sectionDrag.rowProps(section);
    const drop = sectionDropProps(section);
    return {
      onDragOver: (event: DragEvent<HTMLElement>) => (event.dataTransfer.types.includes(ITEM_DRAG) ? drop.onDragOver(event) : reorder.onDragOver(event)),
      onDragLeave: drop.onDragLeave,
      onDrop: (event: DragEvent<HTMLElement>) => (event.dataTransfer.types.includes(ITEM_DRAG) ? drop.onDrop(event) : reorder.onDrop(event)),
    };
  };

  const loadItem = useCallback((id: string) => showcaseGet<ShowcaseItemDetail>('item', { id }), []);

  const create = async (body: { title?: string; productId?: string; example?: boolean }) => {
    if (!selected) { showSnackbar('Najpierw utwórz dział.', 'warning'); return; }
    if (!(await confirmLeave())) return;
    setCreating(false);
    setProductPicker(false);
    const result = await run(body.example ? 'Tworzę kartę z przykładu' : body.productId ? 'Tworzę kartę z produktu' : 'Tworzę kartę',
      () => showcasePost<ShowcaseItemDetail>('createItem', { sectionId: selected.id, ...body }),
      body.example ? 'Utworzono kartę z przykładu (ukryta) — dodaj zdjęcia z bazy i produkt, potem pokaż ją na spotkaniach'
        : body.productId ? 'Utworzono kartę z danymi produktu — dodaj zdjęcia i pytania klientów' : 'Utworzono kartę');
    setNewTitle('');
    if (!result) return;
    await load(true);
    setDirty(false);
    setOpenId(result.item.id);
    replaceUrl(selected.id, result.item.id);
  };

  if (error && !home) {
    return <main className="text-[#e5e4e2]"><div className={`${cardClass} p-6 text-sm text-[#e5e4e2]/70`}>{error}</div></main>;
  }
  const urls = { ...(home?.urls || {}), ...extraUrls };
  // Otwarta karta: działy zwijają się do paska ikon, żeby edytor miał pełną szerokość (MacBook Air 13″ / Pro 16″ z menu CRM).
  const rail = Boolean(manage && openId && home);
  const railOnly = rail ? 'lg:hidden' : '';

  return (
    // Bez własnego marginesu — margines daje układ CRM (cała szerokość ekranu dla treści).
    <main className="min-w-0 text-[#e5e4e2]">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="mr-auto min-w-[240px] flex-1">
          <h1 className="flex items-center gap-1 text-2xl font-light">Prezentacje <HelpButton audience="presentations" chapter="karta" /></h1>
          <p className="text-sm text-[#e5e4e2]/50">Strefa sprzedawcy — materiały na spotkania z klientami: jak to wygląda, korzyści, galeria, przygotowanie.</p>
        </div>
        <button type="button" className={secondaryButton} disabled={!home} onClick={() => setPresenter({ start: { sectionId: null, itemId: null }, draft: null })}>
          <Tablet className="h-4 w-4" />Podgląd na iPadzie
        </button>
        <button type="button" className={secondaryButton} onClick={() => void load()}><RefreshCw className="h-4 w-4" />Odśwież</button>
        {home?.layout && (
          <button type="button" className={secondaryButton} onClick={() => void resetLayout()} title="Kolejność ustalona przy przygotowaniu, bez ukrytych u Ciebie">
            <RotateCcw className="h-4 w-4" />Układ domyślny
          </button>
        )}
        {manage && <button type="button" className={secondaryButton} onClick={() => editSection(null)}><Plus className="h-4 w-4" />Nowy dział</button>}
        {manage && <button type="button" className={primaryButton} disabled={!selected} onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Nowa karta</button>}
      </div>

      <div className={`grid gap-4 ${rail ? 'lg:grid-cols-[64px_280px_minmax(0,1fr)]' : 'lg:grid-cols-[240px_300px_minmax(0,1fr)]'}`}>
        <aside className="space-y-2 lg:sticky lg:top-0 lg:max-h-[calc(100vh-200px)] lg:self-start lg:overflow-y-auto lg:p-0.5">
          <div className={`px-1 text-xs uppercase tracking-wide text-[#e5e4e2]/40 ${rail ? 'lg:px-0 lg:text-center lg:text-[9px]' : ''}`}>Działy</div>
          {sections.map((section) => {
            const active = selected?.id === section.id && !needle;
            const count = sectionItems(section.id).length;
            return (
              <div key={section.id} {...(manage ? sectionRowProps(section) : sectionDrag.rowProps(section))}
                className={`group relative flex items-center gap-2 rounded-xl border px-2 py-2 transition-colors ${rail ? 'lg:justify-center lg:px-1' : ''} ${active ? 'border-[#d3bb73]/60 bg-[#1c1f33]' : 'border-transparent hover:bg-[#1c1f33]/70'} ${dropSection === section.id ? 'ring-2 ring-[#d3bb73]' : ''} ${sectionDrag.indicator(section)} ${sectionDrag.dragging(section) ? 'opacity-40' : ''} ${section.hiddenForMe ? 'opacity-50' : ''}`}>
                <button type="button" {...sectionDrag.handleProps(section)} onClick={() => void selectSection(section)}
                  className={`flex min-w-0 flex-1 cursor-grab items-center gap-2 text-left active:cursor-grabbing ${rail ? 'lg:flex-none' : ''}`}
                  title={rail ? `${section.title} — przeciągnij, żeby zmienić kolejność w Twoim układzie` : 'Przeciągnij, żeby zmienić kolejność w Twoim układzie'}>
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#d3bb73]/10 text-[#d3bb73] ${section.isActive ? '' : 'opacity-60'}`}><SectionIcon icon={section.icon} className="h-4 w-4" /></span>
                  <span className={`min-w-0 flex-1 ${railOnly}`}>
                    <span className="block truncate text-sm">{section.title}</span>
                    <span className="block text-[11px] text-[#e5e4e2]/40"><span style={DIGITS}>{count}</span> {count === 1 ? 'karta' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? 'karty' : 'kart'}{section.isActive ? '' : ' · ukryty dla wszystkich'}{section.hiddenForMe ? ' · ukryty u Ciebie' : ''}</span>
                  </span>
                  {!section.isActive && <EyeOff className={`h-3.5 w-3.5 shrink-0 text-[#e5e4e2]/40 ${railOnly}`} />}
                </button>
                <button type="button" onClick={() => toggleHidden('section', section.id, !section.hiddenForMe)}
                  aria-label={section.hiddenForMe ? `Pokaż dział ${section.title} w swoim układzie` : `Ukryj dział ${section.title} w swoim układzie`}
                  title={section.hiddenForMe ? 'Pokaż u mnie' : 'Ukryj u mnie (inni widzą swój układ)'}
                  className={`rounded-lg p-1.5 text-[#e5e4e2]/40 hover:bg-[#d3bb73]/10 hover:text-[#d3bb73] ${section.hiddenForMe ? '' : 'opacity-0 group-hover:opacity-100'} ${railOnly}`}>
                  {section.hiddenForMe ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
                {rail && <span className="pointer-events-none absolute right-0.5 top-0.5 hidden min-w-[16px] rounded-full bg-[#0f1119] px-1 text-center text-[10px] leading-4 text-[#e5e4e2]/60 lg:block" style={DIGITS}>{count}</span>}
                {manage && (
                  <button type="button" onClick={() => editSection(section)} aria-label={`Edytuj dział ${section.title}`}
                    className={`rounded-lg p-1.5 text-[#e5e4e2]/40 opacity-0 hover:bg-[#d3bb73]/10 hover:text-[#d3bb73] group-hover:opacity-100 ${railOnly}`}><Pencil className="h-3.5 w-3.5" /></button>
                )}
              </div>
            );
          })}
          {home && !sections.length && (
            <div className={`${cardClass} space-y-3 p-4 text-sm text-[#e5e4e2]/55`}>
              <p>Zacznij od działów, np. „Ekrany LED”, „Scena i technika”, „Atrakcje”.</p>
              {manage && <button type="button" className={primaryButton} onClick={() => editSection(null)}><Plus className="h-4 w-4" />Nowy dział</button>}
            </div>
          )}
          {sections.length > 0 && (
            <p className={`px-1 text-[11px] text-[#e5e4e2]/35 ${railOnly}`}>
              Kolejność działów i kart (przeciąganie) i ukrywanie ikoną oka to Twój układ — w CRM, na Macu, telefonie i iPadzie; inni widzą swój.{manage ? ' Kartę przeciągniętą na dział przenosisz do niego dla wszystkich.' : ''}
            </p>
          )}
        </aside>

        <section className="min-w-0 space-y-2 lg:sticky lg:top-0 lg:self-start">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[#e5e4e2]/40" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj we wszystkich kartach" className={`${inputClass} pl-8`} />
          </label>
          <div className="space-y-2 lg:max-h-[calc(100vh-200px)] lg:overflow-y-auto lg:pr-1">
            {items.map((item) => {
              const thumb = item.thumbKey ? urls[item.thumbKey]?.thumb : null;
              const handle = !needle ? itemDrag.handleProps(item) : null;
              return (
                <div key={item.id} {...(!needle ? itemDrag.rowProps(item) : {})} className={`group relative rounded-xl ${itemDrag.indicator(item)} ${itemDrag.dragging(item) ? 'opacity-40' : ''} ${item.hiddenForMe ? 'opacity-50' : ''}`}>
                  <button type="button" onClick={() => void openItem(item)}
                    draggable={Boolean(handle)}
                    onDragStart={handle ? (event) => { handle.onDragStart(event); event.dataTransfer.setData(ITEM_DRAG, item.id); setDraggedItem(item.id); } : undefined}
                    onDragEnd={handle ? () => { handle.onDragEnd(); setDraggedItem(null); setDropSection(null); } : undefined}
                    className={`${cardClass} flex w-full gap-3 p-2 text-left transition-colors ${openId === item.id ? 'border-[#d3bb73]/60' : 'hover:border-[#d3bb73]/30'} ${handle ? 'cursor-grab active:cursor-grabbing' : ''}`}>
                    {thumb ? <img src={thumb} alt="" className="h-16 w-20 shrink-0 rounded object-cover" draggable={false} />
                      : <span className="flex h-16 w-20 shrink-0 items-center justify-center rounded bg-[#0f1119]"><Images className="h-5 w-5 text-[#d3bb73]/30" /></span>}
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="flex items-start gap-1.5">
                        <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                        {!item.isActive && <EyeOff className="h-3.5 w-3.5 shrink-0 text-[#e5e4e2]/40" aria-label="Ukryta dla wszystkich" />}
                        <span className="w-6 shrink-0" aria-hidden />
                      </span>
                      {item.tagline && <span className="block truncate text-[11px] text-[#d3bb73]/80">{item.tagline}</span>}
                      <span className="flex items-center gap-2 text-[11px] text-[#e5e4e2]/45">
                        {item.productNames.length > 0 && <span className="flex min-w-0 items-center gap-1 truncate"><Package className="h-3 w-3 shrink-0" />{item.productNames.join(', ')}</span>}
                        {manage && item.problems > 0 && <span className="inline-flex shrink-0 items-center gap-0.5 text-amber-200"><AlertTriangle className="h-3 w-3" />{item.problems}</span>}
                      </span>
                      {needle && <span className="block text-[11px] text-[#e5e4e2]/35">{sections.find((section) => section.id === item.sectionId)?.title}</span>}
                      {item.hiddenForMe && <span className="block text-[11px] text-[#e5e4e2]/45">Ukryta u Ciebie — nie pokazuje się na Twoich spotkaniach</span>}
                    </span>
                  </button>
                  <button type="button" onClick={() => toggleHidden('item', item.id, !item.hiddenForMe)}
                    aria-label={item.hiddenForMe ? `Pokaż kartę ${item.title} w swoim układzie` : `Ukryj kartę ${item.title} w swoim układzie`}
                    title={item.hiddenForMe ? 'Pokaż u mnie' : 'Ukryj u mnie (inni widzą swój układ)'}
                    className={`absolute right-2 top-2 rounded-lg p-1.5 text-[#e5e4e2]/40 hover:bg-[#d3bb73]/10 hover:text-[#d3bb73] ${item.hiddenForMe ? '' : 'opacity-0 focus:opacity-100 group-hover:opacity-100'}`}>
                    {item.hiddenForMe ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              );
            })}
            {home && selected && !items.length && (
              <div className={`${cardClass} space-y-3 p-4 text-sm text-[#e5e4e2]/55`}>
                <p>{needle ? 'Brak kart pasujących do wyszukiwania.' : 'Ten dział nie ma jeszcze kart.'}</p>
                {manage && !needle && <button type="button" className={primaryButton} onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Nowa karta</button>}
              </div>
            )}
          </div>
        </section>

        <section className="min-w-0">
          {manage && openId && home ? (
            <ShowcaseItemEditor key={openId} id={openId} onChanged={() => void load(true)} onDirtyChange={setDirty}
              onOpen={(id) => { setDirty(false); setOpenId(id); replaceUrl(selected?.id || null, id); }}
              onDeleted={() => { setDirty(false); setOpenId(null); replaceUrl(selected?.id || null, null); void load(true); }}
              onPreview={(draft) => setPresenter({ start: { sectionId: draft.item.sectionId, itemId: draft.item.id }, draft })} />
          ) : (
            <div className={`${cardClass} flex min-h-[320px] flex-col items-center justify-center gap-3 p-8 text-center text-sm text-[#e5e4e2]/55`}>
              <Presentation className="h-10 w-10 text-[#d3bb73]/40" />
              {manage
                ? 'Wybierz kartę z listy albo utwórz nową — pustą albo z produktu z katalogu (opis, korzyści, warianty, przygotowanie zaciągną się same).'
                : 'Wybierz kartę — otworzy się tak, jak zobaczy ją klient na spotkaniu. Przygotowanie prezentacji: uprawnienie „Prezentacje — przygotowanie”.'}
              {manage && selected && <button type="button" className={primaryButton} onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Nowa karta</button>}
            </div>
          )}
        </section>
      </div>

      {creating && selected && (
        <Modal open onClose={() => setCreating(false)} title={`Nowa karta — ${selected.title}`}>
          <div className="space-y-4">
            <button type="button" onClick={() => setProductPicker(true)}
              className={`${cardClass} flex w-full items-center gap-3 p-4 text-left hover:border-[#d3bb73]/40`}>
              <Package className="h-6 w-6 shrink-0 text-[#d3bb73]" />
              <span><span className="block text-sm">Z produktu z katalogu (zalecane)</span>
                <span className="block text-xs text-[#e5e4e2]/50">Zdjęcia, wstęp, korzyści, warianty z cenami, pakiety i przygotowanie — z Oferty → Produkty.</span></span>
            </button>
            <div className="space-y-2 border-t border-[#d3bb73]/10 pt-3">
              <div className="text-sm">Albo pusta karta</div>
              <div className="flex gap-2">
                <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} maxLength={SHOWCASE_LIMITS.title} placeholder="Tytuł karty" className={inputClass} autoFocus
                  onKeyDown={(event) => { if (event.key === 'Enter' && newTitle.trim()) void create({ title: newTitle.trim() }); }} />
                <button type="button" className={primaryButton} disabled={!newTitle.trim()} onClick={() => void create({ title: newTitle.trim() })}>Utwórz</button>
              </div>
            </div>
          </div>
        </Modal>
      )}
      {productPicker && (
        <ShowcaseListPicker mode="products" single title="Karta z produktu" confirmText="Utwórz kartę" onClose={() => setProductPicker(false)}
          onPick={(picked) => { if (picked[0]) void create({ productId: picked[0].id }); }} />
      )}

      {sectionDraft && (
        <Modal open onClose={closeSectionDraft} title={sectionDraft.id ? 'Dział prezentacji' : 'Nowy dział'} scrollBody>
          <div className="space-y-4">
            <label className="block space-y-1">
              <span className="text-xs text-[#e5e4e2]/60">Nazwa</span>
              <input value={sectionDraft.title} maxLength={SHOWCASE_LIMITS.sectionTitle} autoFocus placeholder="np. Ekrany LED"
                onChange={(event) => setSectionDraft({ ...sectionDraft, title: event.target.value })} className={inputClass} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-[#e5e4e2]/60">Opis na kafelku (opcjonalnie)</span>
              <input value={sectionDraft.subtitle} maxLength={SHOWCASE_LIMITS.sectionSubtitle} placeholder="np. Ekrany na scenę, do sal i na zewnątrz"
                onChange={(event) => setSectionDraft({ ...sectionDraft, subtitle: event.target.value })} className={inputClass} />
            </label>
            {home?.companies && sectionDraft.companyId !== undefined && (
              <label className="block space-y-1">
                <span className="text-xs text-[#e5e4e2]/60">Marka działu (oferta ze spotkania)</span>
                <select value={sectionDraft.companyId || ''} onChange={(event) => setSectionDraft({ ...sectionDraft, companyId: event.target.value || null })} className={inputClass}>
                  <option value="">Bez marki — ceny z katalogu</option>
                  {home.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
                </select>
                <span className="block text-xs text-[#e5e4e2]/40">Oferta ze spotkania z kart tego działu dostaje tę markę i ceny z jej cennika sezonu dla terminu z rozmowy (np. Wesela → Event Rulers).</span>
              </label>
            )}
            <div className="space-y-1">
              <span className="text-xs text-[#e5e4e2]/60">Ikona</span>
              <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-9">
                {SHOWCASE_ICONS.map((icon) => (
                  <button key={icon.key} type="button" title={icon.label} onClick={() => setSectionDraft({ ...sectionDraft, icon: icon.key })}
                    className={`flex h-10 items-center justify-center rounded-lg border ${sectionDraft.icon === icon.key ? 'border-[#d3bb73] bg-[#d3bb73]/20 text-[#d3bb73]' : 'border-[#d3bb73]/10 text-[#e5e4e2]/60 hover:text-[#e5e4e2]'}`}>
                    <SectionIcon icon={icon.key} className="h-5 w-5" />
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <span className="text-xs text-[#e5e4e2]/60">Okładka (zdjęcie na kafelku działu)</span>
              <div className="flex items-center gap-3">
                {(() => {
                  const coverThumb = pendingCover?.preview || (sectionDraft.cover ? urls[showcaseMediaKey(sectionDraft.cover)]?.thumb : null);
                  return (
                    <div {...coverDrop} title="Przeciągnij zdjęcie z dysku albo wybierz z bazy zdjęć"
                      className={`relative flex h-28 w-48 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed bg-[#0f1119] ${coverOver ? 'border-[#d3bb73] ring-2 ring-[#d3bb73]/50' : 'border-[#d3bb73]/25'}`}>
                      {coverThumb ? <img src={coverThumb} alt="" className="h-full w-full object-cover" />
                        : <span className="flex flex-col items-center gap-1 px-2 text-center text-[11px] text-[#e5e4e2]/45"><Images className="h-6 w-6 text-[#d3bb73]/40" />Przeciągnij tu zdjęcie</span>}
                      {(sectionDraft.cover || pendingCover) && (
                        <button type="button" aria-label="Usuń okładkę"
                          onClick={() => { if (pendingCover) URL.revokeObjectURL(pendingCover.preview); setPendingCover(null); setSectionDraft({ ...sectionDraft, cover: null }); }}
                          className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white"><X className="h-3.5 w-3.5" /></button>
                      )}
                    </div>
                  );
                })()}
                <div className="flex flex-col gap-2">
                  <label className={`${secondaryButton} cursor-pointer`}><Upload className="h-4 w-4" />Z dysku
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => { void uploadCover(event.target.files); event.target.value = ''; }} />
                  </label>
                  <button type="button" className={secondaryButton} onClick={() => setCoverPicker(true)}><FolderOpen className="h-4 w-4" />Z bazy zdjęć…</button>
                  {pendingCover && <span className="max-w-[180px] text-[11px] text-[#e5e4e2]/45">Okładka zapisze się w bazie zdjęć po utworzeniu działu.</span>}
                </div>
              </div>
            </div>
            <Toggle checked={sectionDraft.isActive} onChange={(isActive) => setSectionDraft({ ...sectionDraft, isActive })}
              label={sectionDraft.isActive ? 'Widoczny na spotkaniach' : 'Ukryty (przygotowanie)'} />
            <div className="flex flex-wrap justify-end gap-2 border-t border-[#d3bb73]/10 pt-3">
              {sectionDraft.id && <button type="button" className={`${dangerButton} mr-auto`} onClick={() => void deleteSection()}><Trash2 className="h-4 w-4" />Usuń dział</button>}
              <button type="button" className={secondaryButton} onClick={closeSectionDraft}>Zamknij</button>
              <button type="button" className={primaryButton} disabled={!sectionDraft.title.trim()} onClick={() => void saveSection()}>{sectionDraft.id ? 'Zapisz' : 'Utwórz dział'}</button>
            </div>
          </div>
        </Modal>
      )}
      {coverPicker && sectionDraft && (
        <ShowcasePhotoPicker target={sectionDraft.id ? { sectionId: sectionDraft.id } : {}} products={[]} single title="Okładka działu" onClose={() => setCoverPicker(false)}
          onPick={(results) => {
            const first = results[0];
            if (first) {
              setExtraUrls((current) => ({ ...current, ...first.urls }));
              if (pendingCover) URL.revokeObjectURL(pendingCover.preview);
              setPendingCover(null);
              setSectionDraft((current) => (current ? { ...current, cover: first.photo } : current));
            }
            setCoverPicker(false);
          }} />
      )}

      <HelpDrawerHost audience="presentations" defaultChapter="start"
        footer={manage && selected ? (
          <button type="button" className={primaryButton} onClick={() => void create({ example: true })}>
            <Plus className="h-4 w-4" />Utwórz kartę z przykładu w „{selected.title}”
          </button>
        ) : null} />

      {presenter && home && (
        <ShowcasePresenter brand={home.brand} sections={showcaseVisibleForMe(home).sections} items={showcaseVisibleForMe(home).items} urls={urls}
          loadItem={loadItem} draft={presenter.draft} start={presenter.start} onClose={() => setPresenter(null)} />
      )}
    </main>
  );
}
