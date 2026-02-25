import { useState } from 'react';
import { X } from 'lucide-react';

export function AddChecklistModal({
  isOpen,
  onClose,
  onAdd,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (task: string, priority: string) => void;
}) {
  const [task, setTask] = useState('');
  const [priority, setPriority] = useState('medium');

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (!task.trim()) {
      alert('Wpisz treść zadania');
      return;
    }
    onAdd(task, priority);
    setTask('');
    setPriority('medium');
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-light text-[#e5e4e2]">Dodaj zadanie</h2>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Zadanie</label>
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              className="min-h-[80px] w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              placeholder="Opisz zadanie do wykonania..."
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Priorytet</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            >
              <option value="low">Niski</option>
              <option value="medium">Średni</option>
              <option value="high">Wysoki</option>
            </select>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              onClick={handleSubmit}
              className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
            >
              Dodaj
            </button>
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
            >
              Anuluj
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}