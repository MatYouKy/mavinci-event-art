import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { demoAdmin, isDemoUuid } from '@/lib/seller/demo.server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function DELETE(request:NextRequest,{params}:{params:{id:string;documentId:string}}) {
  try {
    const origin=request.headers.get('origin');
    if(!origin||new URL(origin).host!==request.headers.get('host'))return json({error:'Nieprawidłowe źródło żądania.'},403);
    if(!isDemoUuid(params.id)||!isDemoUuid(params.documentId))return json({error:'Nieprawidłowy dokument.'},400);
    const client=createSupabaseServerClient(cookies());
    const {data:{user}}=await client.auth.getUser();
    if(!user)return json({error:'Wymagane logowanie.'},401);
    const {data:canManage,error:permissionError}=await client.rpc('can_manage_sales_brochures');
    if(permissionError||!canManage)return json({error:'Brak uprawnień do usuwania próbnych ofert.'},403);
    // Read through RLS before using privileged storage/deletion. A document
    // must belong to a visible session of the brochure from the URL.
    const {data:document,error}=await client.from('seller_demo_generations').select('id,session_id,status,pdf_path').eq('id',params.documentId).maybeSingle();
    if(error||!document)return json({error:'Nie znaleziono dokumentu lub nie masz do niego dostępu.'},404);
    const {data:session,error:sessionError}=await client.from('seller_demo_sessions').select('id').eq('id',document.session_id).eq('brochure_id',params.id).maybeSingle();
    if(sessionError||!session)return json({error:'Dokument nie należy do tej broszury.'},404);
    if(document.status==='generating')return json({error:'Nie można usunąć dokumentu w trakcie generowania.'},409);
    const admin=demoAdmin();
    if(document.pdf_path){
      if(document.pdf_path!==`${params.id}/${document.session_id}/${document.id}.pdf`)return json({error:'Nieprawidłowe powiązanie pliku. Dokument nie został usunięty.'},409);
      // Delete the file first. If storage fails the record stays available for
      // retry; if the DB fails a retry can safely remove the already-missing file.
      const {error:storageError}=await admin.storage.from('seller-demo-pdfs').remove([document.pdf_path]);
      if(storageError)return json({error:'Nie udało się usunąć pliku PDF. Spróbuj ponownie.'},503);
    }
    const {error:deleteError}=await admin.from('seller_demo_generations').delete().eq('id',document.id).eq('session_id',document.session_id).neq('status','generating');
    if(deleteError)return json({error:'Nie udało się usunąć wpisu. Ponów usuwanie, aby dokończyć operację.'},503);
    return json({ok:true});
  }catch{return json({error:'Nie udało się usunąć dokumentu. Spróbuj ponownie.'},500);}
}
