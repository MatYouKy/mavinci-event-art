import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import type { CorrespondenceMessage } from '@/components/crm/inquiries/InquiryCorrespondencePanel';

type Snapshot = { signature?: string; messages: CorrespondenceMessage[]; links: Array<{ id: string; type: string; include_thread: boolean; excluded: boolean }> };
type Cached = { key: string; savedAt: number; data: Snapshot };
const prefix = 'crm-inquiry-mail-v1:';
const memory = new Map<string, Cached>();
const pending = new Map<string, Promise<Cached>>();
const failures = new Map<string, { count: number; retryAt: number }>();
const refreshAfter = 60000;
const expiresAfter = 15 * 60000;
let authListenerReady = false;
let authEpoch = 0;

function read(key: string): Cached | null {
  try {
    const record = memory.get(key) || JSON.parse(sessionStorage.getItem(prefix + key) || 'null');
    if (record?.key === key && Date.now() - record.savedAt < expiresAfter && Array.isArray(record.data?.messages) && Array.isArray(record.data?.links)) return record;
  } catch { /* Storage is optional. */ }
  return null;
}
function remember(record: Cached) {
  memory.set(record.key, record);
  if (memory.size > 20) memory.delete(memory.keys().next().value!);
  try { sessionStorage.setItem(prefix + record.key, JSON.stringify(record)); } catch { /* Keep the memory cache. */ }
}
export function invalidateInquiryCorrespondence(inquiryId: string) {
  for (const [key, value] of memory) if (key.endsWith(':' + inquiryId)) value.savedAt = 0;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('inquiry-correspondence-changed', { detail: inquiryId }));
}

export function useInquiryCorrespondence(inquiryId: string, viewerId: string) {
  const cacheKey = `${viewerId}:${inquiryId}`;
  const activeKey = useRef(cacheKey);
  activeKey.current = cacheKey;
  const [record, setRecord] = useState<Cached | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const data = record?.key === cacheKey ? record : null;
  const refresh = useCallback(async (force = false) => {
    if (!viewerId) return;
    const cached = read(cacheKey);
    if (cached) setRecord(cached);
    if (!force && cached && Date.now() - cached.savedAt < refreshAfter) return;
    if (!force && (failures.get(cacheKey)?.retryAt || 0) > Date.now()) {
      setError('Nie udało się odświeżyć korespondencji. Spróbuj ponownie.');
      return;
    }
    setRefreshing(true);
    try {
      if (force && pending.has(cacheKey)) await pending.get(cacheKey)?.catch(() => undefined);
      let request = pending.get(cacheKey);
      if (!request) {
        request = (async () => {
          const epoch = authEpoch;
          const result = await supabase.rpc('get_inquiry_correspondence', { p_inquiry_id: inquiryId });
          if (epoch !== authEpoch) throw new Error('Session changed');
          if (result.error) {
            const count = Math.min((failures.get(cacheKey)?.count || 0) + 1, 5);
            failures.set(cacheKey, { count, retryAt: Date.now() + Math.min(refreshAfter * 2 ** (count - 1), 10 * 60000) });
            throw result.error;
          }
          failures.delete(cacheKey);
          const next = { key: cacheKey, savedAt: Date.now(), data: { signature: result.data?.signature, messages: result.data?.messages || [], links: result.data?.links || [] } };
          remember(next);
          return next;
        })().finally(() => pending.delete(cacheKey));
        pending.set(cacheKey, request);
      }
      const next = await request;
      if (activeKey.current === cacheKey) { setRecord(next); setError(''); }
    } catch {
      if (activeKey.current === cacheKey) {
        // Never keep displaying mail after an access failure or revoked mailbox assignment.
        memory.delete(cacheKey);
        try { sessionStorage.removeItem(prefix + cacheKey); } catch { /* Optional storage. */ }
        setRecord(null);
        setError('Nie udało się odświeżyć korespondencji. Spróbuj ponownie.');
      }
    } finally { if (activeKey.current === cacheKey) setRefreshing(false); }
  }, [cacheKey, inquiryId, viewerId]);

  useEffect(() => {
    if (!authListenerReady) {
      authListenerReady = true;
      supabase.auth.onAuthStateChange(event => {
        if (event !== 'SIGNED_OUT') return;
        authEpoch++;
        memory.clear();
        failures.clear();
        try { Object.keys(sessionStorage).filter(key => key.startsWith(prefix)).forEach(key => sessionStorage.removeItem(key)); } catch { /* Optional storage. */ }
      });
    }
    setError('');
    void refresh();
    const focus = () => { if (document.visibilityState === 'visible') void refresh(); };
    const changed = (event: Event) => { if ((event as CustomEvent).detail === inquiryId) void refresh(true); };
    const timer = window.setInterval(focus, refreshAfter);
    window.addEventListener('focus', focus);
    window.addEventListener('inquiry-correspondence-changed', changed);
    return () => { clearInterval(timer); window.removeEventListener('focus', focus); window.removeEventListener('inquiry-correspondence-changed', changed); };
  }, [refresh, inquiryId]);
  return {
    messages: data?.data.messages || [], links: data?.data.links || [],
    signature: data?.data.signature, count: data ? data.data.messages.length : undefined,
    loaded: Boolean(data), loading: !data && !error, refreshing, error,
    savedAt: data?.savedAt || null, refresh,
  };
}
