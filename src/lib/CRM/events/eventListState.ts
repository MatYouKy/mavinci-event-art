export function eventListState(event: any, payments: any[] = [], now = new Date()) {
  if(event.status==='cancelled')return {state:'cancelled',label:'Anulowane',days:0};
  if(event.status==='settled')return {state:'settled',label:'Rozliczone · zamknięte',days:0};
  const today=Date.UTC(now.getFullYear(),now.getMonth(),now.getDate());
  const pending=payments.filter(p=>!['paid','waived','cancelled','draft','proforma'].includes(p.status)&&!p.paid_at&&Number(p.amount)>Number(p.paid_amount||0));
  const days=Math.max(0,...pending.map(p=>{const d=String(p.due_date||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(d)?Math.floor((today-Date.parse(d+'T00:00:00Z'))/86400000)||0:0;}));
  if(days>7)return {state:'overdue',label:`Przelew opóźniony o ${days} dni`,days};
  if(days>0)return {state:'late',label:`Płatność po terminie · ${days} dni`,days};
  if(pending.length||event.status==='invoiced')return {state:'awaiting',label:days>0?`Przelew po terminie · ${days} dni`:'Oczekuje na przelew',days};
  if(event.status==='in_progress')return {state:'live',label:'W realizacji',days:0};
  if(event.status==='completed')return {state:'completed',label:'Zrealizowane · do rozliczenia',days:0};
  const end=new Date(event.event_end_date||event.event_date);end.setHours(0,0,0,0);
  if(end.getTime()<new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime())return {state:'settlement',label:'Do rozliczenia',days:0};
  return {state:'scheduled',label:'Zaplanowane',days:0};
}
