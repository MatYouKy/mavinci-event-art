'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import type { ICustomIcon, IEventCategory } from '../types';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

type SimpleRow = { id: string; name: string };
type OfferTemplateCategoryRow = { id: string; name: string; color: string };

type UpsertCategoryPayload = {
  name: string;
  color: string;
  description?: string;
  is_active: boolean;
  icon_id?: string | null;
  contract_template_id?: string | null;
  default_offer_template_category_id?: string | null;
};

type UpsertIconPayload = {
  name: string;
  svg_code: string;
  preview_color: string;
};

export function useEventCategories() {
  const { employee, sessionUserId, refreshSession, hasScope } = useCurrentEmployee();

  const [categories, setCategories] = useState<IEventCategory[]>([]);
  const [icons, setIcons] = useState<ICustomIcon[]>([]);
  const [contractTemplates, setContractTemplates] = useState<SimpleRow[]>([]);
  const [offerTemplateCategories, setOfferTemplateCategories] = useState<
    OfferTemplateCategoryRow[]
  >([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isSavingCategory, setIsSavingCategory] = useState(false);
  const [isSavingIcon, setIsSavingIcon] = useState(false);
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null);
  const [deletingIconId, setDeletingIconId] = useState<string | null>(null);

  const canManageEventCategories = useMemo(() => {
    // PermissionGuard i tak to ogarnia w UI, ale tu robimy "twardy" backend-check w hooku.
    return !!employee && hasScope('event_categories_manage');
  }, [employee, hasScope]);

  const ensureSessionUserId = useCallback(async () => {
    // Daje Ci identyczny efekt jak ręczne supabase.auth.refreshSession()
    return sessionUserId ?? (await refreshSession());
  }, [sessionUserId, refreshSession]);

  const requireManagePermission = useCallback(() => {
    if (!canManageEventCategories) {
      throw new Error('Brak uprawnień: event_categories_manage. Skontaktuj się z administratorem.');
    }
  }, [canManageEventCategories]);

  const fetchCategories = useCallback(async () => {
    const { data, error } = await supabase
      .from('event_categories')
      .select(
        `
        *,
        icon:custom_icons(id, name, svg_code, preview_color)
      `,
      )
      .order('name');

    if (error) throw error;
    setCategories((data ?? []) as IEventCategory[]);
  }, []);

  const fetchIcons = useCallback(async () => {
    const { data, error } = await supabase.from('custom_icons').select('*').order('name');
    if (error) throw error;
    setIcons((data ?? []) as ICustomIcon[]);
  }, []);

  const getCategoryById = useCallback(
    async (categoryId: string) => {
      if (!categoryId) return null;

      // 1) najpierw spróbuj ze stanu (szybko, bez requestu)
      const cached = categories.find((c) => c.id === categoryId);
      if (cached) return cached;

      // 2) jeśli nie ma w stanie – pobierz z bazy
      const { data, error } = await supabase
        .from('event_categories')
        .select(
          `
            *,
            icon:custom_icons(id, name, svg_code, preview_color)
          `,
        )
        .eq('id', categoryId)
        .maybeSingle();

      if (error) throw error;
      return (data ?? null) as IEventCategory | null;
    },
    [categories],
  );

  const fetchContractTemplates = useCallback(async () => {
    const { data, error } = await supabase
      .from('contract_templates')
      .select('id, name')
      .eq('is_active', true)
      .order('name');

    if (error) throw error;
    setContractTemplates((data ?? []) as SimpleRow[]);
  }, []);

  const fetchOfferTemplateCategories = useCallback(async () => {
    const { data, error } = await supabase
      .from('offer_template_categories')
      .select('id, name, color')
      .order('is_default', { ascending: false })
      .order('name');

    if (error) throw error;
    setOfferTemplateCategories((data ?? []) as OfferTemplateCategoryRow[]);
  }, []);

  const refetchAll = useCallback(async () => {
    await Promise.all([
      fetchCategories(),
      fetchIcons(),
      fetchContractTemplates(),
      fetchOfferTemplateCategories(),
    ]);
  }, [fetchCategories, fetchIcons, fetchContractTemplates, fetchOfferTemplateCategories]);

  useEffect(() => {
    (async () => {
      try {
        await refetchAll();
      } catch (e) {
        console.error('[useEventCategories] init fetch error:', e);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [refetchAll]);

  const upsertCategory = useCallback(
    async (payload: UpsertCategoryPayload, editingCategoryId?: string | null) => {
      requireManagePermission();
      setIsSavingCategory(true);

      try {
        const dataToSave = {
          ...payload,
          icon_id: payload.icon_id || null,
          contract_template_id: payload.contract_template_id || null,
          default_offer_template_category_id: payload.default_offer_template_category_id || null,
          updated_at: new Date().toISOString(),
        };

        if (editingCategoryId) {
          const { error } = await supabase
            .from('event_categories')
            .update(dataToSave)
            .eq('id', editingCategoryId);

          if (error) throw error;
        } else {
          const { error } = await supabase.from('event_categories').insert([dataToSave]);
          if (error) throw error;
        }

        await fetchCategories();
      } finally {
        setIsSavingCategory(false);
      }
    },
    [fetchCategories, requireManagePermission],
  );

  const deleteCategory = useCallback(
    async (categoryId: string) => {
      requireManagePermission();
      setDeletingCategoryId(categoryId);

      try {
        const { error } = await supabase.from('event_categories').delete().eq('id', categoryId);
        if (error) throw error;

        await fetchCategories();
      } finally {
        setDeletingCategoryId(null);
      }
    },
    [fetchCategories, requireManagePermission],
  );

  const upsertIcon = useCallback(
    async (payload: UpsertIconPayload, editingIconId?: string | null) => {
      requireManagePermission();
      setIsSavingIcon(true);

      try {
        const userId = await ensureSessionUserId();
        if (!userId) throw new Error('Nie można odświeżyć sesji. Zaloguj się ponownie.');

        if (editingIconId) {
          const { error } = await supabase
            .from('custom_icons')
            .update({
              name: payload.name,
              svg_code: payload.svg_code,
              preview_color: payload.preview_color,
              updated_at: new Date().toISOString(),
            })
            .eq('id', editingIconId);

          if (error) throw error;
        } else {
          const { error } = await supabase.from('custom_icons').insert([
            {
              name: payload.name,
              svg_code: payload.svg_code,
              preview_color: payload.preview_color,
              created_by: userId,
            },
          ]);

          if (error) throw error;
        }

        // Ikony wpływają na picker + kategorie (relacja icon:custom_icons)
        await Promise.all([fetchIcons(), fetchCategories()]);
      } finally {
        setIsSavingIcon(false);
      }
    },
    [ensureSessionUserId, fetchCategories, fetchIcons, requireManagePermission],
  );

  const deleteIcon = useCallback(
    async (iconId: string) => {
      requireManagePermission();
      setDeletingIconId(iconId);

      try {
        const { error } = await supabase.from('custom_icons').delete().eq('id', iconId);
        if (error) throw error;

        await Promise.all([fetchIcons(), fetchCategories()]);
      } finally {
        setDeletingIconId(null);
      }
    },
    [fetchCategories, fetchIcons, requireManagePermission],
  );

  return {
    // data
    categories,
    icons,
    contractTemplates,
    offerTemplateCategories,

    // state
    isLoading,
    isSavingCategory,
    isSavingIcon,
    deletingCategoryId,
    deletingIconId,

    // actions
    refetchAll,
    upsertCategory,
    deleteCategory,
    upsertIcon,
    deleteIcon,
    getCategoryById,
  };
}
