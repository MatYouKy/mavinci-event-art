'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface PricingTableConfig {
  start_y: number;
  header_color: string;
  row_bg_color: string;
  text_color: string;
  show_unit_price_net: boolean;
  show_value_net: boolean;
  show_value_gross: boolean;
  vat_rate: number;
}

interface PricingTableConfigEditorProps {
  templateId: string;
  initialConfig?: PricingTableConfig;
  onSave?: () => void;
}

export default function PricingTableConfigEditor({
  templateId,
  initialConfig,
  onSave,
}: PricingTableConfigEditorProps) {
  const { showSnackbar } = useSnackbar();
  const [saving, setSaving] = useState(false);

  const [config, setConfig] = useState<PricingTableConfig>(
    initialConfig || {
      start_y: 200,
      header_color: '#d3bb73',
      row_bg_color: '#f2f2f2',
      text_color: '#1c1f33',
      show_unit_price_net: true,
      show_value_net: true,
      show_value_gross: true,
      vat_rate: 23,
    }
  );

  useEffect(() => {
    if (initialConfig) {
      setConfig(initialConfig);
    }
  }, [initialConfig]);

  const handleSave = async () => {
    try {
      setSaving(true);

      const { error } = await supabase
        .from('offer_page_templates')
        .update({ table_config: config })
        .eq('id', templateId);

      if (error) throw error;

      showSnackbar('Konfiguracja tabeli wyceny została zapisana', 'success');
      onSave?.();
    } catch (err: any) {
      console.error('Error saving table config:', err);
      showSnackbar(err.message || 'Błąd podczas zapisywania konfiguracji', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 rounded-xl border border-[#d3bb73]/20 bg-[#0f1117] p-6">
      <h3 className="text-lg font-light text-[#e5e4e2]">Konfiguracja tabeli wyceny</h3>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Pozycja Y */}
        <div>
          <label className="mb-2 block text-sm text-[#e5e4e2]/60">
            Pozycja Y od góry strony (px)
          </label>
          <input
            type="number"
            value={config.start_y}
            onChange={(e) => setConfig({ ...config, start_y: parseInt(e.target.value) || 200 })}
            className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            min="50"
            max="700"
          />
          <p className="mt-1 text-xs text-[#e5e4e2]/40">
            Im wyższa wartość, tym niżej na stronie (50-700)
          </p>
        </div>

        {/* Stawka VAT */}
        <div>
          <label className="mb-2 block text-sm text-[#e5e4e2]/60">
            Domyślna stawka VAT (%)
          </label>
          <input
            type="number"
            value={config.vat_rate}
            onChange={(e) => setConfig({ ...config, vat_rate: parseInt(e.target.value) || 23 })}
            className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            min="0"
            max="100"
          />
        </div>

        {/* Kolor nagłówka */}
        <div>
          <label className="mb-2 block text-sm text-[#e5e4e2]/60">
            Kolor tła nagłówka
          </label>
          <div className="flex gap-2">
            <input
              type="color"
              value={config.header_color}
              onChange={(e) => setConfig({ ...config, header_color: e.target.value })}
              className="h-10 w-16 cursor-pointer rounded border border-[#d3bb73]/20"
            />
            <input
              type="text"
              value={config.header_color}
              onChange={(e) => setConfig({ ...config, header_color: e.target.value })}
              className="flex-1 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              placeholder="#d3bb73"
            />
          </div>
        </div>

        {/* Kolor tła wierszy */}
        <div>
          <label className="mb-2 block text-sm text-[#e5e4e2]/60">
            Kolor tła wierszy parzystych
          </label>
          <div className="flex gap-2">
            <input
              type="color"
              value={config.row_bg_color}
              onChange={(e) => setConfig({ ...config, row_bg_color: e.target.value })}
              className="h-10 w-16 cursor-pointer rounded border border-[#d3bb73]/20"
            />
            <input
              type="text"
              value={config.row_bg_color}
              onChange={(e) => setConfig({ ...config, row_bg_color: e.target.value })}
              className="flex-1 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              placeholder="#f2f2f2"
            />
          </div>
        </div>

        {/* Kolor tekstu */}
        <div>
          <label className="mb-2 block text-sm text-[#e5e4e2]/60">
            Kolor tekstu
          </label>
          <div className="flex gap-2">
            <input
              type="color"
              value={config.text_color}
              onChange={(e) => setConfig({ ...config, text_color: e.target.value })}
              className="h-10 w-16 cursor-pointer rounded border border-[#d3bb73]/20"
            />
            <input
              type="text"
              value={config.text_color}
              onChange={(e) => setConfig({ ...config, text_color: e.target.value })}
              className="flex-1 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              placeholder="#1c1f33"
            />
          </div>
        </div>
      </div>

      {/* Checkboxy dla kolumn */}
      <div className="space-y-3 border-t border-[#d3bb73]/10 pt-4">
        <h4 className="text-sm font-medium text-[#e5e4e2]/80">Widoczne kolumny</h4>

        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={config.show_unit_price_net}
            onChange={(e) => setConfig({ ...config, show_unit_price_net: e.target.checked })}
            className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73] focus:ring-[#d3bb73]"
          />
          <span className="text-sm text-[#e5e4e2]">Pokaż cenę jednostkową netto</span>
        </label>

        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={config.show_value_net}
            onChange={(e) => setConfig({ ...config, show_value_net: e.target.checked })}
            className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73] focus:ring-[#d3bb73]"
          />
          <span className="text-sm text-[#e5e4e2]">Pokaż wartość netto</span>
        </label>

        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={config.show_value_gross}
            onChange={(e) => setConfig({ ...config, show_value_gross: e.target.checked })}
            className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#1c1f33] text-[#d3bb73] focus:ring-[#d3bb73]"
          />
          <span className="text-sm text-[#e5e4e2]">Pokaż wartość brutto</span>
        </label>
      </div>

      {/* Podgląd tabeli wyceny */}
      <div className="rounded-lg border border-[#d3bb73]/10 bg-white p-4">
        <h4 className="mb-4 text-sm font-medium text-[#1c1f33]">Podgląd tabeli wyceny</h4>

        {/* Tabela */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" style={{ minWidth: '600px' }}>
            {/* Nagłówek */}
            <thead>
              <tr style={{ backgroundColor: config.header_color }}>
                <th className="px-3 py-2 text-left text-sm font-semibold text-white" style={{ width: '40px' }}>
                  Lp.
                </th>
                <th className="px-3 py-2 text-left text-sm font-semibold text-white">
                  Nazwa pozycji
                </th>
                <th className="px-3 py-2 text-center text-sm font-semibold text-white" style={{ width: '60px' }}>
                  Ilość
                </th>
                <th className="px-3 py-2 text-center text-sm font-semibold text-white" style={{ width: '50px' }}>
                  Jedn.
                </th>
                {config.show_unit_price_net && (
                  <th className="px-3 py-2 text-right text-sm font-semibold text-white" style={{ width: '100px' }}>
                    Cena jedn. netto
                  </th>
                )}
                {config.show_value_net && (
                  <th className="px-3 py-2 text-right text-sm font-semibold text-white" style={{ width: '120px' }}>
                    Wartość netto
                  </th>
                )}
                {config.show_value_gross && (
                  <th className="px-3 py-2 text-right text-sm font-semibold text-white" style={{ width: '120px' }}>
                    Wartość brutto
                  </th>
                )}
              </tr>
            </thead>

            {/* Wiersze przykładowe */}
            <tbody>
              {[
                { name: 'DJ Standard', qty: 1, unit: 'szt', price: 1000 },
                { name: 'Nagłośnienie BOSE', qty: 2, unit: 'szt', price: 500 },
                { name: 'Oświetlenie LED', qty: 1, unit: 'kpl', price: 800 },
              ].map((item, index) => {
                const isEven = index % 2 === 0;
                const valueNet = item.qty * item.price;
                const valueGross = valueNet * (1 + config.vat_rate / 100);

                return (
                  <tr
                    key={index}
                    style={{
                      backgroundColor: isEven ? config.row_bg_color : '#ffffff',
                      color: config.text_color,
                    }}
                  >
                    <td className="px-3 py-2 text-sm">{index + 1}.</td>
                    <td className="px-3 py-2 text-sm">{item.name}</td>
                    <td className="px-3 py-2 text-center text-sm">{item.qty}</td>
                    <td className="px-3 py-2 text-center text-sm">{item.unit}</td>
                    {config.show_unit_price_net && (
                      <td className="px-3 py-2 text-right text-sm">{item.price.toFixed(2)}</td>
                    )}
                    {config.show_value_net && (
                      <td className="px-3 py-2 text-right text-sm">{valueNet.toFixed(2)}</td>
                    )}
                    {config.show_value_gross && (
                      <td className="px-3 py-2 text-right text-sm">{valueGross.toFixed(2)}</td>
                    )}
                  </tr>
                );
              })}
            </tbody>

            {/* Suma */}
            <tfoot>
              <tr style={{ borderTop: `2px solid ${config.header_color}` }}>
                <td colSpan={4} className="px-3 py-3"></td>
                {config.show_unit_price_net && <td className="px-3 py-3"></td>}
                {config.show_value_net && (
                  <td className="px-3 py-3 text-right text-sm font-bold" style={{ color: config.text_color }}>
                    <div className="mb-1 text-xs font-normal">SUMA NETTO:</div>
                    <div style={{ color: config.header_color }}>2 800.00 PLN</div>
                  </td>
                )}
                {config.show_value_gross && (
                  <td className="px-3 py-3 text-right text-sm font-bold" style={{ color: config.text_color }}>
                    <div className="mb-1 text-xs font-normal">SUMA BRUTTO:</div>
                    <div style={{ color: config.header_color }}>3 444.00 PLN</div>
                  </td>
                )}
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="mt-4 rounded bg-blue-50 p-3 text-xs text-blue-800">
          <strong>Pozycja Y: {config.start_y}px</strong> - tabela będzie renderowana {config.start_y}px od góry strony PDF
        </div>
      </div>

      {/* Przycisk zapisz */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full rounded-lg bg-[#d3bb73] px-6 py-3 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? 'Zapisywanie...' : 'Zapisz konfigurację'}
      </button>
    </div>
  );
}
