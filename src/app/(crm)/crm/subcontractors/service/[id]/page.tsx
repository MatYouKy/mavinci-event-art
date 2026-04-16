'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  ArrowLeft,
  Wrench,
  CreditCard as Edit,
  Save,
  X,
  Trash2,
  Upload,
  Star,
  StarOff,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

import {
  useGetServiceCatalogDetailsQuery,
  useUpdateServiceCatalogMutation,
  useDeleteServiceCatalogMutation,
} from '../../api/rentalApi';

interface ServiceImage {
  url: string;
  title?: string;
  isPrimary?: boolean;
}

const compressImage = async (
  file: File,
  maxWidth = 1920,
  maxHeight = 1080,
  quality = 0.8,
): Promise<File> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            if (width > maxWidth) {
              height *= maxWidth / width;
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width *= maxHeight / height;
              height = maxHeight;
            }
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('No canvas ctx'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Blob failed'));
              return;
            }
            resolve(
              new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() }),
            );
          },
          'image/jpeg',
          quality,
        );
      };
      img.onerror = (e) => reject(e);
    };
    reader.onerror = (e) => reject(e);
  });
};

export default function ServiceCatalogDetailPage() {
  const router = useRouter();
  const params = useParams();
  const serviceId = params?.id as string;
  const { showSnackbar } = useSnackbar();
  const { employee, loading: employeeLoading } = useCurrentEmployee();

  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>(null);
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([]);
  const [selectedImage, setSelectedImage] = useState<ServiceImage | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragCounter, setDragCounter] = useState(0);

  const {
    data: service,
    isFetching: serviceLoading,
    isError: serviceError,
    refetch: refetchService,
  } = useGetServiceCatalogDetailsQuery(serviceId, {
    skip: !serviceId,
    refetchOnMountOrArgChange: true,
  });

  const [updateServiceMutation] = useUpdateServiceCatalogMutation();
  const [deleteServiceMutation] = useDeleteServiceCatalogMutation();

  const canEdit = employee?.permissions?.includes('equipment_manage');

  const handleEdit = () => {
    setEditForm({ ...service });
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setEditForm(null);
    setIsEditing(false);
  };

  const handleSave = async () => {
    if (!editForm) return;

    try {
      const primaryImg = (editForm.images || []).find((img: ServiceImage) => img.isPrimary);
      await updateServiceMutation({
        id: serviceId,
        updates: {
          name: editForm.name,
          description: editForm.description,
          category: editForm.category,
          unit: editForm.unit,
          unit_price: editForm.unit_price,
          vat_rate: editForm.vat_rate,
          price_net: editForm.price_net,
          price_gross: editForm.price_gross,
          is_active: editForm.is_active,
          images: editForm.images || [],
          thumbnail_url: primaryImg?.url || editForm.images?.[0]?.url || editForm.thumbnail_url,
        },
      }).unwrap();

      showSnackbar('Zapisano zmiany', 'success');
      setIsEditing(false);
      setEditForm(null);
      refetchService();
    } catch (err: any) {
      showSnackbar(err?.message || 'Blad podczas zapisywania', 'error');
    }
  };

  const handleChange = (field: string, value: any) => {
    setEditForm((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleDelete = async () => {
    if (!confirm(`Czy na pewno chcesz usunac "${service.name}"? Ta operacja jest nieodwracalna.`)) {
      return;
    }

    try {
      await deleteServiceMutation(serviceId).unwrap();
      showSnackbar('Usluga zostala usunieta', 'success');
      router.back();
    } catch (err: any) {
      showSnackbar(err?.message || 'Blad podczas usuwania', 'error');
    }
  };

  const uploadFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    const filesArray = Array.from(files);
    const newImages: ServiceImage[] = [];
    const currentImages: ServiceImage[] = editForm?.images || [];

    for (let i = 0; i < filesArray.length; i++) {
      const file = filesArray[i];
      if (!file.type.startsWith('image/')) {
        showSnackbar(`${file.name} nie jest obrazem`, 'error');
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        showSnackbar(`${file.name} przekracza 10MB`, 'error');
        continue;
      }

      setUploadingFiles((prev) => [...prev, file.name]);

      try {
        const compressed = await compressImage(file);
        const fileName = `${serviceId}/${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;

        const { error: uploadError } = await supabase.storage
          .from('service-catalog-images')
          .upload(fileName, compressed, {
            contentType: 'image/jpeg',
            upsert: false,
          });

        if (uploadError) throw uploadError;

        const {
          data: { publicUrl },
        } = supabase.storage.from('service-catalog-images').getPublicUrl(fileName);

        newImages.push({
          url: publicUrl,
          title: file.name,
          isPrimary: currentImages.length === 0 && newImages.length === 0,
        });
      } catch (error: any) {
        console.error(`Upload error for ${file.name}:`, error);
        showSnackbar(`Blad przesylania ${file.name}: ${error?.message || 'Nieznany blad'}`, 'error');
      } finally {
        setUploadingFiles((prev) => prev.filter((n) => n !== file.name));
      }
    }

    if (newImages.length > 0) {
      const updatedImages = [...currentImages, ...newImages];
      handleImagesChange(updatedImages);
      showSnackbar('Przeslano zdjecia', 'success');
    }
  };

  const handleImagesChange = (newImages: ServiceImage[]) => {
    if (isEditing) {
      const primary = newImages.find((img) => img.isPrimary);
      setEditForm((prev: any) => ({
        ...prev,
        images: newImages,
        thumbnail_url: primary?.url || newImages[0]?.url || null,
      }));
    }
  };

  const handleDeleteImage = async (imageUrl: string) => {
    try {
      const fileName = imageUrl.split('/service-catalog-images/').pop();
      if (fileName) {
        await supabase.storage.from('service-catalog-images').remove([fileName]);
      }
      const currentImages: ServiceImage[] = editForm?.images || [];
      const updatedImages = currentImages.filter((img) => img.url !== imageUrl);
      handleImagesChange(updatedImages);
      showSnackbar('Zdjecie usuniete', 'success');
    } catch (error: any) {
      showSnackbar('Blad podczas usuwania zdjecia', 'error');
    }
  };

  const handleSetPrimary = (imageUrl: string) => {
    const currentImages: ServiceImage[] = editForm?.images || [];
    const updatedImages = currentImages.map((img) => ({
      ...img,
      isPrimary: img.url === imageUrl,
    }));
    handleImagesChange(updatedImages);
    showSnackbar('Ustawiono jako glowne zdjecie', 'success');
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter((prev) => prev + 1);
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter((prev) => prev - 1);
    if (dragCounter - 1 === 0) setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    setDragCounter(0);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
      e.dataTransfer.clearData();
    }
  };

  const navigateImage = (direction: 'prev' | 'next') => {
    if (!selectedImage) return;
    const imgs: ServiceImage[] = displayData.images || [];
    const currentIndex = imgs.findIndex((img) => img.url === selectedImage.url);
    const newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex >= 0 && newIndex < imgs.length) setSelectedImage(imgs[newIndex]);
  };

  const formatMoney = (value?: number | null) => {
    if (value == null) return '-';
    return `${Number(value).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zl`;
  };

  if (employeeLoading || serviceLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-[#e5e4e2]">Ladowanie...</div>
      </div>
    );
  }

  if (serviceError || !service) {
    return (
      <div className="py-12 text-center">
        <Wrench className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
        <p className="text-[#e5e4e2]/60">Nie znaleziono uslugi</p>
        <button onClick={() => router.back()} className="mt-4 text-[#d3bb73] hover:underline">
          Powrot
        </button>
      </div>
    );
  }

  const displayData = isEditing ? editForm : service;
  const galleryImages: ServiceImage[] = displayData?.images || [];

  return (
    <div className="min-h-screen bg-[#0a0d1a] p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="rounded-lg p-2 transition-colors hover:bg-[#d3bb73]/10"
            >
              <ArrowLeft className="h-5 w-5 text-[#e5e4e2]" />
            </button>
            <Wrench className="h-6 w-6 text-[#d3bb73]" />
            <div>
              <div className="text-sm text-[#e5e4e2]/60">Usluga podwykonawcy</div>
              <h1 className="text-xl font-semibold text-[#e5e4e2]">{displayData.name}</h1>
            </div>
          </div>
          {canEdit && (
            <div className="flex gap-2">
              {isEditing ? (
                <>
                  <button
                    onClick={handleCancelEdit}
                    className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] hover:bg-[#d3bb73]/10"
                  >
                    <X className="h-4 w-4" />
                    Anuluj
                  </button>
                  <button
                    onClick={handleSave}
                    className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#0f1119] hover:bg-[#c4a859]"
                  >
                    <Save className="h-4 w-4" />
                    Zapisz
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={handleDelete}
                    className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-900/20 px-4 py-2 text-red-400 hover:bg-red-900/30"
                  >
                    <Trash2 className="h-4 w-4" />
                    Usun
                  </button>
                  <button
                    onClick={handleEdit}
                    className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#0f1119] hover:bg-[#c4a859]"
                  >
                    <Edit className="h-4 w-4" />
                    Edytuj
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 space-y-6">
          <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-6">
            <h2 className="mb-4 text-lg font-semibold text-[#e5e4e2]">Podwykonawca</h2>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[#e5e4e2]/60">Firma:</span>
                <span className="text-[#e5e4e2]">
                  {service.subcontractor?.company_name || '-'}
                </span>
              </div>
              {service.subcontractor?.organization && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-[#e5e4e2]/60">Organizacja:</span>
                    <span className="text-[#e5e4e2]">
                      {service.subcontractor.organization.name}
                    </span>
                  </div>
                  {service.subcontractor.organization.email && (
                    <div className="flex items-center justify-between">
                      <span className="text-[#e5e4e2]/60">Email:</span>
                      <span className="text-[#e5e4e2]">
                        {service.subcontractor.organization.email}
                      </span>
                    </div>
                  )}
                  {service.subcontractor.organization.phone && (
                    <div className="flex items-center justify-between">
                      <span className="text-[#e5e4e2]/60">Telefon:</span>
                      <span className="text-[#e5e4e2]">
                        {service.subcontractor.organization.phone}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-6">
            <h2 className="mb-4 text-lg font-semibold text-[#e5e4e2]">Podstawowe informacje</h2>
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nazwa</label>
                {isEditing ? (
                  <input
                    type="text"
                    value={editForm.name || ''}
                    onChange={(e) => handleChange('name', e.target.value)}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
                  />
                ) : (
                  <div className="text-[#e5e4e2]">{displayData.name}</div>
                )}
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Opis</label>
                {isEditing ? (
                  <textarea
                    value={editForm.description || ''}
                    onChange={(e) => handleChange('description', e.target.value)}
                    rows={3}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
                  />
                ) : (
                  <div className="whitespace-pre-wrap text-[#e5e4e2]">
                    {displayData.description || '-'}
                  </div>
                )}
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Kategoria</label>
                {isEditing ? (
                  <input
                    type="text"
                    value={editForm.category || ''}
                    onChange={(e) => handleChange('category', e.target.value)}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
                    placeholder="np. Catering, Animacje, Dekoracje"
                  />
                ) : displayData.category ? (
                  <div className="inline-block rounded bg-blue-500/20 px-3 py-1 text-blue-400">
                    {displayData.category}
                  </div>
                ) : (
                  <div className="text-[#e5e4e2]/40">-</div>
                )}
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Jednostka</label>
                {isEditing ? (
                  <input
                    type="text"
                    value={editForm.unit || ''}
                    onChange={(e) => handleChange('unit', e.target.value)}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
                    placeholder="szt, godz, usluga"
                  />
                ) : (
                  <div className="text-[#e5e4e2]">{displayData.unit || '-'}</div>
                )}
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Status</label>
                {isEditing ? (
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={editForm.is_active || false}
                      onChange={(e) => handleChange('is_active', e.target.checked)}
                      className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73]"
                    />
                    <span className="text-sm text-[#e5e4e2]">Aktywna</span>
                  </label>
                ) : (
                  <div className="text-[#e5e4e2]">
                    {displayData.is_active ? (
                      <span className="text-green-400">Aktywna</span>
                    ) : (
                      <span className="text-red-400">Nieaktywna</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-6">
            <h2 className="mb-4 text-lg font-semibold text-[#e5e4e2]">Cennik</h2>

            <div className="mb-6">
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Stawka VAT</label>
              {isEditing ? (
                <select
                  value={editForm.vat_rate ?? 23}
                  onChange={(e) => {
                    const vat = parseFloat(e.target.value);
                    handleChange('vat_rate', vat);
                    if (editForm.price_net > 0) {
                      handleChange(
                        'price_gross',
                        Number((editForm.price_net * (1 + vat / 100)).toFixed(2)),
                      );
                    }
                  }}
                  className="w-full max-w-xs rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
                >
                  <option value={0}>0% (zwolniony z VAT)</option>
                  <option value={5}>5%</option>
                  <option value={8}>8%</option>
                  <option value={23}>23%</option>
                </select>
              ) : (
                <div className="text-[#e5e4e2]">
                  {displayData.vat_rate === 0 ? (
                    <span>0% (zwolniony z VAT)</span>
                  ) : (
                    <span>{displayData.vat_rate ?? 23}%</span>
                  )}
                </div>
              )}
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-3">
                <div className="text-sm font-medium text-[#d3bb73]">Cena netto</div>
                {isEditing ? (
                  <input
                    type="number"
                    step="0.01"
                    value={editForm.price_net || ''}
                    onChange={(e) => {
                      const net = parseFloat(e.target.value) || 0;
                      handleChange('price_net', net);
                      handleChange(
                        'price_gross',
                        Number((net * (1 + (editForm.vat_rate ?? 23) / 100)).toFixed(2)),
                      );
                      handleChange(
                        'unit_price',
                        Number((net * (1 + (editForm.vat_rate ?? 23) / 100)).toFixed(2)),
                      );
                    }}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
                    placeholder="0.00"
                  />
                ) : (
                  <div className="text-lg text-[#e5e4e2]">{formatMoney(displayData.price_net)}</div>
                )}
              </div>

              <div className="space-y-3">
                <div className="text-sm font-medium text-[#d3bb73]">Cena brutto</div>
                {isEditing ? (
                  <input
                    type="number"
                    step="0.01"
                    value={editForm.price_gross || ''}
                    onChange={(e) => {
                      const gross = parseFloat(e.target.value) || 0;
                      handleChange('price_gross', gross);
                      handleChange(
                        'price_net',
                        Number((gross / (1 + (editForm.vat_rate ?? 23) / 100)).toFixed(2)),
                      );
                      handleChange('unit_price', gross);
                    }}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 font-semibold text-[#e5e4e2]"
                    placeholder="0.00"
                  />
                ) : (
                  <div className="text-lg font-semibold text-[#e5e4e2]">
                    {formatMoney(displayData.price_gross)}
                  </div>
                )}
              </div>
            </div>

            {displayData.unit_price != null && displayData.unit_price > 0 && !isEditing && (
              <div className="mt-4 border-t border-[#d3bb73]/10 pt-4">
                <span className="text-sm text-[#e5e4e2]/60">Cena za jednostke: </span>
                <span className="font-semibold text-[#e5e4e2]">
                  {formatMoney(displayData.unit_price)} / {displayData.unit || 'szt'}
                </span>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-6">
            <h2 className="mb-4 text-lg font-semibold text-[#e5e4e2]">Galeria zdjec</h2>

            {canEdit && isEditing && (
              <div
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                className={`relative mb-6 rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
                  isDragging
                    ? 'border-[#d3bb73] bg-[#d3bb73]/5'
                    : 'border-[#d3bb73]/20 hover:border-[#d3bb73]/40'
                }`}
              >
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) uploadFiles(e.target.files);
                    e.target.value = '';
                  }}
                  className="absolute inset-0 cursor-pointer opacity-0"
                />
                <Upload className="mx-auto mb-4 h-12 w-12 text-[#d3bb73]/40" />
                <p className="mb-2 text-[#e5e4e2]">
                  Przeciagnij zdjecia tutaj lub kliknij aby wybrac
                </p>
                <p className="text-sm text-[#e5e4e2]/60">
                  Maksymalny rozmiar: 10MB (zdjecia zostana automatycznie skompresowane)
                </p>
              </div>
            )}

            {uploadingFiles.length > 0 && (
              <div className="mb-6 space-y-2">
                {uploadingFiles.map((name) => (
                  <div
                    key={name}
                    className="flex items-center gap-3 rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] p-3"
                  >
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#d3bb73] border-t-transparent" />
                    <span className="text-sm text-[#e5e4e2]">{name}</span>
                  </div>
                ))}
              </div>
            )}

            {galleryImages.length === 0 ? (
              <div className="py-12 text-center">
                <ImageIcon className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/10" />
                <p className="text-[#e5e4e2]/40">Brak zdjec</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                {galleryImages.map((image: ServiceImage, index: number) => (
                  <div
                    key={index}
                    className="group relative aspect-square overflow-hidden rounded-lg border border-[#d3bb73]/20"
                  >
                    <img
                      src={image.url}
                      alt={image.title || `Zdjecie ${index + 1}`}
                      className="h-full w-full cursor-pointer object-cover transition-transform group-hover:scale-110"
                      onClick={() => setSelectedImage(image)}
                    />
                    {image.isPrimary && (
                      <div className="absolute left-2 top-2 rounded-full bg-[#d3bb73] p-1">
                        <Star className="h-4 w-4 fill-[#0f1119] text-[#0f1119]" />
                      </div>
                    )}
                    {canEdit && isEditing && (
                      <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                        {!image.isPrimary && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSetPrimary(image.url);
                            }}
                            className="rounded-lg bg-[#d3bb73] p-2 transition-colors hover:bg-[#c4a859]"
                            title="Ustaw jako glowne"
                          >
                            <StarOff className="h-4 w-4 text-[#0f1119]" />
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteImage(image.url);
                          }}
                          className="rounded-lg bg-red-600 p-2 transition-colors hover:bg-red-700"
                          title="Usun"
                        >
                          <Trash2 className="h-4 w-4 text-white" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          onClick={() => setSelectedImage(null)}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              setSelectedImage(null);
            }}
            className="absolute right-4 top-4 rounded-lg bg-[#0f1119] p-2 text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]"
          >
            <X className="h-6 w-6" />
          </button>

          {galleryImages.length > 1 && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigateImage('prev');
                }}
                className="absolute left-4 rounded-lg bg-[#0f1119] p-2 text-[#e5e4e2] transition-colors hover:bg-[#d3bb73] disabled:opacity-30"
                disabled={
                  galleryImages.findIndex(
                    (img: ServiceImage) => img.url === selectedImage.url,
                  ) === 0
                }
              >
                <ChevronLeft className="h-6 w-6" />
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigateImage('next');
                }}
                className="absolute right-4 rounded-lg bg-[#0f1119] p-2 text-[#e5e4e2] transition-colors hover:bg-[#d3bb73] disabled:opacity-30"
                disabled={
                  galleryImages.findIndex(
                    (img: ServiceImage) => img.url === selectedImage.url,
                  ) ===
                  galleryImages.length - 1
                }
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}

          <img
            src={selectedImage.url}
            alt={selectedImage.title || 'Podglad'}
            className="max-h-[90vh] max-w-[90vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
