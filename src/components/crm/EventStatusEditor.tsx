'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Edit, Check, X, Clock, PlayCircle, CheckCircle, XCircle, Archive } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface Props {
  eventId: string;
  currentStatus: string;
  onStatusChange?: (newStatus: string) => void;
}

const EVENT_STATUSES = [
  { value: 'draft', label: 'Szkic', icon: Clock, color: 'text-gray-400' },
  { value: 'planning', label: 'Planowanie', icon: Edit, color: 'text-blue-400' },
  { value: 'confirmed', label: 'Potwierdzony', icon: CheckCircle, color: 'text-green-400' },
  { value: 'in_progress', label: 'W trakcie', icon: PlayCircle, color: 'text-purple-400' },
  { value: 'completed', label: 'Zrealizowany', icon: CheckCircle, color: 'text-green-500' },
  { value: 'cancelled', label: 'Anulowany', icon: XCircle, color: 'text-red-400' },
  { value: 'archived', label: 'Zarchiwizowany', icon: Archive, color: 'text-gray-500' }
];

export default function EventStatusEditor({ eventId, currentStatus, onStatusChange }: Props) {
  const { showSnackbar } = useSnackbar();
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const currentStatusData = EVENT_STATUSES.find(s => s.value === currentStatus) || EVENT_STATUSES[0];
  const StatusIcon = currentStatusData.icon;

  const handleStatusChange = async (newStatus: string) => {
    if (newStatus === currentStatus) {
      setIsEditing(false);
      return;
    }

    try {
      setSaving(true);

      const { error } = await supabase
        .from('events')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', eventId);

      if (error) throw error;

      showSnackbar('Status eventu został zaktualizowany', 'success');
      setIsEditing(false);

      if (onStatusChange) {
        onStatusChange(newStatus);
      }
    } catch (err: any) {
      console.error('Error updating status:', err);
      showSnackbar(err.message || 'Błąd podczas aktualizacji statusu', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (isEditing) {
    return (
      <div className="bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-[#e5e4e2]/60">Wybierz nowy status:</span>
          <button
            onClick={() => setIsEditing(false)}
            className="p-1 text-[#e5e4e2]/40 hover:text-[#e5e4e2]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {EVENT_STATUSES.map((status) => {
            const Icon = status.icon;
            const isSelected = status.value === currentStatus;

            return (
              <button
                key={status.value}
                onClick={() => handleStatusChange(status.value)}
                disabled={saving}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                  isSelected
                    ? 'bg-[#d3bb73]/10 border-[#d3bb73]/50 text-[#d3bb73]'
                    : 'border-[#d3bb73]/20 text-[#e5e4e2] hover:bg-[#d3bb73]/5'
                } disabled:opacity-50`}
              >
                <Icon className={`w-4 h-4 ${status.color}`} />
                <span className="text-sm">{status.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setIsEditing(true)}
      className="flex items-center gap-2 px-4 py-2 bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg hover:border-[#d3bb73]/40 transition-colors group"
    >
      <StatusIcon className={`w-5 h-5 ${currentStatusData.color}`} />
      <span className="text-[#e5e4e2]">{currentStatusData.label}</span>
      <Edit className="w-4 h-4 text-[#e5e4e2]/40 group-hover:text-[#d3bb73] transition-colors" />
    </button>
  );
}
