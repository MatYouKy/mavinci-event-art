'use client';
import { useId } from 'react';
import { ContractDateField } from '@/components/crm/invoices/ContractTermFields';
import { personnelInput as input } from '@/lib/personnel/workspace';
import { assessQuestionnaire, visibleQuestions, type PersonnelQuestionnaire, type QuestionContext, type WizardIssue, wizardSteps } from '@/lib/personnel/questionnaire';

export function PersonnelQuestionnaireFields({ step, context, value, onChange }: { step: number; context: QuestionContext; value: PersonnelQuestionnaire; onChange: (v: PersonnelQuestionnaire)=>void }) {
  const id=useId();
  const set=(key:string,answer:string)=>onChange({...value,answers:{...value.answers,[key]:answer},confirmed:false});
  const questions=visibleQuestions(value.answers,context).filter(q=>q.step===step);
  return <div className="space-y-4">
    {step===2&&<p className="rounded-lg bg-white/[0.035] p-3 text-sm leading-6">Odpowiadaj na podstawie oświadczenia tej osoby, dla okresu pracy wybranego w poprzednim kroku. „Nie wiem” pozwala przygotować szkic i listę pytań do wyjaśnienia. Nie wybieraj odpowiedzi za osobę.</p>}
    {questions.map(q=><fieldset key={q.key} className="min-w-0 rounded-lg bg-white/[0.035] p-4">
      {q.type==='date'?<ContractDateField label={q.label} value={value.answers[q.key]||''} onChange={v=>set(q.key,v)} required/>:<>
        <legend className="float-left mb-3 w-full text-sm font-medium">{q.label}</legend>
        {q.options?<div className="clear-both grid gap-2">{q.options.map(([key,label])=><label key={key} className={`flex cursor-pointer items-start gap-3 rounded-lg p-3 text-sm ${value.answers[q.key]===key?'bg-[#d3bb73]/10 text-[#e5d799]':'bg-black/10 hover:bg-white/5'}`}><input type="radio" className="mt-1 accent-[#d3bb73]" name={`${id}-${q.key}`} checked={value.answers[q.key]===key} onChange={()=>set(q.key,key)}/><span>{label}</span></label>)}</div>:<input aria-label={q.label} className={input} type={q.type==='number'?'number':'text'} min={q.type==='number'?'0':undefined} step={q.type==='number'?'0.01':undefined} value={value.answers[q.key]||''} onChange={e=>set(q.key,e.target.value)} autoComplete="off"/>}
      </>}
      {q.help&&<p className="clear-both mt-2 text-xs leading-5 opacity-65">{q.help}</p>}
      {value.answers[q.key]==='unknown'&&<p className="mt-2 text-xs leading-5 text-amber-200">Ten punkt trafi do listy ustaleń. Do tego czasu koszt i aktywacja umowy będą zablokowane.</p>}
    </fieldset>)}
    {step===2&&<label className="block text-xs">Dodatkowe informacje przekazane przez osobę<textarea className={input} rows={3} value={value.answers.notes||''} onChange={e=>set('notes',e.target.value)} placeholder="Np. opis innego tytułu ubezpieczenia. Notatka nie zastępuje odpowiedzi powyżej."/></label>}
  </div>;
}

export function PersonnelWizardIssues({issues,onStep}:{issues:WizardIssue[];onStep?:(step:number)=>void}) {
  if(!issues.length)return null;
  return <div role="alert" className="space-y-2 rounded-lg bg-amber-400/5 p-4 text-sm"><p className="font-medium text-amber-100">Do uzupełnienia lub wyjaśnienia ({issues.length})</p><ul className="space-y-2">{issues.map((issue,i)=><li key={`${issue.key}-${i}`} className="leading-5"><span className="text-amber-100/85">{issue.message}</span>{onStep&&<button type="button" className="ml-2 text-xs underline underline-offset-2" onClick={()=>onStep(issue.step)}>Krok {issue.step+1}</button>}</li>)}</ul></div>;
}

export function PersonnelWizardSummary({context,issues,partyName,companyName,contractLabel,onStep,confirmed,onConfirm}:{context:QuestionContext;issues:WizardIssue[];partyName:string;companyName:string;contractLabel:string;onStep:(step:number)=>void;confirmed:boolean;onConfirm:(v:boolean)=>void}) {
  const result=assessQuestionnaire(context);
  const a=context.profile.questionnaire?.answers||{};
  const date=(s:string)=>s?s.split('-').reverse().join('.'):'Nie podano';
  const downloadQuestions=()=>{
    const questions=visibleQuestions(a,context).map(q=>`${q.label}\n${q.options?.find(([key])=>key===a[q.key])?.[1]||a[q.key]||'Brak odpowiedzi'}`).join('\n\n');
    const text=`DANE DO USTALENIA WARUNKÓW UMOWY\n${companyName} — ${partyName}\n${contractLabel}\nPraca: ${date(context.settings.work_from)} – ${date(context.settings.work_to)}\nWypłata: ${date(context.settings.payment_date)}\n\nDO WYJAŚNIENIA\n${issues.map(i=>'- '+i.message).join('\n')||'Brak wskazanych braków'}\n\nODPOWIEDZI\n${questions}\n\nInformacje służą przygotowaniu umowy; nie są zatwierdzoną listą płac.`;
    const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download='ustalenia-do-umowy.txt';link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <div className="space-y-4">
    <dl className="space-y-3 rounded-lg bg-white/[0.035] p-4 text-sm">
      {[['Strony',`${companyName} → ${partyName}`],['Umowa',contractLabel],['Praca objęta kalkulacją',`${date(context.settings.work_from)} – ${date(context.settings.work_to)}`],['Wypłata',date(context.settings.payment_date)],['Oświadczenie ważne do',date(a.declaration_to)],['Wynik odpowiedzi',result.issues.length?'Wymaga uzupełnienia / wyjaśnienia':result.label]].map(([label,value])=><div key={label}><dt className="text-xs opacity-60">{label}</dt><dd className="mt-1">{value}</dd></div>)}
    </dl>
    <PersonnelWizardIssues issues={issues} onStep={onStep}/>
    <button type="button" onClick={downloadQuestions} className="rounded-lg bg-white/5 px-4 py-2 text-sm text-[#d3bb73]">Pobierz odpowiedzi i listę ustaleń</button>
    <details className="rounded-lg bg-white/[0.035] p-4"><summary className="cursor-pointer text-sm">Sprawdź wszystkie odpowiedzi</summary><div className="mt-3 space-y-4">{visibleQuestions(a,context).map(q=><div key={q.key} className="text-sm"><p className="text-xs opacity-60">{wizardSteps[q.step]} · {q.label}</p><p className="mt-1">{q.options?.find(([key])=>key===a[q.key])?.[1]||a[q.key]||'Brak odpowiedzi'}</p></div>)}</div></details>
    <p className="rounded-lg bg-white/[0.035] p-4 text-xs leading-6">Po zapisaniu dodaj stawkę obowiązującą w umowie i wygeneruj dokument. Przed każdym rozliczeniem sprawdź aktualność oświadczenia, godziny i zmiany sytuacji osoby. Sam koszt z kalkulatora nie zatwierdza PIT, ZUS ani przelewu.</p>
    <label className="flex items-start gap-3 rounded-lg bg-[#d3bb73]/5 p-4 text-sm leading-6"><input type="checkbox" className="mt-1.5 accent-[#d3bb73]" checked={confirmed} onChange={e=>onConfirm(e.target.checked)} disabled={issues.length>0}/><span>Sprawdzono podsumowanie z dokumentami osoby. Dane dotyczą wskazanego okresu i wybranej działalności. Każda zmiana danych wymaga ponownego potwierdzenia.</span></label>
    <p className="text-xs leading-5 opacity-60">Reguły: ZUS — zbieg tytułów i status studenta; MF — PIT-2 i ulga dla młodych. Odpowiedzi „Nie wiem” i przypadki wymagające indywidualnych ustaleń pozwalają zapisać szkic. Nie pozwalają aktywować umowy ani utrwalić dokumentu.</p>
  </div>;
}
