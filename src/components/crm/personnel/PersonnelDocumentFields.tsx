'use client';
import {personnelInput as input} from '@/lib/personnel/workspace';
import {getTimeEvidenceMethod, timeEvidenceText, type TimeEvidenceMethod, type PersonnelDocumentDetails} from '@/lib/personnel/documentFields';
export function PersonnelDocumentFields({value,onChange,kind,term}:{value:PersonnelDocumentDetails;onChange:(v:PersonnelDocumentDetails)=>void;kind:string;term:string}) {
 const method=getTimeEvidenceMethod(value);
 const selectMethod=(next:TimeEvidenceMethod)=>onChange({...value,time_evidence_method:next,time_evidence:next==='other'?(method==='other'?value.time_evidence:''):timeEvidenceText[next]});
 const set=(key:keyof PersonnelDocumentDetails,v:string)=>onChange({...value,[key]:v});
 const text=(key:Exclude<keyof PersonnelDocumentDetails,'party_address_parts'>,label:string,placeholder='')=><label className="block text-xs sm:col-span-2">{label}<textarea className={input} rows={2} value={value[key]} onChange={e=>set(key,e.target.value)} placeholder={placeholder}/></label>;
 return <section className="space-y-3 rounded-lg bg-white/[0.035] p-4"><h4 className="text-sm font-medium">Warunki do dokumentu umowy</h4><p className="text-xs leading-5 opacity-60">Uzupełnij przed wygenerowaniem PDF. Te dane zostaną zapisane w treści i utrwalone z dokumentem.</p><div className="grid gap-3 sm:grid-cols-2">
 {text('work_place',kind==='specific_work'?'Miejsce wykonania lub przekazania dzieła':'Miejsce lub miejsca wykonywania pracy / czynności','Konkretny adres albo uzgodniony obszar wykonywania pracy')}
 {kind==='employment'&&<>
 <label className="text-xs">Stanowisko / rodzaj pracy<input className={input} value={value.job_title} onChange={e=>set('job_title',e.target.value)}/></label>
 <label className="text-xs">Wymiar etatu<input className={input} value={value.work_time_fraction} onChange={e=>set('work_time_fraction',e.target.value)} placeholder="Np. 1/1 lub 1/2"/></label>
 {value.work_time_fraction!=='1/1'&&text('overtime_threshold','Próg godzin ponad umówiony wymiar uprawniający do dodatku','Dla niepełnego etatu: ustalenie zgodne z art. 151 § 5 Kodeksu pracy')}
 {text('additional_pay','Pozostałe składniki wynagrodzenia — jeśli uzgodniono','Rodzaj, wysokość brutto i zasady naliczania dodatków / premii')}
 {term==='fixed'&&<><label className="text-xs sm:col-span-2">Podstawa umowy na czas określony<select className={input} value={value.term_basis} onChange={e=>set('term_basis',e.target.value)}><option value="standard">Zwykła umowa terminowa — limity 3 umów / 33 miesięcy</option><option value="replacement">Zastępstwo</option><option value="seasonal">Praca dorywcza lub sezonowa</option><option value="tenure">Okres kadencji</option><option value="objective">Obiektywne przyczyny po stronie pracodawcy</option></select></label>{value.term_basis!=='standard'&&text('term_reason','Konkretny cel i okoliczności uzasadniające umowę terminową')}</>}
 <p className="text-xs leading-5 opacity-60 sm:col-span-2">Wzór obejmuje czas określony i nieokreślony. Uwzględnij wcześniejsze zatrudnienie przy limitach umów terminowych. Wyjątek z obiektywnych przyczyn wymaga zawiadomienia PIP w terminie 5 dni roboczych. Informację o warunkach zatrudnienia z art. 29 § 3 przekazuje się osobno.</p>
 </>}
 {kind==='mandate'&&<>
 <label className="block text-xs sm:col-span-2">Sposób potwierdzania godzin
 <select className={input} value={method} onChange={e=>selectMethod(e.target.value as TimeEvidenceMethod)}>
 <option value="" disabled>Wybierz sposób potwierdzania godzin</option>
 <option value="crm">System CRM</option><option value="task">Zadanie</option><option value="other">Inne</option>
 </select></label>
 {method==='crm'&&<p className="text-xs leading-5 opacity-60 sm:col-span-2">Po zapisaniu umowy powiązany pracownik otrzyma dostęp „Czas pracy — przeglądanie i raportowanie własnego czasu”. Jeśli osoba nie ma konta CRM, najpierw powiąż ją z pracownikiem. Sam wybór tej opcji nie daje dostępu do czasu innych osób.</p>}
 {method==='task'&&<p className="text-xs leading-5 opacity-60 sm:col-span-2">Czas pracy będzie potwierdzany przy przypisanych zadaniach. Ta opcja zapisuje sposób ewidencji w umowie; zadania i ich wykonawców wybierasz na tablicy zadań.</p>}
 {method==='other'&&<label className="block text-xs sm:col-span-2">Opisz sposób potwierdzania godzin<input className={input} value={value.time_evidence} onChange={e=>set('time_evidence',e.target.value)} placeholder="Wpisz uzgodniony sposób ewidencji i potwierdzania godzin"/></label>}
 </>}
 {kind==='specific_work'&&<>{text('acceptance_criteria','Cechy dzieła i kryteria sprawdzenia rezultatu','Wskaż mierzalny, indywidualny rezultat; sama obsługa wydarzenia jest zwykle świadczeniem usług.')}{text('acceptance_procedure','Sposób przekazania i odbioru dzieła','W jaki sposób i komu dzieło zostanie przekazane; termin sprawdzenia, dokument odbioru, tryb zgłaszania wad.')}{text('materials','Materiały, narzędzia i obowiązki współdziałania','Kto je zapewnia, zasady wykorzystania i zwrotu. Jeśli nie są potrzebne, wpisz to wprost.')}<p className="text-xs leading-5 opacity-60 sm:col-span-2">Wzór dotyczy jednego dzieła za ustaloną kwotę. Prawa autorskie i pola eksploatacji wymagają osobnego uzgodnienia; ten wzór nie przenosi ich automatycznie.</p></>}
 </div></section>;
}
