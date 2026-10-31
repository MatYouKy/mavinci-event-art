/** LED geometry only. Does not change stage configuration or legacy LED quotes. */
export type LedSection={id:string;name:string;columns:number;rows:number};
export function ledSectionTotals(sections:LedSection[]){
 if(!Array.isArray(sections)||sections.length<1||sections.length>30)throw new Error('Dodaj od 1 do 30 sekcji ekranu.');
 const ids=new Set<string>();let modules=0,cables=0;
 for(const s of sections){
  if(!s||typeof s.id!=='string'||!s.id||ids.has(s.id)||typeof s.name!=='string'||!s.name.trim()||s.name.length>100||!Number.isInteger(s.columns)||!Number.isInteger(s.rows)||s.columns<1||s.rows<1||s.columns>200||s.rows>200)throw new Error('Każda sekcja wymaga nazwy oraz od 1 do 200 kolumn i wierszy.');
  ids.add(s.id);modules+=s.columns*s.rows;cables+=Math.ceil(s.columns*s.rows/16);
 }
 if(modules>40000)throw new Error('Łączna powierzchnia ekranu nie może przekraczać 10 000 m².');
 return {modules,area:modules/4,signalCables:cables,backupCables:1,cables:cables+1};
}
export function ledSectionScope(sections:LedSection[],english=false){
 const total=ledSectionTotals(sections);
 return [...sections.map(s=>`${s.name}: ${s.columns/2} × ${s.rows/2} m — ${s.columns*s.rows} ${english?'tiles':'kafelków'} 50 × 50 cm`),`${english?'Total':'Łącznie'}: ${total.modules} ${english?'tiles':'kafelków'} · ${total.area} m²`,`${english?'Signal cables':'Skrętki sygnałowe'}: ${total.signalCables} + 1 ${english?'backup':'zapasowa'} = ${total.cables} ${english?'pcs':'szt.'}`];
}
