'use client';

import { systemLabel } from '@/lib/ui/systemLabels';

import { useEffect, useMemo, useState } from 'react';
import { Users, X, AlertCircle, CheckCircle, RotateCcw, Pencil, Eye } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { ProductStaffRow } from '../../types';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import { packageCostLineNet, staffCostItem, packageCostSettlementLabels } from '@/lib/CRM/Offers/productSalesPackages';
import { AddStaffModal } from '../modal/AddStuffModal';

type DraftStaff = Omit<ProductStaffRow, 'id' | 'product_id'> & { tempId: string };

interface RequiredSkill {
  skill_id: string;
  skill_name: string;
  skill_description?: string;
  category_name?: string;
  category_color?: string;
  minimum_proficiency: string;
  equipment_count: number;
  equipment_names: string[];
}

function makeTempId() {
  return `tmp_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

export function ProductStaffSection({
  productId, // null jeśli "new"
  productVariantId = null,
  productVariantName = null,
  isInherited = false,
  canEdit,
  draftStaff,
  setDraftStaff,
  onCustomizeVariant,
  onResetInheritance,
  onCostChange,
}: {
  productId: string | null;
  productVariantId?: string | null;
  productVariantName?: string | null;
  isInherited?: boolean;
  canEdit: boolean;
  draftStaff: DraftStaff[];
  setDraftStaff: (next: DraftStaff[]) => void;
  onCustomizeVariant?: () => Promise<void>;
  onResetInheritance?: () => Promise<void>;
  onCostChange?: (cost: number | null) => void;
}) {
  const { showSnackbar } = useSnackbar();
  const [staff, setStaff] = useState<ProductStaffRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddStaffModal, setShowAddStaffModal] = useState(false);
  const [requiredSkills, setRequiredSkills] = useState<RequiredSkill[]>([]);
  const [editingRow, setEditingRow] = useState<any>(null);
  const [previewRow, setPreviewRow] = useState(false);
  const staffCost = (row: any): number | null => {
    if (row.is_optional) return 0;
    if (row.compensation) { const line = staffCostItem({ ...row, notes: row.notes || '' }); return line ? packageCostLineNet(line) : null; }
    return row.hourly_rate != null && row.estimated_hours != null ? Math.round(Number(row.hourly_rate)*Number(row.estimated_hours)*Number(row.quantity)*100)/100 : null;
  };
  const [loadingSkills, setLoadingSkills] = useState(false);

  const isNew = !productId;

  const list = useMemo(() => {
    if (isNew) return draftStaff;
    return staff;
  }, [isNew, draftStaff, staff]);

  useEffect(() => {
    const costs = list.map(staffCost);
    onCostChange?.(loading || costs.some(c => c == null) ? null : costs.reduce<number>((sum,c) => sum + (c ?? 0),0));
  }, [list, loading, onCostChange]);

  useEffect(() => {
    if (!productId) return;
    fetchStaff(productId, isInherited ? null : productVariantId);
    fetchRequiredSkills(productId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, productVariantId, isInherited]);

  const fetchRequiredSkills = async (pid: string) => {
    setLoadingSkills(true);
    try {
      const { data, error } = await supabase.rpc('get_product_required_skills', {
        p_product_id: pid,
      });

      if (error) throw error;
      setRequiredSkills((data as RequiredSkill[]) || []);
    } catch (e: any) {
      console.error('Błąd pobierania wymaganych umiejętności:', e?.message);
    } finally {
      setLoadingSkills(false);
    }
  };

  const fetchStaff = async (pid: string, variantId: string | null = null) => {
    setLoading(true);
    try {
      let query = supabase
        .from('offer_product_staff')
        .select('*')
        .eq('product_id', pid)
        .order('created_at', { ascending: true });

      query = variantId
        ? query.eq('product_variant_id', variantId)
        : query.is('product_variant_id', null);

      const { data, error } = await query;

      if (error) throw error;
      setStaff((data ?? []) as ProductStaffRow[]);
    } catch (e: any) {
      showSnackbar(e?.message || 'Błąd pobierania wymagań kadrowych', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (payload: Omit<ProductStaffRow, 'id' | 'product_id'>) => {
    if (!canEdit) return;

    // NEW: zapis do Wersja robocza
    if (!productId) {
      setDraftStaff([{ ...payload, tempId: makeTempId() }, ...draftStaff]);
      showSnackbar('Dodano rolę (wersja robocza). Zapisz produkt, aby utrwalić.', 'success');
      return;
    }

    // EXISTING: zapis do bazy
    try {
      setLoading(true);
      const { error } = await supabase.from('offer_product_staff').insert({
        ...payload,
        product_id: productId,
        product_variant_id: productVariantId,
      });
      if (error) throw error;

      showSnackbar('Rola dodana', 'success');
      await fetchStaff(productId, productVariantId);
    } catch (e: any) {
      showSnackbar(e?.message || 'Błąd podczas dodawania roli', 'error');
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (idOrTempId: string) => {
    if (!canEdit) return;

    if (!productId) {
      setDraftStaff(draftStaff.filter((x) => x.tempId !== idOrTempId));
      showSnackbar('Usunięto rolę z wersji roboczej', 'success');
      return;
    }

    try {
      setLoading(true);
      const { error } = await supabase.from('offer_product_staff').delete().eq('id', idOrTempId);
      if (error) throw error;

      showSnackbar('Rola usunięta', 'success');
      await fetchStaff(productId, productVariantId);
    } catch (e: any) {
      showSnackbar(e?.message || 'Błąd podczas usuwania roli', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-[#d3bb73]" />
          <div>
            <h2 className="text-lg font-medium text-[#e5e4e2]">Wymagani pracownicy</h2>
            {productVariantName && (
              <p className="mt-0.5 text-xs text-[#e5e4e2]/45">
                {isInherited
                  ? `${productVariantName} dziedziczy personel produktu bazowego`
                  : `Własny personel wariantu: ${productVariantName}`}
              </p>
            )}
          </div>
          {isNew && (
            <span className="ml-2 rounded bg-[#d3bb73]/15 px-2 py-0.5 text-xs text-[#d3bb73]">
              Wersja robocza
            </span>
          )}
          {requiredSkills.length > 0 && (
            <div className="ml-2 flex items-center gap-1 rounded-full bg-yellow-500/20 px-2 py-0.5">
              <AlertCircle className="h-3.5 w-3.5 text-yellow-400" />
              <span className="text-xs text-yellow-400">
                {requiredSkills.length} wymaganych umiejętności
              </span>
            </div>
          )}
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {productVariantId && isInherited ? (
              <button
                type="button"
                onClick={() => void onCustomizeVariant?.()}
                className="rounded-lg bg-[#d3bb73]/20 px-3 py-1 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/30"
              >
                Dostosuj wariant
              </button>
            ) : (
              <>
                {productVariantId && onResetInheritance && (
                  <button
                    type="button"
                    onClick={() => void onResetInheritance()}
                    className="flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1 text-sm text-[#e5e4e2]/70 hover:bg-white/10"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Dziedzicz bazowe
                  </button>
                )}
                <button
                  onClick={() => setShowAddStaffModal(true)}
                  className="rounded-lg bg-[#d3bb73]/20 px-3 py-1 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/30"
                >
                  + Dodaj rolę
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Alert z wymaganymi umiejętnościami */}
      {requiredSkills.length > 0 && (
        <div className="mb-4 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-4">
          <div className="mb-2 flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-yellow-400" />
            <h3 className="font-medium text-yellow-300">Sprzęt wymaga specjalnych umiejętności</h3>
          </div>
          <p className="mb-3 text-sm text-yellow-200/80">
            Wybierz pracowników, którzy posiadają poniższe umiejętności:
          </p>
          <div className="space-y-2">
            {requiredSkills.map((skill) => (
              <div key={skill.skill_id} className="rounded-lg bg-[#0a0d1a]/50 p-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[#e5e4e2]">{skill.skill_name}</span>
                      <span className="rounded bg-[#d3bb73]/20 px-2 py-0.5 text-xs text-[#d3bb73]">
                        min. {skill.minimum_proficiency}
                      </span>
                      {skill.category_name && (
                        <span
                          className="rounded px-2 py-0.5 text-xs"
                          style={{
                            backgroundColor: skill.category_color
                              ? `${skill.category_color}20`
                              : '#d3bb7320',
                            color: skill.category_color || '#d3bb73',
                          }}
                        >
                          {skill.category_name}
                        </span>
                      )}
                    </div>
                    {skill.skill_description && (
                      <p className="mt-1 text-xs text-[#e5e4e2]/60">{skill.skill_description}</p>
                    )}
                    {skill.equipment_names && skill.equipment_names.length > 0 && (
                      <p className="mt-1 text-xs text-[#e5e4e2]/40">
                        Wymagane przez: {skill.equipment_names.join(', ')}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <p className="py-8 text-center text-sm text-[#e5e4e2]/60">Ładowanie…</p>
      ) : list.length === 0 ? (
        <p className="py-8 text-center text-sm text-[#e5e4e2]/60">Brak wymagań kadrowych</p>
      ) : (
        <div className="space-y-2">
          {list.map((item: any) => {
            const key = productId ? item.id : item.tempId;

            return (
              <div
                key={key}
                className="flex items-center justify-between rounded-lg bg-[#0a0d1a] p-3"
              >
                <div>
                  <div className="font-medium text-[#e5e4e2]">{systemLabel(item.role, 'role', { preserveCustom: true })}</div>

                  <div className="mt-1 text-xs text-[#e5e4e2]/60">
                    {item.notes ? item.notes : '—'}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
                  <span className="text-[#e5e4e2]/80">Ilość: {item.quantity}</span>

                  {!item.compensation && item.hourly_rate != null && (
                    <span className="text-[#e5e4e2]/80">{item.hourly_rate} zł/h</span>
                  )}
                  {!item.compensation && item.estimated_hours != null && (
                    <span className="text-[#e5e4e2]/80">~{item.estimated_hours}h</span>
                  )}

                  {item.is_optional && (
                    <span className="rounded bg-blue-500/20 px-2 py-1 text-xs text-blue-400">
                      Opcjonalny
                    </span>
                  )}

                  <span className="text-[#d3bb73]">{staffCost(item) == null ? 'Koszt nieustalony' : `${staffCost(item)!.toLocaleString('pl-PL')} zł kosztu`}</span>
                  {item.compensation && <span className="text-xs text-[#e5e4e2]/50">{packageCostSettlementLabels[item.compensation.settlement_method as keyof typeof packageCostSettlementLabels]}</span>}
                  <ResponsiveActionBar alwaysDropdown compact actions={[
                    { label: 'Podgląd', icon: <Eye className="h-4 w-4"/>, onClick: () => {setEditingRow(item);setPreviewRow(true);} },
                    { label: 'Edytuj', icon: <Pencil className="h-4 w-4"/>, show: canEdit && !isInherited, onClick: () => {setEditingRow(item);setPreviewRow(false);} },
                    { label: 'Usuń', icon: <X className="h-4 w-4"/>, show: canEdit && !isInherited, variant: 'danger', onClick: () => void handleDelete(key) },
                  ]}/>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editingRow && <AddStaffModal productId={productId || ''} productVariantName={productVariantName} initialValue={editingRow} readOnly={previewRow}
        onClose={() => setEditingRow(null)} onSubmit={async payload => {
          if (!canEdit || isInherited) throw new Error('Brak uprawnień do edycji tej obsady.');
          if (!productId) { setDraftStaff(draftStaff.map(row => row.tempId === editingRow.tempId ? { ...row, ...payload } : row)); return; }
          const { id, product_id, ...values } = payload;
          const { error } = await supabase.from('offer_product_staff').update(values).eq('id',editingRow.id).eq('product_id',productId);
          if (error) throw error;
          await fetchStaff(productId, productVariantId); showSnackbar('Zapisano rolę i koszt','success');
        }}/>}
      {showAddStaffModal && (
        <AddStaffModal
          productId={productId as string}
          productVariantName={productVariantName}
          onClose={() => setShowAddStaffModal(false)}
          onSubmit={async (payload) => {
            await handleAdd(payload);
            setShowAddStaffModal(false);
          }}
        />
      )}
    </div>
  );
}
