'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, MonitorPlay } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';

type LiveModule = {
  module_key: string;
  name: string;
  description: string | null;
  display_order: number;
};

type Props = {
  productId: string;
  canEdit: boolean;
};

const isMissingSchema = (message?: string) =>
  /does not exist|schema cache|PGRST205|42P01/i.test(message || '');

export function ProductMavinciLiveModules({ productId, canEdit }: Props) {
  const { showSnackbar } = useSnackbar();
  const [modules, setModules] = useState<LiveModule[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [missingSchema, setMissingSchema] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMissingSchema(false);

    const [modulesResult, linksResult] = await Promise.all([
      supabase
        .from('mavinci_live_modules')
        .select('module_key,name,description,display_order')
        .eq('is_active', true)
        .order('display_order'),
      supabase
        .from('offer_product_mavinci_live_modules')
        .select('module_key')
        .eq('product_id', productId),
    ]);

    setLoading(false);

    const firstError = modulesResult.error || linksResult.error;
    if (firstError) {
      if (isMissingSchema(firstError.message)) {
        setMissingSchema(true);
        return;
      }
      showSnackbar(firstError.message, 'error');
      return;
    }

    setModules((modulesResult.data || []) as LiveModule[]);
    setSelectedKeys((linksResult.data || []).map((item) => item.module_key));
  }, [productId, showSnackbar]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleModule = async (moduleKey: string) => {
    if (!canEdit || savingKey) return;
    const selected = selectedKeys.includes(moduleKey);
    setSavingKey(moduleKey);

    const result = selected
      ? await supabase
          .from('offer_product_mavinci_live_modules')
          .delete()
          .eq('product_id', productId)
          .eq('module_key', moduleKey)
      : await supabase.from('offer_product_mavinci_live_modules').insert({
          product_id: productId,
          module_key: moduleKey,
        });

    setSavingKey(null);
    if (result.error) {
      showSnackbar(result.error.message, 'error');
      return;
    }

    setSelectedKeys((current) =>
      selected ? current.filter((key) => key !== moduleKey) : [...current, moduleKey],
    );
    showSnackbar(
      selected
        ? 'Usunięto powiązanie z Mavinci LIVE'
        : 'Produkt będzie uruchamiał odpowiednią zawartość Mavinci LIVE',
      'success',
    );
  };

  return (
    <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="rounded-lg bg-[#d3bb73]/10 p-3 text-[#d3bb73]">
          <MonitorPlay className="h-5 w-5" />
        </span>
        <div>
          <p className="text-xs font-bold uppercase tracking-[.18em] text-[#d3bb73]">
            Mavinci LIVE
          </p>
          <h2 className="text-lg font-medium text-[#e5e4e2]">Zawartość uruchamiana przez produkt</h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-[#e5e4e2]/55">
            Gdy ten produkt znajdzie się w ofercie wydarzenia, pojawi się zakładka Mavinci LIVE
            z wybranymi modułami. Brak wyboru oznacza, że produkt nie wymaga tej części realizacji.
          </p>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center rounded-lg border border-white/10 p-8 text-sm text-[#e5e4e2]/55">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Wczytuję moduły…
        </div>
      )}

      {!loading && missingSchema && (
        <div className="rounded-lg border border-amber-400/25 bg-amber-400/10 p-4 text-sm text-amber-100">
          Zastosuj migrację <strong>20260826100000_link_offer_products_to_mavinci_live.sql</strong>,
          aby włączyć przypisywanie zawartości.
        </div>
      )}

      {!loading && !missingSchema && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {modules.map((module) => {
            const selected = selectedKeys.includes(module.module_key);
            const saving = savingKey === module.module_key;
            return (
              <button
                key={module.module_key}
                type="button"
                disabled={!canEdit || Boolean(savingKey)}
                onClick={() => void toggleModule(module.module_key)}
                className={`flex min-h-28 items-start gap-3 rounded-xl border p-4 text-left transition disabled:cursor-default ${
                  selected
                    ? 'border-[#d3bb73]/55 bg-[#d3bb73]/10'
                    : 'border-white/10 bg-[#111522] hover:border-white/20'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                    selected
                      ? 'border-[#d3bb73] bg-[#d3bb73] text-[#111522]'
                      : 'border-white/25 text-transparent'
                  }`}
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                </span>
                <span>
                  <strong className="block text-sm text-[#e5e4e2]">{module.name}</strong>
                  <small className="mt-1 block text-xs leading-relaxed text-[#e5e4e2]/45">
                    {module.description || 'Moduł zawartości Mavinci LIVE'}
                  </small>
                </span>
              </button>
            );
          })}
          {modules.length === 0 && (
            <div className="col-span-full rounded-lg border border-dashed border-white/10 p-8 text-center text-sm text-[#e5e4e2]/45">
              Brak aktywnych modułów Mavinci LIVE.
            </div>
          )}
        </div>
      )}
    </section>
  );
}
