'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import { Image as ImageIcon, Loader2, Plus, Sparkles, Star, Trash2, Upload, X, Pencil, GripVertical, ArrowUp, ArrowDown } from 'lucide-react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import type { IProductVariant } from '@/app/(crm)/crm/offers/types';

import { supabase } from '@/lib/supabase/browser';

type Props = {
  elementMode?: boolean;
  editing?: boolean;
  sectionActions?: ReactNode;
  productName?: string;
  variants: IProductVariant[];
  vatRate: number;
  defaultServiceDurationHours?: number | null;
  defaultExtensionPriceNetPerHour?: number | null;
  disabled?: boolean;
  onChange: (variants: IProductVariant[]) => void;
  imageUrls?: Record<string, string>;
  uploadingImageId?: string | null;
  onImageUpload?: (variant: IProductVariant, file: File) => Promise<void>;
  onImageDelete?: (variant: IProductVariant) => Promise<void>;
};

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function ProductVariantsEditor({
  elementMode = false,
  editing = true,
  sectionActions,
  variants,
  productName,
  vatRate,
  defaultServiceDurationHours,
  defaultExtensionPriceNetPerHour,
  disabled,
  onChange,
  imageUrls = {},
  uploadingImageId,
  onImageUpload,
  onImageDelete,
}: Props) {
  const [draft, setDraft] = useState<IProductVariant | null>(null);
  const [draftFile, setDraftFile] = useState<File | null>(null);
  const [imageRemoved, setImageRemoved] = useState(false);
  const [localImageUrl, setLocalImageUrl] = useState('');
  const [modalError, setModalError] = useState('');
  const [committing, setCommitting] = useState(false);
  const committingRef = useRef(false);
  const editorDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!draftFile) { setLocalImageUrl(''); return; }
    const url = URL.createObjectURL(draftFile);
    setLocalImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [draftFile]);
  useEffect(() => {
    if (draft && editing) editorDialog.current?.showModal();
    else editorDialog.current?.close();
  }, [draft?.id, editing]);
  const editorImageUrl = localImageUrl || (!imageRemoved && draft ? imageUrls[draft.id] : '') || '';
  const startEdit = (variant: IProductVariant) => {
    setDraft(structuredClone(variant)); setDraftFile(null); setImageRemoved(false); setModalError('');
  };
  const closeEditor = () => {
    if (committingRef.current) return;
    setDraft(null); setDraftFile(null); setImageRemoved(false); setModalError(''); closeAi();
  };
  const stageImage = (file: File) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setModalError('Wybierz zdjęcie JPG, PNG lub WebP o wielkości do 10 MB.'); return;
    }
    setDraftFile(file); setImageRemoved(false); setModalError('');
  };
  const removeDraftImage = () => { setDraftFile(null); setImageRemoved(true); };
  const applyDraft = async () => {
    if (!draft || disabled || committingRef.current) return;
    if (!draft.name.trim()) { setModalError('Podaj nazwę.'); return; }
    if (variants.some(v => v.id !== draft.id && v.name.trim().toLocaleLowerCase('pl-PL') === draft.name.trim().toLocaleLowerCase('pl-PL'))) { setModalError('Ta nazwa jest już używana.'); return; }
    if ([draft.price_net, draft.price_gross, draft.service_duration_hours, draft.extension_price_net_per_hour].some(v => v != null && (!Number.isFinite(Number(v)) || Number(v) < 0))) { setModalError('Ceny i czas usługi muszą być nieujemnymi liczbami.'); return; }
    if ((draft.short_description || '').length > 95 || (draft.description || '').length > 205) { setModalError('Skróć opisy do wskazanych limitów.'); return; }
    committingRef.current = true; setCommitting(true);
    const next = { ...draft, name: draft.name.trim(), ...(imageRemoved ? { offer_image_path: null } : {}) };
    const exists = variants.some(v => v.id === draft.id);
    try {
      if (imageRemoved && onImageDelete) await onImageDelete(next);
      if (draftFile && onImageUpload) await onImageUpload(next, draftFile);
onChange((exists ? variants.map(v => v.id === next.id ? next : v) : [...variants, next]).map((v, i) => ({ ...v, display_order: i, is_recommended: next.is_recommended ? v.id === next.id : v.is_recommended })));
      committingRef.current = false; closeEditor();
    } catch (error) {
      setModalError(error instanceof Error ? error.message : 'Nie udało się przygotować zdjęcia.');
    } finally { committingRef.current = false; setCommitting(false); }
  };
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiDraft, setAiDraft] = useState<{ short_description: string; description: string } | null>(null);
  const aiRequest = useRef<AbortController | null>(null);
  const closeAi = () => { aiRequest.current?.abort(); setAiBusy(false); setAiVariantId(null); };
  useEffect(() => () => aiRequest.current?.abort(), []);
  const [aiVariantId, setAiVariantId] = useState<string | null>(null);
  const [aiInstructions, setAiInstructions] = useState<Record<string, string>>({});
  const aiDialog = useRef<HTMLDialogElement>(null);
  const aiVariant = draft?.id === aiVariantId ? draft : undefined;
  useEffect(() => {
    if (aiVariant) aiDialog.current?.showModal();
    else aiDialog.current?.close();
  }, [aiVariantId, Boolean(aiVariant)]);
  const generateAi = async () => {
    if (!aiVariant || aiBusy || disabled || !(aiInstructions[aiVariant.id] || '').trim()) return;
    const controller = new AbortController();
    aiRequest.current = controller;
    setAiBusy(true); setAiError('');
    try {
      const { data, error } = await supabase.functions.invoke('assist-inquiry', {
        signal: controller.signal,
        body: {
          action: 'draft_variant_copy', additionalInstructions: aiInstructions[aiVariant.id],
          variantContext: {
            product_name: productName || '', name: aiVariant.name,
            short_description: aiVariant.short_description || '', description: aiVariant.description || '',
            benefits: aiVariant.benefits || [],
            service_duration_hours: aiVariant.service_duration_hours ?? defaultServiceDurationHours,
          },
        },
      });
      if (controller.signal.aborted) return;
      if (error) {
        const payload = error.context instanceof Response ? await error.context.clone().json().catch(() => null) : null;
        throw new Error(payload?.error || 'Nie udało się wygenerować opisów. Spróbuj ponownie.');
      }
      const copy = data?.result;
      if (typeof copy?.short_description !== 'string' || !copy.short_description.trim() || copy.short_description.length > 95 ||
        typeof copy?.description !== 'string' || !copy.description.trim() || copy.description.length > 205) {
        throw new Error('AI nie zwróciło opisów w limicie znaków. Spróbuj ponownie.');
      }
      setAiDraft({ short_description: copy.short_description, description: copy.description });
    } catch (error) {
      if (!controller.signal.aborted) setAiError(error instanceof Error ? error.message : 'Błąd generowania.');
    } finally { if (!controller.signal.aborted) setAiBusy(false); }
  };
  const [draggingImageId, setDraggingImageId] = useState<string | null>(null);
  const updateVariant = (_index: number, patch: Partial<IProductVariant>) => setDraft(current => current ? { ...current, ...patch } : current);
  const addVariant = () => startEdit({
    id: `temp-${crypto.randomUUID()}`, name: '', short_description: '', description: '', benefits: [],
    price_net: 0, price_gross: 0, service_duration_hours: null, extension_price_net_per_hour: null,
    is_recommended: false, is_active: true, display_order: variants.length,
  });
  const moveVariant = (from: number, to: number) => {
    if (disabled || !editing || to < 0 || to >= variants.length || from === to) return;
    const next = [...variants]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved);
    onChange(next.map((v, i) => ({ ...v, display_order: i })));
  };
  const onDragEnd = ({source, destination}: DropResult) => { if (destination) moveVariant(source.index, destination.index); };
  const removeVariant = (index: number) => {
    const next = variants.filter((_, variantIndex) => variantIndex !== index);
    onChange(next.map((variant, displayOrder) => ({ ...variant, display_order: displayOrder })));
  };

  const setRecommended = (index: number) => {
    onChange(variants.map((variant, variantIndex) => ({
      ...variant,
      is_recommended: variantIndex === index && !variants[index].is_recommended,
    })));
  };

  return (
    <section className="rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium text-[#e5e4e2]">{elementMode ? 'Elementy produktu' : 'Warianty produktu'}</h2>
          <p className="mt-1 max-w-3xl text-sm text-[#e5e4e2]/55">
            {elementMode ? 'Elementy prezentowane bez cen, po maksymalnie trzy na stronie. Gotowe zestawy ustawisz w sekcji pakietów.' : 'Dodaj warianty i ustal ich kolejność. W PDF pojawią się po maksymalnie trzy na stronie. W ofercie zdecydujesz, czy pokazać ich porównanie, czy wydrukować tylko wybrany wariant.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        {sectionActions}
        {editing && <button
          type="button"
          onClick={addVariant}
          disabled={disabled}
          className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
          {elementMode ? 'Dodaj element' : 'Dodaj wariant'}
        </button>}
        </div>
      </div>

      {variants.length === 0 ? <p className="rounded-lg bg-black/10 p-5 text-sm text-[#e5e4e2]/50">Brak pozycji. Dodaj pierwszy element w trybie edycji.</p> :
        <DragDropContext onDragEnd={onDragEnd}><Droppable droppableId="product-variants">{provided => <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
          {variants.map((variant, index) => <Draggable key={variant.id} draggableId={variant.id} index={index} isDragDisabled={!editing || disabled}>{drag =>
            <article ref={drag.innerRef} {...drag.draggableProps} className="flex items-center gap-3 rounded-xl bg-black/15 p-3">
              {editing && <span {...drag.dragHandleProps} aria-label={`Przenieś: ${variant.name}`} className="text-[#e5e4e2]/35"><GripVertical className="h-4 w-4"/></span>}
              <span className="text-xs tabular-nums text-[#d3bb73]">{String(index + 1).padStart(2, '0')}</span>
              <div className="relative h-14 w-16 shrink-0 overflow-hidden rounded-lg bg-white/5">{imageUrls[variant.id] ? <Image src={imageUrls[variant.id]} alt={variant.offer_image_alt || variant.name} fill sizes="64px" className="object-cover"/> : <ImageIcon className="m-auto mt-4 h-6 w-6 text-white/20"/>}</div>
              <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="truncate text-sm font-medium text-[#e5e4e2]">{variant.name || 'Nowy element'}</h3>{variant.is_recommended && <Star aria-label="Rekomendowany" className="h-3.5 w-3.5 shrink-0 fill-current text-[#d3bb73]"/>}</div><p className="mt-1 line-clamp-2 text-xs text-[#e5e4e2]/55">{variant.short_description || variant.description || 'Brak opisu'}</p>{!elementMode && <p className="mt-1 text-xs text-[#d3bb73]">{Number(variant.price_net).toLocaleString('pl-PL', {style:'currency',currency:'PLN'})} netto</p>}</div>
              {editing && <ResponsiveActionBar alwaysDropdown compact actions={[
                {label:'Edytuj',icon:<Pencil className="h-4 w-4"/>,onClick:()=>startEdit(variant),disabled},
                {label:variant.is_recommended?'Usuń rekomendację':'Rekomenduj',icon:<Star className="h-4 w-4"/>,onClick:()=>setRecommended(index),disabled},
                {label:'Przenieś wyżej',icon:<ArrowUp className="h-4 w-4"/>,onClick:()=>moveVariant(index,index-1),disabled:disabled || index===0},
                {label:'Przenieś niżej',icon:<ArrowDown className="h-4 w-4"/>,onClick:()=>moveVariant(index,index+1),disabled:disabled || index===variants.length-1},
                {label:'Usuń z listy',icon:<Trash2 className="h-4 w-4"/>,onClick:()=>removeVariant(index),disabled,variant:'danger'},
              ]}/>}
            </article>
          }</Draggable>)}{provided.placeholder}
        </div>}</Droppable></DragDropContext>}
      <dialog ref={editorDialog} onCancel={event=>{event.preventDefault();closeEditor();}} aria-labelledby="variant-editor-title" className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-3xl overflow-hidden rounded-2xl bg-[#1c1f33] p-0 text-[#e5e4e2] shadow-2xl backdrop:bg-black/65">
        {draft && (()=>{const variant=draft;const index=variants.findIndex(v=>v.id===draft.id);return <div className="flex max-h-[90dvh] flex-col">
          <header className="flex shrink-0 items-center justify-between gap-3 bg-[#1c1f33] px-6 py-4"><h2 id="variant-editor-title" className="text-lg font-medium">{index < 0 ? 'Dodaj' : 'Edytuj'} {elementMode ? 'element produktu' : 'wariant produktu'}</h2><button type="button" onClick={closeEditor} disabled={committing} aria-label="Zamknij" className="rounded-lg p-2 hover:bg-white/5"><X className="h-5 w-5"/></button></header>
          <div className="min-h-0 overflow-y-auto px-6 py-4">
            <div className="mb-4 flex flex-wrap gap-2"><button type="button" disabled={disabled || committing} onClick={()=>{setAiDraft(null);setAiError('');setAiVariantId(variant.id);}} className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73]"><Sparkles className="h-4 w-4"/> Opis AI</button><button type="button" disabled={disabled || committing} onClick={()=>updateVariant(index,{is_recommended:!variant.is_recommended})} aria-pressed={Boolean(variant.is_recommended)} className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm text-[#d3bb73]"><Star className={`h-4 w-4 ${variant.is_recommended?'fill-current':''}`}/>{variant.is_recommended?'Rekomendowany':'Rekomenduj (opcjonalnie)'}</button></div>
              <div className="grid items-start gap-5 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)]">
                <div className="min-w-0">
                  <label className="mb-1 block text-xs text-[#e5e4e2]/50">
                    {elementMode ? 'Zdjęcie elementu do oferty' : 'Zdjęcie wariantu do oferty'}
                  </label>
                    <div
                      onDragEnter={(event) => {
                        event.preventDefault();
                        if (!disabled && uploadingImageId !== variant.id) setDraggingImageId(variant.id);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        if (!disabled && uploadingImageId !== variant.id) setDraggingImageId(variant.id);
                      }}
                      onDragLeave={(event) => {
                        event.preventDefault();
                        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDraggingImageId(null);
                      }}
                      onDrop={async (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setDraggingImageId(null);
                        const file = event.dataTransfer.files?.[0];
                        if (file && !disabled && !committing) stageImage(file);
                      }}
                      className={`relative aspect-[118/100] w-full max-w-[320px] overflow-hidden rounded-lg border border-dashed transition-colors ${
                        draggingImageId === variant.id
                          ? 'border-[#d3bb73]/25 bg-[#d3bb73]/15'
                          : 'border-[#d3bb73]/25 bg-[#111421]'
                      }`}
                    >
                      {uploadingImageId === variant.id ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-[#d3bb73]">
                          <Loader2 className="h-6 w-6 animate-spin" />
                          Optymalizuję i zapisuję…
                        </div>
                      ) : editorImageUrl ? (
                        <div className="absolute inset-0">
                          <Image
                            src={editorImageUrl}
                            alt={variant.offer_image_alt || variant.name || 'Zdjęcie wariantu'}
                            fill
                            sizes="(max-width: 400px) 80vw, 320px"
                            className="object-cover object-center"
                          />

                        </div>
                      ) : (
                        <label className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-2 px-4 text-center text-xs text-[#e5e4e2]/45">
                          {draggingImageId === variant.id ? (
                            <>
                              <Upload className="h-7 w-7 text-[#d3bb73]" />
                              Upuść zdjęcie tutaj
                            </>
                          ) : (
                            <>
                              <ImageIcon className="h-7 w-7 text-[#d3bb73]/70" />
                              Przeciągnij zdjęcie lub kliknij, aby wybrać
                              <span className="text-[10px] text-[#e5e4e2]/30">PNG, JPG lub WebP, maks. 10 MB</span>
                            </>
                          )}
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            disabled={disabled || committing}
                            className="hidden"
                            onChange={async (event) => {
                              const file = event.currentTarget.files?.[0];
                              event.currentTarget.value = '';
                              if (file) stageImage(file);
                            }}
                          />
                        </label>
                      )}
                    </div>
                  {editorImageUrl && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            <label className="flex cursor-pointer items-center gap-1.5 rounded-md bg-[#d3bb73] px-2.5 py-1.5 text-xs font-medium text-[#1c1f33]">
                              <Upload className="h-3.5 w-3.5" /> Zmień
                              <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                disabled={disabled || committing}
                                className="hidden"
                                onChange={async (event) => {
                                  const file = event.currentTarget.files?.[0];
                                  event.currentTarget.value = '';
                                  if (file) stageImage(file);
                                }}
                              />
                            </label>
                            <button
                              type="button"
                              disabled={disabled || committing}
                              onClick={() => removeDraftImage()}
                              className="flex items-center gap-1.5 rounded-md bg-red-950/85 px-2.5 py-1.5 text-xs text-red-200"
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Usuń
                            </button>
                          </div>
                  )}
                  <p className="mt-2 max-w-[320px] text-xs leading-relaxed text-[#e5e4e2]/50">Proporcje zdjęcia jak na karcie elementu w PDF (118:100). Podgląd pokazuje centralny kadr — brzegi szerszego lub wyższego zdjęcia zostaną przycięte.</p>
                  <input
                    value={variant.offer_image_alt || ''}
                    onChange={(event) => updateVariant(index, { offer_image_alt: event.target.value })}
                    disabled={disabled || committing}
                    placeholder="Opis zdjęcia dla dostępności"
                    className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#111421] px-3 py-2 text-xs text-[#e5e4e2]"
                  />
                </div>

                <div className="min-w-0 space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-[#e5e4e2]/50">{elementMode ? 'Nazwa elementu' : 'Nazwa wariantu'}</label>
                  <input
                    value={variant.name}
                    onChange={(event) => updateVariant(index, { name: event.target.value })}
                    disabled={disabled || committing}
                    placeholder={elementMode ? 'Np. Stół blackjack' : 'Np. Standard'}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#111421] px-3 py-2 text-[#e5e4e2]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-xs text-[#e5e4e2]/50">Cena netto</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={variant.price_net}
                      onChange={(event) => {
                        const priceNet = Number(event.target.value) || 0;
                        updateVariant(index, {
                          price_net: priceNet,
                          price_gross: round2(priceNet * (1 + vatRate / 100)),
                        });
                      }}
                      disabled={disabled || committing}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#111421] px-3 py-2 text-[#e5e4e2]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-[#e5e4e2]/50">Cena brutto</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={variant.price_gross}
                      onChange={(event) => {
                        const priceGross = Number(event.target.value) || 0;
                        updateVariant(index, {
                          price_gross: priceGross,
                          price_net: round2(priceGross / (1 + vatRate / 100)),
                        });
                      }}
                      disabled={disabled || committing}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#111421] px-3 py-2 text-[#e5e4e2]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-xs text-[#e5e4e2]/50">
                      Czas usługi (h)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={variant.service_duration_hours ?? ''}
                      onChange={(event) => updateVariant(index, {
                        service_duration_hours: event.target.value === ''
                          ? null
                          : Number(event.target.value),
                      })}
                      disabled={disabled || committing}
                      placeholder={defaultServiceDurationHours
                        ? `Dziedziczy: ${defaultServiceDurationHours}`
                        : 'np. 6'}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#111421] px-3 py-2 text-[#e5e4e2]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-[#e5e4e2]/50">
                      Przedłużenie netto / h
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={variant.extension_price_net_per_hour ?? ''}
                      onChange={(event) => updateVariant(index, {
                        extension_price_net_per_hour: event.target.value === ''
                          ? null
                          : Number(event.target.value),
                      })}
                      disabled={disabled || committing}
                      placeholder={defaultExtensionPriceNetPerHour
                        ? `Dziedziczy: ${defaultExtensionPriceNetPerHour}`
                        : 'np. 500'}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#111421] px-3 py-2 text-[#e5e4e2]"
                    />
                  </div>
                </div>
                <p className="-mt-1 text-[11px] leading-4 text-[#e5e4e2]/35">
                  Puste pole korzysta z wartości głównej produktu. Uzupełnij je tylko wtedy,
                  gdy wariant ma inny czas lub koszt przedłużenia.
                </p>

                <div>
                  <label className="mb-1 block text-xs text-[#e5e4e2]/50">Krótki opis</label>
                  <input
                    maxLength={95}
                    value={variant.short_description || ''}
                    onChange={(event) => updateVariant(index, { short_description: event.target.value })}
                    disabled={disabled || committing}
                    placeholder="Dla kameralnych przyjęć"
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#111421] px-3 py-2 text-[#e5e4e2]"
                  />
                  <p className="mt-1 text-right text-xs text-[#e5e4e2]/50">{(variant.short_description || '').length}/95 znaków{(variant.short_description || '').length > 95 ? ' — skróć opis do wydruku' : ''}</p>
                </div>

                </div>
                <div className="min-w-0 sm:col-span-2">
                  <label className="mb-1 block text-xs text-[#e5e4e2]/50">Opis wariantu</label>
                  <textarea
                    maxLength={205}
                    value={variant.description || ''}
                    onChange={(event) => updateVariant(index, { description: event.target.value })}
                    disabled={disabled || committing}
                    rows={3}
                    placeholder="Dla kogo jest ten wariant i czym się wyróżnia"
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#111421] px-3 py-2 text-[#e5e4e2]"
                  />
                  <p className="mt-1 text-right text-xs text-[#e5e4e2]/50">{(variant.description || '').length}/205 znaków{(variant.description || '').length > 205 ? ' — skróć opis do wydruku' : ''}</p>
                </div>

                <div className="min-w-0 sm:col-span-2">
                  <label className="mb-1 block text-xs text-[#e5e4e2]/50">
                    Zakres <span className="text-[#e5e4e2]/35">(jedna pozycja w wierszu)</span>
                  </label>
                  <textarea
                    value={(variant.benefits || []).join('\n')}
                    onChange={(event) => updateVariant(index, {
                      // Zachowujemy spacje podczas pisania. Normalizacja pustych wierszy
                      // i białych znaków odbywa się dopiero przy zapisie produktu.
                      benefits: event.target.value.split('\n'),
                    })}
                    disabled={disabled || committing}
                    rows={6}
                    placeholder={'DJ i prowadzenie\nNagłośnienie sali\nPodstawowe oświetlenie'}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#111421] px-3 py-2 text-[#e5e4e2]"
                  />
                </div>
              </div>

          </div>
          <footer className="shrink-0 bg-[#1c1f33] px-6 py-4">{modalError && <p role="alert" className="mb-3 text-sm text-red-300">{modalError}</p>}<p className="mb-3 text-xs text-[#e5e4e2]/50">Zmiany zatwierdzisz przyciskiem zapisu całej sekcji. Anulowanie modala pozostawi element bez zmian.</p><div className="flex justify-end gap-2"><button type="button" disabled={committing} onClick={closeEditor} className="rounded-lg bg-white/5 px-4 py-2 text-sm">Anuluj</button><button type="button" disabled={disabled || committing} onClick={()=>void applyDraft()} className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] disabled:opacity-40">{committing && <Loader2 className="h-4 w-4 animate-spin"/>}{committing?'Przygotowuję…':index<0?'Dodaj do listy':'Zastosuj zmiany'}</button></div></footer>
        </div>;})()}
      </dialog>
      <dialog
        ref={aiDialog}
        onCancel={closeAi}
        aria-labelledby="variant-ai-title"
        className="m-auto max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-[#1c1f33] p-6 text-[#e5e4e2] shadow-2xl backdrop:bg-black/60"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="variant-ai-title" className="text-lg font-medium">Opis AI — {aiVariant?.name || 'wariant'}</h2>
          <button type="button" onClick={closeAi} aria-label="Zamknij" className="rounded-lg p-2 hover:bg-white/5">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-4 text-sm text-[#e5e4e2]/60">
          Krótki opis: maks. 95 znaków. Opis wariantu: maks. 205 znaków ze spacjami.
          Te limity odpowiadają karcie porównania wariantów w wydruku.
        </p>
        <label htmlFor="variant-ai-instructions" className="mb-1 block text-sm">Twoje wytyczne</label>
        <textarea
          id="variant-ai-instructions"
          autoFocus
          rows={4}
          disabled={aiBusy}
          maxLength={2000}
          value={aiInstructions[aiVariantId || ''] || ''}
          onChange={(event) => {
            if (aiVariantId) setAiInstructions({ ...aiInstructions, [aiVariantId]: event.target.value });
          }}
          placeholder="Np. podkreśl elegancki charakter oprawy i kameralne przyjęcia. Pisz konkretnie, bez superlatywów."
          className="w-full rounded-lg border border-white/10 bg-[#111421] px-3 py-2 text-sm"
        />
        <p className="mt-1 text-right text-xs text-[#e5e4e2]/50">{(aiInstructions[aiVariantId || ''] || '').length}/2000</p>
        {aiError && <p role="alert" className="my-3 text-sm text-red-300">{aiError}</p>}
        <button type="button" disabled={aiBusy || disabled || !(aiInstructions[aiVariantId || ''] || '').trim()} onClick={generateAi} className="my-4 flex items-center gap-2 rounded-lg bg-[#d3bb73]/15 px-4 py-2 text-sm text-[#d3bb73] disabled:opacity-40">
          {aiBusy && <Loader2 className="h-4 w-4 animate-spin" />}{aiBusy ? 'Generuję…' : aiDraft ? 'Wygeneruj ponownie' : 'Wygeneruj opisy'}
        </button>
        {aiDraft && <div className="space-y-3">
          <label className="block text-sm">Krótki opis
            <input maxLength={95} value={aiDraft.short_description} disabled={aiBusy} onChange={e => setAiDraft({ ...aiDraft, short_description: e.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-[#111421] px-3 py-2" />
            <span className="block text-right text-xs opacity-50">{aiDraft.short_description.length}/95</span>
          </label>
          <label className="block text-sm">Opis wariantu
            <textarea rows={4} maxLength={205} value={aiDraft.description} disabled={aiBusy} onChange={e => setAiDraft({ ...aiDraft, description: e.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-[#111421] px-3 py-2" />
            <span className="block text-right text-xs opacity-50">{aiDraft.description.length}/205</span>
          </label>
          <p className="text-xs opacity-60">Sprawdź treść przed wstawieniem. Opisy zapiszą się po zapisaniu wariantów.</p>
          <button type="button" disabled={aiBusy || disabled || !aiDraft.short_description.trim() || !aiDraft.description.trim()} onClick={() => {
            if (disabled || !aiVariant) return;
            setDraft(current => current ? { ...current, ...aiDraft } : current);
            closeAi();
          }} className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] disabled:opacity-40">Wstaw do wariantu</button>
        </div>}
      </dialog>
    </section>
  );
}
