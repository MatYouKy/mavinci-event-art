"use client";
import { useEffect, useRef, useState } from 'react';
import { FileText, SlidersHorizontal, CheckCircle2, Gift } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { PACKAGE_LAYOUT as L, PACKAGE_COPY as C, packageExtensionLabel, type ProductSalesPackage } from '@/lib/CRM/Offers/productSalesPackages';
type PackagePreviewDesign = { primary_color: string; accent_color: string; surface_color: string };
const defaultDesign: PackagePreviewDesign = { primary_color: '#5b001f', accent_color: '#d3bb73', surface_color: '#faf7f2' };
export default function ProductPackagesPreview({name,packages,pageNumber=2,selectedPackageId,design=defaultDesign}:{name:string;packages:ProductSalesPackage[];pageNumber?:number;selectedPackageId?:string|null;design?:PackagePreviewDesign}) {
  const container=useRef<HTMLDivElement>(null);const [width,setWidth]=useState(320);const [images,setImages]=useState<Record<string,string>>({});
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => {
      // Match the element preview: hidden tabs and subpixel changes do not resize the page.
      const nextWidth = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (nextWidth > 0) setWidth(current => current === nextWidth ? current : nextWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const signature=packages.map(p=>p.id+':'+p.image_path).join('|');
  useEffect(()=>{let stale=false;(async()=>{const entries=await Promise.all(packages.map(async p=>{if(!p.image_path)return [p.id,''];const {data}=await supabase.storage.from('offer-product-pages').createSignedUrl(p.image_path,3600);return [p.id,data?.signedUrl||''];}));if(!stale)setImages(Object.fromEntries(entries));})();return()=>{stale=true;};},[signature]);
  const scale=Math.min(1,width/L.width);const primary=design.primary_color;const gold=design.accent_color;const heading={fontFamily:"'OfferBrandHeading', Atom, sans-serif",textTransform:'uppercase' as const};
  return <div ref={container} className="min-w-0 overflow-hidden rounded-lg"><div style={{width:L.width*scale,height:L.height*scale}}><div style={{width:L.width,height:L.height,transform:`scale(${scale})`,transformOrigin:'top left',background:design.surface_color,color:primary,position:'relative',fontFamily:'Arial,sans-serif'}}>
    <div style={{position:'absolute',left:36,top:32,fontSize:8,letterSpacing:1,...heading}}>{name} / pakiety</div>
    <div style={{position:'absolute',left:36,top:57,fontSize:27,lineHeight:'34px',whiteSpace:'pre-line',...heading}}>{C.title}</div>
    <div style={{position:'absolute',left:36,top:132,fontSize:10,color:'#756f6b'}}>{name.toLocaleLowerCase('pl-PL').includes('kasyn')?'Od wspólnej gry przy dwóch stołach po kompletną strefę z dekoracją.':C.lead}</div>
    <div style={{position:'absolute',left:36,right:36,top:160,height:1,background:primary}}/>
    {packages.slice(0,3).map((p,i)=>{const top=L.tops[i];const h=L.heights[i];const dark=p.id===selectedPackageId;const extension=packageExtensionLabel(p);const text=dark?'#faf7f2':primary;return <div key={p.id} style={{position:'absolute',left:L.x,top,width:L.widthCard,height:h,borderRadius:9,background:dark?primary:'#fff',color:text}}>
      <div style={{position:'absolute',left:12,top:12,bottom:12,width:3,borderRadius:2,background:dark?gold:primary}}/>
      <div style={{position:'absolute',left:28,top:16,fontSize:18,color:gold,...heading}}>{String(i+1).padStart(2,'0')}</div>
      <div style={{position:'absolute',left:74,top:14,width:245,fontSize:14,lineHeight:'17px',...heading}}>{p.name}</div>
      <div style={{position:'absolute',left:74,top:44,width:242,fontSize:8.5,lineHeight:'12px',color:dark?'#eee7df':'#756f6b'}}>{p.description}</div>
      <div style={{position:'absolute',left:74,top:72,width:245,fontSize:8,letterSpacing:.6,...heading}}>{p.included_label}</div>
      <div style={{position:'absolute',left:74,top:92,width:235,height:.6,background:dark?gold:primary}}/>
      <div style={{position:'absolute',left:74,bottom:extension?27:15,fontSize:29,fontWeight:500}}>{p.price_net.toLocaleString('pl-PL')} zł <span style={{fontSize:7,fontWeight:400,color:dark?'#eee7df':'#756f6b'}}>│ NETTO / PAKIET</span></div>
      {extension && <div style={{position:'absolute',left:74,top:h-15,width:245,fontSize:6.6,lineHeight:'8.25px',color:dark?'#eee7df':'#756f6b'}}>{extension}</div>}
      {images[p.id]&&<img src={images[p.id]} alt={p.image_alt||p.name} style={{position:'absolute',right:10,top:12,width:L.imageWidth,height:h-24,borderRadius:7,objectFit:'cover'}}/>}
      {p.bonus && <div style={{position:'absolute',right:10,bottom:8,width:144,height:26,boxSizing:'border-box',borderRadius:6,background:primary,color:'#faf7f2',display:'flex',alignItems:'center',gap:6,padding:'2px 7px',fontSize:7,lineHeight:'8.5px'}}><Gift size={14} style={{flexShrink:0,color:gold}}/><span>{p.bonus}</span></div>}
      {dark && <div style={{position:'absolute',right:6,top:7,width:130,height:28,borderRadius:14,background:gold,color:primary,display:'flex',alignItems:'center',justifyContent:'center',gap:6,fontSize:8,...heading}}><CheckCircle2 size={15}/><span>Wybrany pakiet</span></div>}
    </div>;})}
    {[FileText,SlidersHorizontal,CheckCircle2].map((Icon,i)=><div key={i} style={{position:'absolute',top:709,left:70+i*192,width:110,textAlign:'center'}}><div style={{margin:'auto',width:37,height:37,borderRadius:'50%',background:'#f2eae1',display:'grid',placeItems:'center'}}><Icon size={21}/></div><div style={{marginTop:8,fontSize:7,...heading}}>{C.steps[i]}</div></div>)}
    <div style={{position:'absolute',top:773,left:36,right:36,textAlign:'center',fontSize:7,color:'#756f6b'}}>{C.note}</div>
    <div style={{position:'absolute',left:36,right:36,top:801,height:.6,background:primary}}/>
    <div style={{position:'absolute',left:36,top:812,fontSize:7,...heading}}>MAVINCI · OFERTA EVENTOWA</div><div style={{position:'absolute',right:36,top:812,fontSize:7}}>{String(pageNumber).padStart(2, '0')}</div>
  </div></div></div>;
}
