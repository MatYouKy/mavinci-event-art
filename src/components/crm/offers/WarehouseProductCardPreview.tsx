'use client';

import {useEffect,useMemo,useState} from 'react';
import {ChevronLeft,ChevronRight,Loader2} from 'lucide-react';
import {loadStageEquipment} from '@/lib/CRM/Offers/warehouseStageLoader';
import {stageLinkGroups,type WarehouseStageCatalog,type StageEquipment} from '@/lib/CRM/Offers/modularProduct';

type Row={key:string;name:string;image?:string|null;relation:string;quantity:string;depth:number};
type Props={catalog:WarehouseStageCatalog;name:string;description:string;compactDescription?:string;shortDescription?:string;imageUrl?:string|null;imagePositionX?:number;imagePositionY?:number;imageZoom?:number;variant?:string|null;width:number;language:'pl'|'en';design:{primary_color:string;surface_color:string}};
const heading={fontFamily:"'OfferBrandHeading', sans-serif",textTransform:'uppercase' as const};
const clamp=(lines:number)=>({display:'-webkit-box',WebkitBoxOrient:'vertical' as const,WebkitLineClamp:lines,overflow:'hidden'});

export default function WarehouseProductCardPreview({catalog,name,description,compactDescription,shortDescription,imageUrl,imagePositionX=50,imagePositionY=25,imageZoom=1,variant,width,language,design}:Props){
 const english=language==='en';
 const compact=variant==='compact';
 const [graph,setGraph]=useState<Record<string,StageEquipment>|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[page,setPage]=useState(0);
 const signature=JSON.stringify(catalog);
 useEffect(()=>{
  let active=true;setGraph(null);setError('');setPage(0);
  const snapshot=JSON.parse(signature) as WarehouseStageCatalog;
  if(!snapshot.roots.length){setGraph({});return;}
  loadStageEquipment(snapshot).then(data=>{if(active)setGraph(data);}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Nie udało się pobrać elementów produktu.');});
  return()=>{active=false;};
 },[signature,retry]);
 const rows=useMemo(()=>{
  if(!graph)return [];
  const result:Row[]=[];
  const requirements=english?{required:'Required',recommended:'Recommended',optional:'Optional'}:{required:'Wymagane',recommended:'Rekomendowane',optional:'Opcjonalne'};
  const locale=english?'en-GB':'pl-PL';
  const rootIds=new Set(catalog.roots.map(r=>r.equipment_id));
  const nameOf=(id:string)=>english?graph[id]?.name_en||graph[id]?.name||'Equipment':graph[id]?.name||'Sprzęt';
  function add(id:string,key:string,relation:string,quantity:string,ancestors:string[]){
   if(ancestors.includes(id)||ancestors.length>=8)return;
   const node=graph![id];if(!node)return;
   result.push({key,name:nameOf(id),image:node.thumbnail_url,relation,quantity,depth:ancestors.length});
   for(const group of stageLinkGroups(node.links.filter(l=>!rootIds.has(l.equipment_id)))){
    for(const link of group.links){
     const choice=group.choice?(english?'choose one option':'wybierz jeden wariant'):'';
     const relation=[group.choice?group.label:'',requirements[link.type],choice].filter(Boolean).join(' · ');
     let quantity=`${link.quantity.toLocaleString(locale)} ${english?'pcs':'szt.'} ${link.mode==='fixed'?(english?'per whole product':'na cały produkt'):(english?`per 1 × ${nameOf(id)}`:`na 1 × ${nameOf(id)}`)}`;
     if(link.min_height!==null||link.max_height!==null)quantity+=` · ${english?'height':'wysokość'} ${link.min_height===link.max_height?link.min_height:`${link.min_height??'—'}–${link.max_height??'—'}`} cm`;
     add(link.equipment_id,`${key}/${link.id}`,relation,quantity,[...ancestors,id]);
    }
   }
  }
  for(const root of catalog.roots){
   const basis=english?{decks:'1 × 2 m modules; quantity depends on stage dimensions',fixed:'per whole product',area:'per m² of stage',manual:'quantity selected in the quotation',edge:'per metre of skirting',sides:'per skirted side'}:{decks:'Moduły 1 × 2 m; ilość według wymiarów podestu',fixed:'na cały produkt',area:'na m² podestu',manual:'ilość wybierana w ofercie',edge:'na metr wysłony',sides:'na wysłaniany bok'};
   const relation=root.basis==='decks'?(english?'Main component':'Komponent główny'):root.required?requirements.required:requirements.optional;
   const quantity=root.basis==='decks'?basis.decks:`${root.quantity.toLocaleString(locale)} × ${basis[root.basis]}`;
   add(root.equipment_id,root.id,relation,quantity,[]);
  }
  return result;
 },[graph,signature,english]);
 const firstCount=4,continuationCount=10;
 const pages:Row[][]=[rows.slice(0,firstCount)];
 for(let start=firstCount;start<rows.length;start+=continuationCount)pages.push(rows.slice(start,start+continuationCount));
 const currentPage=Math.min(page,pages.length-1),continuation=currentPage>0;
 const scale=Math.min(1,width/595),primary=design.primary_color;
 if(error)return <div role="alert" className="p-4 text-sm text-red-200">{error}<button type="button" className="mt-2 block rounded-md bg-white/5 px-3 py-2" onClick={()=>setRetry(n=>n+1)}>Ponów pobieranie elementów</button></div>;
 if(!graph)return <div role="status" className="flex min-h-[360px] items-center justify-center text-sm text-white/60"><Loader2 className="mr-2 h-4 w-4 animate-spin"/>Pobieranie elementów produktu…</div>;
 return <>
  {pages.length>1&&<nav aria-label="Strony komponentów produktu" className="flex items-center justify-between gap-2 p-2 text-xs text-white/70"><button type="button" aria-label="Poprzednia strona" disabled={currentPage===0} className="rounded-md p-2 hover:bg-white/5 disabled:opacity-30" onClick={()=>setPage(currentPage-1)}><ChevronLeft size={16}/></button><span>{english?'Page':'Strona'} {currentPage+1} / {pages.length}</span><button type="button" aria-label="Następna strona" disabled={currentPage===pages.length-1} className="rounded-md p-2 hover:bg-white/5 disabled:opacity-30" onClick={()=>setPage(currentPage+1)}><ChevronRight size={16}/></button></nav>}
  <div className="mx-auto" style={{width:595*scale,height:842*scale}}>
   <div style={{position:'relative',width:595,height:842,transform:`scale(${scale})`,transformOrigin:'top left',background:design.surface_color,color:'#171717',fontFamily:'Arial, sans-serif'}}>
    <div style={{position:'absolute',left:45,top:55,width:505,fontSize:24,lineHeight:'28px',color:primary,...heading,...clamp(2)}}>{name}</div>
    {!continuation&&<>
     <div style={{position:'absolute',left:45,top:108,width:505,fontSize:11,lineHeight:'15px',color:'#575c66',...clamp(2)}}>{shortDescription}</div>
     <div style={{position:'absolute',left:45,top:142,width:505,borderTop:`1px solid ${primary}`}}/>
     <div style={{position:'absolute',left:45,top:175,fontSize:12,color:primary,...heading}}>{english?'PRODUCT DESCRIPTION':'OPIS PRODUKTU'}</div>
     <div style={{position:'absolute',left:45,top:195,width:245,fontSize:10.5,lineHeight:'15px',whiteSpace:'pre-line',...clamp(14)}}>{description}</div>
     {imageUrl&&<div style={{position:'absolute',left:325,top:180,width:225,height:190,borderRadius:10,overflow:'hidden'}}><img src={imageUrl} alt={name} style={{width:'100%',height:'100%',objectFit:'cover',objectPosition:`${imagePositionX}% ${imagePositionY}%`,transform:`scale(${imageZoom})`,transformOrigin:`${imagePositionX}% ${imagePositionY}%`}}/></div>}
     <div style={{position:'absolute',left:45,top:429,width:505,borderTop:'1px solid #d2c7bd'}}/>
    </>}
    <div style={{position:'absolute',left:45,top:continuation?110:455,fontSize:12,color:primary,...heading}}>{english?(continuation?'PRODUCT SCOPE — CONTINUED':'PRODUCT SCOPE'):(continuation?'ZAKRES PRODUKTU — CIĄG DALSZY':'ZAKRES PRODUKTU')}</div>
    <div style={{position:'absolute',left:45,width:505,top:continuation?135:480,display:'flex',justifyContent:'space-between',fontSize:8,color:primary}}><span>{english?'COMPONENT / OPTION':'ELEMENT / WARIANT'}</span><span>{english?'QUANTITY BASIS':'PRZELICZNIK ILOŚCI'}</span></div>
    {pages[currentPage].map((row,index)=><div key={row.key} style={{position:'absolute',left:45+Math.min(row.depth,3)*6,right:45,top:(continuation?155:500)+index*61,height:compact?38:55,borderRadius:compact?0:5,background:compact?'transparent':'#fff',display:'flex',alignItems:'center',gap:12,padding:compact?'0':'6px 9px'}}>
     {compact?<div style={{minWidth:0}}><div style={{fontSize:10,lineHeight:'12px',...clamp(1)}} title={row.name}>• {row.name}</div><div style={{fontSize:8,lineHeight:'11px',color:'#575c66',...clamp(2)}}>{row.quantity} · {row.relation}</div></div>:<><div style={{minWidth:0,flex:1}}><div style={{fontSize:11,lineHeight:'14px',fontWeight:600,...clamp(2)}} title={row.name}>{row.name}</div><div style={{fontSize:8,lineHeight:'11px',color:primary,...clamp(2)}}>{row.relation}</div></div><div style={{width:175,flexShrink:0,fontSize:9,lineHeight:'12px',...clamp(4)}}>{row.quantity}</div></>}
    </div>)}
    {!rows.length&&<p style={{position:'absolute',left:40,top:295,fontSize:11}}>{english?'No components have been added yet.':'Nie dodano jeszcze komponentów.'}</p>}
    <div style={{position:'absolute',left:40,right:40,bottom:38,fontSize:8,lineHeight:'12px',color:'#756f6b'}}>{english?'Available components and options. Final selection, quantities and price are specified in the quotation.':'Dostępne elementy i opcje produktu. Ostateczny wybór, ilości oraz cenę określa oferta.'}</div>
   </div>
  </div>
 </>;
}
