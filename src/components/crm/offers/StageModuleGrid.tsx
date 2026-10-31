'use client';
import {useEffect,useState} from 'react';
import {Plus} from 'lucide-react';
const field='mt-1 w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm';
export default function StageModuleGrid({width,depth,onChange}:{width:number;depth:number;onChange:(size:{width:number;depth:number})=>void}){
 const [hover,setHover]=useState<{columns:number;rows:number}|null>(null);
 const [unitWidth,setUnitWidth]=useState(Number.isInteger(width)&&width%2===0?2:1);
 useEffect(()=>{if(Number.isInteger(width)&&Number.isInteger(depth)&&width>=1&&depth>=1&&(width%2===0||depth%2===0)&&!(width%unitWidth===0&&depth%(unitWidth===1?2:1)===0))setUnitWidth(unitWidth===1?2:1);},[width,depth,unitWidth]);
 const [portrait,setPortrait]=useState(false);
 const [extent,setExtent]=useState({columns:10,rows:6});
 const unitDepth=unitWidth===1?2:1;
 // Rotate the view, keeping the saved front width and depth unchanged.
 const rotated=portrait ? unitWidth===2 : unitWidth===1;
 const cellWidth=rotated?unitDepth:unitWidth,cellDepth=rotated?unitWidth:unitDepth;
 const columns=(rotated?depth:width)/cellWidth,rows=(rotated?width:depth)/cellDepth;
 const valid=Number.isInteger(columns)&&Number.isInteger(rows)&&columns>=1&&rows>=1;
 const fit=(value:number,max:number)=>Number.isFinite(value)?Math.min(max,Math.max(1,Math.ceil(value))):1;
 const visibleColumns=Math.min(100/cellWidth,Math.max(extent.columns,fit(columns,100/cellWidth)));
 const visibleRows=Math.min(100/cellDepth,Math.max(extent.rows,fit(rows,100/cellDepth)));
 const horizontalMetres=visibleColumns*cellWidth,verticalMetres=visibleRows*cellDepth;
 const expand=(axis:'columns'|'rows')=>{setHover(null);setExtent({columns:visibleColumns,rows:visibleRows,[axis]:Math.min(axis==='columns'?100/cellWidth:100/cellDepth,(axis==='columns'?visibleColumns:visibleRows)+1)});};
 const plusClass='flex h-7 w-7 items-center justify-center rounded-md text-[#d3bb73]/80 hover:bg-white/5 focus-visible:outline focus-visible:outline-1 focus-visible:outline-white/20';
 const choose=(c:number,r:number)=>onChange(rotated?{width:r*cellDepth,depth:c*cellWidth}:{width:c*cellWidth,depth:r*cellDepth});
 return <div className="space-y-3 rounded-xl bg-black/10 p-4">
  <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-medium">Siatka blatów 1 × 2 m — minimum jeden blat</p><button type="button" className="rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73]" onClick={()=>{setHover(null);setPortrait(!portrait);}}>Obróć układ o 90°</button></div>
  <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Kolumny · {rotated?'głębokość':'front'} · bok {cellWidth} m<input className={field} type="number" min="1" max={100/cellWidth} step="1" value={Number.isFinite(columns)?columns:''} onChange={e=>choose(e.target.value===''?NaN:Number(e.target.value),rows)}/></label><label className="text-sm">Wiersze · {rotated?'front':'głębokość'} · bok {cellDepth} m<input className={field} type="number" min="1" max={100/cellDepth} step="1" value={Number.isFinite(rows)?rows:''} onChange={e=>choose(columns,e.target.value===''?NaN:Number(e.target.value))}/></label></div>
  <p className="text-sm text-[#d3bb73]">{valid?`${width} × ${depth} m · ${width*depth} m² · ${columns*rows} blatów`:'Wpisz dodatnią, całkowitą liczbę blatów i rzędów.'}</p>
  <p className="text-xs opacity-65">Blat: {cellWidth} m w poziomie × {cellDepth} m w pionie.</p>
  <div className="max-w-full overflow-auto pb-1">
   <div className="mx-auto grid w-max gap-1 pr-1" style={{gridTemplateColumns:`2rem repeat(${horizontalMetres}, 2rem) 2rem`,gridTemplateRows:`1.25rem repeat(${verticalMetres}, 2rem) 2rem`}} onMouseLeave={()=>setHover(null)} aria-label="Szybki wybór rozmiaru podestu">
    <span className="text-right text-[10px] text-white/40" style={{gridColumn:1,gridRow:1}}>0 m</span>
    {Array.from({length:horizontalMetres},(_,i)=><span key={`x-${i}`} className="self-end border-r border-white/10 pr-1 text-right text-[10px] text-white/40" style={{gridColumn:i+2,gridRow:1}}>{i+1} m</span>)}
    {Array.from({length:verticalMetres},(_,i)=><span key={`y-${i}`} className="flex items-end justify-end border-b border-white/10 pr-1 text-[10px] text-white/40" style={{gridColumn:1,gridRow:i+2}}>{i+1} m</span>)}
    {Array.from({length:visibleColumns*visibleRows},(_,i)=>{const c=i%visibleColumns+1,r=Math.floor(i/visibleColumns)+1,selected=c<=(hover?.columns??columns)&&r<=(hover?.rows??rows);return <button type="button" key={`${c}-${r}`} style={{gridColumn:`${(c-1)*cellWidth+2} / span ${cellWidth}`,gridRow:`${(r-1)*cellDepth+2} / span ${cellDepth}`}} className={`min-h-4 rounded-sm transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-white/30 ${selected?'bg-[#d3bb73]/65':'bg-white/[0.07] hover:bg-[#d3bb73]/25'}`} aria-pressed={valid&&c<=columns&&r<=rows} aria-label={`Ustaw ${rotated?r*cellDepth:c*cellWidth} × ${rotated?c*cellWidth:r*cellDepth} m, ${c*r} blatów`} onMouseEnter={()=>setHover({columns:c,rows:r})} onFocus={()=>setHover({columns:c,rows:r})} onBlur={()=>setHover(null)} onClick={()=>{choose(c,r);setHover(null);}}/>;})}
    {valid&&columns>=visibleColumns&&horizontalMetres<100&&<button type="button" className={plusClass} style={{gridColumn:horizontalMetres+2,gridRow:Math.floor(verticalMetres/2)+2}} aria-label={`Rozszerz siatkę w prawo o ${cellWidth} m`} title={`Rozszerz siatkę w prawo o ${cellWidth} m`} onMouseEnter={()=>setHover(null)} onClick={()=>expand('columns')}><Plus size={16}/></button>}
    {valid&&rows>=visibleRows&&verticalMetres<100&&<button type="button" className={plusClass} style={{gridColumn:Math.floor(horizontalMetres/2)+2,gridRow:verticalMetres+2}} aria-label={`Rozszerz siatkę w dół o ${cellDepth} m`} title={`Rozszerz siatkę w dół o ${cellDepth} m`} onMouseEnter={()=>setHover(null)} onClick={()=>expand('rows')}><Plus size={16}/></button>}
   </div>
  </div>
  <p className="text-xs opacity-65">{hover?`Wybierasz ${rotated?hover.rows*cellDepth:hover.columns*cellWidth} × ${rotated?hover.columns*cellWidth:hover.rows*cellDepth} m — ${hover.columns*hover.rows} blatów.`:'Kliknij pole siatki, aby wybrać prostokątny układ. Podziałka pokazuje metry. Po dojściu do krawędzi użyj +, aby dodać kolumnę lub rząd siatki, a następnie wybierz większy układ.'}</p>
 </div>;
}
