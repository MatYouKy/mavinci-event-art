import { createHash, randomUUID } from 'crypto';
import { macSyncContext, allSyncRows, syncJson, syncError, MacSyncError, uuidPattern } from '@/lib/macSync.server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const MAX=50*1024*1024;
const safeName=(value:string)=>value.normalize('NFC').replace(/[\/\\:\u0000-\u001f]/g,'_').replace(/^\.+/,'_').slice(0,180);
const mimeFor=(path:string)=>{
  const types:Record<string,string>={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',
    txt:'text/plain',csv:'text/csv',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',zip:'application/zip'};
  return types[path.split('.').pop()?.toLowerCase() || ''] || 'application/octet-stream';
};
export async function GET(req:Request) {
  try {
    const {admin,event,bindingId,isAdmin,canReadPath,catalog}=await macSyncContext(req,true,{catalog:true,readOnly:true});
    const params=new URL(req.url).searchParams;
    if(catalog) {
      const events=await allSyncRows(()=>admin.from('events').select('id,name,event_date'));
      const dateFolder=(value:string|null)=>{
        if(!value)return 'Bez daty';
        if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value;
        const date=new Date(value);
        if(Number.isNaN(date.getTime()))return 'Bez daty';
        return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
      };
      return syncJson({scope:'root',events:events.map(e=>({id:e.id,name:e.name,
        relative_path:'events/'+dateFolder(e.event_date)+'/'+(safeName(e.name || 'Wydarzenie').trim() || 'Wydarzenie')}))});
    }
    const fileId=params.get('fileId');
    if(fileId) {
      const [kind,id]=fileId.split(':');
      if(!uuidPattern.test(id || '')) throw new MacSyncError('Nieprawidłowy plik.');
      let bucket='',path='',name='';
      if(kind==='mac') {
        const {data,error}=await admin.from('mac_sync_files').select('*').eq('event_id',event.id).eq('id',id).maybeSingle();
        if(error) throw error;
        if(data && canReadPath(data.relative_path)){bucket='mac-crm-sync';path=data.storage_path;name=data.relative_path.split('/').pop();}
      } else if(kind==='event' && isAdmin) {
        const {data,error}=await admin.from('event_files').select('file_path,original_name').eq('event_id',event.id).eq('id',id).maybeSingle();
        if(error) throw error;
        if(data){bucket='event-files';path=data.file_path;name=data.original_name;}
      } else if(kind==='signed' && isAdmin) {
        const {data,error}=await admin.from('contract_signed_files').select('storage_path,original_name,contracts!inner(event_id)')
          .eq('contracts.event_id',event.id).eq('id',id).maybeSingle();
        if(error) throw error;
        if(data){bucket='signed-contracts';path=data.storage_path;name=data.original_name;}
      }
      if(!path) throw new MacSyncError('Nie znaleziono pliku.',404);
      const {data,error}=await admin.storage.from(bucket).createSignedUrl(path,60,
        params.get('preview')==='1'?undefined:{download:safeName(name)});
      if(error || !data) throw new MacSyncError('Nie udało się pobrać pliku.',500);
      if(params.get('redirect')==='1') return new Response(null,{status:303,headers:{Location:data.signedUrl,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
      return syncJson({url:data.signedUrl});
    }
    const own=await allSyncRows(()=>admin.from('mac_sync_files').select('*').eq('event_id',event.id));
    const files:any[]=own.filter(f=>canReadPath(f.relative_path)).map(f=>({id:'mac:'+f.id,relative_path:f.relative_path,sha256:f.sha256,
      revision:f.revision,fingerprint:f.sha256,file_size:f.file_size}));
    if(bindingId) {
      const eventFiles=await allSyncRows(()=>admin.from('event_files').select('*').eq('event_id',event.id));
      files.push(...eventFiles.map(f=>({id:'event:'+f.id,relative_path:'Z CRM/Pliki/'+f.id+'/'+safeName(f.original_name || f.name),
        sha256:null,revision:0,fingerprint:[f.updated_at,f.file_path,f.file_size].join('|'),file_size:f.file_size})));
      const contracts=await allSyncRows(()=>admin.from('contracts').select('id').eq('event_id',event.id));
      for(let i=0;i<contracts.length;i+=200) {
        try {
          const signed=await allSyncRows(()=>admin.from('contract_signed_files').select('*').in('contract_id',contracts.slice(i,i+200).map(c=>c.id)));
          files.push(...signed.map(f=>({id:'signed:'+f.id,relative_path:'Z CRM/Podpisane umowy/'+f.id+'/'+safeName(f.original_name),
            sha256:null,revision:0,fingerprint:f.id,file_size:f.file_size})));
        } catch(error) {
          if(!['42P01','PGRST205'].includes((error as {code:string}).code)) throw error;
          break; // The optional signed-attachments feature may not yet be installed.
        }
      }
    }
    return syncJson({event_id:event.id,event_name:event.name,binding_id:bindingId,files});
  } catch(error){return syncError(error);}
}
export async function POST(req:Request) {
  try {
    const {admin,event,employeeId,bindingId}=await macSyncContext(req);
    if(!bindingId && req.headers.get('origin')!==new URL(req.url).origin) throw new MacSyncError('Nieprawidłowe źródło.',403);
    const path=decodeURIComponent(req.headers.get('x-file-path') || '').normalize('NFC');
    if(!path || path.length>800 || path.split('/').some(p=>!p || p==='.' || p==='..' || p.startsWith('.')) ||
      /[\\:\u0000-\u001f]/.test(path) || /^(Z CRM|Konflikty CRM)(\/|$)/i.test(path))
      throw new MacSyncError('Nieprawidłowa ścieżka względna.');
    const revisionHeader=req.headers.get('x-expected-revision');
    const expected=Number(revisionHeader);
    if(revisionHeader===null || !Number.isSafeInteger(expected) || expected<0) throw new MacSyncError('Brak wersji bazowej pliku.');
    const claimed=req.headers.get('x-content-sha256') || '';
    if(!/^[0-9a-f]{64}$/.test(claimed)) throw new MacSyncError('Brak sumy kontrolnej pliku.');
    if(Number(req.headers.get('content-length') || 0)>MAX) throw new MacSyncError('Limit pliku wynosi 50 MB.',413);
    const reader=req.body?.getReader();
    if(!reader) throw new MacSyncError('Brak pliku.');
    const chunks:Uint8Array[]=[];let size=0;
    while(true){
      const {done,value}=await reader.read();if(done) break;
      size+=value.byteLength;
      if(size>MAX){await reader.cancel();throw new MacSyncError('Limit pliku wynosi 50 MB.',413);}
      chunks.push(value);
    }
    if(!size) throw new MacSyncError('Pusty plik.');
    const bytes=Buffer.concat(chunks);
    const sha=createHash('sha256').update(bytes).digest('hex');
    if(sha!==claimed) throw new MacSyncError('Suma kontrolna pliku nie zgadza się.');
    const mime=mimeFor(path),storagePath=event.id+'/'+randomUUID();
    const {error:uploadError}=await admin.storage.from('mac-crm-sync').upload(storagePath,bytes,{contentType:mime,upsert:false});
    if(uploadError) throw uploadError;
    const {data,error}=await admin.rpc('commit_mac_sync_file',{
      p_event_id:event.id,p_employee_id:employeeId,p_path:path,p_storage_path:storagePath,
      p_sha256:sha,p_size:size,p_mime:mime,p_expected_revision:expected,
    });
    const saved=Array.isArray(data)?data[0]:data;
    // A transport timeout may occur AFTER commit. Never remove that possibly-linked object.
    if((error && ['40001','42501','23514','PGRST202','42883','42P01','23503','23505'].includes(error.code)) || (!error && saved?.storage_path && saved.storage_path!==storagePath))
      await admin.storage.from('mac-crm-sync').remove([storagePath]);
    if(error?.code==='40001') throw new MacSyncError('Konflikt wersji pliku. Zachowano plik na Macu i wersję CRM.',409);
    if(error) throw error;
    if(!saved?.id) throw new MacSyncError('Nie potwierdzono zapisu. Odśwież listę przed ponowieniem.',500);
    return syncJson({id:'mac:'+saved.id,relative_path:saved.relative_path,sha256:saved.sha256,
      revision:saved.revision,fingerprint:saved.sha256,file_size:saved.file_size});
  } catch(error){return syncError(error);}
}
