import { FileText } from 'lucide-react';
import { ConnectorSelectWithPreview } from '../connectors/ConnectorSelectWithPreview';
import { ConnectorDisplayWithPreview } from '../connectors/ConnectorDisplayWithPreview';

export function TechnicalTab({
  equipment,
  editForm,
  isEditing,
  onInputChange,
  onPowerSpecsChange,
  connectorTypes,
  warehouseCategories,
}: any) {
  const currentCategoryId =
    isEditing && editForm.warehouse_category_id
      ? editForm.warehouse_category_id
      : equipment.warehouse_categories?.id;

  const currentCategory = warehouseCategories?.find((c: any) => c.id === currentCategoryId);
  const usesSimpleQuantity = currentCategory?.uses_simple_quantity || false;

  const powerSpecs = isEditing ? editForm.power_specs || {} : equipment.power_specs || {};

  const getConnector = (id?: string | null) => connectorTypes.find((c: any) => c.id === id) || null;

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <h3 className="mb-6 text-lg font-medium text-[#e5e4e2]">Parametry techniczne</h3>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {usesSimpleQuantity ? (
          <>
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Długość (m)</label>
              {isEditing ? (
                <input
                  type="number"
                  step="0.5"
                  name="cable_length_meters"
                  value={editForm.cable_length_meters || ''}
                  onChange={onInputChange}
                  className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                />
              ) : (
                <div className="text-[#e5e4e2]">
                  {equipment.cable_specs?.length_meters
                    ? `${equipment.cable_specs.length_meters} m`
                    : '-'}
                </div>
              )}
            </div>

            <div className="md:col-span-2">
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Wtyki</label>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {['in', 'out'].map((side) => (
                  <div key={side}>
                    <label className="mb-2 block text-xs text-[#e5e4e2]/40">
                      {side === 'in' ? 'Wtyk wejściowy' : 'Wtyk wyjściowy'}
                    </label>
                    {isEditing ? (
                      <select
                        name={side === 'in' ? 'cable_connector_in' : 'cable_connector_out'}
                        value={
                          editForm[side === 'in' ? 'cable_connector_in' : 'cable_connector_out'] ||
                          ''
                        }
                        onChange={onInputChange}
                        className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                      >
                        <option value="">Wybierz wtyk</option>
                        {connectorTypes.map((c: any) => (
                          <option key={c.id} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="text-[#e5e4e2]">
                        {side === 'in'
                          ? equipment.cable_specs?.connector_in || '-'
                          : equipment.cable_specs?.connector_out || '-'}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Waga (kg)</label>
              {isEditing ? (
                <input
                  type="number"
                  step="0.01"
                  name="weight_kg"
                  value={editForm.weight_kg || ''}
                  onChange={onInputChange}
                  className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                />
              ) : (
                <div className="text-[#e5e4e2]">
                  {equipment.weight_kg ? `${equipment.weight_kg} kg` : '-'}
                </div>
              )}
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Wymiary (cm)</label>
              {isEditing ? (
                <div className="grid grid-cols-3 gap-2">
                  {['dimensions_length', 'dimensions_width', 'dimensions_height'].map((n) => (
                    <input
                      key={n}
                      type="number"
                      step="0.1"
                      name={n}
                      value={editForm[n] || ''}
                      onChange={onInputChange}
                      placeholder={
                        n === 'dimensions_length'
                          ? 'Długość'
                          : n === 'dimensions_width'
                            ? 'Szerokość'
                            : 'Wysokość'
                      }
                      className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2]"
                    />
                  ))}
                </div>
              ) : (
                <div className="text-[#e5e4e2]">
                  {equipment.dimensions_cm
                    ? `${equipment.dimensions_cm.length || '-'} × ${equipment.dimensions_cm.width || '-'} × ${equipment.dimensions_cm.height || '-'} cm`
                    : '-'}
                </div>
              )}
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Numer seryjny</label>
              {isEditing ? (
                <input
                  type="text"
                  name="serial_number"
                  value={editForm.serial_number || ''}
                  onChange={onInputChange}
                  className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                />
              ) : (
                <div className="text-[#e5e4e2]">{equipment.serial_number || '-'}</div>
              )}
            </div>

            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Kod kreskowy</label>
              {isEditing ? (
                <input
                  type="text"
                  name="barcode"
                  value={editForm.barcode || ''}
                  onChange={onInputChange}
                  className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                />
              ) : (
                <div className="font-mono text-[#e5e4e2]">{equipment.barcode || '-'}</div>
              )}
            </div>

            <div className="md:col-span-2">
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                Instrukcja obsługi (URL)
              </label>
              {isEditing ? (
                <input
                  type="url"
                  name="user_manual_url"
                  value={editForm.user_manual_url || ''}
                  onChange={onInputChange}
                  className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                />
              ) : equipment.user_manual_url ? (
                <a
                  href={equipment.user_manual_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-[#d3bb73] hover:underline"
                >
                  <FileText className="h-4 w-4" />
                  Otwórz instrukcję
                </a>
              ) : (
                <div className="text-[#e5e4e2]/60">-</div>
              )}
            </div>
          </>
        )}
      </div>
      <div className="mt-8 border-t border-[#d3bb73]/10 pt-6">
        <h4 className="mb-4 text-sm font-medium uppercase tracking-wide text-[#d3bb73]">
          Specyfikacja prądowa
        </h4>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Pobór mocy (W)</label>
            {isEditing ? (
              <input
                type="number"
                step="1"
                value={powerSpecs.power_watts || ''}
                onChange={(e) => onPowerSpecsChange('power_watts', e.target.value)}
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                placeholder="np. 750"
              />
            ) : (
              <div className="text-[#e5e4e2]">
                {powerSpecs.power_watts ? `${powerSpecs.power_watts} W` : '-'}
              </div>
            )}
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Prąd (A)</label>
            {isEditing ? (
              <input
                type="number"
                step="0.1"
                value={powerSpecs.current_amps || ''}
                onChange={(e) => onPowerSpecsChange('current_amps', e.target.value)}
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                placeholder="np. 3.2"
              />
            ) : (
              <div className="text-[#e5e4e2]">
                {powerSpecs.current_amps ? `${powerSpecs.current_amps} A` : '-'}
              </div>
            )}
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Napięcie (V)</label>
            {isEditing ? (
              <input
                type="number"
                step="1"
                value={powerSpecs.voltage_volts || ''}
                onChange={(e) => onPowerSpecsChange('voltage_volts', e.target.value)}
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                placeholder="230"
              />
            ) : (
              <div className="text-[#e5e4e2]">
                {powerSpecs.voltage_volts ? `${powerSpecs.voltage_volts} V` : '-'}
              </div>
            )}
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Typ zasilania</label>
            {isEditing ? (
              <select
                value={powerSpecs.power_phase || 'single_phase'}
                onChange={(e) => onPowerSpecsChange('power_phase', e.target.value)}
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
              >
                <option value="single_phase">1-fazowe</option>
                <option value="three_phase">3-fazowe</option>
              </select>
            ) : (
              <div className="text-[#e5e4e2]">
                {powerSpecs.power_phase === 'three_phase' ? '3-fazowe' : '1-fazowe'}
              </div>
            )}
          </div>

          <div>
            {isEditing ? (
              <ConnectorSelectWithPreview
                label="Wejście zasilania"
                value={powerSpecs.input_connector_type_id || ''}
                onChange={(value: string) => onPowerSpecsChange('input_connector_type_id', value)}
                connectorTypes={connectorTypes}
                placeholder="Wybierz wtyk wejściowy"
              />
            ) : (
              <div className="text-[#e5e4e2]">
                <ConnectorDisplayWithPreview connector={getConnector(powerSpecs.input_connector_type_id)} />
              </div>
            )}
          </div>

          <div>
            {isEditing ? (
              <ConnectorSelectWithPreview
                label="Wyjście / link zasilania"
                value={powerSpecs.output_connector_type_id || ''}
                onChange={(value: string) => onPowerSpecsChange('output_connector_type_id', value)}
                connectorTypes={connectorTypes}
                placeholder="Brak / nie dotyczy"
              />
            ) : (
              <div className="text-[#e5e4e2]">
                <ConnectorDisplayWithPreview connector={getConnector(powerSpecs.output_connector_type_id)} />
              </div>
            )}
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Uwagi do zasilania</label>
            {isEditing ? (
              <textarea
                value={powerSpecs.power_notes || ''}
                onChange={(e) => onPowerSpecsChange('power_notes', e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2]"
                placeholder="np. wymaga osobnego obwodu, duży prąd rozruchowy, najlepiej CEE 16A..."
              />
            ) : (
              <div className="text-[#e5e4e2]/80">{powerSpecs.power_notes || '-'}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
