import { History, Plus, Edit2, Trash2 } from 'lucide-react';

interface HistoryEntry {
  id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  change_type: 'create' | 'update' | 'delete';
  changed_at: string;
  employee_id: string;
  employees: {
    name: string;
    surname: string;
  } | null;
}

interface HistoryTabProps {
  history: HistoryEntry[];
  loading?: boolean;
}

const FIELD_LABELS: Record<string, string> = {
  name: 'Nazwa',
  manufacturer: 'Producent',
  model: 'Model',
  serial_number: 'Numer seryjny',
  description: 'Opis',
  category_id: 'Kategoria',
  purchase_price: 'Cena zakupu',
  purchase_date: 'Data zakupu',
  warranty_expiry: 'Data gwarancji',
  notes: 'Notatki',
  status: 'Status',
  weight: 'Waga',
  dimensions: 'Wymiary',
  power_consumption: 'Pobór mocy',
  storage_location_id: 'Lokalizacja',
  thumbnail: 'Miniatura',
};

const CHANGE_TYPE_CONFIG = {
  create: {
    icon: Plus,
    label: 'Utworzono',
    color: 'text-green-400',
    bgColor: 'bg-green-400/10',
  },
  update: {
    icon: Edit2,
    label: 'Zaktualizowano',
    color: 'text-blue-400',
    bgColor: 'bg-blue-400/10',
  },
  delete: {
    icon: Trash2,
    label: 'Usunięto',
    color: 'text-red-400',
    bgColor: 'bg-red-400/10',
  },
};

export function HistoryTab({ history, loading }: HistoryTabProps) {
  if (loading) {
    return (
      <div className="text-center py-12 bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#d3bb73] mx-auto mb-4" />
        <p className="text-[#e5e4e2]/60">Ładowanie historii...</p>
      </div>
    );
  }

  if (!history?.length) {
    return (
      <div className="text-center py-12 bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl">
        <History className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
        <p className="text-[#e5e4e2]/60">Brak historii zmian</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {history.map((entry) => {
        const config = CHANGE_TYPE_CONFIG[entry.change_type];
        const Icon = config.icon;
        const fieldLabel = FIELD_LABELS[entry.field_name] || entry.field_name;
        const employeeName = entry.employees
          ? `${entry.employees.name} ${entry.employees.surname}`
          : 'System';

        return (
          <div
            key={entry.id}
            className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-4"
          >
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg ${config.bgColor}`}>
                <Icon className={`w-4 h-4 ${config.color}`} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`font-medium ${config.color}`}>
                    {config.label}
                  </span>
                  <span className="text-sm text-[#e5e4e2]/60">
                    {fieldLabel}
                  </span>
                </div>

                {entry.change_type === 'update' && (
                  <div className="space-y-1 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-[#e5e4e2]/40">Było:</span>
                      <span className="text-red-400/80 line-through">
                        {entry.old_value || '(puste)'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[#e5e4e2]/40">Jest:</span>
                      <span className="text-green-400/80">
                        {entry.new_value || '(puste)'}
                      </span>
                    </div>
                  </div>
                )}

                {entry.change_type === 'create' && (
                  <div className="text-sm text-[#e5e4e2]/60">
                    Wartość: <span className="text-green-400/80">{entry.new_value}</span>
                  </div>
                )}

                {entry.change_type === 'delete' && (
                  <div className="text-sm text-[#e5e4e2]/60">
                    Usunięto wartość: <span className="text-red-400/80">{entry.old_value}</span>
                  </div>
                )}

                <div className="flex items-center gap-3 mt-2 text-xs text-[#e5e4e2]/40">
                  <span>{employeeName}</span>
                  <span>•</span>
                  <span>
                    {new Date(entry.changed_at).toLocaleString('pl-PL', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}