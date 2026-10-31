/** Product-owned dependency groups; warehouse compatibility remains the source of suggestions. */
export type ComponentRequirement='required'|'recommended'|'optional';
export type ComponentOption={id:string;equipment_id:string;quantity:number;mode:'per_item'|'fixed'|'per_batch';per_quantity?:number;led_signal_outputs?:number;min_height:number|null;max_height:number|null};
export type ComponentGroup={id:string;name:string;requirement:ComponentRequirement;items:ComponentOption[]};
export type ComponentGroups=Record<string,ComponentGroup[]>;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function componentGroupLinks(groups:ComponentGroup[]){return groups.flatMap(g=>g.items.map(i=>({...i,type:g.requirement,group:g.name.trim()})));}
export function validateComponentGroups(groups:ComponentGroups|undefined):string|null{
 if(groups===undefined)return null;
 if(!groups||Array.isArray(groups)||typeof groups!=='object'||Object.keys(groups).length>200)return 'Nieprawidłowe grupy komponentów.';
 let count=0;
 for(const [parent,list] of Object.entries(groups)){
  if(!uuid.test(parent)||!Array.isArray(list)||list.length>25)return 'Nieprawidłowy komponent nadrzędny lub zbyt wiele grup.';
  let parentCount=0;
  const names=new Set<string>(),groupIds=new Set<string>(),ids=new Set<string>(),equipment=new Set<string>();
  for(const g of list){
   if(!g||!uuid.test(g.id)||groupIds.has(g.id)||typeof g.name!=='string'||!g.name.trim()||g.name.trim().length>100||names.has(g.name.trim())||!['required','recommended','optional'].includes(g.requirement)||!Array.isArray(g.items)||!g.items.length)return 'Każde zagnieżdżenie musi mieć unikalną nazwę, wymaganie i przynajmniej jeden element.';
   groupIds.add(g.id);names.add(g.name.trim());
   for(const [index,i] of g.items.entries()){
    const where=`Grupa „${g.name}”, pozycja ${index+1}: `;
    if(++count>500||++parentCount>50)return where+'przekroczono limit elementów w zagnieżdżeniach.';
    if(!i||!uuid.test(i.id)||!uuid.test(i.equipment_id))return where+'nieprawidłowe powiązanie sprzętu. Wybierz tę pozycję ponownie z magazynu.';
    if(ids.has(i.id)||equipment.has(i.equipment_id))return where+'ten sprzęt występuje już przy tym samym komponencie nadrzędnym. Usuń powtórzenie.';
    if(i.equipment_id===parent)return where+'komponent nie może być swoim własnym dodatkiem.';
    const quantityError=componentOptionInputError(i);if(quantityError)return where+quantityError;
    if([i.min_height,i.max_height].some(n=>n!==null&&(!Number.isInteger(n)||n<1||n>200))||(i.min_height!==null&&i.max_height!==null&&i.min_height>i.max_height))return 'Popraw zakres wysokości elementu.';
    ids.add(i.id);equipment.add(i.equipment_id);
   }
  }
 }
 const done=new Set<string>();
 function visit(id:string,path:string[]):boolean{if(path.includes(id)||path.length>=8)return false;if(done.has(id))return true;for(const child of (groups![id]||[]).flatMap(g=>g.items))if(!visit(child.equipment_id,[...path,id]))return false;done.add(id);return true;}
 for(const id of Object.keys(groups))if(!visit(id,[]))return 'Drzewo zawiera pętlę lub przekracza 8 poziomów.';
 return null;
}

/** Round parent quantities up to whole batches, then apply the requested quantity. */
export function componentQuantity(item:{quantity:number;mode:string;per_quantity?:number},parentQuantity:number):number{
 return item.quantity*(item.mode==='per_item'?parentQuantity:item.mode==='per_batch'?Math.ceil(parentQuantity/(item.per_quantity??NaN)):1);
}

/** Field-level feedback shared by the editor and product save. */
export function componentOptionInputError(item:ComponentOption):string|null{
 if(!Number.isFinite(item.quantity)||item.quantity<=0||item.quantity>1000||Math.abs(item.quantity*100-Math.round(item.quantity*100))>.0001)return 'Uzupełnij „Liczba elementów”: wartość większa od 0, maksymalnie 1000 i dwa miejsca po przecinku.';
 if(!['per_item','fixed','per_batch'].includes(item.mode))return 'Wybierz sposób naliczania.';
 if(item.mode==='per_batch'&&(!Number.isInteger(item.per_quantity)||!item.per_quantity||item.per_quantity<1||item.per_quantity>100000))return 'Uzupełnij „Na każde ile sztuk komponentu nadrzędnego?”: liczba całkowita od 1 do 100000, np. 12. W polu „Liczba elementów” wpisz np. 1 podstawę.';
 if(item.led_signal_outputs!==undefined&&(!Number.isInteger(item.led_signal_outputs)||item.led_signal_outputs<1||item.led_signal_outputs>1000))return 'Limit aktywnych skrętek musi być liczbą całkowitą od 1 do 1000.';
 return null;
}
