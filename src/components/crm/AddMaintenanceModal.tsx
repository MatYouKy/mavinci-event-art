'use client';

import { useState, useEffect } from 'react';
import { X, Wrench, Loader2, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface AddMaintenanceModalProps {
  vehicleId: string;
  vehicleName: string;
  currentMileage: number;
  onClose: () => void;
  onSuccess: () => void;
}

interface OilPart {
  part_type: string;
  part_name: string;
  part_number: string;
  quantity: number;
  unit: string;
  cost: number;
}

interface RepairItem {
  description: string;
  part_number: string;
  part_cost: number;
}

export default function AddMaintenanceModal({
  vehicleId,
  vehicleName,
  currentMileage,
  onClose,
  onSuccess,
}: AddMaintenanceModalProps) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [serviceType, setServiceType] = useState<string>('inspection');
  const [employees, setEmployees] = useState<Array<{ id: string; name: string; surname: string }>>([]);

  useEffect(() => {
    fetchEmployees();
  }, []);

  const fetchEmployees = async () => {
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('id, name, surname')
        .order('surname');

      if (error) throw error;
      setEmployees(data || []);
    } catch (error) {
      console.error('Error fetching employees:', error);
    }
  };

  // Kontrola techniczna
  const [inspectionData, setInspectionData] = useState({
    inspection_date: new Date().toISOString().split('T')[0],
    certificate_number: '',
    performed_by: '',
    service_provider: '',
    cost: '',
    odometer_reading: currentMileage,
    notes: '',
  });

  // Wymiana oleju
  const [oilData, setOilData] = useState({
    change_date: new Date().toISOString().split('T')[0],
    odometer_reading: currentMileage,
    service_provider: '',
    labor_cost: '',
    notes: '',
  });
  const [oilParts, setOilParts] = useState<OilPart[]>([
    { part_type: 'oil', part_name: '', part_number: '', quantity: 1, unit: 'l', cost: 0 },
  ]);

  // Wymiana rozrządu
  const [timingBeltData, setTimingBeltData] = useState({
    change_date: new Date().toISOString().split('T')[0],
    odometer_reading: currentMileage,
    next_change_due_mileage: '',
    service_provider: '',
    labor_cost: '',
    parts_cost: '',
    notes: '',
  });

  // Inne naprawy
  const [repairData, setRepairData] = useState({
    title: '',
    description: '',
    repair_type: 'repair',
    severity: 'medium',
    status: 'completed',
    reported_date: new Date().toISOString().split('T')[0],
    estimated_completion_date: '',
    odometer_reading: currentMileage,
    service_provider: '',
    labor_cost: '',
    notes: '',
  });
  const [repairItems, setRepairItems] = useState<RepairItem[]>([
    { description: '', part_number: '', part_cost: 0 },
  ]);

  const addOilPart = () => {
    setOilParts([...oilParts, { part_type: 'other', part_name: '', part_number: '', quantity: 1, unit: 'szt', cost: 0 }]);
  };

  const removeOilPart = (index: number) => {
    setOilParts(oilParts.filter((_, i) => i !== index));
  };

  const updateOilPart = (index: number, field: keyof OilPart, value: any) => {
    const updated = [...oilParts];
    updated[index] = { ...updated[index], [field]: value };
    setOilParts(updated);
  };

  const addRepairItem = () => {
    setRepairItems([...repairItems, { description: '', part_number: '', part_cost: 0 }]);
  };

  const removeRepairItem = (index: number) => {
    setRepairItems(repairItems.filter((_, i) => i !== index));
  };

  const updateRepairItem = (index: number, field: keyof RepairItem, value: any) => {
    const updated = [...repairItems];
    updated[index] = { ...updated[index], [field]: value };
    setRepairItems(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (serviceType === 'inspection') {
        // Kontrola techniczna
        const validUntil = new Date(inspectionData.inspection_date);
        validUntil.setFullYear(validUntil.getFullYear() + 1);

        const { error } = await supabase.from('periodic_inspections').insert([{
          vehicle_id: vehicleId,
          inspection_type: 'technical_inspection',
          inspection_date: inspectionData.inspection_date,
          valid_until: validUntil.toISOString().split('T')[0],
          certificate_number: inspectionData.certificate_number || null,
          performed_by: inspectionData.performed_by || null,
          service_provider: inspectionData.service_provider || null,
          cost: inspectionData.cost ? parseFloat(inspectionData.cost) : 0,
          odometer_reading: parseInt(inspectionData.odometer_reading.toString()),
          notes: inspectionData.notes || null,
        }]);

        if (error) throw error;

        // Usuń stare alerty o przeglądzie dla tego pojazdu
        await supabase
          .from('vehicle_alerts')
          .delete()
          .eq('vehicle_id', vehicleId)
          .eq('alert_type', 'inspection');

        showSnackbar('Kontrola techniczna została dodana', 'success');

      } else if (serviceType === 'oil_change') {
        // Wymiana oleju
        const nextChangeMileage = parseInt(oilData.odometer_reading.toString()) + 12000;
        const nextChangeDate = new Date(oilData.change_date);
        nextChangeDate.setFullYear(nextChangeDate.getFullYear() + 1);

        // Pobierz ostatni przebieg wymiany oleju
        const { data: lastChange } = await supabase
          .from('oil_changes')
          .select('odometer_reading')
          .eq('vehicle_id', vehicleId)
          .order('change_date', { ascending: false })
          .limit(1)
          .single();

        const { data: newChange, error } = await supabase.from('oil_changes').insert([{
          vehicle_id: vehicleId,
          change_date: oilData.change_date,
          odometer_reading: parseInt(oilData.odometer_reading.toString()),
          previous_change_mileage: lastChange?.odometer_reading || null,
          next_change_due_mileage: nextChangeMileage,
          next_change_due_date: nextChangeDate.toISOString().split('T')[0],
          service_provider: oilData.service_provider || null,
          labor_cost: oilData.labor_cost ? parseFloat(oilData.labor_cost) : 0,
          parts_cost: oilParts.reduce((sum, part) => sum + (parseFloat(part.cost.toString()) || 0), 0),
          notes: oilData.notes || null,
        }]).select().single();

        if (error) throw error;

        // Dodaj części
        const partsToInsert = oilParts.map(part => ({
          oil_change_id: newChange.id,
          part_type: part.part_type,
          part_name: part.part_name,
          part_number: part.part_number || null,
          quantity: parseFloat(part.quantity.toString()),
          unit: part.unit,
          cost: parseFloat(part.cost.toString()) || 0,
        }));

        const { error: partsError } = await supabase.from('oil_change_parts').insert(partsToInsert);
        if (partsError) throw partsError;

        showSnackbar('Wymiana oleju została dodana', 'success');

      } else if (serviceType === 'timing_belt') {
        // Wymiana rozrządu
        const { error } = await supabase.from('timing_belt_changes').insert([{
          vehicle_id: vehicleId,
          change_date: timingBeltData.change_date,
          odometer_reading: parseInt(timingBeltData.odometer_reading.toString()),
          next_change_due_mileage: parseInt(timingBeltData.next_change_due_mileage),
          service_provider: timingBeltData.service_provider || null,
          labor_cost: timingBeltData.labor_cost ? parseFloat(timingBeltData.labor_cost) : 0,
          parts_cost: timingBeltData.parts_cost ? parseFloat(timingBeltData.parts_cost) : 0,
          notes: timingBeltData.notes || null,
        }]);

        if (error) throw error;
        showSnackbar('Wymiana rozrządu została dodana', 'success');

      } else if (serviceType === 'repair') {
        // Inne naprawy
        const totalPartsCost = repairItems.reduce((sum, item) => sum + (parseFloat(item.part_cost.toString()) || 0), 0);

        const { error } = await supabase.from('maintenance_repairs').insert([{
          vehicle_id: vehicleId,
          repair_type: repairData.repair_type,
          severity: repairData.severity,
          title: repairData.title,
          description: repairData.description + (repairData.status === 'completed' ? '\n\nNaprawione elementy:\n' +
            repairItems.map((item, i) => `${i + 1}. ${item.description} (${item.part_number}) - ${item.part_cost} zł`).join('\n') : ''),
          reported_date: repairData.reported_date,
          completed_date: repairData.status === 'completed' ? repairData.reported_date : null,
          estimated_completion_date: repairData.estimated_completion_date || null,
          odometer_reading: parseInt(repairData.odometer_reading.toString()),
          service_provider: repairData.service_provider || null,
          labor_cost: repairData.labor_cost ? parseFloat(repairData.labor_cost) : 0,
          parts_cost: totalPartsCost,
          status: repairData.status,
          notes: repairData.notes || null,
        }]);

        if (error) throw error;
        await supabase.rpc('update_vehicle_status_from_alerts');

        showSnackbar('Naprawa została dodana', 'success');
      }

      onSuccess();
      onClose();
    } catch (error: any) {
      console.error('Error adding maintenance record:', error);
      showSnackbar(error.message || 'Błąd podczas dodawania wpisu', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/20 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-[#1c1f33] border-b border-[#d3bb73]/20 p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Wrench className="w-6 h-6 text-[#d3bb73]" />
            <div>
              <h2 className="text-xl font-bold text-[#e5e4e2]">Dodaj wpis serwisowy</h2>
              <p className="text-sm text-[#e5e4e2]/60">{vehicleName}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Typ serwisu */}
          <div>
            <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
              Typ serwisu <span className="text-red-400">*</span>
            </label>
            <select
              value={serviceType}
              onChange={(e) => setServiceType(e.target.value)}
              className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              required
            >
              <option value="inspection">Kontrola techniczna</option>
              <option value="oil_change">Wymiana oleju i filtrów</option>
              <option value="timing_belt">Wymiana rozrządu</option>
              <option value="repair">Inne naprawy</option>
            </select>
          </div>

          {/* KONTROLA TECHNICZNA */}
          {serviceType === 'inspection' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                    Data przeglądu <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="date"
                    value={inspectionData.inspection_date}
                    onChange={(e) => setInspectionData({ ...inspectionData, inspection_date: e.target.value })}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                    required
                  />
                  <p className="text-xs text-[#e5e4e2]/40 mt-1">Kolejny przegląd za 365 dni</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                    Przebieg (km) <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number"
                    value={inspectionData.odometer_reading}
                    onChange={(e) => setInspectionData({ ...inspectionData, odometer_reading: parseInt(e.target.value) })}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Numer zaświadczenia</label>
                  <input
                    type="text"
                    value={inspectionData.certificate_number}
                    onChange={(e) => setInspectionData({ ...inspectionData, certificate_number: e.target.value })}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Wykonane przez</label>
                  <select
                    value={inspectionData.performed_by}
                    onChange={(e) => setInspectionData({ ...inspectionData, performed_by: e.target.value })}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                  >
                    <option value="">-- Wybierz pracownika --</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name} {emp.surname}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Stacja kontroli</label>
                  <input
                    type="text"
                    value={inspectionData.service_provider}
                    onChange={(e) => setInspectionData({ ...inspectionData, service_provider: e.target.value })}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Koszt (zł)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={inspectionData.cost}
                    onChange={(e) => setInspectionData({ ...inspectionData, cost: e.target.value })}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Notatki</label>
                <textarea
                  value={inspectionData.notes}
                  onChange={(e) => setInspectionData({ ...inspectionData, notes: e.target.value })}
                  rows={2}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              </div>
            </div>
          )}

          {/* WYMIANA OLEJU */}
          {serviceType === 'oil_change' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                    Data wymiany <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="date"
                    value={oilData.change_date}
                    onChange={(e) => setOilData({ ...oilData, change_date: e.target.value })}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                    required
                  />
                  <p className="text-xs text-[#e5e4e2]/40 mt-1">Następna wymiana za 12000 km lub 1 rok</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                    Przebieg (km) <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number"
                    value={oilData.odometer_reading}
                    onChange={(e) => setOilData({ ...oilData, odometer_reading: parseInt(e.target.value) })}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                    required
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-[#e5e4e2]">Użyte części</label>
                  <button
                    type="button"
                    onClick={addOilPart}
                    className="flex items-center gap-1 text-sm text-[#d3bb73] hover:text-[#d3bb73]/80"
                  >
                    <Plus className="w-4 h-4" />
                    Dodaj część
                  </button>
                </div>

                <div className="space-y-2">
                  {oilParts.map((part, index) => (
                    <div key={index} className="grid grid-cols-12 gap-2 bg-[#0f1119] p-3 rounded-lg border border-[#d3bb73]/10">
                      <div className="col-span-2">
                        <select
                          value={part.part_type}
                          onChange={(e) => updateOilPart(index, 'part_type', e.target.value)}
                          className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-2 py-1 text-sm text-[#e5e4e2]"
                        >
                          <option value="oil">Olej</option>
                          <option value="oil_filter">Filtr oleju</option>
                          <option value="air_filter">Filtr powietrza</option>
                          <option value="cabin_filter">Filtr kabiny</option>
                          <option value="other">Inne</option>
                        </select>
                      </div>
                      <div className="col-span-3">
                        <input
                          type="text"
                          value={part.part_name}
                          onChange={(e) => updateOilPart(index, 'part_name', e.target.value)}
                          placeholder="Nazwa części"
                          className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-2 py-1 text-sm text-[#e5e4e2]"
                        />
                      </div>
                      <div className="col-span-2">
                        <input
                          type="text"
                          value={part.part_number}
                          onChange={(e) => updateOilPart(index, 'part_number', e.target.value)}
                          placeholder="Nr części"
                          className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-2 py-1 text-sm text-[#e5e4e2]"
                        />
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number"
                          step="0.1"
                          value={part.quantity}
                          onChange={(e) => updateOilPart(index, 'quantity', parseFloat(e.target.value))}
                          placeholder="Ilość"
                          className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-2 py-1 text-sm text-[#e5e4e2]"
                        />
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number"
                          step="0.01"
                          value={part.cost}
                          onChange={(e) => updateOilPart(index, 'cost', parseFloat(e.target.value))}
                          placeholder="Koszt"
                          className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-2 py-1 text-sm text-[#e5e4e2]"
                        />
                      </div>
                      <div className="col-span-1 flex items-center justify-center">
                        {oilParts.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeOilPart(index)}
                            className="text-red-400 hover:text-red-300"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Warsztat</label>
                  <input
                    type="text"
                    value={oilData.service_provider}
                    onChange={(e) => setOilData({ ...oilData, service_provider: e.target.value })}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Robocizna (zł)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={oilData.labor_cost}
                    onChange={(e) => setOilData({ ...oilData, labor_cost: e.target.value })}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Notatki</label>
                <textarea
                  value={oilData.notes}
                  onChange={(e) => setOilData({ ...oilData, notes: e.target.value })}
                  rows={2}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              </div>
            </div>
          )}

          {/* WYMIANA ROZRZĄDU */}
          {serviceType === 'timing_belt' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                    Data wymiany <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="date"
                    value={timingBeltData.change_date}
                    onChange={(e) => setTimingBeltData({ ...timingBeltData, change_date: e.target.value })}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                    Przebieg (km) <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number"
                    value={timingBeltData.odometer_reading}
                    onChange={(e) => setTimingBeltData({ ...timingBeltData, odometer_reading: parseInt(e.target.value) })}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                    Następna wymiana po km <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number"
                    value={timingBeltData.next_change_due_mileage}
                    onChange={(e) => setTimingBeltData({ ...timingBeltData, next_change_due_mileage: e.target.value })}
                    placeholder="np. 180000"
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Warsztat</label>
                  <input
                    type="text"
                    value={timingBeltData.service_provider}
                    onChange={(e) => setTimingBeltData({ ...timingBeltData, service_provider: e.target.value })}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Robocizna (zł)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={timingBeltData.labor_cost}
                    onChange={(e) => setTimingBeltData({ ...timingBeltData, labor_cost: e.target.value })}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Części (zł)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={timingBeltData.parts_cost}
                    onChange={(e) => setTimingBeltData({ ...timingBeltData, parts_cost: e.target.value })}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Notatki</label>
                <textarea
                  value={timingBeltData.notes}
                  onChange={(e) => setTimingBeltData({ ...timingBeltData, notes: e.target.value })}
                  rows={2}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              </div>
            </div>
          )}

          {/* INNE NAPRAWY */}
          {serviceType === 'repair' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                    Tytuł naprawy <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={repairData.title}
                    onChange={(e) => setRepairData({ ...repairData, title: e.target.value })}
                    placeholder="np. Naprawa układu hamulcowego"
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Status</label>
                  <select
                    value={repairData.status}
                    onChange={(e) => setRepairData({ ...repairData, status: e.target.value })}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                  >
                    <option value="scheduled">Zaplanowana</option>
                    <option value="in_progress">W trakcie</option>
                    <option value="completed">Zakończona</option>
                    <option value="cancelled">Anulowana</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Poziom wagi</label>
                  <select
                    value={repairData.severity}
                    onChange={(e) => setRepairData({ ...repairData, severity: e.target.value })}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                  >
                    <option value="low">Niski</option>
                    <option value="medium">Średni</option>
                    <option value="high">Wysoki (blokuje pojazd)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Opis</label>
                <textarea
                  value={repairData.description}
                  onChange={(e) => setRepairData({ ...repairData, description: e.target.value })}
                  rows={2}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              </div>

              {repairData.status === 'scheduled' && (
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                    Szacowana data naprawy
                  </label>
                  <input
                    type="date"
                    value={repairData.estimated_completion_date}
                    onChange={(e) => setRepairData({ ...repairData, estimated_completion_date: e.target.value })}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                  />
                  <p className="text-xs text-[#e5e4e2]/40 mt-1">
                    Data do której planowana jest naprawa
                  </p>
                </div>
              )}

              {repairData.status === 'completed' && <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-[#e5e4e2]">Naprawione elementy</label>
                  <button
                    type="button"
                    onClick={addRepairItem}
                    className="flex items-center gap-1 text-sm text-[#d3bb73] hover:text-[#d3bb73]/80"
                  >
                    <Plus className="w-4 h-4" />
                    Dodaj element
                  </button>
                </div>

                <div className="space-y-2">
                  {repairItems.map((item, index) => (
                    <div key={index} className="grid grid-cols-12 gap-2 bg-[#0f1119] p-3 rounded-lg border border-[#d3bb73]/10">
                      <div className="col-span-5">
                        <input
                          type="text"
                          value={item.description}
                          onChange={(e) => updateRepairItem(index, 'description', e.target.value)}
                          placeholder="Co było naprawiane"
                          className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-2 py-1 text-sm text-[#e5e4e2]"
                        />
                      </div>
                      <div className="col-span-3">
                        <input
                          type="text"
                          value={item.part_number}
                          onChange={(e) => updateRepairItem(index, 'part_number', e.target.value)}
                          placeholder="Numer części"
                          className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-2 py-1 text-sm text-[#e5e4e2]"
                        />
                      </div>
                      <div className="col-span-3">
                        <input
                          type="number"
                          step="0.01"
                          value={item.part_cost}
                          onChange={(e) => updateRepairItem(index, 'part_cost', parseFloat(e.target.value))}
                          placeholder="Koszt części (zł)"
                          className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-2 py-1 text-sm text-[#e5e4e2]"
                        />
                      </div>
                      <div className="col-span-1 flex items-center justify-center">
                        {repairItems.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeRepairItem(index)}
                            className="text-red-400 hover:text-red-300"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Data</label>
                  <input
                    type="date"
                    value={repairData.reported_date}
                    onChange={(e) => setRepairData({ ...repairData, reported_date: e.target.value })}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Przebieg (km)</label>
                  <input
                    type="number"
                    value={repairData.odometer_reading}
                    onChange={(e) => setRepairData({ ...repairData, odometer_reading: parseInt(e.target.value) })}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Warsztat</label>
                  <input
                    type="text"
                    value={repairData.service_provider}
                    onChange={(e) => setRepairData({ ...repairData, service_provider: e.target.value })}
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Robocizna (zł)</label>
                <input
                  type="number"
                  step="0.01"
                  value={repairData.labor_cost}
                  onChange={(e) => setRepairData({ ...repairData, labor_cost: e.target.value })}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#e5e4e2] mb-2">Notatki</label>
                <textarea
                  value={repairData.notes}
                  onChange={(e) => setRepairData({ ...repairData, notes: e.target.value })}
                  rows={2}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              </div>
            </div>
          )}

          {/* Przyciski */}
          <div className="flex gap-4 justify-end pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 bg-[#0f1119] text-[#e5e4e2] rounded-lg hover:bg-[#0f1119]/80"
              disabled={loading}
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-6 py-2 rounded-lg hover:bg-[#d3bb73]/90 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Dodawanie...
                </>
              ) : (
                'Dodaj wpis'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
