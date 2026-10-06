import 'server-only';
import { createHash } from 'crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';

export const syncJson = (body: unknown, status=200) => NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class MacSyncError extends Error { constructor(message:string,readonly status=400){super(message);} }
export function syncError(error:unknown) {
  if(error instanceof MacSyncError) return syncJson({error:error.message},error.status);
  const code=(error as {code?:string})?.code;
  return syncJson({error:['42P01','PGRST205','PGRST202'].includes(code || '')
    ? 'Wymagana migracja mac_folder_sync w bazie CRM.' : 'Nie udało się zsynchronizować pliku. Spróbuj ponownie.'},500);
}
export const tokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');

export async function macSyncContext(request:Request, allowToken=true, options:{catalog?:boolean;readOnly?:boolean}={}) {
  const admin=createSupabaseAdminClient();
  const token=request.headers.get('authorization')?.match(/^Bearer (mvfs_[a-zA-Z0-9_-]+)$/)?.[1];
  let eventId=new URL(request.url).searchParams.get('eventId') || '';
  let employeeId:string;
  let bindingId:string|null=null;
  let rootBinding=false;
  let userClient:ReturnType<typeof createSupabaseServerClient>|null=null;
  if(token && allowToken) {
    const {data,error}=await admin.from('mac_sync_bindings').select('id,event_id,employee_id')
      .eq('token_hash',tokenHash(token)).is('revoked_at',null).gt('expires_at',new Date().toISOString()).maybeSingle();
    if(error) throw error;
    if(!data) throw new MacSyncError('Klucz synchronizacji wygasł lub został odłączony.',401);
    employeeId=data.employee_id; rootBinding=data.event_id===null;
    if(!rootBinding) eventId=data.event_id;
    bindingId=data.id;
  } else {
    const client=createSupabaseServerClient(cookies());
    userClient=client;
    const {data,error}=await client.auth.getUser();
    if(error || !data.user) throw new MacSyncError('Wymagane logowanie.',401);
    const {data:employee,error:employeeError}=await admin.from('employees').select('id')
      .or('id.eq.'+data.user.id+',auth_user_id.eq.'+data.user.id).eq('is_active',true).maybeSingle();
    if(employeeError || !employee) throw new MacSyncError('Brak aktywnego pracownika.',403);
    employeeId=employee.id;
  }
  // File access is deliberately NOT granted by the calendar feed token.
  const {data:employee,error}=await admin.from('employees').select('id,role,access_level,permissions')
    .eq('id',employeeId).eq('is_active',true).maybeSingle();
  if(error || !employee) throw new MacSyncError('Brak aktywnego pracownika.',403);
  const isAdmin=employee.role==='admin' || employee.access_level==='admin';
  if(!isAdmin && (!options.readOnly || bindingId))
    throw new MacSyncError('Synchronizacja folderów wymaga aktywnego administratora.',403);
  if(options.catalog && !eventId && isAdmin && (!bindingId || rootBinding)) {
    return {admin,employeeId,event:{id:'',name:'Katalog CRM'},bindingId,isAdmin,
      canReadPath:(_path:string)=>true,catalog:true};
  }
  if(!uuidPattern.test(eventId)) throw new MacSyncError('Wybierz wydarzenie.');
  // Cookie readers must also pass existing event RLS, including company/event scope.
  const {data:event,error:eventError}=await (isAdmin?admin:userClient!).from('events')
    .select('id,name,created_by').eq('id',eventId).maybeSingle();
  if(eventError) throw eventError;
  if(!event) throw new MacSyncError('Nie znaleziono wydarzenia.',404);
  let member=isAdmin || event.created_by===employeeId;
  if(!member) {
    const {data:assignments,error:assignmentError}=await admin.from('employee_assignments').select('id')
      .eq('event_id',eventId).eq('employee_id',employeeId).eq('status','accepted').limit(1);
    if(assignmentError) throw assignmentError;
    member=!!assignments?.length;
  }
  const permissions:string[]=employee.permissions || [];
  const canReadPath=(path:string)=>{
    if(isAdmin)return true;
    if(!member)return false;
    const category=path.normalize('NFC').split('/')[0].toLocaleLowerCase('pl-PL');
    if(category==='umowy')return permissions.includes('contracts_manage');
    if(category==='oferty')return permissions.includes('offers_create');
    if(category==='pliki')return true;
    return false; // Unknown/private folders never become shared by accident.
  };
  return {admin,employeeId,event,bindingId,isAdmin,canReadPath,catalog:false};
}

export async function allSyncRows(query:()=>any) {
  // Never treat a truncated PostgREST page as the full file list.
  const rows:any[]=[];
  for(let offset=0;;offset+=500) {
    const {data,error}=await query().order('id').range(offset,offset+499);
    if(error) throw error;
    rows.push(...(data || []));
    if(!data || data.length<500) return rows;
  }
}
