import { randomBytes } from 'crypto';
import { macSyncContext, syncJson, syncError, MacSyncError, tokenHash, uuidPattern } from '@/lib/macSync.server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
function contextRequest(req:Request) {
  const url=new URL(req.url);
  if(url.searchParams.get('scope')==='root')url.searchParams.delete('eventId');
  return new Request(url,{headers:req.headers});
}
export async function GET(req:Request) {
  try {
    const {admin,event,employeeId,catalog}=await macSyncContext(contextRequest(req),false,{catalog:true});
    let query=admin.from('mac_sync_bindings').select('id,created_at,expires_at,revoked_at').eq('employee_id',employeeId);
    query=catalog?query.is('event_id',null):query.eq('event_id',event.id);
    const {data,error}=await query.order('created_at',{ascending:false});
    if(error) throw error;
    return syncJson({bindings:data || []});
  } catch(error){return syncError(error);}
}
export async function POST(req:Request) {
  try {
    if(req.headers.get('origin')!==new URL(req.url).origin) throw new MacSyncError('Nieprawidłowe źródło żądania.',403);
    const {admin,event,employeeId,catalog}=await macSyncContext(contextRequest(req),false,{catalog:true});
    const token='mvfs_'+randomBytes(32).toString('base64url');
    const {data,error}=await admin.from('mac_sync_bindings').insert({
      event_id:catalog?null:event.id,employee_id:employeeId,token_hash:tokenHash(token),
    }).select('id,expires_at').single();
    if(error) throw error;
    return syncJson({token,...data,event_name:event.name},201);
  } catch(error){return syncError(error);}
}
export async function DELETE(req:Request) {
  try {
    if(req.headers.get('origin')!==new URL(req.url).origin) throw new MacSyncError('Nieprawidłowe źródło żądania.',403);
    const {admin,event,employeeId,catalog}=await macSyncContext(contextRequest(req),false,{catalog:true});
    const id=new URL(req.url).searchParams.get('id') || '';
    if(!uuidPattern.test(id)) throw new MacSyncError('Nieprawidłowy klucz.');
    let query=admin.from('mac_sync_bindings').update({revoked_at:new Date().toISOString()}).eq('id',id).eq('employee_id',employeeId);
    query=catalog?query.is('event_id',null):query.eq('event_id',event.id);
    const {error}=await query;
    if(error) throw error;
    return syncJson({ok:true});
  } catch(error){return syncError(error);}
}
