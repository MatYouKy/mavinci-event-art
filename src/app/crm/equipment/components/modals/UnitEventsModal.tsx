import { uploadImage } from '@/lib/storage';
import { useState } from 'react';
import { UnitEventRow, UnitEventType } from '../../types/equipment.types';
import { supabase } from '@/lib/supabase';
import { Plus, Upload, X, History } from 'lucide-react';

interface IEquipmentEventForm {
  event_type: UnitEventType;
  description: string;
  image_url: string;
}

export function UnitEventsModal({ unit, events, onClose, onUpdate }: any) {
  const [showAddEvent, setShowAddEvent] = useState(false);
  const [eventForm, setEventForm] = useState<IEquipmentEventForm>({
    event_type: 'note',
    description: '',
    image_url: '',
  });
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const eventTypeLabels: Record<string, string> = {
    damage: 'Uszkodzenie',
    repair: 'Naprawa',
    service: 'Serwis',
    status_change: 'Zmiana statusu',
    note: 'Notatka',
    inspection: 'Inspekcja',
    sold: 'Sprzedaż',
  };

  const eventTypeColors: Record<string, string> = {
    damage: 'text-red-400',
    repair: 'text-green-400',
    service: 'text-orange-400',
    status_change: 'text-blue-400',
    note: 'text-[#d3bb73]',
    inspection: 'text-purple-400',
    sold: 'text-pink-400',
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const url = await uploadImage(file, 'equipment-events');
      setEventForm(prev => ({ ...prev, image_url: url }));
    } catch (error) {
      console.error('Error uploading image:', error);
      alert('Błąd podczas przesyłania zdjęcia');
    } finally {
      setUploading(false);
    }
  };

  const handleAddEvent = async () => {
    if (!eventForm.description.trim()) {
      alert('Wprowadź opis zdarzenia');
      return;
    }

    if (eventForm.event_type === 'sold') {
      if (!confirm('Czy na pewno chcesz oznaczyć tę jednostkę jako sprzedaną? Jednostka zostanie usunięta z systemu.')) {
        return;
      }
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      const { error: eventError } = await supabase
        .from('equipment_unit_events')
        .insert({
          unit_id: unit.id,
          event_type: eventForm.event_type,
          description: eventForm.description,
          image_url: eventForm.image_url || null,
          employee_id: user?.id || null,
        });

      if (eventError) throw eventError;

      if (eventForm.event_type === 'damage') {
        const { error: updateError } = await supabase
          .from('equipment_units')
          .update({
            status: 'damaged',
          })
          .eq('id', unit.id);

        if (updateError) throw updateError;
        alert('Status jednostki został zmieniony na "Uszkodzony"');
      }

      if (eventForm.event_type === 'repair' || eventForm.event_type === 'service') {
        const updateData: any = {
          last_service_date: new Date().toISOString().split('T')[0],
        };

        if (eventForm.event_type === 'repair') {
          updateData.status = 'available';
          updateData.estimated_repair_date = null;
        }

        const { error: updateError } = await supabase
          .from('equipment_units')
          .update(updateData)
          .eq('id', unit.id);

        if (updateError) throw updateError;

        if (eventForm.event_type === 'repair') {
          alert('Jednostka została naprawiona i jest znowu dostępna!');
        } else {
          alert('Data ostatniego serwisu została zaktualizowana!');
        }
      }

      if (eventForm.event_type === 'sold') {
        const { error: deleteError } = await supabase
          .from('equipment_units')
          .delete()
          .eq('id', unit.id);

        if (deleteError) throw deleteError;
        alert('Jednostka została usunięta z systemu jako sprzedana.');
        onClose();
        window.location.reload();
        return;
      }

      setEventForm({
        event_type: 'note',
        description: '',
        image_url: '',
      });
      setShowAddEvent(false);
      onUpdate();
    } catch (error) {
      console.error('Error adding event:', error);
      alert('Błąd podczas dodawania zdarzenia');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-[#d3bb73]/10 flex items-center justify-between">
          <div>
            <h3 className="text-xl font-light text-[#e5e4e2] mb-1">Historia zdarzeń</h3>
            <p className="text-sm text-[#e5e4e2]/60">
              {unit.unit_serial_number ? `SN: ${unit.unit_serial_number}` : 'Bez numeru seryjnego'}
            </p>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-[#e5e4e2]/40">Aktualny status:</span>
              <span className={`px-2 py-1 rounded text-xs ${
                unit.status === 'available' ? 'bg-green-500/20 text-green-400' :
                unit.status === 'damaged' ? 'bg-red-500/20 text-red-400' :
                unit.status === 'in_service' ? 'bg-orange-500/20 text-orange-400' :
                'bg-gray-500/20 text-gray-400'
              }`}>
                {unit.status === 'available' ? 'Dostępny' :
                 unit.status === 'damaged' ? 'Uszkodzony' :
                 unit.status === 'in_service' ? 'Serwis' :
                 'Wycofany'}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowAddEvent(!showAddEvent)}
              className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Dodaj zdarzenie
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-[#e5e4e2]/10 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-[#e5e4e2]" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {showAddEvent && (
            <div className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-xl p-4 mb-6">
              <h4 className="text-[#e5e4e2] font-medium mb-4">Nowe zdarzenie</h4>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-[#e5e4e2]/60 mb-2">Typ zdarzenia</label>
                    <select
                      value={eventForm.event_type}
                      onChange={(e) => setEventForm(prev => ({ ...prev, event_type: e.target.value as any }))}
                      className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                    >
                      <option value="note">Notatka</option>
                      <option value="damage">Uszkodzenie (zmienia status)</option>
                      <option value="repair">Naprawa (anuluje uszkodzenie)</option>
                      <option value="service">Serwis</option>
                      <option value="inspection">Inspekcja</option>
                      <option value="sold">Sprzedaż (usuwa jednostkę)</option>
                    </select>
                    {eventForm.event_type === 'damage' && (
                      <p className="text-xs text-red-400 mt-1">
                        Status zostanie zmieniony na "Uszkodzony"
                      </p>
                    )}
                    {eventForm.event_type === 'repair' && (
                      <p className="text-xs text-green-400 mt-1">
                        Status zostanie zmieniony na "Dostępny"
                      </p>
                    )}
                    {eventForm.event_type === 'sold' && (
                      <p className="text-xs text-red-400 mt-1">
                        UWAGA: Jednostka zostanie całkowicie usunięta z systemu!
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm text-[#e5e4e2]/60 mb-2">Zdjęcie (opcjonalne)</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      disabled={uploading}
                      className="hidden"
                      id="event-image-upload"
                    />
                    <label
                      htmlFor="event-image-upload"
                      className={`flex items-center justify-center gap-2 w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] cursor-pointer hover:border-[#d3bb73]/30 transition-colors ${uploading ? 'opacity-50' : ''}`}
                    >
                      <Upload className="w-4 h-4" />
                      {uploading ? 'Przesyłanie...' : eventForm.image_url ? 'Zmień zdjęcie' : 'Dodaj zdjęcie'}
                    </label>
                  </div>
                </div>

                {eventForm.image_url && (
                  <div className="relative">
                    <img
                      src={eventForm.image_url}
                      alt="Preview"
                      className="w-full max-h-48 object-contain rounded-lg"
                    />
                    <button
                      onClick={() => setEventForm(prev => ({ ...prev, image_url: '' }))}
                      className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-lg hover:bg-red-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                <div>
                  <label className="block text-sm text-[#e5e4e2]/60 mb-2">Opis zdarzenia</label>
                  <textarea
                    value={eventForm.description}
                    onChange={(e) => setEventForm(prev => ({ ...prev, description: e.target.value }))}
                    rows={4}
                    className="w-full bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]/30"
                    placeholder="Opisz szczegóły zdarzenia..."
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => setShowAddEvent(false)}
                    className="flex-1 px-4 py-2 bg-[#e5e4e2]/10 text-[#e5e4e2] rounded-lg hover:bg-[#e5e4e2]/20 transition-colors"
                  >
                    Anuluj
                  </button>
                  <button
                    onClick={handleAddEvent}
                    disabled={saving}
                    className="flex-1 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50"
                  >
                    {saving ? 'Zapisywanie...' : 'Dodaj'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {events.length === 0 ? (
            <div className="text-center py-12">
              <History className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
              <p className="text-[#e5e4e2]/60">Brak zdarzeń</p>
            </div>
          ) : (
            <div className="space-y-4">
              {events.map((event: UnitEventRow) => (
                <div
                  key={event.id}
                  className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-xl p-4"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className={`font-medium ${eventTypeColors[event.event_type]}`}>
                        {eventTypeLabels[event.event_type]}
                      </span>
                      <span className="text-xs text-[#e5e4e2]/40">
                        {new Date(event.created_at).toLocaleString('pl-PL')}
                      </span>
                      {event.employees && (
                        <span className="text-xs text-[#e5e4e2]/60">
                          • Zgłosił: {event.employees.name} {event.employees.surname}
                        </span>
                      )}
                    </div>
                  </div>

                  <p className="text-[#e5e4e2] mb-2">{event.description}</p>

                  {event.old_status && event.new_status && (
                    <div className="text-sm text-[#e5e4e2]/60">
                      Status: {event.old_status} → {event.new_status}
                    </div>
                  )}

                  {event.image_url && (
                    <img
                      src={event.image_url}
                      alt="Zdjęcie zdarzenia"
                      className="mt-3 w-full max-h-64 object-contain rounded-lg border border-[#d3bb73]/10"
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}