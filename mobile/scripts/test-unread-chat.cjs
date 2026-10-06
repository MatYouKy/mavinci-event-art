const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),ts=require('typescript');
const {createClient}=require('@supabase/supabase-js');
const out={};new Function('exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/services/unreadChat.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(out);
let ownRead='2026-10-06T12:00:00Z';let otherRead=null;let fail=false;
const messages=[{sender:'me',at:'2026-10-06T12:01:00Z'}];
const client=createClient('https://example.supabase.co','test',{auth:{persistSession:false},global:{fetch:async(input)=>{
 const u=new URL(input);
 if(u.pathname.endsWith('employee_conversation_participants')){
  assert.equal(u.searchParams.get('employee_id'),'eq.me');
  return new Response(JSON.stringify([{conversation_id:'chat',last_read_at:ownRead}]),{headers:{'content-type':'application/json'}});
 }
 assert.equal(u.searchParams.get('conversation_id'),'eq.chat');assert.equal(u.searchParams.get('sender_id'),'neq.me');
 if(fail)return new Response(null,{status:500});
 const after=u.searchParams.get('created_at')?.slice(3);
 const count=messages.filter(m=>m.sender!=='me'&&(!after||Date.parse(m.at)>Date.parse(after))).length;
 return new Response(null,{headers:{'content-range':`*/${count}`}});
}}});
(async()=>{
 const count=async()=>(await out.fetchUnreadChatCounts(client,'me')).get('chat');
 assert.equal(await count(),0,'Outgoing unread by recipient must not count');
 otherRead='2026-10-06T13:00:00Z';assert.equal(await count(),0,'Recipient read status is irrelevant');
 messages.push({sender:'other',at:'2026-10-06T12:02:00Z'});assert.equal(await count(),1);
 ownRead='2026-10-06T14:02:00+02:00';assert.equal(await count(),0,'Equal instants with different timezone representations are read');
 ownRead=null;assert.equal(await count(),1,'No read marker counts incoming only');
 messages.push(...Array.from({length:600},()=>({sender:'other',at:'2026-10-06T12:03:00Z'})));assert.equal(await count(),601,'No 500-message truncation');
 fail=true;await assert.rejects(count);
 console.log('Unread chat: outgoing exclusion, incoming, own read marker, timezones, null marker, large counts and errors passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
