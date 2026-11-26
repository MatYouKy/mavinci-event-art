'use client';

import type {
  PurchaseDocument,
  PurchaseEventCosts,
  PurchaseEventOption,
  PurchaseMonth,
  PurchaseReviewRow,
  PurchaseState,
  PurchaseUpload,
} from './purchaseShared';

/* Zakupy w CRM — wywołania trasy `/bridge/purchases` (sesja z ciasteczek; `src/lib/purchases/purchaseRoute.server.ts`). */

const BASE = '/bridge/purchases';

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, { cache: 'no-store', credentials: 'same-origin', ...init });
  } catch {
    throw new Error('Brak połączenia z serwerem CRM. Spróbuj ponownie.');
  }
  const data = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(data?.error || 'Serwer nie wykonał operacji.');
  return data as T;
}

const post = <T>(body: Record<string, unknown>) =>
  call<T>(BASE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const purchasesApi = {
  state: (year: number, month: number, employee?: string | null) =>
    call<PurchaseState>(`${BASE}?op=state&year=${year}&month=${month}${employee ? `&employee=${encodeURIComponent(employee)}` : ''}`),
  review: () => call<{ rows: PurchaseReviewRow[] }>(`${BASE}?op=review`).then((data) => data.rows || []),
  events: (company: string, query: string) =>
    call<{ events: PurchaseEventOption[] }>(`${BASE}?op=events&company=${encodeURIComponent(company)}&q=${encodeURIComponent(query)}`)
      .then((data) => data.events || []),
  costs: (event: string) => call<PurchaseEventCosts>(`${BASE}?op=costs&event=${encodeURIComponent(event)}`),
  fileUrl: (id: string, download = false) =>
    call<{ url: string; mime: string }>(`${BASE}?op=file&id=${encodeURIComponent(id)}${download ? '&download=1' : ''}`),
  upload: (company: string, files: File[]) => {
    const form = new FormData();
    form.append('company', company);
    for (const file of files) form.append('files', file, file.name);
    return call<PurchaseUpload>(`${BASE}?op=upload`, { method: 'POST', body: form });
  },
  discard: (path: string) => post<{ ok: boolean }>({ op: 'discard', path }),
  save: (id: string | null, data: Record<string, unknown>) =>
    post<{ document: PurchaseDocument }>({ op: 'save', id, data }).then((reply) => reply.document),
  remove: (id: string) => post<{ ok: boolean }>({ op: 'delete', id }),
  submit: (companyId: string, year: number, month: number, note: string) =>
    post<PurchaseMonth>({ op: 'submit', companyId, year, month, note }),
  decide: (settlementId: string, approve: boolean, note: string) =>
    post<PurchaseMonth>({ op: 'decide', settlementId, approve, note }),
};
