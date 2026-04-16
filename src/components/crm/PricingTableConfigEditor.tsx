'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { Save, RotateCcw, ChevronDown, ChevronRight } from 'lucide-react';

export interface PricingTableConfig {
  start_y: number;
  margin_left: number;
  margin_right: number;
  header_color: string;
  header_text_color: string;
  row_bg_color: string;
  row_odd_bg_color: string;
  text_color: string;
  border_color: string;
  border_width: number;
  show_borders: boolean;
  show_horizontal_borders: boolean;
  show_vertical_borders: boolean;
  show_outer_border: boolean;
  header_font_size: number;
  body_font_size: number;
  row_height: number;
  header_height: number;
  summary_color: string;
  summary_label_color: string;
  show_unit_price_net: boolean;
  show_value_net: boolean;
  show_value_gross: boolean;
  show_vat_column: boolean;
  show_description: boolean;
  vat_rate: number;
  col_lp_width: number;
  col_name_width: number;
  col_qty_width: number;
  col_unit_width: number;
  col_unit_price_width: number;
  col_vat_width: number;
  col_value_net_width: number;
  col_value_gross_width: number;
  summary_separator_thickness: number;
  table_width: number;
}

const DEFAULT_CONFIG: PricingTableConfig = {
  start_y: 200,
  margin_left: 50,
  margin_right: 50,
  header_color: '#d3bb73',
  header_text_color: '#ffffff',
  row_bg_color: '#f2f2f2',
  row_odd_bg_color: '#ffffff',
  text_color: '#1c1f33',
  border_color: '#cccccc',
  border_width: 0.5,
  show_borders: false,
  show_horizontal_borders: true,
  show_vertical_borders: false,
  show_outer_border: false,
  header_font_size: 11,
  body_font_size: 10,
  row_height: 25,
  header_height: 30,
  summary_color: '#d3bb73',
  summary_label_color: '#1c1f33',
  show_unit_price_net: true,
  show_value_net: true,
  show_value_gross: true,
  show_vat_column: false,
  show_description: false,
  vat_rate: 23,
  col_lp_width: 30,
  col_name_width: 0,
  col_qty_width: 50,
  col_unit_width: 45,
  col_unit_price_width: 70,
  col_vat_width: 45,
  col_value_net_width: 80,
  col_value_gross_width: 80,
  summary_separator_thickness: 2,
  table_width: 0,
};

interface PricingTableConfigEditorProps {
  templateId: string;
  initialConfig?: Partial<PricingTableConfig>;
  onSave?: () => void;
  embedded?: boolean;
}

function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs text-[#e5e4e2]/60">{label}</label>
      <div className="flex gap-1.5">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded border border-[#d3bb73]/20"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-2.5 py-1 text-xs text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
        />
      </div>
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs text-[#e5e4e2]/60">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-2.5 py-1.5 text-xs text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
          min={min}
          max={max}
          step={step || 1}
        />
        {suffix && <span className="text-xs text-[#e5e4e2]/40">{suffix}</span>}
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5">
      <div
        className={`relative h-5 w-9 rounded-full transition-colors ${checked ? 'bg-[#d3bb73]' : 'bg-[#1c1f33] ring-1 ring-[#d3bb73]/20'}`}
        onClick={() => onChange(!checked)}
      >
        <div
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`}
        />
      </div>
      <span className="text-xs text-[#e5e4e2]">{label}</span>
    </label>
  );
}

function Section({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? true);

  return (
    <div className="border-b border-[#d3bb73]/10 last:border-b-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between py-2.5 text-left"
      >
        <span className="text-sm font-medium text-[#e5e4e2]">{title}</span>
        {open ? (
          <ChevronDown className="h-4 w-4 text-[#e5e4e2]/40" />
        ) : (
          <ChevronRight className="h-4 w-4 text-[#e5e4e2]/40" />
        )}
      </button>
      {open && <div className="space-y-3 pb-4">{children}</div>}
    </div>
  );
}

const SAMPLE_ITEMS = [
  { name: 'DJ Standard', desc: 'Profesjonalny DJ z naglosnieniem', qty: 1, unit: 'szt', price: 1000 },
  { name: 'Naglosznienie BOSE L1', desc: 'System line array z mikrofonami', qty: 2, unit: 'szt', price: 500 },
  { name: 'Oswietlenie LED', desc: 'Komplet 12 reflektorow LED RGBW', qty: 1, unit: 'kpl', price: 800 },
  { name: 'Fotobudka lustrzana', desc: 'Z personalizowanymi wydrukami', qty: 1, unit: 'szt', price: 600 },
];

export default function PricingTableConfigEditor({
  templateId,
  initialConfig,
  onSave,
  embedded = false,
}: PricingTableConfigEditorProps) {
  const { showSnackbar } = useSnackbar();
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<PricingTableConfig>({
    ...DEFAULT_CONFIG,
    ...initialConfig,
  });

  useEffect(() => {
    if (initialConfig) {
      setConfig((prev) => ({ ...prev, ...initialConfig }));
    }
  }, [initialConfig]);

  const update = (partial: Partial<PricingTableConfig>) => {
    setConfig((prev) => ({ ...prev, ...partial }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const { error } = await supabase
        .from('offer_page_templates')
        .update({ table_config: config })
        .eq('id', templateId);
      if (error) throw error;
      showSnackbar('Konfiguracja tabeli zapisana', 'success');
      onSave?.();
    } catch (err: any) {
      showSnackbar(err.message || 'Blad zapisywania', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setConfig({ ...DEFAULT_CONFIG });
    showSnackbar('Przywrocono domyslne ustawienia', 'info');
  };

  const visibleCols = () => {
    let count = 4;
    if (config.show_unit_price_net) count++;
    if (config.show_vat_column) count++;
    if (config.show_value_net) count++;
    if (config.show_value_gross) count++;
    return count;
  };

  const borderStyle = (side: 'all' | 'horizontal' | 'vertical' | 'bottom' | 'right') => {
    if (!config.show_borders) return {};
    const border = `${config.border_width}px solid ${config.border_color}`;
    if (side === 'all' && config.show_outer_border) return { border };
    if (side === 'bottom' && config.show_horizontal_borders) return { borderBottom: border };
    if (side === 'right' && config.show_vertical_borders) return { borderRight: border };
    return {};
  };

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-4 rounded-xl border border-[#d3bb73]/20 bg-[#0f1117] p-5'}>
      {!embedded && (
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-light text-[#e5e4e2]">Konfiguracja tabeli wyceny</h3>
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-[#e5e4e2]/60 transition-colors hover:bg-[#e5e4e2]/10 hover:text-[#e5e4e2]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
        </div>
      )}

      <div className="flex gap-4">
        <div className="w-[300px] flex-shrink-0 space-y-1 overflow-y-auto mx-4" style={{ maxHeight: embedded ? 'calc(90vh - 180px)' : '600px' }}>
          <Section title="Pozycja i marginesy" defaultOpen>
            <div className="grid grid-cols-2 gap-2">
              <NumberInput label="Pozycja Y (px)" value={config.start_y} onChange={(v) => update({ start_y: v })} min={30} max={750} />
              <NumberInput label="Margines lewy" value={config.margin_left} onChange={(v) => update({ margin_left: v })} min={10} max={200} suffix="px" />
              <NumberInput label="Margines prawy" value={config.margin_right} onChange={(v) => update({ margin_right: v })} min={10} max={200} suffix="px" />
              <NumberInput label="VAT domyslny" value={config.vat_rate} onChange={(v) => update({ vat_rate: v })} min={0} max={100} suffix="%" />
            </div>
            <NumberInput label="Szerokosc tabeli (0 = auto)" value={config.table_width} onChange={(v) => update({ table_width: v })} min={0} max={1200} suffix="px" />
            <p className="text-[10px] text-[#e5e4e2]/30">
              Ustaw 0 aby tabela wypelniala szerokosc strony minus marginesy
            </p>
          </Section>

          <Section title="Kolory">
            <div className="grid grid-cols-2 gap-2">
              <ColorInput label="Tlo naglowka" value={config.header_color} onChange={(v) => update({ header_color: v })} />
              <ColorInput label="Tekst naglowka" value={config.header_text_color} onChange={(v) => update({ header_text_color: v })} />
              <ColorInput label="Tlo wierszy (parzyste)" value={config.row_bg_color} onChange={(v) => update({ row_bg_color: v })} />
              <ColorInput label="Tlo wierszy (nieparzyste)" value={config.row_odd_bg_color} onChange={(v) => update({ row_odd_bg_color: v })} />
              <ColorInput label="Kolor tekstu" value={config.text_color} onChange={(v) => update({ text_color: v })} />
              <ColorInput label="Kolor sumy" value={config.summary_color} onChange={(v) => update({ summary_color: v })} />
              <ColorInput label="Kolor etykiet sumy" value={config.summary_label_color} onChange={(v) => update({ summary_label_color: v })} />
            </div>
          </Section>

          <Section title="Obramowanie" defaultOpen={false}>
            <div className="space-y-2.5">
              <Toggle label="Wlacz obramowanie" checked={config.show_borders} onChange={(v) => update({ show_borders: v })} />
              {config.show_borders && (
                <>
                  <ColorInput label="Kolor obramowania" value={config.border_color} onChange={(v) => update({ border_color: v })} />
                  <NumberInput label="Grubosc obramowania" value={config.border_width} onChange={(v) => update({ border_width: v })} min={0.25} max={3} step={0.25} suffix="px" />
                  <Toggle label="Linie poziome" checked={config.show_horizontal_borders} onChange={(v) => update({ show_horizontal_borders: v })} />
                  <Toggle label="Linie pionowe" checked={config.show_vertical_borders} onChange={(v) => update({ show_vertical_borders: v })} />
                  <Toggle label="Obramowanie zewnetrzne" checked={config.show_outer_border} onChange={(v) => update({ show_outer_border: v })} />
                </>
              )}
            </div>
          </Section>

          <Section title="Typografia i wymiary" defaultOpen={false}>
            <div className="grid grid-cols-2 gap-2">
              <NumberInput label="Czcionka naglowka" value={config.header_font_size} onChange={(v) => update({ header_font_size: v })} min={8} max={18} suffix="px" />
              <NumberInput label="Czcionka tresci" value={config.body_font_size} onChange={(v) => update({ body_font_size: v })} min={7} max={16} suffix="px" />
              <NumberInput label="Wys. naglowka" value={config.header_height} onChange={(v) => update({ header_height: v })} min={20} max={50} suffix="px" />
              <NumberInput label="Wys. wiersza" value={config.row_height} onChange={(v) => update({ row_height: v })} min={18} max={50} suffix="px" />
              <NumberInput label="Grub. separatora sumy" value={config.summary_separator_thickness} onChange={(v) => update({ summary_separator_thickness: v })} min={0} max={5} step={0.5} suffix="px" />
            </div>
          </Section>

          <Section title="Widoczne kolumny" defaultOpen>
            <div className="space-y-2">
              <Toggle label="Cena jedn. netto" checked={config.show_unit_price_net} onChange={(v) => update({ show_unit_price_net: v })} />
              <Toggle label="Stawka VAT" checked={config.show_vat_column} onChange={(v) => update({ show_vat_column: v })} />
              <Toggle label="Wartosc netto" checked={config.show_value_net} onChange={(v) => update({ show_value_net: v })} />
              <Toggle label="Wartosc brutto" checked={config.show_value_gross} onChange={(v) => update({ show_value_gross: v })} />
              <Toggle label="Opis pozycji" checked={config.show_description} onChange={(v) => update({ show_description: v })} />
            </div>
          </Section>

          <Section title="Szerokosci kolumn (px)" defaultOpen={false}>
            <div className="grid grid-cols-2 gap-2">
              <NumberInput label="Lp." value={config.col_lp_width} onChange={(v) => update({ col_lp_width: v })} min={20} max={60} />
              <NumberInput label="Ilosc" value={config.col_qty_width} onChange={(v) => update({ col_qty_width: v })} min={30} max={80} />
              <NumberInput label="Jednostka" value={config.col_unit_width} onChange={(v) => update({ col_unit_width: v })} min={30} max={80} />
              {config.show_unit_price_net && (
                <NumberInput label="Cena jedn." value={config.col_unit_price_width} onChange={(v) => update({ col_unit_price_width: v })} min={50} max={120} />
              )}
              {config.show_vat_column && (
                <NumberInput label="VAT" value={config.col_vat_width} onChange={(v) => update({ col_vat_width: v })} min={30} max={70} />
              )}
              {config.show_value_net && (
                <NumberInput label="Wart. netto" value={config.col_value_net_width} onChange={(v) => update({ col_value_net_width: v })} min={60} max={140} />
              )}
              {config.show_value_gross && (
                <NumberInput label="Wart. brutto" value={config.col_value_gross_width} onChange={(v) => update({ col_value_gross_width: v })} min={60} max={140} />
              )}
            </div>
            <p className="mt-1 text-[10px] text-[#e5e4e2]/30">
              Kolumna &quot;Nazwa&quot; wypelnia pozostala szerokosc automatycznie
            </p>
          </Section>
        </div>

        <div className="flex-1 overflow-auto rounded-lg bg-white p-3">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500">Podglad tabeli</span>
            <span className="text-[10px] text-gray-400">
              Y: {config.start_y}px | Marginesy: {config.margin_left}-{config.margin_right}px | Kolumny: {visibleCols()}{config.table_width > 0 ? ` | Szer: ${config.table_width}px` : ''}
            </span>
          </div>

          <div
            className="overflow-x-auto"
            style={config.show_borders && config.show_outer_border ? { border: `${config.border_width}px solid ${config.border_color}` } : {}}
          >
            <table className="w-full border-collapse" style={{ minWidth: '500px' }}>
              <thead>
                <tr
                  style={{
                    backgroundColor: config.header_color,
                    height: `${config.header_height}px`,
                  }}
                >
                  {[
                    { label: 'Lp.', w: config.col_lp_width, align: 'left' as const, show: true },
                    { label: 'Nazwa pozycji', w: 0, align: 'left' as const, show: true },
                    { label: 'Ilosc', w: config.col_qty_width, align: 'center' as const, show: true },
                    { label: 'Jedn.', w: config.col_unit_width, align: 'center' as const, show: true },
                    { label: 'Cena jedn. netto', w: config.col_unit_price_width, align: 'right' as const, show: config.show_unit_price_net },
                    { label: 'VAT', w: config.col_vat_width, align: 'center' as const, show: config.show_vat_column },
                    { label: 'Wartosc netto', w: config.col_value_net_width, align: 'right' as const, show: config.show_value_net },
                    { label: 'Wartosc brutto', w: config.col_value_gross_width, align: 'right' as const, show: config.show_value_gross },
                  ]
                    .filter((c) => c.show)
                    .map((col, ci, arr) => (
                      <th
                        key={ci}
                        className="px-2 font-semibold"
                        style={{
                          fontSize: `${config.header_font_size}px`,
                          color: config.header_text_color,
                          width: col.w ? `${col.w}px` : 'auto',
                          textAlign: col.align,
                          ...(config.show_borders && config.show_vertical_borders && ci < arr.length - 1
                            ? { borderRight: `${config.border_width}px solid ${config.border_color}` }
                            : {}),
                        }}
                      >
                        {col.label}
                      </th>
                    ))}
                </tr>
              </thead>

              <tbody>
                {SAMPLE_ITEMS.map((item, index) => {
                  const isEven = index % 2 === 0;
                  const valueNet = item.qty * item.price;
                  const valueGross = valueNet * (1 + config.vat_rate / 100);

                  const cells = [
                    { v: `${index + 1}.`, align: 'left' as const, show: true },
                    {
                      v: config.show_description ? (
                        <div>
                          <div>{item.name}</div>
                          <div style={{ fontSize: `${Math.max(config.body_font_size - 2, 7)}px`, opacity: 0.6 }}>{item.desc}</div>
                        </div>
                      ) : item.name,
                      align: 'left' as const,
                      show: true,
                    },
                    { v: item.qty.toString(), align: 'center' as const, show: true },
                    { v: item.unit, align: 'center' as const, show: true },
                    { v: item.price.toFixed(2), align: 'right' as const, show: config.show_unit_price_net },
                    { v: `${config.vat_rate}%`, align: 'center' as const, show: config.show_vat_column },
                    { v: valueNet.toFixed(2), align: 'right' as const, show: config.show_value_net },
                    { v: valueGross.toFixed(2), align: 'right' as const, show: config.show_value_gross },
                  ].filter((c) => c.show);

                  return (
                    <tr
                      key={index}
                      style={{
                        backgroundColor: isEven ? config.row_bg_color : config.row_odd_bg_color,
                        color: config.text_color,
                        height: `${config.row_height}px`,
                        ...(config.show_borders && config.show_horizontal_borders
                          ? { borderBottom: `${config.border_width}px solid ${config.border_color}` }
                          : {}),
                      }}
                    >
                      {cells.map((cell, ci) => (
                        <td
                          key={ci}
                          className="px-2"
                          style={{
                            fontSize: `${config.body_font_size}px`,
                            textAlign: cell.align,
                            verticalAlign: 'middle',
                            ...(config.show_borders && config.show_vertical_borders && ci < cells.length - 1
                              ? { borderRight: `${config.border_width}px solid ${config.border_color}` }
                              : {}),
                          }}
                        >
                          {cell.v}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>

              <tfoot>
                <tr
                  style={{
                    borderTop: `${config.summary_separator_thickness}px solid ${config.summary_color}`,
                  }}
                >
                  <td colSpan={config.show_vat_column ? 5 : 4} className="px-2 py-3" />
                  {config.show_unit_price_net && !config.show_vat_column && <td className="px-2 py-3" />}
                  {config.show_value_net && (
                    <td className="px-2 py-3 text-right" style={{ fontSize: `${config.body_font_size}px` }}>
                      <div className="text-xs font-normal" style={{ color: config.summary_label_color, fontSize: `${config.body_font_size - 1}px` }}>
                        SUMA NETTO:
                      </div>
                      <div className="font-bold" style={{ color: config.summary_color }}>
                        2 900.00 PLN
                      </div>
                    </td>
                  )}
                  {config.show_value_gross && (
                    <td className="px-2 py-3 text-right" style={{ fontSize: `${config.body_font_size}px` }}>
                      <div className="text-xs font-normal" style={{ color: config.summary_label_color, fontSize: `${config.body_font_size - 1}px` }}>
                        SUMA BRUTTO:
                      </div>
                      <div className="font-bold" style={{ color: config.summary_color }}>
                        3 567.00 PLN
                      </div>
                    </td>
                  )}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-[#d3bb73]/10 pt-3">
        {embedded && (
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs text-[#e5e4e2]/60 transition-colors hover:bg-[#e5e4e2]/10 hover:text-[#e5e4e2]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Domyslne
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          className="ml-auto flex items-center gap-2 rounded-lg bg-[#d3bb73] px-5 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {saving ? 'Zapisywanie...' : 'Zapisz tabele'}
        </button>
      </div>
    </div>
  );
}
