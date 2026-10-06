 'use client';
import { ContractDateField } from '@/components/crm/invoices/ContractTermFields';
import { personnelInput as input,personnelMoney as money } from '@/lib/personnel/workspace';
import { roundMoney,normalizePayrollProfile } from '@/lib/personnel/legal';
export const newPayroll = () => ({payment_date:'',gross:'',pit:'',social:'',health:'',other:'',employer:'',tax_scheme:'',youth_relief:'0',outside_relief:'0',student_exempt:false});
export type PayrollForm = ReturnType<typeof newPayroll>;
export const payrollTotals = (value:PayrollForm) => ({net:roundMoney(Number(value.gross)-Number(value.pit)-Number(value.social)-Number(value.health)-Number(value.other)),cost:roundMoney(Number(value.gross)+Number(value.employer))});
export function PersonnelPayrollFields({value,onChange,contract,minimum}:{value:PayrollForm;onChange:(v:PayrollForm)=>void;contract:any;minimum:number|null}) {
 const profile=normalizePayrollProfile(contract.payroll_profile),totals=payrollTotals(value);
 const fields=[['gross','Brutto z rozliczenia'],['pit','Zaliczka / podatek PIT'],['social','Składki społeczne osoby'],['health','Składka zdrowotna osoby'],['other','Pozostałe potrącenia osoby, np. PPK'],['employer','Obciążenia ponad brutto po stronie firmy']] as const;
 return <>
 <p className="text-xs leading-5 opacity-65 sm:col-span-2">Przepisz kwoty z listy płac lub rachunku przygotowanego z uwzględnieniem sytuacji osoby. Pola nie wyliczają automatycznie PIT i ZUS. Wpisz 0 przy braku danego obciążenia.</p>
 <ContractDateField label="Data uzyskania przychodu przyjęta w rozliczeniu" value={value.payment_date} onChange={payment_date=>onChange({...value,payment_date})}/>
 <label className="text-xs">Sposób opodatkowania<select className={input} value={value.tax_scheme} onChange={e=>onChange({...value,tax_scheme:e.target.value,youth_relief:'0'})}><option value="">Wybierz według rozliczenia</option><option value="scale">Skala podatkowa</option><option value="flat">Podatek zryczałtowany</option><option value="other">Inny / indywidualne zasady</option></select></label>
 {fields.map(([key,label])=><label key={key} className="text-xs">{label}<input className={input} type="number" min="0" step="0.01" value={value[key]} onChange={e=>onChange({...value,[key]:e.target.value})}/></label>)}
 {contract.contract_kind==='mandate'&&<p className="text-xs leading-5 sm:col-span-2">{minimum===null?'Brak stawki minimalnej dla tego roku — rozliczenie wymaga aktualizacji stawek.':`Minimum za zapisane godziny: ${money(minimum)} brutto. Uwzględnij ewentualne wyrównanie w kwocie brutto.`}</p>}
 {contract.contract_kind==='employment'&&<p className="text-xs leading-5 text-amber-100/80 sm:col-span-2">Dla etatu minimum i należności sprawdza lista płac, z uwzględnieniem wymiaru etatu, absencji i dodatków. Minimum zlecenia nie jest stawką minimalną dla etatu.</p>}
 {contract.contract_kind==='mandate'&&<label className="flex gap-2 text-xs leading-5 sm:col-span-2"><input type="checkbox" className="mt-1" checked={value.student_exempt} onChange={e=>onChange({...value,student_exempt:e.target.checked})}/>W rozliczeniu zastosowano zwolnienie ucznia/studenta ze składek za cały okres pracy. Wymagane: daty statusu, wiek poniżej 26 lat i brak własnego pracodawcy w zapisanych danych umowy.</label>}
 {contract.contract_kind!=='specific_work'&&value.tax_scheme==='scale'&&<>
 <label className="text-xs">Przychód objęty ulgą dla młodych w tej wypłacie<input className={input} type="number" min="0" step="0.01" value={value.youth_relief} onChange={e=>onChange({...value,youth_relief:e.target.value})}/></label>
 <label className="text-xs">Wykorzystanie wspólnego limitu poza ulgą zapisaną w CRM w tym roku<input className={input} type="number" min="0" step="0.01" value={value.outside_relief} onChange={e=>onChange({...value,outside_relief:e.target.value})}/></label>
 <p className="text-xs leading-5 opacity-65 sm:col-span-2">Kwota spoza CRM obejmuje innych płatników, wcześniejsze niezaimportowane wypłaty oraz pozostałe ulgi objęte wspólnym limitem. System doliczy ulgę zapisaną dla tej osoby w CRM, również z innych umów. Wiek ocenia według daty przychodu, nie daty pracy. Dane osoby: {profile.birth_date?'data urodzenia zapisana':'brak daty urodzenia'}.</p>
 </>}
 <p className="rounded-lg bg-white/5 p-3 text-sm sm:col-span-2">Netto do wypłaty: {money(totals.net,contract.currency)} · Koszt firmy: {money(totals.cost,contract.currency)}</p>
 </>;
}
