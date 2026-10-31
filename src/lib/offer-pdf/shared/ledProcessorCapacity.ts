import {stageLinkGroups,stageLinksFor,type StageLink,type WarehouseStageSnapshot} from './warehouseStage';

// Defaults requested for this catalog; an explicit product setting takes precedence.
export function defaultLedProcessorOutputs(name?:string|null,model?:string|null):number|undefined{
 const label=`${model||''} ${name||''}`.toUpperCase();
 if(/\b(?:TBX|VX)[ -]?1000\b/.test(label))return 10;
 if(/\bTB[ -]?50\b/.test(label))return 4;
 return undefined;
}
export type LedProcessorNotice={key:string;group:string;message:string;warning:boolean;recommendation?:{id:string;name:string}};
export function ledProcessorNotices(s:WarehouseStageSnapshot,signalCables:number):LedProcessorNotice[]{
 if(!s.equipment||!Number.isInteger(signalCables)||signalCables<1)return [];
 const notices:LedProcessorNotice[]=[];
 const capacity=(link:StageLink)=>{
  const node=s.equipment?.[link.equipment_id];
  const n=link.led_signal_outputs??defaultLedProcessorOutputs(node?.name,node?.model);
  return typeof n==='number'&&Number.isInteger(n)&&n>0?n:undefined;
 };
 function visit(id:string,path:string,ancestors:string[]){
  if(ancestors.includes(id)||ancestors.length>=8)return;
  const node=s.equipment?.[id];if(!node)return;
  for(const group of stageLinkGroups(stageLinksFor(s,node))){
   const key=path+'/'+group.key;
   const selected=group.choice?group.links.filter(l=>l.id===s.selection.choices[key]):group.required||s.selection.enabled[key]?group.links:[];
   if(group.choice&&(group.links.some(l=>capacity(l)!==undefined)||/procesor/i.test(group.label))){
    const options=group.links.map(link=>({link,outputs:capacity(link)}));
    const fitting=options.filter(o=>o.outputs!==undefined&&o.outputs>=signalCables).sort((a,b)=>a.outputs!-b.outputs!)[0];
    const chosen=selected[0],chosenCapacity=chosen?capacity(chosen):undefined;
    const name=chosen?s.equipment?.[chosen.equipment_id]?.name||'Wybrany procesor':'';
    const prefix=`${signalCables} aktywnych skrętek (zapasowa nie zajmuje wyjścia). `;
    if(chosenCapacity!==undefined&&chosenCapacity>=signalCables){
     notices.push({key,group:group.label,message:prefix+`${name}: limit ${chosenCapacity} — wystarcza.`,warning:false});
    }else if(fitting){
     const recommendation={id:fitting.link.id,name:s.equipment?.[fitting.link.equipment_id]?.name||'Procesor'};
     notices.push({key,group:group.label,message:prefix+(chosen?(chosenCapacity===undefined?`${name}: nie określono limitu. `:`${name}: limit ${chosenCapacity} — za mało wyjść. `):'')+`Rekomendowany: ${recommendation.name} (limit ${fitting.outputs}).`,warning:true,recommendation});
    }else if(options.some(o=>o.outputs===undefined)){
     notices.push({key,group:group.label,message:prefix+'Żaden procesor z określonym limitem nie wystarcza. Uzupełnij limity pozostałych wariantów lub zapewnij procesor z rentalu.',warning:true});
    }else{
     notices.push({key,group:group.label,message:prefix+'Dostępne warianty procesora mają za mało wyjść. Potrzebny procesor z rentalu lub zmiana rozwiązania.',warning:true});
    }
   }
   for(const link of selected)visit(link.equipment_id,path+'/'+link.id,[...ancestors,id]);
  }
 }
 for(const root of s.catalog.roots)if(root.required||s.selection.enabled['root:'+root.id])visit(root.equipment_id,root.id,[]);
 return notices;
}
