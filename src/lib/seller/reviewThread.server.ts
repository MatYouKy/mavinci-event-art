import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReviewHistoryCursor, ReviewHistoryPage, ReviewStatus } from './reviewThread';

const uuid = (value: unknown): value is string => typeof value==='string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
type Row = {
  id: string; created_at: string; document_id: string | null; status: ReviewStatus;
  request_note: string | null; response_note: string | null;
  requested_at: string | null; reviewed_at: string | null; reviewed_by: string | null;
};
function readCursor(value: unknown): ReviewHistoryCursor | null {
  if (value==null) return null;
  if (typeof value!=='object' || Array.isArray(value)) throw new Error('Nieprawidłowa strona historii.');
  const cursor=value as Record<string,unknown>;
  // Preserve PostgreSQL microseconds for stable pagination; only allow a
  // timestamp and UUID, never caller-supplied PostgREST filter syntax.
  if (!uuid(cursor.id) || typeof cursor.at!=='string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(cursor.at)
    || !Number.isFinite(Date.parse(cursor.at))) throw new Error('Nieprawidłowa strona historii.');
  return { at: cursor.at, id: cursor.id };
}

// Caller must verify CRM management permission for this exact offer and reject
// seller-portal sessions. The audit also stores private financial/warehouse
// data: select and return only the public decision fields, never raw details.
export async function loadReviewHistory(admin: SupabaseClient, offerId: string, before: unknown): Promise<ReviewHistoryPage> {
  const cursor=readCursor(before);
  let query=admin.from('seller_offer_review_audit')
    .select('id,created_at,document_id:details->>document_id,status:details->>status,request_note:details->>request_note,response_note:details->>response_note,requested_at:details->>requested_at,reviewed_at:details->>reviewed_at,reviewed_by:details->>reviewed_by')
    .eq('offer_id',offerId).in('details->>status',['pending','approved','changes_requested','rejected'])
    .order('created_at',{ascending:false}).order('id',{ascending:false}).limit(41);
  if (cursor) query=query.or(`created_at.lt.${cursor.at},and(created_at.eq.${cursor.at},id.lt.${cursor.id})`);
  const result=await query;
  if (result.error || !Array.isArray(result.data)) throw new Error('Nie udało się wczytać historii uwag. Odśwież historię; bieżąca decyzja pozostaje dostępna.');
  const rows=result.data as unknown as Row[];
  const page=rows.slice(0,40);
  const reviewers=[...new Set(page.map(row=>row.reviewed_by).filter(uuid))];
  const names=new Map<string,string>();
  if (reviewers.length) {
    const employees=await admin.from('employees').select('id,name,surname').in('id',reviewers);
    if (employees.error) throw new Error('Nie udało się wczytać autorów decyzji. Odśwież historię.');
    for (const employee of employees.data || []) names.set(employee.id,[employee.name,employee.surname].filter(Boolean).join(' '));
  }
  const last=page[page.length-1];
  return {
    entries: page.filter(row=>uuid(row.document_id)).map(row=>({
      id:row.id,recorded_at:row.created_at,document_id:row.document_id!,status:row.status,
      request_note:row.request_note || '',response_note:row.response_note || '',
      requested_at:row.requested_at,reviewed_at:row.reviewed_at,reviewer_name:row.reviewed_by ? names.get(row.reviewed_by) || null : null,
    })),
    next_cursor:rows.length>40 && last ? {at:last.created_at,id:last.id} : null,
  };
}
