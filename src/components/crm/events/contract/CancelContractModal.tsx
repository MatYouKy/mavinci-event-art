'use client';

import { useRef, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import { Loader, X } from 'lucide-react';

type Props = {
  contractId: string;
  eventId: string;
  status: string;
  templateName: string;
  onClose: () => void;
  onCancelled: () => void;
};

export default function CancelContractModal({
  contractId, eventId, status, templateName, onClose, onCancelled,
}: Props) {
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);

  const close = () => {
    if (submitting.current) return;
    setPassword('');
    onClose();
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password || submitting.current) return;
    submitting.current = true;
    setIsSubmitting(true);
    setError('');
    try {
      const response = await fetch('/bridge/events/contracts/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractId, eventId, expectedStatus: status, password }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setError(result?.error || 'Nie udało się anulować umowy. Spróbuj ponownie.');
        return;
      }
      onCancelled();
    } catch {
      setError('Nie udało się potwierdzić wyniku operacji. Sprawdź połączenie i odśwież umowę przed ponowieniem.');
    } finally {
      setPassword('');
      submitting.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open
      onClose={close}
      fullWidth
      maxWidth="sm"
      aria-labelledby="cancel-contract-title"
      aria-describedby="cancel-contract-description"
      PaperProps={{ sx: { backgroundColor: '#210811', color: '#e5e4e2', borderRadius: '16px', backgroundImage: 'none' } }}
    >
      <form onSubmit={submit} className="space-y-5 p-5 sm:p-6" aria-busy={isSubmitting}>
        <div className="flex items-center justify-between gap-4">
          <h2 id="cancel-contract-title" className="text-lg font-medium uppercase">Anuluj umowę</h2>
          <button type="button" onClick={close} disabled={isSubmitting} aria-label="Zamknij" className="rounded-lg border-0 p-2 text-white/60 hover:bg-white/5 disabled:opacity-40">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div id="cancel-contract-description" className="space-y-2 text-sm leading-6 text-white/70">
          {templateName && <p>Szablon: <span className="text-[#d3bb73]">{templateName}</span></p>}
          <p>Umowa otrzyma status „Anulowana”. Treść, zapisane pliki PDF i historia pozostaną w systemie. Anulowanej umowy nie będzie można wysłać jako aktualnej.</p>
          <p>Potwierdź operację hasłem do swojego aktualnie zalogowanego konta administratora. Ta czynność zmienia status w CRM — nie wysyła powiadomienia do klienta.</p>
        </div>
        <div>
          <label htmlFor="cancel-contract-password" className="mb-2 block text-sm text-white/75">Hasło administratora</label>
          <input
            id="cancel-contract-password"
            type="password"
            autoComplete="current-password"
            autoFocus
            required
            maxLength={1024}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={isSubmitting}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'cancel-contract-error' : undefined}
            className="min-h-11 w-full rounded-lg border border-white/10 bg-[#351020] px-4 py-3 text-sm text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[#d3bb73]/50"
          />
        </div>
        {error && <p id="cancel-contract-error" role="alert" className="text-sm text-red-300">{error}</p>}
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" onClick={close} disabled={isSubmitting} className="min-h-11 rounded-lg border-0 bg-white/5 px-4 py-2.5 text-sm hover:bg-white/10 disabled:opacity-40">Zachowaj umowę</button>
          <button type="submit" disabled={!password || isSubmitting} className="inline-flex min-h-11 items-center gap-2 rounded-lg border-0 bg-red-400/10 px-4 py-2.5 text-sm font-medium text-red-200 hover:bg-red-400/15 disabled:opacity-40">
            {isSubmitting && <Loader className="h-4 w-4 animate-spin" />}
            {isSubmitting ? 'Weryfikowanie…' : 'Potwierdź anulowanie'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
