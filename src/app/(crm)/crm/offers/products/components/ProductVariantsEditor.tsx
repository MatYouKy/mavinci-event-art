'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Image as ImageIcon, Loader2, Plus, Star, Trash2, Upload } from 'lucide-react';
import type { IProductVariant } from '@/app/(crm)/crm/offers/types';

type Props = {
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
  variants,
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
  const [draggingImageId, setDraggingImageId] = useState<string | null>(null);
  const updateVariant = (index: number, patch: Partial<IProductVariant>) => {
    onChange(variants.map((variant, variantIndex) => (
      variantIndex === index ? { ...variant, ...patch } : variant
    )));
  };

  const addVariant = () => {
    if (variants.length >= 3) return;
    onChange([
      ...variants,
      {
        id: `temp-${crypto.randomUUID()}`,
        name: '',
        short_description: '',
        description: '',
        benefits: [],
        price_net: 0,
        price_gross: 0,
        service_duration_hours: null,
        extension_price_net_per_hour: null,
        is_recommended: variants.length === 0,
        is_active: true,
        display_order: variants.length,
      },
    ]);
  };

  const removeVariant = (index: number) => {
    const next = variants.filter((_, variantIndex) => variantIndex !== index);
    if (next.length > 0 && !next.some((variant) => variant.is_recommended)) {
      next[0] = { ...next[0], is_recommended: true };
    }
    onChange(next.map((variant, displayOrder) => ({ ...variant, display_order: displayOrder })));
  };

  const setRecommended = (index: number) => {
    onChange(variants.map((variant, variantIndex) => ({
      ...variant,
      is_recommended: variantIndex === index,
    })));
  };

  return (
    <section className="rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium text-[#e5e4e2]">Warianty produktu</h2>
          <p className="mt-1 max-w-3xl text-sm text-[#e5e4e2]/55">
            Opcjonalnie dodaj maksymalnie trzy warianty produktu. W ofercie zdecydujesz,
            czy pokazać ich porównanie, czy wydrukować tylko wybrany wariant.
          </p>
        </div>
        <button
          type="button"
          onClick={addVariant}
          disabled={disabled || variants.length >= 3}
          className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
          Dodaj wariant {variants.length > 0 ? `(${variants.length}/3)` : ''}
        </button>
      </div>

      {variants.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[#d3bb73]/20 bg-[#0a0d1a]/60 px-5 py-8 text-center text-sm text-[#e5e4e2]/50">
          Ten produkt nie ma wariantów i będzie działał jak dotychczas.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {variants.map((variant, index) => (
            <article
              key={variant.id}
              className={`rounded-xl border p-4 ${
                variant.is_recommended
                  ? 'border-[#d3bb73]/70 bg-[#7f1734]/15'
                  : 'border-[#d3bb73]/15 bg-[#0a0d1a]/70'
              }`}
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <span className="text-xs font-medium uppercase tracking-wider text-[#d3bb73]">
                  Wariant {index + 1}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setRecommended(index)}
                    disabled={disabled}
                    title="Ustaw jako rekomendowany"
                    className={`rounded-lg p-2 ${
                      variant.is_recommended
                        ? 'bg-[#d3bb73]/20 text-[#d3bb73]'
                        : 'text-[#e5e4e2]/35 hover:bg-white/5 hover:text-[#d3bb73]'
                    }`}
                  >
                    <Star className={`h-4 w-4 ${variant.is_recommended ? 'fill-current' : ''}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeVariant(index)}
                    disabled={disabled}
                    title="Usuń wariant"
                    className="rounded-lg p-2 text-red-300/70 hover:bg-red-500/10 hover:text-red-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-[#e5e4e2]/50">
                    Zdjęcie wariantu do oferty
                  </label>
                  {variant.id.startsWith('temp-') ? (
                    <div className="flex min-h-28 items-center justify-center rounded-lg border border-dashed border-[#d3bb73]/20 bg-[#111421] px-4 text-center text-xs text-[#e5e4e2]/40">
                      Zapisz zmiany, aby dodać zdjęcie do tego wariantu.
                    </div>
                  ) : (
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
                        setDraggingImageId(null);
                        const file = event.dataTransfer.files?.[0];
                        if (file && onImageUpload && !disabled) await onImageUpload(variant, file);
                      }}
                      className={`relative overflow-hidden rounded-lg border border-dashed transition-all ${
                        draggingImageId === variant.id
                          ? 'border-[#d3bb73] bg-[#d3bb73]/15 ring-2 ring-[#d3bb73]/25'
                          : 'border-[#d3bb73]/25 bg-[#111421]'
                      }`}
                    >
                      {uploadingImageId === variant.id ? (
                        <div className="flex min-h-36 flex-col items-center justify-center gap-2 text-sm text-[#d3bb73]">
                          <Loader2 className="h-6 w-6 animate-spin" />
                          Optymalizuję i zapisuję…
                        </div>
                      ) : imageUrls[variant.id] ? (
                        <div className="relative h-36">
                          <Image
                            src={imageUrls[variant.id]}
                            alt={variant.offer_image_alt || variant.name || 'Zdjęcie wariantu'}
                            fill
                            sizes="(min-width: 1280px) 30vw, 100vw"
                            className="object-cover"
                          />
                          <div className="absolute inset-x-0 bottom-0 flex gap-2 bg-gradient-to-t from-black/90 to-transparent p-3 pt-8">
                            <label className="flex cursor-pointer items-center gap-1.5 rounded-md bg-[#d3bb73] px-2.5 py-1.5 text-xs font-medium text-[#1c1f33]">
                              <Upload className="h-3.5 w-3.5" /> Zmień
                              <input
                                type="file"
                                accept="image/png,image/jpeg"
                                disabled={disabled}
                                className="hidden"
                                onChange={async (event) => {
                                  const file = event.target.files?.[0];
                                  if (file && onImageUpload) await onImageUpload(variant, file);
                                  event.currentTarget.value = '';
                                }}
                              />
                            </label>
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={() => onImageDelete?.(variant)}
                              className="flex items-center gap-1.5 rounded-md bg-red-950/85 px-2.5 py-1.5 text-xs text-red-200"
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Usuń
                            </button>
                          </div>
                        </div>
                      ) : (
                        <label className="flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 px-4 text-center text-xs text-[#e5e4e2]/45">
                          {draggingImageId === variant.id ? (
                            <>
                              <Upload className="h-7 w-7 text-[#d3bb73]" />
                              Upuść zdjęcie tutaj
                            </>
                          ) : (
                            <>
                              <ImageIcon className="h-7 w-7 text-[#d3bb73]/70" />
                              Przeciągnij zdjęcie lub kliknij, aby wybrać
                              <span className="text-[10px] text-[#e5e4e2]/30">PNG lub JPG, maks. 10 MB</span>
                            </>
                          )}
                          <input
                            type="file"
                            accept="image/png,image/jpeg"
                            disabled={disabled}
                            className="hidden"
                            onChange={async (event) => {
                              const file = event.target.files?.[0];
                              if (file && onImageUpload) await onImageUpload(variant, file);
                              event.currentTarget.value = '';
                            }}
                          />
                        </label>
                      )}
                    </div>
                  )}
                  <input
                    value={variant.offer_image_alt || ''}
                    onChange={(event) => updateVariant(index, { offer_image_alt: event.target.value })}
                    disabled={disabled}
                    placeholder="Opis zdjęcia dla dostępności"
                    className="mt-2 w-full rounded-lg border border-[#d3bb73]/20 bg-[#111421] px-3 py-2 text-xs text-[#e5e4e2]"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-[#e5e4e2]/50">Nazwa wariantu</label>
                  <input
                    value={variant.name}
                    onChange={(event) => updateVariant(index, { name: event.target.value })}
                    disabled={disabled}
                    placeholder={index === 0 ? 'Standard' : index === 1 ? 'Premium' : 'Gold'}
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
                      disabled={disabled}
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
                      disabled={disabled}
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
                      disabled={disabled}
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
                      disabled={disabled}
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
                    value={variant.short_description || ''}
                    onChange={(event) => updateVariant(index, { short_description: event.target.value })}
                    disabled={disabled}
                    placeholder="Dla kameralnych przyjęć"
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#111421] px-3 py-2 text-[#e5e4e2]"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs text-[#e5e4e2]/50">Opis wariantu</label>
                  <textarea
                    value={variant.description || ''}
                    onChange={(event) => updateVariant(index, { description: event.target.value })}
                    disabled={disabled}
                    rows={3}
                    placeholder="Dla kogo jest ten wariant i czym się wyróżnia"
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#111421] px-3 py-2 text-[#e5e4e2]"
                  />
                </div>

                <div>
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
                    disabled={disabled}
                    rows={6}
                    placeholder={'DJ i prowadzenie\nNagłośnienie sali\nPodstawowe oświetlenie'}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#111421] px-3 py-2 text-[#e5e4e2]"
                  />
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
